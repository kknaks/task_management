"""라우터 의존성.

`get_db` — 요청 하나 = 트랜잭션 하나(backend/README.md §7).
`require_context` — Bearer 하나를 `AccountContextDTO`(계정 + 회의 범위)로 푼다. **회의 범위 규칙이 사는 한 곳**이다.
`require_account` — 그 결과의 `account_id`(int). 기존 라우터는 이것만 본다(§9).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from core.db import SessionLocal, run_after_commit_hooks
from core.exceptions import AppError, NotFoundError, UnauthorizedError
from dto.auth import AccountContextDTO
from service import auth_service

# `auto_error=False` — 헤더가 없을 때 FastAPI 가 자기 형식의 401 을 내지 않게 한다.
# 응답 형태는 `{"detail", "code"}` 하나로 고정이다(backend/README.md §8-2).
_bearer_scheme = HTTPBearer(auto_error=False)

# 회의 토큰으로 **200 이 되는 표면 — 이 여섯뿐**이다(WORK-009 검수 F-1 · 코디 확정).
# **allowlist 다.** 「쓰기만 막는다」가 아니라 「여기 없으면 없다」 — 표면이 새로 생겨도 기본이 404 라
# 목록 · job · 문서함 · 캘린더 · 프로필처럼 도구가 부르지 않는 조회가 조용히 열리지 않는다
# (DEC-003 §2 · `system/README.md` 불변식 14 — 권한 경계는 백엔드가 진다. codex 의 allow list 가 아니라).
#
# 키는 `(메서드, 라우트 경로 템플릿)` 이다. FastAPI 가 매칭한 라우트의 `path` 를 그대로 쓰므로
# `{meeting_id}` 같은 자리도 이름까지 같아야 한다 — 실제 URL 문자열을 파싱하지 않는다.
# 회의 라우터의 하위 조회(안건 · 줄 · transcript)는 **일부러 뺐다**: 도구는 `/current` 상세로 다 본다.
_MEETING_TOKEN_SURFACES = frozenset(
    {
        ("GET", "/api/meetings/current"),
        ("GET", "/api/meetings/current/tasks"),
        # 토큰의 회의일 때만 — 아래 `{meeting_id}` 대조가 한 번 더 건다
        ("GET", "/api/meetings/{meeting_id}"),
        ("GET", "/api/tasks/{task_id}"),
        ("GET", "/api/work-types"),
        ("GET", "/api/auth/session"),
    }
)

# 회의 범위를 볼 때 대조하는 경로 파라미터 이름. 회의 라우터·스트림이 같은 이름을 쓴다
_MEETING_PATH_PARAM = "meeting_id"

# 없는 것 · 남의 것 · 표면 밖을 **구별하지 않는다** — 회의 토큰이 무엇을 못 보는지 문구로 흘리지 않는다.
# **리소스를 말하지 않는다**: 이 404 는 업무 · 유형 · job 어디서든 날 수 있어서 「회의록을 …」이라고 하면
# 표면과 문구가 어긋난다. 리소스별 문구(SPEC-006 §4 · SPEC-003 §4)는 각 service 의 기존 예외가 낸다.
_NOT_FOUND = "찾을 수 없습니다"


async def get_db() -> AsyncIterator[AsyncSession]:
    """요청 하나 = 트랜잭션 하나(backend/README.md §7). 요청 끝에서 commit 한다.

    예외가 나면 commit 을 건너뛰고 세션 종료가 롤백한다.

    **예외 하나** — `persist_changes` 가 켜진 도메인 예외는 commit 하고 다시 던진다.
    「실패 응답 자체가 쓰기를 뜻하는」 설계된 실패가 있기 때문이다(A-7 재사용 감지:
    401 을 주면서 그 계정의 세션을 전부 끊는다). 롤백하면 그 무효화가 사라진다.
    포착은 **구체 타입**이고 **반드시 재전파**한다 — 삼키지 않는다(§8-1).
    """
    async with SessionLocal() as session:
        try:
            yield session
        except AppError as exc:
            if exc.persist_changes:
                await session.commit()
            raise
        await session.commit()
        # 커밋된 뒤에만 뜻이 있는 일(배치 트리거 평가) — 등록된 순서대로. 커밋이 안 됐으면 여기 오지 않는다
        await run_after_commit_hooks(session)


async def require_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    session: AsyncSession = Depends(get_db),
) -> AccountContextDTO:
    """Bearer 를 계정(+회의) 범위로 풀고 **회의 토큰의 두 금지**를 여기서 판정한다(WP §Internal Interface).

    갈래는 `auth_service.resolve_bearer` 가 진다 — JWT 면 DB 를 보지 않고(지금 그대로),
    아니면 `auth_session(kind='meeting')` 원문을 찾는다. 헤더가 없든 만료든 위조든 **응답은 하나**다
    (`401 token_expired`) — 거부 사유를 흘리지 않고, 프론트는 갱신 1회 → 실패하면 로그인으로 끝낸다(SPEC-001 §5).

    회의 토큰으로 온 요청은 —

    1. **`_MEETING_TOKEN_SURFACES` 밖이면 메서드 불문 404** 다. allowlist 라 쓰기 · 목록 · job ·
       앞으로 생길 표면이 전부 기본 404 이고, 여는 것은 도구가 실제로 부르는 여섯뿐이다.
    2. **경로의 `{meeting_id}` 가 토큰의 회의와 다르면 404** 다. 남의 회의도, 자기 계정의 다른 회의도 같다.

    둘 다 `NotFoundError` 다 — 403 으로 「있긴 하다」를 알려주지 않는다.
    **한 곳에서 판정한다**: 여기를 지나지 않는 인증 표면이 없으므로(라우터 단위 게이트) 라우터마다 다시 적지 않는다.
    """
    if credentials is None:
        raise UnauthorizedError("세션이 만료되었습니다", code="token_expired")

    context = await auth_service.resolve_bearer(session, credentials.credentials)
    if context.meeting_id is None:
        return context

    route_path = getattr(request.scope.get("route"), "path", None)
    if (request.method.upper(), route_path) not in _MEETING_TOKEN_SURFACES:
        raise NotFoundError(_NOT_FOUND)

    path_meeting_id = request.path_params.get(_MEETING_PATH_PARAM)
    if path_meeting_id is not None and str(path_meeting_id) != str(context.meeting_id):
        raise NotFoundError(_NOT_FOUND)

    return context


async def require_account(
    context: AccountContextDTO = Depends(require_context),
) -> int:
    """`account_id` 하나. 로그인·refresh·헬스를 뺀 **모든 라우터에 라우터 단위**로 걸린다 —
    개별 함수에서 빠뜨릴 여지를 없앤다(backend/README.md §9 · WP Internal Interface Contract).

    회의 범위 판정은 `require_context` 가 이미 마쳤다 — 이 함수를 쓰는 라우터는 그대로 두면 된다.
    """
    return context.account_id

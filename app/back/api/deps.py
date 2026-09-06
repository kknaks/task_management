"""라우터 의존성.

`get_db` — 요청 하나 = 트랜잭션 하나(backend/README.md §7).
`require_account` — Bearer access 를 검증하고 `account_id` 를 돌려준다(§9).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.db import SessionLocal, run_after_commit_hooks
from core.exceptions import AppError, UnauthorizedError
from core.security import decode_access_token

# `auto_error=False` — 헤더가 없을 때 FastAPI 가 자기 형식의 401 을 내지 않게 한다.
# 응답 형태는 `{"detail", "code"}` 하나로 고정이다(backend/README.md §8-2).
_bearer_scheme = HTTPBearer(auto_error=False)


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


async def require_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> int:
    """access 토큰을 검증하고 `account_id` 를 돌려준다.

    로그인·refresh·헬스를 뺀 모든 라우터에 **라우터 단위**로 걸린다 —
    개별 함수에서 빠뜨릴 여지를 없앤다(backend/README.md §9 · WP Internal Interface Contract).

    헤더가 없든 만료든 위조든 **응답은 하나**다(`401 token_expired`) — 거부 사유를 흘리지 않고,
    프론트는 갱신 1회 → 실패하면 로그인 화면으로 끝낸다(SPEC-001 §5).
    DB 를 보지 않는다 — 서명과 만료가 판정의 전부다.
    """
    if credentials is None:
        raise UnauthorizedError("세션이 만료되었습니다", code="token_expired")

    return decode_access_token(credentials.credentials, secret=get_settings().jwt_secret)

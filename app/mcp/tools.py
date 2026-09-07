"""도구 7개 ↔ 우리 REST 대응(SPEC-007 §4 「AI 도구 7개」 표 · WORK-009 §Internal Interface Contract).

**얇다.** 판정 · 가공 · 캐시가 여기 없다 — 있으면 두 번째 게이트가 된다(MF-4 · DEC-003 §2).
권한 경계는 백엔드가 지고, 이 파일은 `Authorization` 을 그대로 실어 REST 를 부른 뒤 응답을 돌려준다.

- **전부 조회다.** POST · PATCH · DELETE 를 부르지 않는다(정적 검사).
- back 이 401 · 404 를 주면 `BackendError` 로 **그대로 드러낸다** — 빈 배열로 바꾸지 않는다.
- 회의 id 를 인자로 받는 도구가 없다 — **토큰이 회의를 안다**(back 이 `ctx.meeting_id` 로 판정).
  그래서 회의를 보는 셋(`get_meeting` · `list_agendas` · `get_agenda`)은 전용 표면 `GET /api/meetings/current` 를 부른다.

`app/back` 을 import 하지 않고 DB 드라이버도 쓰지 않는다(MF-68).
"""

from __future__ import annotations

from typing import Any

import httpx

# SPEC-007 §4 표 · `system/README.md` §Components 와 **글자 그대로** 같아야 한다.
# codex 의 `enabled_tools` 도 이 이름을 그대로 쓴다(접두 없음 — 틀리면 조용히 「툴 0개」).
TOOL_NAMES: tuple[str, ...] = (
    "get_meeting",
    "get_account",
    "list_agendas",
    "get_agenda",
    "list_tasks",
    "get_task",
    "list_work_types",
)

# 회의 토큰 전용 표면(WORK-009). JWT 로는 404 다 — 도구가 회의 id 를 모르기 때문에 back 이 토큰으로 채운다
_MEETING_CURRENT = "/api/meetings/current"
# 업무 목록도 전용 표면이다 — 화면용 `GET /api/tasks` 는 기본이 「오늘 하루」라 도구에 맞지 않는다(코디 지시)
_MEETING_TASKS = "/api/meetings/current/tasks"


class BackendError(RuntimeError):
    """back 이 2xx 가 아닌 것을 돌려줬다. **상태와 본문을 그대로 싣는다.**

    삼키지 않는 이유 — 만료·폐기·남의 회의가 도구 결과에 드러나야 AI 가 「데이터가 없다」와
    「볼 수 없다」를 혼동하지 않는다(WP Phase 2 검증).
    """

    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"backend {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class AgendaNotFound(LookupError):
    """토큰의 회의 안에 그 `agendaId` 가 없다. 조용히 빈 안건을 지어내지 않는다."""


async def _get(
    client: httpx.AsyncClient, path: str, *, params: dict[str, Any] | None = None
) -> Any:
    """**유일한 HTTP 호출 지점.** GET 뿐이다 — 쓰기 메서드를 부르는 코드가 이 파일에 없다."""
    response = await client.get(path, params=params)
    if response.status_code >= 400:
        raise BackendError(response.status_code, response.text)
    return response.json()


def _agenda_row(agenda: dict[str, Any]) -> dict[str, Any]:
    """SPEC-007 §4 `list_agendas()` — `id` · 제목 · `state` · `track` · `sourceAgendaId`."""
    return {
        "id": agenda["id"],
        "title": agenda["title"],
        "state": agenda["state"],
        "track": agenda["track"],
        "sourceAgendaId": agenda["sourceAgendaId"],
    }


def _line_row(line: dict[str, Any]) -> dict[str, Any]:
    """SPEC-007 §4 `get_agenda(id)` — 그 안건에 달린 줄(`kind` · `content` · `detail` · `taskId`)."""
    return {
        "kind": line["kind"],
        "content": line["content"],
        "detail": line["detail"],
        "taskId": line["taskId"],
    }


def _tracked_agendas(detail: dict[str, Any]) -> list[dict[str, Any]]:
    """**사람 안건 + AI 안건 둘 다**(MF-51) — 자기가 앞서 만든 안건을 봐야 또 만들지 않는다.

    `merged` 는 종료 후 통합본이라 회의 중 도구가 볼 것이 아니다(SPEC-008).
    """
    agendas = detail["agendas"]
    return [*agendas["human"], *agendas["ai"]]


# --- 도구 7개 ---------------------------------------------------------------


async def get_meeting(client: httpx.AsyncClient) -> Any:
    """회의 정보 — 제목 · 일시 · 유형 · 프로젝트. `GET /api/meetings/current` 응답 그대로."""
    return await _get(client, _MEETING_CURRENT)


async def get_account(client: httpx.AsyncClient) -> Any:
    """사용자 정보. `GET /api/auth/session` 응답 그대로.

    (`GET /api/profile` 은 SPEC-010 의 표면이고 아직 없다 — 생기면 이 한 줄이 바뀐다.)
    """
    return await _get(client, "/api/auth/session")


async def list_agendas(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """안건 목록 — **사람 안건 + AI 안건 둘 다**(MF-51)."""
    detail = await _get(client, _MEETING_CURRENT)
    return [_agenda_row(agenda) for agenda in _tracked_agendas(detail)]


async def get_agenda(client: httpx.AsyncClient, agenda_id: int) -> dict[str, Any]:
    """안건 상세 — 그 안건 + 달린 줄. **사람이 적은 줄을 보는 도구**다(F-10 — 6개가 7개가 된 이유)."""
    detail = await _get(client, _MEETING_CURRENT)
    for agenda in _tracked_agendas(detail):
        if agenda["id"] == agenda_id:
            return {
                **_agenda_row(agenda),
                "lines": [_line_row(line) for line in agenda["lines"]],
            }
    raise AgendaNotFound(f"이 회의에 안건 {agenda_id} 가 없습니다")


async def list_tasks(client: httpx.AsyncClient, project_id: str | None = None) -> Any:
    """업무 목록 — `id` · 제목 · 상태 · 기한 · 유형명 · 프로젝트. 응답 그대로.

    `projectId` 를 생략하면 **그 회의의 프로젝트**(무소속 회의면 무소속 업무), `none` 이면 무소속,
    숫자면 그 프로젝트다. 판정은 back 이 한다 — 여기서 기본값을 채우지 않는다.
    """
    params = None if project_id is None else {"projectId": project_id}
    return await _get(client, _MEETING_TASKS, params=params)


async def get_task(client: httpx.AsyncClient, task_id: int) -> Any:
    """업무 상세 — 할일 · 메모 · 연관 · 일정. `GET /api/tasks/{id}` 응답 그대로."""
    return await _get(client, f"/api/tasks/{task_id}")


async def list_work_types(client: httpx.AsyncClient) -> Any:
    """유형 목록 — 이름 · 종류(· 설명). `GET /api/work-types` 응답 그대로.

    **필드를 고르지 않는다** — `work_type.description`(A-12 · MF-21)이 붙는 날 통과 방식이 그대로 싣는다.
    """
    return await _get(client, "/api/work-types")

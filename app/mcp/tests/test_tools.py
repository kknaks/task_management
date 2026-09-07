"""WORK-009 Phase 2 — 도구 7개 ↔ REST 대응(SPEC-007 §4 표 · WP §Internal Interface Contract).

대역 back 은 httpx `MockTransport` 다 — **여기서 진짜 back 을 부르지 않는다.**
고정하는 것 —

- 도구 이름 7개가 글자 그대로다(codex `enabled_tools` 와 같은 문자열)
- 각 도구가 **어느 경로·어느 쿼리**를 부르는가
- `Authorization` 을 **그대로** 넘긴다
- back 의 401 · 404 가 **그대로 드러난다**(빈 배열로 바뀌지 않는다)
- 부르는 HTTP 메서드가 **GET 뿐**이다
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

import tools

BASE = "http://api:8000"
# 실제 원문은 `secrets.token_urlsafe(32)` — ASCII 다(헤더에 그대로 실린다)
TOKEN = "kQ7m-Zx1TbN0pR3sV6yA9cD2fG5hJ8kL1nP4qS7tU0w"


class Recorder:
    """대역 back — 부른 요청을 적고 미리 정한 응답을 돌려준다."""

    def __init__(self, responses: dict[str, Any] | None = None, status: int = 200) -> None:
        self.requests: list[httpx.Request] = []
        self.responses = responses or {}
        self.status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status >= 400:
            return httpx.Response(
                self.status, json={"detail": "거부", "code": "token_expired"}
            )
        return httpx.Response(200, json=self.responses.get(request.url.path, {}))

    @property
    def paths(self) -> list[str]:
        return [request.url.path for request in self.requests]

    @property
    def methods(self) -> list[str]:
        return [request.method for request in self.requests]


def client_for(recorder: Recorder) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=BASE,
        headers={"Authorization": f"Bearer {TOKEN}"},
        transport=httpx.MockTransport(recorder.handler),
    )


def meeting_detail() -> dict[str, Any]:
    """`GET /api/meetings/current` 응답의 필요한 부분만."""
    return {
        "id": 7,
        "title": "제품 소개서 리뷰",
        "agendas": {
            "human": [
                {
                    "id": 11,
                    "track": "human",
                    "title": "개정 대상 섹션 확정",
                    "state": "active",
                    "sourceAgendaId": None,
                    "lines": [
                        {
                            "id": 501,
                            "kind": "decision",
                            "content": "도입 사례는 3건만 유지한다",
                            "detail": None,
                            "taskId": None,
                            "orderIndex": 0,
                        }
                    ],
                }
            ],
            "ai": [
                {
                    "id": 40,
                    "track": "ai",
                    "title": "경쟁사 요금제 비교",
                    "state": None,
                    "sourceAgendaId": 11,
                    "lines": [
                        {
                            "id": 620,
                            "kind": "task",
                            "content": "문구 정리 기한을 당긴다",
                            "detail": "디자인 반영본 일정에 맞춘다",
                            "taskId": 45,
                            "orderIndex": 1,
                        }
                    ],
                }
            ],
            "merged": [],
        },
    }


# --- 이름 ---------------------------------------------------------------


def test_tool_names_are_exactly_the_seven() -> None:
    """`system/README.md` §Components · SPEC-007 §4 표와 **글자 그대로** 같다."""
    assert tools.TOOL_NAMES == (
        "get_meeting",
        "get_account",
        "list_agendas",
        "get_agenda",
        "list_tasks",
        "get_task",
        "list_work_types",
    )


def test_every_tool_name_is_a_callable_in_this_module() -> None:
    for name in tools.TOOL_NAMES:
        assert callable(getattr(tools, name))


# --- 도구 ↔ REST 대응 ------------------------------------------------------


async def test_get_meeting_calls_the_meeting_token_surface() -> None:
    """도구가 회의 id 를 인자로 받지 않는다 — **토큰이 회의를 안다**."""
    recorder = Recorder({"/api/meetings/current": meeting_detail()})
    async with client_for(recorder) as client:
        result = await tools.get_meeting(client)

    assert recorder.paths == ["/api/meetings/current"]
    assert result["id"] == 7


async def test_get_account_calls_the_session_surface() -> None:
    recorder = Recorder({"/api/auth/session": {"account": {"id": 3, "name": "나"}}})
    async with client_for(recorder) as client:
        result = await tools.get_account(client)

    assert recorder.paths == ["/api/auth/session"]
    assert result["account"]["id"] == 3


async def test_list_agendas_gives_human_and_ai_together() -> None:
    """MF-51 — 자기가 앞서 만든 안건을 봐야 또 만들지 않는다."""
    recorder = Recorder({"/api/meetings/current": meeting_detail()})
    async with client_for(recorder) as client:
        rows = await tools.list_agendas(client)

    assert [row["track"] for row in rows] == ["human", "ai"]
    assert rows[0] == {
        "id": 11,
        "title": "개정 대상 섹션 확정",
        "state": "active",
        "track": "human",
        "sourceAgendaId": None,
    }
    assert rows[1]["sourceAgendaId"] == 11


async def test_get_agenda_gives_the_lines_of_that_agenda() -> None:
    recorder = Recorder({"/api/meetings/current": meeting_detail()})
    async with client_for(recorder) as client:
        agenda = await tools.get_agenda(client, 40)

    assert agenda["id"] == 40
    assert agenda["lines"] == [
        {
            "kind": "task",
            "content": "문구 정리 기한을 당긴다",
            "detail": "디자인 반영본 일정에 맞춘다",
            "taskId": 45,
        }
    ]


async def test_get_agenda_of_another_meeting_is_not_invented() -> None:
    """이 회의에 없는 안건이면 **빈 안건을 지어내지 않는다.**"""
    recorder = Recorder({"/api/meetings/current": meeting_detail()})
    async with client_for(recorder) as client:
        with pytest.raises(tools.AgendaNotFound):
            await tools.get_agenda(client, 9999)


async def test_list_tasks_calls_the_meeting_token_surface_not_the_screen_one() -> None:
    """화면용 `GET /api/tasks` 는 기본이 「오늘 하루」라 도구에 맞지 않는다 — 전용 표면을 부른다."""
    recorder = Recorder({"/api/meetings/current/tasks": {"items": []}})
    async with client_for(recorder) as client:
        await tools.list_tasks(client)

    assert recorder.paths == ["/api/meetings/current/tasks"]
    assert recorder.requests[0].url.params.get("projectId") is None


@pytest.mark.parametrize("project_id", ["12", "none"])
async def test_list_tasks_passes_the_project_filter_through(project_id: str) -> None:
    """`none`(무소속)도 그대로 넘긴다 — 판정은 back 이 한다."""
    recorder = Recorder({"/api/meetings/current/tasks": {"items": []}})
    async with client_for(recorder) as client:
        await tools.list_tasks(client, project_id)

    assert recorder.requests[0].url.params["projectId"] == project_id


async def test_get_task_calls_the_detail_surface() -> None:
    recorder = Recorder({"/api/tasks/45": {"id": 45}})
    async with client_for(recorder) as client:
        result = await tools.get_task(client, 45)

    assert recorder.paths == ["/api/tasks/45"]
    assert result["id"] == 45


async def test_list_work_types_passes_the_response_through_untouched() -> None:
    """**필드를 고르지 않는다** — `description` 이 붙는 날 그대로 실린다(A-12 · MF-21)."""
    payload = {
        "items": [
            {"id": 3, "kind": "task", "name": "문서·보고", "colorToken": "steel", "isDefault": True}
        ]
    }
    recorder = Recorder({"/api/work-types": payload})
    async with client_for(recorder) as client:
        result = await tools.list_work_types(client)

    assert recorder.paths == ["/api/work-types"]
    assert result == payload


# --- 헤더 · 메서드 · 실패 ----------------------------------------------------


async def test_the_authorization_header_reaches_the_backend_unchanged() -> None:
    recorder = Recorder({"/api/meetings/current": meeting_detail()})
    async with client_for(recorder) as client:
        await tools.get_meeting(client)

    assert recorder.requests[0].headers["authorization"] == f"Bearer {TOKEN}"


async def test_every_tool_uses_get_only() -> None:
    """**쓰기 도구가 없다**(DEC-003 §8) — 부르는 메서드도 GET 뿐이다."""
    recorder = Recorder(
        {
            "/api/meetings/current": meeting_detail(),
            "/api/auth/session": {"account": {}},
            "/api/meetings/current/tasks": {"items": []},
            "/api/tasks/45": {"id": 45},
            "/api/work-types": {"items": []},
        }
    )
    async with client_for(recorder) as client:
        await tools.get_meeting(client)
        await tools.get_account(client)
        await tools.list_agendas(client)
        await tools.get_agenda(client, 11)
        await tools.list_tasks(client)
        await tools.get_task(client, 45)
        await tools.list_work_types(client)

    assert set(recorder.methods) == {"GET"}


@pytest.mark.parametrize("status", [401, 404])
async def test_backend_rejection_surfaces_instead_of_an_empty_result(status: int) -> None:
    """만료 · 폐기 · 남의 회의가 **도구 결과에 드러난다** — 빈 배열로 대체하지 않는다."""
    recorder = Recorder(status=status)
    async with client_for(recorder) as client:
        with pytest.raises(tools.BackendError) as caught:
            await tools.list_agendas(client)

    assert caught.value.status_code == status
    assert "token_expired" in caught.value.body


# --- 서버 조립 (import 가능성 · 이름 · 헤더 전달) ---------------------------------


def test_server_module_imports_and_registers_the_seven_tools() -> None:
    """`server.py` 가 실제로 import 되고 도구 이름이 계약 그대로다 — 기동에서야 알게 되지 않는다."""
    import asyncio
    import os

    os.environ.setdefault("MCP_BASE_URL", BASE)
    import server

    names = [tool.name for tool in asyncio.run(server.mcp.list_tools())]
    assert names == list(tools.TOOL_NAMES)


def test_server_forwards_the_authorization_header_verbatim() -> None:
    import os

    os.environ.setdefault("MCP_BASE_URL", BASE)
    import server

    class Ctx:
        headers = {"authorization": f"Bearer {TOKEN}", "x-other": "무시"}

    assert server._forwarded_headers(Ctx()) == {"Authorization": f"Bearer {TOKEN}"}


def test_server_sends_no_header_when_the_request_had_none() -> None:
    """**만들어 내지 않는다** — back 의 401 이 그대로 도구 결과가 된다."""
    import os

    os.environ.setdefault("MCP_BASE_URL", BASE)
    import server

    class Ctx:
        headers = None

    assert server._forwarded_headers(Ctx()) == {}

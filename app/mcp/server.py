"""MCP 서버 — codex 가 우리 데이터를 읽는 **유일한 길**(MF-2 · MF-68 · SPEC-007 §4).

**별도 컨테이너다.** FastAPI 안에 두지 않는다 — compose 의 세 서비스 중 하나이고(back · worker · mcp),
흐름은 `worker 의 codex → mcp → back 의 REST` 다. back 을 import 하지 않고 DB 를 모른다.

여기가 하는 일은 셋뿐 —

1. Streamable HTTP 로 도구 7개를 연다(`MCP_PORT` · 경로 `/mcp`)
2. 요청의 `Authorization` **헤더를 그대로** back 으로 넘긴다. 없으면 붙이지 않는다 — back 의 401 이 그대로 온다
3. back 의 응답을 그대로 돌려준다. 401 · 404 도 도구 결과에 드러낸다(빈 배열로 대체하지 않는다)

**권한 판정을 하지 않는다**(MF-4 — 백엔드가 진다). 캐시도 두지 않는다 — 조회하면 그 순간 최신이어야 한다(MF-50).
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError

import tools

# back 의 주소(compose 안에서는 `http://api:8000`). **기본값을 두지 않는다** — 틀린 주소로 조용히 도는 것보다
# 기동 실패가 낫다(WP §Pre-deploy Check 와 같은 규칙).
_BASE_URL_ENV = "MCP_BASE_URL"
_PORT_ENV = "MCP_PORT"
_DEFAULT_PORT = 8010

# 도구 요청 하나의 상한(초). back 은 우리 프로세스 옆이고 전부 조회라 짧게 잡는다
_TIMEOUT_SEC = 30.0

mcp = MCPServer(
    name="tm",
    instructions="task-management 회의록 도구 — 전부 조회. 토큰이 회의를 안다(회의 id 를 인자로 받지 않는다).",
)


def _base_url() -> str:
    base = os.environ.get(_BASE_URL_ENV, "").strip()
    if not base:
        raise RuntimeError(f"{_BASE_URL_ENV} 가 없거나 비어 있습니다 — back 의 주소를 주어야 한다")
    return base.rstrip("/")


def _forwarded_headers(context: Context[Any, Any]) -> dict[str, str]:
    """요청의 `Authorization` 을 **그대로** 넘긴다.

    바꾸지도, 검증하지도, 만들어 내지도 않는다 — 그 판정은 back 의 `require_context` 가 한다.
    헤더가 없으면 아무것도 붙이지 않는다: back 이 `401 token_expired` 를 주고 그것이 도구 결과가 된다.
    """
    headers = context.headers or {}
    authorization = headers.get("authorization") or headers.get("Authorization")
    return {} if authorization is None else {"Authorization": authorization}


def _client(context: Context[Any, Any]) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=_base_url(), headers=_forwarded_headers(context), timeout=_TIMEOUT_SEC
    )


async def _call(context: Context[Any, Any], call: Any, *args: Any) -> Any:
    """도구 하나를 돌리고 **back 의 거부를 그대로 드러낸다**.

    `MCPServer` 는 모르는 예외의 메시지를 「Error executing tool …」로 가린다(내부 노출 방지) —
    그러면 만료 · 폐기 · 남의 회의가 전부 같은 문장이 되어 AI 가 「데이터가 없다」와 「볼 수 없다」를 구별하지 못한다.
    **설계한 실패 둘만** `ToolError` 로 바꿔 통과시킨다. 그 밖의 예외는 손대지 않고 전파한다.
    """
    async with _client(context) as client:
        try:
            return await call(client, *args)
        except (tools.BackendError, tools.AgendaNotFound) as exc:
            raise ToolError(str(exc)) from exc


@mcp.tool(name="get_meeting", description="회의 정보 — 제목 · 일시 · 유형 · 프로젝트. 이 토큰의 회의다")
async def get_meeting(context: Context[Any, Any]) -> Any:
    return await _call(context, tools.get_meeting)


@mcp.tool(name="get_account", description="사용자 정보")
async def get_account(context: Context[Any, Any]) -> Any:
    return await _call(context, tools.get_account)


@mcp.tool(
    name="list_agendas",
    description="안건 목록 — 사람 안건과 AI 안건 둘 다(id · 제목 · state · track · sourceAgendaId)",
)
async def list_agendas(context: Context[Any, Any]) -> Any:
    return await _call(context, tools.list_agendas)


@mcp.tool(
    name="get_agenda",
    description="안건 상세 — 그 안건에 달린 줄(kind · content · detail · taskId)",
)
async def get_agenda(agenda_id: int, context: Context[Any, Any]) -> Any:
    return await _call(context, tools.get_agenda, agenda_id)


@mcp.tool(
    name="list_tasks", description="업무 목록 — id · 제목 · 상태 · 기한 · 유형 · 프로젝트"
)
async def list_tasks(context: Context[Any, Any], project_id: str | None = None) -> Any:
    return await _call(context, tools.list_tasks, project_id)


@mcp.tool(name="get_task", description="업무 상세 — 할일 · 메모 · 연관 · 일정")
async def get_task(task_id: int, context: Context[Any, Any]) -> Any:
    return await _call(context, tools.get_task, task_id)


@mcp.tool(name="list_work_types", description="유형 목록 — 이름 · 종류 · 설명")
async def list_work_types(context: Context[Any, Any]) -> Any:
    return await _call(context, tools.list_work_types)


def app():  # pragma: no cover - 기동 경로
    """uvicorn 진입점. 경로는 `/mcp`(codex 의 `mcp_servers.tm.url` 이 이 주소를 본다)."""
    _base_url()  # 없으면 여기서 죽는다 — 첫 도구 호출까지 미루지 않는다
    return mcp.streamable_http_app(streamable_http_path="/mcp", host="0.0.0.0")


if __name__ == "__main__":  # pragma: no cover - 기동 경로
    import uvicorn

    uvicorn.run(app(), host="0.0.0.0", port=int(os.environ.get(_PORT_ENV, _DEFAULT_PORT)))

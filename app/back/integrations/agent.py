"""open-kknaks(codex) 어댑터 — `AgentClient` **싱글턴** + **codex 실행 옵션 빌더 한 곳**(BE §5-2 · SYS-5).

- LLM 은 open-kknaks 를 통해서만 부른다. Anthropic·OpenAI SDK 를 import 하지 않는다.
- **`build_codex_options()` 밖에서 옵션 dict 를 만들지 않는다.** 웜스타트(새 세션)와 배치·통합(`resume`)이
  다른 옵션으로 나가는 사고를 구조로 막는다(정적 검사 대상).
- 세션은 회의 하나에 하나다(M-12) — `resume={"mode":"session","session_id":…}` 로 이어 쓴다.
- 출력은 `provider_options.output_schema`(`ai_schemas/` 파일 경로)로 강제한다. **그래도 받은 JSON 은
  서비스가 다시 검증한다** — 강제와 검증은 다른 층이다.
- **설계한 실패 둘만 예외 타입으로 낸다** — 워커 오류(`AgentRunFailed`) · 상한 초과(`AgentRunTimeout`).
  그 밖(브로커 도달 불가 · 프로토콜 오류)은 그대로 전파한다(BE §8-1).

테스트는 `install_gateway()` 로 이 경계에서 대역을 끼운다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from open_kknaks import AgentClient, RedisBroker
from open_kknaks.task import TaskStatus

from config import get_settings

_PROVIDER = "codex"
_TERMINAL = frozenset({TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED})


@dataclass(frozen=True)
class AgentRunResult:
    # codex 가 만든/이어 쓴 세션 id. 웜스타트는 이 값을 회의에 저장한다
    session_id: str | None
    # 최종 응답 본문(`output_schema` 를 걸었으면 JSON 문자열)
    output: str


class AgentRunFailed(Exception):
    """워커가 실패·취소로 끝냈다 — DEC-003 §7 「회의 중 배치 실패」의 한 경우."""


class AgentRunTimeout(Exception):
    """상한(배치 120초) 안에 끝나지 않았다 — DEC-003 §7 「회의 중 배치 실패」의 한 경우."""


class AgentGateway(Protocol):
    async def run(
        self,
        *,
        prompt: str,
        session_id: str | None,
        output_schema: Path | None,
        timeout_sec: int,
    ) -> AgentRunResult: ...


def build_codex_options(
    *, session_id: str | None, output_schema: Path | None, timeout_sec: int
) -> tuple[dict[str, object], dict[str, object]]:
    """**codex 실행 옵션을 만드는 유일한 함수**(BE §5-2). `(options, provider_options)` 를 돌려준다.

    `session_id=None` 이면 새 세션(웜스타트), 아니면 그 세션을 `resume` 한다(배치 · WORK-008 최종 배치·통합).
    """
    options: dict[str, object] = {"timeout_sec": timeout_sec}
    if session_id is not None:
        options["resume"] = {"mode": "session", "session_id": session_id}
    provider_options: dict[str, object] = {}
    if output_schema is not None:
        provider_options["output_schema"] = str(output_schema)
    return options, provider_options


class OpenKknaksGateway:
    """브로커 연결은 **첫 제출 때 한 번** 맺는다(BE §5-2)."""

    def __init__(self) -> None:
        self._broker: RedisBroker | None = None
        self._client: AgentClient | None = None

    async def _get_client(self) -> AgentClient:
        if self._client is None:
            settings = get_settings()
            broker = RedisBroker(url=settings.redis_url, namespace=settings.ai_namespace)
            await broker.connect()
            self._broker = broker
            self._client = AgentClient(broker=broker)
        return self._client

    async def run(
        self,
        *,
        prompt: str,
        session_id: str | None,
        output_schema: Path | None,
        timeout_sec: int,
    ) -> AgentRunResult:
        settings = get_settings()
        client = await self._get_client()
        options, provider_options = build_codex_options(
            session_id=session_id, output_schema=output_schema, timeout_sec=timeout_sec
        )
        task_id = await client.submit(
            prompt,
            queue=settings.ai_queue,
            provider=_PROVIDER,
            model=settings.ai_model,
            options=options,
            provider_options=provider_options,
        )
        task = await client.result(task_id, timeout=timeout_sec)
        if task is None:
            # 제출한 작업이 브로커에서 사라졌다 — 설계한 실패가 아니다. 전파한다
            raise RuntimeError(f"open-kknaks task {task_id} 를 찾을 수 없습니다")
        if task.status not in _TERMINAL:
            # 상한 안에 끝나지 않았다. 워커가 계속 돌지 않게 취소를 요청하고 실패로 처리한다
            await client.cancel(task_id)
            raise AgentRunTimeout(f"{timeout_sec}초 안에 끝나지 않았습니다")
        if task.status != TaskStatus.DONE:
            raise AgentRunFailed(task.error or f"worker {task.status}")
        return AgentRunResult(session_id=task.result_session_id, output=task.result or "")


_gateway: AgentGateway | None = None


def get_gateway() -> AgentGateway:
    global _gateway
    if _gateway is None:
        _gateway = OpenKknaksGateway()
    return _gateway


def install_gateway(gateway: AgentGateway | None) -> None:
    """테스트 대역 교체 지점(BE §12)."""
    global _gateway
    _gateway = gateway

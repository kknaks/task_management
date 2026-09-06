"""open-kknaks 대역 — 정상 / 스키마 위반 / 워커 오류 / 타임아웃 / 프로토콜 오류를 스크립트로 낸다(BE §12).

`responses` 에 넣은 항목을 호출 순서대로 소비한다. 비어 있으면 빈 배치(`{"items": []}`)를 돌려준다.
호출 기록(`calls`)으로 「웜스타트가 정확히 1회 새 세션」·「배치의 `resume.session_id`」를 확인한다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from integrations.agent import AgentRunFailed, AgentRunResult, AgentRunTimeout

WARM_SESSION_ID = "codex-session-warm"


@dataclass(frozen=True)
class AgentCall:
    prompt: str
    session_id: str | None
    output_schema: Path | None
    timeout_sec: int


@dataclass
class FakeAgentGateway:
    responses: list[object] = field(default_factory=list)
    calls: list[AgentCall] = field(default_factory=list)
    session_id: str = WARM_SESSION_ID

    async def run(
        self,
        *,
        prompt: str,
        session_id: str | None,
        output_schema: Path | None,
        timeout_sec: int,
    ) -> AgentRunResult:
        self.calls.append(
            AgentCall(
                prompt=prompt,
                session_id=session_id,
                output_schema=output_schema,
                timeout_sec=timeout_sec,
            )
        )
        if not self.responses:
            return AgentRunResult(session_id=self.session_id, output=json.dumps({"items": []}))
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, str):
            return AgentRunResult(session_id=self.session_id, output=item)
        return AgentRunResult(session_id=self.session_id, output=json.dumps(item))

    # --- 시나리오 도우미 ------------------------------------------------------

    def will_fail(self) -> None:
        self.responses.append(AgentRunFailed("대역: 워커 오류"))

    def will_timeout(self) -> None:
        self.responses.append(AgentRunTimeout("대역: 120초 초과"))

    def will_raise(self, exc: BaseException) -> None:
        """정의 밖 예외 — 서비스가 잡지 않고 전파해야 한다."""
        self.responses.append(exc)

    def will_return(self, payload: object) -> None:
        self.responses.append(payload)

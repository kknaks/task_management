"""WORK-009 Phase 3 — codex 실행 옵션 빌더(MF-3 · MF-4 · SPEC-007 §5 「실행 옵션은 한 빌더에서만」).

**문자열과 순서가 계약이다.** WP §Internal Interface Contract 의 `config` 목록을 그대로 비교한다 —
하나라도 다르면 codex 가 에러가 아니라 **조용히 다르게** 돈다(툴 0개 · 내장 도구 열림 · «user cancelled»).

정적 검사(옵션을 만드는 곳이 한 함수)는 `test_meeting_live_static.py` 가 아니라 여기 아래쪽에 있다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from config import get_settings
from integrations.agent import build_codex_options

TOKEN = "kQ7m-Zx1TbN0pR3sV6yA9cD2fG5hJ8kL1nP4qS7tU0w"

BACK_DIR = Path(__file__).resolve().parents[1]


# 단계별 도구(MF-71 · SPEC-007 §4 도구 표 「단계」 열) — **중간 셋 / 최종 일곱**
BATCH_TOOLS = ["list_tasks", "get_task", "list_work_types"]
FINAL_TOOLS = [
    "get_meeting", "get_account", "list_agendas", "get_agenda",
    "list_tasks", "get_task", "list_work_types",
]


def expected_config(tools: list[str]) -> list[str]:
    """WP §Internal Interface Contract 의 목록 — **손으로 적는다**(빌더에서 만들면 검사가 아니다).

    `phase` 로 갈리는 것은 `enabled_tools` 배열과 툴별 approval 줄 수뿐이고 **나머지 줄과 순서는 같다**.
    """
    url = get_settings().mcp_server_url
    enabled = ",".join(f'"{name}"' for name in tools)
    return [
        "features.shell_tool=false",
        'web_search="disabled"',
        "features.image_generation=false",
        "features.apps=false",
        f'mcp_servers.tm.url="{url}"',
        f'mcp_servers.tm.http_headers={{Authorization="Bearer {TOKEN}"}}',
        f"mcp_servers.tm.enabled_tools=[{enabled}]",
        *(f'mcp_servers.tm.tools.{name}.approval_mode="approve"' for name in tools),
    ]


def options_for(phase: str, *, session_id: str | None = None, output_schema=None):  # type: ignore[no-untyped-def]
    return build_codex_options(
        session_id=session_id,
        output_schema=output_schema,
        timeout_sec=120,
        meeting_token=TOKEN,
        phase=phase,  # type: ignore[arg-type]
    )


# --- 단계 둘 (MF-71) ----------------------------------------------------------


def test_the_final_phase_is_the_work009_list_unchanged() -> None:
    """회귀 기준선 — 최종 제출의 `config` 는 WORK-009 의 **14줄과 문자열·순서까지 같다**."""
    _, provider_options = options_for("final")

    assert provider_options["config"] == expected_config(FINAL_TOOLS)
    assert len(provider_options["config"]) == 14


def test_the_batch_phase_opens_only_the_three_task_tools() -> None:
    """**MF-71 의 잠금 축** — 회의 중에는 업무 셋만 열린다. 안건·회의·계정 도구는 문자열에 아예 없다.

    프롬프트로 「부르지 마라」 하는 것이 아니다 — 없는 도구는 부를 수 없다.
    """
    _, provider_options = options_for("batch")
    config = provider_options["config"]

    assert config == expected_config(BATCH_TOOLS)
    assert len(config) == 10  # 내장 4 + url + headers + enabled_tools + approval 3
    joined = "\n".join(config)
    for banned in ("list_agendas", "get_agenda", "get_meeting", "get_account"):
        assert banned not in joined, banned


def test_only_the_tool_lines_differ_between_the_two_phases() -> None:
    """두 단계가 갈리는 자리는 `enabled_tools` 와 approval 줄뿐이다 — 내장 스위치 · url · 헤더는 같다."""
    _, batch = options_for("batch")
    _, final = options_for("final")

    def other_lines(config: list[str]) -> list[str]:
        return [line for line in config if "enabled_tools" not in line and ".approval_mode=" not in line]

    assert other_lines(batch["config"]) == other_lines(final["config"])


def test_the_batch_allow_list_rides_the_resume_too() -> None:
    """`-c` 는 resume 에서도 살아남는다 — 세션을 이어 써도 **매 제출이 자기 단계의 목록**을 가져간다(MF-71)."""
    _, provider_options = options_for("batch", session_id="codex-session-warm")

    assert provider_options["config"] == expected_config(BATCH_TOOLS)


# --- 새 세션(웜스타트) --------------------------------------------------------


def test_new_session_config_is_the_contract_list_in_order() -> None:
    _, provider_options = options_for("final")

    assert provider_options["config"] == expected_config(FINAL_TOOLS)


def test_new_session_locks_the_sandbox_read_only() -> None:
    """`sandbox` 는 **새 세션에만** 실린다 — resume 은 이 값을 물려받는다."""
    options, provider_options = options_for("final")

    assert provider_options["sandbox"] == "read-only"
    assert "resume" not in options


# --- resume(배치 · 최종 · 통합) ------------------------------------------------


def test_resume_keeps_the_same_config() -> None:
    """`config` 는 resume 에서도 살아남는다(`CODEX_RESUME_UNSUPPORTED_OPTIONS` 에 없다)."""
    options, provider_options = options_for(
        "final",
        session_id="codex-session-warm",
        output_schema=BACK_DIR / "ai_schemas" / "meeting_notes.json",
    )

    assert provider_options["config"] == expected_config(FINAL_TOOLS)
    assert options["resume"] == {"mode": "session", "session_id": "codex-session-warm"}
    assert provider_options["output_schema"].endswith("meeting_notes.json")


def test_resume_does_not_carry_sandbox() -> None:
    """open-kknaks 가 resume 에서 버리는 키다 — 실어 보내면 「걸었다」는 착각만 남는다."""
    _, provider_options = options_for("final", session_id="codex-session-warm")

    assert "sandbox" not in provider_options


# --- 함정 둘 ------------------------------------------------------------------


@pytest.mark.parametrize("phase", ["batch", "final"])
@pytest.mark.parametrize("session_id", [None, "codex-session-warm"])
def test_enabled_tools_have_no_server_prefix(session_id: str | None, phase: str) -> None:
    """`tm.foo` ✗ / `foo` ○ — 접두를 붙이면 에러가 아니라 **조용히 툴 0개**다."""
    _, provider_options = options_for(phase, session_id=session_id)
    enabled = next(
        line for line in provider_options["config"] if "enabled_tools" in line
    )

    assert '"tm.' not in enabled


@pytest.mark.parametrize("phase", ["batch", "final"])
@pytest.mark.parametrize("session_id", [None, "codex-session-warm"])
def test_approval_policy_is_never_set(session_id: str | None, phase: str) -> None:
    """`approval_policy="never"` 는 「안 묻고 **실패 처리**」다 — MCP 툴이 «user cancelled» 로 죽는다."""
    options, provider_options = options_for(phase, session_id=session_id)

    assert "approval_policy" not in provider_options
    assert "approval_policy" not in options
    assert all("approval_policy" not in line for line in provider_options["config"])


@pytest.mark.parametrize(("phase", "count"), [("batch", 3), ("final", 7)])
def test_every_tool_has_its_own_approval_mode(phase: str, count: int) -> None:
    """**툴별**이다 — 서버 기본으로 걸면 새 툴이 자동 면제된다. 줄 수는 그 단계의 도구 수와 같다."""
    _, provider_options = options_for(phase)
    approvals = [
        line for line in provider_options["config"] if ".approval_mode=" in line
    ]

    assert len(approvals) == count
    assert all(line.endswith('.approval_mode="approve"') for line in approvals)


def test_the_meeting_token_rides_in_the_header_only() -> None:
    """토큰이 실리는 자리는 `http_headers` 한 줄뿐이다 — 프롬프트·다른 옵션에 없다."""
    options, provider_options = options_for("final")
    carrying = [line for line in provider_options["config"] if TOKEN in line]

    assert carrying == [f'mcp_servers.tm.http_headers={{Authorization="Bearer {TOKEN}"}}']
    assert TOKEN not in str(options)


def test_phase_has_no_default() -> None:
    """**기본값을 두지 않는다** — 새 호출부가 「어느 단계인가」를 반드시 고르게 한다(WP §Internal Interface)."""
    with pytest.raises(TypeError):
        build_codex_options(  # type: ignore[call-arg]
            session_id=None, output_schema=None, timeout_sec=120, meeting_token=TOKEN
        )


# --- 정적 검사: 옵션을 만드는 곳이 한 함수다 --------------------------------------


def _sources() -> list[Path]:
    return [
        path
        for path in BACK_DIR.rglob("*.py")
        if ".venv" not in path.parts and "alembic" not in path.parts
    ]


@pytest.mark.parametrize("needle", ["provider_options", '"config"', "mcp_servers"])
def test_only_the_builder_makes_codex_options(needle: str) -> None:
    """`integrations/agent.py`(빌더) 와 테스트 말고 어디서도 이 문자열을 만들지 않는다(SPEC-007 §5)."""
    allowed = {
        BACK_DIR / "integrations" / "agent.py",
        BACK_DIR / "tests" / "test_agent_options.py",
    }
    offenders = [
        str(path.relative_to(BACK_DIR))
        for path in _sources()
        if path not in allowed and needle in path.read_text(encoding="utf-8")
    ]

    assert offenders == []


def test_the_meeting_token_is_never_logged_or_serialized() -> None:
    """원문이 로그 포맷 문자열·응답 스키마에 없다 — 읽는 경로는 repository 하나다(A-13)."""
    offenders = []
    for path in _sources():
        text = path.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if "meeting_token" not in stripped:
                continue
            if stripped.startswith("#") or stripped.startswith('"""'):
                continue
            if "logger." in stripped or "logging." in stripped:
                offenders.append(f"{path.name}: {stripped}")

    assert offenders == []

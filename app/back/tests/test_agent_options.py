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


def expected_config() -> list[str]:
    """WP §Internal Interface Contract 의 목록 — **손으로 적는다**(빌더에서 만들면 검사가 아니다)."""
    url = get_settings().mcp_server_url
    return [
        "features.shell_tool=false",
        'web_search="disabled"',
        "features.image_generation=false",
        "features.apps=false",
        f'mcp_servers.tm.url="{url}"',
        f'mcp_servers.tm.http_headers={{Authorization="Bearer {TOKEN}"}}',
        'mcp_servers.tm.enabled_tools=["get_meeting","get_account","list_agendas",'
        '"get_agenda","list_tasks","get_task","list_work_types"]',
        'mcp_servers.tm.tools.get_meeting.approval_mode="approve"',
        'mcp_servers.tm.tools.get_account.approval_mode="approve"',
        'mcp_servers.tm.tools.list_agendas.approval_mode="approve"',
        'mcp_servers.tm.tools.get_agenda.approval_mode="approve"',
        'mcp_servers.tm.tools.list_tasks.approval_mode="approve"',
        'mcp_servers.tm.tools.get_task.approval_mode="approve"',
        'mcp_servers.tm.tools.list_work_types.approval_mode="approve"',
    ]


# --- 새 세션(웜스타트) --------------------------------------------------------


def test_new_session_config_is_the_contract_list_in_order() -> None:
    _, provider_options = build_codex_options(
        session_id=None, output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )

    assert provider_options["config"] == expected_config()


def test_new_session_locks_the_sandbox_read_only() -> None:
    """`sandbox` 는 **새 세션에만** 실린다 — resume 은 이 값을 물려받는다."""
    options, provider_options = build_codex_options(
        session_id=None, output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )

    assert provider_options["sandbox"] == "read-only"
    assert "resume" not in options


# --- resume(배치 · 최종 · 통합) ------------------------------------------------


def test_resume_keeps_the_same_config() -> None:
    """`config` 는 resume 에서도 살아남는다(`CODEX_RESUME_UNSUPPORTED_OPTIONS` 에 없다)."""
    options, provider_options = build_codex_options(
        session_id="codex-session-warm",
        output_schema=BACK_DIR / "ai_schemas" / "meeting_batch.json",
        timeout_sec=120,
        meeting_token=TOKEN,
    )

    assert provider_options["config"] == expected_config()
    assert options["resume"] == {"mode": "session", "session_id": "codex-session-warm"}
    assert provider_options["output_schema"].endswith("meeting_batch.json")


def test_resume_does_not_carry_sandbox() -> None:
    """open-kknaks 가 resume 에서 버리는 키다 — 실어 보내면 「걸었다」는 착각만 남는다."""
    _, provider_options = build_codex_options(
        session_id="codex-session-warm", output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )

    assert "sandbox" not in provider_options


# --- 함정 둘 ------------------------------------------------------------------


@pytest.mark.parametrize("session_id", [None, "codex-session-warm"])
def test_enabled_tools_have_no_server_prefix(session_id: str | None) -> None:
    """`tm.foo` ✗ / `foo` ○ — 접두를 붙이면 에러가 아니라 **조용히 툴 0개**다."""
    _, provider_options = build_codex_options(
        session_id=session_id, output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )
    enabled = next(
        line for line in provider_options["config"] if "enabled_tools" in line
    )

    assert '"tm.' not in enabled


@pytest.mark.parametrize("session_id", [None, "codex-session-warm"])
def test_approval_policy_is_never_set(session_id: str | None) -> None:
    """`approval_policy="never"` 는 「안 묻고 **실패 처리**」다 — MCP 툴이 «user cancelled» 로 죽는다."""
    options, provider_options = build_codex_options(
        session_id=session_id, output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )

    assert "approval_policy" not in provider_options
    assert "approval_policy" not in options
    assert all("approval_policy" not in line for line in provider_options["config"])


def test_every_tool_has_its_own_approval_mode() -> None:
    """**툴별**이다 — 서버 기본으로 걸면 새 툴이 자동 면제된다."""
    _, provider_options = build_codex_options(
        session_id=None, output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )
    approvals = [
        line for line in provider_options["config"] if ".approval_mode=" in line
    ]

    assert len(approvals) == 7
    assert all(line.endswith('.approval_mode="approve"') for line in approvals)


def test_the_meeting_token_rides_in_the_header_only() -> None:
    """토큰이 실리는 자리는 `http_headers` 한 줄뿐이다 — 프롬프트·다른 옵션에 없다."""
    options, provider_options = build_codex_options(
        session_id=None, output_schema=None, timeout_sec=120, meeting_token=TOKEN
    )
    carrying = [line for line in provider_options["config"] if TOKEN in line]

    assert carrying == [f'mcp_servers.tm.http_headers={{Authorization="Bearer {TOKEN}"}}']
    assert TOKEN not in str(options)


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

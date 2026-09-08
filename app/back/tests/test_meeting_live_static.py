"""WORK-007 정적 검사 — 키 격리 · 옵션 빌더 단일 · 계층 위반 · 재연결 루프 0 · `except Exception` 0.

WP Phase 1~4 의 「정적 검사」 항목을 grep 이 아니라 테스트로 못박는다 — 다음 work 가 어기면 여기서 잡힌다.
"""

from __future__ import annotations

import re
from pathlib import Path

BACK = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (BACK / path).read_text(encoding="utf-8")


def _files(directory: str) -> list[Path]:
    return sorted((BACK / directory).glob("*.py"))


def test_soniox_key_is_read_only_in_the_adapter() -> None:
    """`SONIOX_API_KEY` 를 읽는 코드는 `integrations/soniox.py` 뿐이다(config 는 env 를 담을 뿐 읽지 않는다)."""
    readers = [
        path
        for path in BACK.rglob("*.py")
        if ".venv" not in path.parts and "tests" not in path.parts
        and "soniox_api_key" in path.read_text(encoding="utf-8")
    ]
    assert sorted(path.relative_to(BACK).as_posix() for path in readers) == [
        "config.py",
        "integrations/soniox.py",
    ]


def test_schemas_and_api_do_not_mention_soniox() -> None:
    """프론트로 새는 길이 없다 — `schemas/`·`api/` 에 `soniox` 문자열 0건."""
    offenders = [
        path.relative_to(BACK).as_posix()
        for path in _files("schemas") + _files("api")
        if "soniox" in path.read_text(encoding="utf-8").lower()
    ]
    assert offenders == []


def test_codex_options_are_built_in_one_function_only() -> None:
    """`resume`·`output_schema` 옵션 dict 를 만드는 코드가 `build_codex_options` 밖에 없다."""
    offenders = []
    for path in BACK.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if re.search(r'"mode":\s*"session"', text) or re.search(r'\["output_schema"\]\s*=', text):
            offenders.append(path.relative_to(BACK).as_posix())
    assert offenders == ["integrations/agent.py"]


def test_service_layer_does_not_import_fastapi_or_schemas() -> None:
    for path in _files("service"):
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"^\s*(from|import)\s+fastapi", text, re.M), path.name
        assert not re.search(r"^\s*from\s+schemas", text, re.M), path.name


def test_repositories_return_no_orm_models() -> None:
    """repository 의 공개 함수 반환 타입에 `models` 클래스가 없다 — dto 만 넘긴다."""
    model_names = set()
    for path in _files("models"):
        model_names.update(re.findall(r"^class\s+(\w+)\(Base", path.read_text(encoding="utf-8"), re.M))
    for path in _files("repository"):
        for name, annotation in re.findall(r"^async def\s+(\w+)\(.*?\)\s*->\s*([^:]+):", path.read_text(encoding="utf-8"), re.M | re.S):
            if name.startswith("_"):
                continue
            leaked = [model for model in model_names if re.search(rf"\b{model}\b", annotation)]
            assert leaked == [], f"{path.name}.{name} -> {annotation}"


def test_stream_and_batch_services_have_no_broad_except_or_reconnect() -> None:
    for name in ("meeting_stream_service.py", "meeting_batch_service.py", "meeting_service.py"):
        text = _read(f"service/{name}")
        assert "except Exception" not in text, name
        assert "except BaseException" not in text, name
    stream = _read("service/meeting_stream_service.py")
    for banned in ("retry", "reconnect", "while True:\n        try:"):
        assert banned not in stream.lower(), banned
    for name in ("integrations/soniox.py", "integrations/agent.py", "integrations/storage.py"):
        text = _read(name)
        assert "except Exception" not in text and "retry" not in text.lower(), name


def test_meeting_detail_has_one_builder_and_one_status_guard() -> None:
    text = _read("service/meeting_service.py")
    assert text.count("async def build_detail(") == 1
    assert text.count("def _assert_allowed(") == 1
    assert "MeetingDetailDTO(" in text and text.count("MeetingDetailDTO(") == 1
    for name in ("meeting_batch_service.py", "meeting_stream_service.py"):
        assert "MeetingDetailDTO(" not in _read(f"service/{name}")
        assert "_ALLOWED" not in _read(f"service/{name}")


def test_no_korean_labels_are_stored_by_the_batch() -> None:
    """G-4 — 배치가 DB 에 넣는 enum 값은 영문이다(`kind`·`track`·`status`)."""
    text = _read("service/meeting_batch_service.py")
    for korean in ("\"논의\"", "\"결정\"", "\"업무\"", "\"액션\"", "\"성공\"", "\"실패\""):
        assert korean not in text


# --- WORK-015 (MF-71) — 중간 배치는 AI 혼자 쓴다 -------------------------------------------


def test_the_batch_prompt_never_names_the_agenda_tools() -> None:
    """회의 중 프롬프트에 `list_agendas` · `get_agenda` 가 **0건**이다(MF-71).

    도구를 안 주는 것이 잠금이고(옵션 빌더 `phase="batch"`), 프롬프트가 없는 도구를 부르라고 적으면 AI 가 헤맨다.
    **웜스타트 프롬프트는 대상이 아니다** — 거기 도구 일곱이 적힌 것은 WORK-010 소관이다(WP §Open Issues 관찰 항목).
    """
    source = _read("service/meeting_batch_service.py")
    instructions = source[source.index("_BATCH_INSTRUCTIONS = "):]
    instructions = instructions[: instructions.index('"""', instructions.index('"""') + 3)]

    for banned in ("list_agendas", "get_agenda", "미러", "조회해라."):
        assert banned not in instructions, banned
    assert "안건은 발화만 보고 네가 가른다" in instructions
    assert "AI 트랙 전체를 다시 정리해라" in instructions


def test_the_mid_meeting_path_never_reads_human_agendas() -> None:
    """회의 중 경로(`_run_once` · `_persist` 의 `ai` 갈래)에 **사람 안건을 읽는 코드가 0건**이다(MF-71 · M-6).

    `_persist` 는 최종(`merged`)과 함께 쓰는 함수라 그 조회가 남아 있지만 **`mirror_human_agendas` 안**이어야 한다 —
    회의 중에는 그 가지로 들어가지 않는다.
    """
    source = _read("service/meeting_batch_service.py")
    run_once = source[source.index("async def _run_once("):source.index("# --- 검증 2단 · 3단")]
    assert "MeetingTrack.HUMAN" not in run_once
    assert "list_agendas_by_track" not in run_once

    persist = source[source.index("async def _persist("):source.index("# --- 웜스타트")]
    body = persist[persist.index('"""', persist.index('"""') + 3):]  # docstring 뒤 코드만
    assert body.count("MeetingTrack.HUMAN.value") == 1
    assert body.index("if mirror_human_agendas:") < body.index("MeetingTrack.HUMAN.value")
    # 미러 갈래 밖에서 `source_agenda_id` 를 채우지 않는다
    assert "source_agenda_id=agenda.human_agenda_id if mirror_human_agendas else None" in persist


"""WORK-008 Phase 1 — **통합 규칙의 구조 검증**(SPEC-008 §4 「통합 규칙」 · DEC-003 OQ-7 · ERD M-8-a). **DB 없이 돈다.**

`validate_and_build()` 에 사람 트리 · AI 트리 · 모델 출력을 주고 — 통과분은 **본문이 원본과 바이트 단위로 같은가**,
실패 5종(사람 줄 누락 · 이중 계승 · AI 중복 참조 · 참조 없음 · `headline` 누락/초과)은 **그 시도 실패**인가를 못박는다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from dto.meeting import MeetingAgendaDTO, MeetingLineDTO
from service import meeting_merge_service
from service.meeting_merge_service import IntegrationAttemptFailed

NOW = datetime(2026, 9, 10, 5, 0, tzinfo=UTC)


def line(id: int, agenda_id: int, track: str, *, content: str, kind: str = "discussion", order_index: int = 0,
         detail: str | None = None, evidence: list | None = None, task_id: int | None = None,
         pending_change: dict | None = None) -> MeetingLineDTO:
    return MeetingLineDTO(
        id=id, track=track, agenda_id=agenda_id, kind=kind, content=content, detail=detail,
        evidence=[] if evidence is None else evidence, order_index=order_index, task_id=task_id,
        pending_change=pending_change, source_human_line_id=None, source_ai_line_id=None, task=None, created_at=NOW,
    )


def agenda(id: int, track: str, *, title: str, order_index: int, state: str | None = None,
           source_agenda_id: int | None = None, lines: list[MeetingLineDTO] | None = None) -> MeetingAgendaDTO:
    return MeetingAgendaDTO(id=id, track=track, title=title, order_index=order_index, state=state,
                            source_agenda_id=source_agenda_id, lines=lines or [])


# 사람: 안건 10(줄 101·102) · 안건 11(줄 103). AI: 미러 20(→10, 줄 201·202) · 신설 21(줄 203)
HUMAN = [
    agenda(10, "human", title="첫째", order_index=0, state="done", lines=[
        line(101, 10, "human", content="사람 줄 A — 개정 범위는 4개 섹션이다", order_index=0),
        line(102, 10, "human", content="사람 줄 B", kind="decision", order_index=1, detail="사람이 쓴 상세",
             task_id=7, pending_change={"dueDate": "2026-09-02"}),
    ]),
    agenda(11, "human", title="둘째", order_index=1, state="next", lines=[
        line(103, 11, "human", content="사람 줄 C", order_index=0),
    ]),
]
AI = [
    agenda(20, "ai", title="첫째", order_index=0, source_agenda_id=10, lines=[
        line(201, 20, "ai", content="AI 가 다듬은 A 문장(다르다)", detail="AI 상세 A", evidence=[{"fromMs": 1000, "toMs": 5000}]),
        line(202, 20, "ai", content="AI 전용 — 후속 미팅은 9/12", kind="action", order_index=1,
             evidence=[{"fromMs": 6000, "toMs": 9000}], task_id=9),
    ]),
    agenda(21, "ai", title="AI 신설 안건", order_index=1, lines=[
        line(203, 21, "ai", content="신설 안건 논의", evidence=[{"fromMs": 10_000, "toMs": 12_000}]),
    ]),
]


def output(*, headline: str = "개정 범위를 확정했다.", agendas: list[dict] | None = None) -> str:
    if agendas is None:
        agendas = [
            {"agendaRef": {"humanAgendaId": 10, "aiAgendaId": None}, "lines": [
                {"sourceHumanLineId": 101, "sourceAiLineId": 201},
                {"sourceHumanLineId": 102, "sourceAiLineId": None},
                {"sourceHumanLineId": None, "sourceAiLineId": 202},
            ]},
            {"agendaRef": {"humanAgendaId": 11, "aiAgendaId": None}, "lines": [
                {"sourceHumanLineId": 103, "sourceAiLineId": None},
            ]},
            {"agendaRef": {"humanAgendaId": None, "aiAgendaId": 21}, "lines": [
                {"sourceHumanLineId": None, "sourceAiLineId": 203},
            ]},
        ]
    return json.dumps({"headline": headline, "agendas": agendas}, ensure_ascii=False)


def build(text: str):  # type: ignore[no-untyped-def]
    return meeting_merge_service.validate_and_build(human_agendas=HUMAN, ai_agendas=AI, output=text)


def test_valid_output_copies_human_text_byte_for_byte_and_only_evidence_from_ai() -> None:
    plan = build(output())

    assert plan.headline == "개정 범위를 확정했다."
    assert [(a.title, a.state, a.source_agenda_id) for a in plan.agendas] == [
        ("첫째", "done", 10), ("둘째", "next", 11), ("AI 신설 안건", None, 21),
    ]
    first = plan.agendas[0].lines
    # 계승 줄 — 본문·종류는 **사람 줄 그대로**(AI 가 다듬은 문장이 아니다), 근거는 AI 줄에서, 빈 상세는 AI 상세로
    assert first[0].content == "사람 줄 A — 개정 범위는 4개 섹션이다"
    assert first[0].content.encode() == HUMAN[0].lines[0].content.encode()
    assert (first[0].kind, first[0].detail, first[0].evidence) == ("discussion", "AI 상세 A", [{"fromMs": 1000, "toMs": 5000}])
    assert (first[0].source_human_line_id, first[0].source_ai_line_id) == (101, 201)
    # 사람 상세가 있으면 그대로 · 업무·pendingChange 도 사람 줄에서 · 짝이 없으면 근거 없음
    assert (first[1].content, first[1].kind, first[1].detail) == ("사람 줄 B", "decision", "사람이 쓴 상세")
    assert (first[1].task_id, first[1].pending_change, first[1].evidence) == (7, {"dueDate": "2026-09-02"}, [])
    assert (first[1].source_human_line_id, first[1].source_ai_line_id) == (102, None)
    # AI 전용 — AI 줄 그대로 추가
    assert (first[2].content, first[2].kind, first[2].task_id) == ("AI 전용 — 후속 미팅은 9/12", "action", 9)
    assert (first[2].source_human_line_id, first[2].source_ai_line_id) == (None, 202)
    assert [l.source_ai_line_id for l in plan.agendas[2].lines] == [203]


def test_headline_is_stripped_and_kept_up_to_200_chars() -> None:
    assert build(output(headline="  요약  ")).headline == "요약"
    assert len(build(output(headline="가" * 200)).headline) == 200


# --- 실패 5종 (WP Done Criteria) ----------------------------------------------------------


def _drop(agendas: list[dict], *, human: int | None = None, ai: int | None = None) -> list[dict]:
    for a in agendas:
        a["lines"] = [l for l in a["lines"] if not (l["sourceHumanLineId"] == human and human is not None)
                      and not (l["sourceAiLineId"] == ai and ai is not None)]
    return agendas


def _agendas() -> list[dict]:
    return json.loads(output())["agendas"]


def test_missing_human_line_fails_the_attempt() -> None:
    with pytest.raises(IntegrationAttemptFailed, match="사람 줄이 빠졌다"):
        build(output(agendas=_drop(_agendas(), human=103)))


def test_double_inheritance_of_a_human_line_fails_the_attempt() -> None:
    agendas = _agendas()
    agendas[0]["lines"].append({"sourceHumanLineId": 102, "sourceAiLineId": None})
    with pytest.raises(IntegrationAttemptFailed, match="두 번 계승"):
        build(output(agendas=agendas))


def test_duplicate_ai_reference_fails_the_attempt() -> None:
    agendas = _agendas()
    agendas[0]["lines"].append({"sourceHumanLineId": None, "sourceAiLineId": 202})
    with pytest.raises(IntegrationAttemptFailed, match="두 줄에 붙었다"):
        build(output(agendas=agendas))


def test_line_without_any_reference_fails_the_attempt() -> None:
    agendas = _agendas()
    agendas[1]["lines"].append({"sourceHumanLineId": None, "sourceAiLineId": None})
    with pytest.raises(IntegrationAttemptFailed, match="두 참조가 모두 없는"):
        build(output(agendas=agendas))


def test_missing_or_overlong_headline_fails_the_attempt() -> None:
    without = json.loads(output())
    del without["headline"]
    with pytest.raises(IntegrationAttemptFailed, match="스키마 위반"):
        build(json.dumps(without))
    with pytest.raises(IntegrationAttemptFailed, match="스키마 위반"):
        build(output(headline="가" * 201))
    with pytest.raises(IntegrationAttemptFailed, match="headline 길이"):
        build(output(headline="   "))
    with pytest.raises(IntegrationAttemptFailed, match="줄바꿈"):
        build(output(headline="한 줄\n두 줄"))


# --- 그 밖의 구조 위반 --------------------------------------------------------------------


def test_model_body_text_has_no_place_in_the_schema() -> None:
    """모델이 본문을 실어 보내면 **스키마 위반**이다 — 본문 필드가 없고 `additionalProperties:false` 다. 읽을 자리 자체가 없다."""
    agendas = _agendas()
    agendas[0]["lines"][0]["content"] = "AI 가 고친 사람 문장"
    with pytest.raises(IntegrationAttemptFailed, match="스키마 위반"):
        build(output(agendas=agendas))


def test_unknown_ids_and_mirror_agenda_reference_fail() -> None:
    agendas = _agendas()
    agendas[0]["lines"][0]["sourceAiLineId"] = 999
    with pytest.raises(IntegrationAttemptFailed, match="AI 줄이 아니다"):
        build(output(agendas=agendas))

    agendas = _agendas()
    agendas[2]["agendaRef"] = {"humanAgendaId": None, "aiAgendaId": 20}  # 미러 안건은 따로 서지 않는다
    agendas[2]["lines"] = []
    with pytest.raises(IntegrationAttemptFailed, match="미러"):
        build(output(agendas=agendas))

    agendas = _agendas()
    agendas[0]["agendaRef"] = {"humanAgendaId": 10, "aiAgendaId": 21}
    with pytest.raises(IntegrationAttemptFailed, match="정확히 하나"):
        build(output(agendas=agendas))


def test_every_human_agenda_exactly_once() -> None:
    agendas = _agendas()
    del agendas[1]
    with pytest.raises(IntegrationAttemptFailed, match="사람 안건이 빠졌다"):
        build(output(agendas=agendas))
    agendas = _agendas()
    agendas.append({"agendaRef": {"humanAgendaId": 11, "aiAgendaId": None}, "lines": []})
    with pytest.raises(IntegrationAttemptFailed, match="두 번 나왔다"):
        build(output(agendas=agendas))


def test_human_line_must_stay_in_its_agenda_and_keep_relative_order() -> None:
    agendas = _agendas()
    moved = agendas[1]["lines"].pop()  # 103 을 첫째 안건으로
    agendas[0]["lines"].append(moved)
    with pytest.raises(IntegrationAttemptFailed, match="자기 안건"):
        build(output(agendas=agendas))

    agendas = _agendas()
    agendas[0]["lines"][0], agendas[0]["lines"][1] = agendas[0]["lines"][1], agendas[0]["lines"][0]
    with pytest.raises(IntegrationAttemptFailed, match="상대 순서"):
        build(output(agendas=agendas))


def test_not_json_is_an_attempt_failure_not_a_crash() -> None:
    with pytest.raises(IntegrationAttemptFailed, match="JSON"):
        build("not json")

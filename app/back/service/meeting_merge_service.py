"""2층 — **통합 규칙의 구조 검증 + `merged` 조립**(SPEC-008 §4 「통합 규칙」 · DEC-003 §4 L105 · OQ-7 · ERD M-8-a).

**순수 함수에 가깝다 — DB 를 모른다.** 입력은 사람 트리 · AI 트리(dto) · 모델 출력(JSON 문자열)이고 출력은 `MergePlanDTO` 다.
적재는 `meeting_finalize_service` 가 한 트랜잭션에서 한다. 그래서 `tests/test_meeting_merge.py` 는 DB 없이 돈다.

**모델을 믿지 않는다 — 구조로 판정한다(임계값 없음).** 모델 출력에서 읽는 필드는 **넷뿐**이다 —
`agendaRef{humanAgendaId, aiAgendaId}` · `sourceHumanLineId` · `sourceAiLineId` · `headline`.
줄의 `content`·`kind`·`detail`·`evidence`·`taskId`·`pendingChange` 는 **원본에서 복사**한다 — 모델이 회의록 문장을 낼 자리가
스키마에 없고(`ai_schemas/meeting_integration.json` 에 본문 필드 없음 · `additionalProperties:false`), 이 파일에도 읽는 코드가 없다.
`headline` 만 모델 문장이다(요약이라 줄 규칙 밖 — DEC-003 §1 표 L46).

검증 **7종**(SPEC-008 §4 표 순서) — 하나라도 어기면 `IntegrationAttemptFailed`(그 시도 실패 · 재시도 대상).

| # | 규칙 | 판정 |
|---|---|---|
| 1 | 사람 줄 우선 — 모든 사람 줄이 **정확히 한 번** | 출력의 `sourceHumanLineId` 집합 = 사람 줄 id 집합 · 중복 없음(이중 계승 금지) |
| 2 | 사람 문장 그대로 | 판정이 아니라 **복사** — 계승 줄의 본문·종류·상세·업무·pendingChange 는 사람 줄에서 |
| 3 | 근거만 가져온다 | `sourceAiLineId` 는 존재하는 AI 줄 · **한 AI 줄은 한 통합 줄에만**(중복 참조 금지) |
| 4 | AI 에만 있는 내용은 추가로 | `sourceAiLineId` 만 있는 줄은 AI 줄을 그대로 복사 |
| 5 | 둘 다 없는 줄은 없다 | 줄마다 두 참조 중 하나 이상(M-8-a CHECK) |
| 6 | 안건 축 | `agendaRef` 는 두 키 중 하나 · 모든 사람 안건이 정확히 한 번 · AI 참조는 **신설 안건**(`source_agenda_id=None`)만 · 중복 없음 · 계승 줄은 **자기 사람 안건** 안에 |
| 7 | 줄 순서 · 한 줄 요약 | 같은 안건의 사람 줄 상대 순서 유지 · `headline` 1~200자 · 줄바꿈 없음 |
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import jsonschema

from dto.meeting import (
    MeetingAgendaDTO,
    MeetingLineDTO,
    MergedAgendaPlanDTO,
    MergedLinePlanDTO,
    MergePlanDTO,
)

# 통합 출력 스키마 — codex `--output-schema` 와 재검증이 **같은 파일**을 본다(BE §5-2)
OUTPUT_SCHEMA = Path(__file__).resolve().parents[1] / "ai_schemas" / "meeting_integration.json"
_validator = jsonschema.Draft202012Validator(json.loads(OUTPUT_SCHEMA.read_text(encoding="utf-8")))

# SPEC-008 §4 Validation — `headline` 1~200자 한 문장 · 줄바꿈 없음
HEADLINE_MAX = 200
_NEWLINES = ("\n", "\r")


class IntegrationAttemptFailed(Exception):
    """통합 시도 하나의 실패 — 스키마 위반 · 구조 검증 실패 · `headline` 누락/초과. **재시도 대상**(DEC-003 §7 L140)."""


@dataclass(frozen=True)
class _Ref:
    """모델 출력에서 읽은 줄 하나 — 참조 id 둘. 그 밖의 필드는 읽지 않는다."""

    human_line_id: int | None
    ai_line_id: int | None


@dataclass(frozen=True)
class _AgendaRef:
    human_agenda_id: int | None
    ai_agenda_id: int | None
    lines: list[_Ref]


def _fail(reason: str) -> IntegrationAttemptFailed:
    return IntegrationAttemptFailed(reason)


def _parse(output: str) -> tuple[str, list[_AgendaRef]]:
    """JSON → 스키마 → **넷만** 읽는다. 여기서 `content` 같은 이름을 읽는 코드가 생기면 정적 검사가 잡는다."""
    try:
        data = json.loads(output)
    except json.JSONDecodeError as exc:
        raise _fail(f"JSON 이 아니다: {exc.msg}") from exc

    error = jsonschema.exceptions.best_match(_validator.iter_errors(data))
    if error is not None:
        raise _fail(f"스키마 위반: {error.message}")

    headline = data["headline"]
    agendas = [
        _AgendaRef(
            human_agenda_id=item["agendaRef"]["humanAgendaId"],
            ai_agenda_id=item["agendaRef"]["aiAgendaId"],
            lines=[
                _Ref(human_line_id=line["sourceHumanLineId"], ai_line_id=line["sourceAiLineId"])
                for line in item["lines"]
            ],
        )
        for item in data["agendas"]
    ]
    return headline, agendas


def _validate_headline(raw: str) -> str:
    """규칙 7 — 1~200자 · 줄바꿈 없음. 공백을 걷어낸 값을 저장한다(빈 문장 금지)."""
    if any(character in raw for character in _NEWLINES):
        raise _fail("headline 에 줄바꿈이 있다")
    headline = raw.strip()
    if not headline or len(headline) > HEADLINE_MAX:
        raise _fail(f"headline 길이가 1~{HEADLINE_MAX}자 밖이다")
    return headline


def validate_and_build(
    *,
    human_agendas: list[MeetingAgendaDTO],
    ai_agendas: list[MeetingAgendaDTO],
    output: str,
) -> MergePlanDTO:
    """검증 7종을 전부 지나야 `MergePlanDTO` 를 돌려준다. 하나라도 어기면 `IntegrationAttemptFailed`.

    `human_agendas`·`ai_agendas` 는 **줄이 안건 안에 중첩된** 트리다(`meeting_service._build_tracks` 와 같은 모양).
    돌려주는 `merged` 안건 순서 — 사람 안건(`order_index` 순 · `state` 복사) → 어느 사람 안건에도 안 붙은 AI 안건(출력 순 · `state=None`).
    """
    raw_headline, refs = _parse(output)
    headline = _validate_headline(raw_headline)

    human_by_id = {agenda.id: agenda for agenda in human_agendas}
    ai_by_id = {agenda.id: agenda for agenda in ai_agendas}
    human_lines = {line.id: line for agenda in human_agendas for line in agenda.lines}
    ai_lines = {line.id: line for agenda in ai_agendas for line in agenda.lines}

    # --- 규칙 6 · 안건 축 ---------------------------------------------------------------
    seen_human_agendas: set[int] = set()
    seen_ai_agendas: set[int] = set()
    placed: dict[int, list[_Ref]] = {}  # 사람 안건 id → 출력 줄
    ai_only: list[tuple[MeetingAgendaDTO, list[_Ref]]] = []
    for index, agenda_ref in enumerate(refs):
        keys = [key for key in (agenda_ref.human_agenda_id, agenda_ref.ai_agenda_id) if key is not None]
        if len(keys) != 1:
            raise _fail(f"agendas[{index}].agendaRef 는 키가 정확히 하나여야 한다")
        if agenda_ref.human_agenda_id is not None:
            human_id = agenda_ref.human_agenda_id
            if human_id not in human_by_id:
                raise _fail(f"agendas[{index}].agendaRef.humanAgendaId={human_id} 가 이 회의의 사람 안건이 아니다")
            if human_id in seen_human_agendas:
                raise _fail(f"사람 안건 {human_id} 이 두 번 나왔다")
            seen_human_agendas.add(human_id)
            placed[human_id] = agenda_ref.lines
        else:
            ai_id = agenda_ref.ai_agenda_id
            assert ai_id is not None
            ai_agenda = ai_by_id.get(ai_id)
            if ai_agenda is None:
                raise _fail(f"agendas[{index}].agendaRef.aiAgendaId={ai_id} 가 이 회의의 AI 안건이 아니다")
            if ai_agenda.source_agenda_id is not None:
                # 미러 안건은 그 사람 안건으로 합쳐진다(M-5-b) — 통합 안건으로 따로 서지 않는다
                raise _fail(f"AI 안건 {ai_id} 은 사람 안건 {ai_agenda.source_agenda_id} 의 미러다 — 그 사람 안건으로 낸다")
            if ai_id in seen_ai_agendas:
                raise _fail(f"AI 안건 {ai_id} 이 두 번 나왔다")
            seen_ai_agendas.add(ai_id)
            ai_only.append((ai_agenda, agenda_ref.lines))
    missing_agendas = set(human_by_id) - seen_human_agendas
    if missing_agendas:
        raise _fail(f"사람 안건이 빠졌다: {sorted(missing_agendas)}")

    # --- 규칙 1 · 3 · 4 · 5 · 7 — 줄 -------------------------------------------------------
    seen_human_lines: set[int] = set()
    seen_ai_lines: set[int] = set()

    def _build_line(ref: _Ref, *, merged_agenda_source: int, is_human_agenda: bool) -> MergedLinePlanDTO:
        if ref.human_line_id is None and ref.ai_line_id is None:
            raise _fail("두 참조가 모두 없는 줄이 있다")  # 규칙 5
        human_line: MeetingLineDTO | None = None
        ai_line: MeetingLineDTO | None = None
        if ref.human_line_id is not None:
            human_line = human_lines.get(ref.human_line_id)
            if human_line is None:
                raise _fail(f"sourceHumanLineId={ref.human_line_id} 가 이 회의의 사람 줄이 아니다")
            if ref.human_line_id in seen_human_lines:
                raise _fail(f"사람 줄 {ref.human_line_id} 이 두 번 계승됐다")  # 규칙 1 이중 계승
            if not is_human_agenda or human_line.agenda_id != merged_agenda_source:
                # 사람 줄은 자기 안건 안에 남는다 — AI 가 사람 회의록의 구조를 옮기지 않는다(M-6 · M-8)
                raise _fail(f"사람 줄 {ref.human_line_id} 이 자기 안건({human_line.agenda_id}) 밖에 놓였다")
            seen_human_lines.add(ref.human_line_id)
        if ref.ai_line_id is not None:
            ai_line = ai_lines.get(ref.ai_line_id)
            if ai_line is None:
                raise _fail(f"sourceAiLineId={ref.ai_line_id} 가 이 회의의 AI 줄이 아니다")
            if ref.ai_line_id in seen_ai_lines:
                raise _fail(f"AI 줄 {ref.ai_line_id} 이 두 줄에 붙었다")  # 규칙 3 중복 참조
            seen_ai_lines.add(ref.ai_line_id)

        if human_line is not None:
            # 규칙 2 · 3 — 사람 문장 그대로 · AI 줄에서는 근거(와 빈 상세)만
            return MergedLinePlanDTO(
                kind=human_line.kind,
                content=human_line.content,
                detail=(
                    human_line.detail
                    if human_line.detail or ai_line is None
                    else ai_line.detail
                ),
                evidence=list(ai_line.evidence) if ai_line is not None else [],
                task_id=human_line.task_id,
                pending_change=human_line.pending_change,
                source_human_line_id=human_line.id,
                source_ai_line_id=None if ai_line is None else ai_line.id,
            )
        assert ai_line is not None
        # 규칙 4 — AI 에만 있는 내용은 AI 줄 그대로
        return MergedLinePlanDTO(
            kind=ai_line.kind,
            content=ai_line.content,
            detail=ai_line.detail,
            evidence=list(ai_line.evidence),
            task_id=ai_line.task_id,
            pending_change=ai_line.pending_change,
            source_human_line_id=None,
            source_ai_line_id=ai_line.id,
        )

    merged: list[MergedAgendaPlanDTO] = []
    for agenda in sorted(human_agendas, key=lambda item: (item.order_index, item.id)):
        lines = [
            _build_line(ref, merged_agenda_source=agenda.id, is_human_agenda=True)
            for ref in placed[agenda.id]
        ]
        # 규칙 7 — 같은 안건 안에서 사람 줄의 상대 순서는 유지된다
        inherited = [line.source_human_line_id for line in lines if line.source_human_line_id is not None]
        expected = sorted(inherited, key=lambda line_id: (human_lines[line_id].order_index, line_id))
        if inherited != expected:
            raise _fail(f"안건 {agenda.id} 에서 사람 줄의 상대 순서가 바뀌었다")
        merged.append(
            MergedAgendaPlanDTO(
                title=agenda.title, state=agenda.state, source_agenda_id=agenda.id, lines=lines
            )
        )
    for ai_agenda, refs_in_agenda in ai_only:
        lines = [
            _build_line(ref, merged_agenda_source=ai_agenda.id, is_human_agenda=False)
            for ref in refs_in_agenda
        ]
        merged.append(
            MergedAgendaPlanDTO(
                title=ai_agenda.title, state=None, source_agenda_id=ai_agenda.id, lines=lines
            )
        )

    # 규칙 1 — 사람 줄 전수
    missing_lines = set(human_lines) - seen_human_lines
    if missing_lines:
        raise _fail(f"사람 줄이 빠졌다: {sorted(missing_lines)}")

    return MergePlanDTO(headline=headline, agendas=merged)

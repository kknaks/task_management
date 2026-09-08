"""2층 — **종료 후 편집**(SPEC-008 §4 · U-7 · DEC-003 §5 L117 · §1 표 L44 · ERD M-20 · M-5-d · M-5-e).

**트랙 규칙과 상태 잠금이 여기 한 곳이다** — `editable_track()`. 라우터·다른 service 는 트랙을 다시 판정하지 않는다.

| 상태 · 통합 결과 | 편집 대상 트랙 |
|---|---|
| `ended` + `succeeded` | `merged` |
| `ended` + `failed` | `human`(사람 원본 — 「다시 생성」이 이 편집본을 우선으로 통합한다) |
| `generating` · 그 밖 | 잠금 — `409 invalid_meeting_status`(허용 표 `line_edit`·`line_write`·`agenda_title` 행) |
| `ai` 트랙 | **어느 표면에서도 거부** — `422 validation_error`(M-6 · M-20) |

줄 표면 — `add_line`(`POST …/lines` 의 `ended` 확장 갈래 · `recording` 은 `meeting_service.add_line` 으로 넘긴다) ·
`update_line`(`content` · `payload` · `task_id` 셋뿐 — **종류 전환이 없다**, MF-60) ·
**`delete_line`(그 행 하나만 하드 삭제 · **자리 유지** — 원본 줄 · `ai` · 트랜스크립트 · 녹음 · 업무를 건드리는 코드가 이 경로에 없다)**.
안건 표면 — `update_agenda`(`ended` 갈래 — 이름만 · `state` 동봉 거부 · `merged`/`human` 안건만).

**`payload` 를 쓰는 표면 둘이 이 파일에 있다**(`add_line` · `update_line` — M-14-a). 둘 다 **업무를 만들거나 바꾸지 않는다** —
이 파일은 `task_service` · `meeting_transcript_repository` · `integrations/` 를 import 하지 않는다(정적 검사 대상).
업무를 건드리는 두 표면(`.../lines/{id}/task`)은 **`meeting_task_link_service`** 다 — 그쪽이 이 파일의
`require_editable_line` · `editable_track` 을 쓴다(그래서 여기서 그쪽을 import 하지 않는다 — 순환 회피).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import NotFoundError, ValidationError
from dto.enums import IntegrationState, LineKind, MeetingStatus, MeetingTrack
from dto.meeting import (
    AgendaUpdateDTO,
    LineCreateDTO,
    LineUpdateDTO,
    MeetingDetailDTO,
    MeetingDTO,
    MeetingLineDTO,
)
from dto.unset import UNSET
from repository import meeting_child_repository, meeting_line_repository, task_repository
from service import meeting_service

# `payload` 가 뜻을 갖는 줄 종류(SPEC-008 §4 「`payload` 자리」 · DB CHECK 와 같은 값)
_PAYLOAD_KINDS = frozenset({LineKind.ACTION.value, LineKind.TASK.value})

_INVALID_INPUT = "입력값을 확인해 주세요"
_NOT_FOUND_LINE = "줄을 찾을 수 없습니다"
_NOT_FOUND_TASK = "업무를 찾을 수 없습니다"

# `ended` 에서만 받는 확장 필드(SPEC-008 §4 `POST …/lines`) — `recording` 에 오면 거부(SPEC-007 규칙 유지)
_ENDED_ONLY_FIELDS = {"detail": "detail", "task_id": "taskId", "payload": "payload"}


def _invalid_input(field: str | None = None) -> ValidationError:
    return ValidationError(_INVALID_INPUT, field=field)


# --- 트랙 규칙 · 상태 잠금 (한 곳) --------------------------------------------------------


def editable_track(meeting: MeetingDTO) -> str:
    """**트랙을 판정하는 유일한 함수.** `ended` 가 아니면 부르지 않는다(허용 표가 먼저 409 를 낸다).

    `succeeded` → `merged` · 그 밖(`failed`) → `human`(M-20 · SPEC-008 §4 Validation 「그 밖이면 `human` 만」).
    """
    if meeting.status != MeetingStatus.ENDED.value:
        raise RuntimeError(f"회의 {meeting.id} 는 ended 가 아니다 — 허용 표를 먼저 지나야 한다")
    if meeting.integration_state == IntegrationState.SUCCEEDED.value:
        return MeetingTrack.MERGED.value
    # 「그 밖(`failed`)이면 `human` 만」(SPEC-008 §4 Validation) — 통합본이 없으면 회의록 탭은 사람 원본이다
    return MeetingTrack.HUMAN.value


async def require_editable_line(
    session: AsyncSession, *, meeting: MeetingDTO, line_id: int
) -> MeetingLineDTO:
    """이 회의의 줄이어야 하고(404) 편집 대상 트랙이어야 한다(422 — `ai` 줄 · 다른 트랙 줄). `meeting_task_link_service` 도 이것을 쓴다."""
    line = await meeting_line_repository.find_line(session, meeting_id=meeting.id, line_id=line_id)
    if line is None:
        raise NotFoundError(_NOT_FOUND_LINE)
    if line.track != editable_track(meeting):
        raise _invalid_input()
    return line


# --- 줄 추가 (`POST …/lines` — 회의 중 · 종료 후 한 표면) ----------------------------------------------


async def add_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, command: LineCreateDTO
) -> MeetingLineDTO:
    """`recording` 이면 확장 필드를 거부하고 `meeting_service.add_line`(SPEC-007) 으로 · `ended` 면 편집 갈래(SPEC-008 U-8~U-10).

    `ended` 갈래 — `agendaId` 는 **편집 대상 트랙** 안건이어야 하고, `taskId` 는 **본인의 삭제되지 않은 업무**여야 한다.
    `payload` 가 어느 종류에 실릴 수 있는지(액션 = 생성분 · 업무 = 변경분 · 논의·결정은 422)는 **스키마가 이미 갈랐다**.

    **업무는 생기지 않는다** — 칩 진입의 「저장」도 줄과 `payload` 를 만들 뿐이다(M-14-a · MF-64 정정).
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_write")

    if meeting.status == MeetingStatus.RECORDING.value:
        for name, field in _ENDED_ONLY_FIELDS.items():
            if getattr(command, name) is not None:
                raise _invalid_input(field)
        return await meeting_service.add_line(
            session, account_id=account_id, meeting_id=meeting_id, command=command
        )

    track = editable_track(meeting)
    agenda = await meeting_child_repository.find_agenda(
        session, meeting_id=meeting_id, agenda_id=command.agenda_id
    )
    if agenda is None or agenda.track != track:
        raise _invalid_input("agendaId")

    task_id: int | None = None
    if command.task_id is not None:
        task = await task_repository.find_active(session, account_id=account_id, task_id=command.task_id)
        if task is None:
            # 남의 것 · 삭제된 것 · 없는 것 — 같은 응답(§9)
            raise NotFoundError(_NOT_FOUND_TASK)
        task_id = task.id

    line_id = await meeting_line_repository.create_line(
        session,
        meeting_id=meeting_id,
        agenda_id=agenda.id,
        track=track,
        kind=command.kind,
        # **본문은 사람이 적은 것이다** — 업무 제목으로 덮어쓰지 않는다(WP §Internal Interface 「줄 본문의 출처」)
        content=command.content,
        order_index=await meeting_line_repository.next_order_index(session, agenda_id=agenda.id),
        detail=command.detail,
        task_id=task_id,
        payload=command.payload,
    )
    (line,) = await meeting_line_repository.find_by_ids(session, line_ids=[line_id])
    return line


# --- 줄 수정 · 삭제 -----------------------------------------------------------------


async def update_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, line_id: int, command: LineUpdateDTO
) -> MeetingDetailDTO:
    """`PATCH …/lines/{id}` — 보낸 필드만. **`kind` 는 오지 않는다**(스키마가 막는다 — MF-60).

    `payload` 의 모양이 그 줄의 종류와 맞아야 한다(액션 줄에 변경분, 업무 줄에 생성분은 `422`) — 본문에 `kind` 가 없어
    스키마가 볼 수 없는 판정이 이것 하나다. `taskId` 는 `task` 줄에만 오고 **본인의 삭제되지 않은 업무**여야 한다(`null` 은 「아직 안 골랐다」).

    **업무는 바뀌지 않는다** — 이 표면은 `task_service` 를 부르지 않는다(M-14-a).
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_edit")
    line = await require_editable_line(session, meeting=meeting, line_id=line_id)

    values: dict[str, object] = {}
    if command.content is not UNSET:
        values["content"] = command.content
    if command.payload is not UNSET:
        if line.kind not in _PAYLOAD_KINDS:
            raise _invalid_input("payload")
        if command.payload is not None and command.payload_kind != line.kind:
            raise _invalid_input("payload")
        values["payload"] = command.payload
    if command.task_id is not UNSET:
        if line.kind != LineKind.TASK.value:
            raise _invalid_input("taskId")
        if command.task_id is not None:
            task = await task_repository.find_active(session, account_id=account_id, task_id=command.task_id)
            if task is None:
                raise NotFoundError(_NOT_FOUND_TASK)
        values["task_id"] = command.task_id
    if values:
        await meeting_line_repository.update_line(
            session, meeting_id=meeting_id, line_id=line_id, values=values
        )
    return await meeting_service.build_detail(session, account_id=account_id, meeting_id=meeting_id)


async def delete_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, line_id: int
) -> None:
    """`DELETE …/lines/{id}` — **그 행 하나만 하드 삭제. 자리는 그대로 둔다**(M-20 · MF-36 · DB §0-1).

    `order_index` 를 당기지 않는다 — 당기면 지울 때마다 뒤 줄을 전부 UPDATE 해야 한다. 화면은 번호순으로 그리고
    새 줄은 「그 안건의 마지막 + 1」이라 구멍이 있어도 상관없다.

    남는 것 — 사람 트랙 원본 줄 · `ai` 트랙 · 트랜스크립트 · 녹음 · **업무**(`task_id` 가 가리키던
    업무와 그 로그·메모). `payload` 는 줄과 함께 사라진다(업무에 반영된 적이 없다). 없는 줄은 404 — 멱등이 아니다.
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_edit")
    line = await require_editable_line(session, meeting=meeting, line_id=line_id)

    await meeting_line_repository.delete_line(session, meeting_id=meeting_id, line_id=line.id)


# --- 안건 이름 (`PATCH …/agendas/{id}` — 세 SPEC 이 공유하는 표면의 `ended` 갈래) ----------------------------


async def update_agenda(
    session: AsyncSession, *, account_id: int, meeting_id: int, agenda_id: int, command: AgendaUpdateDTO
) -> MeetingDetailDTO:
    """`ended` 면 **이름만**(M-5-e ②) — 편집 대상 트랙 안건 · `state` 동봉은 422(종료 후 안건 상태 변경은 없다).
    그 밖의 상태는 `meeting_service.update_agenda`(시작 전 이름 · 회의 중 상태 — SPEC-006 · 007) 그대로.
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    if meeting.status != MeetingStatus.ENDED.value:
        return await meeting_service.update_agenda(
            session, account_id=account_id, meeting_id=meeting_id, agenda_id=agenda_id, command=command
        )

    if command.state is not UNSET:
        raise _invalid_input("state")
    meeting_service.assert_allowed(meeting, "agenda_title")
    if command.title is UNSET:
        raise _invalid_input("title")

    agenda = await meeting_child_repository.find_agenda(
        session, meeting_id=meeting_id, agenda_id=agenda_id
    )
    if agenda is None:
        raise meeting_service.not_found()
    if agenda.track != editable_track(meeting):
        raise _invalid_input()

    await meeting_child_repository.update_agenda(
        session, meeting_id=meeting_id, agenda_id=agenda_id, values={"title": command.title}
    )
    return await meeting_service.build_detail(session, account_id=account_id, meeting_id=meeting_id)

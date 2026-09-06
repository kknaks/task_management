"""2층 — 회의 도메인 규칙. `fastapi` 도 `schemas/` 도 import 하지 않는다.

정본: SPEC-006 §4(API · Validation · **상태별 허용 표** · Case Matrix) · §5(규칙) · `domains/meeting.md` M-1~M-20.

이 파일이 **한 곳**으로 못박는 것 셋(WP Internal Interface Contract) —

1. **`build_detail()` 하나**가 `MeetingDetail` 을 만든다. 상세·생성·PATCH·`/start`·안건·첨부 응답이 전부 여기를 지난다.
   WORK-007·008 은 이 함수에 값을 더한다 — 표면마다 다른 조립을 두지 않는다(WORK-004 F-4 교훈).
2. **`_assert_allowed(meeting, action)`** 이 상태별 허용 표를 표 그대로 갖는다. WORK-007·008 은
   자기 `action` 을 **같은 표에 행으로** 더한다 — 판정 코드를 둘로 두지 않는다.
3. **상태 대입은 전이 함수 안에만** — 이 work 는 `start()` 하나이고, 실제 대입은 그 함수만 부르는
   `meeting_repository.start_recording()` 이다.

겹침 검사·`schedule` 파생은 **`schedule_service` 를 소비만 한다**(SCH-1 · WORK-004 L155).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from core.db import register_after_commit
from core.exceptions import InvalidMeetingStatusError, NotFoundError, ValidationError
from dto.enums import (
    AgendaState,
    AttachmentKind,
    BatchTriggerCause,
    MeetingStatus,
    MeetingTrack,
    WorkTypeKind,
)
from dto.meeting import (
    AgendaCreateDTO,
    AgendaUpdateDTO,
    LineCreateDTO,
    MeetingAgendaDTO,
    MeetingAgendaTracksDTO,
    MeetingAttachmentCreateDTO,
    MeetingCreateDTO,
    MeetingDetailDTO,
    MeetingDTO,
    MeetingLineDTO,
    MeetingListFilterDTO,
    MeetingLineDTO,
    MeetingListResultDTO,
    MeetingUpdateDTO,
    TranscriptDTO,
)
from dto.unset import UNSET
from repository import (
    meeting_child_repository,
    meeting_line_repository,
    meeting_repository,
    meeting_transcript_repository,
    project_repository,
    work_type_repository,
)
from service import meeting_batch_service, schedule_service

# SPEC-006 §4 Case Matrix — 문구까지 계약이다.
_NOT_FOUND = "회의록을 찾을 수 없습니다"
_INVALID_WORK_TYPE = "사용할 수 없는 유형입니다"
_INVALID_PROJECT = "사용할 수 없는 프로젝트입니다"
_INVALID_INPUT = "입력값을 확인해 주세요"
_INVALID_STATUS = "지금 상태에서는 할 수 없습니다"

# SPEC-006 §4 Validation — 길이 **5분 이상 300분 이하**. 300 은 Soniox 스트림 한도(M-18), 5 는 spec 이 정한 하한.
_MIN_MINUTES = 5
_MAX_MINUTES = 300

_ALLOWED_URL_SCHEMES = frozenset({"http", "https"})

# --- 상태별 허용 표 (SPEC-006 §4) — **표 그대로.** 표 밖은 409 `invalid_meeting_status` --------
#
# | 동작            | scheduled | recording | generating | ended |
# |-----------------|-----------|-----------|------------|-------|
# | start           | ✔         | ✗         | ✗          | ✗     |
# | patch_meta      | ✔         | ✗         | ✗          | ✔     |
# | patch_time      | ✔         | ✗         | ✗          | ✔     |
# | agenda_add      | ✔         | ✔         | ✗          | ✗     |
# | agenda_title    | ✔         | ✗         | ✗          | ✔     |
# | agenda_state    | ✗         | ✔         | ✗          | ✗     |  ← WORK-007 이 schema 를 연다
# | agenda_delete   | ✔         | ✗         | ✗          | ✗     |
# | attachment      | ✔         | ✔         | ✗          | ✔     |
# | delete          | ✔         | ✗         | ✗          | ✔     |
# | line_write      | ✗         | ✔         | ✗          | ✗     |  ← WORK-007 (`POST …/lines`). `ended` 편집은 SPEC-008
#
# WORK-008 은 `end` · `integrate` … 를 **이 표에 행으로** 더한다.
_S, _R, _G, _E = (
    MeetingStatus.SCHEDULED.value,
    MeetingStatus.RECORDING.value,
    MeetingStatus.GENERATING.value,
    MeetingStatus.ENDED.value,
)
_ALLOWED: dict[str, frozenset[str]] = {
    "start": frozenset({_S}),
    "patch_meta": frozenset({_S, _E}),
    "patch_time": frozenset({_S, _E}),
    "agenda_add": frozenset({_S, _R}),
    "agenda_title": frozenset({_S, _E}),
    "agenda_state": frozenset({_R}),
    "agenda_delete": frozenset({_S}),
    "attachment": frozenset({_S, _R, _E}),
    "delete": frozenset({_S, _E}),
    "line_write": frozenset({_R}),
}


def _assert_allowed(meeting: MeetingDTO, action: str) -> None:
    """**상태별 허용 판정은 여기 한 곳이다.** 화면이 버튼을 비활성으로 미리 알리지만 판정은 서버가 한다.

    모르는 `action` 은 KeyError 로 그대로 터진다 — 표에 없는 동작을 조용히 통과시키지 않는다(BE §8-1).
    """
    if meeting.status not in _ALLOWED[action]:
        raise InvalidMeetingStatusError(_INVALID_STATUS)


def _not_found() -> NotFoundError:
    """**없는 회의록과 남의 회의록이 같은 응답이다** — 존재를 흘리지 않는다(§5 · §9)."""
    return NotFoundError(_NOT_FOUND)


def _invalid_input(field: str | None = None) -> ValidationError:
    """`field` 는 요청 스키마의 이름(camelCase) — 화면이 어느 칸에 붙일지 고른다(SPEC-006 §4 Case Matrix)."""
    return ValidationError(_INVALID_INPUT, field=field)


# --- 조회 · 빌더 ----------------------------------------------------------


async def _require_meeting(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> MeetingDTO:
    found = await meeting_repository.find_active(
        session, account_id=account_id, meeting_id=meeting_id
    )
    if found is None:
        raise _not_found()
    return found


def duration_minutes(start_at: datetime, end_at: datetime) -> int:
    """`durationMinutes` — **파생**(G-7). 컬럼으로 두지 않는다."""
    return int((end_at - start_at).total_seconds() // 60)


async def build_detail(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> MeetingDetailDTO:
    """**`MeetingDetail` 을 만드는 유일한 곳**(SPEC-006 §5 · WP L165).

    이 work 가 채우는 것 — 메타 · `agendas.human` 트리 · `attachments` · `durationMinutes` · `latestBatchSeq`(배치가 없어 0).
    자리만 두는 것(값은 비어 있다) — `agendas.ai`·`merged` = `[]` · `headline` · `mergedSummary` · `finalBatchState` ·
    `activeJobId` = `null`. **WORK-007·008 이 여기에 값을 더한다.** 별도 조립을 만들지 않는다.

    항상 DB 를 다시 읽는다 — 쓰기 뒤에 불러도 낡은 값을 조립하지 않는다.
    """
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)

    agendas = await meeting_child_repository.list_agendas(session, meeting_id)
    lines = await meeting_child_repository.list_lines(session, meeting_id)
    tracks = _build_tracks(agendas, lines)

    return MeetingDetailDTO(
        meeting=meeting,
        duration_minutes=duration_minutes(meeting.start_at, meeting.end_at),
        # M-19 — 통합(WORK-008)이 채운다. 그전엔 None 이고 여기서는 읽어 실을 뿐이다
        headline=meeting.ai_headline,
        # SPEC-008 이 정의한다 — 통합 전 None
        merged_summary=None,
        agendas=tracks,
        attachments=await meeting_child_repository.list_attachments(session, meeting_id),
        # M-6-a — 성공한 배치의 최대 seq. 시작 전 0
        latest_batch_seq=await meeting_child_repository.max_succeeded_batch_seq(
            session, meeting_id
        ),
        # SPEC-008 — 최종 배치 결과 · 진행 중 job. 이 work 시점엔 둘 다 None
        final_batch_state=None,
        active_job_id=None,
    )


def _build_tracks(
    agendas: list[MeetingAgendaDTO], lines: list[MeetingLineDTO]
) -> MeetingAgendaTracksDTO:
    """트랙별 「안건 > 줄」 트리 — **줄은 안건 안에 중첩**한다(SPEC-006 §4). 세 키가 항상 있다."""
    lines_by_agenda: dict[int, list[MeetingLineDTO]] = {}
    for line in lines:
        lines_by_agenda.setdefault(line.agenda_id, []).append(line)

    by_track: dict[str, list[MeetingAgendaDTO]] = {track.value: [] for track in MeetingTrack}
    for agenda in agendas:
        by_track[agenda.track].append(
            replace(agenda, lines=lines_by_agenda.get(agenda.id, []))
        )

    return MeetingAgendaTracksDTO(
        human=by_track[MeetingTrack.HUMAN.value],
        ai=by_track[MeetingTrack.AI.value],
        merged=by_track[MeetingTrack.MERGED.value],
    )


async def get_detail(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> MeetingDetailDTO:
    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


# --- 검증 ---------------------------------------------------------------


async def _require_usable_meeting_work_type(
    session: AsyncSession, *, account_id: int, work_type_id: int
) -> None:
    """M-2 — **본인의 삭제되지 않은 `kind='meeting'`** 유형이어야 한다. 종류가 `task` 여도 `invalid_work_type` 이다."""
    found = await work_type_repository.find_active(
        session, account_id=account_id, work_type_id=work_type_id
    )
    if found is None or found.kind != WorkTypeKind.MEETING.value:
        raise ValidationError(_INVALID_WORK_TYPE, code="invalid_work_type", field="workTypeId")


async def _require_usable_project(
    session: AsyncSession, *, account_id: int, project_id: int | None
) -> None:
    """보내면 본인의 삭제되지 않은 프로젝트여야 한다. 유형과 코드를 나눈 이유는 화면에 셀렉터가 둘이라서다."""
    if project_id is None:
        return
    found = await project_repository.find_active(
        session, account_id=account_id, project_id=project_id
    )
    if found is None:
        raise ValidationError(_INVALID_PROJECT, code="invalid_project", field="projectId")


def _validate_time(start_at: datetime, end_at: datetime) -> None:
    """M-1 · M-18 — `endAt > startAt`, 길이 5~300분. DB CHECK(`end_at > start_at`)가 최종 방어선이지만 여기서 먼저 422 다."""
    # 둘 다 「일시 칸」이다 — 화면은 `endAt` 을 보고 그 칸에 붙인다
    if end_at <= start_at:
        raise _invalid_input("endAt")
    minutes = (end_at - start_at).total_seconds() / 60
    if minutes < _MIN_MINUTES or minutes > _MAX_MINUTES:
        raise _invalid_input("endAt")


def _validate_attachment(attachment: MeetingAttachmentCreateDTO) -> None:
    """M-17 — `kind` 별로 채워지는 값이 갈린다.

    **`doc` 은 이 work 에서 거부한다** — 대상 `document` 테이블이 아직 없어 가리킬 문서가 존재하지 않는다
    (WORK-006 §Open Issues 의 임시 계약 · WORK-004 와 같다). 문서함 work 가 FK 리비전과 함께 실체화한다.
    """
    if attachment.kind == AttachmentKind.DOC.value:
        raise _invalid_input("kind")

    if attachment.url is None or attachment.document_id is not None:
        raise _invalid_input("url")

    # `http`/`https` 만(SPEC-006 §4 Validation). `ftp://…` 는 거부한다.
    parsed = urlparse(attachment.url)
    if parsed.scheme not in _ALLOWED_URL_SCHEMES or not parsed.netloc:
        raise _invalid_input("url")


# --- 목록 ---------------------------------------------------------------


async def list_meetings(
    session: AsyncSession, *, account_id: int, command: MeetingListFilterDTO
) -> MeetingListResultDTO:
    """`projectCounts` 는 필터 **적용 전** 그 달 전체 · `total` 은 **적용 후**(SPEC-006 §4)."""
    items = await meeting_repository.list_meetings(
        session,
        account_id=account_id,
        period_from=command.period_from,
        period_to=command.period_to,
        project_id=command.project_id,
        unassigned_only=command.unassigned_only,
        sort=command.sort,
    )
    total = await meeting_repository.count_meetings(
        session,
        account_id=account_id,
        period_from=command.period_from,
        period_to=command.period_to,
        project_id=command.project_id,
        unassigned_only=command.unassigned_only,
    )
    project_counts = await meeting_repository.count_by_project(
        session,
        account_id=account_id,
        period_from=command.period_from,
        period_to=command.period_to,
    )
    return MeetingListResultDTO(items=items, total=total, project_counts=project_counts)


# --- 생성 ---------------------------------------------------------------


async def create_meeting(
    session: AsyncSession, *, account_id: int, command: MeetingCreateDTO
) -> MeetingDetailDTO:
    """생성은 **한 트랜잭션**이다 — 안건·첨부·`schedule` 파생이 절반만 남지 않는다(SPEC-006 §5).

    순서: 유형(`kind='meeting'`) → 프로젝트 → 길이 → 첨부 검증 → **겹침 검사** → INSERT + 안건·첨부 → `sync_from_meeting`.
    겹침에 걸리면 `meeting` 행이 생기지 않는다(검사가 원본 쓰기 **앞**에 온다 — BE §7).
    """
    await _require_usable_meeting_work_type(
        session, account_id=account_id, work_type_id=command.work_type_id
    )
    await _require_usable_project(
        session, account_id=account_id, project_id=command.project_id
    )
    _validate_time(command.start_at, command.end_at)
    for attachment in command.attachments:
        _validate_attachment(attachment)

    await schedule_service.check_overlap(
        session,
        account_id=account_id,
        placement=schedule_service.build_meeting_placement(
            command.start_at, command.end_at
        ),
    )

    meeting_id = await meeting_repository.create(
        session,
        account_id=account_id,
        work_type_id=command.work_type_id,
        project_id=command.project_id,
        title=command.title,
        start_at=command.start_at,
        end_at=command.end_at,
    )

    for order_index, agenda in enumerate(command.agendas):
        await meeting_child_repository.create_agenda(
            session,
            meeting_id=meeting_id,
            track=MeetingTrack.HUMAN.value,
            title=agenda.title,
            order_index=order_index,
        )

    for attachment in command.attachments:
        await _create_attachment(session, meeting_id=meeting_id, command=attachment)

    await schedule_service.sync_from_meeting(
        session,
        account_id=account_id,
        meeting_id=meeting_id,
        start_at=command.start_at,
        end_at=command.end_at,
    )

    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


# --- 부분 수정 -----------------------------------------------------------


async def update_meeting(
    session: AsyncSession, *, account_id: int, meeting_id: int, command: MeetingUpdateDTO
) -> MeetingDetailDTO:
    """보낸 필드만 바꾼다(SPEC-006 §4). **일시는 둘을 항상 함께** — 한쪽만 오면 `validation_error`.

    일시가 바뀌면 겹침 검사(자기 옛 행 제외) → 원본 UPDATE → `schedule` 파생, **같은 트랜잭션**이다.
    `PATCH { title }` 은 `schedule` 을 건드리지 않는다.
    """
    current = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)

    meta_sent = (
        command.title is not UNSET
        or command.work_type_id is not UNSET
        or command.project_id is not UNSET
    )
    time_sent = command.start_at is not UNSET or command.end_at is not UNSET
    if time_sent and (command.start_at is UNSET or command.end_at is UNSET):
        raise _invalid_input("endAt" if command.end_at is UNSET else "startAt")

    if meta_sent:
        _assert_allowed(current, "patch_meta")
    if time_sent:
        _assert_allowed(current, "patch_time")

    if command.work_type_id is not UNSET:
        await _require_usable_meeting_work_type(
            session, account_id=account_id, work_type_id=command.work_type_id
        )
    if command.project_id is not UNSET:
        await _require_usable_project(
            session, account_id=account_id, project_id=command.project_id
        )

    values: dict[str, object] = {}
    for name in ("title", "work_type_id", "project_id"):
        value = getattr(command, name)
        if value is not UNSET:
            values[name] = value

    time_changed = False
    if time_sent:
        start_at, end_at = command.start_at, command.end_at
        assert start_at is not UNSET and end_at is not UNSET  # 위에서 걸렀다
        _validate_time(start_at, end_at)
        time_changed = (start_at, end_at) != (current.start_at, current.end_at)
        if time_changed:
            await schedule_service.check_overlap(
                session,
                account_id=account_id,
                placement=schedule_service.build_meeting_placement(start_at, end_at),
                exclude_source_type=schedule_service.MEETING_SOURCE_TYPE,
                exclude_source_id=meeting_id,
            )
            values["start_at"] = start_at
            values["end_at"] = end_at

    if values:
        await meeting_repository.update_fields(
            session, account_id=account_id, meeting_id=meeting_id, values=values
        )
    if time_changed:
        await schedule_service.sync_from_meeting(
            session,
            account_id=account_id,
            meeting_id=meeting_id,
            start_at=values["start_at"],  # type: ignore[arg-type]
            end_at=values["end_at"],  # type: ignore[arg-type]
        )

    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


# --- 전이 · 삭제 ----------------------------------------------------------


async def start(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> MeetingDetailDTO:
    """`scheduled → recording` + **웜스타트**(SPEC-007 §4 · WP Internal Interface Contract `/start` 훅).

    순서 — 전이(`status` + `recording_started_at` 한 UPDATE) → **커밋** → 웜스타트 제출(새 세션 · 결과 무시) →
    `ai_session_id` 저장(새 트랜잭션) → 상세. **codex 대기 중에는 트랜잭션을 열어 두지 않는다**(BE §7) —
    그래서 이 파일에서 `commit()` 을 부르는 자리는 **여기 하나**다(WP L169 「전이 커밋 → 제출 → 새 세션에서 UPDATE」).
    커밋 뒤 같은 `session` 은 새 트랜잭션으로 이어지고, 요청 끝의 `get_db` 커밋이 `ai_session_id` 를 남긴다.

    웜스타트 실패는 DEC-003 §7 목록에 없다 — 전파한다. 전이는 이미 커밋돼 있다(회의는 `recording`).
    `start_at`(예정)을 덮어쓰지 않는다 — 전이 시각은 `recording_started_at`(M-1-a).
    """
    current = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(current, "start")

    await meeting_repository.start_recording(
        session,
        account_id=account_id,
        meeting_id=meeting_id,
        started_at=datetime.now(UTC),
    )
    context = await meeting_batch_service.load_warm_start_context(session, meeting_id=meeting_id)
    await session.commit()

    ai_session_id = await meeting_batch_service.warm_start(context)

    await meeting_repository.set_ai_session_id(
        session, meeting_id=meeting_id, ai_session_id=ai_session_id
    )
    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


async def soft_delete(session: AsyncSession, *, account_id: int, meeting_id: int) -> None:
    """소프트 딜리트 — 목록·상세에서 빠지고 **행·자식·`schedule` 행·녹음 파일은 그대로**(M-13 · §3-3).

    `recording`·`generating` 에서는 거부한다(상태별 허용 표). 복원 경로를 만들지 않는다(DEC-004 §4).
    스토리지 어댑터를 부르지 않는다 — 이 파일은 `integrations/` 를 import 하지 않는다.
    """
    current = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(current, "delete")

    await meeting_repository.soft_delete(
        session, account_id=account_id, meeting_id=meeting_id, deleted_at=datetime.now(UTC)
    )


# --- 안건 ---------------------------------------------------------------


async def add_agenda(
    session: AsyncSession, *, account_id: int, meeting_id: int, command: AgendaCreateDTO
) -> MeetingDetailDTO:
    """`POST …/agendas { title }` — `track='human'` · `orderIndex` = 사람 트랙 마지막 + 1 · `state=null`.

    시작 전(이 spec U-4)과 **회의 중(SPEC-007 U-3 「새 안건」)** 이 같은 표면을 부른다 — 허용 표가 둘을 연다.
    """
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(meeting, "agenda_add")

    order_index = await meeting_child_repository.next_agenda_order_index(
        session, meeting_id=meeting_id, track=MeetingTrack.HUMAN.value
    )
    await meeting_child_repository.create_agenda(
        session,
        meeting_id=meeting_id,
        track=MeetingTrack.HUMAN.value,
        title=command.title,
        order_index=order_index,
    )
    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


async def update_agenda(
    session: AsyncSession,
    *,
    account_id: int,
    meeting_id: int,
    agenda_id: int,
    command: AgendaUpdateDTO,
) -> MeetingDetailDTO:
    """`PATCH …/agendas/{id}` — **보낸 필드만.** `orderIndex` 는 그대로다. `title`·`state` **한 표면**(SPEC-007 §7-A).

    `title` 은 `scheduled`(SPEC-006) · `ended`(SPEC-008 편집)에서, `state` 는 `recording` 에서만(SPEC-007 U-2·U-3).
    `state` 의 뜻(SPEC-007 §4) —
    - `active`: 기존 `active` 를 `next` 로, 대상을 `active` 로(사람 트랙에 **최대 하나** — DB 부분 UNIQUE 가 최종 방어선).
      **커밋 뒤** 안건 전환 배치 트리거를 평가한다(`evaluate('agenda_switch')` — 미처리 80자 미만이면 생략).
    - `done`: 대상이 `active` 였으면 **다음 순서의 `next`** 를 `active` 로. 마지막이면 활성 없음.
    - `next`: 완료 해제 · 활성 해제.
    대상은 **사람 트랙** 안건이어야 한다 — AI 안건이면 404 가 아니라 `validation_error`(SPEC-007 §4).
    """
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)

    values: dict[str, object] = {}
    if command.title is not UNSET:
        _assert_allowed(meeting, "agenda_title")
        values["title"] = command.title
    if command.state is not UNSET:
        _assert_allowed(meeting, "agenda_state")

    agenda = await meeting_child_repository.find_agenda(
        session, meeting_id=meeting_id, agenda_id=agenda_id
    )
    if agenda is None:
        raise _not_found()

    if values:
        await meeting_child_repository.update_agenda(
            session, meeting_id=meeting_id, agenda_id=agenda_id, values=values
        )
    if command.state is not UNSET:
        await _set_agenda_state(session, meeting_id=meeting_id, agenda=agenda, state=command.state)
    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


async def _set_agenda_state(
    session: AsyncSession, *, meeting_id: int, agenda: MeetingAgendaDTO, state: str
) -> None:
    """`active` 최대 하나 · `done` 시 다음 `next` 활성 · 전환 시 배치 트리거(커밋 뒤). **상태 대입은 여기뿐이다.**"""
    if agenda.track != MeetingTrack.HUMAN.value:
        raise _invalid_input("state")

    human = await meeting_child_repository.list_agendas_by_track(
        session, meeting_id, track=MeetingTrack.HUMAN.value
    )
    active = next((item for item in human if item.state == AgendaState.ACTIVE.value), None)

    if state == AgendaState.ACTIVE.value:
        if active is not None and active.id != agenda.id:
            # 기존 활성을 먼저 내려야 부분 UNIQUE 에 걸리지 않는다
            await meeting_child_repository.update_agenda(
                session,
                meeting_id=meeting_id,
                agenda_id=active.id,
                values={"state": AgendaState.NEXT.value},
            )
        await meeting_child_repository.update_agenda(
            session, meeting_id=meeting_id, agenda_id=agenda.id, values={"state": state}
        )
        if active is None or active.id != agenda.id:
            register_after_commit(
                session,
                lambda: _evaluate_switch(meeting_id),
            )
        return

    await meeting_child_repository.update_agenda(
        session, meeting_id=meeting_id, agenda_id=agenda.id, values={"state": state}
    )
    if state == AgendaState.DONE.value and active is not None and active.id == agenda.id:
        following = next(
            (
                item
                for item in human
                if item.order_index > agenda.order_index and item.state == AgendaState.NEXT.value
            ),
            None,
        )
        if following is not None:
            await meeting_child_repository.update_agenda(
                session,
                meeting_id=meeting_id,
                agenda_id=following.id,
                values={"state": AgendaState.ACTIVE.value},
            )
            register_after_commit(session, lambda: _evaluate_switch(meeting_id))


async def _evaluate_switch(meeting_id: int) -> None:
    """커밋 뒤 훅 — 안건 전환 배치 트리거. 판정·실행은 `meeting_batch_service` 가 한다."""
    meeting_batch_service.schedule(meeting_id, BatchTriggerCause.AGENDA_SWITCH.value)


async def remove_agenda(
    session: AsyncSession, *, account_id: int, meeting_id: int, agenda_id: int
) -> None:
    """`DELETE …/agendas/{id}` — **사람 트랙 안건만** · **딸린 줄 0건일 때만**(M-5 · SPEC-006 §4).

    AI 안건은 이 표면으로 지울 수 없다(M-6) — 이 표면에서는 **없는 것**과 같아 404 다.
    **없는 안건을 지우면 404** — 멱등 삭제로 두지 않는다(화면이 낡았다는 사실을 묻지 않는다).
    딸린 줄이 있는 사람 안건은 `scheduled` 에서는 생길 수 없다(줄 쓰기는 `recording` 부터) —
    그래도 M-5 를 코드로 남긴다.
    """
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(meeting, "agenda_delete")

    agenda = await meeting_child_repository.find_agenda(
        session, meeting_id=meeting_id, agenda_id=agenda_id
    )
    if agenda is None or agenda.track != MeetingTrack.HUMAN.value:
        raise _not_found()
    if await meeting_child_repository.count_lines_for_agenda(session, agenda_id=agenda_id):
        raise _invalid_input()

    await meeting_child_repository.delete_agenda(
        session, meeting_id=meeting_id, agenda_id=agenda_id
    )


# --- 줄 · 트랜스크립트 (SPEC-007 §4) ------------------------------------------


async def add_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, command: LineCreateDTO
) -> MeetingLineDTO:
    """`POST …/lines` — `status='recording'` 에서 사람 줄 하나(SPEC-007 U-3).

    `agendaId` 는 **이 회의의 사람 트랙** 안건이어야 한다 — AI 안건·없는 안건은 `validation_error`(본문 필드 참조).
    `detail`·`evidence`·`task_id`·`pending_change` 는 **항상 비어** 저장된다(M-14 — 값이 차는 것은 종료 후 편집·통합).
    `order_index` 는 그 안건 안의 마지막 + 1.
    """
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(meeting, "line_write")

    agenda = await meeting_child_repository.find_agenda(
        session, meeting_id=meeting_id, agenda_id=command.agenda_id
    )
    if agenda is None or agenda.track != MeetingTrack.HUMAN.value:
        raise _invalid_input("agendaId")

    line_id = await meeting_line_repository.create_line(
        session,
        meeting_id=meeting_id,
        agenda_id=agenda.id,
        track=MeetingTrack.HUMAN.value,
        kind=command.kind,
        content=command.content,
        order_index=await meeting_line_repository.next_order_index(session, agenda_id=agenda.id),
    )
    (line,) = await meeting_line_repository.find_by_ids(session, line_ids=[line_id])
    return line


async def get_transcript(
    session: AsyncSession, *, account_id: int, meeting_id: int
) -> TranscriptDTO:
    """`GET …/transcript` — 확정 블록 전량(`at_ms` 순) + 화자 수 + 기준점. 상태 제한 없음(SPEC-008 근거 칩도 읽는다)."""
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    return TranscriptDTO(
        recording_started_at=meeting.recording_started_at,
        speaker_count=await meeting_transcript_repository.count_speakers(session, meeting_id),
        items=await meeting_transcript_repository.list_blocks(session, meeting_id),
    )


# --- 첨부 ---------------------------------------------------------------


async def add_attachment(
    session: AsyncSession,
    *,
    account_id: int,
    meeting_id: int,
    command: MeetingAttachmentCreateDTO,
) -> MeetingDetailDTO:
    """`POST …/attachments` — `generating` 외 전부 허용. 응답은 `MeetingDetail` 전체(201)."""
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(meeting, "attachment")
    _validate_attachment(command)

    await _create_attachment(session, meeting_id=meeting_id, command=command)
    return await build_detail(session, account_id=account_id, meeting_id=meeting_id)


async def _create_attachment(
    session: AsyncSession, *, meeting_id: int, command: MeetingAttachmentCreateDTO
) -> None:
    """생성 요청과 단건 추가가 **같은 쓰기**를 지난다.

    같은 `documentId` 재첨부는 **행을 늘리지 않는다**(SPEC-006 §4) — `doc` 이 열리는 날 그대로 산다.
    링크는 URL 중복을 막지 않는다(정책에 없다).
    """
    if command.document_id is not None:
        existing = await meeting_child_repository.find_attachment_by_document(
            session, meeting_id=meeting_id, document_id=command.document_id
        )
        if existing is not None:
            return

    await meeting_child_repository.create_attachment(
        session,
        meeting_id=meeting_id,
        kind=command.kind,
        document_id=command.document_id,
        url=command.url,
        label=command.label,
    )


async def remove_attachment(
    session: AsyncSession, *, account_id: int, meeting_id: int, attachment_id: int
) -> None:
    """첨부 행만 지운다 — **문서·링크 원본은 지우지 않는다.** 없는 첨부는 404."""
    meeting = await _require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    _assert_allowed(meeting, "attachment")

    if (
        await meeting_child_repository.find_attachment(
            session, meeting_id=meeting_id, attachment_id=attachment_id
        )
        is None
    ):
        raise _not_found()

    await meeting_child_repository.delete_attachment(
        session, meeting_id=meeting_id, attachment_id=attachment_id
    )

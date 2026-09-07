"""1층 — HTTP 만. SPEC-006 §4 API Contract 의 **11 표면**.

**라우터 단위**로 `require_account` 를 건다 — 개별 함수에서 빠뜨릴 여지를 없앤다(§9).

**SPEC-007(WORK-007) 이 더한 표면** — `POST …/lines`(201 `LineItem`) · `PATCH …/agendas/{id}` 의 `state` ·
`GET …/transcript`. `WS …/stream` 만 WS 전용 `meeting_stream_router` 다.
**SPEC-008(WORK-008) 이 더한 표면** — `POST …/end`·`POST …/finalize`(202 + jobId) · `PATCH`·`DELETE …/lines/{id}` ·
`POST …/lines` 의 `ended` 확장 갈래 · `PATCH …/agendas/{id} {title}` 의 `ended` 갈래. 줄·안건 쓰기는 **`meeting_edit_service`** 가 앞문이고
(트랙 규칙 · 상태 잠금 한 곳) 회의 중·시작 전 갈래는 거기서 `meeting_service` 로 넘긴다 — 라우터는 상태를 보지 않는다.
`.../lines/{id}/task` 둘(업무 생성 · 업무 갱신)은 **`meeting_task_link_service`** — 줄과 업무를 한 트랜잭션으로 묶는 입구이고 판정은 `task_service` 다.
**WORK-013 이 바꾼 것** — `PATCH …/lines/{id}/task` 가 **본문(`TaskUpdateBody`)을 받는다**(줄의 저장값이 요청이 아니다 · MF-59) ·
`PATCH …/lines/{id}` 는 `kind` 를 받지 않고 `payload`·`taskId` 를 받는다(MF-60 · MF-64 정정).

**`PATCH /api/schedules` 는 없다** — 파생은 단방향이라 원본(`PATCH /api/meetings/{id}`)을 고친다(BE-10).
쓰기 응답은 **전부 `MeetingDetail`**(같은 빌더) · 삭제만 204.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account, require_context
from core.exceptions import NotFoundError
from dto.auth import AccountContextDTO
from dto.enums import MeetingSort
from dto.meeting import MeetingListFilterDTO, MeetingTaskFilterDTO
from schemas.job import JobAccepted
from schemas.meeting import (
    AgendaCreate,
    AgendaUpdate,
    LineCreate,
    LineItem,
    LineNewTask,
    LineUpdate,
    MeetingAttachmentCreate,
    MeetingCreate,
    MeetingDetail,
    MeetingListResponse,
    MeetingTaskListResponse,
    MeetingUpdate,
    TaskUpdateBody,
    TranscriptResponse,
)
from service import meeting_edit_service, meeting_finalize_service, meeting_service, meeting_task_link_service

router = APIRouter(
    prefix="/api/meetings",
    tags=["meeting"],
    dependencies=[Depends(require_account)],
)

# `projectId` 는 숫자 또는 **`none`**(무소속 「미정」 칩). 그 밖은 FastAPI 가 422 로 거른다.
_PROJECT_ID_PATTERN = r"^(none|[0-9]+)$"
_UNASSIGNED = "none"


# --- 본체 ---------------------------------------------------------------


@router.get("", response_model=MeetingListResponse, response_model_by_alias=True)
async def list_meetings(
    # §3 규칙 7 — 쿼리 alias 를 **손으로** 적는다. 빠뜨리면 필터가 조용히 무시되고 200 이 난다(WORK-004 에서 밟았다)
    period_from: AwareDatetime = Query(alias="from"),
    period_to: AwareDatetime = Query(alias="to"),
    project_id: str | None = Query(
        default=None, alias="projectId", pattern=_PROJECT_ID_PATTERN
    ),
    sort: MeetingSort = Query(default=MeetingSort.LATEST, alias="sort"),
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingListResponse:
    """월 범위 목록 + 프로젝트별 집계(§4). `from`·`to` 는 **UTC ISO** 경계 `[from, to)`, `startAt` 기준.

    페이지네이션이 없다 — 한 달치 개인 회의록이라 상한을 두지 않는다.
    """
    return MeetingListResponse.from_dto(
        await meeting_service.list_meetings(
            session,
            account_id=account_id,
            command=MeetingListFilterDTO(
                period_from=period_from,
                period_to=period_to,
                project_id=(
                    None
                    if project_id is None or project_id == _UNASSIGNED
                    else int(project_id)
                ),
                unassigned_only=project_id == _UNASSIGNED,
                sort=sort.value,
            ),
        )
    )


@router.post(
    "",
    response_model=MeetingDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_meeting(
    body: MeetingCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """생성은 **한 요청·한 트랜잭션**이다 — 안건·첨부·`schedule` 파생이 절반만 남지 않는다(§5)."""
    return MeetingDetail.from_dto(
        await meeting_service.create_meeting(
            session, account_id=account_id, command=body.to_dto()
        )
    )


# **선언 순서가 계약이다** — 아래 `GET /{meeting_id}` 의 `meeting_id` 는 `int` 라, 이 라우트를 뒤에 두면
# `current` 를 id 로 파싱하려다 422 가 난다(`task_router` 의 `/relations/candidates` 와 같은 선례).


@router.get("/current", response_model=MeetingDetail, response_model_by_alias=True)
async def get_current_meeting(
    context: AccountContextDTO = Depends(require_context),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """**회의 토큰 전용 표면**(WORK-009 · WP §Internal Interface). MCP `get_meeting` 이 부른다.

    도구는 회의 id 를 인자로 받지 않는다 — **토큰이 회의를 안다.** 그래서 back 이 `ctx.meeting_id` 로 채운다.
    사용자 세션 JWT 로 부르면 **404** 다(그쪽은 `GET /{meeting_id}` 를 쓴다). 응답은 `GET /{meeting_id}` 와 같은 `MeetingDetail`.
    """
    if context.meeting_id is None:
        raise NotFoundError("없는 회의록입니다")
    return MeetingDetail.from_dto(
        await meeting_service.get_detail(
            session, account_id=context.account_id, meeting_id=context.meeting_id
        )
    )


@router.get(
    "/current/tasks",
    response_model=MeetingTaskListResponse,
    response_model_by_alias=True,
)
async def list_current_meeting_tasks(
    project_id: str | None = Query(
        default=None, alias="projectId", pattern=_PROJECT_ID_PATTERN
    ),
    context: AccountContextDTO = Depends(require_context),
    session: AsyncSession = Depends(get_db),
) -> MeetingTaskListResponse:
    """**회의 토큰 전용 표면.** MCP `list_tasks(projectId?)` 가 부른다(코디 지시 · WORK-009).

    화면의 `GET /api/tasks` 를 쓰지 않는다 — 그쪽은 기본이 「오늘 하루」이고 `projectId` 가 숫자뿐이라
    **화면 계약**이다. 여기는 기간이 없고 `none`(무소속)을 물을 수 있으며, 응답은 SPEC-007 §4 도구 표의 필드다.
    목록을 만드는 곳은 **사후 검사(M-15)의 화이트리스트와 같은 repository 함수** 하나다.

    사용자 세션 JWT 로 부르면 404 다(`/current` 와 같은 결).
    """
    if context.meeting_id is None:
        raise NotFoundError("없는 회의록입니다")
    return MeetingTaskListResponse.from_dtos(
        await meeting_service.list_meeting_tasks(
            session,
            account_id=context.account_id,
            meeting_id=context.meeting_id,
            # `none` 을 푸는 자리는 여기다 — 위 `list_meetings` 와 같은 규약(§3 규칙 7)
            command=MeetingTaskFilterDTO(
                project_id=(
                    None
                    if project_id is None or project_id == _UNASSIGNED
                    else int(project_id)
                ),
                unassigned_only=project_id == _UNASSIGNED,
            ),
        )
    )


@router.get("/{meeting_id}", response_model=MeetingDetail, response_model_by_alias=True)
async def get_meeting(
    meeting_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    return MeetingDetail.from_dto(
        await meeting_service.get_detail(
            session, account_id=account_id, meeting_id=meeting_id
        )
    )


@router.patch("/{meeting_id}", response_model=MeetingDetail, response_model_by_alias=True)
async def update_meeting(
    meeting_id: int,
    body: MeetingUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """**캘린더 드래그·상세 드로어의 유일한 쓰기 표면.** 일시가 바뀌면 겹침 검사를 지나 `schedule` 이 파생된다."""
    return MeetingDetail.from_dto(
        await meeting_service.update_meeting(
            session, account_id=account_id, meeting_id=meeting_id, command=body.to_dto()
        )
    )


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """소프트 딜리트 — 목록에서 빠지고 **행·자식·녹음 파일은 그대로**(M-13). 복원 경로는 없다."""
    await meeting_service.soft_delete(
        session, account_id=account_id, meeting_id=meeting_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 상태 전이 ---------------------------------------------------------------
#
# **전이는 전용 엔드포인트다.** `PATCH` 에 `status` 를 실으면 스키마 층에서 422 다(BE §10).
# `/end` 는 SPEC-007 이 **이 자리 아래에** 더한다(202 + jobId).


@router.post(
    "/{meeting_id}/start", response_model=MeetingDetail, response_model_by_alias=True
)
async def start_meeting(
    meeting_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """`scheduled → recording` — **상태 전이만.** 본문 없음. WS·마이크·웜스타트는 이 응답 뒤 SPEC-007 순서다."""
    return MeetingDetail.from_dto(
        await meeting_service.start(session, account_id=account_id, meeting_id=meeting_id)
    )


@router.post(
    "/{meeting_id}/end",
    response_model=JobAccepted,
    response_model_by_alias=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def end_meeting(
    meeting_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> JobAccepted:
    """`recording → generating` + job(BE §6). **202 — 응답을 기다리는 동안 작업이 도는 구조가 아니다.** 사전 조건은 `recording` 하나(스트림 무관)."""
    return JobAccepted(
        job_id=await meeting_finalize_service.end(
            session, account_id=account_id, meeting_id=meeting_id
        )
    )


@router.post(
    "/{meeting_id}/finalize",
    response_model=JobAccepted,
    response_model_by_alias=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def finalize_meeting(
    meeting_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> JobAccepted:
    """「다시 시도」 — `ended`+`failed` 에서만(표 밖은 409). **①부터** 다시 돈다(MF-58) — 「② 만」이 없다."""
    return JobAccepted(
        job_id=await meeting_finalize_service.finalize(
            session, account_id=account_id, meeting_id=meeting_id
        )
    )


# --- 안건 ---------------------------------------------------------------
#
# **세 SPEC 이 공유하는 표면이다** — 시작 전(이 spec) · 회의 중 「새 안건」(SPEC-007) · 종료 후 제목 수정(SPEC-008).
# 상태별 허용은 service 의 표 하나가 판정한다.


@router.post(
    "/{meeting_id}/agendas",
    response_model=MeetingDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_agenda(
    meeting_id: int,
    body: AgendaCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """사람 트랙 · `orderIndex` = 마지막 + 1 · `state=null`. 응답은 **`MeetingDetail` 전체**."""
    return MeetingDetail.from_dto(
        await meeting_service.add_agenda(
            session, account_id=account_id, meeting_id=meeting_id, command=body.to_dto()
        )
    )


@router.patch(
    "/{meeting_id}/agendas/{agenda_id}",
    response_model=MeetingDetail,
    response_model_by_alias=True,
)
async def update_agenda(
    meeting_id: int,
    agenda_id: int,
    body: AgendaUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """**보낸 필드만** — `title`(시작 전·종료 후) · `state`(회의 중 `active`·`done`·`next`). 응답은 `MeetingDetail` 전체.

    앞문은 `meeting_edit_service` — `ended` 면 이름만(편집 대상 트랙 · `state` 동봉 422), 그 밖은 `meeting_service` 로 넘긴다.
    """
    return MeetingDetail.from_dto(
        await meeting_edit_service.update_agenda(
            session,
            account_id=account_id,
            meeting_id=meeting_id,
            agenda_id=agenda_id,
            command=body.to_dto(),
        )
    )


@router.delete(
    "/{meeting_id}/agendas/{agenda_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_agenda(
    meeting_id: int,
    agenda_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """사람 트랙 · 딸린 줄 0건일 때만. **없는 안건은 404** — 멱등 삭제가 아니다."""
    await meeting_service.remove_agenda(
        session, account_id=account_id, meeting_id=meeting_id, agenda_id=agenda_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 줄 · 트랜스크립트 (SPEC-007 §4) ------------------------------------------


@router.post(
    "/{meeting_id}/lines",
    response_model=LineItem,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_line(
    meeting_id: int,
    body: LineCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> LineItem:
    """사람 줄 하나 — 회의 중(SPEC-007)과 종료 후 편집(SPEC-008 확장 갈래)이 한 표면. 응답은 **`LineItem`**(코디 판정 — 줄은 초 단위로 쌓인다)."""
    return LineItem.from_dto(
        await meeting_edit_service.add_line(
            session, account_id=account_id, meeting_id=meeting_id, command=body.to_dto()
        )
    )


@router.patch(
    "/{meeting_id}/lines/{line_id}",
    response_model=MeetingDetail,
    response_model_by_alias=True,
)
async def update_line(
    meeting_id: int,
    line_id: int,
    body: LineUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """인라인 수정 · 드로어 「저장」(SPEC-008 U-7 · U-9 · U-10). `ended` 에서 편집 대상 트랙의 줄만. 응답은 `MeetingDetail` 전체.

    **`kind` 를 받지 않는다**(MF-60) · **업무는 바뀌지 않는다** — 줄의 `content`·`payload`·`task_id` 만 쓴다.
    """
    return MeetingDetail.from_dto(
        await meeting_edit_service.update_line(
            session,
            account_id=account_id,
            meeting_id=meeting_id,
            line_id=line_id,
            command=body.to_dto(),
        )
    )


@router.delete("/{meeting_id}/lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_line(
    meeting_id: int,
    line_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """「제거」(SPEC-008 U-7 · M-20) — 회의록 탭이 그리는 트랙의 행 하나만 **하드 삭제**. 원본·AI·트랜스크립트·녹음·업무는 그대로. 없는 줄은 404."""
    await meeting_edit_service.delete_line(
        session, account_id=account_id, meeting_id=meeting_id, line_id=line_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 업무 연동 (SPEC-008 §4 · U-6 · U-10 — 완료 게이트의 네 번째 진입점, WORK-005 L294) ------------------------


@router.post(
    "/{meeting_id}/lines/{line_id}/task",
    response_model=MeetingDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_task_from_line(
    meeting_id: int,
    line_id: int,
    body: LineNewTask,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """액션 줄 → 업무 생성(U-10 액션 줄 진입). 업무는 `POST /api/tasks` 규칙 그대로 만들어지고 같은 트랜잭션에서 줄이 업무 줄이 된다."""
    return MeetingDetail.from_dto(
        await meeting_task_link_service.create_task_from_line(
            session, account_id=account_id, meeting_id=meeting_id, line_id=line_id, command=body.to_dto()
        )
    )


@router.patch(
    "/{meeting_id}/lines/{line_id}/task",
    response_model=MeetingDetail,
    response_model_by_alias=True,
)
async def apply_line_task_change(
    meeting_id: int,
    line_id: int,
    body: TaskUpdateBody,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """업무 줄 → 「업무 갱신」(U-6 · U-9 「넣기」).

    **본문이 요청이다** — `taskId`(헤더 셀렉터의 업무) 필수 + 변경분 0~7. 줄에 저장된 `payload` 를 서버가 그대로 쓰지 않는다
    (사람이 드로어에서 고쳤을 수 있다 — MF-59). 거부되면 ①~⑧ 이 전부 롤백되고 `payload` 가 남는다.
    """
    return MeetingDetail.from_dto(
        await meeting_task_link_service.apply_task_update(
            session, account_id=account_id, meeting_id=meeting_id, line_id=line_id, command=body.to_dto()
        )
    )


@router.get(
    "/{meeting_id}/transcript",
    response_model=TranscriptResponse,
    response_model_by_alias=True,
)
async def get_transcript(
    meeting_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TranscriptResponse:
    """확정 발화 블록 전량(`atMs` 순) + `speakerCount` + `recordingStartedAt`. 상태 제한 없음 — SPEC-008 근거 칩도 읽는다."""
    return TranscriptResponse.from_dto(
        await meeting_service.get_transcript(
            session, account_id=account_id, meeting_id=meeting_id
        )
    )


# --- 첨부 ---------------------------------------------------------------


@router.post(
    "/{meeting_id}/attachments",
    response_model=MeetingDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_attachment(
    meeting_id: int,
    body: MeetingAttachmentCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> MeetingDetail:
    """`doc` 은 문서함 전까지 422(§Open Issues 임시 계약). 같은 `documentId` 재첨부는 201 + 행 유지."""
    return MeetingDetail.from_dto(
        await meeting_service.add_attachment(
            session, account_id=account_id, meeting_id=meeting_id, command=body.to_dto()
        )
    )


@router.delete(
    "/{meeting_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_attachment(
    meeting_id: int,
    attachment_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """첨부 행만 지운다 — 문서·링크 원본은 그대로."""
    await meeting_service.remove_attachment(
        session,
        account_id=account_id,
        meeting_id=meeting_id,
        attachment_id=attachment_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

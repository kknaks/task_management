"""1층 — HTTP 만. SPEC-006 §4 API Contract 의 **11 표면**.

**라우터 단위**로 `require_account` 를 건다 — 개별 함수에서 빠뜨릴 여지를 없앤다(§9).

**SPEC-007(WORK-007) 이 더한 표면** — `POST …/lines`(201 `LineItem`) · `PATCH …/agendas/{id}` 의 `state` ·
`GET …/transcript`. `WS …/stream` 만 WS 전용 `meeting_stream_router` 다.
**여기 없는 회의 표면** — `POST …/end`(202 + jobId) · `DELETE …/lines/{id}` — 는 SPEC-008 이 더한다.

**`PATCH /api/schedules` 는 없다** — 파생은 단방향이라 원본(`PATCH /api/meetings/{id}`)을 고친다(BE-10).
쓰기 응답은 **전부 `MeetingDetail`**(같은 빌더) · 삭제만 204.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account
from dto.enums import MeetingSort
from dto.meeting import MeetingListFilterDTO
from schemas.meeting import (
    AgendaCreate,
    AgendaUpdate,
    LineCreate,
    LineItem,
    MeetingAttachmentCreate,
    MeetingCreate,
    MeetingDetail,
    MeetingListResponse,
    MeetingUpdate,
    TranscriptResponse,
)
from service import meeting_service

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
    """**보낸 필드만** — `title`(시작 전·종료 후) · `state`(회의 중 `active`·`done`·`next`). 응답은 `MeetingDetail` 전체."""
    return MeetingDetail.from_dto(
        await meeting_service.update_agenda(
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
    """회의 중 사람 줄 하나 — `status='recording'` 에서만(표 밖은 409). 응답은 **`LineItem`**(SPEC-007 §4 Request/Response)."""
    return LineItem.from_dto(
        await meeting_service.add_line(
            session, account_id=account_id, meeting_id=meeting_id, command=body.to_dto()
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

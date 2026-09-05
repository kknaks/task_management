"""1층 — HTTP 만. SPEC-003 §4 API Contract 의 표면.

**라우터 단위**로 `require_account` 를 건다 — 개별 함수에서 빠뜨릴 여지를 없앤다(§9).
여기 있는 표면은 **전부 세션이 필요하다**.

**상태 전이 엔드포인트가 없다** — 전용 표면이고 WORK-005 가 갖는다(§4 · BE §10).
**`PATCH /api/schedules` 도 없다** — 파생은 단방향이라 원본을 고친다(C-3 · BE-10).
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account
from dto.enums import RelationCandidateScope, TaskSort, TaskStatus
from dto.task import TaskListFilterDTO
from schemas.task import (
    AttachmentCreate,
    MemoCreate,
    StatusChange,
    TaskListItem,
    TaskListResponse,
    RelationCandidateItem,
    RelationCandidateListResponse,
    RelationCreate,
    TaskCreate,
    TaskDetail,
    TaskUpdate,
    TodoCreate,
    TodoUpdate,
)
from service import task_service

router = APIRouter(
    prefix="/api/tasks",
    tags=["task"],
    dependencies=[Depends(require_account)],
)


# --- 연관업무 후보 -------------------------------------------------------
#
# **선언 순서가 계약이다.** 아래 `GET /{task_id}` 의 `task_id` 는 `int` 라,
# 이 라우트를 뒤에 두면 `/relations/candidates` 의 `relations` 를 id 로 파싱하려다 422 가 난다.
# FastAPI 는 **선언 순서대로** 매칭하므로 고정 경로가 먼저 와야 한다(테스트로 고정했다).


@router.get(
    "/relations/candidates",
    response_model=RelationCandidateListResponse,
    response_model_by_alias=True,
)
async def list_relation_candidates(
    # 쿼리 키도 **camelCase** 다 — 응답과 같은 계약이다(§3 규칙 6).
    # `Query(alias=...)` 없이는 `CamelModel` 의 alias 가 적용되지 않는다(그건 본문 모델의 규칙이다).
    keyword: str | None = Query(default=None, max_length=200),
    exclude_id: int | None = Query(default=None, alias="excludeId"),
    project_id: int | None = Query(default=None, alias="projectId"),
    due_date: date | None = Query(default=None, alias="dueDate"),
    # 세 값 밖은 **FastAPI 가 422 로 거른다** — 손으로 잡지 않는다(§8-1 설계한 실패만).
    scope: RelationCandidateScope = Query(
        default=RelationCandidateScope.PROJECT, alias="scope"
    ),
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> RelationCandidateListResponse:
    """U-8 · §4(2026-09-06 개정) — **업무에 매달리지 않는 컬렉션 표면**이다.

    생성 드로어는 자기 id 가 없어 `excludeId` 를 보내지 않고 **폼에 입력 중인** 정렬 근거를 준다.
    상세 드로어는 `excludeId` 만 보내면 되고, **서버가 그 업무의 값을 정렬 근거로 쓴다.**

    `scope` 는 **필터**다(칩 3 과 1:1) — 정렬 근거인 `projectId`·`dueDate` 와 역할이 다르다.
    `total` 은 그 필터를 적용한 뒤의 총계이고 `items` 는 상위 20건이다.
    """
    candidates, total = await task_service.list_relation_candidates(
        session,
        account_id=account_id,
        keyword=keyword,
        exclude_id=exclude_id,
        project_id=project_id,
        due_date=due_date,
        scope=scope,
    )
    return RelationCandidateListResponse(
        items=[
            RelationCandidateItem(
                id=candidate.id,
                title=candidate.title,
                status=candidate.status,  # type: ignore[arg-type]
                project_name=None if candidate.project is None else candidate.project.name,
                due_date=candidate.due_date,
            )
            for candidate in candidates
        ],
        total=total,
    )


# --- 본체 ---------------------------------------------------------------


@router.get("", response_model=TaskListResponse, response_model_by_alias=True)
async def list_tasks(
    # §3 규칙 7 — 쿼리 alias 를 **손으로** 적는다. 빠뜨리면 필터가 조용히 무시되고 200 이 난다
    period_from: datetime | None = Query(default=None, alias="from"),
    period_to: datetime | None = Query(default=None, alias="to"),
    work_type_id: int | None = Query(default=None, alias="workTypeId"),
    status_filter: TaskStatus | None = Query(default=None, alias="status"),
    project_id: int | None = Query(default=None, alias="projectId"),
    sort: TaskSort = Query(default=TaskSort.DUE_ASC, alias="sort"),
    page: int = Query(default=1, ge=1, alias="page"),
    # 칸반은 페이지를 쓰지 않고 **그 달 전체를 한 번에** 받는다(U-2 데이터 범위).
    # 상한 500 은 선이다 — 없애지 않는다(넘으면 컬럼이 무한히 길어진다).
    size: int = Query(default=12, ge=1, le=500, alias="size"),
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskListResponse:
    """**리스트와 칸반이 같은 응답을 본다** — 칸반은 이 목록을 상태로 나눠 그릴 뿐이다.

    기간을 안 보내면 **이번 달**이다. 경계는 UTC 로 주고받는다(G-2).
    """
    default_from, default_to = task_service.current_month_bounds()
    return TaskListResponse.from_dto(
        await task_service.list_tasks(
            session,
            account_id=account_id,
            command=TaskListFilterDTO(
                period_from=period_from or default_from,
                period_to=period_to or default_to,
                work_type_id=work_type_id,
                status=None if status_filter is None else status_filter.value,
                project_id=project_id,
                sort=sort.value,
                page=page,
                size=size,
            ),
        )
    )


@router.post(
    "",
    response_model=TaskDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    body: TaskCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    """생성은 **한 트랜잭션**이다 — 자식이 절반만 남지 않는다(§5)."""
    return TaskDetail.from_dto(
        await task_service.create_task(
            session, account_id=account_id, command=body.to_dto()
        )
    )


@router.get("/{task_id}", response_model=TaskDetail, response_model_by_alias=True)
async def get_task(
    task_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    return TaskDetail.from_dto(
        await task_service.get_detail(session, account_id=account_id, task_id=task_id)
    )


@router.patch("/{task_id}", response_model=TaskDetail, response_model_by_alias=True)
async def update_task(
    task_id: int,
    body: TaskUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    return TaskDetail.from_dto(
        await task_service.update_task(
            session, account_id=account_id, task_id=task_id, command=body.to_dto()
        )
    )


# --- 상태 전이 (SPEC-004) -------------------------------------------------
#
# **세 진입점이 이 하나로 들어온다** — 리스트 셀 · 상세 드롭다운 · 칸반 DnD.
# (WORK-008 의 회의록 「업무 갱신」이 네 번째로 같은 곳을 지난다.)


@router.patch(
    "/{task_id}/status", response_model=TaskListItem, response_model_by_alias=True
)
async def change_status(
    task_id: int,
    body: StatusChange,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskListItem:
    """**게이트 판정이 붙기 때문에 일반 PATCH 에 섞지 않는다**(BE §10).

    거부(`task_completion_blocked`·`invalid_status_transition`)는 **정상 경로**다.
    """
    return TaskListItem.from_dto(
        await task_service.change_status(
            session, account_id=account_id, task_id=task_id, command=body.to_dto()
        )
    )


@router.post(
    "/{task_id}/status/undo", response_model=TaskListItem, response_model_by_alias=True
)
async def undo_status(
    task_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskListItem:
    """마지막 전이를 되돌리고 **그 로그를 지운다** — 로그를 지우는 유일한 경로다."""
    return TaskListItem.from_dto(
        await task_service.undo_last_status(
            session, account_id=account_id, task_id=task_id
        )
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """T-11 소프트 딜리트 — 목록에서 빠지고 **행과 자식은 DB 에 남는다.** 복원 경로는 없다."""
    await task_service.delete_task(session, account_id=account_id, task_id=task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 할일 ---------------------------------------------------------------


@router.post(
    "/{task_id}/todos",
    response_model=TaskDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_todo(
    task_id: int,
    body: TodoCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    """**갱신된 상세**를 돌려준다 — 자식 쓰기 표면 넷이 전부 같다(SPEC-003 §4)."""
    return TaskDetail.from_dto(
        await task_service.add_todo(
            session, account_id=account_id, task_id=task_id, command=body.to_dto()
        )
    )


@router.patch(
    "/{task_id}/todos/{todo_id}", response_model=TaskDetail, response_model_by_alias=True
)
async def update_todo(
    task_id: int,
    todo_id: int,
    body: TodoUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    """진행률·로그가 함께 바뀌므로 **갱신된 상세**를 돌려준다(SPEC-003 §4)."""
    return TaskDetail.from_dto(
        await task_service.update_todo(
            session,
            account_id=account_id,
            task_id=task_id,
            todo_id=todo_id,
            command=body.to_dto(),
        )
    )


@router.delete(
    "/{task_id}/todos/{todo_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_todo(
    task_id: int,
    todo_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await task_service.remove_todo(
        session, account_id=account_id, task_id=task_id, todo_id=todo_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 메모 ---------------------------------------------------------------


@router.post(
    "/{task_id}/memos",
    response_model=TaskDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_memo(
    task_id: int,
    body: MemoCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    """**등록만** 있다 — 수정·삭제 표면을 만들지 않는다(S003-OQ-4)."""
    return TaskDetail.from_dto(
        await task_service.add_memo(
            session, account_id=account_id, task_id=task_id, text=body.text
        )
    )


# --- 첨부 ---------------------------------------------------------------


@router.post(
    "/{task_id}/attachments",
    response_model=TaskDetail,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_attachment(
    task_id: int,
    body: AttachmentCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    return TaskDetail.from_dto(
        await task_service.add_attachment(
            session, account_id=account_id, task_id=task_id, command=body.to_dto()
        )
    )


@router.delete(
    "/{task_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_attachment(
    task_id: int,
    attachment_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await task_service.remove_attachment(
        session, account_id=account_id, task_id=task_id, attachment_id=attachment_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 연관업무 -----------------------------------------------------------


@router.post(
    "/{task_id}/relations", response_model=TaskDetail, response_model_by_alias=True
)
async def link_relations(
    task_id: int,
    body: RelationCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TaskDetail:
    """여러 건을 한 번에 연결한다. **중복 재전송이 행을 늘리지 않는다**(T-10)."""
    return TaskDetail.from_dto(
        await task_service.link_relations(
            session, account_id=account_id, task_id=task_id, target_ids=body.task_ids
        )
    )


@router.delete(
    "/{task_id}/relations/{other_task_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def unlink_relation(
    task_id: int,
    other_task_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await task_service.unlink_relation(
        session, account_id=account_id, task_id=task_id, other_task_id=other_task_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

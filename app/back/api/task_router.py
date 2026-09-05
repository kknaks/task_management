"""1층 — HTTP 만. SPEC-003 §4 API Contract 의 표면.

**라우터 단위**로 `require_account` 를 건다 — 개별 함수에서 빠뜨릴 여지를 없앤다(§9).
여기 있는 표면은 **전부 세션이 필요하다**.

**상태 전이 엔드포인트가 없다** — 전용 표면이고 WORK-005 가 갖는다(§4 · BE §10).
**`PATCH /api/schedules` 도 없다** — 파생은 단방향이라 원본을 고친다(C-3 · BE-10).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account
from schemas.task import (
    AttachmentCreate,
    MemoCreate,
    RelationCandidateItem,
    RelationCandidateListResponse,
    RelationCreate,
    TaskCreate,
    TaskDetail,
    TaskUpdate,
    TodoCreate,
    TodoItem,
    TodoUpdate,
)
from service import task_service

router = APIRouter(
    prefix="/api/tasks",
    tags=["task"],
    dependencies=[Depends(require_account)],
)


# --- 본체 ---------------------------------------------------------------


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


# --- 할일 ---------------------------------------------------------------


@router.post(
    "/{task_id}/todos",
    response_model=TodoItem,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def add_todo(
    task_id: int,
    body: TodoCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TodoItem:
    return TodoItem.from_dto(
        await task_service.add_todo(
            session, account_id=account_id, task_id=task_id, command=body.to_dto()
        )
    )


@router.patch(
    "/{task_id}/todos/{todo_id}", response_model=TodoItem, response_model_by_alias=True
)
async def update_todo(
    task_id: int,
    todo_id: int,
    body: TodoUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> TodoItem:
    return TodoItem.from_dto(
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


@router.get(
    "/{task_id}/relations/candidates",
    response_model=RelationCandidateListResponse,
    response_model_by_alias=True,
)
async def list_relation_candidates(
    task_id: int,
    keyword: str | None = Query(default=None, max_length=200),
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> RelationCandidateListResponse:
    """U-8 — 검색어가 없으면 **같은 프로젝트 → 기한 ±7일 → 최근 수정** 순 최대 20건."""
    candidates = await task_service.list_relation_candidates(
        session, account_id=account_id, task_id=task_id, keyword=keyword
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
        ]
    )


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

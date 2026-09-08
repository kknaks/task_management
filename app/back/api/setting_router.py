"""1층 — HTTP 만. SPEC-002 §4 API Contract 의 8표면.

**라우터 단위**로 `require_account` 를 건다 — 개별 함수에서 빠뜨릴 여지를 없앤다(§9).
여기 있는 표면은 **전부 세션이 필요하다**. 게이트 밖 표면이 하나도 없다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account
from schemas.setting import (
    ProjectCreate,
    ProjectItem,
    ProjectListResponse,
    ProjectUpdate,
    WorkTypeCreate,
    WorkTypeItem,
    WorkTypeListResponse,
    WorkTypeUpdate,
)
from service import project_service, work_type_service

router = APIRouter(
    prefix="/api",
    tags=["setting"],
    dependencies=[Depends(require_account)],
)


# --- 유형 ---------------------------------------------------------------


@router.get(
    "/work-types", response_model=WorkTypeListResponse, response_model_by_alias=True
)
async def list_work_types(
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> WorkTypeListResponse:
    """**삭제분은 기본으로 빠진다.** 「삭제된 것도 달라」는 파라미터를 두지 않는다(§4)."""
    return WorkTypeListResponse.from_dtos(
        await work_type_service.list_work_types(session, account_id)
    )


@router.post(
    "/work-types",
    response_model=WorkTypeItem,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_work_type(
    body: WorkTypeCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> WorkTypeItem:
    return WorkTypeItem.from_dto(
        await work_type_service.create_work_type(
            session, account_id=account_id, command=body.to_dto()
        )
    )


@router.patch(
    "/work-types/{work_type_id}",
    response_model=WorkTypeItem,
    response_model_by_alias=True,
)
async def update_work_type(
    work_type_id: int,
    body: WorkTypeUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> WorkTypeItem:
    return WorkTypeItem.from_dto(
        await work_type_service.update_work_type(
            session,
            account_id=account_id,
            work_type_id=work_type_id,
            command=body.to_dto(),
        )
    )


@router.delete("/work-types/{work_type_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_work_type(
    work_type_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await work_type_service.delete_work_type(
        session, account_id=account_id, work_type_id=work_type_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- 프로젝트 -----------------------------------------------------------


@router.get(
    "/projects", response_model=ProjectListResponse, response_model_by_alias=True
)
async def list_projects(
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> ProjectListResponse:
    return ProjectListResponse.from_dtos(
        await project_service.list_projects(session, account_id)
    )


@router.post(
    "/projects",
    response_model=ProjectItem,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    body: ProjectCreate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> ProjectItem:
    return ProjectItem.from_dto(
        await project_service.create_project(
            session, account_id=account_id, command=body.to_dto()
        )
    )


@router.patch(
    "/projects/{project_id}", response_model=ProjectItem, response_model_by_alias=True
)
async def update_project(
    project_id: int,
    body: ProjectUpdate,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> ProjectItem:
    return ProjectItem.from_dto(
        await project_service.update_project(
            session,
            account_id=account_id,
            project_id=project_id,
            command=body.to_dto(),
        )
    )


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: int,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await project_service.delete_project(
        session, account_id=account_id, project_id=project_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

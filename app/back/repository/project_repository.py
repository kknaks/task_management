"""3층 — `project` 의 ORM/SQL 만. 규약은 `work_type_repository` 와 같다.

- **모든 조회는 `account_id` 로 먼저 좁힌다**(DB G-5).
- **기본 조회는 `deleted_at IS NULL`**. 삭제분을 보는 메서드는 이름에 그 사실이 드러난다(DB §0-1).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.setting import ProjectDTO
from models.account import Project
from repository.name_match import normalize_for_compare, normalized_column


def _to_dto(row: Project) -> ProjectDTO:
    return ProjectDTO(id=row.id, name=row.name, color_token=row.color_token)


def _active(account_id: int) -> Select[tuple[Project]]:
    return select(Project).where(
        Project.account_id == account_id, Project.deleted_at.is_(None)
    )


async def list_active(session: AsyncSession, account_id: int) -> list[ProjectDTO]:
    """프로젝트는 **생성 순**이다(§4 Data Contract). 기본 프로젝트는 없다."""
    rows = (await session.scalars(_active(account_id).order_by(Project.id.asc()))).all()
    return [_to_dto(row) for row in rows]


async def find_active(
    session: AsyncSession, *, account_id: int, project_id: int
) -> ProjectDTO | None:
    row = (
        await session.scalars(_active(account_id).where(Project.id == project_id))
    ).one_or_none()
    return None if row is None else _to_dto(row)


async def find_including_deleted(
    session: AsyncSession, *, account_id: int, project_id: int
) -> ProjectDTO | None:
    """**삭제분까지** 본다 — 참조 중인 업무·회의에 이름·색을 그대로 보여주는 경로다(A-6)."""
    row = (
        await session.scalars(
            select(Project).where(
                Project.account_id == account_id, Project.id == project_id
            )
        )
    ).one_or_none()
    return None if row is None else _to_dto(row)


async def exists_active_name(
    session: AsyncSession, *, account_id: int, name: str, exclude_id: int | None = None
) -> bool:
    """프로젝트는 **프로젝트끼리** 유일하다(§4). 유형 이름과는 겹쳐도 된다."""
    query = _active(account_id).where(
        normalized_column(Project.name) == normalize_for_compare(name)
    )
    if exclude_id is not None:
        query = query.where(Project.id != exclude_id)

    return (await session.scalars(query.limit(1))).one_or_none() is not None


async def create(
    session: AsyncSession, *, account_id: int, name: str, color_token: str
) -> ProjectDTO:
    row = Project(account_id=account_id, name=name, color_token=color_token)
    session.add(row)
    await session.flush()
    return _to_dto(row)


async def update(
    session: AsyncSession,
    *,
    account_id: int,
    project_id: int,
    name: str | None = None,
    color_token: str | None = None,
) -> ProjectDTO:
    row = (
        await session.scalars(_active(account_id).where(Project.id == project_id))
    ).one()

    if name is not None:
        row.name = name
    if color_token is not None:
        row.color_token = color_token

    await session.flush()
    return _to_dto(row)


async def soft_delete(
    session: AsyncSession, *, account_id: int, project_id: int, deleted_at: datetime
) -> None:
    row = (
        await session.scalars(_active(account_id).where(Project.id == project_id))
    ).one()
    row.deleted_at = deleted_at
    await session.flush()

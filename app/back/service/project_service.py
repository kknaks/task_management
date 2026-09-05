"""2층 — 프로젝트의 도메인 규칙.

유형과 다른 점 둘 — **종류가 없고**, **기본 프로젝트가 없다**(전부 삭제 가능 — §U-5).
그래서 잠금 판정이 없다.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.constants import validate_color_token
from core.exceptions import ConflictError, NotFoundError
from dto.setting import ProjectCreateDTO, ProjectDTO, ProjectUpdateDTO
from dto.unset import UNSET
from repository import project_repository

# SPEC-002 §4 Case Matrix — 문구까지 계약이다.
_NOT_FOUND = "항목을 찾을 수 없습니다"
_DUPLICATE_NAME = "같은 이름이 이미 있습니다"


async def _require_active(
    session: AsyncSession, *, account_id: int, project_id: int
) -> ProjectDTO:
    found = await project_repository.find_active(
        session, account_id=account_id, project_id=project_id
    )
    if found is None:
        # 없는 항목과 남의 항목이 같은 응답이다(§5 · §9).
        raise NotFoundError(_NOT_FOUND)
    return found


async def _require_unique_name(
    session: AsyncSession, *, account_id: int, name: str, exclude_id: int | None = None
) -> None:
    taken = await project_repository.exists_active_name(
        session, account_id=account_id, name=name, exclude_id=exclude_id
    )
    if taken:
        raise ConflictError(_DUPLICATE_NAME, code="duplicate_name")


async def list_projects(session: AsyncSession, account_id: int) -> list[ProjectDTO]:
    return await project_repository.list_active(session, account_id)


async def create_project(
    session: AsyncSession, *, account_id: int, command: ProjectCreateDTO
) -> ProjectDTO:
    validate_color_token(command.color_token)
    await _require_unique_name(session, account_id=account_id, name=command.name)

    return await project_repository.create(
        session,
        account_id=account_id,
        name=command.name,
        color_token=command.color_token,
    )


async def update_project(
    session: AsyncSession, *, account_id: int, project_id: int, command: ProjectUpdateDTO
) -> ProjectDTO:
    current = await _require_active(
        session, account_id=account_id, project_id=project_id
    )

    if command.color_token is not UNSET:
        validate_color_token(command.color_token)

    if command.name is not UNSET:
        await _require_unique_name(
            session, account_id=account_id, name=command.name, exclude_id=project_id
        )

    if command.name is UNSET and command.color_token is UNSET:
        return current

    return await project_repository.update(
        session,
        account_id=account_id,
        project_id=project_id,
        name=None if command.name is UNSET else command.name,
        color_token=None if command.color_token is UNSET else command.color_token,
    )


async def delete_project(
    session: AsyncSession, *, account_id: int, project_id: int
) -> None:
    """**소프트 딜리트.** 행은 남고 목록·선택지에서만 빠진다(A-6 · DB §0-1)."""
    await _require_active(session, account_id=account_id, project_id=project_id)

    await project_repository.soft_delete(
        session,
        account_id=account_id,
        project_id=project_id,
        deleted_at=datetime.now(UTC),
    )

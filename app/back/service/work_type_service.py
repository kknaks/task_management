"""2층 — 유형의 도메인 규칙. `fastapi` 도 `schemas/` 도 import 하지 않는다.

정본: SPEC-002 §4 Case Matrix(에러) · §5(규칙) · `domains/account.md` A-4·A-5·A-6.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.constants import validate_color_token
from core.exceptions import ConflictError, NotFoundError
from dto.setting import WorkTypeCreateDTO, WorkTypeDTO, WorkTypeUpdateDTO
from dto.unset import UNSET
from repository import work_type_repository

# SPEC-002 §4 Case Matrix — 문구까지 계약이다.
_NOT_FOUND = "항목을 찾을 수 없습니다"
_DUPLICATE_NAME = "같은 이름이 이미 있습니다"
_LOCKED = "기본 유형은 이름과 종류를 바꾸거나 삭제할 수 없습니다"


def _not_found() -> NotFoundError:
    """**없는 항목과 남의 항목이 같은 응답이다** — 존재를 흘리지 않는다(§5 · §9)."""
    return NotFoundError(_NOT_FOUND)


def _locked() -> ConflictError:
    """기본 유형 3종 잠금(A-4). **화면이 컨트롤을 감춰도 서버 판정이 정본이다.**"""
    return ConflictError(_LOCKED, code="work_type_locked")


async def _require_active(
    session: AsyncSession, *, account_id: int, work_type_id: int
) -> WorkTypeDTO:
    found = await work_type_repository.find_active(
        session, account_id=account_id, work_type_id=work_type_id
    )
    if found is None:
        raise _not_found()
    return found


async def _require_unique_name(
    session: AsyncSession, *, account_id: int, name: str, exclude_id: int | None = None
) -> None:
    taken = await work_type_repository.exists_active_name(
        session, account_id=account_id, name=name, exclude_id=exclude_id
    )
    if taken:
        raise ConflictError(_DUPLICATE_NAME, code="duplicate_name")


async def list_work_types(session: AsyncSession, account_id: int) -> list[WorkTypeDTO]:
    """**삭제분은 빠진다.** 선택 목록이 곧 이 목록이다(§4)."""
    return await work_type_repository.list_active(session, account_id)


async def create_work_type(
    session: AsyncSession, *, account_id: int, command: WorkTypeCreateDTO
) -> WorkTypeDTO:
    validate_color_token(command.color_token)
    await _require_unique_name(session, account_id=account_id, name=command.name)

    return await work_type_repository.create(
        session,
        account_id=account_id,
        kind=command.kind,
        name=command.name,
        color_token=command.color_token,
        description=command.description,
    )


async def update_work_type(
    session: AsyncSession,
    *,
    account_id: int,
    work_type_id: int,
    command: WorkTypeUpdateDTO,
) -> WorkTypeDTO:
    """보낸 필드만 바꾼다(§4).

    기본 유형은 **이름을 바꾸려 하면 거부**하고 **색 · 설명 변경은 통과**시킨다(A-4 · A-12 — 잠긴 것은 이름과 종류뿐).
    `kind` 는 애초에 이 명령에 없다 — 종류는 생성 시에만 정해진다(§5).
    `description` 은 **`None` 으로 지울 수 있다** — 비어 있어도 유형은 유효하다(선택 입력).
    """
    current = await _require_active(
        session, account_id=account_id, work_type_id=work_type_id
    )

    if command.name is not UNSET and current.is_default:
        raise _locked()

    if command.color_token is not UNSET:
        validate_color_token(command.color_token)

    if command.name is not UNSET:
        await _require_unique_name(
            session, account_id=account_id, name=command.name, exclude_id=work_type_id
        )

    if command.name is UNSET and command.color_token is UNSET and command.description is UNSET:
        # 바꿀 것이 없다. 빈 변경을 에러로 만들지 않는다 — Case Matrix 에 그런 실패가 없다.
        return current

    return await work_type_repository.update(
        session,
        account_id=account_id,
        work_type_id=work_type_id,
        name=command.name,
        color_token=command.color_token,
        description=command.description,
    )


async def delete_work_type(
    session: AsyncSession, *, account_id: int, work_type_id: int
) -> None:
    """**소프트 딜리트.** 행은 남고 목록·선택지에서만 빠진다(A-6 · DB §0-1).

    기본 유형 3종은 삭제할 수 없다(A-4). 복원 경로는 만들지 않는다(DEC-004 §4).
    """
    current = await _require_active(
        session, account_id=account_id, work_type_id=work_type_id
    )
    if current.is_default:
        raise _locked()

    await work_type_repository.soft_delete(
        session,
        account_id=account_id,
        work_type_id=work_type_id,
        deleted_at=datetime.now(UTC),
    )

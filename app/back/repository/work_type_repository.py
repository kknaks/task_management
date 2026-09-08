"""3층 — `work_type` 의 ORM/SQL 만. **ORM 모델을 밖으로 내지 않는다**(§2 · §3 규칙 2).

- **모든 조회는 `account_id` 로 먼저 좁힌다**(DB G-5).
- **기본 조회는 `deleted_at IS NULL`** 이다. 삭제분을 보는 메서드는 **이름에 그 사실이 드러난다**(DB §0-1).
- `commit()` 하지 않는다 — flush 까지다(§7).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from dto.setting import WorkTypeDTO
from dto.unset import UNSET, Unset
from models.account import WorkType
from repository.name_match import normalize_for_compare, normalized_column


def _to_dto(row: WorkType) -> WorkTypeDTO:
    return WorkTypeDTO(
        id=row.id,
        kind=row.kind,
        name=row.name,
        color_token=row.color_token,
        description=row.description,
        is_default=row.is_default,
    )


def _active(account_id: int) -> Select[tuple[WorkType]]:
    return select(WorkType).where(
        WorkType.account_id == account_id, WorkType.deleted_at.is_(None)
    )


async def list_active(session: AsyncSession, account_id: int) -> list[WorkTypeDTO]:
    """정렬은 **기본 유형 3종이 먼저**(시드 순서 = id 순), 그 뒤 생성 순이다(§4 Data Contract)."""
    rows = (
        await session.scalars(
            _active(account_id).order_by(WorkType.is_default.desc(), WorkType.id.asc())
        )
    ).all()
    return [_to_dto(row) for row in rows]


async def find_active(
    session: AsyncSession, *, account_id: int, work_type_id: int
) -> WorkTypeDTO | None:
    """남의 것도 없는 것도 똑같이 `None` 이다 — 존재 여부를 흘리지 않는다(§9)."""
    row = (
        await session.scalars(_active(account_id).where(WorkType.id == work_type_id))
    ).one_or_none()
    return None if row is None else _to_dto(row)


async def find_including_deleted(
    session: AsyncSession, *, account_id: int, work_type_id: int
) -> WorkTypeDTO | None:
    """**삭제분까지** 본다 — 참조 중인 업무·회의에 이름·색을 그대로 보여주는 경로다(A-6).

    이름이 그 사실을 드러낸다(DB §0-1 조회 규약). 목록·선택지는 이 메서드를 쓰지 않는다.
    """
    row = (
        await session.scalars(
            select(WorkType).where(
                WorkType.account_id == account_id, WorkType.id == work_type_id
            )
        )
    ).one_or_none()
    return None if row is None else _to_dto(row)


async def exists_active_name(
    session: AsyncSession, *, account_id: int, name: str, exclude_id: int | None = None
) -> bool:
    """이름 유일성 — 같은 계정 · **삭제분 제외** · 종류와 무관하게 전체에서 유일(§4).

    대소문자·공백을 정규화해 비교한다(`name_match`).
    """
    query = _active(account_id).where(
        normalized_column(WorkType.name) == normalize_for_compare(name)
    )
    if exclude_id is not None:
        query = query.where(WorkType.id != exclude_id)

    return (await session.scalars(query.limit(1))).one_or_none() is not None


async def create(
    session: AsyncSession,
    *,
    account_id: int,
    kind: str,
    name: str,
    color_token: str,
    description: str | None = None,
) -> WorkTypeDTO:
    """`is_default` 는 **시드만** 켠다 — 앱으로 만든 유형은 언제나 커스텀이다(A-4)."""
    row = WorkType(
        account_id=account_id,
        kind=kind,
        name=name,
        color_token=color_token,
        description=description,
        is_default=False,
    )
    session.add(row)
    await session.flush()
    return _to_dto(row)


async def update(
    session: AsyncSession,
    *,
    account_id: int,
    work_type_id: int,
    name: str | Unset = UNSET,
    color_token: str | Unset = UNSET,
    description: str | None | Unset = UNSET,
) -> WorkTypeDTO:
    """**보낸 값만** 바꾼다 — 「보내지 않음」은 `UNSET` 이다.

    `None` 을 「안 바꾼다」로 읽던 옛 규약을 바꿨다 — `description` 은 **`None` 이 「지운다」는 뜻**이라(A-12)
    그 구분이 필요해졌다. 이름·색은 여전히 비울 수 없는 값이고, 그 판정은 service·스키마가 한다.
    """
    row = (
        await session.scalars(_active(account_id).where(WorkType.id == work_type_id))
    ).one()

    if name is not UNSET:
        row.name = name
    if color_token is not UNSET:
        row.color_token = color_token
    if description is not UNSET:
        row.description = description

    await session.flush()
    return _to_dto(row)


async def soft_delete(
    session: AsyncSession, *, account_id: int, work_type_id: int, deleted_at: datetime
) -> None:
    """행을 지우지 않는다 — 삭제 표시만 남긴다(DB §0-1). 하드 삭제 경로는 없다."""
    row = (
        await session.scalars(_active(account_id).where(WorkType.id == work_type_id))
    ).one()
    row.deleted_at = deleted_at
    await session.flush()

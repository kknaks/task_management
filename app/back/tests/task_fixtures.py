"""업무 도메인 테스트 공통 — 계정·유형·프로젝트를 갖춘 소유자.

**`conftest.py` 가 아니므로 자동 수집되지 않는다** — 쓰는 쪽에서 이름을 import 한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password
from dto.enums import ColorToken, WorkTypeKind
from models.account import Account, Project, WorkType

PASSWORD = "Task!pass1"


@dataclass(frozen=True)
class TaskOwner:
    """계정 하나와 그 계정의 Bearer 헤더 · 기본 유형/프로젝트 id."""

    id: int
    login_id: str
    headers: dict[str, str]
    work_type_id: int
    project_id: int


async def create_owner(
    client: AsyncClient, session: AsyncSession, login_id: str
) -> TaskOwner:
    account = Account(
        login_id=login_id,
        password_hash=hash_password(PASSWORD),
        name=f"{login_id} 계정",
        email=None,
    )
    session.add(account)
    await session.flush()

    work_type = WorkType(
        account_id=account.id,
        kind=WorkTypeKind.TASK.value,
        name=f"{login_id} 업무 유형",
        color_token=ColorToken.STEEL.value,
        is_default=False,
    )
    project = Project(
        account_id=account.id,
        name=f"{login_id} 프로젝트",
        color_token=ColorToken.VIOLET.value,
    )
    session.add_all([work_type, project])
    await session.flush()

    response = await client.post(
        "/api/auth/login", json={"loginId": login_id, "password": PASSWORD}
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]

    return TaskOwner(
        id=account.id,
        login_id=login_id,
        headers={"Authorization": f"Bearer {token}"},
        work_type_id=work_type.id,
        project_id=project.id,
    )


@pytest.fixture
async def owner(client: AsyncClient, db_session: AsyncSession) -> TaskOwner:
    return await create_owner(client, db_session, "task_owner")


@pytest.fixture
async def stranger(client: AsyncClient, db_session: AsyncSession) -> TaskOwner:
    """**남의 계정.** 소유 검사(404)를 확인하는 데만 쓴다."""
    return await create_owner(client, db_session, "task_stranger")

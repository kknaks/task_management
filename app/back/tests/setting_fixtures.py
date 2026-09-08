"""유형·프로젝트 테스트 공통 — 계정 두 개와 인증된 헤더.

`tests/conftest.py`(WORK-001 산출물)를 건드리지 않으려고 이 work 의 픽스처만 여기 모았다.
**`conftest.py` 가 아니므로 자동 수집되지 않는다** — 쓰는 쪽에서 이름을 import 한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import hash_password
from models.account import Account

PASSWORD = "Setting!pass1"


@dataclass(frozen=True)
class Owner:
    """계정 하나와 그 계정의 Bearer 헤더."""

    id: int
    login_id: str
    headers: dict[str, str]


async def _create_owner(
    client: AsyncClient, session: AsyncSession, login_id: str
) -> Owner:
    account = Account(
        login_id=login_id,
        password_hash=hash_password(PASSWORD),
        name=f"{login_id} 계정",
        email=None,
    )
    session.add(account)
    await session.flush()

    response = await client.post(
        "/api/auth/login", json={"loginId": login_id, "password": PASSWORD}
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return Owner(
        id=account.id, login_id=login_id, headers={"Authorization": f"Bearer {token}"}
    )


@pytest.fixture
async def owner(client: AsyncClient, db_session: AsyncSession) -> Owner:
    return await _create_owner(client, db_session, "setting_owner")


@pytest.fixture
async def stranger(client: AsyncClient, db_session: AsyncSession) -> Owner:
    """**남의 계정.** 소유 검사(404)를 확인하는 데만 쓴다."""
    return await _create_owner(client, db_session, "setting_stranger")

"""회의 도메인 테스트 공통 — 계정 · **종류=미팅 유형** · 업무 유형 · 프로젝트를 갖춘 소유자.

**`conftest.py` 가 아니므로 자동 수집되지 않는다** — 쓰는 쪽에서 이름을 import 한다.
업무 쪽 소유자(`task_fixtures.create_owner`) 위에 미팅 유형 하나를 얹는다 — 두 번째 계정 생성 코드를 두지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from dto.enums import ColorToken, WorkTypeKind
from models.account import WorkType
from tests.task_fixtures import create_owner

BASE = "/api/meetings"

# 2026-09-10 14:00~15:00 KST = 05:00~06:00Z. 테스트 전체가 이 한 시각을 기준으로 앞뒤를 옮긴다.
START = datetime(2026, 9, 10, 5, 0, tzinfo=UTC)
END = START + timedelta(hours=1)


@dataclass(frozen=True)
class MeetingOwner:
    """계정 하나와 Bearer 헤더 · 미팅 유형 · 업무 유형 · 프로젝트 id."""

    id: int
    login_id: str
    headers: dict[str, str]
    meeting_type_id: int
    task_type_id: int
    project_id: int


async def create_meeting_owner(
    client: AsyncClient, session: AsyncSession, login_id: str
) -> MeetingOwner:
    base = await create_owner(client, session, login_id)

    meeting_type = WorkType(
        account_id=base.id,
        kind=WorkTypeKind.MEETING.value,
        name=f"{login_id} 미팅·회의",
        color_token=ColorToken.INDIGO.value,
        is_default=False,
    )
    session.add(meeting_type)
    await session.flush()

    return MeetingOwner(
        id=base.id,
        login_id=base.login_id,
        headers=base.headers,
        meeting_type_id=meeting_type.id,
        task_type_id=base.work_type_id,
        project_id=base.project_id,
    )


@pytest.fixture
async def owner(client: AsyncClient, db_session: AsyncSession) -> MeetingOwner:
    return await create_meeting_owner(client, db_session, "meeting_owner")


@pytest.fixture
async def stranger(client: AsyncClient, db_session: AsyncSession) -> MeetingOwner:
    """**남의 계정.** 소유 검사(404)를 확인하는 데만 쓴다."""
    return await create_meeting_owner(client, db_session, "meeting_stranger")


def iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


def meeting_body(owner: MeetingOwner, **overrides: object) -> dict:
    """**제목 + 유형 + 일시**만으로 만들어진다(SPEC-006 §6). 나머지는 덮어쓴다."""
    body: dict = {
        "title": "제품 소개서 리뷰",
        "workTypeId": owner.meeting_type_id,
        "startAt": iso(START),
        "endAt": iso(END),
    }
    body.update(overrides)
    return body


async def create_meeting(
    client: AsyncClient, owner: MeetingOwner, **overrides: object
) -> dict:
    response = await client.post(
        BASE, json=meeting_body(owner, **overrides), headers=owner.headers
    )
    assert response.status_code == 201, response.text
    return response.json()


async def get_detail(client: AsyncClient, owner: MeetingOwner, meeting_id: int) -> dict:
    response = await client.get(f"{BASE}/{meeting_id}", headers=owner.headers)
    assert response.status_code == 200, response.text
    return response.json()

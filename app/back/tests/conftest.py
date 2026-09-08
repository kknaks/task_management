"""테스트 공통 픽스처(backend/README.md §12).

- DB 는 **실제 PostgreSQL**(테스트 DB)이다. SQLite 를 쓰지 않는다.
- 테스트마다 트랜잭션을 열고 끝에서 롤백한다.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from core.db import run_after_commit_hooks
from integrations import agent as agent_integration
from integrations import soniox as soniox_integration
from integrations import storage as storage_integration
from tests.fakes.agent import FakeAgentGateway
from tests.fakes.soniox import FakeSttConnector
from tests.fakes.storage import FakeRecordingStore

BACK_DIR = Path(__file__).resolve().parents[1]

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    raise RuntimeError(
        "TEST_DATABASE_URL 이 필요합니다. `make test` 로 실행하거나 .env 를 로드하세요."
    )

# 닿을 수 없는 주소 — `db_unavailable` 경로를 재현할 때만 쓴다.
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://none:none@127.0.0.1:1/none"


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    """테스트 DB 를 head 까지 올린다. 마이그레이션이 곧 스키마 정본이다."""
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_DATABASE_URL
    config = Config(str(BACK_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACK_DIR / "alembic"))
    command.upgrade(config, "head")
    yield


@pytest.fixture(autouse=True)
def fake_agent() -> Iterator[FakeAgentGateway]:
    """**Soniox·codex 를 테스트에서 실제로 부르지 않는다**(BE §12). 대역은 `integrations/` 경계에서만 끼운다.

    autouse 인 이유 — `/start` 가 웜스타트를 제출하므로 회의 테스트 전부가 대역을 필요로 한다.
    """
    gateway = FakeAgentGateway()
    agent_integration.install_gateway(gateway)
    yield gateway
    agent_integration.install_gateway(None)


@pytest.fixture(autouse=True)
def fake_stt() -> Iterator[FakeSttConnector]:
    connector = FakeSttConnector()
    soniox_integration.install_connector(connector)
    yield connector
    soniox_integration.install_connector(None)


@pytest.fixture(autouse=True)
def fake_store() -> Iterator[FakeRecordingStore]:
    store = FakeRecordingStore()
    storage_integration.install_store(store)
    yield store
    storage_integration.install_store(None)


@pytest.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    """바깥 트랜잭션 안에서 세션을 연다. 테스트가 끝나면 통째로 롤백한다."""
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        maker = async_sessionmaker(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        async with maker() as session:
            yield session
        await transaction.rollback()
    await engine.dispose()


@pytest.fixture
def sync_engine() -> Iterator[Engine]:
    """시드는 동기다(backend/README.md §5) — 같은 psycopg3 드라이버를 동기로 문다."""
    engine = create_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield engine
    engine.dispose()


@pytest.fixture
def sync_session(sync_engine: Engine) -> Iterator[Session]:
    with sync_engine.connect() as connection:
        transaction = connection.begin()
        maker = sessionmaker(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        with maker() as session:
            yield session
        transaction.rollback()


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    from api.deps import get_db
    from main import app

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        yield db_session
        # 실제 `get_db` 처럼 「커밋 뒤 훅」을 돈다 — 테스트에서는 flush 가 그 자리다
        await db_session.flush()
        await run_after_commit_hooks(db_session)

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.dependency_overrides.clear()

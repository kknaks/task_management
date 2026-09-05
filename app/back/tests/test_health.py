"""SPEC-000 §4 — `GET /api/health` 계약과 Case Matrix."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from config import MissingEnvError, get_settings
from tests.conftest import UNREACHABLE_DATABASE_URL


async def test_health_returns_ok_with_version_and_database(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": get_settings().app_version,
        "database": "ok",
    }


async def test_health_returns_503_db_unavailable_when_database_is_down() -> None:
    """DB 왕복이 실패하면 **200 「정상」이 아니라** 503 `db_unavailable` 이다."""
    from api.deps import get_db
    from main import app

    engine = create_async_engine(UNREACHABLE_DATABASE_URL, poolclass=NullPool)
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/api/health")
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

    assert response.status_code == 503
    assert response.json() == {
        "detail": "데이터베이스에 연결할 수 없습니다",
        "code": "db_unavailable",
    }


def test_missing_required_env_blocks_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    """필수 env 가 없으면 기동에 실패하고 **누락 변수명**이 메시지에 남는다."""
    monkeypatch.delenv("JWT_SECRET", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(MissingEnvError) as excinfo:
            get_settings()
    finally:
        get_settings.cache_clear()

    assert "JWT_SECRET" in str(excinfo.value)


def test_cors_origins_is_an_explicit_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """CORS 는 **명시 목록**이다 — `*` 를 쓰지 않는다(SPEC-000 §5)."""
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000, tauri://localhost")
    get_settings.cache_clear()
    try:
        origins = get_settings().cors_origin_list
    finally:
        get_settings.cache_clear()

    assert origins == ["http://localhost:3000", "tauri://localhost"]
    assert "*" not in origins

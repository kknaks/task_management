"""async engine · 세션 팩토리(backend/README.md §5).

- 드라이버는 psycopg3(`postgresql+psycopg://`) — alembic·시드(동기)와 **같은 드라이버**다.
- `expire_on_commit=False` — async 에서 commit 뒤 속성 읽기가 `MissingGreenlet` 으로 터지는 것을 막는다.
- `pool_pre_ping=True` — 끊긴 커넥션을 재사용하지 않는다.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from config import get_settings


def create_engine_from_settings() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        future=True,
    )


engine: AsyncEngine = create_engine_from_settings()

SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)

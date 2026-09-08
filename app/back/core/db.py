"""async engine · 세션 팩토리(backend/README.md §5).

- 드라이버는 psycopg3(`postgresql+psycopg://`) — alembic·시드(동기)와 **같은 드라이버**다.
- `expire_on_commit=False` — async 에서 commit 뒤 속성 읽기가 `MissingGreenlet` 으로 터지는 것을 막는다.
- `pool_pre_ping=True` — 끊긴 커넥션을 재사용하지 않는다.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

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


# --- 커밋 뒤 훅 (WORK-007 · WP 「set_agenda_state — 커밋 → batch_service.evaluate」) ----------
#
# service 는 commit 을 모른다(§7). 「커밋된 뒤에만 뜻이 있는 일」(배치 트리거 평가)은 여기 등록해 두고
# `get_db` 가 commit 직후 순서대로 부른다. 커밋이 안 되면(예외) 훅도 돌지 않는다.
_AFTER_COMMIT_KEY = "after_commit_hooks"

AfterCommitHook = Callable[[], Awaitable[None]]


def register_after_commit(session: AsyncSession, hook: AfterCommitHook) -> None:
    session.info.setdefault(_AFTER_COMMIT_KEY, []).append(hook)


async def run_after_commit_hooks(session: AsyncSession) -> None:
    info = getattr(session, "info", None)
    if info is None:
        return
    hooks: list[AfterCommitHook] = info.pop(_AFTER_COMMIT_KEY, [])
    for hook in hooks:
        await hook()

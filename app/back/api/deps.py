"""라우터 의존성.

`get_db` — 요청 하나 = 트랜잭션 하나(backend/README.md §7).
`require_account` — **자리만 잡아 둔다.** 구현은 WORK-002(SPEC-001)다.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from core.db import SessionLocal


async def get_db() -> AsyncIterator[AsyncSession]:
    """요청 끝에서 commit 한다.

    예외가 나면 commit 을 건너뛰고 `async with` 종료가 롤백한다 —
    광범위한 `except` 를 두지 않기 위한 형태다(backend/README.md §8-1).
    """
    async with SessionLocal() as session:
        yield session
        await session.commit()


async def require_account() -> int:
    """access 토큰을 검증하고 `account_id` 를 돌려준다.

    **시그니처(반환 `int`)만 고정**하고 본문은 WORK-002 가 채운다.
    로그인·refresh·헬스를 뺀 모든 라우터에 라우터 단위로 걸린다(backend/README.md §9).
    """
    raise NotImplementedError("require_account 는 WORK-002(SPEC-001)에서 구현한다")

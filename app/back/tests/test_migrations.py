"""WORK-009 W-5 — 리비전 `0007` 왕복(WP Phase 1 검증 첫 항목).

`conftest.py` 는 `upgrade head` 만 돈다. **되감기가 도는지는 아무도 안 봤다** — 여기서 본다.

무엇을 단언하나 —

- `upgrade head → downgrade -1 → upgrade head` 가 **예외 없이** 돈다
- 되감기 뒤에도 **`kind='refresh'` 행이 살아 있다**(A-7 회귀 없음). 다시 올린 뒤 `kind` 가 `'refresh'` 로 돌아온다
- 되감기가 **`kind='meeting'` 행을 지운다** — 그래야 `refresh_token_hash` NOT NULL 복구가 성립한다(리비전 머리 주석)

**공유 테스트 DB 에 커밋한다**(alembic 은 트랜잭션 롤백 밖이다) — 그래서 `finally` 에서 심은 행을 전부 지운다.
남겨 두면 「회의 토큰 행이 정확히 하나」를 세는 테스트(`test_meeting_token.py`)가 남의 행을 본다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, text

BACK_DIR = Path(__file__).resolve().parents[1]

_REFRESH_HASH = "work009-roundtrip-refresh-hash"
_MEETING_TOKEN = "work009-roundtrip-meeting-token"


def _alembic() -> Config:
    """`conftest.migrated_database` 와 **같은 설정**이다 — `ALEMBIC_DATABASE_URL` 이 테스트 DB 를 가리킨다."""
    config = Config(str(BACK_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACK_DIR / "alembic"))
    return config


def _seed(engine: Engine) -> dict[str, int]:
    """왕복이 무엇을 지키고 무엇을 지우는지 보려면 **커밋된 행**이 있어야 한다."""
    now = datetime.now(UTC)
    with engine.begin() as conn:
        account_id = conn.execute(
            text(
                "INSERT INTO account (login_id, password_hash, name)"
                " VALUES ('work009_roundtrip', 'x', '왕복 테스트') RETURNING id"
            )
        ).scalar_one()
        work_type_id = conn.execute(
            text(
                "INSERT INTO work_type (account_id, kind, name, color_token)"
                " VALUES (:a, 'meeting', '왕복 유형', 'indigo') RETURNING id"
            ),
            {"a": account_id},
        ).scalar_one()
        meeting_id = conn.execute(
            text(
                "INSERT INTO meeting (account_id, work_type_id, title, start_at, end_at)"
                " VALUES (:a, :w, '왕복 회의', :s, :e) RETURNING id"
            ),
            {"a": account_id, "w": work_type_id, "s": now, "e": now + timedelta(hours=1)},
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO auth_session (account_id, kind, refresh_token_hash, expires_at)"
                " VALUES (:a, 'refresh', :h, :x)"
            ),
            {"a": account_id, "h": _REFRESH_HASH, "x": now + timedelta(days=7)},
        )
        conn.execute(
            text(
                "INSERT INTO auth_session (account_id, kind, meeting_id, meeting_token, expires_at)"
                " VALUES (:a, 'meeting', :m, :t, :x)"
            ),
            {"a": account_id, "m": meeting_id, "t": _MEETING_TOKEN, "x": now + timedelta(hours=6)},
        )
    return {"account_id": account_id, "work_type_id": work_type_id, "meeting_id": meeting_id}


def _cleanup(engine: Engine, seeded: dict[str, int]) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM auth_session WHERE account_id = :a"), {"a": seeded["account_id"]}
        )
        conn.execute(text("DELETE FROM meeting WHERE id = :m"), {"m": seeded["meeting_id"]})
        conn.execute(text("DELETE FROM work_type WHERE id = :w"), {"w": seeded["work_type_id"]})
        conn.execute(text("DELETE FROM account WHERE id = :a"), {"a": seeded["account_id"]})


@pytest.mark.slow
def test_revision_0007_round_trip(sync_engine: Engine) -> None:
    """`upgrade → downgrade -1 → upgrade` 를 실제 alembic 명령으로 돈다(WP Phase 1)."""
    config = _alembic()
    seeded = _seed(sync_engine)
    try:
        command.downgrade(config, "-1")

        with sync_engine.connect() as conn:
            # 되감긴 스키마에는 세 컬럼이 없다
            columns = set(
                conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns"
                        " WHERE table_name = 'auth_session'"
                    )
                ).scalars()
            )
            assert {"kind", "meeting_id", "meeting_token"} & columns == set()
            # refresh 행은 살아 있고 NOT NULL 이 복구됐다
            assert (
                conn.execute(
                    text("SELECT count(*) FROM auth_session WHERE refresh_token_hash = :h"),
                    {"h": _REFRESH_HASH},
                ).scalar_one()
                == 1
            )
            assert (
                conn.execute(
                    text(
                        "SELECT is_nullable FROM information_schema.columns"
                        " WHERE table_name = 'auth_session' AND column_name = 'refresh_token_hash'"
                    )
                ).scalar_one()
                == "NO"
            )

        command.upgrade(config, "head")

        with sync_engine.connect() as conn:
            # 기존 행은 `kind='refresh'` 로 돌아온다(server_default)
            assert (
                conn.execute(
                    text("SELECT kind FROM auth_session WHERE refresh_token_hash = :h"),
                    {"h": _REFRESH_HASH},
                ).scalar_one()
                == "refresh"
            )
            # meeting 행은 downgrade 가 지웠고 되살아나지 않는다
            assert (
                conn.execute(
                    text("SELECT count(*) FROM auth_session WHERE meeting_token = :t"),
                    {"t": _MEETING_TOKEN},
                ).scalar_one()
                == 0
            )
    finally:
        _cleanup(sync_engine, seeded)

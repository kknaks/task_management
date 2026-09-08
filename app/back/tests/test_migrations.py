"""리비전 왕복 — `0009`(WORK-013) · `0008`(WORK-012) · `0007`(WORK-009).

`conftest.py` 는 `upgrade head` 만 돈다. **되감기가 도는지는 아무도 안 봤다** — 여기서 본다.

무엇을 단언하나 —

- `upgrade head → downgrade -1 → upgrade head` 가 **예외 없이** 돈다
- 되감기 뒤에도 **`kind='refresh'` 행이 살아 있다**(A-7 회귀 없음). 다시 올린 뒤 `kind` 가 `'refresh'` 로 돌아온다
- 되감기가 **`kind='meeting'` 행을 지운다** — 그래야 `refresh_token_hash` NOT NULL 복구가 성립한다(리비전 머리 주석)

**되감기 목표는 상대 번호(`-1`)가 아니라 리비전 id 로 적는다** — 위에 리비전이 하나 얹힐 때마다 `-1` 이 다른 곳을 가리킨다.


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


def _columns(conn, table: str) -> set[str]:  # type: ignore[no-untyped-def]
    return set(
        conn.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
            {"t": table},
        ).scalars()
    )


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
        agenda_id = conn.execute(
            text(
                "INSERT INTO meeting_agenda (meeting_id, track, title, order_index)"
                " VALUES (:m, 'human', '왕복 안건', 0) RETURNING id"
            ),
            {"m": meeting_id},
        ).scalar_one()
        line_id = conn.execute(
            text(
                "INSERT INTO meeting_line (meeting_id, agenda_id, track, kind, content, order_index)"
                " VALUES (:m, :g, 'human', 'action', '왕복 줄', 0) RETURNING id"
            ),
            {"m": meeting_id, "g": agenda_id},
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
    return {
        "account_id": account_id,
        "work_type_id": work_type_id,
        "meeting_id": meeting_id,
        "agenda_id": agenda_id,
        "line_id": line_id,
    }


def _cleanup(engine: Engine, seeded: dict[str, int]) -> None:
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM auth_session WHERE account_id = :a"), {"a": seeded["account_id"]}
        )
        conn.execute(text("DELETE FROM meeting_line WHERE meeting_id = :m"), {"m": seeded["meeting_id"]})
        conn.execute(text("DELETE FROM meeting_agenda WHERE meeting_id = :m"), {"m": seeded["meeting_id"]})
        conn.execute(text("DELETE FROM meeting WHERE id = :m"), {"m": seeded["meeting_id"]})
        conn.execute(text("DELETE FROM work_type WHERE id = :w"), {"w": seeded["work_type_id"]})
        conn.execute(text("DELETE FROM account WHERE id = :a"), {"a": seeded["account_id"]})


@pytest.mark.slow
def test_revision_0008_round_trip(sync_engine: Engine) -> None:
    """`0008` 왕복 — `pending_change` 값이 **`payload` 로 살아서** 옮겨지고, 통합 잔재가 사라진다(WORK-012 Phase 0)."""
    config = _alembic()
    seeded = _seed(sync_engine)
    try:
        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE meeting_line SET payload = :p WHERE id = :i"),
                {"p": '{"note": "이 값이 살아 옮겨져야 한다"}', "i": seeded["line_id"]},
            )

        command.downgrade(config, "0007_auth_session_meeting_token")

        with sync_engine.connect() as conn:
            columns = set(
                conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns"
                        " WHERE table_name = 'meeting_line'"
                    )
                ).scalars()
            )
            # 되감으면 옛 이름으로 돌아가고 값은 그대로다(RENAME 이라 데이터가 남는다)
            assert "payload" not in columns and "pending_change" in columns
            assert {"source_human_line_id", "source_ai_line_id"} <= columns
            assert (
                conn.execute(
                    text("SELECT pending_change ->> 'note' FROM meeting_line WHERE id = :i"),
                    {"i": seeded["line_id"]},
                ).scalar_one()
                == "이 값이 살아 옮겨져야 한다"
            )

        command.upgrade(config, "head")

        with sync_engine.connect() as conn:
            columns = set(
                conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns"
                        " WHERE table_name = 'meeting_line'"
                    )
                ).scalars()
            )
            assert "payload" in columns and "pending_change" not in columns
            # `source_*_line_id` · FK 2 · 부분 UNIQUE 2 · CHECK 가 DB 에 없다
            assert {"source_human_line_id", "source_ai_line_id"} & columns == set()
            indexes = set(
                conn.execute(
                    text("SELECT indexname FROM pg_indexes WHERE tablename = 'meeting_line'")
                ).scalars()
            )
            assert "uq_meeting_line_source_human_line_id" not in indexes
            assert "uq_meeting_line_source_ai_line_id" not in indexes
            assert (
                conn.execute(
                    text("SELECT payload ->> 'note' FROM meeting_line WHERE id = :i"),
                    {"i": seeded["line_id"]},
                ).scalar_one()
                == "이 값이 살아 옮겨져야 한다"
            )
            # `meeting.term_corrections` · CHECK 둘
            assert (
                conn.execute(
                    text(
                        "SELECT data_type FROM information_schema.columns"
                        " WHERE table_name = 'meeting' AND column_name = 'term_corrections'"
                    )
                ).scalar_one()
                == "jsonb"
            )
            checks = dict(
                conn.execute(
                    text(
                        "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint"
                        " WHERE conname IN ('ck_job_error_code', 'ck_meeting_batch_run_phase')"
                    )
                ).all()
            )
            assert "integration" not in checks["ck_meeting_batch_run_phase"]
            assert "transcription_failed" in checks["ck_job_error_code"]
            assert "integration_failed" not in checks["ck_job_error_code"]
    finally:
        _cleanup(sync_engine, seeded)


@pytest.mark.slow
def test_revision_0007_round_trip(sync_engine: Engine) -> None:
    """`0007` 왕복 — 두 칸 내려가 본다(`0008` 이 위에 얹혀 있으므로)."""
    config = _alembic()
    seeded = _seed(sync_engine)
    try:
        command.downgrade(config, "0006_job")

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


@pytest.mark.slow
def test_revision_0009_round_trip(sync_engine: Engine) -> None:
    """`0009` 왕복 — `work_type.description` 이 생기고 **기본 2건**에 시드 문구가 들어간다(WORK-013 Phase 2).

    **미팅·회의는 빈 값**(A-12 · DEC-003 OQ-11)이고, **사람이 적어 둔 설명은 다시 올려도 덮이지 않는다**.
    되감으면 컬럼과 값이 함께 사라진다.
    """
    config = _alembic()
    seeded = _seed(sync_engine)
    try:
        with sync_engine.begin() as conn:
            conn.execute(
                text("UPDATE work_type SET description = :d WHERE id = :i"),
                {"d": "사람이 적은 설명", "i": seeded["work_type_id"]},
            )

        command.downgrade(config, "-1")

        with sync_engine.connect() as conn:
            assert "description" not in _columns(conn, "work_type")

        command.upgrade(config, "head")

        with sync_engine.connect() as conn:
            assert "description" in _columns(conn, "work_type")
            # 되감기가 값을 지웠다 — 되살아나지 않는다(컬럼째 사라졌다)
            assert (
                conn.execute(
                    text("SELECT description FROM work_type WHERE id = :i"),
                    {"i": seeded["work_type_id"]},
                ).scalar_one()
                is None
            )
            seeded_descriptions = dict(
                conn.execute(
                    text(
                        "SELECT name, description FROM work_type"
                        " WHERE is_default = true AND account_id = :a"
                    ),
                    {"a": seeded["account_id"]},
                ).all()
            )
        # 이 계정에는 기본 유형이 없다(시드를 돌리지 않았다) — 문구는 **기본 유형에만** 들어간다
        assert seeded_descriptions == {}
    finally:
        _cleanup(sync_engine, seeded)


@pytest.mark.slow
def test_revision_0009_fills_the_two_default_descriptions(sync_engine: Engine) -> None:
    """기본 유형 3종을 심어 두고 왕복 — **개인 업무 · 문서·보고 두 건만** 채워지고 미팅·회의는 `NULL` 이다."""
    config = _alembic()
    seeded = _seed(sync_engine)
    try:
        with sync_engine.begin() as conn:
            for name, kind in (("미팅·회의", "meeting"), ("개인 업무", "task"), ("문서·보고", "task")):
                conn.execute(
                    text(
                        "INSERT INTO work_type (account_id, kind, name, color_token, is_default)"
                        " VALUES (:a, :k, :n, 'indigo', true)"
                    ),
                    {"a": seeded["account_id"], "k": kind, "n": name},
                )

        command.downgrade(config, "-1")
        command.upgrade(config, "head")

        with sync_engine.connect() as conn:
            filled = dict(
                conn.execute(
                    text(
                        "SELECT name, description FROM work_type"
                        " WHERE is_default = true AND account_id = :a"
                    ),
                    {"a": seeded["account_id"]},
                ).all()
            )
        assert filled == {
            "미팅·회의": None,
            "개인 업무": "혼자 처리하는 실무. 개발·수정·확인 등",
            "문서·보고": "산출물이 문서인 것. 기획서·보고서·회의록 정리",
        }
    finally:
        with sync_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM work_type WHERE account_id = :a AND is_default = true"),
                {"a": seeded["account_id"]},
            )
        _cleanup(sync_engine, seeded)

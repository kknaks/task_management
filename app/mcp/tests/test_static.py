"""WORK-009 Phase 2 정적 검사 — **경계가 코드로 남는다**(MF-68 · DEC-003 §8).

세 가지를 파일 내용으로 고정한다 —

1. `app/mcp/` 가 `app/back` 을 import 하지 않는다(back 의 모듈 이름도 마찬가지)
2. DB 드라이버·ORM 을 의존하지 않는다 — mcp 는 DB 를 모른다
3. 쓰기 HTTP 메서드를 부르지 않는다 — 도구 7개가 전부 조회다
"""

from __future__ import annotations

from pathlib import Path

import pytest

MCP_DIR = Path(__file__).resolve().parents[1]

# 검사 대상 — **컨테이너에 들어가는 코드만**(`.dockerignore` 가 `tests/` 를 뺀다).
# 검사 문자열 자체가 이 파일에 적혀 있어서, 테스트를 대상에 넣으면 검사가 스스로를 잡는다.
SOURCES = sorted(
    path
    for path in MCP_DIR.rglob("*.py")
    if ".venv" not in path.parts
    and "__pycache__" not in path.parts
    and "tests" not in path.parts
)

# back 을 끌어오는 모든 모양. `app.back` 뿐 아니라 back 의 최상위 모듈 이름도 막는다
BACK_IMPORTS = (
    "app.back",
    "from app import",
    "import models",
    "from models",
    "import service",
    "from service",
    "import repository",
    "from repository",
    "from config import",
)

# DB 로 바로 가는 길. 하나라도 붙으면 「두 번째 게이트」가 생긴다
DB_DRIVERS = ("sqlalchemy", "psycopg", "asyncpg", "alembic")

# 쓰기 — httpx 클라이언트의 메서드와 원형 호출 양쪽
WRITE_CALLS = (".post(", ".patch(", ".put(", ".delete(", '"POST"', '"PATCH"', '"DELETE"')


def test_sources_are_found() -> None:
    """검사가 **빈 목록을 통과시키지 않게** 한다."""
    names = {path.name for path in SOURCES}
    assert {"server.py", "tools.py"} <= names


@pytest.mark.parametrize("needle", BACK_IMPORTS)
def test_no_back_import(needle: str) -> None:
    offenders = [
        str(path.relative_to(MCP_DIR))
        for path in SOURCES
        if needle in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


@pytest.mark.parametrize("needle", DB_DRIVERS)
def test_no_database_dependency(needle: str) -> None:
    offenders = [
        str(path.relative_to(MCP_DIR))
        for path in SOURCES
        if needle in path.read_text(encoding="utf-8").lower()
    ]
    assert offenders == []
    assert needle not in (MCP_DIR / "pyproject.toml").read_text(encoding="utf-8").lower()


@pytest.mark.parametrize("needle", WRITE_CALLS)
def test_no_write_http_call(needle: str) -> None:
    offenders = [
        str(path.relative_to(MCP_DIR))
        for path in SOURCES
        if needle in path.read_text(encoding="utf-8")
    ]
    assert offenders == []

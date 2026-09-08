"""SPEC-004 §4 — **기간 조회 규칙 4종**(2026-09-06 사용자 확정 · DEC-002).

이전 규칙(「기한이 범위 안 **또는** 기한 없으면 생성일 기준 달」)을 대체한다.
**T-1-a 의 「기한 없는 업무는 생성일 기준 달에 속한다」는 폐기됐다** — R-2 가 그 자리를 갖는다.

| # | 무엇 | 조건 |
|---|---|---|
| R-1 | 계획 기간이 범위에 걸침 | 구간 겹침. 한쪽이 `NULL` 이면 있는 쪽을 점으로 본다 |
| R-2 | 기한 없음 | `due_date IS NULL` + 미완료 → **범위와 무관하게 항상** |
| R-3 | 지연 | `due_date < from` + 미완료 → 포함 |
| R-4 | 완료 · 취소 | 실적 시각이 범위 안일 때만. **`due_date` 로 거르지 않는다** |

**이 파일이 지키는 것은 「오늘 화면」이다.** 조회 단위가 월에서 일로 바뀌어
`from = to = 오늘` 이 기본 호출이 됐고, 끝 경계가 열려 있으면 **매일** 빈 화면이 된다
(WORK-005 검수 FAIL-① 이 같은 어긋남이었다 — 그때는 말일에만 터졌다).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models.task import Task, TaskLog
from tests.task_fixtures import TaskOwner, owner  # noqa: F401

BASE = "/api/tasks"


def _tz() -> ZoneInfo:
    return ZoneInfo(get_settings().app_timezone)


def _today() -> date:
    return datetime.now(_tz()).date()


def _day_param(day: date) -> str:
    """그 날의 KST `00:00` 을 **UTC ISO** 로 준다 — 프론트가 보내는 모양이다(G-2)."""
    return datetime.combine(day, time.min, tzinfo=_tz()).astimezone(UTC).isoformat()


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "기간 대상", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _ids(client: AsyncClient, owner: TaskOwner, **params: object) -> list[int]:
    response = await client.get(BASE, params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


async def _items_for_day(client: AsyncClient, owner: TaskOwner, day: date) -> list[dict]:
    """**`from = to = 그 날`** — 프론트의 기본 호출 모양 그대로다."""
    response = await client.get(
        BASE,
        params={"from": _day_param(day), "to": _day_param(day)},
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def _ids_for_day(client: AsyncClient, owner: TaskOwner, day: date) -> list[int]:
    return [item["id"] for item in await _items_for_day(client, owner, day)]


async def _complete(client: AsyncClient, owner: TaskOwner, task_id: int) -> None:
    """완료 게이트를 지나 실제로 완료시킨다(T-5) — 상태만 손으로 바꾸지 않는다."""
    await client.post(
        f"{BASE}/{task_id}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/x"},
        headers=owner.headers,
    )
    response = await client.patch(
        f"{BASE}/{task_id}/status", json={"status": "done"}, headers=owner.headers
    )
    assert response.status_code == 200, response.text


async def _backdate_completion(
    session: AsyncSession, task_id: int, moment: datetime
) -> None:
    """완료를 **과거로 옮긴다** — 실적의 정본은 전이 로그이므로 로그와 컬럼을 함께 옮긴다.

    테스트가 4초 실행취소 창을 기다릴 수 없어 시각을 손으로 옮긴다. 두 곳을 같이 옮기는 것이
    곧 「로그와 컬럼이 갈리지 않는다」(T-1-c)를 테스트가 지키는 방식이다.
    """
    log = (
        await session.scalars(
            select(TaskLog).where(TaskLog.task_id == task_id, TaskLog.to_status == "done")
        )
    ).one()
    log.created_at = moment
    task = (await session.scalars(select(Task).where(Task.id == task_id))).one()
    task.completed_at = moment
    await session.flush()


# --- 1. 끝 경계 ----------------------------------------------------------


async def test_from_equals_to_today_returns_todays_task(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**끝 경계가 닫혀 있다.** `from = to = 오늘` 이 오늘 기한 업무를 낸다.

    열려 있으면(`< to`) 이 호출이 **매일** 빈 목록을 준다 — 기본 진입이 오늘 하루이기 때문이다.
    """
    today = _today()
    task = await _create(client, owner, title="오늘 기한", dueDate=today.isoformat())

    assert task["id"] in await _ids_for_day(client, owner, today)


async def test_the_default_call_is_today(client: AsyncClient, owner: TaskOwner) -> None:
    """기간을 안 보내면 **오늘 하루**다(DEC-002 — 이전 「이번 달」을 대체한다)."""
    today = _today()
    todays = await _create(client, owner, title="오늘", dueDate=today.isoformat())
    next_week = await _create(
        client, owner, title="다음 주", dueDate=(today + timedelta(days=7)).isoformat()
    )

    ids = await _ids(client, owner)

    assert todays["id"] in ids
    # 미래 기한은 오늘 화면이 아니다 — 그게 「오늘 업무」의 뜻이다
    assert next_week["id"] not in ids


# --- 2·3. R-1 계획 기간 겹침 ---------------------------------------------


async def test_a_plan_period_spanning_the_day_is_included(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-1 — `start 09.04 ~ due 09.08` 업무가 **09.06 조회에 나온다.**

    양끝 어느 날짜도 조회일과 같지 않다 — **구간이 걸치는지**로 판단해야 잡힌다.
    """
    today = _today()
    task = await _create(
        client,
        owner,
        title="걸치는 기간",
        startDate=(today - timedelta(days=2)).isoformat(),
        dueDate=(today + timedelta(days=2)).isoformat(),
    )

    assert task["id"] in await _ids_for_day(client, owner, today)


async def test_a_start_date_only_task_shows_on_its_start_day(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-1 — 한쪽이 `NULL` 이면 **있는 쪽을 점으로** 본다. 시작일만 있으면 그 날 나온다."""
    today = _today()
    task = await _create(client, owner, title="시작일만", startDate=today.isoformat())

    assert task["id"] in await _ids_for_day(client, owner, today)


# --- 4·5. R-2 기한 없음 --------------------------------------------------


async def test_an_undated_unfinished_task_shows_in_every_range(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-2 — 기한 없는 **미완료** 업무는 **어떤 범위로 조회해도** 나온다.

    안 뜨면 영영 안 보이고 **기한을 정할 계기가 생기지 않는다**(사용자 근거).
    """
    today = _today()
    task = await _create(client, owner, title="기한 없음")

    assert task["id"] in await _ids_for_day(client, owner, today)
    assert task["id"] in await _ids_for_day(client, owner, today - timedelta(days=30))
    assert task["id"] in await _ids_for_day(client, owner, today + timedelta(days=30))


async def test_an_undated_completed_task_shows_only_on_the_day_it_was_completed(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """R-2 + R-4 — 완료되는 순간 「항상 뜨는」 규칙에서 빠지고 **실적 시각**으로 옮겨 간다.

    기한이 없어도 완료했으면 **완료한 날**에만 있다. 안 그러면 끝난 일이 매일 따라온다.
    """
    today = _today()
    task = await _create(client, owner, title="기한 없이 완료")
    await _complete(client, owner, task["id"])

    assert task["id"] in await _ids_for_day(client, owner, today)
    assert task["id"] not in await _ids_for_day(client, owner, today + timedelta(days=1))

    # 완료를 어제로 옮기면 오늘 화면에서 사라지고 어제 화면에 있다
    yesterday = today - timedelta(days=1)
    await _backdate_completion(
        db_session,
        task["id"],
        datetime.combine(yesterday, time(15, 0), tzinfo=_tz()),
    )

    assert task["id"] not in await _ids_for_day(client, owner, today)
    assert task["id"] in await _ids_for_day(client, owner, yesterday)


# --- 6. R-3 지연 ---------------------------------------------------------


async def test_an_overdue_unfinished_task_shows_today(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-3 — 어제 기한 · 미완료는 오늘 조회에 나온다.

    사라지면 **가장 봐야 할 것이 안 보인다**(사용자 근거).
    """
    today = _today()
    task = await _create(
        client,
        owner,
        title="어제 기한",
        dueDate=(today - timedelta(days=1)).isoformat(),
    )

    ids = await _ids_for_day(client, owner, today)

    assert task["id"] in ids


# --- 7·8. R-4 완료 · 취소 -----------------------------------------------


async def test_a_task_completed_yesterday_is_gone_from_today(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """R-4 — 어제 기한 · **어제 완료**는 오늘 조회에 **안 나온다.**

    끝난 일이 지연으로 따라오면 오늘 화면이 아니게 된다 — R-3 은 **미완료**만 태운다.
    """
    today = _today()
    yesterday = today - timedelta(days=1)
    task = await _create(client, owner, title="어제 기한", dueDate=yesterday.isoformat())
    await _complete(client, owner, task["id"])
    await _backdate_completion(
        db_session, task["id"], datetime.combine(yesterday, time(18, 0), tzinfo=_tz())
    )

    assert task["id"] not in await _ids_for_day(client, owner, today)
    assert task["id"] in await _ids_for_day(client, owner, yesterday)


async def test_a_task_completed_today_shows_today_even_if_it_was_due_yesterday(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-4 — 어제 기한 · **오늘 완료**는 **오늘 조회에 나온다.**

    **사용자 확정 규칙의 핵심이다** — 「오늘 완료 처리하면 오늘 완료 칸에 간다」.
    기한이 지났든 오늘이 아니든 **실적 시각**으로 간다. `due_date` 로 거르지 않는다.
    """
    today = _today()
    yesterday = today - timedelta(days=1)
    task = await _create(client, owner, title="어제 기한", dueDate=yesterday.isoformat())
    await _complete(client, owner, task["id"])

    assert task["id"] in await _ids_for_day(client, owner, today)
    # 어제 화면에는 없다 — 어제 끝낸 일이 아니다
    assert task["id"] not in await _ids_for_day(client, owner, yesterday)


async def test_a_cancelled_task_is_filtered_by_its_cancel_moment(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-4 — 취소도 실적 시각이다. 취소 시각의 정본은 **취소 전이 로그**다(T-8-a)."""
    today = _today()
    task = await _create(
        client,
        owner,
        title="지난달 기한 · 오늘 취소",
        dueDate=(today - timedelta(days=30)).isoformat(),
    )
    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "요건 변경"},
        headers=owner.headers,
    )

    assert task["id"] in await _ids_for_day(client, owner, today)
    # 기한이 있던 날에는 없다 — 취소는 `due_date` 로 걸리지 않는다
    assert task["id"] not in await _ids_for_day(
        client, owner, today - timedelta(days=30)
    )


async def test_a_revived_task_is_not_caught_by_its_old_cancel_moment(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**R-4 를 막는 것은 `status` 게이트다** — 실적 값이 아니라.

    실적 셋은 상태가 바뀌어도 남으므로(2026-09-06 확정), 되살아난 업무는 **옛 취소 시각을
    그대로 들고** 있다. 그 값으로 취소 갈래에 걸리면 「취소를 되돌렸는데 아직 오늘 취소 칸에
    있는」 업무가 된다 — 취소 갈래가 `status = 'cancelled'` 로 게이트돼 있어 막힌다.

    **기한을 미래로 둔 것이 이 테스트의 핵심**이다. 지난 기한이면 되살아난 뒤 R-3(지연)이
    오늘 화면에 다시 태워서 **어느 갈래로 들어왔는지 구분할 수 없다.** 미래 기한이면
    미완료 갈래(R-1~R-3) 중 어느 것도 오늘에 맞지 않아, 오늘 나타난다면 그것은
    **오직 옛 취소 시각 때문**이다.
    """
    today = _today()
    later = today + timedelta(days=10)
    task = await _create(
        client, owner, title="취소했다 되살림", dueDate=later.isoformat()
    )
    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "요건 변경"},
        headers=owner.headers,
    )
    # 취소한 날(오늘)에 뜬다 — 기한이 미래여도 실적 시각으로 걸린다(R-4)
    assert task["id"] in await _ids_for_day(client, owner, today)

    await client.patch(
        f"{BASE}/{task['id']}/status", json={"status": "todo"}, headers=owner.headers
    )

    # 취소 시각은 **남아 있다** — 지워서 막는 것이 아니다
    detail = await client.get(f"{BASE}/{task['id']}", headers=owner.headers)
    assert detail.json()["cancelledAt"] is not None
    assert detail.json()["status"] == "todo"

    # 그런데 오늘 화면에서는 사라진다 — 남은 취소 시각이 끌어오지 못한다
    assert task["id"] not in await _ids_for_day(client, owner, today)
    # 계획 기간 쪽으로는 정상적으로 돌아간다(R-1)
    assert task["id"] in await _ids_for_day(client, owner, later)


# --- 9. 계획 기간 검증 ---------------------------------------------------


async def test_a_start_date_after_the_due_date_is_rejected(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-1 — 둘 다 있으면 `start_date <= due_date`. 뒤집히면 **422** 다."""
    today = _today()

    response = await client.post(
        BASE,
        json={
            "title": "뒤집힌 기간",
            "workTypeId": owner.work_type_id,
            "startDate": (today + timedelta(days=1)).isoformat(),
            "dueDate": today.isoformat(),
        },
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_patching_into_a_reversed_period_is_rejected(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """부분 수정으로도 뒤집을 수 없다 — 검증은 **최종 값**을 본다."""
    today = _today()
    task = await _create(client, owner, dueDate=today.isoformat())

    response = await client.patch(
        f"{BASE}/{task['id']}",
        json={"startDate": (today + timedelta(days=3)).isoformat()},
        headers=owner.headers,
    )

    assert response.status_code == 422


async def test_the_database_refuses_a_reversed_period_too(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """CHECK 가 **최종 방어선**이다 — 서비스를 건너뛰어도 뒤집힌 기간은 저장되지 않는다."""
    today = _today()
    db_session.add(
        Task(
            account_id=owner.id,
            work_type_id=owner.work_type_id,
            title="DB 로 직접",
            start_date=today + timedelta(days=1),
            due_date=today,
        )
    )

    with pytest.raises(IntegrityError):
        await db_session.flush()


async def test_one_sided_plans_are_allowed(client: AsyncClient, owner: TaskOwner) -> None:
    """**한쪽만 있어도 된다** — 시작만, 종료만, 둘 다 없음이 전부 정상이다."""
    today = _today()

    start_only = await _create(client, owner, startDate=today.isoformat())
    due_only = await _create(client, owner, dueDate=today.isoformat())
    neither = await _create(client, owner)

    assert start_only["startDate"] == today.isoformat()
    assert start_only["dueDate"] is None
    assert due_only["startDate"] is None
    assert neither["startDate"] is None and neither["dueDate"] is None


# --- 집계가 같은 규칙을 쓴다 ----------------------------------------------


async def test_every_count_uses_the_same_period_rule(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """`total`·`statusCounts`·`unfilteredTotal`·`typeCounts` 가 **`items` 와 같은 규칙**을 센다.

    `_period_filter` 가 단일 진입점이 아니면 여기서 갈린다 — 화면의 「n건」과 칸반 컬럼 수가
    목록과 다른 말을 하기 시작한다.
    """
    today = _today()
    # 오늘 화면에 드는 것 셋 — 오늘 기한 · 기한 없음(R-2) · 어제 기한 미완료(R-3)
    await _create(client, owner, title="오늘 기한", dueDate=today.isoformat())
    await _create(client, owner, title="기한 없음")
    await _create(
        client, owner, title="지연", dueDate=(today - timedelta(days=1)).isoformat()
    )
    # 오늘 화면에 안 드는 것 — 다음 주 기한
    await _create(
        client, owner, title="다음 주", dueDate=(today + timedelta(days=7)).isoformat()
    )

    response = await client.get(
        BASE,
        params={"from": _day_param(today), "to": _day_param(today)},
        headers=owner.headers,
    )
    body = response.json()

    assert len(body["items"]) == 3
    assert body["total"] == 3
    assert body["unfilteredTotal"] == 3
    assert sum(body["statusCounts"].values()) == 3
    assert body["typeCounts"][0]["count"] == 3


async def test_a_completed_task_moves_between_the_counts_on_the_day_it_completes(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-4 가 `statusCounts` 에도 걸린다 — 칸반 완료 컬럼의 수가 **오늘 완료분**이다."""
    today = _today()
    task = await _create(
        client,
        owner,
        title="어제 기한",
        dueDate=(today - timedelta(days=1)).isoformat(),
    )

    before = await client.get(
        BASE,
        params={"from": _day_param(today), "to": _day_param(today)},
        headers=owner.headers,
    )
    assert before.json()["statusCounts"] == {
        "todo": 1,
        "inProgress": 0,
        "done": 0,
        "cancelled": 0,
    }

    await _complete(client, owner, task["id"])

    after = await client.get(
        BASE,
        params={"from": _day_param(today), "to": _day_param(today)},
        headers=owner.headers,
    )
    assert after.json()["statusCounts"] == {
        "todo": 0,
        "inProgress": 0,
        "done": 1,
        "cancelled": 0,
    }


# --- 정적 검사 — 지연 판정과 「미완료」 정의가 하나인가 --------------------


def _sources() -> dict[str, str]:
    """`app/back` 의 우리 코드만 읽는다(`.venv`·테스트 제외)."""
    root = Path(__file__).resolve().parents[1]
    skip = {".venv", "__pycache__", "tests", "alembic"}
    return {
        str(path.relative_to(root)): path.read_text()
        for path in root.rglob("*.py")
        if not skip & set(path.relative_to(root).parts)
    }


def test_overdue_is_decided_in_exactly_one_place() -> None:
    """**지연 판정은 `derive_overdue()` 하나를 지난다**(WORK-005 이후로 지켜온 것).

    두 번째 구현이 생기면 목록의 「n일 지남」과 상세 헤더가 다른 말을 하기 시작한다.
    호출처는 목록(repository)과 상세(service) 둘이고 **정의는 dto 하나**다.
    """
    sources = _sources()

    definitions = [name for name, body in sources.items() if "def derive_overdue(" in body]
    assert definitions == ["dto/task.py"], definitions

    callers = {name for name, body in sources.items() if "derive_overdue(" in body}
    assert callers == {
        "dto/task.py",
        "repository/task_repository.py",
        "service/task_service.py",
    }, callers


def test_the_unfinished_set_has_a_single_definition() -> None:
    """「미완료」의 정본은 `dto.enums.UNFINISHED_STATUSES` 하나다(SPEC-004 §4).

    조회 규칙 R-2·R-3 와 지연 파생이 같은 뜻의 「아직 안 끝났다」를 각자 적으면
    한쪽만 고쳐지는 날이 온다. **상태 문자열 쌍을 손으로 적은 곳이 없어야 한다.**
    """
    sources = _sources()

    definitions = [
        name for name, body in sources.items() if "UNFINISHED_STATUSES = " in body
    ]
    assert definitions == ["dto/enums.py"], definitions

    # `("done", "cancelled")` 같이 **손수 적은 쌍**이 남아 있지 않다.
    #
    # 네 값을 **전부** 적은 줄은 대상이 아니다 — 그건 「미완료/종결」을 가르는 것이 아니라
    # 상태 enum 자체를 늘어놓은 것이다(예: 계약의 `Literal` · CHECK 문구).
    handwritten = {
        f"{name}:{number}"
        for name, body in sources.items()
        if name != "dto/enums.py"
        for number, line in enumerate(body.splitlines(), start=1)
        if ('"todo", "in_progress"' in line or '"done", "cancelled"' in line)
        and not all(
            value in line
            for value in ('"todo"', '"in_progress"', '"done"', '"cancelled"')
        )
    }
    assert handwritten == set(), handwritten

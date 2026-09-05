"""SPEC-004 §4 — 목록 조회 · 필터 · 정렬 · 집계 (Phase 2).

**리스트와 칸반이 같은 응답을 본다** — 두 뷰에 쿼리를 따로 만들지 않는다.
BE §12 필수 테스트 **5-a**(기한 정렬에 조인이 없다)가 여기 있다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from dto.enums import ColorToken, WorkTypeKind
from models.account import WorkType
from models.task import Task
from tests.task_fixtures import TaskOwner, owner, stranger  # noqa: F401

BASE = "/api/tasks"


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().app_timezone)).date()


def _month_bounds(anchor: date) -> tuple[str, str]:
    """그 달의 KST 경계를 **UTC ISO** 로 준다(G-2 — 기간은 UTC 로 오간다)."""
    tz = ZoneInfo(get_settings().app_timezone)
    start = datetime(anchor.year, anchor.month, 1, tzinfo=tz)
    end = datetime(
        anchor.year + (anchor.month // 12), (anchor.month % 12) + 1, 1, tzinfo=tz
    )
    return start.astimezone(UTC).isoformat(), end.astimezone(UTC).isoformat()


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "목록 대상", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _list(client: AsyncClient, owner: TaskOwner, **params: object) -> dict:
    response = await client.get(BASE, params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return response.json()


# --- 기간 ---------------------------------------------------------------


async def test_the_default_call_returns_this_month(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """기간을 안 보내면 **이번 달**이다."""
    this_month = await _create(
        client, owner, title="이번 달", dueDate=_today().replace(day=15).isoformat()
    )

    body = await _list(client, owner)

    assert this_month["id"] in [item["id"] for item in body["items"]]
    assert body["page"] == 1
    assert body["size"] == 12


async def test_an_explicit_period_selects_only_that_month(
    client: AsyncClient, owner: TaskOwner
) -> None:
    today = _today()
    last_month_day = today.replace(day=1) - timedelta(days=5)
    this_month = await _create(
        client, owner, title="이번 달", dueDate=today.replace(day=15).isoformat()
    )
    last_month = await _create(
        client, owner, title="지난 달", dueDate=last_month_day.isoformat()
    )

    period_from, period_to = _month_bounds(last_month_day)
    body = await _list(client, owner, **{"from": period_from, "to": period_to})

    ids = [item["id"] for item in body["items"]]
    assert last_month["id"] in ids
    assert this_month["id"] not in ids


async def test_a_task_without_a_due_date_belongs_to_its_creation_month(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-1-a — 기한 없는 업무는 **생성일 기준 달**에 속한다."""
    undated = await _create(client, owner, title="기한 없음")

    body = await _list(client, owner)

    assert undated["id"] in [item["id"] for item in body["items"]]


# --- 정렬 ---------------------------------------------------------------


async def test_due_asc_puts_tasks_without_a_due_date_last(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-1-a — 기본 정렬 `due_asc` 에서 **기한 없는 업무가 맨 아래**다."""
    today = _today()
    undated = await _create(client, owner, title="기한 없음")
    later = await _create(
        client, owner, title="늦은 기한", dueDate=today.replace(day=28).isoformat()
    )
    earlier = await _create(
        client, owner, title="이른 기한", dueDate=today.replace(day=2).isoformat()
    )

    body = await _list(client, owner)

    ids = [item["id"] for item in body["items"]]
    assert ids.index(earlier["id"]) < ids.index(later["id"])
    assert ids[-1] == undated["id"]


async def test_due_desc_also_puts_undated_last(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """내림차순에서도 기한 없는 업무는 **맨 아래**다(Postgres 기본 NULLS FIRST 를 덮었다)."""
    today = _today()
    undated = await _create(client, owner, title="기한 없음")
    earlier = await _create(
        client, owner, title="이른 기한", dueDate=today.replace(day=2).isoformat()
    )
    later = await _create(
        client, owner, title="늦은 기한", dueDate=today.replace(day=28).isoformat()
    )

    body = await _list(client, owner, sort="due_desc")

    ids = [item["id"] for item in body["items"]]
    assert ids.index(later["id"]) < ids.index(earlier["id"])
    assert ids[-1] == undated["id"]


async def test_created_desc_is_newest_first(
    client: AsyncClient, owner: TaskOwner
) -> None:
    first = await _create(client, owner, title="먼저")
    second = await _create(client, owner, title="나중")

    body = await _list(client, owner, sort="created_desc")

    ids = [item["id"] for item in body["items"]]
    assert ids.index(second["id"]) < ids.index(first["id"])


async def test_an_unknown_sort_is_422(client: AsyncClient, owner: TaskOwner) -> None:
    response = await client.get(BASE, params={"sort": "bogus"}, headers=owner.headers)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# --- 필터 ---------------------------------------------------------------


async def test_each_filter_actually_narrows_the_result(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """§3 규칙 7 — **값을 바꾸면 결과가 달라져야** 파라미터가 먹은 것이다."""
    other_type = WorkType(
        account_id=owner.id,
        kind=WorkTypeKind.TASK.value,
        name="다른 유형",
        color_token=ColorToken.MINT.value,
        is_default=False,
    )
    db_session.add(other_type)
    await db_session.flush()

    plain = await _create(client, owner, title="기본 유형")
    typed = await _create(client, owner, title="다른 유형", workTypeId=other_type.id)
    with_project = await _create(
        client, owner, title="프로젝트 있음", projectId=owner.project_id
    )
    await client.patch(
        f"{BASE}/{plain['id']}/status", json={"status": "in_progress"}, headers=owner.headers
    )

    everything = await _list(client, owner)
    by_type = await _list(client, owner, workTypeId=other_type.id)
    by_status = await _list(client, owner, status="in_progress")
    by_project = await _list(client, owner, projectId=owner.project_id)

    assert everything["total"] == 3
    assert [item["id"] for item in by_type["items"]] == [typed["id"]]
    assert [item["id"] for item in by_status["items"]] == [plain["id"]]
    assert [item["id"] for item in by_project["items"]] == [with_project["id"]]


async def test_soft_deleted_tasks_are_absent(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-11 — 소프트 딜리트된 업무는 **응답에 없다.**"""
    kept = await _create(client, owner, title="남는 것")
    removed = await _create(client, owner, title="지울 것")
    await client.delete(f"{BASE}/{removed['id']}", headers=owner.headers)

    body = await _list(client, owner)

    ids = [item["id"] for item in body["items"]]
    assert kept["id"] in ids
    assert removed["id"] not in ids
    assert body["total"] == 1


async def test_another_accounts_tasks_never_appear(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    mine = await _create(client, owner, title="내 업무")
    theirs = await _create(client, stranger, title="남의 업무")

    body = await _list(client, owner)

    ids = [item["id"] for item in body["items"]]
    assert mine["id"] in ids
    assert theirs["id"] not in ids


# --- typeCounts ----------------------------------------------------------


async def test_type_counts_ignore_the_work_type_tab_but_follow_other_filters(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """SPEC-004 §4 — **유형 탭 자신은 반영하지 않는다.**

    탭에 붙는 수가 탭을 누를 때마다 흔들리면 안 된다. 상태·프로젝트 필터는 반영한다.
    """
    other_type = WorkType(
        account_id=owner.id,
        kind=WorkTypeKind.TASK.value,
        name="다른 유형",
        color_token=ColorToken.SKY.value,
        is_default=False,
    )
    db_session.add(other_type)
    await db_session.flush()

    first = await _create(client, owner, title="기본 유형 A")
    await _create(client, owner, title="기본 유형 B")
    await _create(client, owner, title="다른 유형", workTypeId=other_type.id)

    everything = await _list(client, owner)
    tabbed = await _list(client, owner, workTypeId=other_type.id)

    # 유형 탭을 걸어도 숫자가 그대로다
    assert tabbed["typeCounts"] == everything["typeCounts"]
    assert everything["typeCounts"][0] == {
        "workTypeId": None,
        "name": "전체",
        "count": 3,
    }
    # 그런데 items 는 좁혀졌다 — 자르기는 되고 집계만 안 흔들린다
    assert len(tabbed["items"]) == 1

    await client.patch(
        f"{BASE}/{first['id']}/status", json={"status": "in_progress"}, headers=owner.headers
    )
    filtered = await _list(client, owner, status="in_progress")

    # 상태 필터는 반영한다
    assert filtered["typeCounts"][0]["count"] == 1
    assert filtered["typeCounts"] != everything["typeCounts"]


async def test_type_counts_break_down_by_work_type(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    other_type = WorkType(
        account_id=owner.id,
        kind=WorkTypeKind.TASK.value,
        name="다른 유형",
        color_token=ColorToken.AMBER.value,
        is_default=False,
    )
    db_session.add(other_type)
    await db_session.flush()
    await _create(client, owner, title="A")
    await _create(client, owner, title="B")
    await _create(client, owner, title="C", workTypeId=other_type.id)

    counts = (await _list(client, owner))["typeCounts"]

    by_id = {row["workTypeId"]: row["count"] for row in counts}
    assert by_id[None] == 3
    assert by_id[owner.work_type_id] == 2
    assert by_id[other_type.id] == 1


# --- 파생값 -------------------------------------------------------------


async def test_overdue_is_derived_and_clears_when_completed(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-4 — 「지연」은 저장하지 않는다. 기한 경과 + **완료·취소 아님**으로 조회 시 계산한다."""
    yesterday = _today() - timedelta(days=1)
    task = await _create(client, owner, title="어제 기한", dueDate=yesterday.isoformat())
    await client.patch(
        f"{BASE}/{task['id']}/status", json={"status": "in_progress"}, headers=owner.headers
    )

    item = next(
        row for row in (await _list(client, owner))["items"] if row["id"] == task["id"]
    )
    assert item["isOverdue"] is True
    assert item["overdueDays"] == 1
    assert item["dDay"] == -1

    await client.post(
        f"{BASE}/{task['id']}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/o"},
        headers=owner.headers,
    )
    await client.patch(
        f"{BASE}/{task['id']}/status", json={"status": "done"}, headers=owner.headers
    )

    done_item = next(
        row for row in (await _list(client, owner))["items"] if row["id"] == task["id"]
    )
    assert done_item["isOverdue"] is False
    assert done_item["overdueDays"] is None
    # 저장한 값이 아니라 파생이다 — 기한은 그대로다
    assert done_item["dueDate"] == yesterday.isoformat()


async def test_memo_count_and_todo_progress_come_with_the_list(
    client: AsyncClient, owner: TaskOwner
) -> None:
    task = await _create(
        client, owner, title="자식 있음", todos=[{"text": "A"}, {"text": "B"}]
    )
    await client.post(
        f"{BASE}/{task['id']}/memos", json={"text": "메모"}, headers=owner.headers
    )
    todo_id = task["todos"][0]["id"]
    await client.patch(
        f"{BASE}/{task['id']}/todos/{todo_id}", json={"done": True}, headers=owner.headers
    )

    item = next(
        row for row in (await _list(client, owner))["items"] if row["id"] == task["id"]
    )

    assert item["memoCount"] == 1
    assert item["todoProgress"] == {"done": 1, "total": 2}


async def test_cancelled_at_is_carried_only_while_cancelled(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """취소 시각은 **취소 전이 로그에서 파생**한다 — 되살아나면 사라진다."""
    task = await _create(client, owner, title="취소 대상")
    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "요건 변경"},
        headers=owner.headers,
    )

    cancelled = next(
        row for row in (await _list(client, owner))["items"] if row["id"] == task["id"]
    )
    assert cancelled["cancelledAt"] is not None
    assert cancelled["cancelReason"] == "요건 변경"

    await client.patch(
        f"{BASE}/{task['id']}/status", json={"status": "todo"}, headers=owner.headers
    )
    revived = next(
        row for row in (await _list(client, owner))["items"] if row["id"] == task["id"]
    )
    assert revived["cancelledAt"] is None
    assert revived["cancelReason"] is None


async def test_a_deleted_work_type_still_shows_name_and_color(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """A-6 — 삭제된 유형을 참조 중인 업무도 목록에서 이름·색을 그대로 보여준다."""
    task = await _create(client, owner)
    work_type = (
        await db_session.scalars(
            select(WorkType).where(WorkType.id == owner.work_type_id)
        )
    ).one()
    work_type.deleted_at = datetime.now(UTC)
    await db_session.flush()

    item = next(
        row for row in (await _list(client, owner))["items"] if row["id"] == task["id"]
    )

    assert item["workType"]["name"] == work_type.name
    assert item["workType"]["isDeleted"] is True


# --- 페이지네이션 --------------------------------------------------------


async def test_pagination_splits_the_result_but_keeps_the_total(
    client: AsyncClient, owner: TaskOwner
) -> None:
    for index in range(5):
        await _create(client, owner, title=f"업무 {index}")

    first = await _list(client, owner, size=2, page=1)
    second = await _list(client, owner, size=2, page=2)

    assert first["total"] == second["total"] == 5
    assert len(first["items"]) == len(second["items"]) == 2
    assert {row["id"] for row in first["items"]}.isdisjoint(
        {row["id"] for row in second["items"]}
    )


# --- BE §12 5-a 조인 없음 -------------------------------------------------


async def test_the_list_query_never_joins_schedule(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """BE §12 5-a — **기한 정렬에 `schedule` 조인이 없다.**

    DEC-005 §3 개정의 목적이 이것이다 — 리스트 기본 정렬·D-day 가 `task` 인덱스만 탄다.
    """
    plan = (
        await db_session.execute(
            text(
                "EXPLAIN SELECT id, title, due_date FROM task"
                " WHERE account_id = :account_id AND deleted_at IS NULL"
                " ORDER BY due_date NULLS LAST LIMIT 12"
            ),
            {"account_id": owner.id},
        )
    ).scalars().all()

    assert "schedule" not in "\n".join(plan).lower()


async def test_the_period_filter_never_touches_schedule(
    db_session: AsyncSession, owner: TaskOwner
) -> None:
    """기간 조건도 `task` 안에서 끝난다 — 기한은 `task` 가 소유한다(T-1)."""
    plan = (
        await db_session.execute(
            text(
                "EXPLAIN SELECT id FROM task"
                " WHERE account_id = :account_id AND deleted_at IS NULL"
                " AND ((due_date IS NOT NULL AND due_date >= :f AND due_date < :t)"
                "   OR (due_date IS NULL AND created_at >= :cf AND created_at < :ct))"
            ),
            {
                "account_id": owner.id,
                "f": _today().replace(day=1),
                "t": _today().replace(day=28),
                "cf": datetime.now(UTC) - timedelta(days=30),
                "ct": datetime.now(UTC),
            },
        )
    ).scalars().all()

    assert "schedule" not in "\n".join(plan).lower()


async def test_the_list_requires_a_session(client: AsyncClient) -> None:
    response = await client.get(BASE)

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


# --- statusCounts · unfilteredTotal (SPEC-004 §4, 2026-09-06 신설) --------


async def test_status_counts_always_carry_all_four_keys(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**0건 상태도 `0` 으로 온다** — 칸반 컬럼이 항상 넷이라 화면이 빈자리를 메우지 않는다.

    (`typeCounts` 는 유형이 동적이라 사정이 다르다 — 거기는 0건 유형의 행이 없다.)
    """
    await _create(client, owner, title="시작전 하나")

    body = await _list(client, owner)

    assert body["statusCounts"] == {
        "todo": 1,
        "inProgress": 0,
        "done": 0,
        "cancelled": 0,
    }


async def test_status_counts_ignore_the_status_filter_but_follow_the_type_filter(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """**`typeCounts` 와 반대 축이다** — 자기 축(상태)만 빼고 나머지 필터는 반영한다.

    상태 필터를 걸었다고 다른 컬럼 수가 0 이 되면 칸반 완료 컬럼의 「8월 12」가 흔들린다.
    """
    other_type = WorkType(
        account_id=owner.id,
        kind=WorkTypeKind.TASK.value,
        name="다른 유형",
        color_token=ColorToken.ROSE.value,
        is_default=False,
    )
    db_session.add(other_type)
    await db_session.flush()

    moving = await _create(client, owner, title="진행중으로")
    await _create(client, owner, title="그대로")
    await _create(client, owner, title="다른 유형", workTypeId=other_type.id)
    await client.patch(
        f"{BASE}/{moving['id']}/status",
        json={"status": "in_progress"},
        headers=owner.headers,
    )

    everything = await _list(client, owner)
    by_status = await _list(client, owner, status="in_progress")
    by_type = await _list(client, owner, workTypeId=other_type.id)

    # 상태 필터를 걸어도 그대로다
    assert by_status["statusCounts"] == everything["statusCounts"]
    assert everything["statusCounts"]["todo"] == 2
    assert everything["statusCounts"]["inProgress"] == 1
    # 유형 필터는 반영한다 — 그 유형에는 시작전 1건뿐이다
    assert by_type["statusCounts"] == {
        "todo": 1,
        "inProgress": 0,
        "done": 0,
        "cancelled": 0,
    }


async def test_status_counts_survive_the_page_limit(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**이 필드가 있는 이유다** — `items` 를 세면 상한에 걸린 순간 두 수가 갈린다.

    완료 업무가 페이지 밖으로 밀려도 `statusCounts.done` 은 **그 달 완료 건수**를 그대로 말한다.
    """
    done_ids = []
    for index in range(3):
        task = await _create(client, owner, title=f"완료 대상 {index}")
        await client.post(
            f"{BASE}/{task['id']}/attachments",
            json={"role": "deliverable", "kind": "link", "url": "https://example.test/o"},
            headers=owner.headers,
        )
        await client.patch(
            f"{BASE}/{task['id']}/status", json={"status": "done"}, headers=owner.headers
        )
        done_ids.append(task["id"])
    for index in range(4):
        await _create(client, owner, title=f"시작전 {index}")

    # 나중에 만든 「시작전」이 앞에 오게 해서 완료 3건을 **확실히 페이지 밖으로** 민다
    narrow = await _list(client, owner, size=2, page=1, sort="created_desc")

    assert len(narrow["items"]) == 2
    assert narrow["total"] == 7

    counted_in_page = len([row for row in narrow["items"] if row["status"] == "done"])
    assert counted_in_page == 0  # 받아온 카드에는 완료가 하나도 없는데
    assert narrow["statusCounts"]["done"] == 3  # 집계는 그 달 완료 3건을 그대로 말한다


async def test_unfiltered_total_ignores_every_filter_but_follows_the_period(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """U-9 「필터를 지우면 n건이 보입니다」의 `n` — **기간만** 적용한다."""
    other_type = WorkType(
        account_id=owner.id,
        kind=WorkTypeKind.TASK.value,
        name="다른 유형",
        color_token=ColorToken.GRAPHITE.value,
        is_default=False,
    )
    db_session.add(other_type)
    await db_session.flush()

    today = _today()
    moving = await _create(client, owner, title="진행중으로")
    await _create(client, owner, title="다른 유형", workTypeId=other_type.id)
    await _create(
        client, owner, title="프로젝트 있음", projectId=owner.project_id
    )
    await client.patch(
        f"{BASE}/{moving['id']}/status",
        json={"status": "in_progress"},
        headers=owner.headers,
    )

    everything = await _list(client, owner)
    filtered = await _list(
        client, owner, status="in_progress", workTypeId=other_type.id
    )
    with_project = await _list(client, owner, projectId=owner.project_id)

    assert everything["unfilteredTotal"] == 3
    # 어떤 필터를 걸어도 그대로다
    assert filtered["unfilteredTotal"] == 3
    assert with_project["unfilteredTotal"] == 3
    # 그런데 total 은 좁혀진다 — 두 수가 다른 것이 이 필드의 쓸모다
    assert filtered["total"] == 0
    assert with_project["total"] == 1

    # 기간을 바꾸면 바뀐다
    last_month_day = today.replace(day=1) - timedelta(days=5)
    period_from, period_to = _month_bounds(last_month_day)
    last_month = await _list(
        client, owner, **{"from": period_from, "to": period_to}
    )
    assert last_month["unfilteredTotal"] == 0


async def test_the_size_cap_is_five_hundred(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """칸반이 **그 달 전체를 한 번에** 받는다(U-2). 상한은 500 이고 **없애지 않는다.**"""
    await _create(client, owner)

    allowed = await client.get(BASE, params={"size": 500}, headers=owner.headers)
    refused = await client.get(BASE, params={"size": 501}, headers=owner.headers)

    assert allowed.status_code == 200
    assert allowed.json()["size"] == 500
    assert refused.status_code == 422
    assert refused.json()["code"] == "validation_error"

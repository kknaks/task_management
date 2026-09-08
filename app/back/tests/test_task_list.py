"""SPEC-004 §4 — 목록 조회 · 필터 · 정렬 · 집계 (Phase 2).

**리스트와 칸반이 같은 응답을 본다** — 두 뷰에 쿼리를 따로 만들지 않는다.
BE §12 필수 테스트 **5-a**(기한 정렬에 조인이 없다)가 여기 있다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
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


def _day(anchor: date) -> str:
    """그 날의 KST `00:00` 을 **UTC ISO** 로 준다(G-2 — 기간은 UTC 로 오간다)."""
    tz = ZoneInfo(get_settings().app_timezone)
    return datetime.combine(anchor, time.min, tzinfo=tz).astimezone(UTC).isoformat()


def _range(first: date, last: date) -> dict[str, str]:
    """`from`·`to` 한 쌍. **양끝을 포함한다** — 끝 경계가 닫혀 있다(SPEC-004 §4).

    조회 단위가 월에서 일로 바뀌어(DEC-002 2026-09-06) 이 파일의 기본 범위도 하루다.
    범위를 넓혀야 하는 테스트만 `first != last` 를 준다.
    """
    return {"from": _day(first), "to": _day(last)}


def _wide(anchor: date) -> dict[str, str]:
    """그 날을 품는 **넉넉한 범위** — 「기간이 아니라 다른 축」을 보는 테스트가 쓴다."""
    return _range(anchor - timedelta(days=15), anchor + timedelta(days=15))


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "목록 대상", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _complete(client: AsyncClient, owner: TaskOwner, task_id: int) -> None:
    """완료 게이트를 지나 실제로 완료시킨다(T-5)."""
    await client.post(
        f"{BASE}/{task_id}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/o"},
        headers=owner.headers,
    )
    response = await client.patch(
        f"{BASE}/{task_id}/status", json={"status": "done"}, headers=owner.headers
    )
    assert response.status_code == 200, response.text


async def _list(client: AsyncClient, owner: TaskOwner, **params: object) -> dict:
    response = await client.get(BASE, params=params, headers=owner.headers)
    assert response.status_code == 200, response.text
    return response.json()


# --- 기간 ---------------------------------------------------------------


async def test_the_default_call_returns_today(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """기간을 안 보내면 **오늘 하루**다(DEC-002 2026-09-06 — 이전 「이번 달」을 대체한다)."""
    todays = await _create(client, owner, title="오늘", dueDate=_today().isoformat())

    body = await _list(client, owner)

    assert todays["id"] in [item["id"] for item in body["items"]]
    assert body["page"] == 1
    assert body["size"] == 12


async def test_an_explicit_period_selects_only_that_range(
    client: AsyncClient, owner: TaskOwner
) -> None:
    today = _today()
    far = today - timedelta(days=40)
    near = await _create(client, owner, title="오늘", dueDate=today.isoformat())
    old = await _create(client, owner, title="옛날", dueDate=far.isoformat())
    # **완료시킨다** — 미완료면 R-3(지연)이 오늘 범위로도 끌어온다
    await _complete(client, owner, old["id"])

    body = await _list(client, owner, **_range(far, far))

    ids = [item["id"] for item in body["items"]]
    assert near["id"] not in ids


async def test_a_task_without_a_due_date_shows_every_day(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """R-2 — 기한 없는 미완료 업무는 **범위와 무관하게 항상** 나온다.

    ~~T-1-a 「생성일 기준 달에 속한다」~~ 는 폐기됐다(DEC-002 2026-09-06).
    규칙 전체는 `test_task_period.py` 가 지킨다.
    """
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
        client, owner, title="늦은 기한", dueDate=(today + timedelta(days=3)).isoformat()
    )
    earlier = await _create(
        client, owner, title="이른 기한", dueDate=(today - timedelta(days=3)).isoformat()
    )

    body = await _list(client, owner, **_wide(today))

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
        client, owner, title="이른 기한", dueDate=(today - timedelta(days=3)).isoformat()
    )
    later = await _create(
        client, owner, title="늦은 기한", dueDate=(today + timedelta(days=3)).isoformat()
    )

    body = await _list(client, owner, sort="due_desc", **_wide(today))

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


async def test_cancelled_at_survives_a_revival(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**취소 시각은 되살아나도 남는다**(2026-09-06 코디 확정 — 이전 마스킹 규칙을 뒤집는다).

    실적 셋(`startedAt`·`completedAt`·`cancelledAt`)은 전부 「**마지막으로 그 상태에 들어간
    시각**」이고 상태가 바뀌어도 지우지 않는다 — 셋 다 전이 로그의 materialization 이라
    응답에서만 지우면 컬럼과 응답이 갈린다(T-1-c).

    `cancelReason` 은 **반대로 사라진다** — 저건 사용자 입력이라 떠날 때 비우는 게 맞고(T-7),
    취소 시각은 시스템 이력이라 남는 게 맞다. 이 테스트가 그 둘의 차이를 고정한다.

    (승격 전에는 「되살아나면 `cancelledAt` 이 null」이었다. 그때는 컬럼이 없어
    파생 서브쿼리를 응답에서 가리는 것이 유일한 규칙이었다.)
    """
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

    assert revived["cancelledAt"] == cancelled["cancelledAt"]
    # 사용자 입력은 떠날 때 비워진다 — T-7 이 그것을 DB 로도 강제한다
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
    """기간 조건도 `task` 안에서 끝난다 — 일정 4필드는 `task` 가 소유한다(T-1).

    R-4 의 실적 시각까지 `task` 컬럼이라 **취소분을 뺀 조회 규칙 전체가 `task` 한 테이블**이다
    (취소 시각만 `task_log` 를 본다 — 그것도 `schedule` 이 아니다).
    """
    today = _today()
    plan = (
        await db_session.execute(
            text(
                "EXPLAIN SELECT id FROM task"
                " WHERE account_id = :account_id AND deleted_at IS NULL"
                " AND ((status IN ('todo', 'in_progress')"
                "       AND (   (COALESCE(start_date, due_date) <= :t"
                "                AND COALESCE(due_date, start_date) >= :f)"
                "            OR due_date IS NULL"
                "            OR due_date < :f))"
                "   OR (status = 'done'"
                "       AND completed_at >= :mf AND completed_at < :mt))"
            ),
            {
                "account_id": owner.id,
                "f": today,
                "t": today,
                "mf": datetime.now(UTC) - timedelta(days=1),
                "mt": datetime.now(UTC),
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

    # 기간을 바꿔도 **R-2 가 태우는 기한 없는 업무 3건은 그대로 따라온다** —
    # 「기한 없는 미완료는 어떤 범위로 조회해도 나온다」가 그 뜻이다.
    far = today - timedelta(days=40)
    elsewhere = await _list(client, owner, **_range(far, far))
    assert elsewhere["unfilteredTotal"] == 3


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

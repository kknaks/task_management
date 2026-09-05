"""SPEC-003 §4 — 업무 본체 계약과 Case Matrix (Phase 2).

정본: SPEC-003 §4(API·Validation·Case Matrix) · §5(규칙) · `domains/task.md` T-1~T-11.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from models.account import Project, WorkType
from models.task import Task
from service import schedule_service
from tests.task_fixtures import TaskOwner, owner, stranger  # noqa: F401

BASE = "/api/tasks"
DAY = "2026-09-10"


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().app_timezone)).date()


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "제품 소개서 내용 업데이트", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


# --- 생성 ---------------------------------------------------------------


async def test_title_and_work_type_alone_create_a_task(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """제목 + 유형만으로 만들어지고 **상태는 항상 「시작전」**이다(DEC-002 §5)."""
    created = await _create(client, owner)

    assert created["status"] == "todo"
    assert created["project"] is None  # T-3 — 무소속 허용
    assert created["workType"]["id"] == owner.work_type_id
    assert created["workType"]["isDeleted"] is False
    assert created["dueDate"] is None
    assert created["dDay"] is None
    assert created["isOverdue"] is False
    assert created["todoProgress"] == {"done": 0, "total": 0}
    assert created["relationTotal"] == 0
    # T-8 — 생성은 로그를 남긴다
    assert [log["text"] for log in created["logs"]] == ["업무 생성"]


async def test_the_detail_matches_what_creation_returned(
    client: AsyncClient, owner: TaskOwner
) -> None:
    created = await _create(client, owner)

    fetched = await client.get(f"{BASE}/{created['id']}", headers=owner.headers)

    assert fetched.status_code == 200
    assert fetched.json() == created


async def test_a_project_can_be_attached(client: AsyncClient, owner: TaskOwner) -> None:
    created = await _create(client, owner, projectId=owner.project_id)

    assert created["project"]["id"] == owner.project_id
    assert created["project"]["isDeleted"] is False


async def test_missing_work_type_is_422_validation_error(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """T-2 — 유형은 **필수**다."""
    response = await client.post(BASE, json={"title": "유형 없음"}, headers=owner.headers)

    assert response.status_code == 422
    assert response.json() == {
        "detail": "입력값을 확인해 주세요",
        "code": "validation_error",
    }


async def test_a_deleted_work_type_is_422_invalid_work_type(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """삭제된 유형을 주면 `invalid_work_type` 이다(SPEC-003 §4 Case Matrix)."""
    work_type = (
        await db_session.scalars(
            select(WorkType).where(WorkType.id == owner.work_type_id)
        )
    ).one()
    work_type.deleted_at = datetime.now(UTC)
    await db_session.flush()

    response = await client.post(
        BASE,
        json={"title": "삭제된 유형", "workTypeId": owner.work_type_id},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "사용할 수 없는 유형입니다",
        "code": "invalid_work_type",
    }


async def test_another_accounts_work_type_is_rejected(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    """남의 유형도 「사용할 수 없는 유형」이다 — 존재를 흘리지 않는다."""
    response = await client.post(
        BASE,
        json={"title": "남의 유형", "workTypeId": stranger.work_type_id},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_work_type"


async def test_a_status_field_is_rejected_on_create(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**생성 드로어에 상태 필드가 없다**(U-1) — 보내면 거부한다."""
    response = await client.post(
        BASE,
        json={
            "title": "상태 지정",
            "workTypeId": owner.work_type_id,
            "status": "in_progress",
        },
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_children_are_saved_in_the_same_request(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """§5 — 드로어에 넣은 할일·첨부·연관업무가 **함께** 저장된다."""
    other = await _create(client, owner, title="연결 대상")

    created = await _create(
        client,
        owner,
        title="자식 포함",
        todos=[{"text": "필요사항 체크"}, {"text": "리뷰 요청"}],
        attachments=[
            {"role": "reference", "kind": "link", "url": "https://example.test/a"}
        ],
        relatedTaskIds=[other["id"]],
    )

    assert [todo["text"] for todo in created["todos"]] == ["필요사항 체크", "리뷰 요청"]
    assert created["todoProgress"] == {"done": 0, "total": 2}
    assert len(created["attachments"]) == 1
    assert created["attachments"][0]["url"] == "https://example.test/a"
    assert created["relationTotal"] == 1
    assert created["relations"][0]["id"] == other["id"]


async def test_a_bad_child_prevents_the_whole_task(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner, stranger: TaskOwner
) -> None:
    """**부분 저장이 없다** — 자식 하나가 틀리면 업무 본체도 만들어지지 않는다(§5)."""
    stranger_task = await _create(client, stranger, title="남의 업무")

    response = await client.post(
        BASE,
        json={
            "title": "절반만 저장되면 안 된다",
            "workTypeId": owner.work_type_id,
            "todos": [{"text": "할일"}],
            "relatedTaskIds": [stranger_task["id"]],
        },
        headers=owner.headers,
    )

    assert response.status_code == 422

    rows = (
        await db_session.scalars(
            select(Task).where(Task.title == "절반만 저장되면 안 된다")
        )
    ).all()
    assert rows == []


@pytest.mark.parametrize(
    "body",
    [
        {"title": "", "workTypeId": 1},
        {"title": "   ", "workTypeId": 1},
        {"title": "가" * 201, "workTypeId": 1},
        {"title": "줄\n바꿈", "workTypeId": 1},
        # T-1-b — 시각 하나만
        {"title": "시각 하나", "workTypeId": 1, "dueDate": DAY, "dueStartTime": "14:00"},
        # T-1-b — 기한 없이 시각만
        {
            "title": "기한 없는 시각",
            "workTypeId": 1,
            "dueStartTime": "14:00",
            "dueEndTime": "15:00",
        },
        # end <= start
        {
            "title": "거꾸로",
            "workTypeId": 1,
            "dueDate": DAY,
            "dueStartTime": "15:00",
            "dueEndTime": "14:00",
        },
    ],
)
async def test_invalid_create_body_is_422(
    client: AsyncClient, owner: TaskOwner, body: dict
) -> None:
    body = {**body, "workTypeId": owner.work_type_id}

    response = await client.post(BASE, json=body, headers=owner.headers)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


# --- 기한 → 일정 파생 ----------------------------------------------------


async def test_a_due_date_derives_an_all_day_schedule(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    created = await _create(client, owner, dueDate=DAY)

    placement = await schedule_service.find_task_placement(
        db_session, task_id=created["id"]
    )
    assert placement is not None
    assert placement.is_all_day is True


async def test_times_derive_a_timed_schedule(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    created = await _create(
        client, owner, dueDate=DAY, dueStartTime="14:00", dueEndTime="15:00"
    )

    assert created["dueStartTime"] == "14:00:00"
    placement = await schedule_service.find_task_placement(
        db_session, task_id=created["id"]
    )
    assert placement is not None
    assert placement.is_all_day is False


async def test_clearing_the_due_date_removes_the_schedule(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """`{"dueDate": null}` 은 기한 삭제이고 **파생 일정도 사라진다**(§4)."""
    created = await _create(
        client, owner, dueDate=DAY, dueStartTime="14:00", dueEndTime="15:00"
    )

    patched = await client.patch(
        f"{BASE}/{created['id']}", json={"dueDate": None}, headers=owner.headers
    )

    assert patched.status_code == 200
    assert patched.json()["dueDate"] is None
    # T-1-b — 시각만 남는 상태를 만들지 않는다
    assert patched.json()["dueStartTime"] is None
    assert patched.json()["dueEndTime"] is None
    assert (
        await schedule_service.find_task_placement(db_session, task_id=created["id"])
        is None
    )


# --- 겹침 ---------------------------------------------------------------


async def test_an_overlapping_due_time_is_409_and_nothing_is_written(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """C-9 — 겹치면 거부하고 **`task` 행의 기한이 그대로**다(원본도 안 바뀐다)."""
    await _create(
        client, owner, title="선점", dueDate=DAY, dueStartTime="14:00", dueEndTime="15:00"
    )
    target = await _create(client, owner, title="나중")

    response = await client.patch(
        f"{BASE}/{target['id']}",
        json={"dueDate": DAY, "dueStartTime": "14:30", "dueEndTime": "15:30"},
        headers=owner.headers,
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "그 시간에 다른 일정이 있습니다",
        "code": "schedule_overlap",
    }

    row = (
        await db_session.scalars(select(Task).where(Task.id == target["id"]))
    ).one()
    assert row.due_date is None
    assert row.due_start_time is None


async def test_a_touching_boundary_is_saved(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """C-8 — 14–15 다음 15–16 은 **저장된다.**"""
    await _create(
        client, owner, title="선점", dueDate=DAY, dueStartTime="14:00", dueEndTime="15:00"
    )
    target = await _create(client, owner, title="경계")

    response = await client.patch(
        f"{BASE}/{target['id']}",
        json={"dueDate": DAY, "dueStartTime": "15:00", "dueEndTime": "16:00"},
        headers=owner.headers,
    )

    assert response.status_code == 200
    assert response.json()["dueStartTime"] == "15:00:00"


async def test_creating_with_an_overlapping_time_is_rejected(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """생성에서도 **원본을 쓰기 전에** 검사한다 — 업무가 만들어지지 않는다."""
    await _create(
        client, owner, title="선점", dueDate=DAY, dueStartTime="14:00", dueEndTime="15:00"
    )

    response = await client.post(
        BASE,
        json={
            "title": "겹치는 생성",
            "workTypeId": owner.work_type_id,
            "dueDate": DAY,
            "dueStartTime": "14:30",
            "dueEndTime": "15:30",
        },
        headers=owner.headers,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "schedule_overlap"
    rows = (
        await db_session.scalars(select(Task).where(Task.title == "겹치는 생성"))
    ).all()
    assert rows == []


async def test_moving_a_task_within_its_own_slot_is_allowed(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """자기 옛 일정과는 겹치지 않는다 — 같은 업무의 기한을 옮기는 경우다."""
    created = await _create(
        client, owner, dueDate=DAY, dueStartTime="14:00", dueEndTime="15:00"
    )

    response = await client.patch(
        f"{BASE}/{created['id']}",
        json={"dueStartTime": "14:30", "dueEndTime": "15:30"},
        headers=owner.headers,
    )

    assert response.status_code == 200


# --- 부분 수정 -----------------------------------------------------------


async def test_patch_changes_only_what_was_sent_and_writes_no_log(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """인라인 편집은 **로그에 남지 않는다**(04-task-detail · U-10)."""
    created = await _create(client, owner, background="이전 배경", goal="이전 목표")

    patched = await client.patch(
        f"{BASE}/{created['id']}", json={"background": "새 배경"}, headers=owner.headers
    )

    assert patched.status_code == 200
    body = patched.json()
    assert body["background"] == "새 배경"
    assert body["goal"] == "이전 목표"
    assert body["title"] == created["title"]
    # 로그가 늘지 않았다
    assert [log["text"] for log in body["logs"]] == ["업무 생성"]


async def test_patch_rejects_status(client: AsyncClient, owner: TaskOwner) -> None:
    """**상태 전이는 이 표면이 아니다** — WORK-005 의 전용 엔드포인트다(§4)."""
    created = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"status": "done"}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

    unchanged = await client.get(f"{BASE}/{created['id']}", headers=owner.headers)
    assert unchanged.json()["status"] == "todo"


async def test_patch_rejects_an_explicit_null_title(
    client: AsyncClient, owner: TaskOwner
) -> None:
    created = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"title": None}, headers=owner.headers
    )

    assert response.status_code == 422


async def test_patch_can_clear_the_project(client: AsyncClient, owner: TaskOwner) -> None:
    """`projectId: null` 은 **무소속으로 되돌리기**다 — 「보내지 않음」과 다르다(§5)."""
    created = await _create(client, owner, projectId=owner.project_id)

    patched = await client.patch(
        f"{BASE}/{created['id']}", json={"projectId": None}, headers=owner.headers
    )

    assert patched.status_code == 200
    assert patched.json()["project"] is None


async def test_patch_to_a_deleted_work_type_is_rejected(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    created = await _create(client, owner)
    work_type = (
        await db_session.scalars(
            select(WorkType).where(WorkType.id == owner.work_type_id)
        )
    ).one()
    work_type.deleted_at = datetime.now(UTC)
    await db_session.flush()

    response = await client.patch(
        f"{BASE}/{created['id']}",
        json={"workTypeId": owner.work_type_id},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_work_type"


# --- 파생값 -------------------------------------------------------------


async def test_d_day_and_is_overdue_are_derived(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """G-7 — 서버가 계산해 내려준다. 화면이 날짜 계산을 다시 하지 않는다."""
    today = _today()

    today_task = await _create(client, owner, title="오늘", dueDate=today.isoformat())
    assert today_task["dDay"] == 0
    assert today_task["isOverdue"] is False

    future = await _create(
        client, owner, title="사흘 뒤", dueDate=(today + timedelta(days=3)).isoformat()
    )
    assert future["dDay"] == 3
    assert future["isOverdue"] is False

    past = await _create(
        client, owner, title="지난", dueDate=(today - timedelta(days=2)).isoformat()
    )
    assert past["dDay"] == -2
    # T-4 — 「지연」은 값이 아니라 파생이다
    assert past["isOverdue"] is True


# --- 참조 표시 (A-6) -----------------------------------------------------


async def test_a_deleted_work_type_still_shows_its_name_and_color(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """A-6 — 삭제된 유형·프로젝트를 참조 중인 업무는 **이름·색을 그대로** 보여준다."""
    created = await _create(client, owner, projectId=owner.project_id)
    name = created["workType"]["name"]
    color = created["workType"]["colorToken"]

    for model, row_id in ((WorkType, owner.work_type_id), (Project, owner.project_id)):
        row = (await db_session.scalars(select(model).where(model.id == row_id))).one()
        row.deleted_at = datetime.now(UTC)
    await db_session.flush()

    fetched = (await client.get(f"{BASE}/{created['id']}", headers=owner.headers)).json()

    assert fetched["workType"]["name"] == name
    assert fetched["workType"]["colorToken"] == color
    assert fetched["workType"]["isDeleted"] is True
    assert fetched["project"]["name"] is not None
    assert fetched["project"]["isDeleted"] is True


# --- 소유 검사 · 인증 게이트 ---------------------------------------------


async def test_another_accounts_task_is_404(
    client: AsyncClient, owner: TaskOwner, stranger: TaskOwner
) -> None:
    """§5 — 남의 업무는 **404** 다. 403 이면 존재가 샌다."""
    mine = await _create(client, owner, title="내 업무")

    fetched = await client.get(f"{BASE}/{mine['id']}", headers=stranger.headers)
    patched = await client.patch(
        f"{BASE}/{mine['id']}", json={"title": "가로채기"}, headers=stranger.headers
    )

    assert fetched.status_code == patched.status_code == 404
    assert fetched.json() == {"detail": "업무를 찾을 수 없습니다", "code": "not_found"}

    unchanged = await client.get(f"{BASE}/{mine['id']}", headers=owner.headers)
    assert unchanged.json()["title"] == "내 업무"


async def test_a_missing_task_is_404(client: AsyncClient, owner: TaskOwner) -> None:
    response = await client.get(f"{BASE}/987654321", headers=owner.headers)

    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_a_soft_deleted_task_is_404_but_the_row_survives(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """T-11 — 소프트 딜리트분은 조회에서 빠지고 **행은 남는다**.

    삭제 표면은 이 work 에 없다(WORK-005 몫) — 스키마와 조회 규약만 확인한다.
    """
    created = await _create(client, owner)
    row = (await db_session.scalars(select(Task).where(Task.id == created["id"]))).one()
    row.deleted_at = datetime.now(UTC)
    await db_session.flush()

    response = await client.get(f"{BASE}/{created['id']}", headers=owner.headers)

    assert response.status_code == 404
    survived = (
        await db_session.scalars(select(Task).where(Task.id == created["id"]))
    ).one()
    assert survived.deleted_at is not None


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", BASE, {"title": "무단", "workTypeId": 1}),
        ("GET", f"{BASE}/1", None),
        ("PATCH", f"{BASE}/1", {"title": "무단"}),
        ("POST", f"{BASE}/1/todos", {"text": "무단"}),
        ("POST", f"{BASE}/1/memos", {"text": "무단"}),
        ("POST", f"{BASE}/1/attachments", {"role": "reference", "kind": "link"}),
        ("POST", f"{BASE}/1/relations", {"taskIds": []}),
    ],
)
async def test_every_surface_requires_a_session(
    client: AsyncClient, method: str, path: str, body: dict | None
) -> None:
    """§4 권한 = 세션. 라우터 단위로 걸려 있어 빠진 표면이 없다."""
    response = await client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.json()["code"] == "token_expired"


async def test_there_is_no_schedule_write_surface(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**`schedule` 쓰기 표면이 없다** — 파생은 단방향이라 원본을 고친다(C-3 · BE-10).

    상태 전이 표면(`PATCH /{id}/status`)은 **WORK-005 가 만들었다** — 그 계약은
    `tests/test_task_status.py` 가 본다. 여기서는 「없어야 하는 것」만 남긴다.
    """
    for method, path in (
        ("PATCH", "/api/schedules/1"),
        ("POST", "/api/schedules"),
        ("DELETE", "/api/schedules/1"),
    ):
        response = await client.request(
            method, path, json={"startAt": "2026-09-10T05:00:00Z"}, headers=owner.headers
        )
        assert response.status_code in (404, 405), f"{method} {path} → {response.status_code}"


async def test_the_general_patch_still_refuses_status(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """WORK-005 가 전용 표면을 만든 뒤에도 **일반 PATCH 는 상태를 받지 않는다**(BE §10).

    게이트 우회 경로를 스키마 층에서 막는 것이라 전용 엔드포인트가 생겨도 그대로다.
    """
    created = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"status": "done"}, headers=owner.headers
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

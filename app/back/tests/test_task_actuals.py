"""T-1-c — **실적 3컬럼**(`started_at`·`completed_at`·`cancelled_at`)과 실행취소.

실적은 사용자가 보내는 값이 아니다. **상태 전이 시점에 서비스가 전이 로그와 같은 트랜잭션에서**
쓴다. 그래서 이 파일이 지키는 것은 세 가지다 —

1. 요청으로는 못 쓴다(일반 PATCH 로 오면 `422`)
2. 전이가 쓰고, **로그와 갈리지 않는다**
3. **실행취소가 함께 되돌린다** — 로그만 지우고 컬럼을 남기면 「완료 취소했는데 완료 시각이
   남은」 업무가 되고, R-4 가 그 값으로 거르므로 **오늘 완료 칸에 그대로 붙어 있게 된다**

`cancelled_at` 은 2026-09-06 에 로그 파생에서 **컬럼으로 승격**했다(T-8-a 번복) — 셋이
같은 함수(`sync_actuals`)에서 로그로 다시 계산되므로 「어긋날 수 있는 두 번째 사실」이 아니다.

`description` 계약(2026-09-06 — 배경·목표를 합쳤다)도 여기서 함께 본다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.task import Task, TaskLog
from tests.task_fixtures import TaskOwner, owner  # noqa: F401

BASE = "/api/tasks"


async def _create(client: AsyncClient, owner: TaskOwner, **overrides: object) -> dict:
    body: dict = {"title": "실적 대상", "workTypeId": owner.work_type_id}
    body.update(overrides)
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 201, response.text
    return response.json()


async def _status(
    client: AsyncClient, owner: TaskOwner, task_id: int, value: str
) -> dict:
    response = await client.patch(
        f"{BASE}/{task_id}/status", json={"status": value}, headers=owner.headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _detail(client: AsyncClient, owner: TaskOwner, task_id: int) -> dict:
    response = await client.get(f"{BASE}/{task_id}", headers=owner.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _open_the_gate(client: AsyncClient, owner: TaskOwner, task_id: int) -> None:
    await client.post(
        f"{BASE}/{task_id}/attachments",
        json={"role": "deliverable", "kind": "link", "url": "https://example.test/x"},
        headers=owner.headers,
    )


async def _transition_moment(session: AsyncSession, task_id: int, to: str) -> datetime:
    """전이 로그의 시각 — **실적의 정본**이다(T-8-a). 그 상태로 간 전이가 **한 번**일 때 쓴다."""
    return (
        await session.scalars(
            select(TaskLog.created_at).where(
                TaskLog.task_id == task_id, TaskLog.to_status == to
            )
        )
    ).one()


async def _backdate_cancel(
    session: AsyncSession, task_id: int, moment: datetime
) -> None:
    """첫 취소를 **과거로 옮긴다** — 로그와 컬럼을 함께(로그가 정본이고 컬럼은 그 파생이다).

    **테스트 환경 사정**: `created_at` 의 기본값이 `now()` 인데 Postgres 의 `now()` 는
    **트랜잭션 시각**이고, 픽스처가 테스트 하나를 한 트랜잭션으로 감싼다. 그래서 같은 테스트
    안에서 두 번 취소하면 두 로그의 시각이 **같다** — 실제 서비스에서는 요청마다 트랜잭션이
    갈려 다르다. 「덮어썼다」를 진짜로 보려면 앞의 것을 옮겨야 한다.
    """
    log = (
        await session.scalars(
            select(TaskLog).where(
                TaskLog.task_id == task_id, TaskLog.to_status == "cancelled"
            )
        )
    ).one()
    log.created_at = moment
    task = (await session.scalars(select(Task).where(Task.id == task_id))).one()
    task.cancelled_at = moment
    await session.flush()


async def _last_transition_moment(
    session: AsyncSession, task_id: int, to: str
) -> datetime:
    """그 상태로 간 **마지막** 전이의 시각 — `sync_actuals` 가 쓰는 것과 같은 값(MAX)이다."""
    return (
        await session.scalars(
            select(func.max(TaskLog.created_at)).where(
                TaskLog.task_id == task_id, TaskLog.to_status == to
            )
        )
    ).one()


# --- 요청으로 쓸 수 없다 --------------------------------------------------


async def test_a_new_task_has_no_actuals(client: AsyncClient, owner: TaskOwner) -> None:
    """생성 시점에는 어떤 전이도 없었으므로 **셋 다** `null` 이다."""
    task = await _create(client, owner)

    assert task["startedAt"] is None
    assert task["completedAt"] is None
    assert task["cancelledAt"] is None


@pytest.mark.parametrize("field", ["startedAt", "completedAt", "cancelledAt"])
async def test_the_general_patch_refuses_actuals(
    client: AsyncClient, owner: TaskOwner, field: str
) -> None:
    """**읽기 전용이다**(SPEC-003 §4 Validation) — `status` 와 같은 방식으로 막는다.

    `TaskUpdateDTO` 에 필드가 없고 요청 모델이 `extra="forbid"` 라 **`422`** 다.
    조용히 무시하면 「썼는데 안 써진」 상태가 성립한다.
    """
    task = await _create(client, owner)

    response = await client.patch(
        f"{BASE}/{task['id']}",
        json={field: "2026-09-06T00:00:00Z"},
        headers=owner.headers,
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_actuals_cannot_be_set_on_create(
    client: AsyncClient, owner: TaskOwner
) -> None:
    response = await client.post(
        BASE,
        json={
            "title": "실적 심기",
            "workTypeId": owner.work_type_id,
            "completedAt": "2026-09-06T00:00:00Z",
        },
        headers=owner.headers,
    )

    assert response.status_code == 422


# --- 전이가 쓴다 ---------------------------------------------------------


async def test_starting_writes_started_at_from_the_transition_log(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """`in_progress` 전이가 **실적 시작**을 쓴다. 값은 **전이 로그의 시각 그대로**다.

    `NOW()` 를 따로 부르지 않는다 — 두 시각이 몇 밀리초 어긋나는 자리를 만들지 않는다(T-1-c).
    """
    task = await _create(client, owner)
    await _status(client, owner, task["id"], "in_progress")

    detail = await _detail(client, owner, task["id"])
    logged = await _transition_moment(db_session, task["id"], "in_progress")

    assert detail["startedAt"] is not None
    assert detail["completedAt"] is None
    assert datetime.fromisoformat(detail["startedAt"]) == logged


async def test_completing_writes_completed_at_and_keeps_started_at(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    task = await _create(client, owner)
    await _status(client, owner, task["id"], "in_progress")
    await _open_the_gate(client, owner, task["id"])
    await _status(client, owner, task["id"], "done")

    detail = await _detail(client, owner, task["id"])
    logged = await _transition_moment(db_session, task["id"], "done")

    assert detail["startedAt"] is not None
    assert datetime.fromisoformat(detail["completedAt"]) == logged


async def test_the_list_item_carries_the_actuals_too(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """전이 응답(목록 항목)에도 실적이 실린다 — 칸반이 「오늘 완료」를 그 값으로 읽는다."""
    task = await _create(client, owner)
    await _open_the_gate(client, owner, task["id"])

    item = await _status(client, owner, task["id"], "done")

    assert item["completedAt"] is not None


# --- 실행취소가 함께 되돌린다 --------------------------------------------


async def test_undo_clears_the_actual_it_wrote(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """**실행취소가 실적도 되돌린다.**

    로그만 지우고 컬럼을 남기면 상태는 「진행중」인데 완료 시각이 남고,
    R-4 가 그 값으로 거르므로 **오늘 완료 칸에 그대로 붙어 있게 된다.**
    """
    task = await _create(client, owner)
    await _open_the_gate(client, owner, task["id"])
    await _status(client, owner, task["id"], "done")

    undone = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )
    assert undone.status_code == 200, undone.text

    assert undone.json()["status"] == "todo"
    assert undone.json()["completedAt"] is None

    # 컬럼도 실제로 비었다 — 응답만 감춘 것이 아니다
    row = (await db_session.scalars(select(Task).where(Task.id == task["id"]))).one()
    await db_session.refresh(row)
    assert row.completed_at is None


async def test_undo_restores_an_earlier_completion_instead_of_clearing_it(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """**되돌린 뒤의 실적은 「지운다」가 아니라 「다시 계산한다」다.**

    완료 → 진행중 을 실행취소하면 업무는 다시 완료 상태가 되고, **이전 완료 시각이 살아나야**
    한다. 「이 전이가 쓴 값을 지운다」로 구현하면 여기서 `null` 이 되어 조용히 틀린다 —
    완료 상태인데 완료 시각이 없는 업무는 R-4 의 어떤 범위에도 들지 않아 **화면에서 사라진다.**
    """
    task = await _create(client, owner)
    await _open_the_gate(client, owner, task["id"])
    await _status(client, owner, task["id"], "done")
    first_completion = (await _detail(client, owner, task["id"]))["completedAt"]

    # 완료 → 진행중 (되살림) → 그 되살림을 실행취소
    await _status(client, owner, task["id"], "in_progress")
    undone = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )
    assert undone.status_code == 200, undone.text

    assert undone.json()["status"] == "done"
    assert undone.json()["completedAt"] == first_completion


async def test_cancelling_writes_cancelled_at_from_the_transition_log(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """`cancelled` 전이가 **실적 취소**를 쓴다 — 완료·시작과 같은 모양이다(T-8-a 번복).

    승격 전에는 `task_log` 를 되짚는 스칼라 서브쿼리였다. 이제 컬럼이고,
    값은 여전히 **전이 로그의 시각 그대로**다(컬럼은 로그의 materialization 이다).
    """
    task = await _create(client, owner)
    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "요건 변경"},
        headers=owner.headers,
    )

    detail = await _detail(client, owner, task["id"])
    logged = await _transition_moment(db_session, task["id"], "cancelled")

    assert datetime.fromisoformat(detail["cancelledAt"]) == logged
    # 실적 셋이 상세에 함께 온다 — 취소만 다른 자리에 있지 않다
    assert detail["startedAt"] is None
    assert detail["completedAt"] is None


@pytest.mark.parametrize("log_reason", [True, False])
async def test_a_cancel_can_never_be_undone(
    client: AsyncClient, owner: TaskOwner, log_reason: bool
) -> None:
    """**실행취소는 완료 전용이다** — 취소 전이는 `logCancelReason` 과 무관하게 거부된다.

    SPEC-004 가 완료 토스트에만 「실행취소」를 붙였고 시안에 「취소 직후 토스트」가 없다.
    취소는 모달 + 사유를 지나는 신중한 조작이라 되돌릴 자리를 주지 않았다 —
    되살리려면 **상태 팝오버에서 직접 고른다**.

    **두 값을 모두 도는 것이 이 테스트의 핵심**이다(2026-09-06 코디 확정으로 닫은 구멍).
    전에는 규칙이 로그 순서의 **부작용**이었다 — 사유 로그를 켜면 전이 로그 뒤에 한 줄이 붙어
    「마지막 로그가 전이」 조건에 걸려 막혔고, **끄면 통과했다.**
    「사유를 남겼는지」가 「되돌릴 수 있는지」를 정하는 것은 화면에서 설명할 수 없고,
    로그 순서를 건드리는 날 조용히 뒤집힌다. 이제 `undo` 가 명시적으로 판정한다.
    """
    task = await _create(client, owner)
    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={
            "status": "cancelled",
            "cancelReason": "요건 변경",
            "logCancelReason": log_reason,
        },
        headers=owner.headers,
    )

    refused = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )

    assert refused.status_code == 409
    # **만료와 코드가 다르다** — 4초가 지난 게 아니라 애초에 금지다.
    # 합쳐 두면 시간이 지나지 않았는데 「시간이 지났습니다」를 내보내게 된다.
    assert refused.json() == {
        "detail": "취소는 실행취소로 되돌릴 수 없습니다",
        "code": "cancel_undo_not_allowed",
    }

    # 거부됐으니 **아무것도 바뀌지 않았다** — 상태도 실적도 그대로다
    detail = await _detail(client, owner, task["id"])
    assert detail["status"] == "cancelled"
    assert detail["cancelledAt"] is not None


async def test_undoing_a_revival_is_still_allowed(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """막는 것은 **취소로 가는 전이**뿐이다 — 취소에서 *나오는* 전이의 실행취소는 그대로 된다.

    판정을 「지금 취소 상태인가」로 두었기 때문에 이 경계가 중요하다. 되살린 직후에는
    상태가 `todo` 라 ④에 걸리지 않고, 실행취소가 그 되살림을 무른다.
    **취소를 막는다고 취소 근처를 전부 막아 버리면** 잘못 누른 되살림을 무를 길이 없어진다.

    (되돌아간 뒤 `cancelReason` 은 비어 있다 — 떠날 때 T-7 이 비웠고 옛 값을 보관하지 않는다.
    `undo_last_status` 가 §미결로 적어 둔 자리이고 이 테스트가 현재 동작을 고정한다.)
    """
    task = await _create(client, owner)
    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "요건 변경", "logCancelReason": False},
        headers=owner.headers,
    )
    await _status(client, owner, task["id"], "todo")

    undone = await client.post(
        f"{BASE}/{task['id']}/status/undo", headers=owner.headers
    )

    assert undone.status_code == 200, undone.text
    assert undone.json()["status"] == "cancelled"
    assert undone.json()["cancelReason"] is None


async def test_a_later_cancel_overwrites_the_cancelled_at(
    client: AsyncClient, db_session: AsyncSession, owner: TaskOwner
) -> None:
    """취소 → 되살림 → 다시 취소 를 거치면 `cancelledAt` 은 **마지막 취소 시각**이다.

    되살리는 경로가 실행취소가 아니라 **상태 팝오버**다(위 테스트 참조). 그래도 성질은 같다 —
    `sync_actuals` 가 전이 로그에서 **다시 계산**하므로 「한 번 쓰고 마는」 값이 아니다.
    완료(`completedAt`)와 같은 시나리오이고, 셋이 같은 함수를 지나므로 같은 답이 나온다.
    """
    task = await _create(client, owner)

    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "첫 취소"},
        headers=owner.headers,
    )
    # 앞의 취소를 어제로 옮긴다 — 헬퍼 docstring 참조(한 트랜잭션이라 시각이 같아진다)
    await _backdate_cancel(
        db_session, task["id"], datetime.now(UTC) - timedelta(days=1)
    )
    first = (await _detail(client, owner, task["id"]))["cancelledAt"]
    assert first is not None

    # 상태로 되살린다 — 취소 시각은 **남는다**(마스킹하지 않는다)
    await _status(client, owner, task["id"], "todo")
    revived = await _detail(client, owner, task["id"])
    assert revived["cancelledAt"] == first
    assert revived["cancelReason"] is None

    await client.patch(
        f"{BASE}/{task['id']}/status",
        json={"status": "cancelled", "cancelReason": "다시 취소"},
        headers=owner.headers,
    )

    second = (await _detail(client, owner, task["id"]))["cancelledAt"]
    logged = await _last_transition_moment(db_session, task["id"], "cancelled")

    assert second != first
    assert datetime.fromisoformat(second) == logged


# --- description (2026-09-06 — 배경·목표를 합쳤다) ------------------------


async def test_a_description_is_saved_and_returned(
    client: AsyncClient, owner: TaskOwner
) -> None:
    """설명 하나로 받는다 — 배경(왜)·목표(무엇이 되면 끝)를 나눠 받지 않는다."""
    task = await _create(client, owner, description="요금제 개편 소개서를 최신 문구로 맞춘다")

    assert task["description"] == "요금제 개편 소개서를 최신 문구로 맞춘다"
    assert (await _detail(client, owner, task["id"]))["description"] == task["description"]

    patched = await client.patch(
        f"{BASE}/{task['id']}", json={"description": "고침"}, headers=owner.headers
    )
    assert patched.status_code == 200
    assert patched.json()["description"] == "고침"


@pytest.mark.parametrize("field", ["background", "goal"])
async def test_the_removed_background_and_goal_fields_are_422(
    client: AsyncClient, owner: TaskOwner, field: str
) -> None:
    """없어진 필드를 보내면 **`422`** 다 — 조용히 무시하지 않는다.

    요청 모델이 이미 `extra="forbid"` 다(`_TaskRequest`). 낡은 화면이 배경을 계속 보내면서
    **저장된 줄 아는** 상태를 만들지 않으려는 것이고, `status` 를 막는 것과 같은 이유·같은 장치다.
    """
    create = await client.post(
        BASE,
        json={"title": "옛 필드", "workTypeId": owner.work_type_id, field: "값"},
        headers=owner.headers,
    )
    assert create.status_code == 422
    assert create.json()["code"] == "validation_error"

    task = await _create(client, owner)
    patch = await client.patch(
        f"{BASE}/{task['id']}", json={field: "값"}, headers=owner.headers
    )
    assert patch.status_code == 422

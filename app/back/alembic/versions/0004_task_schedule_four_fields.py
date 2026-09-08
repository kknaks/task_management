"""task 일정 개편 — 계획 기간 · 실적 2개 · 설명 하나, 시각 제거

이 리비전 하나에 들어가는 것 (전부 2026-09-06 사용자 확정 · 배포 전이라 **기존 값 이관 없음**) —

| | 컬럼 |
|---|---|
| 추가 | `start_date` · `started_at` · `completed_at` · `cancelled_at` · `description` |
| 제거 | `background` · `goal` · `due_start_time` · `due_end_time` |
| CHECK | `start_date <= due_date` 추가 / `due_*_time` 3종 제거 |

**리비전을 나누지 않는다** — 같은 테이블의 같은 배포분이다. 되돌릴 때도 한 번에 되돌아간다.


**2026-09-06 사용자 확정으로 §A-4(「`startDate`/`endDate` → `due_date` 하나」)가 번복됐다.**
업무는 **계획 기간**을 갖고(`start_date`·`due_date`), 거기에 **실적 2개**가 더해져 일정 필드가 4개다
(DEC-002 §「일정 필드 4개 확정」 · ERD T-1).

| 컬럼 | 뜻 | 누가 |
|---|---|---|
| `start_date` | 계획 시작 | 사용자 |
| `due_date`(0002) | 계획 종료 = 기한 | 사용자 |
| `started_at` | 실적 시작 — `in_progress` 전이 시각 | 시스템 |
| `completed_at` | 실적 종료 — `done` 전이 시각 | 시스템 |
| `cancelled_at` | 실적 취소 — `cancelled` 전이 시각 | 시스템 |

**기존 행은 전부 `NULL` 이다.** 실적은 전이 로그에서 백필할 수도 있지만 하지 않는다 —
계획(`start_date`)은 과거 데이터에 존재한 적이 없어 추측이 되고, 둘 중 하나만 채우면
「어떤 업무는 계획이 있고 어떤 업무는 없다」가 데이터 사고가 아니라 마이그레이션 사고가 된다.

실적 셋은 **T-1-c 대로 전이 로그의 파생**이라, 필요하면 서비스가 다음 전이 때 `sync_actuals` 로
채운다. 그것이 백필보다 정확하다(로그가 정본이다).

## `cancelled_at` 승격 — T-8-a 번복 (2026-09-06 코디 확정)

ERD T-8-a 는 「`task` 에 취소 시각 컬럼을 만들지 않는다. 취소 전이 로그의 시각이 정본이다」였고,
근거는 **「로그와 어긋날 수 있는 두 번째 사실이 생긴다」** 였다. 그 전제가 깨졌다 —
`sync_actuals` 가 실적을 **로그에서 다시 계산**하므로 컬럼은 두 번째 사실이 아니라
로그의 materialization 이다. 전이가 로그를 쓴 뒤 · 실행취소가 로그를 지운 뒤 **같은 트랜잭션에서**
셋이 함께 다시 계산되므로 갈릴 수 없다.

승격하는 이유 — ① 실적 3개가 같은 성격인데 둘만 컬럼이면 다음 사람이 비대칭에 설명을 요구한다
② R-4 의 취소 갈래에서 스칼라 서브쿼리가 사라져 완료·취소가 같은 모양이 된다
③ **0004 가 아직 커밋 전이라 지금이 제일 싸다**(나중이면 리비전이 하나 더 생긴다).

## 배경 · 목표 → 설명 하나

`background`·`goal` 을 **버리고** `description` 하나를 둔다 — 「이 태스크에 대한 설명 하나면 된다」.
`completion_result` 는 **그대로 둔다**(완료 게이트가 보는 값이라 성격이 다르다 — T-5).
두 컬럼을 하나로 합치는 코드를 쓰지 않는다 — 「배경 + 목표」를 이어 붙이면 **사용자가 쓰지 않은
문장**이 설명 칸에 남는다.

## 업무의 시간 지정 제거

**시안 어디에도 업무에 시간을 받는 UI 가 없다** — 새 업무 드로어에도 캘린더의 「개인 업무 생성」에도
일정 칸만 있다. **시간이 있는 것은 회의뿐**이고 회의 일시는 `meeting.start_at`·`end_at` 이 소유한다.
UI 없이 컬럼만 남기면 죽은 컬럼이다. T-1-b 의 CHECK 3종도 함께 사라진다.

**파급** — 업무의 `schedule` 은 이제 **항상 종일/기간**이다. 캘린더 시간 그리드에는 회의만 뜨고,
겹침 검사(시간 일정끼리만)에 걸리는 업무는 없다.

**0002 를 고치지 않고 새 리비전으로 얹는다.**

Revision ID: 0004_task_schedule
Revises: 0003_task_log_status
Create Date: 2026-09-06

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_task_schedule"
down_revision: str | None = "0003_task_log_status"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 계획 시작 — G-2-e 의 달력 날짜(`due_date` 와 같은 축)
    op.add_column("task", sa.Column("start_date", sa.Date(), nullable=True))
    # 실적 셋 — 순간이라 timestamptz 다(전역 규약 그대로)
    op.add_column(
        "task", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "task", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "task", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True)
    )

    # T-1 — 둘 다 있으면 `start_date <= due_date`. **한쪽만 있어도 된다**
    # (SPEC-003 §4 Validation). 서비스가 먼저 422 로 거르고 이것이 최종 방어선이다.
    op.create_check_constraint(
        "ck_task_plan_period_order",
        "task",
        "start_date IS NULL OR due_date IS NULL OR start_date <= due_date",
    )

    # 배경·목표 → 설명 하나. **값은 이관하지 않는다** — 위 docstring 참조.
    op.add_column("task", sa.Column("description", sa.Text(), nullable=True))
    op.drop_column("task", "goal")
    op.drop_column("task", "background")

    # 업무의 시간 지정을 없앤다 — CHECK 를 **먼저** 지운다(컬럼을 참조하고 있다).
    op.drop_constraint("ck_task_due_time_order", "task", type_="check")
    op.drop_constraint("ck_task_due_time_needs_date", "task", type_="check")
    op.drop_constraint("ck_task_due_time_pair", "task", type_="check")
    op.drop_column("task", "due_end_time")
    op.drop_column("task", "due_start_time")


def downgrade() -> None:
    # 되돌려도 버린 값(`background`·`goal`·`due_*_time`)은 돌아오지 않는다.
    op.add_column("task", sa.Column("due_start_time", sa.Time(), nullable=True))
    op.add_column("task", sa.Column("due_end_time", sa.Time(), nullable=True))
    op.create_check_constraint(
        "ck_task_due_time_pair",
        "task",
        "(due_start_time IS NULL) = (due_end_time IS NULL)",
    )
    op.create_check_constraint(
        "ck_task_due_time_needs_date",
        "task",
        "due_start_time IS NULL OR due_date IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_task_due_time_order",
        "task",
        "due_start_time IS NULL OR due_end_time > due_start_time",
    )

    op.add_column("task", sa.Column("background", sa.Text(), nullable=True))
    op.add_column("task", sa.Column("goal", sa.Text(), nullable=True))
    op.drop_column("task", "description")

    op.drop_constraint("ck_task_plan_period_order", "task", type_="check")
    op.drop_column("task", "cancelled_at")
    op.drop_column("task", "completed_at")
    op.drop_column("task", "started_at")
    op.drop_column("task", "start_date")

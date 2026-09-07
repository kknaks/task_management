"""2층 — **회의록 ↔ 업무 연동**(SPEC-008 §4 `.../lines/{id}/task` 둘 · `POST …/lines {newTask}` · U-6 · U-9 · U-10 · WORK-008 Phase 5).

**완료 게이트의 네 번째 진입점**이다(WORK-005 L137 · L147 · L294). 이 파일에는 **판정 코드가 없다** —

| 여기서 하는 것 | 여기서 하지 않는 것 |
|---|---|
| 줄과 업무를 **한 트랜잭션**으로 묶는다(줄 찾기 · 트랙 규칙은 `meeting_edit_service`) | 전이 그래프 · 완료 게이트 · 로그 · 실적 재계산 — 전부 `task_service.change_status()` |
| `payload` 의 세 키를 **순서대로** `task_service` 에 넘긴다 | `task.status` 대입 · `TaskCompletionBlockedError` 포착 · 결과자료 참조 |
| 상태가 **현재와 같으면 전이를 건너뛴다**(SPEC-008 §4 ① · SPEC-004 L478 「같은 상태는 409」가 사용자에게 보이지 않게) | 어떤 상태로 갈 수 있는지 판정 |

거부(게이트 · 전이 · 검증)는 예외로 나가고 **요청 트랜잭션이 통째로 되돌아간다**(BE §7 · `get_db`) —
기한 · 메모가 먼저 반영된 채 남는 상태가 없고 `payload` 도 그대로다. 그래서 여기 `try/except` 가 없다.

`task_service` 의 시그니처(`session, *, account_id, task_id, command`)를 **그대로** 부른다 — 같은 세션이 곧 같은 트랜잭션이다.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import NotFoundError, ValidationError
from dto.enums import LineKind, PAYLOAD_STATUSES
from dto.meeting import LineNewTaskDTO, MeetingDetailDTO, MeetingLineDTO
from dto.task import StatusChangeDTO, TaskCreateDTO, TaskUpdateDTO
from repository import meeting_line_repository
from service import meeting_edit_service, meeting_service, task_service

_INVALID_INPUT = "입력값을 확인해 주세요"
_NOT_FOUND_TASK = "업무를 찾을 수 없습니다"

# `payload` JSONB 의 키 — **셋뿐**(DEC-003 §4 L102 · M-14-a). 쓰기 스키마가 이미 거르지만 저장값도 같은 규칙으로 읽는다
_PENDING_KEYS = frozenset({"dueDate", "status", "note"})


def _invalid_input(field: str | None = None) -> ValidationError:
    return ValidationError(_INVALID_INPUT, field=field)


# --- 업무 생성 (SPEC-003 `POST /api/tasks` 규칙 그대로 — `task_service.create_task`) ----------------------------------


async def _create_task(session: AsyncSession, *, account_id: int, command: LineNewTaskDTO) -> tuple[int, str]:
    """`task_service.create_task()` 하나 — 유형 · 프로젝트 검증 · 「시작전」 · 로그 「업무 생성」 · 일정 파생이 거기서 난다. `(id, 제목)`."""
    detail = await task_service.create_task(
        session,
        account_id=account_id,
        command=TaskCreateDTO(
            title=command.title,
            work_type_id=command.work_type_id,
            project_id=command.project_id,
            due_date=command.due_date,
            description=command.description,
        ),
    )
    return detail.task.id, detail.task.title


async def add_task_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, agenda_id: int, track: str, command: LineNewTaskDTO
) -> MeetingLineDTO:
    """`POST …/lines { newTask }`(U-10 칩 진입) — 업무 생성 + 그 안건 맨 아래 업무 줄, **한 트랜잭션**.

    회의 · 상태 · 안건 · 트랙은 `meeting_edit_service.add_line` 이 이미 검증했다 — 여기는 만들기만 한다.
    업무가 만들어졌는데 줄이 안 생기는 상태가 없다(§4 「한 요청 · 한 트랜잭션」).
    """
    task_id, title = await _create_task(session, account_id=account_id, command=command)
    line_id = await meeting_line_repository.create_line(
        session,
        meeting_id=meeting_id,
        agenda_id=agenda_id,
        track=track,
        kind=LineKind.TASK.value,
        content=title,
        order_index=await meeting_line_repository.next_order_index(session, agenda_id=agenda_id),
        task_id=task_id,
    )
    (line,) = await meeting_line_repository.find_by_ids(session, line_ids=[line_id])
    return line


async def create_task_from_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, line_id: int, command: LineNewTaskDTO
) -> MeetingDetailDTO:
    """`POST …/lines/{id}/task`(U-6 「업무 생성」 · U-10 액션 줄 진입) — 그 줄이 `kind='action'` 이고 `task_id` 가 없어야 한다(§4 Validation).

    같은 트랜잭션에서 줄이 `kind='task'` · `task_id` 로 바뀐다. 본문은 업무 제목 스냅숏이다(업무 줄의 본문 규칙 — U-9 · `newTask` 와 같다).
    유형이 삭제됐으면 `task_service` 가 `invalid_work_type` 을 내고 **줄도 바뀌지 않는다**(같은 트랜잭션).
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_edit")
    line = await meeting_edit_service.require_editable_line(session, meeting=meeting, line_id=line_id)
    if line.kind != LineKind.ACTION.value or line.task_id is not None:
        raise _invalid_input("kind")

    task_id, title = await _create_task(session, account_id=account_id, command=command)
    await meeting_line_repository.update_line(
        session,
        meeting_id=meeting_id,
        line_id=line.id,
        values={"kind": LineKind.TASK.value, "task_id": task_id, "content": title, "payload": None},
    )
    return await meeting_service.build_detail(session, account_id=account_id, meeting_id=meeting_id)


# --- 업무 갱신 (`payload` 적용 — SPEC-008 §4 ①②③④) ---------------------------------------------------


def _stored_change(line: MeetingLineDTO) -> dict:
    """줄에 저장된 `payload` — 없으면 422(반영할 것이 없다). 키 셋 밖 · `cancelled` 는 저장될 수 없지만 읽을 때도 같은 규칙이다."""
    change = line.payload
    if line.kind != LineKind.TASK.value or not change:
        raise _invalid_input("payload")
    if not set(change) <= _PENDING_KEYS:
        raise _invalid_input("payload")
    if "status" in change and change["status"] not in PAYLOAD_STATUSES:
        raise _invalid_input("payload.status")
    return change


async def apply_payload(
    session: AsyncSession, *, account_id: int, meeting_id: int, line_id: int
) -> MeetingDetailDTO:
    """`PATCH …/lines/{id}/task`(U-6 「업무 갱신」) — **본문 없음. 줄의 `payload` 가 요청이다.**

    한 트랜잭션에서 순서대로 —
    ① `status` 가 있고 **업무 현재 상태와 다르면** `task_service.change_status()`(그래프 · 게이트 · 로그 · 실적은 거기) · 같으면 건너뛴다
    ② `dueDate` → `task_service.update_task()`(일정 파생 포함)
    ③ `note` → `task_service.add_memo()`(새 항목 — 기존 메모 · 설명을 덮지 않는다)
    ④ `payload = NULL`
    어느 단계든 예외면 전부 되돌아가고 `payload` 가 남는다. 연결 업무가 삭제됐으면 404(§4 Case Matrix `not_found`).
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_edit")
    line = await meeting_edit_service.require_editable_line(session, meeting=meeting, line_id=line_id)
    change = _stored_change(line)
    task = line.task
    if task is None or task.is_deleted:
        raise NotFoundError(_NOT_FOUND_TASK)

    if "status" in change and change["status"] != task.status:
        await task_service.change_status(
            session, account_id=account_id, task_id=task.id, command=StatusChangeDTO(status=change["status"])
        )
    if "dueDate" in change:
        await task_service.update_task(
            session,
            account_id=account_id,
            task_id=task.id,
            command=TaskUpdateDTO(due_date=date.fromisoformat(change["dueDate"])),
        )
    if "note" in change:
        await task_service.add_memo(session, account_id=account_id, task_id=task.id, text=change["note"])

    await meeting_line_repository.update_line(
        session, meeting_id=meeting_id, line_id=line.id, values={"payload": None}
    )
    return await meeting_service.build_detail(session, account_id=account_id, meeting_id=meeting_id)

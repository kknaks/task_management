"""2층 — **회의록 ↔ 업무 연동**(SPEC-008 §4 `.../lines/{id}/task` 둘 · U-6 · U-9 · U-10 · WORK-013 Phase 2).

**업무를 만들거나 바꾸는 회의록 코드는 이 파일의 두 함수뿐이다**(WP §Internal Interface · 정적 검사) —
`create_task_from_line`(액션 줄 「넣기」 → 생성) · `apply_task_update`(업무 줄 「넣기」 → 갱신).
`payload` 를 붙이는 표면 둘(`POST`·`PATCH …/lines`)은 `meeting_edit_service` 에 있고 `task_service` 를 부르지 않는다.

**완료 게이트의 네 번째 진입점**이다(WORK-005 L137 · L147 · L294). 이 파일에는 **판정 코드가 없다** —

| 여기서 하는 것 | 여기서 하지 않는 것 |
|---|---|
| 줄과 업무를 **한 트랜잭션**으로 묶는다(줄 찾기 · 트랙 규칙은 `meeting_edit_service`) | 전이 그래프 · 완료 게이트 · 로그 · 실적 재계산 — 전부 `task_service.change_status()` |
| 본문의 변경분을 **순서대로** `task_service` 에 넘긴다(①~⑦) | `task.status` 대입 · `TaskCompletionBlockedError` 포착 · 결과자료 참조 |
| 상태가 **현재와 같으면 전이를 건너뛴다**(SPEC-008 §4 ① · SPEC-004 L478 「같은 상태는 409」가 사용자에게 보이지 않게) | 어떤 상태로 갈 수 있는지 판정 |

**요청은 줄의 저장값이 아니라 드로어가 보낸 본문이다**(MF-59 · MF-66) — 사람이 「넣기」 전에 고쳤을 수 있고,
업무 줄은 헤더 셀렉터에서 **업무 자체를 바꿀 수도** 있다(줄에 저장된 `task_id` 와 달라도 본문의 `taskId` 가 이긴다).

거부(게이트 · 전이 · 검증)는 예외로 나가고 **요청 트랜잭션이 통째로 되돌아간다**(BE §7 · `get_db`) —
기한 · 메모가 먼저 반영된 채 남는 상태가 없고 `payload` 도 그대로다. 그래서 여기 `try/except` 가 없다.

`task_service` 의 시그니처(`session, *, account_id, task_id, command`)를 **그대로** 부른다 — 같은 세션이 곧 같은 트랜잭션이다.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from core.exceptions import NotFoundError, ValidationError
from dto.enums import LineKind
from dto.meeting import LineNewTaskDTO, LineTaskUpdateDTO, MeetingDetailDTO
from dto.task import StatusChangeDTO, TaskCreateDTO, TaskUpdateDTO, TodoCreateDTO
from dto.unset import UNSET
from repository import meeting_line_repository, task_repository
from service import meeting_edit_service, meeting_service, task_service

_INVALID_INPUT = "입력값을 확인해 주세요"
_NOT_FOUND_TASK = "업무를 찾을 수 없습니다"


def _invalid_input(field: str | None = None) -> ValidationError:
    return ValidationError(_INVALID_INPUT, field=field)


# --- 업무 생성 (`POST …/lines/{id}/task` — SPEC-003 `POST /api/tasks` 규칙 그대로) ------------------------------


async def create_task_from_line(
    session: AsyncSession, *, account_id: int, meeting_id: int, line_id: int, command: LineNewTaskDTO
) -> MeetingDetailDTO:
    """U-10 액션 줄 「넣기」 — 그 줄이 `kind='action'` 이고 `task_id` 가 없어야 한다(§4 Validation).

    업무는 `task_service.create_task()` 하나로 만들어진다 — 유형 · 프로젝트 검증 · 「시작전」 · 로그 「업무 생성」 ·
    할일 행 · 일정 파생이 전부 거기서 난다. 같은 트랜잭션에서 줄이 `kind='task'` · `task_id` 로 바뀌고 `payload` 가 비워진다.

    **줄 본문은 그대로 둔다**(WP §Internal Interface 「줄 본문의 출처」) — 액션 줄의 본문은 사람이 적은 문장이고,
    업무 제목은 드로어에서 따로 고칠 수 있다. 둘을 잇는 동기화 규칙은 SPEC 에 없다.
    유형이 삭제됐으면 `task_service` 가 `invalid_work_type` 을 내고 **줄도 바뀌지 않는다**(같은 트랜잭션).
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_edit")
    line = await meeting_edit_service.require_editable_line(session, meeting=meeting, line_id=line_id)
    if line.kind != LineKind.ACTION.value or line.task_id is not None:
        raise _invalid_input("kind")

    detail = await task_service.create_task(
        session,
        account_id=account_id,
        command=TaskCreateDTO(
            title=command.title,
            work_type_id=command.work_type_id,
            project_id=command.project_id,
            start_date=command.start_date,
            due_date=command.due_date,
            description=command.description,
            todos=[TodoCreateDTO(text=text) for text in command.todos],
        ),
    )
    await meeting_line_repository.update_line(
        session,
        meeting_id=meeting_id,
        line_id=line.id,
        values={"kind": LineKind.TASK.value, "task_id": detail.task.id, "payload": None},
    )
    return await meeting_service.build_detail(session, account_id=account_id, meeting_id=meeting_id)


# --- 업무 갱신 (`PATCH …/lines/{id}/task` — SPEC-008 §4 ①~⑧) -------------------------------------------


async def apply_task_update(
    session: AsyncSession, *, account_id: int, meeting_id: int, line_id: int, command: LineTaskUpdateDTO
) -> MeetingDetailDTO:
    """U-9 업무 줄 「넣기」 — 그 줄이 `kind='task'` 여야 한다. `payload` · 기존 `task_id` 유무는 조건이 아니다.

    한 트랜잭션에서 순서대로 —
    ① `status` 가 있고 **업무 현재 상태와 다르면** `task_service.change_status()`(그래프 · 게이트 · 로그 · 실적은 거기) · 같으면 건너뛴다
    ②③⑦ `dueDate` · `projectId` · `completionResult` → `task_service.update_task()`(보낸 필드만 · 일정 파생 포함)
    ④ `note` → `task_service.add_memo()`(**새 항목** — 기존 메모 · 설명을 덮지 않는다)
    ⑤ `todos` → `task_service.add_todo()`(**추가** — 기존 할일을 덮지 않는다)
    ⑥ `relatedTaskIds` → `task_service.link_relations()`(**추가** · 양방향 · 중복은 늘지 않는다)
    ⑧ 줄의 `task_id = taskId` · `payload = NULL`

    ②③⑦ 은 `update_task` 가 **보낸 필드만** 바꾸므로 한 번에 넘긴다 — 세 번 부르면 같은 행을 세 번 UPDATE 할 뿐이고
    거부·롤백 범위는 똑같다(한 트랜잭션). 어느 단계든 예외면 전부 되돌아가고 `payload` 가 남는다.
    변경분이 하나도 없어도 받는다 — ⑧ 만 일어난다.
    """
    meeting = await meeting_service.require_meeting(session, account_id=account_id, meeting_id=meeting_id)
    meeting_service.assert_allowed(meeting, "line_edit")
    line = await meeting_edit_service.require_editable_line(session, meeting=meeting, line_id=line_id)
    if line.kind != LineKind.TASK.value:
        raise _invalid_input("kind")

    # 본문의 업무가 그 줄의 업무가 된다(§4) — 남의 것 · 삭제된 것 · 없는 것은 같은 404 다(§9)
    task = await task_repository.find_active(session, account_id=account_id, task_id=command.task_id)
    if task is None:
        raise NotFoundError(_NOT_FOUND_TASK)

    if command.status is not UNSET and command.status != task.status:
        await task_service.change_status(
            session, account_id=account_id, task_id=task.id, command=StatusChangeDTO(status=command.status)
        )
    if any(value is not UNSET for value in (command.due_date, command.project_id, command.completion_result)):
        await task_service.update_task(
            session,
            account_id=account_id,
            task_id=task.id,
            command=TaskUpdateDTO(
                due_date=command.due_date,
                project_id=command.project_id,
                completion_result=command.completion_result,
            ),
        )
    if command.note is not UNSET:
        await task_service.add_memo(session, account_id=account_id, task_id=task.id, text=command.note)
    if command.todos is not UNSET:
        for text in command.todos:
            await task_service.add_todo(
                session, account_id=account_id, task_id=task.id, command=TodoCreateDTO(text=text)
            )
    if command.related_task_ids is not UNSET:
        await task_service.link_relations(
            session, account_id=account_id, task_id=task.id, target_ids=list(command.related_task_ids)
        )

    await meeting_line_repository.update_line(
        session, meeting_id=meeting_id, line_id=line.id, values={"task_id": task.id, "payload": None}
    )
    return await meeting_service.build_detail(session, account_id=account_id, meeting_id=meeting_id)

"""WORK-006 Phase 2 — 회의 본체 계약 · `/start` · `MeetingDetail` 빌더 · 목록 집계 · Case Matrix.

정본: SPEC-006 §4(API · Validation · 상태별 허용 표 · Case Matrix) · §5(규칙) · `domains/meeting.md`.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.account import Project, WorkType
from models.meeting import Meeting, MeetingAgenda
from service import schedule_service
from tests.meeting_fixtures import (  # noqa: F401
    BASE,
    END,
    START,
    MeetingOwner,
    create_meeting,
    get_detail,
    iso,
    meeting_body,
    owner,
    stranger,
)

BACK_DIR = Path(__file__).resolve().parents[1]

# 9월 한 달의 UTC 경계(KST 9/1 00:00 ~ 10/1 00:00)
MONTH_FROM = "2026-08-31T15:00:00Z"
MONTH_TO = "2026-09-30T15:00:00Z"


def _month(**extra: str) -> dict[str, str]:
    return {"from": MONTH_FROM, "to": MONTH_TO, **extra}


# --- 생성 · 상세 ---------------------------------------------------------


async def test_a_meeting_is_created_with_title_type_and_time_only(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """**제목 + 유형 + 일시**만으로 만들어진다. 상세의 자리들이 SPEC-006 §4 필드 소유 표 그대로 있다."""
    created = await create_meeting(client, owner)

    assert created["status"] == "scheduled"
    assert created["integrationState"] == "not_started"
    assert created["recordingStartedAt"] is None
    assert created["project"] is None
    assert created["workType"]["kind"] == "meeting"
    assert created["workType"]["isDeleted"] is False
    assert created["startAt"] == iso(START)
    assert created["endAt"] == iso(END)
    assert created["durationMinutes"] == 60
    # WORK-007·008 이 채우는 자리 — 값은 비어 있고 **키는 있다**
    assert created["agendas"] == {"human": [], "ai": [], "merged": []}
    assert created["latestBatchSeq"] == 0
    assert created["headline"] is None
    assert created["mergedSummary"] is None
    assert created["activeJobId"] is None
    assert created["attachments"] == []
    # 서버 내부값은 싣지 않는다(§4)
    for hidden in ("recordingPath", "aiSessionId", "recording_path", "ai_session_id"):
        assert hidden not in created

    detail = await get_detail(client, owner, created["id"])
    assert detail == created


async def test_a_task_kind_type_is_rejected(client: AsyncClient, owner: MeetingOwner) -> None:
    """M-2 — 종류가 `task` 면 `422 invalid_work_type`."""
    response = await client.post(
        BASE, json=meeting_body(owner, workTypeId=owner.task_type_id), headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_work_type"


async def test_a_deleted_meeting_type_is_rejected(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    await db_session.execute(
        update(WorkType)
        .where(WorkType.id == owner.meeting_type_id)
        .values(deleted_at=datetime.now(UTC))
    )
    response = await client.post(BASE, json=meeting_body(owner), headers=owner.headers)
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_work_type"


async def test_a_deleted_project_is_rejected(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """삭제된 프로젝트는 `422 invalid_project` — 유형과 코드를 나눈다(셀렉터가 둘)."""
    await db_session.execute(
        update(Project).where(Project.id == owner.project_id).values(deleted_at=datetime.now(UTC))
    )
    response = await client.post(
        BASE, json=meeting_body(owner, projectId=owner.project_id), headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_project"


async def test_a_strangers_project_is_rejected(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner
) -> None:
    response = await client.post(
        BASE, json=meeting_body(owner, projectId=stranger.project_id), headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_project"


async def test_invalid_times_are_rejected(client: AsyncClient, owner: MeetingOwner) -> None:
    """§4 Validation — 301분 · 4분 · `endAt ≤ startAt` · `startAt` 만 → **422 `validation_error`**."""
    cases = [
        {"endAt": iso(START + timedelta(minutes=301))},
        {"endAt": iso(START + timedelta(minutes=4))},
        {"endAt": iso(START)},
        {"endAt": iso(START - timedelta(minutes=30))},
    ]
    for override in cases:
        response = await client.post(
            BASE, json=meeting_body(owner, **override), headers=owner.headers
        )
        assert response.status_code == 422, override
        assert response.json()["code"] == "validation_error"

    body = meeting_body(owner)
    del body["endAt"]
    response = await client.post(BASE, json=body, headers=owner.headers)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_boundary_lengths_are_accepted(client: AsyncClient, owner: MeetingOwner) -> None:
    """5분 · 300분은 통과한다(5 이상 300 이하)."""
    five = await create_meeting(client, owner, endAt=iso(START + timedelta(minutes=5)))
    assert five["durationMinutes"] == 5
    long = await create_meeting(
        client,
        owner,
        startAt=iso(START + timedelta(days=1)),
        endAt=iso(START + timedelta(days=1, minutes=300)),
    )
    assert long["durationMinutes"] == 300


async def test_children_are_saved_with_the_body_in_one_request(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """생성은 한 요청이다 — 안건 2건 + 첨부(`link`) 1건이 **전부 저장**된다."""
    created = await create_meeting(
        client,
        owner,
        projectId=owner.project_id,
        agendas=[{"title": "개정 대상 섹션 확정"}, {"title": "디자인 반영 일정"}],
        attachments=[
            {"kind": "link", "url": "https://example.test/pricing", "label": "경쟁사 요금제 비교"}
        ],
    )

    human = created["agendas"]["human"]
    assert [agenda["title"] for agenda in human] == ["개정 대상 섹션 확정", "디자인 반영 일정"]
    assert [agenda["orderIndex"] for agenda in human] == [0, 1]
    assert all(agenda["track"] == "human" for agenda in human)
    assert all(agenda["state"] is None for agenda in human)
    assert all(agenda["sourceAgendaId"] is None for agenda in human)
    assert all(agenda["lines"] == [] for agenda in human)

    [attachment] = created["attachments"]
    assert attachment["kind"] == "link"
    assert attachment["name"] == "경쟁사 요금제 비교"
    assert attachment["url"] == "https://example.test/pricing"
    assert attachment["documentId"] is None
    assert attachment["isDeleted"] is False
    assert attachment["updatedAt"]
    assert created["project"]["id"] == owner.project_id


async def test_a_bad_attachment_rolls_back_the_whole_creation(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """하나를 잘못 주면(`ftp://`) **본체도 만들어지지 않는다**(§5 한 트랜잭션)."""
    response = await client.post(
        BASE,
        json=meeting_body(
            owner,
            agendas=[{"title": "A"}],
            attachments=[{"kind": "link", "url": "ftp://example.test/file"}],
        ),
        headers=owner.headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

    assert (
        await db_session.scalar(select(Meeting.id).where(Meeting.account_id == owner.id))
    ) is None
    assert await schedule_service.check_overlap(
        db_session,
        account_id=owner.id,
        placement=schedule_service.build_meeting_placement(START, END),
    ) is None


async def test_unknown_fields_are_rejected(client: AsyncClient, owner: MeetingOwner) -> None:
    """`status` · `location` · `attendees` 처럼 자리가 없는 필드는 조용히 무시하지 않는다."""
    for extra in ({"status": "recording"}, {"location": "회의실 A"}, {"attendees": ["a"]}):
        response = await client.post(
            BASE, json=meeting_body(owner, **extra), headers=owner.headers
        )
        assert response.status_code == 422, extra
        assert response.json()["code"] == "validation_error"


# --- 부분 수정 -----------------------------------------------------------


async def test_patching_the_time_moves_the_schedule(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    created = await create_meeting(client, owner)
    new_start, new_end = START + timedelta(hours=2), END + timedelta(hours=2)

    response = await client.patch(
        f"{BASE}/{created['id']}",
        json={"startAt": iso(new_start), "endAt": iso(new_end)},
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["startAt"] == iso(new_start)
    assert body["endAt"] == iso(new_end)
    assert body["durationMinutes"] == 60

    placement = await schedule_service.find_meeting_placement(db_session, meeting_id=created["id"])
    assert placement is not None
    assert (placement.start_at, placement.end_at) == (new_start, new_end)


async def test_half_a_time_is_rejected(client: AsyncClient, owner: MeetingOwner) -> None:
    """일시는 **둘을 함께** — `startAt` 만 오면 `validation_error`(M-1)."""
    created = await create_meeting(client, owner)
    for body in ({"startAt": iso(START + timedelta(hours=1))}, {"endAt": iso(END + timedelta(hours=1))}):
        response = await client.patch(f"{BASE}/{created['id']}", json=body, headers=owner.headers)
        assert response.status_code == 422, body
        assert response.json()["code"] == "validation_error"


async def test_patching_status_is_rejected_at_the_schema(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """상태 전이는 전용 엔드포인트다 — `PATCH { status }` 는 **스키마 층에서 422**."""
    created = await create_meeting(client, owner)
    response = await client.patch(
        f"{BASE}/{created['id']}", json={"status": "recording"}, headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

    assert (await get_detail(client, owner, created["id"]))["status"] == "scheduled"


async def test_patching_into_an_overlap_leaves_the_original_untouched(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """겹침에 걸리면 `meeting` 도 `schedule` 도 바뀌지 않는다(BE §7)."""
    first = await create_meeting(client, owner)
    second = await create_meeting(
        client, owner, title="둘째", startAt=iso(START + timedelta(hours=2)), endAt=iso(END + timedelta(hours=2))
    )

    response = await client.patch(
        f"{BASE}/{second['id']}",
        json={"startAt": iso(START + timedelta(minutes=30)), "endAt": iso(END + timedelta(minutes=30))},
        headers=owner.headers,
    )
    assert response.status_code == 409
    assert response.json()["code"] == "schedule_overlap"

    detail = await get_detail(client, owner, second["id"])
    assert detail["startAt"] == second["startAt"]
    placement = await schedule_service.find_meeting_placement(db_session, meeting_id=second["id"])
    assert placement is not None and placement.start_at == START + timedelta(hours=2)
    assert first["id"] != second["id"]


async def test_patching_meta_fields(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """`projectId: null` 은 무소속으로 바꾸는 뜻이고 `title: null` 은 거부된다."""
    created = await create_meeting(client, owner, projectId=owner.project_id)

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"projectId": None, "title": "바뀐 제목"}, headers=owner.headers
    )
    assert response.status_code == 200
    assert response.json()["project"] is None
    assert response.json()["title"] == "바뀐 제목"

    response = await client.patch(f"{BASE}/{created['id']}", json={"title": None}, headers=owner.headers)
    assert response.status_code == 422

    response = await client.patch(
        f"{BASE}/{created['id']}", json={"workTypeId": owner.task_type_id}, headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_work_type"


# --- /start ----------------------------------------------------------------


async def test_start_moves_to_recording_once(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """`/start` → 200 · `status: recording` · `recordingStartedAt` 채움 · `startAt` 은 그대로. 두 번째는 409."""
    created = await create_meeting(client, owner)

    response = await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "recording"
    assert body["recordingStartedAt"] is not None
    assert body["startAt"] == iso(START)
    assert body["agendas"] == {"human": [], "ai": [], "merged": []}

    again = await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)
    assert again.status_code == 409
    assert again.json()["code"] == "invalid_meeting_status"


async def test_recording_blocks_patch_and_delete(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """상태별 허용 표 — `recording` 에서 `PATCH { title }` · `PATCH` 일시 · `DELETE` 는 409."""
    created = await create_meeting(client, owner)
    assert (await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)).status_code == 200

    for body in ({"title": "x"}, {"startAt": iso(START + timedelta(hours=1)), "endAt": iso(END + timedelta(hours=1))}):
        response = await client.patch(f"{BASE}/{created['id']}", json=body, headers=owner.headers)
        assert response.status_code == 409, body
        assert response.json()["code"] == "invalid_meeting_status"

    response = await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_meeting_status"


async def test_ended_allows_patch_and_delete_but_generating_does_not(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """허용 표의 `generating`·`ended` 열 — 이 work 에는 그 전이가 없어 상태를 직접 놓고 표를 확인한다."""
    created = await create_meeting(client, owner)

    await db_session.execute(update(Meeting).where(Meeting.id == created["id"]).values(status="generating"))
    response = await client.patch(f"{BASE}/{created['id']}", json={"title": "x"}, headers=owner.headers)
    assert response.status_code == 409
    assert (await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)).status_code == 409
    assert (await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)).status_code == 409

    await db_session.execute(update(Meeting).where(Meeting.id == created["id"]).values(status="ended"))
    response = await client.patch(f"{BASE}/{created['id']}", json={"title": "종료 후 제목"}, headers=owner.headers)
    assert response.status_code == 200
    assert response.json()["title"] == "종료 후 제목"
    assert (await client.post(f"{BASE}/{created['id']}/start", headers=owner.headers)).status_code == 409
    assert (await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)).status_code == 204


# --- 삭제 ---------------------------------------------------------------


async def test_delete_is_soft_and_keeps_children_and_recording(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """`DELETE` 후 목록·상세에서 빠지고 **DB 에 행·자식이 남는다.** `recording_path` 가 있어도 파일을 건드리지 않는다(M-13)."""
    created = await create_meeting(client, owner, agendas=[{"title": "A"}])
    await db_session.execute(
        update(Meeting).where(Meeting.id == created["id"]).values(recording_path="/data/rec/1.wav")
    )

    response = await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)
    assert response.status_code == 204

    assert (await client.get(f"{BASE}/{created['id']}", headers=owner.headers)).status_code == 404
    listing = await client.get(BASE, params=_month(), headers=owner.headers)
    assert listing.status_code == 200
    assert listing.json()["items"] == []

    row = (await db_session.execute(select(Meeting).where(Meeting.id == created["id"]))).scalar_one()
    assert row.deleted_at is not None
    assert row.recording_path == "/data/rec/1.wav"
    agendas = (
        await db_session.scalars(select(MeetingAgenda).where(MeetingAgenda.meeting_id == created["id"]))
    ).all()
    assert len(agendas) == 1

    # 두 번 지우면 404 — 이미 없는 것이다
    assert (await client.delete(f"{BASE}/{created['id']}", headers=owner.headers)).status_code == 404


# --- 목록 ---------------------------------------------------------------


async def test_list_filters_by_project_and_keeps_counts_stable(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """`projectId=none` 이 무소속만 주고, `projectCounts` 는 **필터를 걸어도 같은 값**이며 `total` 은 바뀐다."""
    unassigned = await create_meeting(
        client, owner, title="무소속", agendas=[{"title": "첫 안건"}, {"title": "둘째 안건"}],
        attachments=[{"kind": "link", "url": "https://example.test"}],
    )
    with_project = await create_meeting(
        client, owner, title="프로젝트", projectId=owner.project_id,
        startAt=iso(START + timedelta(days=1)), endAt=iso(END + timedelta(days=1)),
    )
    # 다른 달 — 범위 밖
    await create_meeting(
        client, owner, title="다음 달",
        startAt=iso(START + timedelta(days=30)), endAt=iso(END + timedelta(days=30)),
    )

    everything = await client.get(BASE, params=_month(), headers=owner.headers)
    assert everything.status_code == 200, everything.text
    body = everything.json()
    # 기본 정렬 latest — startAt 내림차순
    assert [item["id"] for item in body["items"]] == [with_project["id"], unassigned["id"]]
    assert body["total"] == 2
    counts = body["projectCounts"]
    assert counts == [
        {"projectId": None, "name": None, "colorToken": None, "count": 1},
        {"projectId": owner.project_id, "name": f"{owner.login_id} 프로젝트", "colorToken": "violet", "count": 1},
    ]
    first = next(item for item in body["items"] if item["id"] == unassigned["id"])
    assert first["agendaTitles"] == ["첫 안건", "둘째 안건"]
    assert first["attachmentCount"] == 1
    assert first["headline"] is None
    assert first["project"] is None

    only_unassigned = await client.get(BASE, params=_month(projectId="none"), headers=owner.headers)
    assert [item["id"] for item in only_unassigned.json()["items"]] == [unassigned["id"]]
    assert only_unassigned.json()["total"] == 1
    assert only_unassigned.json()["projectCounts"] == counts

    only_project = await client.get(
        BASE, params=_month(projectId=str(owner.project_id)), headers=owner.headers
    )
    assert [item["id"] for item in only_project.json()["items"]] == [with_project["id"]]
    assert only_project.json()["projectCounts"] == counts

    oldest = await client.get(BASE, params=_month(sort="oldest"), headers=owner.headers)
    assert [item["id"] for item in oldest.json()["items"]] == [unassigned["id"], with_project["id"]]


async def test_a_deleted_project_stays_in_the_counts(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """삭제된 프로젝트의 회의도 **그 이름·색으로** 집계에 남는다(DEC-001 §4)."""
    created = await create_meeting(client, owner, projectId=owner.project_id)
    await db_session.execute(
        update(Project).where(Project.id == owner.project_id).values(deleted_at=datetime.now(UTC))
    )

    body = (await client.get(BASE, params=_month(), headers=owner.headers)).json()
    assert body["projectCounts"] == [
        {"projectId": owner.project_id, "name": f"{owner.login_id} 프로젝트", "colorToken": "violet", "count": 1}
    ]
    [item] = body["items"]
    assert item["id"] == created["id"]
    assert item["project"]["isDeleted"] is True


async def test_list_query_parameters_are_validated(client: AsyncClient, owner: MeetingOwner) -> None:
    """`from`·`to` 는 필수 · `projectId` 는 숫자 또는 `none` · `sort` 는 2종 — 밖은 FastAPI 가 422."""
    assert (await client.get(BASE, headers=owner.headers)).status_code == 422
    assert (await client.get(BASE, params=_month(projectId="abc"), headers=owner.headers)).status_code == 422
    assert (await client.get(BASE, params=_month(sort="newest"), headers=owner.headers)).status_code == 422
    assert (
        await client.get(BASE, params={"from": "2026-09-01T00:00:00", "to": MONTH_TO}, headers=owner.headers)
    ).status_code == 422


# --- 소유 ---------------------------------------------------------------


async def test_a_strangers_meeting_is_not_found(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner
) -> None:
    """남의 회의 id 는 **404 `not_found`** — 존재를 흘리지 않는다(BE §9)."""
    created = await create_meeting(client, owner)
    path = f"{BASE}/{created['id']}"

    assert (await client.get(path, headers=stranger.headers)).status_code == 404
    assert (await client.patch(path, json={"title": "x"}, headers=stranger.headers)).status_code == 404
    assert (await client.delete(path, headers=stranger.headers)).status_code == 404
    assert (await client.post(f"{path}/start", headers=stranger.headers)).status_code == 404
    assert (await client.get(path, headers=stranger.headers)).json()["code"] == "not_found"

    listing = await client.get(BASE, params=_month(), headers=stranger.headers)
    assert listing.json()["items"] == []


async def test_requests_without_a_session_are_rejected(client: AsyncClient) -> None:
    response = await client.get(BASE, params=_month())
    assert response.status_code == 401


# --- 정적 검사 (WP Phase 1·2 「정적 검사」) -------------------------------


def _read(relative: str) -> str:
    return (BACK_DIR / relative).read_text(encoding="utf-8")


def test_static_the_service_layer_imports_neither_fastapi_nor_schemas() -> None:
    """BE §2 — service 는 `fastapi`·`schemas/` 를 모른다."""
    for path in (BACK_DIR / "service").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        assert not re.search(r"^\s*(from|import)\s+fastapi", source, re.M), path.name
        assert not re.search(r"^\s*(from|import)\s+schemas", source, re.M), path.name


def test_static_meeting_detail_is_built_in_exactly_one_place() -> None:
    """SPEC-006 §5 — `MeetingDetailDTO(` 를 조립하는 코드는 **한 곳**(`build_detail`)뿐이다."""
    hits = []
    for path in BACK_DIR.rglob("*.py"):
        if ".venv" in path.parts or "tests" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        for line_no, line in enumerate(source.splitlines(), 1):
            if "MeetingDetailDTO(" in line and "class " not in line:
                hits.append((path.relative_to(BACK_DIR).as_posix(), line_no))
    assert hits == [("service/meeting_service.py", hits[0][1])], hits


def test_static_meeting_status_is_assigned_only_by_transition_functions() -> None:
    """WP 「상태 대입 격리」 — `status=` 대입은 `meeting_repository` 의 **전이 함수 셋**(`start_recording`→recording ·
    `begin_generating`→generating · `finish_integration`→ended — WORK-008 이 둘을 더했다)의 UPDATE 뿐이다. service·router 에는 없다."""
    hits = []
    for relative in ("service/meeting_service.py", "service/meeting_finalize_service.py", "service/meeting_edit_service.py",
                     "repository/meeting_repository.py", "repository/meeting_child_repository.py", "api/meeting_router.py"):
        for line_no, line in enumerate(_read(relative).splitlines(), 1):
            stripped = line.strip()
            # 주석·docstring 은 코드가 아니다
            if stripped.startswith(("#", '"""')):
                continue
            if re.search(r"\bstatus\s*=\s*(MeetingStatus|['\"])", line):
                hits.append((relative, line_no, stripped))
    assert [hit[0] for hit in hits] == ["repository/meeting_repository.py"] * 3, hits
    assert sorted(value for hit in hits for value in ("RECORDING", "GENERATING", "ENDED") if value in hit[2]) == [
        "ENDED", "GENERATING", "RECORDING",
    ]


def test_static_schedule_writes_live_only_in_schedule_service() -> None:
    """WORK-004 L155 — `schedule` 을 INSERT/UPDATE/DELETE 하는 코드와 겹침 판정식은 `schedule_*` 두 파일에만 있다."""
    # 세 층(router · service · repository)만 본다 — `models/__init__.py` 는 메타데이터 등록이라 모델을 import 한다
    for layer in ("api", "service", "repository"):
        for path in (BACK_DIR / layer).glob("*.py"):
            relative = path.relative_to(BACK_DIR).as_posix()
            if relative in ("service/schedule_service.py", "repository/schedule_repository.py"):
                continue
            source = path.read_text(encoding="utf-8")
            assert "schedule_repository" not in source, relative
            assert "models.calendar" not in source, relative
            assert "Schedule.start_at <" not in source and "Schedule.end_at >" not in source, relative

"""WORK-006 Phase 3 — 안건 · 첨부 API. **상태별 허용 표를 표 그대로** 못박는다.

정본: SPEC-006 §4(상태별 허용 표 · Validation · Case Matrix) · `domains/meeting.md` M-5 · M-6 · M-17.
안건 표면은 세 SPEC 이 공유한다 — 여기서 못박지 않으면 WORK-007·008 이 각자 조건을 단다.

| 동작           | scheduled | recording | generating | ended |
|----------------|-----------|-----------|------------|-------|
| agenda_add     | ✔ 201     | ✔ 201     | ✗ 409      | ✗ 409 |
| agenda_title   | ✔ 200     | ✗ 409     | ✗ 409      | ✔ 200 |
| agenda_delete  | ✔ 204     | ✗ 409     | ✗ 409      | ✗ 409 |
| attachment     | ✔         | ✔         | ✗ 409      | ✔     |
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.meeting import Meeting, MeetingAgenda, MeetingAttachment
from tests.meeting_fixtures import (  # noqa: F401
    BASE,
    MeetingOwner,
    create_meeting,
    get_detail,
    owner,
    stranger,
)


async def _set_status(session: AsyncSession, meeting_id: int, status: str) -> None:
    """이 work 에는 `/end`·통합 전이가 없다 — 허용 표의 열을 확인하려고 상태를 **직접** 놓는다."""
    await session.execute(update(Meeting).where(Meeting.id == meeting_id).values(status=status))


async def _start(client: AsyncClient, owner: MeetingOwner, meeting_id: int) -> None:
    response = await client.post(f"{BASE}/{meeting_id}/start", headers=owner.headers)
    assert response.status_code == 200, response.text


# --- 안건 ---------------------------------------------------------------


async def test_adding_an_agenda_returns_the_whole_detail_in_order(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """응답이 **`MeetingDetail` 전체**이고 `agendas.human` 에 `orderIndex` 순으로 붙는다."""
    created = await create_meeting(client, owner, agendas=[{"title": "첫째"}, {"title": "둘째"}])

    response = await client.post(
        f"{BASE}/{created['id']}/agendas", json={"title": "셋째"}, headers=owner.headers
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert set(body) == set(created)  # 상세와 같은 형태 — 같은 빌더
    human = body["agendas"]["human"]
    assert [agenda["title"] for agenda in human] == ["첫째", "둘째", "셋째"]
    assert [agenda["orderIndex"] for agenda in human] == [0, 1, 2]
    assert human[-1]["track"] == "human"
    assert human[-1]["state"] is None
    assert human[-1]["lines"] == []
    assert body["agendas"]["ai"] == [] and body["agendas"]["merged"] == []

    assert (await get_detail(client, owner, created["id"]))["agendas"] == body["agendas"]


async def test_agenda_titles_are_validated(client: AsyncClient, owner: MeetingOwner) -> None:
    """공백만인 제목 · 201자 제목이 **422**."""
    created = await create_meeting(client, owner)
    for title in ("   ", "가" * 201, ""):
        response = await client.post(
            f"{BASE}/{created['id']}/agendas", json={"title": title}, headers=owner.headers
        )
        assert response.status_code == 422, repr(title)
        assert response.json()["code"] == "validation_error"


async def test_patching_the_title_keeps_the_order(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    created = await create_meeting(client, owner, agendas=[{"title": "첫째"}, {"title": "둘째"}])
    first = created["agendas"]["human"][0]

    response = await client.patch(
        f"{BASE}/{created['id']}/agendas/{first['id']}",
        json={"title": "고친 첫째"},
        headers=owner.headers,
    )
    assert response.status_code == 200, response.text
    human = response.json()["agendas"]["human"]
    assert [agenda["title"] for agenda in human] == ["고친 첫째", "둘째"]
    assert [agenda["orderIndex"] for agenda in human] == [0, 1]

    detail = await get_detail(client, owner, created["id"])
    assert detail["agendas"]["human"][0]["title"] == "고친 첫째"


async def test_agenda_patch_rejects_null_title_and_state(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """`title: null` 은 422. **`state` 는 이 work 가 받지 않는다**(WORK-007 이 연다) — 보내면 422."""
    created = await create_meeting(client, owner, agendas=[{"title": "첫째"}])
    agenda_id = created["agendas"]["human"][0]["id"]
    path = f"{BASE}/{created['id']}/agendas/{agenda_id}"

    assert (await client.patch(path, json={"title": None}, headers=owner.headers)).status_code == 422
    assert (await client.patch(path, json={"state": "active"}, headers=owner.headers)).status_code == 422
    # 빈 본문은 아무것도 바꾸지 않고 200 이다 — Case Matrix 에 그런 실패가 없다
    empty = await client.patch(path, json={}, headers=owner.headers)
    assert empty.status_code == 200
    assert empty.json()["agendas"]["human"][0]["title"] == "첫째"


async def test_the_allowed_table_for_agendas_in_recording(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """`recording` — `PATCH { title }` 은 **409**, `POST { title }` 은 **201**(회의 중 안건 추가 허용), `DELETE` 는 409."""
    created = await create_meeting(client, owner, agendas=[{"title": "첫째"}])
    agenda_id = created["agendas"]["human"][0]["id"]
    await _start(client, owner, created["id"])

    response = await client.patch(
        f"{BASE}/{created['id']}/agendas/{agenda_id}", json={"title": "x"}, headers=owner.headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_meeting_status"

    response = await client.post(
        f"{BASE}/{created['id']}/agendas", json={"title": "회의 중 안건"}, headers=owner.headers
    )
    assert response.status_code == 201
    assert [a["title"] for a in response.json()["agendas"]["human"]] == ["첫째", "회의 중 안건"]

    response = await client.delete(
        f"{BASE}/{created['id']}/agendas/{agenda_id}", headers=owner.headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_meeting_status"


async def test_the_allowed_table_for_agendas_in_generating_and_ended(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """`generating` — 셋 다 409. `ended` — 제목 수정만 200(SPEC-008 편집 모드), 추가·삭제는 409."""
    created = await create_meeting(client, owner, agendas=[{"title": "첫째"}])
    meeting_id = created["id"]
    agenda_id = created["agendas"]["human"][0]["id"]
    agenda_path = f"{BASE}/{meeting_id}/agendas/{agenda_id}"

    await _set_status(db_session, meeting_id, "generating")
    assert (await client.post(f"{BASE}/{meeting_id}/agendas", json={"title": "x"}, headers=owner.headers)).status_code == 409
    assert (await client.patch(agenda_path, json={"title": "x"}, headers=owner.headers)).status_code == 409
    assert (await client.delete(agenda_path, headers=owner.headers)).status_code == 409

    await _set_status(db_session, meeting_id, "ended")
    assert (await client.post(f"{BASE}/{meeting_id}/agendas", json={"title": "x"}, headers=owner.headers)).status_code == 409
    renamed = await client.patch(agenda_path, json={"title": "종료 후 이름"}, headers=owner.headers)
    assert renamed.status_code == 200
    assert renamed.json()["agendas"]["human"][0]["title"] == "종료 후 이름"
    assert (await client.delete(agenda_path, headers=owner.headers)).status_code == 409


async def test_deleting_an_agenda_is_not_idempotent(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """지우면 204 · 상세에서 빠진다. **없는 안건을 지우면 404** — 멱등이 아니다."""
    created = await create_meeting(client, owner, agendas=[{"title": "첫째"}, {"title": "둘째"}])
    first_id = created["agendas"]["human"][0]["id"]
    path = f"{BASE}/{created['id']}/agendas/{first_id}"

    assert (await client.delete(path, headers=owner.headers)).status_code == 204
    detail = await get_detail(client, owner, created["id"])
    assert [a["title"] for a in detail["agendas"]["human"]] == ["둘째"]
    assert (
        await db_session.scalar(select(MeetingAgenda.id).where(MeetingAgenda.id == first_id))
    ) is None

    again = await client.delete(path, headers=owner.headers)
    assert again.status_code == 404
    assert again.json()["code"] == "not_found"


async def test_an_ai_agenda_shows_in_its_own_track_and_cannot_be_deleted_here(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """M-5-a · M-6 — AI 안건은 `agendas.ai` 에만 실리고, 이 표면으로 지울 수 없다(404)."""
    created = await create_meeting(client, owner, agendas=[{"title": "사람 안건"}])
    human_id = created["agendas"]["human"][0]["id"]
    ai_agenda = MeetingAgenda(
        meeting_id=created["id"], track="ai", title="AI 안건", order_index=0, source_agenda_id=human_id
    )
    db_session.add(ai_agenda)
    await db_session.flush()

    detail = await get_detail(client, owner, created["id"])
    assert [a["title"] for a in detail["agendas"]["human"]] == ["사람 안건"]
    [ai] = detail["agendas"]["ai"]
    assert ai["title"] == "AI 안건" and ai["track"] == "ai" and ai["sourceAgendaId"] == human_id

    response = await client.delete(
        f"{BASE}/{created['id']}/agendas/{ai_agenda.id}", headers=owner.headers
    )
    assert response.status_code == 404

    # 새 사람 안건의 orderIndex 는 **사람 트랙** 기준이다 — AI 트랙 수에 끌리지 않는다
    added = await client.post(
        f"{BASE}/{created['id']}/agendas", json={"title": "둘째"}, headers=owner.headers
    )
    assert added.json()["agendas"]["human"][1]["orderIndex"] == 1


# --- 첨부 ---------------------------------------------------------------


async def test_link_attachments_are_validated(client: AsyncClient, owner: MeetingOwner) -> None:
    """`ftp://` → 422 · `label` 101자 → 422 · `label` 비우면 응답 `name` 이 URL · `documentId` 를 같이 주면 422."""
    created = await create_meeting(client, owner)
    path = f"{BASE}/{created['id']}/attachments"

    for body in (
        {"kind": "link", "url": "ftp://example.test/file"},
        {"kind": "link", "url": "https://example.test", "label": "가" * 101},
        {"kind": "link", "url": "https://example.test", "documentId": 12},
        {"kind": "link"},
        {"kind": "link", "url": "not a url"},
    ):
        response = await client.post(path, json=body, headers=owner.headers)
        assert response.status_code == 422, body
        assert response.json()["code"] == "validation_error"

    response = await client.post(path, json={"kind": "link", "url": "https://example.test/a"}, headers=owner.headers)
    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == set(created)
    [attachment] = body["attachments"]
    assert attachment["name"] == "https://example.test/a"
    assert attachment["kind"] == "link"
    assert attachment["url"] == "https://example.test/a"
    assert attachment["documentId"] is None and attachment["folderPath"] is None and attachment["sizeBytes"] is None
    assert attachment["isDeleted"] is False

    response = await client.post(
        path, json={"kind": "link", "url": "https://example.test/b", "label": "요금제"}, headers=owner.headers
    )
    assert response.status_code == 201
    assert [a["name"] for a in response.json()["attachments"]] == ["https://example.test/a", "요금제"]


async def test_doc_attachments_are_rejected_until_the_library_exists(
    client: AsyncClient, owner: MeetingOwner
) -> None:
    """§Open Issues 임시 계약 — `kind:"doc"` 요청은 **이 시점에 422** 다(생성 본문에서도, 단건 추가에서도)."""
    created = await create_meeting(client, owner)
    response = await client.post(
        f"{BASE}/{created['id']}/attachments", json={"kind": "doc", "documentId": 12}, headers=owner.headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"

    response = await client.post(
        BASE,
        json={
            "title": "doc",
            "workTypeId": owner.meeting_type_id,
            "startAt": "2026-09-11T05:00:00Z",
            "endAt": "2026-09-11T06:00:00Z",
            "attachments": [{"kind": "doc", "documentId": 12}],
        },
        headers=owner.headers,
    )
    assert response.status_code == 422


async def test_removing_an_attachment_deletes_only_the_row(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """첨부를 지워도 **원본은 지워지지 않는다** — 첨부 행만. 없는 첨부는 404."""
    created = await create_meeting(
        client, owner, attachments=[{"kind": "link", "url": "https://example.test", "label": "링크"}]
    )
    [attachment] = created["attachments"]
    path = f"{BASE}/{created['id']}/attachments/{attachment['id']}"

    assert (await client.delete(path, headers=owner.headers)).status_code == 204
    assert (await get_detail(client, owner, created["id"]))["attachments"] == []
    assert (
        await db_session.scalar(select(MeetingAttachment.id).where(MeetingAttachment.id == attachment["id"]))
    ) is None
    # 회의 본체는 그대로다 — 링크 「원본」에 해당하는 것은 첨부 행 밖에 없다
    assert (await db_session.scalar(select(Meeting.deleted_at).where(Meeting.id == created["id"]))) is None

    again = await client.delete(path, headers=owner.headers)
    assert again.status_code == 404
    assert again.json()["code"] == "not_found"


async def test_the_allowed_table_for_attachments(
    client: AsyncClient, db_session: AsyncSession, owner: MeetingOwner
) -> None:
    """첨부 추가·제거 — `generating` 외 전부 허용(`scheduled`·`recording`·`ended`)."""
    created = await create_meeting(client, owner)
    meeting_id = created["id"]
    path = f"{BASE}/{meeting_id}/attachments"
    link = {"kind": "link", "url": "https://example.test"}

    await _start(client, owner, meeting_id)
    recording = await client.post(path, json=link, headers=owner.headers)
    assert recording.status_code == 201
    attachment_id = recording.json()["attachments"][0]["id"]

    await _set_status(db_session, meeting_id, "generating")
    assert (await client.post(path, json=link, headers=owner.headers)).status_code == 409
    blocked = await client.delete(f"{path}/{attachment_id}", headers=owner.headers)
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "invalid_meeting_status"

    await _set_status(db_session, meeting_id, "ended")
    assert (await client.post(path, json=link, headers=owner.headers)).status_code == 201
    assert (await client.delete(f"{path}/{attachment_id}", headers=owner.headers)).status_code == 204


# --- 소유 ---------------------------------------------------------------


async def test_child_surfaces_of_a_strangers_meeting_are_not_found(
    client: AsyncClient, owner: MeetingOwner, stranger: MeetingOwner
) -> None:
    created = await create_meeting(
        client, owner, agendas=[{"title": "첫째"}],
        attachments=[{"kind": "link", "url": "https://example.test"}],
    )
    meeting_id = created["id"]
    agenda_id = created["agendas"]["human"][0]["id"]
    attachment_id = created["attachments"][0]["id"]
    headers = stranger.headers

    assert (await client.post(f"{BASE}/{meeting_id}/agendas", json={"title": "x"}, headers=headers)).status_code == 404
    assert (await client.patch(f"{BASE}/{meeting_id}/agendas/{agenda_id}", json={"title": "x"}, headers=headers)).status_code == 404
    assert (await client.delete(f"{BASE}/{meeting_id}/agendas/{agenda_id}", headers=headers)).status_code == 404
    assert (await client.post(f"{BASE}/{meeting_id}/attachments", json={"kind": "link", "url": "https://x.test"}, headers=headers)).status_code == 404
    assert (await client.delete(f"{BASE}/{meeting_id}/attachments/{attachment_id}", headers=headers)).status_code == 404

    # 아무것도 바뀌지 않았다
    detail = await get_detail(client, owner, meeting_id)
    assert [a["title"] for a in detail["agendas"]["human"]] == ["첫째"]
    assert len(detail["attachments"]) == 1

"""enum 값의 정본(database/README.md G-3 · G-4).

Postgres native ENUM 을 쓰지 않는다 — `varchar` + `CHECK` 로 잡고 값의 정본은 여기다.
값은 **영문 소문자 snake_case** 로 저장한다. 한국어 라벨은 프론트가 매핑한다.
"""

from __future__ import annotations

from enum import StrEnum


class WorkTypeKind(StrEnum):
    """유형이 속하는 상위 축(DEC-001 §3)."""

    MEETING = "meeting"
    TASK = "task"


class ColorToken(StrEnum):
    """허용 팔레트 토큰명 8종(A-5 · SPEC-002 §4).

    자유 색상(임의 hex)을 저장하지 않는다. hex 는 프론트 토큰이 갖는다.
    """

    INDIGO = "indigo"
    VIOLET = "violet"
    STEEL = "steel"
    MINT = "mint"
    SKY = "sky"
    AMBER = "amber"
    ROSE = "rose"
    GRAPHITE = "graphite"


class TaskStatus(StrEnum):
    """업무 상태 **4종만**(T-4).

    **「지연」은 값이 아니다** — 기한 경과 + 완료·취소 아님으로 조회 시 파생한다(G-7).
    전이 규칙과 완료 게이트는 **WORK-005** 가 갖는다. 이 work 는 생성 시 `TODO` 만 쓴다.
    """

    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CANCELLED = "cancelled"


class AttachmentRole(StrEnum):
    """첨부의 쓰임 축 — 참고자료 / 결과자료(T-9).

    `DELIVERABLE` 이 1건 이상인지가 완료 게이트의 한 축이다(T-5 · 판정은 WORK-005).
    """

    REFERENCE = "reference"
    DELIVERABLE = "deliverable"


class AttachmentKind(StrEnum):
    """첨부의 대상 축 — 자료함 문서 / URL 링크(T-9).

    `kind` 에 따라 채워지는 컬럼이 갈린다(T-9-a) — `DOC` 은 `document_id` 만,
    `LINK` 는 `url`·`label` 만.
    """

    DOC = "doc"
    LINK = "link"


class RelationCandidateScope(StrEnum):
    """연관업무 후보를 **잘라내는 필터**(SPEC-003 §4 · U-8 필터 칩 3 과 1:1).

    저장되는 값이 아니라 **요청 어휘**다 — 그래도 값의 정본을 한 곳에 두려고 여기 둔다.
    router 가 이 타입으로 받으면 세 값 밖은 FastAPI 가 422 로 거른다(손으로 잡지 않는다).

    `projectId`·`dueDate` 와 **역할이 다르다** — 그 둘은 정렬 근거이고 이것은 필터다.
    """

    PROJECT = "project"
    RECENT30 = "recent30"
    ALL = "all"


class ScheduleSourceType(StrEnum):
    """`schedule` 의 원본 종류(C-1 · §3-1).

    v2 의 `external`(외부 캘린더)은 **지금 만들지 않는다**(G-8) — 그때 CHECK 를 넓힌다.
    """

    TASK = "task"
    MEETING = "meeting"

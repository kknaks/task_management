"""모델 패키지 — alembic autogenerate 가 `Base.metadata` 로 전부 볼 수 있게 여기서 모은다."""

from models.account import Account, AuthSession, Career, Project, WorkType
from models.base import Base
from models.calendar import Schedule
from models.job import Job
from models.meeting import (
    Meeting,
    MeetingAgenda,
    MeetingAttachment,
    MeetingBatchRun,
    MeetingLine,
    MeetingTranscript,
)
from models.task import (
    Task,
    TaskAttachment,
    TaskLog,
    TaskMemo,
    TaskRelation,
    TaskTodo,
)

__all__ = [
    "Base",
    "Account",
    "AuthSession",
    "Career",
    "Project",
    "WorkType",
    "Schedule",
    "Job",
    "Meeting",
    "MeetingAgenda",
    "MeetingAttachment",
    "MeetingBatchRun",
    "MeetingLine",
    "MeetingTranscript",
    "Task",
    "TaskAttachment",
    "TaskLog",
    "TaskMemo",
    "TaskRelation",
    "TaskTodo",
]

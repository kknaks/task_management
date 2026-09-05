"""SPEC-002 §4 — 유형·프로젝트의 프론트 ↔ 백 계약.

키는 camelCase(§3 규칙 6). 검증 규칙은 SPEC-002 §4 Validation 표 그대로다.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, StringConstraints, field_validator, model_validator

from dto.setting import (
    ProjectCreateDTO,
    ProjectDTO,
    ProjectUpdateDTO,
    WorkTypeCreateDTO,
    WorkTypeDTO,
    WorkTypeUpdateDTO,
)
from dto.unset import UNSET, Unset
from schemas.base import CamelModel

# 앞뒤 공백 제거 후 1~30자(SPEC-002 §4 Validation).
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
# `meeting` 또는 `task` 둘 중 하나. **생성 시에만** 받는다.
Kind = Literal["meeting", "task"]

_NEWLINES = ("\n", "\r")


def _reject_newlines(value: str | None) -> str | None:
    """줄바꿈 불가(§4 Validation). 조용히 지우지 않고 **거부**한다.

    부분 수정에서는 「보내지 않음」이 `None` 으로 들어온다 — 그 판정은 `_PartialUpdate` 몫이라
    여기서는 통과시킨다.
    """
    if value is None:
        return None
    if any(character in value for character in _NEWLINES):
        raise ValueError("이름에 줄바꿈을 넣을 수 없습니다")
    return value


class _SettingRequest(CamelModel):
    """요청 공통 — **모르는 필드를 조용히 무시하지 않는다.**

    `kind` 를 PATCH 로 보내는 것처럼 계약에 없는 필드가 오면 `422 validation_error` 다
    (SPEC-002 §4 「`kind` 는 PATCH 로 받지 않는다」). 무시하면 「바뀐 줄 알았는데 안 바뀐」
    상태가 조용히 성립한다.
    """

    model_config = ConfigDict(extra="forbid")


class _PartialUpdate(_SettingRequest):
    """부분 수정 공통 — 보낸 필드만 바꾼다(§4).

    두 필드 모두 **비울 수 없는 값**이라, 명시적으로 `null` 을 보내면 거부한다 —
    「보내지 않음」과 「null 로 지움」의 구분을 계약에 드러내기 위해서다(§3 규칙 4).
    """

    @model_validator(mode="after")
    def _reject_explicit_null(self) -> "_PartialUpdate":
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} 는 비울 수 없습니다")
        return self

    def _sent(self, field: str) -> object | Unset:
        return getattr(self, field) if field in self.model_fields_set else UNSET


# --- 유형 ---------------------------------------------------------------


class WorkTypeCreate(_SettingRequest):
    kind: Kind
    name: Name
    color_token: str

    _no_newline = field_validator("name")(_reject_newlines)

    def to_dto(self) -> WorkTypeCreateDTO:
        return WorkTypeCreateDTO(
            kind=self.kind, name=self.name, color_token=self.color_token
        )


class WorkTypeUpdate(_PartialUpdate):
    """이름·색만 받는다. `kind` 는 계약에 없어 `extra="forbid"` 가 걸러낸다."""

    name: Name | None = None
    color_token: str | None = None

    _no_newline = field_validator("name")(_reject_newlines)

    def to_dto(self) -> WorkTypeUpdateDTO:
        return WorkTypeUpdateDTO(
            name=self._sent("name"),  # type: ignore[arg-type]
            color_token=self._sent("color_token"),  # type: ignore[arg-type]
        )


class WorkTypeItem(CamelModel):
    id: int
    kind: Kind
    name: str
    color_token: str
    is_default: bool

    @classmethod
    def from_dto(cls, dto: WorkTypeDTO) -> "WorkTypeItem":
        return cls(
            id=dto.id,
            kind=dto.kind,  # type: ignore[arg-type]
            name=dto.name,
            color_token=dto.color_token,
            is_default=dto.is_default,
        )


class WorkTypeListResponse(CamelModel):
    """목록 응답은 `{ items: [...] }` 로 감싼다(§10 공통)."""

    items: list[WorkTypeItem]

    @classmethod
    def from_dtos(cls, dtos: list[WorkTypeDTO]) -> "WorkTypeListResponse":
        return cls(items=[WorkTypeItem.from_dto(dto) for dto in dtos])


# --- 프로젝트 -----------------------------------------------------------


class ProjectCreate(_SettingRequest):
    name: Name
    color_token: str

    _no_newline = field_validator("name")(_reject_newlines)

    def to_dto(self) -> ProjectCreateDTO:
        return ProjectCreateDTO(name=self.name, color_token=self.color_token)


class ProjectUpdate(_PartialUpdate):
    name: Name | None = None
    color_token: str | None = None

    _no_newline = field_validator("name")(_reject_newlines)

    def to_dto(self) -> ProjectUpdateDTO:
        return ProjectUpdateDTO(
            name=self._sent("name"),  # type: ignore[arg-type]
            color_token=self._sent("color_token"),  # type: ignore[arg-type]
        )


class ProjectItem(CamelModel):
    id: int
    name: str
    color_token: str

    @classmethod
    def from_dto(cls, dto: ProjectDTO) -> "ProjectItem":
        return cls(id=dto.id, name=dto.name, color_token=dto.color_token)


class ProjectListResponse(CamelModel):
    items: list[ProjectItem]

    @classmethod
    def from_dtos(cls, dtos: list[ProjectDTO]) -> "ProjectListResponse":
        return cls(items=[ProjectItem.from_dto(dto) for dto in dtos])

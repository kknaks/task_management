"""SPEC-000 §4 Request / Response — `GET /api/health` 응답 계약."""

from __future__ import annotations

from typing import Literal

from dto.health import HealthDTO
from schemas.base import CamelModel


class HealthResponse(CamelModel):
    status: Literal["ok"]
    version: str
    database: Literal["ok"]

    @classmethod
    def from_dto(cls, dto: HealthDTO, version: str) -> "HealthResponse":
        return cls(status="ok", version=version, database=dto.database)

"""내부 계층 이동용 dto — 프론트 계약이 아니다(backend/README.md §3)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HealthDTO:
    database: str

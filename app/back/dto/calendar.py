"""`schedule` 파생의 내부 dto — 프론트 계약이 아니다(§3).

`schedule` 이 담는 것은 **시간축 배치뿐**이다(C-5) — 기한 같은 도메인 속성을 담지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class SchedulePlacementDTO:
    """시간축 위의 자리 하나. `date`/`time` → `timestamptz` 변환이 끝난 값이다.

    `is_all_day=True` 면 그 날짜의 `00:00`~다음 날 `00:00`(KST)이고,
    **겹침 검사 대상이 아니다**(C-6).
    """

    start_at: datetime
    end_at: datetime
    is_all_day: bool

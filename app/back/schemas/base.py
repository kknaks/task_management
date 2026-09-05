"""프론트 ↔ 백 계약의 공통 설정(backend/README.md §3 규칙 6).

응답 키는 camelCase 다. 라우터는 `response_model_by_alias=True` 로 낸다.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

"""env → Settings. **env 를 읽는 유일한 곳이다**(backend/README.md §11).

- 코드에 상수로 박지 않는다.
- 비밀값에 기본값을 두지 않는다 — 없으면 기동에 실패한다(SPEC-000 §5).
"""

from __future__ import annotations

import logging
from functools import lru_cache

from pydantic import Field
from pydantic import ValidationError as PydanticValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """API 프로세스가 읽는 env. 키 이름은 SPEC-000 §5 표 그대로다."""

    model_config = SettingsConfigDict(
        env_file=None,
        case_sensitive=False,
        extra="ignore",
    )

    # --- 필수 (기본값 없음 — 누락이거나 비어 있으면 기동 실패) ---
    database_url: str = Field(min_length=1)
    jwt_secret: str = Field(min_length=1)
    cors_origins: str = Field(min_length=1)
    storage_root: str = Field(min_length=1)

    # --- 선택 (기본값은 SPEC-000 §5 표의 값) ---
    access_token_ttl_min: int = 60
    refresh_token_ttl_days: int = 7
    app_timezone: str = "Asia/Seoul"
    # 배포 단위 버전 문자열. 헬스 응답의 `version` 이 이 값 그대로 나간다.
    app_version: str = "0.1.0"

    @property
    def cors_origin_list(self) -> list[str]:
        """`CORS_ORIGINS` 는 쉼표로 구분한 **명시 목록**이다. `*` 를 쓰지 않는다."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


class SeedSettings(BaseSettings):
    """시드 스크립트 전용 env(SPEC-000 §5 `SEED_*`).

    API 기동을 시드 값에 묶지 않으려고 `Settings` 와 분리한다 —
    시드는 개발자가 명시적으로 실행하는 절차다(SPEC-000 §5 시드 계약).
    """

    model_config = SettingsConfigDict(
        env_file=None,
        case_sensitive=False,
        env_prefix="seed_",
        extra="ignore",
    )

    login_id: str = Field(min_length=1)
    password: str = Field(min_length=1)
    name: str = Field(min_length=1)
    email: str = Field(min_length=1)


class MissingEnvError(RuntimeError):
    """필수 환경변수 누락 — 프로세스가 뜨지 않는다(SPEC-000 §4 Case Matrix)."""


# 「없음」과 「비어 있음」을 같은 실패로 본다 — 비밀값에 빈 문자열을 허용하지 않는다.
_MISSING_ERROR_TYPES = frozenset({"missing", "string_too_short"})


def _missing_env_names(exc: PydanticValidationError, prefix: str = "") -> list[str]:
    names = []
    for error in exc.errors():
        if error["type"] not in _MISSING_ERROR_TYPES:
            continue
        names.extend(f"{prefix}{str(part).upper()}" for part in error["loc"])
    return names


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    try:
        return Settings()  # type: ignore[call-arg]
    except PydanticValidationError as exc:
        missing = _missing_env_names(exc)
        if missing:
            joined = ", ".join(missing)
            logger.error("필수 환경변수가 없거나 비어 있습니다: %s", joined)
            raise MissingEnvError(f"필수 환경변수가 없거나 비어 있습니다: {joined}") from exc
        raise


def get_seed_settings() -> SeedSettings:
    try:
        return SeedSettings()  # type: ignore[call-arg]
    except PydanticValidationError as exc:
        missing = _missing_env_names(exc, prefix="SEED_")
        if missing:
            joined = ", ".join(missing)
            logger.error("필수 환경변수가 없거나 비어 있습니다: %s", joined)
            raise MissingEnvError(f"필수 환경변수가 없거나 비어 있습니다: {joined}") from exc
        raise

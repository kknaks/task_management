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
    # Soniox long-lived 키(SPEC-007 · BE §11). **서버에만 둔다** — 읽는 코드는 `integrations/soniox.py` 하나다.
    # 기본값 없음 — 비어 있으면 기동 실패(WORK-007 Phase 1).
    soniox_api_key: str = Field(min_length=1)
    # codex 가 부를 MCP 서버 주소(compose 안 `http://mcp:8010/mcp`). 옵션 빌더(`integrations/agent.py`)가 `-c` 로 싣는다 — 여기는 값만 준다.
    # **기본값을 두지 않는다** — 비밀값은 아니지만 compose 안 주소라 환경마다 다르고, 틀린 기본값이 조용히 나가면
    # codex 가 툴 0개로 돌아 배치가 컨텍스트 없이 답을 짓는다(WP §Pre-deploy Check).
    mcp_server_url: str = Field(min_length=1)

    # --- 선택 (기본값은 SPEC-000 §5 표의 값) ---
    access_token_ttl_min: int = 60
    refresh_token_ttl_days: int = 7
    app_timezone: str = "Asia/Seoul"
    # 배포 단위 버전 문자열. 헬스 응답의 `version` 이 이 값 그대로 나간다.
    app_version: str = "0.1.0"

    # --- open-kknaks 브로커 (BE §11 · SYS §외부 연동). worker 설정과 같은 값이어야 한다 ---
    # 비밀값이 아니라 로컬 기본값을 둔다. compose 가 컨테이너 안에서 덮어쓴다.
    redis_url: str = "redis://localhost:6379/0"
    ai_namespace: str = "task-management"
    ai_queue: str = "default"
    # 미지정이면 codex 기본 모델(BE §11)
    ai_model: str | None = None
    # 웜스타트 한 번의 상한(초). 배치 상한은 아래 `MEETING_BATCH_TIMEOUT_SEC`(=120) 이 따로 갖는다.
    ai_timeout_sec: int = 120

    # --- 회의 배치 수치 5종 (DEC-003 §STT L164 확정값 · SPEC-007 §5). 실측 후 env 로 조정한다 — 계약은 불변 ---
    # ① 미처리 확정 발화가 이 글자 수에 이르면 배치(MF-49 — 2026-09-07 600 → 1000)
    meeting_batch_chars: int = 1000
    # ② 안건 전환 시 즉시 배치 — 단 미처리가 이 글자 수 미만이면 생략
    meeting_batch_switch_min_chars: int = 80
    # ③ 미처리 구간이 생긴 뒤 이 시간이 지나면 배치
    meeting_batch_max_wait_sec: int = 180
    # 배치 하나의 상한 — 넘으면 `failed`(다음 배치에 합친다)
    meeting_batch_timeout_sec: int = 120
    # 회의당 AI 세션 수 — **항상 1**(동시 실행 금지 · M-12). 다른 값은 지원하지 않는다
    meeting_batch_sessions_per_meeting: int = 1

    # --- 회의별 단명 토큰 (A-13 · MF-69) ---
    # 회의 상한 300분 + 여유. 실측 후 조정한다 — 계약(회의당 하나 · 원문 컬럼 · 폐기 = 행 삭제)은 불변
    meeting_token_ttl_min: int = 330

    # --- 회의 종료 파이프라인 수치 5종 (SPEC-008 §4 「수치」 — **단일 출처**. 실측 후 env 로 조정한다 · 계약은 불변) ---
    # ① async 재전사 상한(초) — 넘으면 `transcription_timeout`. 300분 상한 파일에 비례해 잡았다
    meeting_transcribe_timeout_sec: int = 1200
    # ① Soniox 상태 폴링 간격(초) — 파일 1건 · 단일 사용자라 잦은 폴링의 비용이 없다
    meeting_transcribe_poll_sec: int = 5
    # ② 최종 회의록 시도 하나의 상한(초) — 회의 전체를 한 번에 정리한다(배치 120초의 2.5배)
    meeting_final_timeout_sec: int = 300
    # ② 시도 횟수 — 원 1 + 재시도 2(DEC-003 §7). 즉시 재시도
    meeting_final_attempts: int = 3
    # job 상한 — 1200 + 300×3 = 2100 에 여유. 넘으면 `job_service` 가 `failed(job_timeout)` 로 마감한다
    meeting_job_timeout_sec: int = 2400

    # --- 회의 스트림 (BE §5-1 백프레셔). 클라이언트 송신 큐 상한 — 넘으면 잠정 프레임만 버린다 ---
    meeting_stream_queue_max: int = 200

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

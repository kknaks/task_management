"""앱 팩토리 — 조립만 한다. 로직 없음(backend/README.md §4).

라우터 · CORS · 예외 핸들러를 여기 **한 곳**에서만 등록한다.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import (
    auth_router,
    health_router,
    meeting_router,
    meeting_stream_router,
    setting_router,
    task_router,
)
from config import get_settings
from core.exceptions import AppError, ValidationError

# pydantic `loc` 의 앞머리 — 필드 경로에 싣지 않는다
_LOC_ROOTS = frozenset({"body", "query", "path", "header"})


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """도메인 예외 → HTTP. 응답 형태는 `{"detail", "code"}` 로 고정한다(§8-2).

    `422 validation_error` 만 **`field`** 를 더 싣는다(WORK-006 검수 이관 · SPEC-006 §4 Case Matrix) —
    어느 칸이 틀렸는지. 업무·설정·회의 어디서 나든 같은 모양이다.
    """
    assert isinstance(exc, AppError)
    content: dict[str, object] = {"detail": exc.detail, "code": exc.code}
    if isinstance(exc, ValidationError):
        content["field"] = exc.field
    return JSONResponse(status_code=exc.status, content=content)


def _first_invalid_field(exc: RequestValidationError) -> str | None:
    """pydantic 오류 중 **첫 번째 하나**의 위치를 요청 스키마의 이름(camelCase)으로 — `agendas[0].title` · `endAt` · `from`."""
    for error in exc.errors():
        parts = [part for part in error.get("loc", ()) if part not in _LOC_ROOTS]
        if not parts:
            continue
        path = ""
        for part in parts:
            path += f"[{part}]" if isinstance(part, int) else (f".{part}" if path else str(part))
        return path
    return None


async def request_validation_error_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """본문·쿼리 검증 실패 → `422 validation_error`(SPEC-001 §4 Case Matrix).

    FastAPI 기본 응답은 `{"detail": [...]}` 라 계약의 `{detail, code}` 와 형태가 다르다.
    **왜 틀렸는지는 싣지 않고 어느 필드인지만**(`field`) 싣는다 — 프론트는 `code` 로 분기하고 `field` 로 칸을 고른다.
    """
    assert isinstance(exc, RequestValidationError)
    return JSONResponse(
        status_code=422,
        content={
            "detail": "입력값을 확인해 주세요",
            "code": "validation_error",
            "field": _first_invalid_field(exc),
        },
    )


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="task-management API", version=settings.app_version)

    # CORS — **명시 목록**. `*` 를 쓰지 않는다.
    # 쿠키를 쓰지 않으므로(Bearer) `allow_credentials=False` 다(DEC-001 §4 · SYS-3).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)

    app.include_router(health_router.router)
    app.include_router(auth_router.public_router)
    app.include_router(auth_router.session_router)
    app.include_router(setting_router.router)
    app.include_router(task_router.router)
    app.include_router(meeting_router.router)
    # WS 전용 라우터 — REST 표면은 `meeting_router` 에 더한다(SPEC-007 §4)
    app.include_router(meeting_stream_router.router)

    return app


app = create_app()

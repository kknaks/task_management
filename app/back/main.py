"""앱 팩토리 — 조립만 한다. 로직 없음(backend/README.md §4).

라우터 · CORS · 예외 핸들러를 여기 **한 곳**에서만 등록한다.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import auth_router, health_router, setting_router, task_router
from config import get_settings
from core.exceptions import AppError


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """도메인 예외 → HTTP. 응답 형태는 `{"detail", "code"}` 로 고정한다(§8-2)."""
    assert isinstance(exc, AppError)
    return JSONResponse(
        status_code=exc.status,
        content={"detail": exc.detail, "code": exc.code},
    )


async def request_validation_error_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """본문 검증 실패 → `422 validation_error`(SPEC-001 §4 Case Matrix).

    FastAPI 기본 응답은 `{"detail": [...]}` 라 계약의 `{detail, code}` 와 형태가 다르다.
    **어느 필드가 왜 틀렸는지 싣지 않는다** — 프론트는 `code` 로 분기한다.
    """
    return JSONResponse(
        status_code=422,
        content={"detail": "입력값을 확인해 주세요", "code": "validation_error"},
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

    return app


app = create_app()

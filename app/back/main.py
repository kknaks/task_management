"""앱 팩토리 — 조립만 한다. 로직 없음(backend/README.md §4).

라우터 · CORS · 예외 핸들러를 여기 **한 곳**에서만 등록한다.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import health_router
from config import get_settings
from core.exceptions import AppError


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """도메인 예외 → HTTP. 응답 형태는 `{"detail", "code"}` 로 고정한다(§8-2)."""
    assert isinstance(exc, AppError)
    return JSONResponse(
        status_code=exc.status,
        content={"detail": exc.detail, "code": exc.code},
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
    app.include_router(health_router.router)

    return app


app = create_app()

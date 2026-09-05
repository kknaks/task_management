"""도메인 예외 + HTTP 매핑(backend/README.md §8-2).

service·repository 는 `fastapi` 를 모른다. 여기 정의한 예외만 던지고,
HTTP 로 바꾸는 곳은 `main.py` 에 등록한 핸들러 **하나뿐**이다.
응답 형태는 `{"detail": "...", "code": "..."}` 로 고정한다.
"""

from __future__ import annotations


class AppError(Exception):
    status: int = 500
    code: str = "internal_error"

    def __init__(self, detail: str, code: str | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code


class ValidationError(AppError):
    status = 422
    code = "validation_error"


class UnauthorizedError(AppError):
    status = 401
    code = "unauthorized"


class ForbiddenError(AppError):
    status = 403
    code = "forbidden"


class NotFoundError(AppError):
    status = 404
    code = "not_found"


class ConflictError(AppError):
    status = 409
    code = "conflict"


class DatabaseUnavailableError(AppError):
    """SPEC-000 §4 Case Matrix 의 `db_unavailable`.

    §8-2 의 5종(422·401·403·404·409)은 도메인 판정 결과이고,
    이것은 그 밖에 SPEC 이 명시한 **설계된 실패** 하나다 — 인프라 가용성.
    """

    status = 503
    code = "db_unavailable"

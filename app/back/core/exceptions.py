"""도메인 예외 + HTTP 매핑(backend/README.md §8-2).

service·repository 는 `fastapi` 를 모른다. 여기 정의한 예외만 던지고,
HTTP 로 바꾸는 곳은 `main.py` 에 등록한 핸들러 **하나뿐**이다.
응답 형태는 `{"detail": "...", "code": "..."}` 로 고정한다.
"""

from __future__ import annotations


class AppError(Exception):
    status: int = 500
    code: str = "internal_error"
    # **이 실패로 끝나도 그때까지의 쓰기를 남기는가.** 기본은 아니오(=요청이 통째로 롤백된다).
    # 켜는 것은 「실패 응답 자체가 쓰기를 뜻하는」 설계된 실패뿐이다 — 지금은 A-7 재사용 감지 하나다.
    persist_changes: bool = False

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


class RefreshTokenReuseError(UnauthorizedError):
    """A-7 재사용 감지 — 무효인 refresh 가 다시 왔다.

    응답은 여느 `invalid_refresh_token` 과 **구별되지 않는다**(SPEC-001 §4 Case Matrix).
    다른 점은 하나 — **무효화가 응답과 무관하게 남아야 한다.** 401 과 함께 롤백되면
    「그 계정의 유효 세션을 전부 끊는다」가 실행되지 않고 탈취된 토큰이 계속 산다.
    """

    code = "invalid_refresh_token"
    persist_changes = True


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

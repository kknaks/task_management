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
    """422. **`field` 는 틀린 요청 필드 이름**(camelCase · 요청 스키마 기준 — `title` · `endAt` · `agendas[0].title` …).

    화면이 어느 칸에 테두리를 그릴지 고른다(SPEC-006 §4 Case Matrix 「해당 컨트롤 실패 테두리 + 인라인 문구」).
    여러 필드가 틀렸으면 **첫 번째 하나**만 싣는다. 모르면 `None` — 화면이 폼 전체에 붙인다.
    업무·설정·회의 어디서 나든 응답 모양은 하나다(`{detail, code, field}`).
    """

    status = 422
    code = "validation_error"

    def __init__(self, detail: str, code: str | None = None, *, field: str | None = None) -> None:
        super().__init__(detail, code)
        self.field = field


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


class TaskCompletionBlockedError(ValidationError):
    """T-5 완료 게이트 — 결과자료도 완료 결과도 없이 완료로 보냈다(DEC-002 §4).

    **거부는 정상 경로다**(SPEC-004 §4). 세 진입점(리스트 셀·상세 드롭다운·칸반 DnD)과
    이후 회의록이 전부 같은 판정을 지나므로, 이 예외를 던지는 곳도 **한 곳뿐**이다.

    `persist_changes` 를 켜지 않는다 — **실패가 쓰기를 뜻하지 않는다**(BE §7).
    거부되면 상태가 바뀌지 않고 로그도 남지 않는다.
    """

    code = "task_completion_blocked"


class InvalidStatusTransitionError(ConflictError):
    """T-6 전이 그래프 위반 — `done → cancelled` 처럼 그래프 밖으로 가려 했다.

    화면이 비활성으로 미리 알리지만 **판정은 서버가 한다**(SPEC-004 §5).
    """

    code = "invalid_status_transition"


class UndoNotAvailableError(ConflictError):
    """실행취소 조건 미충족(SPEC-004 §4 · BE §8-2).

    ① 마지막 로그가 상태 전이가 아니거나 ② 그 뒤 다른 변경이 있거나 ③ **4초가 지났다**.
    4초는 완료 토스트 수명과 맞춘 spec 값이다.

    **취소 전이는 이것이 아니다** — 아래 `CancelUndoNotAllowedError` 가 따로 있다.
    """

    code = "undo_not_available"


class CancelUndoNotAllowedError(ConflictError):
    """**실행취소는 완료 전용이다** — 취소 전이는 되돌릴 수 없다(SPEC-004 §4 Case Matrix, 2026-09-06 신설).

    조건 미충족(`undo_not_available`)과 **코드를 나눈 이유는 사유가 다르기 때문**이다.
    저쪽은 「기다렸다 놓쳤다」라 시간을 말해 주는 편이 낫고, 이쪽은 **시간과 무관한 금지**다.
    합쳐 두면 4초가 지나지 않았는데 「시간이 지났습니다」를 내보내게 된다 —
    도달 경로가 낡은 클라이언트·API 직접·회의록(WORK-008)이라 **사람이 디버깅하는 자리**이고,
    틀린 사유를 읽으면 엉뚱한 데를 판다.

    화면 안내의 둘째 줄(「상태에서 직접 되돌릴 수 있습니다」)은 두 코드가 **공유한다.**
    """

    code = "cancel_undo_not_allowed"


class DatabaseUnavailableError(AppError):
    """SPEC-000 §4 Case Matrix 의 `db_unavailable`.

    §8-2 의 5종(422·401·403·404·409)은 도메인 판정 결과이고,
    이것은 그 밖에 SPEC 이 명시한 **설계된 실패** 하나다 — 인프라 가용성.
    """

    status = 503
    code = "db_unavailable"


class InvalidMeetingStatusError(ConflictError):
    """회의 상태 흐름(`scheduled → recording → generating → ended`, 한 방향) 밖의 요청(SPEC-006 §4).

    **상태별 허용 표의 판정은 `meeting_service._assert_allowed()` 한 곳**이고 이 예외는 거기서만 난다.
    `/start` 두 번 · `recording` 중 삭제·일시 변경·메타 변경 · `generating` 중 첨부 등이 전부 이 코드다.

    **`meeting_not_recording` 을 만들지 않는다** — 같은 상황(상태 가드)이라 이 코드 하나로 합쳤다
    (SPEC-006 §7 정합 #3 · 코디 확정). `detail` 문구만 화면별로 다를 수 있다.
    """

    code = "invalid_meeting_status"

"""1층 — HTTP 만. SPEC-001 §4 API Contract 의 4표면.

라우터가 **둘**인 이유는 인증 게이트다 — `login`·`refresh` 는 게이트 밖이고,
`logout`·`session` 은 라우터 단위 `dependencies=[Depends(require_account)]` 뒤에 있다
(backend/README.md §9 — 개별 함수에서 빠뜨릴 여지를 없앤다).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, require_account
from schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SessionResponse,
    TokenResponse,
)
from service import auth_service

# 게이트 밖 — 세션이 없는 상태에서 부르는 두 표면(SPEC-001 §4).
public_router = APIRouter(prefix="/api/auth", tags=["auth"])

# 게이트 안 — 유효한 access 를 요구한다.
session_router = APIRouter(
    prefix="/api/auth",
    tags=["auth"],
    dependencies=[Depends(require_account)],
)


@public_router.post(
    "/login",
    response_model=TokenResponse,
    response_model_by_alias=True,
)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    return TokenResponse.from_dto(await auth_service.login(session, body.to_dto()))


@public_router.post(
    "/refresh",
    response_model=TokenResponse,
    response_model_by_alias=True,
)
async def refresh(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    return TokenResponse.from_dto(await auth_service.refresh(session, body.refresh_token))


@session_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: LogoutRequest,
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await auth_service.logout(
        session, account_id=account_id, refresh_token=body.refresh_token
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@session_router.get(
    "/session",
    response_model=SessionResponse,
    response_model_by_alias=True,
)
async def get_session(
    account_id: int = Depends(require_account),
    session: AsyncSession = Depends(get_db),
) -> SessionResponse:
    return SessionResponse.from_dto(
        await auth_service.get_account_summary(session, account_id)
    )

# MCP 서버 — codex 가 우리 데이터를 읽는 유일한 길(MF-68). **back 과 다른 이미지**다.
# back 을 COPY 하지 않는다 — 여기서 우리 코드를 import 할 방법이 없어야 한다.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    MCP_PORT=8010

WORKDIR /app

# 의존성 레이어를 소스와 분리한다.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .

EXPOSE 8010

# `MCP_BASE_URL`(back 주소)은 compose 가 준다 — 없으면 기동에서 죽는다(server.py `_base_url`).
CMD ["python", "server.py"]

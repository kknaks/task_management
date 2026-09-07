# 로컬 기동 절차 한 곳. 절차는 `make up → make migrate → make seed` 순서다.

COMPOSE := docker compose -f docker-compose.local.yml
BACK    := app/back
FRONT   := app/front

.DEFAULT_GOAL := help
.PHONY: help up down logs ps migrate revision downgrade seed sync test test-db reset front-install app front-build

help: ## 사용 가능한 명령
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Postgres + API 를 띄운다
	$(COMPOSE) up -d --build

down: ## 스택을 내린다 (데이터는 남는다)
	$(COMPOSE) down

logs: ## API 로그를 따라간다
	$(COMPOSE) logs -f api

ps: ## 컨테이너 상태
	$(COMPOSE) ps

migrate: ## 마이그레이션을 head 까지 적용한다
	$(COMPOSE) exec api alembic upgrade head

downgrade: ## 리비전 하나를 되감는다 (개발용)
	$(COMPOSE) exec api alembic downgrade -1

revision: ## autogenerate 초안을 만든다 — 사람이 반드시 읽고 고친다. 예) make revision m="add task"
	$(COMPOSE) exec api alembic revision --autogenerate -m "$(m)"

seed: ## 계정 1 + 기본 유형 3종을 넣는다 (멱등 · 마이그레이션 이후에만)
	$(COMPOSE) exec api python -m seed.seed

sync: ## 호스트 개발 환경(테스트용) 의존성 설치
	cd $(BACK) && uv sync

test-db: ## 테스트 DB 를 만든다 (이미 있으면 넘어간다)
	$(COMPOSE) exec -T db sh -c 'psql -U "$$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '\''task_management_test'\''" | grep -q 1 || createdb -U "$$POSTGRES_USER" task_management_test'

test: ## 백엔드 테스트 (실제 Postgres). 예) make test a="-k health"
	set -a && . ./.env && set +a && cd $(BACK) && uv run pytest -q $(a)

front-install: ## 프론트 의존성 설치 (최초 1회)
	cd $(FRONT) && npm ci

app: ## Tauri 앱 창을 띄운다 (프론트 개발 서버를 함께 문다). 마이크 권한이 안 뜨면 src-tauri/Info.plist 변경 후 재컴파일이 안 된 것 — `tauri build` 로 구운 .app 에서 확인
	cd $(FRONT) && npm run tauri dev

front-build: ## 정적 산출물(`app/front/out`)만 굽는다
	cd $(FRONT) && npm run build

reset: ## 볼륨째 초기화 후 다시 세운다
	$(COMPOSE) down -v
	$(MAKE) up
	$(MAKE) migrate
	$(MAKE) seed

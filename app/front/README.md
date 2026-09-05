# app/front — 정적 번들 + Tauri 셸

Next.js 정적 빌드(`output: 'export'`) + shadcn/ui + Tailwind + TanStack Query v5.
개발도 배포도 **Tauri 앱 창**에서 돈다(§C-4 · SPEC-000 §1).

구조·규약의 정본은 **문서 레포**다 — `40-architecture/frontend/README.md`. 여기 적는 것은 기동 절차뿐이다.

## 기동 (레포 루트에서)

```bash
cp .env.example .env && $EDITOR .env      # 백엔드 env — 비밀값·SEED_* 를 채운다
cp app/front/.env.example app/front/.env.local   # NEXT_PUBLIC_API_BASE
make up && make migrate && make seed      # Postgres + API · 스키마 · 시드
make front-install && make app            # 의존성 설치(최초 1회) · 앱 창(tauri dev)
```

앱 창에 **「서버에 연결되었습니다」** 와 대상 주소·버전이 보이면 스택이 선 것이다.
브라우저에서 확인하려면 `cd app/front && npm run dev` 후 <http://localhost:3000>.

| 명령 | 하는 일 |
|---|---|
| `make app` | `tauri dev` — 프론트 개발 서버를 앱 창에 문다 |
| `make front-build` | `out/` 정적 산출물만 굽는다 |
| `cd app/front && npm run typecheck` | `tsc --noEmit` |
| `cd app/front && npm run lint` | 금지 목록(§11) 일부를 ESLint 로 검사 |

## 버전 핀 (WORK-001 Open Issues 「Next·Node 버전 핀」 해소)

| 항목 | 값 |
|---|---|
| Node | **20.11+** (`package.json` `engines`) · 검증 환경 20.20.0 |
| Next.js | **15.5.25** |
| React | **19.2.8** |
| Tailwind CSS | **3.4.19** (설정 파일이 `tailwind.config.ts` 인 v3 계열) |
| TanStack Query | **5.102.8** |
| Rust / Tauri | rustc 1.97 · `@tauri-apps/cli` 2.11.4 · `tauri` 크레이트 2.11.3 |

## 알아 둘 것 두 가지

**1. 앱 창 origin 은 개발과 배포가 다르다.** 백엔드 `CORS_ORIGINS` 명시 목록에 **셋 다** 들어 있어야 한다.

| 환경 | 창의 origin |
|---|---|
| `tauri dev` | `http://localhost:3000` (devUrl 을 그대로 문다) |
| 배포 번들 · macOS | `tauri://localhost` |
| 배포 번들 · Windows | `http://tauri.localhost` |

**2. CSP 의 `connect-src` 에 API 주소가 박혀 있다**(`src-tauri/tauri.conf.json`).
`NEXT_PUBLIC_API_BASE` 를 바꾸면 CSP 도 같이 고쳐야 한다 — v1 에 서버 주소 설정 화면이 없어
빌드 시점에 고정되는 값이기 때문이다(SYS §런타임 배치).

또한 정적 export 는 부트스트랩용 **인라인 `<script>` 를 낸다** — 그래서 `script-src` 에
`'unsafe-inline'` 이 들어간다. 미들웨어를 쓸 수 없어(FE-C1) nonce 를 심을 자리가 없다.
CSP 가 막는 것은 **외부 origin**(SYS-3)이고, 그 부분은 `default-src 'self'` 로 지켜진다.

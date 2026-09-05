import type { Config } from "tailwindcss";

/**
 * 색·형태 값은 여기에 적지 않는다 — 전부 `styles/tokens.css` 의 CSS 변수를 가리킨다.
 * 그래야 디자인이 값을 바꿀 때 고칠 자리가 한 곳으로 남는다(frontend/README.md §5-1).
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    /**
     * §7-1 세 구간에 맞춰 **기본 브레이크포인트(sm/md/lg)를 지운다.**
     * `extend` 가 아니라 통째 재정의라 sm/md/lg 를 쓰면 빌드에서 클래스가 안 나온다.
     * < 1280 은 브레이크포인트가 아니라 최소 폭 안내 화면(P-02)이 덮는 구간이다.
     */
    screens: {
      desk: "1280px",
      wide: "1440px",
      ultra: "1920px",
    },
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          hover: "var(--primary-hover)",
        },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",

        /**
         * 「검정은 위치」 — **화면당 하나**(§5-2). 내 업무 화면에서는 **유형 탭 밑줄**이
         * 그 하나이고 뷰 토글은 `current` 로 그린다(SPEC-004 §2 · S004-OQ-2).
         */
        ink: "var(--tm-ink)",
        /* 고르는 목록의 「현재 값」 — 선택 칩(`select`)과 다른 축이다 */
        current: { DEFAULT: "var(--tm-current-bg)", foreground: "var(--tm-select-fg)" },
        /* 칸반 드롭 플레이스홀더(U-4) */
        "drop-placeholder": {
          DEFAULT: "var(--tm-drop-placeholder-bg)",
          border: "var(--tm-drop-placeholder-border)",
        },

        /* 본문 계열 · 면과 선 — shadcn 시맨틱으로 덮이지 않는 축만 노출한다 */
        "fg-meta": "var(--tm-fg-meta)",
        "fg-caption": "var(--tm-fg-caption)",
        divider: "var(--tm-divider)",
        "row-divider": "var(--tm-row-divider)",
        "row-hover": "var(--tm-row-hover)",
        /* 인라인 추가 행 배경 — 행 hover 와 다른 면이다(SPEC-002 U-2) */
        "row-add": "var(--tm-row-add-bg)",
        "sidebar-border": "var(--tm-sidebar-border)",
        column: "var(--tm-column)",
        surface: "var(--tm-surface)",

        status: {
          todo: "var(--tm-status-todo)",
          progress: "var(--tm-status-progress)",
          done: "var(--tm-status-done)",
          cancelled: "var(--tm-status-cancelled)",
          overdue: "var(--tm-status-overdue)",
        },

        /* 검색어 하이라이트 — 검색 결과의 일치 구간(§색 · SPEC-003 U-8) */
        "search-highlight": "var(--tm-search-highlight)",

        /* 동적 유형 색 — `data-color-token` 이 고른 팔레트 쌍(§5-3) */
        palette: { bg: "var(--tm-palette-bg)", fg: "var(--tm-palette-fg)" },
      },

      borderRadius: {
        card: "var(--tm-radius-card)",
        control: "var(--tm-radius-control)",
        chip: "var(--tm-radius-chip)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      boxShadow: {
        card: "var(--tm-shadow-card)",
        drawer: "var(--tm-shadow-drawer)",
        modal: "var(--tm-shadow-modal)",
        popover: "var(--tm-shadow-popover)",
        /**
         * **입력 포커스 글로우** — 색 스와치의 「현재 값」 표시와 **같은 토큰**이다
         * (`09-design-tokens.md` §색: 「이름을 일반화해 한 토큰을 재사용한다」).
         */
        focus: "var(--tm-focus-ring)",
      },

      fontFamily: {
        sans: ["var(--tm-font-sans)"],
      },

      /**
       * 타이포 계단을 프리셋으로 고정한다 — 컴포넌트가 임의 크기를 쓰지 않는다(§5-1).
       * 값은 `09-design-tokens.md` §타입 그대로다.
       */
      fontSize: {
        /**
         * 로그인 브랜드 패널 헤드라인 — `11-auth-profile.md §로그인` 의 「헤드라인 44/700」.
         * 계단이 프리셋에 없어 컴포넌트가 임의 크기를 쓰고 있었다(검수 W-1). 값은 디자인
         * 원본 그대로이고, **등록만** 여기로 옮겨 §5-1 「임의 크기 금지」를 지킨다.
         */
        "brand-title": ["44px", { lineHeight: "1.25", letterSpacing: "-0.03em", fontWeight: "700" }],
        "page-title": ["28px", { lineHeight: "1.3", letterSpacing: "-0.03em", fontWeight: "700" }],
        "detail-title": ["26px", { lineHeight: "1.35", letterSpacing: "-0.03em", fontWeight: "700" }],
        panel: ["16px", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "700" }],
        section: ["14px", { lineHeight: "1.45", letterSpacing: "-0.02em", fontWeight: "700" }],
        body: ["14px", { lineHeight: "1.6", letterSpacing: "-0.02em" }],
        meta: ["13px", { lineHeight: "1.5", letterSpacing: "-0.02em" }],
        caption: ["12px", { lineHeight: "1.5", letterSpacing: "-0.02em" }],
        /* 유형 배지 — `09-design-tokens.md` §상태·유형 「h20 r4 11px/600」 */
        badge: ["11px", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "600" }],
      },

      /* 컨트롤 높이 — 09-design-tokens §형태 (입력 38~48 · 버튼 34) */
      height: {
        control: "34px",
        input: "38px",
        /* 로그인·설정 폼의 큰 입력. 범위 상단(48) — `11-auth-profile.md §로그인` */
        "input-lg": "48px",
        /* 화면 주 CTA. 로그인 화면의 두 버튼이 50px 이다(같은 문서) */
        cta: "50px",
        row: "52px",
        todo: "44px",
      },

      width: {
        drawer: "var(--tm-drawer-width)",
        modal: "var(--tm-modal-width)",
        sidebar: "var(--tm-sidebar-width)",
        /* 첨부 팝오버 360 · 연관업무 팝오버 382 — 팝오버 200–400 범위(§6) */
        "popover-attach": "var(--tm-popover-attach-width)",
        "popover-relation": "var(--tm-popover-relation-width)",
        /* 전체 페이지 우측 단 — ≥1440 은 528, 1280~1439 는 400(SPEC-003 U-11) */
        "detail-aside": "528px",
        /* 칸반 카드·컬럼 320 — 1280~1439 에서 **고정**이고 가로 스크롤이 된다(U-13) */
        "kanban-col": "320px",
        /* 우클릭 컨텍스트 메뉴 220 — 팝오버 200–400 범위(§6 · U-5) */
        "popover-menu": "220px",
      },

      /* 첨부 팝오버 360 — 오버레이 팝오버 200–400 범위(§6 · SPEC-003 U-7) */
      /* shadcn `DialogContent` 의 `max-w-lg`(512) 를 오버레이 규격으로 덮는다(§6) */
      maxWidth: {
        drawer: "var(--tm-drawer-width)",
        modal: "var(--tm-modal-width)",
      },

      /**
       * 본문 좌우 여백 — 값은 `tokens.css` 의 `--tm-gutter` 가 정본이다(§5-1).
       * **구간이 둘이라** 단일 `clamp` 로 못 만든다: 1280~1439 는 48 고정,
       * ≥1440 은 80→240 보간이고 그 전환을 미디어 쿼리가 한다(§7-1 · 검수 W-2).
       */
      spacing: {
        gutter: "var(--tm-gutter)",
      },

      backgroundColor: {
        "scrim-drawer": "var(--tm-scrim-drawer)",
        "scrim-modal": "var(--tm-scrim-modal)",
      },

      /* 로그인 브랜드 패널 — 값은 `tokens.css` 의 `--tm-brand-gradient`(§5-1) */
      backgroundImage: {
        brand: "var(--tm-brand-gradient)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;

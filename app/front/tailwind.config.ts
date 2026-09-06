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
        /* AI 서피스 외곽선 — 시안 [05] SURFACE · [06] AI PROMPT BAR */
        "border-ai": "var(--tm-border-ai)",

        /**
         * 「검정은 위치」 — **화면당 하나**(§5-2). 내 업무 화면에서는 **유형 탭 밑줄**이
         * 그 하나이고 뷰 토글은 `current` 로 그린다(SPEC-004 §2 · S004-OQ-2).
         */
        ink: "var(--tm-ink)",
        /**
         * 고르는 목록의 **「현재 값」** — 선택 칩(`select`)과 다른 축이다.
         *
         * 이름이 `current` 면 **Tailwind 관용구를 덮는다**(검수 W-1): `current` 는 내장 색으로
         * `currentColor` 이고 `text-current`·`fill-current`·`stroke-current` 는 「상속색을 그대로」라는
         * 표준 표현이다. 덮는 순간 shadcn 생성물(`checkbox.tsx` 의 `text-current`)이 조용히
         * 다른 색이 된다 — 그래서 **값·규격은 그대로 두고 이름만** `pick` 으로 옮겼다.
         */
        pick: { DEFAULT: "var(--tm-current-bg)", foreground: "var(--tm-select-fg)" },
        /* 칸반 드롭 플레이스홀더(U-4) */
        "drop-placeholder": {
          DEFAULT: "var(--tm-drop-placeholder-bg)",
          border: "var(--tm-drop-placeholder-border)",
        },

        /* 본문 계열 · 면과 선 — shadcn 시맨틱으로 덮이지 않는 축만 노출한다 */
        "fg-meta": "var(--tm-fg-meta)",
        "fg-caption": "var(--tm-fg-caption)",
        /* placeholder · 비활성 아이콘 — 시안 [01] COLOR 「Placeholder · Icon」 */
        "fg-placeholder": "var(--tm-fg-placeholder)",
        divider: "var(--tm-divider)",
        "row-divider": "var(--tm-row-divider)",
        "row-hover": "var(--tm-row-hover)",
        /* 인라인 추가 행 배경 — 행 hover 와 다른 면이다(SPEC-002 U-2) */
        "row-add": "var(--tm-row-add-bg)",
        /* 중립 칩 바탕 — 프로젝트 칩·취소 배지(시안 [02]) */
        "chip-bg": "var(--tm-chip-bg)",
        "sidebar-border": "var(--tm-sidebar-border)",
        column: "var(--tm-column)",
        surface: "var(--tm-surface)",
        /* 흰 면 위에 얹는 옅은 바닥 — **body 배경이 아니다**(globals.css 주석) */
        canvas: "var(--tm-canvas)",
        /* 행 선택 — 시안 [01] COLOR 「Row Selected」 */
        "row-selected": "var(--tm-row-selected)",

        /* 충족·성공 — 시안 [07] Password Strength. 상태 5색과 다른 축이다 */
        success: "var(--tm-success)",

        /* 그라디언트 원색 — 시안 [01] COLOR 두 번째 줄. 배경·본문에 쓰지 않는다 */
        "hero-top": "var(--tm-hero-top)",
        "sky-200": "var(--tm-sky-200)",
        "violet-300": "var(--tm-violet-300)",

        /* 토스트 「실행취소」 — Ink 서피스 위 링크색(시안 [07] Toast) */
        "toast-action": "var(--tm-toast-action)",

        status: {
          todo: "var(--tm-status-todo)",
          progress: "var(--tm-status-progress)",
          done: "var(--tm-status-done)",
          cancelled: "var(--tm-status-cancelled)",
          overdue: "var(--tm-status-overdue)",
        },

        /* 검색어 하이라이트 — 검색 결과의 일치 구간(§색 · SPEC-003 U-8) */
        "search-highlight": "var(--tm-search-highlight)",

        /* 회의록 표면 — 필터 칩·상태 바 테두리 · 탭 dot · AI 한 줄 요약 바(SPEC-006 · [09]) */
        "chip-border": "var(--tm-chip-border)",
        "dot-idle": "var(--tm-dot-idle)",
        "dot-fixed": "var(--tm-dot-fixed)",
        "ai-bar": {
          DEFAULT: "var(--tm-ai-bar-bg)",
          border: "var(--tm-ai-bar-border)",
          foreground: "var(--tm-ai-bar-fg)",
          badge: "var(--tm-ai-bar-badge-fg)",
        },
        "agenda-badge": "var(--tm-agenda-badge-bg)",

        /* 동적 유형 색 — `data-color-token` 이 고른 팔레트 쌍(§5-3) */
        palette: { bg: "var(--tm-palette-bg)", fg: "var(--tm-palette-fg)" },
      },

      borderRadius: {
        /* 시안 [05] SURFACE 는 면이 둘이다 — Card r8 / Panel r16, 테두리는 둘 다 #D9D9D9 */
        card: "var(--tm-radius-card)",
        panel: "var(--tm-radius-panel)",
        control: "var(--tm-radius-control)",
        chip: "var(--tm-radius-chip)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      boxShadow: {
        /**
         * 시안 [05] SURFACE 의 넷. **Panel 은 그림자가 없어** 여기에 자리가 없다 —
         * 패널은 `rounded-panel border-border` 만 쓴다.
         */
        card: "var(--tm-shadow-card)",
        metric: "var(--tm-shadow-metric)",
        floating: "var(--tm-shadow-floating)",
        ai: "var(--tm-shadow-ai)",
        /* 칸반 「지금 하고 있는」 카드 — 진행중 컬럼의 하나에만 */
        "kanban-active": "var(--tm-shadow-kanban-active)",
        drawer: "var(--tm-shadow-drawer)",
        modal: "var(--tm-shadow-modal)",
        /* 토스트 — 팝오버보다 진하다(시안 [07] Toast) */
        toast: "var(--tm-shadow-toast)",
        popover: "var(--tm-shadow-popover)",
        /**
         * **입력 포커스 글로우** — 색 스와치의 「현재 값」 표시와 **같은 토큰**이다
         * (`09-design-tokens.md` §색: 「이름을 일반화해 한 토큰을 재사용한다」).
         */
        focus: "var(--tm-focus-ring)",
        /* 「기록 중」 dot 광륜 — 회의록 목록 상태 표기([09] L723) */
        halo: "var(--tm-recording-halo)",
      },

      fontFamily: {
        sans: ["var(--tm-font-sans)"],
      },

      /**
       * 타이포 계단을 프리셋으로 고정한다 — 컴포넌트가 임의 크기를 쓰지 않는다(§5-1).
       *
       * **값은 시안 [03] TYPE 의 열 계단 그대로다.** 「화면 전체 -0.02em, 큰 제목은 -0.03em」.
       * 요약본을 보고 만들었을 때 `section` 이 14, `body` 가 14 로 어긋나 있었고
       * `hero-date` · `group-header` · `item` · `metric` 은 아예 없어 화면이 숫자를 직접 썼다.
       */
      fontSize: {
        /**
         * 로그인 브랜드 패널 헤드라인 — `로그인 · 계정 · 프로필.dc.html` 의 「헤드라인 44/700」.
         * 시안 [03] TYPE 계단 밖이지만 로그인 화면이 실제로 쓰는 크기라 **등록만** 해 둔다
         * (§5-1 「임의 크기 금지」).
         */
        "brand-title": ["44px", { lineHeight: "1.28", letterSpacing: "-0.035em", fontWeight: "700" }],
        /* 시안 [03] Page Title · 28 / 700 / -0.03 */
        "page-title": ["28px", { lineHeight: "1.3", letterSpacing: "-0.03em", fontWeight: "700" }],
        /* 시안 [03] Hero Date · 24 / 700 / -0.03 */
        "hero-date": ["24px", { lineHeight: "1.3", letterSpacing: "-0.03em", fontWeight: "700" }],
        /* 업무 상세 제목 — `업무 화면 정의서.dc.html`. 시안 [03] 계단 밖이라 등록만 해 둔다 */
        "detail-title": ["26px", { lineHeight: "1.35", letterSpacing: "-0.03em", fontWeight: "700" }],
        /* 시안 [03] Panel Title · 16 / 700 */
        panel: ["16px", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "700" }],
        /* 시안 [03] Section · 15 / 700 */
        section: ["15px", { lineHeight: "1.45", letterSpacing: "-0.02em", fontWeight: "700" }],
        /* 시안 [03] Group Header · 14 / 700 */
        "group-header": ["14px", { lineHeight: "1.45", letterSpacing: "-0.02em", fontWeight: "700" }],
        /* 시안 [03] Item · 14 / 600 */
        item: ["14px", { lineHeight: "1.45", letterSpacing: "-0.02em", fontWeight: "600" }],
        /* 시안 [03] Body · 15 / 400 / 1.65 */
        body: ["15px", { lineHeight: "1.65", letterSpacing: "-0.02em", fontWeight: "400" }],
        /* 시안 [03] Meta · 13 / #757575 */
        meta: ["13px", { lineHeight: "1.5", letterSpacing: "-0.02em" }],
        /* 시안 [03] Caption · 12 / #9EA2AE */
        caption: ["12px", { lineHeight: "1.5", letterSpacing: "-0.02em" }],
        /* 시안 [03] Metric · 28 / 700 */
        metric: ["28px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],

        /**
         * 아래 셋은 **로그인 시안이 쓰는데 [03] TYPE 계단에 없는 조합**이다
         * (`로그인 · 계정 · 프로필.dc.html` 32~80줄). 화면이 숫자를 직접 쓰지 않도록 등록한다.
         */
        /* 입력 라벨 「아이디」·「비밀번호」 — 시안 64·69줄 */
        "field-label": ["13px", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "600" }],
        /**
         * **드로어 블록·필드 라벨** — 「제목」·「유형」·「일정」·「할일」·「로그」…
         * `업무 화면 정의서.dc.html` 566·572·586·612줄이 전부 **12 / 700 / `#757575`** 다.
         * `section`(15/700 Ink)을 쓰면 라벨이 본문보다 무거워져 시안과 어긋난다(REDRAW-05 F-1①).
         */
        "block-label": ["12px", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "700" }],
        /* 컨트롤 라벨 — 체크박스 라벨(79줄) · 브랜드 패널 특징 3줄(40줄) */
        "control-label": ["14px", { lineHeight: "1.5", letterSpacing: "-0.02em", fontWeight: "400" }],
        /* 브랜드 패널 서브 — 시안 34줄 「16 / lh 1.7」 */
        "brand-body": ["16px", { lineHeight: "1.7", letterSpacing: "-0.02em", fontWeight: "400" }],
        /* 유형 배지 — 시안 [02] STATUS & TYPE TOKENS 「badge · h20 · r4 · 11px/600」 */
        badge: ["11px", { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "600" }],

        /**
         * 아래 넷은 **회의록 시안이 쓰는데 [03] TYPE 계단에 없는 조합**이다(회의록.dc.html).
         * 컴포넌트가 `text-[NNpx]` 를 쓰지 않도록 이름을 붙여 올린다(§5-1 · WORK-006 검수 W-4).
         * ⚠ 더할 때 `lib/utils.ts` 의 twMerge `font-size` 목록에도 같이 더한다.
         */
        /* 행 번호·작은 굵은 칩 — 「안건 n」(L497 · L586) · 「AI 한 줄 요약」 배지([09] L731) · 11 / 700 */
        "row-label": ["11px", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "700" }],
        /* 빈 상태 제목(L601) · 파일 드로어 헤더 이름([09] L1170) · 17 / 700 */
        subhead: ["17px", { lineHeight: "1.4", letterSpacing: "-0.02em", fontWeight: "700" }],
        /* 드로어 헤더 제목 「새 회의록」(L442) · 18 / 700 / -0.03 */
        "drawer-title": ["18px", { lineHeight: "1.4", letterSpacing: "-0.03em", fontWeight: "700" }],
        /* MD 타일 글자([09] L1170 · 시안 L1170) · 10 / 800 */
        "tile-mark": ["10px", { lineHeight: "1", letterSpacing: "0", fontWeight: "800" }],
      },

      letterSpacing: {
        /* 시안 [03] TYPE — 전역 -0.02em, 큰 제목만 -0.03em */
        tm: "var(--tm-tracking)",
        title: "var(--tm-tracking-title)",
      },

      /* 컨트롤 높이 — 시안 [07] OVERLAY · INPUT (입력 38~48 · 버튼 34) */
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

        /**
         * **스페이스 계단** — 시안 [04] LAYOUT 「4 · 8 · 12 · 16 · 24 · 32 · 48」.
         * 일곱 값이 Tailwind 기본 키(1·2·3·4·6·8·12)와 정확히 같아 **그 자리에 얹는다** —
         * `p-4`·`gap-6` 이 뜻하는 px 는 그대로이고, 값을 고칠 자리만 `tokens.css` 로 모인다.
         * 계단 밖 값(`gap-1.5` 등)은 여전히 Tailwind 기본이 답하지만 화면이 쓰지 않는다.
         */
        1: "var(--tm-space-1)",
        2: "var(--tm-space-2)",
        3: "var(--tm-space-3)",
        4: "var(--tm-space-4)",
        6: "var(--tm-space-6)",
        8: "var(--tm-space-8)",
        12: "var(--tm-space-12)",
      },

      backgroundColor: {
        "scrim-drawer": "var(--tm-scrim-drawer)",
        "scrim-modal": "var(--tm-scrim-modal)",
      },

      /* 로그인 브랜드 패널 — 값은 `tokens.css` 의 `--tm-brand-gradient`(§5-1) */
      backgroundImage: {
        brand: "var(--tm-brand-gradient)",
        /* 로고 마크 「M」 사각 — 패널 그라디언트와 다른 축이다 */
        "brand-mark": "var(--tm-brand-mark)",
        /* 사이드바 프로필 아바타 32px 원 */
        avatar: "var(--tm-avatar)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;

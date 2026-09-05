/**
 * 팔레트 토큰명의 **프론트 정본 하나**(SPEC-002 §4 Data Contract).
 *
 * **여기에 hex 가 없다.** 값은 `styles/tokens.css` 한 곳이고 서버 값은 `dto/enums.py` 의
 * `ColorToken` 이다. 이 파일이 드는 것은 **이름과 순서**뿐이다.
 *
 * 아래 `ColorToken` 은 이 배열에서 **파생**한다(검수 W-1). 전에는 `types/api.ts` 의 유니온과
 * 이 배열이 같은 8개를 **손으로 두 번** 적고 있었다 — 유니온에만 이름을 더하면 팝오버에서
 * 조용히 빠지고, 배열에만 더하면 타입이 잡아 준다. 한쪽만 잡히는 비대칭이라 정본을 하나로 뒀다.
 *
 * 팔레트를 늘리려면 **`dto/enums.py` · `tokens.css` · 이 배열** 셋을 고친다
 * (CSS 선택자는 파생이 불가능하고 서버 enum 은 다른 런타임이라 구조상 줄일 수 없다).
 */

/** 4×2 그리드 순서 — 기본 유형 시드 3종이 앞, 확장 5종이 뒤(SPEC-002 §4 표 순서 그대로). */
export const PALETTE_TOKENS = [
  "indigo",
  "violet",
  "steel",
  "mint",
  "sky",
  "amber",
  "rose",
  "graphite",
] as const;

/**
 * 허용 색 팔레트 8종의 토큰명. 백엔드 `dto/enums.py` 의 `ColorToken` 을 미러한다
 * (§3-6). **배열에서 파생하므로 목록이 갈릴 수 없다.**
 */
export type ColorToken = (typeof PALETTE_TOKENS)[number];

/** 인라인 추가 행이 미리 잡아 두는 값(U-2 「색은 팔레트 첫 값이 미리 잡혀 있다」). */
export const DEFAULT_COLOR_TOKEN: ColorToken = PALETTE_TOKENS[0];

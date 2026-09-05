/**
 * 팔레트 **순서**를 정하는 곳 하나 — 색 팝오버의 4×2 그리드가 이 순서로 그려진다.
 *
 * **여기에 hex 가 없다.** 값은 `styles/tokens.css` 한 곳이 정본이고(SPEC-002 §4 규칙 4),
 * 토큰명은 `types/api.ts` 의 `ColorToken` 이 백엔드 계약을 미러한다. 이 파일은 그 둘을
 * 이어 주는 **나열 순서**만 갖는다 — 값을 여기 복제하면 정의가 셋이 된다.
 *
 * 팔레트를 늘리려면 `dto/enums.py` · `tokens.css` 를 고치고 이 배열에 이름을 더한다.
 */

import type { ColorToken } from "@/types/api";

/** 4×2 그리드 순서 — 기본 유형 시드 3종이 앞, 확장 5종이 뒤(SPEC-002 §4 표 순서 그대로). */
export const PALETTE_TOKENS: readonly ColorToken[] = [
  "indigo",
  "violet",
  "steel",
  "mint",
  "sky",
  "amber",
  "rose",
  "graphite",
] as const;

/** 인라인 추가 행이 미리 잡아 두는 값(U-2 「색은 팔레트 첫 값이 미리 잡혀 있다」). */
export const DEFAULT_COLOR_TOKEN: ColorToken = PALETTE_TOKENS[0];

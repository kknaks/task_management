import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * **tailwind-merge 에 우리 커스텀 스케일을 알려준다.**
 *
 * tailwind-merge 는 `tailwind.config.ts` 를 읽지 않는다 — Tailwind **기본** 스케일만 안다.
 * 그래서 `text-body` 처럼 이름이 t-shirt 사이즈(`sm`·`lg`…)가 아닌 커스텀 크기를 만나면
 * **글자색(`text-<color>`)으로 오인**한다. 그 상태로 `text-body text-foreground` 가 들어오면
 * 「같은 축의 색 두 개」로 보고 **뒤엣것만 남긴다 — 앞의 크기 클래스가 조용히 사라진다.**
 *
 * 증상이 조용해서 오래 눈에 띄지 않았다: CSS 는 정상 생성되고(`.text-body{font-size:15px}`)
 * DOM 에서 클래스만 빠진다. 실제로 로그인 라벨이 `text-field-label`(13/600)을 잃고
 * shadcn 기본 `text-sm`(14/500)으로 그려지고 있었다(REDRAW-01 검수).
 *
 * **크기와 색은 애초에 CSS 상 충돌하지 않는다**(`font-size` vs `color`) — 순전히
 * tailwind-merge 의 오분류다. 아래 등록으로 바로잡는다.
 *
 * ⚠ **`tailwind.config.ts` 에 스케일을 더하면 여기에도 더해라.** 하나라도 빠지면
 * 그 자리만 조용히 죽는다. 같은 함정이 `shadow-*`·`bg-*`(그라디언트)에도 있어 함께 등록한다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      /** `tailwind.config.ts` 의 `fontSize` 키 전수(§5-1 타이포 계단) */
      "font-size": [
        {
          text: [
            "brand-title",
            "page-title",
            "hero-date",
            "detail-title",
            "panel",
            "section",
            "group-header",
            "item",
            "body",
            "meta",
            "caption",
            "metric",
            "badge",
            "field-label",
            "block-label",
            "control-label",
            "brand-body",
            /* WORK-006 W-4 — 회의록 계단 넷 */
            "row-label",
            "subhead",
            "drawer-title",
            "tile-mark",
          ],
        },
      ],
      /** `boxShadow` 키 전수 — 그림자도 `shadow-<color>` 로 오인된다 */
      shadow: [
        {
          shadow: [
            "card",
            "metric",
            "floating",
            "ai",
            "drawer",
            "modal",
            "popover",
            "focus",
            /**
             * 칸반 활성 카드. **같은 요소에서 `shadow-card` 와 다툰다** —
             * 등록하지 않으면 둘 다 남아 CSS 순서가 이기고, 그건 우리가 통제하지 않는다.
             */
            "kanban-active",
            "toast",
            /* 「기록 중」 dot 광륜 — `shadow-focus` 와 같은 요소에서 다투지 않지만 같은 축이라 등록한다 */
            "halo",
          ],
        },
      ],
      /** `backgroundImage` 키 — 그라디언트가 `bg-<color>` 로 오인된다 */
      "bg-image": [{ bg: ["brand", "brand-mark", "avatar"] }],

      /**
       * **`borderRadius` 키 전수.** 여기서 실제로 화면이 깨져 있었다 —
       * shadcn 생성물이 `rounded-md` 를 기본으로 갖는데(button·input·select·popover·textarea)
       * twMerge 가 `rounded-control` 을 모르는 이름이라 **충돌로 보지 않고 둘 다 남겼다.**
       * 그다음은 CSS 순서 싸움이고 `rounded-md` 가 이겨서 입력칸이 8px 이 아니라 **6px** 로
       * 그려지고 있었다(REDRAW-01 검수 실측).
       *
       * 「버려지지 않으니 안전하다」가 아니다 — **둘 다 남는 것 자체가 결함**이다.
       * 어느 쪽이 이기는지가 Tailwind 의 emit 순서에 달리게 되고 그건 우리가 통제하지 않는다.
       */
      rounded: [{ rounded: ["card", "panel", "control", "chip"] }],

      /**
       * 아래는 같은 이유로 **결정성**을 위해 등록한다 — shadcn 기본 클래스와 같은 속성을
       * 다투는 커스텀 키들이다(`h-9`·`w-72`·`max-w-lg`·`px-3` 등과 만난다).
       * 등록 전에는 「둘 다 남고 순서로 결정」이었고, 등록 후에는 **뒤에 쓴 것이 이긴다**로
       * 규칙이 분명해진다.
       */
      h: [{ h: ["control", "input", "input-lg", "cta", "row", "todo"] }],
      w: [{ w: ["drawer", "modal", "sidebar", "detail-aside", "kanban-col",
                "popover-attach", "popover-relation", "popover-menu"] }],
      "max-w": [{ "max-w": ["drawer", "modal"] }],
      px: [{ px: ["gutter"] }],
      tracking: [{ tracking: ["tm", "title"] }],
    },
  },
});

/** shadcn 규약의 클래스 병합 유틸. 생성물이 이 경로를 기대한다(`components.json`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * **키보드 판정 한 곳**(REDRAW-07 B-1).
 *
 * ## 왜 필요한가 — 한글로 Enter 를 치면 두 번 들어갔다
 *
 * 한글·일본어·중국어는 **IME 조합**을 거친다. 「할일」을 치고 Enter 를 누르면
 * 그 Enter 는 **조합을 확정하는 Enter** 이지 「등록해라」가 아니다. 그런데 브라우저는
 * 그 확정 Enter 로도 `keydown` 을 쏘고, 사용자가 등록하려고 **한 번 더** 누르면
 * 또 쏜다 — 그래서 **항목이 2개** 만들어졌다.
 *
 * 영문 입력은 조합이 없어 이 문제가 안 보인다. 그래서 오래 안 잡혔다.
 *
 * ## 어떻게 가르나
 *
 * `KeyboardEvent.isComposing` 이 조합 중이면 `true` 다. 표준이고 최신 브라우저가 다 준다.
 * `keyCode === 229` 는 **같은 상황의 구형 신호**다 — 일부 브라우저·IME 조합에서
 * `isComposing` 이 아직 `false` 인데 `keyCode` 만 229 로 오는 경우가 있어 **둘 다 본다.**
 *
 * ⚠ **이 판정을 파일마다 복붙하지 마라.** 한 군데라도 빠지면 그 입력만 조용히 두 번 들어간다
 * (실제로 그렇게 났다). Enter 로 무언가를 확정하는 자리는 **전부 이 헬퍼를 지난다.**
 */

/**
 * **이 Enter 가 「확정」인가** — 조합 중이면 `false` 다.
 *
 * 입력값을 등록·저장·제출하는 `onKeyDown` 에서 쓴다. 조합과 무관한 버튼의 Enter
 * (예: `V2Gate` 의 차단)에는 필요 없다 — 그쪽은 텍스트 입력이 아니다.
 */
export function isEnterSubmit(event: React.KeyboardEvent): boolean {
  if (event.key !== "Enter") {
    return false;
  }
  const native = event.nativeEvent;
  // 조합 확정 Enter — 이것으로 등록하면 사용자가 누른 적 없는 한 건이 더 생긴다.
  return !native.isComposing && native.keyCode !== 229;
}

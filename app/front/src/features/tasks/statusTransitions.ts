/**
 * **전이 그래프 — 화면이 미리 알려 주는 용도**(SPEC-004 §5 · T-6).
 *
 * > 전이 그래프도 서비스가 검사한다. 위반은 `invalid_status_transition` 이고,
 * > **화면은 비활성으로 미리 알리되 그것이 판정은 아니다.**
 *
 * 그래서 이 표는 **편의**다. 정본은 서버이고, 화면이 막지 못한 요청도 서버가 같은 답을 낸다.
 * 세 진입점(팝오버·컨텍스트 메뉴·칸반 드롭)이 **이 표 하나**를 본다 — 화면마다 그리면
 * 「어디서는 눌리고 어디서는 안 눌리는」 상태가 생긴다.
 *
 * **완료 게이트는 여기 없다.** 결과자료 유무를 화면이 미리 판단해 막으면 서버와 어긋난다
 * (§5 · WP §Internal Interface Contract) — 완료 항목은 **언제나 열려 있고** 서버가 판정한다.
 */

import type { TaskStatus } from "@/features/tasks/types";

/** `todo→in_progress|done|cancelled` · `in_progress→done|todo|cancelled` · `done→in_progress` · `cancelled→todo` */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "done", "cancelled"],
  in_progress: ["todo", "done", "cancelled"],
  // **`done→cancelled` 가 없다**(DEC-002 §4) — 먼저 진행중으로 되돌린다.
  done: ["in_progress"],
  cancelled: ["todo"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 왜 못 바꾸는지 — **그 조합에서만** 구체적으로 말한다(U-4 툴팁 · U-3 캡션).
 * 조합별 문구가 없으면 일반 문구로 떨어진다. `null` 이면 **바꿀 수 있다**는 뜻이다.
 */
export function transitionBlockedReason(from: TaskStatus, to: TaskStatus): string | null {
  if (canTransition(from, to)) {
    return null;
  }
  if (from === to) {
    // 서버는 같은 상태 재전송을 **409** 로 돌려준다(전이 그래프에 자기 자신이 없다).
    // 사용자가 아무것도 안 했는데 에러를 보지 않도록 **요청을 내지 않는** 쪽이 화면의 몫이다.
    return "이미 그 상태입니다";
  }
  if (from === "done" && to === "cancelled") {
    return "완료는 진행중으로 되돌린 뒤 취소할 수 있습니다";
  }
  return "이 상태로는 바꿀 수 없습니다";
}

/**
 * **줄의 `payload` 를 읽는 자리 하나**(SPEC-008 U-6 · U-9 · U-10 · M-14-a).
 *
 * `payload` 는 두 모양이다 — 액션 줄은 **새 업무 생성분**, 업무 줄은 **변경분**. 가리는 것은 **`title` 키 유무**이고
 * 서버(`LineUpdate._payload_shape_from_the_title_key`)도 같은 규칙을 쓴다. **AI 가 채웠나 사람이 채웠나로 가르지 않는다**(MF-65) —
 * 화면이 보는 것은 「차 있나 비어 있나」뿐이다.
 *
 * 보낼 때의 규칙도 여기 있다 — **채워진 키만 싣는다**(`compactChanges`). 「보내지 않음」이 곧 「변경 없음」이라
 * `null` 을 보내면 서버가 `422` 로 막는다. AI 가 저장한 값에 `completionResult: null` 같은 키가 섞여 있어도 그대로 되돌려 보내지 않는다.
 */

import { STATUS_LABEL } from "@/components/shared/StatusDot";
import type {
  ActionLinePayload,
  LinePayload,
  MeetingLine,
  TaskLinePayload,
} from "@/features/meetings/types";
import { formatDueDate } from "@/lib/datetime";

/** 액션 줄의 생성분인가 — `title` 키가 그 표시다(서버와 같은 판정). */
export function isActionPayload(payload: LinePayload): payload is ActionLinePayload {
  return "title" in payload && typeof (payload as ActionLinePayload).title === "string";
}

/** 액션 줄이 들고 있는 생성분. 모양이 다르면 `null` — 화면이 엉뚱한 값을 그리지 않는다. */
export function actionPayloadOf(line: Pick<MeetingLine, "payload">): ActionLinePayload | null {
  const payload = line.payload;
  return payload && isActionPayload(payload) ? payload : null;
}

/** 업무 줄이 들고 있는 변경분. */
export function taskPayloadOf(line: Pick<MeetingLine, "payload">): TaskLinePayload | null {
  const payload = line.payload;
  return payload && !isActionPayload(payload) ? payload : null;
}

/** 값이 있는 키인가 — 빈 문자열 · 빈 배열 · `null` 은 「보내지 않음」이다. */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return !Array.isArray(value) || value.length > 0;
}

/**
 * **채워진 키만** 남긴다 — `payload` 저장과 「넣기」 본문이 같은 함수를 지난다(두 곳이 갈리지 않게).
 * 서버가 `null` 키를 `422` 로 막으므로 **비우는 뜻의 값을 만들지 않는다**.
 */
export function compactChanges(changes: TaskLinePayload): TaskLinePayload {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (isFilled(value)) {
      compact[key] = value;
    }
  }
  return compact as TaskLinePayload;
}

export function hasChanges(changes: TaskLinePayload): boolean {
  return Object.keys(compactChanges(changes)).length > 0;
}

/**
 * 줄 버튼 툴팁(U-6) — `payload` 의 내용을 사람 말로. **`status` 가 업무의 현재 상태와 같으면 뺀다**(서버도 그 전이를 건너뛴다).
 * 액션 줄은 「업무 생성」의 생성분이라 제목·유형이 아니라 **채워진 항목**을 센다.
 */
export function payloadSummary(line: Pick<MeetingLine, "payload" | "task">): string[] {
  const payload = line.payload;
  if (!payload) {
    return [];
  }
  if (isActionPayload(payload)) {
    const parts: string[] = [];
    if (isFilled(payload.workTypeId)) {
      parts.push("유형");
    }
    if (isFilled(payload.startDate) || isFilled(payload.dueDate)) {
      parts.push("일정");
    }
    if (isFilled(payload.description)) {
      parts.push("설명");
    }
    if (isFilled(payload.todos)) {
      parts.push(`할일 ${payload.todos?.length ?? 0}건`);
    }
    return parts.length > 0 ? [`${payload.title} · ${parts.join(" · ")}`] : [payload.title];
  }

  const parts: string[] = [];
  if (isFilled(payload.dueDate)) {
    parts.push(`기한 → ${formatDueDate(payload.dueDate as string)}`);
  }
  if (payload.status && payload.status !== line.task?.status) {
    parts.push(`상태 → ${STATUS_LABEL[payload.status]}`);
  }
  if (isFilled(payload.note)) {
    parts.push("메모 1건");
  }
  if (isFilled(payload.todos)) {
    parts.push(`할일 ${payload.todos?.length ?? 0}건`);
  }
  if (isFilled(payload.relatedTaskIds)) {
    parts.push(`연관 ${payload.relatedTaskIds?.length ?? 0}건`);
  }
  if (isFilled(payload.projectId)) {
    parts.push("프로젝트");
  }
  if (isFilled(payload.completionResult)) {
    parts.push("완료 결과");
  }
  return parts;
}

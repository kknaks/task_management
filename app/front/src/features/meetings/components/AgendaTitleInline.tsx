"use client";

/**
 * **편집 모드의 안건 제목 입력 상자**(SPEC-008 U-7 · 시안 L1894 · L1924 · L1959 — 결정 ②로 계약이 됐다).
 *
 * 15/700 · 테두리 `#EBEBEB` r8 · padding 5/10 · 흰 배경. 포커스 시 테두리 `#7181F8`.
 * **포커스 해제 시 저장**(`PATCH …/agendas/{id} {title}` — 소유자가 부른다). 빈 값이면 되돌리고 「안건 이름을 비울 수 없습니다」.
 *
 * **안건을 추가·삭제하는 버튼은 없다**(DEC-003 §1 표 L44 ③ · M-5-d) — 이 컴포넌트는 이름만 고친다.
 * 「안건 n」 라벨 · 상태 배지는 `AgendaHeader` 가 그대로 그린다 — 여기는 제목 슬롯에 들어가는 입력 하나다.
 */

import { InlineFieldInput } from "@/features/meetings/components/InlineFieldInput";

export const AGENDA_TITLE_EMPTY_MESSAGE = "안건 이름을 비울 수 없습니다";

export function AgendaTitleInline({
  number,
  title,
  onSave,
  saveFailed = false,
}: {
  /** 「안건 n」 — 접근성 이름에 쓴다. */
  number: number;
  title: string;
  onSave: (next: string) => Promise<void>;
  saveFailed?: boolean;
}) {
  return (
    <InlineFieldInput
      ariaLabel={`안건 ${number} 제목`}
      value={title}
      onSave={onSave}
      emptyMessage={AGENDA_TITLE_EMPTY_MESSAGE}
      saveFailed={saveFailed}
      className="min-w-0 flex-1"
      inputClassName="h-[30px] px-2.5 text-section font-bold"
    />
  );
}

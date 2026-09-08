"use client";

/**
 * **U-7 자동 저장 실패 표시 — 행 아래 인라인 자리 하나**(SPEC-002, 2026-09-06 팝오버 규격 확정).
 *
 * > 입력 상자가 아닌 컨트롤은 **아래에 캡션을 넣을 세로 공간이 없다**(색 트리거 56px 버튼 ·
 * > 목록 행 64px 고정). 그래서 규격을 하나 더 두지 않고 **행 단위 인라인 자리**로 통일한다.
 *
 * 그래서 **캡션·「다시 저장」을 그리는 자리는 이 컴포넌트 하나**다. 컨트롤(`InlineEditText` ·
 * `ColorPickerPopover`)은 **자기 테두리만** 실패색으로 바꾸고 문구는 그리지 않는다 —
 * 컨트롤마다 그리게 두면 두 번째 자동 저장 컨트롤이 생기는 순간 규격이 샌다(검수 F-1 이 그것이다).
 *
 * - 한 행에서 **여러 필드가 실패하면 줄을 늘려** 각각 적는다. **자리는 여전히 행 아래 하나**다
 * - **행 높이(64)를 바꾸지 않는다** — 실패가 있을 때만 나타나므로 U-8 「두 줄로 접히지 않는다」와
 *   부딪히지 않는다
 * - **자동 재시도가 없다.** 「다시 저장」을 누를 때만 한 번 나간다(DEC-001 §7 · FE §3-2 `retry:false`)
 */

/**
 * 주격 조사 이/가 — **받침 유무**로 고른다.
 *
 * 문구를 `${label}이` 로 굳혀 두면 받침 없는 이름이 들어오는 순간 「프로젝트이」가 된다.
 * 실제로 같은 종류의 실수를 한 번 냈다(「유형가」) — 그래서 여기서 한 번만 판정한다.
 */
function subjectParticle(label: string): "이" | "가" {
  const last = label.trim().at(-1);
  if (!last) {
    return "이";
  }
  const code = last.charCodeAt(0);
  // 한글 음절 영역 밖(영문·숫자 등)이면 안전한 쪽으로 「이」를 쓴다.
  if (code < 0xac00 || code > 0xd7a3) {
    return "이";
  }
  // (음절 - 0xAC00) % 28 === 0 이면 받침이 없다.
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

export interface AutoSaveFailure {
  /** 필드 식별자. 같은 행에서 유일하면 된다. */
  field: string;
  /** 문구에 들어가는 사람 말 이름 — 「〈필드 이름〉이 저장되지 않았습니다」. */
  label: string;
  /** 누를 때만 **한 번** 재요청한다. */
  onRetry: () => void;
}

export function AutoSaveFailureNotice({
  failures,
  busy = false,
}: {
  failures: readonly AutoSaveFailure[];
  /** 재요청이 나가 있는 동안 버튼을 잠근다. 표시 자체는 지우지 않는다. */
  busy?: boolean;
}) {
  if (failures.length === 0) {
    // 실패가 없으면 자리 자체가 없다 — 행 높이를 건드리지 않는다.
    return null;
  }

  return (
    <div role="alert" className="flex flex-col gap-1 px-5 pb-2">
      {failures.map((failure) => (
        <p
          key={failure.field}
          className="flex items-center justify-between gap-2 text-caption text-destructive"
        >
          <span>
            {failure.label}
            {subjectParticle(failure.label)} 저장되지 않았습니다
          </span>
          <button
            type="button"
            onClick={failure.onRetry}
            disabled={busy}
            className="shrink-0 underline underline-offset-2 disabled:opacity-60"
          >
            다시 저장
          </button>
        </p>
      ))}
    </div>
  );
}

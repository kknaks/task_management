"use client";

/**
 * **기한 — 날짜 + 「시간 지정」 토글**(SPEC-003 U-1 2 · §4 Validation).
 *
 * - `dueStartTime`·`dueEndTime` 은 **둘 다 있거나 둘 다 없다.** 있으면 `dueDate` 도 있어야 하고
 *   `end > start`(T-1-b)
 * - **낙관적 갱신을 하지 않는다** — 겹침이 거부할 수 있다(§5 표). 값은 서버 응답 뒤에 바뀐다
 * - 실패 표시는 **prop** 이다(`saveFailed`) — 캡션·「다시 저장」은 그 행 아래 인라인 자리 하나
 */

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DueValue {
  dueDate: string | null;
  dueStartTime: string | null;
  dueEndTime: string | null;
}

export function DueDateField({
  value,
  onChange,
  saveFailed = false,
  disabled = false,
}: {
  value: DueValue;
  onChange: (next: DueValue) => void;
  saveFailed?: boolean;
  disabled?: boolean;
}) {
  const timed = value.dueStartTime !== null && value.dueEndTime !== null;

  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label="기한 날짜"
        data-save-failed={saveFailed || undefined}
        value={value.dueDate ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value === "" ? null : event.target.value;
          // 날짜를 지우면 시각도 함께 사라진다 — 둘 다 있거나 둘 다 없다(T-1-b).
          onChange(
            next === null
              ? { dueDate: null, dueStartTime: null, dueEndTime: null }
              : { ...value, dueDate: next },
          );
        }}
        className={cn("h-9 w-[150px]", saveFailed && "border-destructive")}
      />

      <span className="flex items-center gap-1.5">
        <Checkbox
          id="due-timed"
          checked={timed}
          disabled={disabled || value.dueDate === null}
          onCheckedChange={(checked) =>
            onChange(
              checked === true
                ? { ...value, dueStartTime: "09:00", dueEndTime: "10:00" }
                : { ...value, dueStartTime: null, dueEndTime: null },
            )
          }
        />
        <Label htmlFor="due-timed" className="text-meta text-muted-foreground">
          시간 지정
        </Label>
      </span>

      {timed ? (
        <>
          <Input
            type="time"
            aria-label="시작 시각"
            value={value.dueStartTime ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, dueStartTime: event.target.value })}
            className="h-9 w-[110px]"
          />
          <span className="text-meta text-fg-caption">–</span>
          <Input
            type="time"
            aria-label="종료 시각"
            value={value.dueEndTime ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, dueEndTime: event.target.value })}
            className="h-9 w-[110px]"
          />
        </>
      ) : null}
    </div>
  );
}

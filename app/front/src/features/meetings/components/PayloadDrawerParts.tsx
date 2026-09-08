"use client";

/**
 * **payload 드로어 둘이 함께 쓰는 부품**(SPEC-008 U-9 · U-10 · MF-66).
 *
 * 두 드로어가 같은 규격을 두 벌 적지 않게 여기 모은다 — 라벨 + 「회의에서 반영」 표시 · 할일 초안 목록 · 푸터 문구.
 * 업무 탭 드로어(`TaskCreateDrawer` · `TaskDetailDrawer`)의 **부품을 보고 조립한 것**이고 그 파일들은 고치지 않는다(MF-67 · 정적 검사).
 */

import { useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { isEnterSubmit } from "@/lib/keyboard";

/** 푸터는 모드별 **하나씩**이다 — 한 푸터에 버튼 셋을 두지 않는다(MF-66). */
export type SubmitMode = "save" | "insert";

/**
 * `save` = 편집 모드 · 칩 진입(「저장」 — `payload` 만 줄에 붙는다) ·
 * `insert` = 보기 모드(「넣기」 — 업무를 만들거나 고친다).
 */
export const SUBMIT_LABEL: Record<SubmitMode, string> = { save: "저장", insert: "넣기" };

/** `payload` 가 채운 칸의 캡션 — 값의 **출처**를 말한다(디자인 시스템 [07] 포커스 규격 재사용). 사람이 고칠 수 있다. */
export const FROM_MEETING_CAPTION = "회의에서 반영";

export function PayloadField({
  label,
  htmlFor,
  fromMeeting = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** `payload` 가 채운 칸이면 캡션이 붙는다. */
  fromMeeting?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-meta font-semibold text-foreground">
            {label}
          </label>
        ) : (
          <span className="text-meta font-semibold text-foreground">{label}</span>
        )}
        {fromMeeting ? <span className="text-caption text-ai-bar-badge">{FROM_MEETING_CAPTION}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * **할일 초안 목록** — 서버에는 문자열 배열로 나간다(`payload.todos`). 저장 전이라 완료 체크가 없다.
 * 입력에서 `Enter` 또는 「추가」로 붙이고 행의 ×로 뺀다.
 */
export function TodoDraftList({
  todos,
  onChange,
  disabled = false,
}: {
  todos: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    onChange([...todos, text]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      {todos.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-control border border-border p-1.5">
          {todos.map((todo, index) => (
            <li key={`${todo}-${index}`} className="flex h-8 items-center gap-2 rounded-control px-2 hover:bg-muted">
              <span className="min-w-0 flex-1 truncate text-control-label text-foreground">{todo}</span>
              <button
                type="button"
                aria-label={`할일 제거 ${todo}`}
                disabled={disabled}
                onClick={() => onChange(todos.filter((_, i) => i !== index))}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-control text-fg-caption hover:bg-card hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="할일"
          placeholder="할일을 적고 Enter"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isEnterSubmit(event)) {
              event.preventDefault();
              add();
            }
          }}
          className="h-9 flex-1 text-meta"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || draft.trim().length === 0}
          className="flex h-9 shrink-0 items-center gap-1 rounded-control border border-border px-3 text-meta text-fg-meta hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3 w-3" aria-hidden />
          추가
        </button>
      </div>
    </div>
  );
}

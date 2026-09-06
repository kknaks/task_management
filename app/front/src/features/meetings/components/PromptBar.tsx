"use client";

/**
 * **프롬프트 바**(SPEC-007 U-3 · 시안 L918~972). 회의록 탭 하단 고정 h56 r14 · 테두리 `#7181F8` · 보랏빛 그림자.
 *
 * [활성 안건 칩 「안건 n ▾」] [종류 라벨] [입력 15px] [현재 시각] [전송 40×40]. **좌측 「+」(L956~958)는 없다**(§7-B).
 *
 * - 입력 맨 앞에 `/` 를 치면 **`LineKindPopover`** 가 바 위에 뜬다. `↑↓` 이동 · `Enter` 선택 · `Esc` 닫기 — 포커스는 입력에 남는다
 * - 종류를 안 고르면 **논의**다. 고르면 칩 옆에 라벨이 붙고 텍스트를 이어 친다(`Backspace` 로 뗀다)
 * - 「새 안건」 → 입력이 안건 제목 입력이 된다(플레이스홀더 「안건 제목」). `Enter` 로 만든다
 * - 활성 안건이 없으면 칩 「안건 선택」 + **전송 비활성**, 팝오버에는 「새 안건」만
 * - 전송 중 잠금 — 중복 전송이 나가지 않는다. 실패하면 **입력이 남는다**(호출자가 `false` 를 돌려준다)
 * - `Shift+Enter` 는 줄바꿈이 아니라 **무시**한다(줄은 한 줄 — §4 Validation). IME 는 `isEnterSubmit`
 *
 * 부모를 모른다 — 콜백 셋(`onSendLine` · `onCreateAgenda` · `onActivateAgenda`)만 받는다. WORK-008 편집 모드가 같은 바를 쓴다.
 */

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Send } from "lucide-react";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  LineKindPopover,
  buildPopoverItems,
  optionId,
  type PopoverItem,
  type PopoverSection,
} from "@/features/meetings/components/LineKindPopover";
import { LINE_KIND_LABEL } from "@/features/meetings/components/LineRow";
import type { LineKind, MeetingAgenda } from "@/features/meetings/types";
import { formatClockMs } from "@/lib/datetime";
import { useNow } from "@/lib/hooks/useNow";
import { isEnterSubmit } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

type Mode = "line" | "agenda";

export function PromptBar({
  agendas,
  activeAgendaId,
  sending = false,
  inlineError = null,
  onSendLine,
  onCreateAgenda,
  onActivateAgenda,
}: {
  /** 사람 트랙 안건 전량(`orderIndex` 순). */
  agendas: readonly MeetingAgenda[];
  activeAgendaId: number | null;
  /** 전송·안건 생성·이동 중 — 입력·버튼 잠금. */
  sending?: boolean;
  /** `validation_error` 인라인 문구(Case Matrix). 입력은 유지된다. */
  inlineError?: string | null;
  /** `true` 면 비운다. `false` 면 입력이 남는다. */
  onSendLine: (kind: LineKind, content: string) => Promise<boolean>;
  onCreateAgenda: (title: string) => Promise<boolean>;
  onActivateAgenda: (agendaId: number) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const now = useNow(60_000);

  const [draft, setDraft] = useState("");
  const [lineKind, setLineKind] = useState<LineKind | null>(null);
  const [mode, setMode] = useState<Mode>("line");
  const [section, setSection] = useState<PopoverSection | null>(null);
  const [cursor, setCursor] = useState(0);

  const sorted = useMemo(() => [...agendas].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id), [agendas]);
  const activeAgenda = sorted.find((agenda) => agenda.id === activeAgendaId) ?? null;
  const otherAgendas = sorted.filter((agenda) => agenda.id !== activeAgendaId);
  const items = useMemo(
    () => (section ? buildPopoverItems(section, activeAgenda, otherAgendas) : []),
    [section, activeAgenda, otherAgendas],
  );

  const open = (next: PopoverSection) => {
    setSection(next);
    setCursor(0);
  };
  const close = () => {
    setSection(null);
    setCursor(0);
    inputRef.current?.focus();
  };

  const canSend = !sending && draft.trim().length > 0 && (mode === "agenda" || activeAgenda !== null);

  const submit = async () => {
    if (!canSend) {
      return;
    }
    const text = draft.trim();
    const ok = mode === "agenda" ? await onCreateAgenda(text) : await onSendLine(lineKind ?? "discussion", text);
    if (ok) {
      setDraft("");
      setLineKind(null);
      setMode("line");
    }
    inputRef.current?.focus();
  };

  const pick = async (item: PopoverItem) => {
    if (item.kind === "line-kind") {
      setLineKind(item.lineKind);
      setMode("line");
      setDraft("");
      close();
      return;
    }
    if (item.kind === "new-agenda") {
      setMode("agenda");
      setLineKind(null);
      setDraft("");
      close();
      return;
    }
    close();
    if (draft === "/") {
      setDraft("");
    }
    await onActivateAgenda(item.agenda.id);
  };

  const onChange = (value: string) => {
    setDraft(value);
    if (section === null && mode === "line" && value === "/") {
      open("full");
      return;
    }
    if (section !== null && !value.startsWith("/")) {
      setSection(null);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (section !== null && items.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((index) => (index + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((index) => (index - 1 + items.length) % items.length);
        return;
      }
      if (isEnterSubmit(event)) {
        event.preventDefault();
        void pick(items[cursor]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (draft === "/") {
          setDraft("");
        }
        close();
        return;
      }
    }
    if (event.key === "Enter") {
      // `Shift+Enter` 는 줄바꿈이 아니라 무시한다 — 줄은 한 줄이다(§4 Validation).
      event.preventDefault();
      if (!event.shiftKey && isEnterSubmit(event)) {
        void submit();
      }
      return;
    }
    if (event.key === "Backspace" && draft === "") {
      if (lineKind) {
        setLineKind(null);
      } else if (mode === "agenda") {
        setMode("line");
      }
    }
  };

  const placeholder =
    mode === "agenda"
      ? "안건 제목"
      : activeAgenda
        ? "그대로 입력하면 논의로 추가 · / 로 안건 이동"
        : "/ 로 첫 안건을 만들어 기록을 시작합니다";

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-divider px-6 py-4">
      <Popover
        open={section !== null}
        onOpenChange={(next) => {
          if (!next) {
            setSection(null);
          }
        }}
      >
        <PopoverAnchor asChild>
          <div
            className={cn(
              "flex h-14 items-center gap-2.5 rounded-[14px] border border-primary bg-card px-2.5 shadow-ai",
              sending && "opacity-80",
            )}
          >
            {activeAgenda ? (
              <button
                type="button"
                aria-label={`안건 ${activeAgenda.orderIndex + 1} · 다른 안건으로 이동`}
                aria-haspopup="listbox"
                aria-expanded={section === "move"}
                disabled={sending}
                onClick={() => (section === "move" ? close() : open("move"))}
                className="flex h-[26px] shrink-0 items-center gap-[5px] rounded-md bg-ai-bar px-[9px] text-caption font-semibold text-ai-bar-badge hover:bg-evidence-hover disabled:cursor-not-allowed"
              >
                안건 {activeAgenda.orderIndex + 1}
                <ChevronDown className="h-2.5 w-2.5" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                aria-label="안건 선택"
                aria-haspopup="listbox"
                aria-expanded={section === "full"}
                disabled={sending}
                onClick={() => (section ? close() : open("full"))}
                className="flex h-[26px] shrink-0 items-center rounded-md bg-agenda-badge px-[9px] text-caption font-semibold text-fg-meta disabled:cursor-not-allowed"
              >
                안건 선택
              </button>
            )}

            {mode === "agenda" ? (
              <span className="shrink-0 text-row-label text-ai-bar-badge">새 안건</span>
            ) : lineKind ? (
              <span className="shrink-0 text-row-label text-ai-bar-badge">{LINE_KIND_LABEL[lineKind]}</span>
            ) : null}

            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={mode === "agenda" ? "안건 제목" : "줄 입력"}
              aria-expanded={section !== null}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={section !== null && items[cursor] ? optionId(listboxId, items[cursor]) : undefined}
              placeholder={placeholder}
              value={draft}
              disabled={sending}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-10 min-w-0 flex-1 bg-transparent px-1 text-body text-foreground placeholder:text-fg-faint focus-visible:outline-none disabled:cursor-not-allowed"
            />

            <span className="shrink-0 text-caption tabular-nums text-fg-faint">{formatClockMs(now)}</span>

            <button
              type="button"
              aria-label="전송"
              onClick={() => void submit()}
              disabled={!canSend}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-[18px] w-[18px]" aria-hidden />}
            </button>
          </div>
        </PopoverAnchor>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="w-auto rounded-xl border-border bg-card p-0 shadow-popover"
        >
          {section ? (
            <LineKindPopover
              listboxId={listboxId}
              section={section}
              activeAgenda={activeAgenda}
              items={items}
              highlighted={cursor}
              onPick={(item) => void pick(item)}
              onHover={setCursor}
            />
          ) : null}
        </PopoverContent>
      </Popover>

      {inlineError ? (
        <p role="alert" className="text-caption text-destructive">
          {inlineError}
        </p>
      ) : null}
    </div>
  );
}

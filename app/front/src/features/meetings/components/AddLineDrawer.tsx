"use client";

/**
 * **추가 드로어 — 논의 · 결정**(SPEC-008 U-8 · 시안 L2042~2305 · [09] L740~741). `DrawerFrame` 위 — 폭·스크림은 프레임이 정한다.
 *
 * - 헤더 「논의 추가」 / 「결정 추가」(세그먼트 값에 따라) 18/700 + 부제 「<제목> · <일시 날짜>」 12 + ×. 열자마자 **내용 입력에 포커스**
 * - 필드 순서: ① 종류 세그먼트 논의 | 결정(36px r8 — 선택 `#F1F2FE` + 테두리 `#7181F8`) ② 안건 셀렉터(44px, 기본값 = 칩을 누른 안건 ·
 *   같은 트랙의 다른 안건으로 바꿀 수 있다) ③ 내용(44px · 필수) ④ 상세 설명 textarea(선택)
 * - 제출 가능: 내용 1자 이상. 제출 중 푸터 비활성 + 진행 표시. 실패: **드로어 유지** + 인라인(422 는 그 필드 · 그 밖은 문구 + 「추가」가 곧 「다시 시도」)
 * - `POST …/lines { agendaId, kind, content, detail }` → 그 안건 **맨 아래**에 줄이 붙고 드로어가 닫힌다(소유자 `onAdd`)
 *
 * **없는 것**(§7 제외): 근거 구간 · 「구간 추가」(L2288~2294) · 캡션 「비워두면 회의 종료 후 AI가 채웁니다」(L2283).
 * 헤더 문구가 세그먼트를 따라가므로 여는 쪽이 만든 작은 스토어(`createKindStore`)를 헤더와 본문이 함께 본다 — 드로어는 부모를 모른다.
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { isValidationError, meetingInlineError, validationFieldOf } from "@/features/meetings/errors";
import type { AddLineInput, MeetingAgenda, MeetingDetail } from "@/features/meetings/types";
import { formatMeetingDateTime } from "@/lib/datetime";
import { isEnterSubmit } from "@/lib/keyboard";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

/** 드로어가 받는 두 종류 — 연관 업무(U-9) · 액션 아이템(U-10)은 Phase 5 의 다른 드로어다. */
export type AddLineKind = "discussion" | "decision";

export const ADD_LINE_TITLE: Record<AddLineKind, string> = { discussion: "논의 추가", decision: "결정 추가" };

/** 헤더(프레임 `renderHeader`)와 본문이 **같은 세그먼트 값**을 보는 작은 스토어. */
export interface KindStore {
  get: () => AddLineKind;
  set: (next: AddLineKind) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createKindStore(initial: AddLineKind): KindStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useKind(store: KindStore): AddLineKind {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function AddLineDrawerHeader({
  store,
  meeting,
  fullscreen,
  onClose,
}: {
  store: KindStore;
  meeting: { title: string; startAt: string };
  fullscreen: boolean;
  onClose: () => void;
}) {
  const kind = useKind(store);
  return (
    <header className={cn("flex shrink-0 items-center justify-between gap-3 border-b border-divider px-7", fullscreen ? "h-[74px]" : "h-[72px]")}>
      <div className="flex min-w-0 items-center gap-3">
        {fullscreen ? (
          <button type="button" aria-label="닫기" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted">
            <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h2 className="truncate text-drawer-title text-foreground">{ADD_LINE_TITLE[kind]}</h2>
          <span className="truncate text-caption text-fg-caption">
            {meeting.title} · {formatMeetingDateTime(meeting.startAt).replace(/ \d\d:\d\d$/, "")}
          </span>
        </div>
      </div>
      {fullscreen ? null : (
        <button type="button" aria-label="드로어 닫기" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted">
          <X className="h-[15px] w-[15px]" aria-hidden />
        </button>
      )}
    </header>
  );
}

type Field = "content" | "detail" | "agendaId" | "form";

function fieldOf(raw: string | null): Field {
  return raw === "content" || raw === "detail" || raw === "agendaId" ? raw : "form";
}

export function AddLineDrawer({
  store,
  agendas,
  initialAgendaId,
  onAdd,
  onCancel,
  onAdded,
}: {
  store: KindStore;
  /** 편집 대상 트랙의 안건 전량 — 셀렉터 목록. */
  agendas: readonly MeetingAgenda[];
  initialAgendaId: number;
  /** 거절은 throw — 여기서 인라인으로 붙인다. */
  onAdd: (input: AddLineInput) => Promise<unknown>;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const kind = useKind(store);
  const [agendaId, setAgendaId] = useState(initialAgendaId);
  const [content, setContent] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const contentRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  const sorted = [...agendas].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  const agenda = sorted.find((item) => item.id === agendaId) ?? sorted[0] ?? null;
  const canSubmit = !submitting && content.trim().length > 0 && agenda !== null;

  const submit = async () => {
    if (!canSubmit || !agenda) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ agendaId: agenda.id, kind, content: content.trim(), detail: detail.trim().length > 0 ? detail.trim() : null });
      onAdded();
    } catch (caught) {
      // **드로어는 열린 채** — 422 는 그 필드, 그 밖은 문구 + 「추가」가 곧 「다시 시도」다(Case Matrix).
      const inline = meetingInlineError(caught);
      if (inline?.toast) {
        toast.error(inline.message);
      }
      setError({
        field: isValidationError(caught) ? fieldOf(validationFieldOf(caught)) : "form",
        message: inline?.message ?? "추가하지 못했습니다 · 다시 시도해 주세요",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const segment = (value: AddLineKind, label: string) => {
    const selected = kind === value;
    return (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => store.set(value)}
        className={cn(
          "flex h-9 items-center rounded-control border px-4 text-meta font-semibold",
          selected ? "border-primary bg-secondary text-secondary-foreground" : "border-border bg-card text-fg-meta hover:bg-muted",
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-[22px]">
      <div role="radiogroup" aria-label="종류" className="flex items-center gap-2">
        {segment("discussion", "논의")}
        {segment("decision", "결정")}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-meta font-semibold text-foreground">안건</span>
        <AgendaSelect listboxId={listboxId} agendas={sorted} value={agenda} onSelect={(next) => setAgendaId(next.id)} invalid={error?.field === "agendaId"} />
        {error?.field === "agendaId" ? <p role="alert" className="text-caption text-destructive">{error.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${listboxId}-content`} className="text-meta font-semibold text-foreground">
          내용
        </label>
        <Input
          id={`${listboxId}-content`}
          ref={contentRef}
          value={content}
          placeholder="한 줄로 적습니다"
          aria-invalid={error?.field === "content"}
          onChange={(event) => {
            setContent(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (isEnterSubmit(event)) {
              event.preventDefault();
              void submit();
            }
          }}
          className={cn("h-11 text-body", kind === "decision" && "font-semibold", error?.field === "content" && "border-destructive")}
        />
        {error?.field === "content" ? <p role="alert" className="text-caption text-destructive">{error.message}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${listboxId}-detail`} className="text-meta font-semibold text-foreground">
          상세 설명
        </label>
        <Textarea
          id={`${listboxId}-detail`}
          value={detail}
          aria-invalid={error?.field === "detail"}
          onChange={(event) => {
            setDetail(event.target.value);
            setError(null);
          }}
          className={cn("min-h-[120px] resize-none rounded-control text-control-label", error?.field === "detail" && "border-destructive")}
        />
        {/* 캡션 「비워두면 회의 종료 후 AI가 채웁니다」 · 근거 구간 · 「구간 추가」는 **없다**(§7) */}
        {error?.field === "detail" ? <p role="alert" className="text-caption text-destructive">{error.message}</p> : null}
      </div>

      {error?.field === "form" ? (
        <p role="alert" className="text-caption text-destructive">
          {error.message}
        </p>
      ) : null}

      <DrawerFooter>
        <button type="button" onClick={onCancel} disabled={submitting} className="flex h-11 items-center rounded-control border border-border px-5 text-control-label text-fg-meta hover:bg-muted disabled:opacity-50">
          취소
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="flex h-11 items-center gap-2 rounded-control bg-primary px-6 text-control-label font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          추가
        </button>
      </DrawerFooter>
    </div>
  );
}

/** 안건 셀렉터 44px — 「안건 n · 제목」. 색 dot 이 없어 공용 `Selector` 대신 목록만 둔다(고르기는 팝오버 — [10]). */
function AgendaSelect({
  listboxId,
  agendas,
  value,
  onSelect,
  invalid,
}: {
  listboxId: string;
  agendas: readonly MeetingAgenda[];
  value: MeetingAgenda | null;
  onSelect: (agenda: MeetingAgenda) => void;
  invalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="안건"
          aria-invalid={invalid}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-control border bg-card px-3.5 text-control-label text-foreground",
            invalid ? "border-destructive" : open ? "border-primary shadow-focus" : "border-border hover:bg-muted",
          )}
        >
          <span className="min-w-0 truncate">{value ? `안건 ${value.orderIndex + 1} · ${value.title}` : "안건을 고르세요"}</span>
          <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[360px] rounded-card border-border bg-card p-1 shadow-popover">
        <ul id={listboxId} role="listbox" aria-label="안건" className="max-h-64 overflow-y-auto">
          {agendas.map((agenda) => {
            const selected = agenda.id === value?.id;
            return (
              <li key={agenda.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelect(agenda);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-meta",
                    selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <span className="w-10 shrink-0 text-row-label text-fg-caption">안건 {agenda.orderIndex + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{agenda.title}</span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 이 드로어를 여는 함수 — 편집 모드의 「+ 논의」 「+ 결정」 칩이 부른다. 전체 페이지에서만(드로어 안에서 드로어를 열지 않는다 — FE §6-2).
 * `openMeetingDrawers` 가 다시 내보낸다(본문이 레지스트리를 import 하지 않게 — 순환 방지).
 */
export function openAddLineDrawer(
  overlay: ReturnType<typeof useOverlay>,
  options: {
    meeting: Pick<MeetingDetail, "title" | "startAt">;
    agendas: readonly MeetingAgenda[];
    agendaId: number;
    kind: AddLineKind;
    onAdd: (input: AddLineInput) => Promise<unknown>;
  },
): void {
  const store = createKindStore(options.kind);
  overlay.openDrawer({
    key: "meeting-add-line",
    title: "줄 추가",
    renderHeader: ({ fullscreen, onClose }) => (
      <AddLineDrawerHeader store={store} meeting={options.meeting} fullscreen={fullscreen} onClose={onClose} />
    ),
    content: (
      <AddLineDrawer
        store={store}
        agendas={options.agendas}
        initialAgendaId={options.agendaId}
        onAdd={options.onAdd}
        onCancel={overlay.closeDrawer}
        onAdded={overlay.closeDrawer}
      />
    ),
  });
}

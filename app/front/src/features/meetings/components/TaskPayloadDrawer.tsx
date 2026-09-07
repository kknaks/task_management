"use client";

/**
 * **업무 payload 드로어**(SPEC-008 U-9 · MF-14 · 59 · 64 정정 · 65 · 66 · 67). `DrawerFrame` 위.
 *
 * **회의록 것이다**(MF-67) — 업무 탭의 업무 상세 드로어를 열지 않고 그 드로어에 슬롯·prop 을 얹지도 않는다.
 * 시각 규격의 참조는 이미 만들어진 `TaskDetailDrawer`(SPEC-003 U-3)이고 **그 파일은 고치지 않는다**(정적 검사).
 *
 * ## 드로어는 하나다(MF-65)
 *
 * AI 가 만든 줄이든 사람이 적은 줄이든 **같은 드로어 · 같은 필드 · 같은 저장 경로**다. 다른 것은 **`prefill` 이 차 있나 비어 있나**뿐.
 * 「업무 연결」 같은 앞 단계가 없다 — **업무는 헤더 셀렉터에서 고른다**(`RelationPopover` 단일 선택 · SPEC-003 U-8 그대로).
 * 기준 프로젝트에 업무가 0건이거나 회의가 무소속이면 팝오버 기본 칩이 「전체」로 내려간다(MF-14 — `RelationPopover` 가 판정한다).
 *
 * ## 본문은 변경분 일곱 + 내용
 *
 * 내용(줄 본문 — 칩 진입에서만 입력) · 기한 · 상태 · 진행 메모 · 할일 추가 · 연관 업무 · 프로젝트 · 완료 결과.
 * **제목 · 유형 · 설명 · 시작일은 없다**(회의록에서 못 바꾼다 — MF-14). 참고자료 · 결과자료 · 로그 · 첨부도 그리지 않는다.
 * **상태 셀렉터에 「완료」·「취소」가 없다**(MF-59 — 완료 게이트에 뒷문을 만들지 않는다).
 * 업무를 아직 안 골랐으면 본문이 비활성이다.
 *
 * ## 푸터는 모드별 하나씩(MF-66)
 *
 * `save`(편집 모드 · 칩) = 「취소 · **저장**」 — `payload` 와 `taskId` 만 줄에 붙는다 · `insert`(보기 모드) = 「취소 · **넣기**」 —
 * `PATCH …/lines/{id}/task` 한 요청으로 업무에 반영한다(업무가 골라져 있어야 활성).
 * **인라인 자동 저장이 없다** — 포커스를 벗어나도 요청이 나가지 않는다.
 *
 * ## 보내는 것은 **채워진 키만**이다
 *
 * 「보내지 않음」이 곧 「변경 없음」이라 `prefill` 을 그대로 되돌려 보내지 않는다(`compactChanges` — 서버가 `null` 키를 `422` 로 막는다).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { STATUS_LABEL, type TaskStatus } from "@/components/shared/StatusDot";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { PayloadField, SUBMIT_LABEL, TodoDraftList, type SubmitMode } from "@/features/meetings/components/PayloadDrawerParts";
import { TaskDateField } from "@/features/meetings/components/TaskDateField";
import { compactChanges } from "@/features/meetings/linePayload";
import { isMeetingNotFound, isValidationError, meetingInlineError } from "@/features/meetings/errors";
import type {
  LineTaskSummary,
  MeetingAgenda,
  MeetingRefSummary,
  PayloadStatus,
  TaskLinePayload,
} from "@/features/meetings/types";
// **`RelationPopover` 는 업무 화면의 부품이고 드로어가 아니다** — U-9 가 「그대로 재사용한다」고 못박아 배럴 예외에 이름 하나를 더했다(정적 검사 ⑨).
import { RelationPopover } from "@/features/tasks";
import { formatDueDate, type DateKey } from "@/lib/datetime";
import { useProjectsQuery } from "@/lib/hooks/useWorkSettings";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export const TASK_PAYLOAD_TITLE = "연관 업무";
export const TASK_PAYLOAD_SUBTITLE = "고른 업무에 이 회의의 변경을 반영합니다";
export const PICK_TASK_PLACEHOLDER = "업무 고르기";
export const NO_TASK_CAPTION = "업무를 고르면 현재 값이 보입니다";
export const TASK_GONE_INLINE = "삭제된 업무입니다 · 다시 골라 주세요";

/** 상태 셀렉터의 값 — **둘뿐**이다(MF-59). 「완료」·「취소」가 여기 없다. */
const PAYLOAD_STATUSES: readonly PayloadStatus[] = ["todo", "in_progress"];

/** 헤더 셀렉터가 물고 있는 업무 — 후보 목록(`TaskRelation`)과 줄의 요약(`line.task`)이 같은 모양으로 들어온다. */
export interface PickedTask {
  id: number;
  title: string;
  status: TaskStatus | null;
  dueDate: string | null;
}

/** 헤더(프레임 `renderHeader`)와 본문이 **같은 업무**를 보는 작은 스토어 — `AddLineDrawer` 의 세그먼트 스토어와 같은 방식이다. */
export interface TaskPickStore {
  get: () => PickedTask | null;
  set: (next: PickedTask | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createTaskPickStore(initial: PickedTask | null): TaskPickStore {
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

function usePickedTask(store: TaskPickStore): PickedTask | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** 드로어 헤더 한 벌 — 제목 18/700 + 부제 12 + ×(전체 화면이면 `←`). 액션 payload 드로어도 같은 것을 쓴다. */
export function TaskDrawerHeader({
  title,
  subtitle,
  fullscreen,
  onClose,
  titleSlot,
}: {
  title: string;
  subtitle: string;
  fullscreen: boolean;
  onClose: () => void;
  /** U-9 — **제목 자리가 셀렉터**다. 없으면 평범한 제목. */
  titleSlot?: React.ReactNode;
}) {
  return (
    <header className={cn("flex shrink-0 items-center justify-between gap-3 border-b border-divider px-7", fullscreen ? "h-[74px]" : "h-[72px]")}>
      <div className="flex min-w-0 items-center gap-3">
        {fullscreen ? (
          <button type="button" aria-label="닫기" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted">
            <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-col gap-[3px]">
          {/* 제목 자리가 셀렉터여도 **드로어에는 이름이 있어야 한다** — 화면에 안 보이는 제목을 남긴다(a11y). */}
          {titleSlot ? (
            <>
              <h2 className="sr-only">{title}</h2>
              {titleSlot}
            </>
          ) : (
            <h2 className="truncate text-drawer-title text-foreground">{title}</h2>
          )}
          <span className="truncate text-caption text-fg-caption">{subtitle}</span>
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

/**
 * 헤더의 **업무 셀렉터** — 누르면 업무 화면의 `RelationPopover` 가 그대로 뜬다(단일 선택).
 * 후보는 `GET /api/tasks/relations/candidates`(`projectId` = 회의의 프로젝트)이고 기본 칩 판정은 팝오버가 한다.
 */
export function TaskPickSelector({
  store,
  meetingProject,
}: {
  store: TaskPickStore;
  meetingProject: MeetingRefSummary | null;
}) {
  const picked = usePickedTask(store);
  const projectId = meetingProject && !meetingProject.isDeleted ? meetingProject.id : null;
  return (
    <RelationPopover
      mode="single"
      projectId={projectId}
      hasBaseProject={projectId !== null}
      selectedIds={picked ? [picked.id] : []}
      onChange={(next, candidates) => {
        const candidate = candidates.find((item) => item.id === next[0]) ?? null;
        store.set(candidate ? { id: candidate.id, title: candidate.title, status: candidate.status, dueDate: candidate.dueDate } : null);
      }}
      trigger={
        <button
          type="button"
          aria-label="업무 고르기"
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-control px-2 text-drawer-title text-foreground hover:bg-muted"
        >
          <span className={cn("min-w-0 truncate", picked === null && "text-fg-caption")}>{picked?.title ?? PICK_TASK_PLACEHOLDER}</span>
          <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
        </button>
      }
    />
  );
}

export function TaskPayloadDrawer({
  store,
  agenda,
  meetingProject,
  lineContent,
  prefill,
  submitMode,
  onSubmit,
  onCancel,
}: {
  store: TaskPickStore;
  /** 칩 진입이면 그 안건(줄이 붙을 자리) — 줄에서 열었으면 `null`(안건이 이미 정해져 있다). */
  agenda: MeetingAgenda | null;
  meetingProject: MeetingRefSummary | null;
  /** 줄에서 열었으면 그 본문(읽기 전용) · 칩 진입이면 `null` — 그때만 입력이다. */
  lineContent: string | null;
  /** 줄의 `payload`. **이것이 차 있나 비어 있나가 유일한 갈래다**(MF-65). */
  prefill: TaskLinePayload | null;
  submitMode: SubmitMode;
  /** 「저장」/「넣기」 — 어떤 요청인지는 **호출자가** 정한다. 거절은 던진다. */
  onSubmit: (input: { taskId: number | null; changes: TaskLinePayload; content: string }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const picked = usePickedTask(store);
  const { data: projects = [] } = useProjectsQuery();
  const contentRef = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState(lineContent ?? "");
  const [dueDate, setDueDate] = useState<DateKey | null>((prefill?.dueDate ?? null) as DateKey | null);
  const [status, setStatus] = useState<PayloadStatus | null>(prefill?.status ?? null);
  const [note, setNote] = useState(prefill?.note ?? "");
  const [todos, setTodos] = useState<string[]>(prefill?.todos ?? []);
  const [relatedTaskIds, setRelatedTaskIds] = useState<number[]>(prefill?.relatedTaskIds ?? []);
  const [projectId, setProjectId] = useState<number | null>(prefill?.projectId ?? null);
  const [completionResult, setCompletionResult] = useState(prefill?.completionResult ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lineContent === null) {
      contentRef.current?.focus();
    }
  }, [lineContent]);

  const disabled = picked === null;
  const projectOptions: SelectorOption[] = projects.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }));
  const project = projectOptions.find((item) => item.id === projectId) ?? null;

  /** 「회의에서 반영」 — `payload` 가 채운 칸만. */
  const filled = (key: keyof TaskLinePayload) => prefill !== null && prefill[key] !== null && prefill[key] !== undefined;

  const changes = compactChanges({
    dueDate,
    // 같은 상태로의 전이는 **요청에 싣지 않는다**(SPEC-004 · 서버도 건너뛴다)
    status: status && status !== picked?.status ? status : null,
    note: note.trim().length > 0 ? note.trim() : null,
    todos,
    relatedTaskIds,
    projectId,
    completionResult: completionResult.trim().length > 0 ? completionResult.trim() : null,
  });

  // 「저장」은 줄 본문만(칩 진입) · 「넣기」는 **업무가 골라져 있어야** 한다(U-9 푸터 조건)
  const canSubmit =
    !submitting &&
    (lineContent !== null || content.trim().length > 0) &&
    (submitMode === "save" || picked !== null);

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ taskId: picked?.id ?? null, changes, content: content.trim() });
    } catch (caught) {
      // **드로어는 열린 채** — 상태 가드는 토스트, 그 밖은 인라인(Case Matrix)
      const inline = meetingInlineError(caught);
      if (inline?.toast) {
        toast.error(inline.message);
      }
      if (isMeetingNotFound(caught)) {
        setError(TASK_GONE_INLINE);
        store.set(null);
      } else {
        setError(inline?.message ?? (isValidationError(caught) ? "입력값을 확인해 주세요" : "저장하지 못했습니다 · 다시 시도해 주세요"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-[22px]">
      {/* 안건 — 칩 진입일 때만(줄이 붙을 자리를 보여 준다) */}
      {agenda ? (
        <PayloadField label="안건">
          <p data-agenda-fixed className="flex h-11 items-center rounded-control border border-border bg-muted px-3.5 text-control-label text-fg-meta">
            안건 {agenda.orderIndex + 1} · {agenda.title}
          </p>
        </PayloadField>
      ) : null}

      {/* 내용 — 줄 본문. 칩 진입에서만 입력이고 「저장」 때 줄 본문이 된다 */}
      <PayloadField label="내용" htmlFor="task-payload-content">
        {lineContent === null ? (
          <Input
            id="task-payload-content"
            ref={contentRef}
            value={content}
            placeholder="줄에 적을 내용"
            onChange={(event) => {
              setContent(event.target.value);
              setError(null);
            }}
            className="h-11 text-body"
          />
        ) : (
          <p className="flex min-h-11 items-center rounded-control border border-border bg-muted px-3.5 text-control-label text-fg-meta">{lineContent}</p>
        )}
      </PayloadField>

      {/* ── 이 회의로 반영할 변경 — 업무를 고르기 전에는 비활성 ─────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-meta font-semibold text-foreground">이 회의로 반영할 변경</span>
          <span className="text-caption text-fg-caption">{disabled ? NO_TASK_CAPTION : "적은 항목만 반영됩니다"}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PayloadField label="기한" fromMeeting={filled("dueDate")}>
            <TaskDateField
              value={dueDate}
              onChange={(next) => {
                setDueDate(next);
                setError(null);
              }}
              placeholder="변경 없음"
              ariaLabel="기한"
              disabled={disabled}
            />
            <span className="text-caption text-fg-caption">
              {picked ? (picked.dueDate ? `현재 ${formatDueDate(picked.dueDate)}` : "현재 기한 없음") : NO_TASK_CAPTION}
            </span>
          </PayloadField>
          <PayloadField label="상태" fromMeeting={filled("status")}>
            <StatusSelect current={picked?.status ?? null} value={status} onSelect={setStatus} disabled={disabled} />
            <span className="text-caption text-fg-caption">{picked?.status ? `현재 ${STATUS_LABEL[picked.status]}` : NO_TASK_CAPTION}</span>
          </PayloadField>
        </div>

        <PayloadField label="진행 메모" htmlFor="task-payload-note" fromMeeting={filled("note")}>
          <Textarea
            id="task-payload-note"
            value={note}
            disabled={disabled}
            onChange={(event) => setNote(event.target.value)}
            placeholder="업무 메모에 새 항목으로 남습니다"
            className={cn("min-h-[88px] resize-none rounded-control text-control-label", filled("note") && "border-primary")}
          />
        </PayloadField>

        <PayloadField label="할일 추가" fromMeeting={filled("todos") && (prefill?.todos?.length ?? 0) > 0}>
          <TodoDraftList todos={todos} onChange={setTodos} disabled={disabled} />
        </PayloadField>

        <div className="grid grid-cols-2 gap-3">
          <PayloadField label="연관 업무" fromMeeting={filled("relatedTaskIds") && (prefill?.relatedTaskIds?.length ?? 0) > 0}>
            <RelationPopover
              projectId={projectId ?? (meetingProject && !meetingProject.isDeleted ? meetingProject.id : null)}
              hasBaseProject={(projectId ?? meetingProject?.id ?? null) !== null}
              excludeId={picked?.id ?? null}
              selectedIds={relatedTaskIds}
              onChange={(next) => setRelatedTaskIds(next)}
              trigger={
                <button
                  type="button"
                  aria-label="연관 업무"
                  disabled={disabled}
                  className={cn(
                    "flex h-11 w-full items-center justify-between gap-2 rounded-control border border-border bg-card px-3.5 text-control-label text-foreground hover:bg-muted",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <span className="min-w-0 truncate">{relatedTaskIds.length > 0 ? `${relatedTaskIds.length}건 선택됨` : "연관 업무 고르기"}</span>
                  <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
                </button>
              }
            />
          </PayloadField>
          <PayloadField label="프로젝트" fromMeeting={filled("projectId")}>
            <Selector
              label="프로젝트"
              placeholder="변경 없음"
              value={project}
              options={projectOptions}
              clearable
              disabled={disabled}
              onSelect={(next) => setProjectId(next?.id ?? null)}
            />
          </PayloadField>
        </div>

        <PayloadField label="완료 결과" htmlFor="task-payload-completion" fromMeeting={filled("completionResult")}>
          <Textarea
            id="task-payload-completion"
            value={completionResult}
            disabled={disabled}
            onChange={(event) => setCompletionResult(event.target.value)}
            placeholder="채워 두면 업무의 완료 게이트가 열립니다"
            className={cn("min-h-[88px] resize-none rounded-control text-control-label", filled("completionResult") && "border-primary")}
          />
        </PayloadField>
      </div>

      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}

      <DrawerFooter>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex h-11 items-center rounded-control border border-border px-5 text-control-label text-fg-meta hover:bg-muted disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="flex h-11 items-center gap-2 rounded-control bg-primary px-6 text-control-label font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {SUBMIT_LABEL[submitMode]}
        </button>
      </DrawerFooter>
    </div>
  );
}

/** 상태 셀렉터 44px — 「변경 없음」 + **`todo`·`in_progress` 둘**. 「완료」·「취소」가 없다(MF-59). */
function StatusSelect({
  current,
  value,
  onSelect,
  disabled,
}: {
  current: TaskStatus | null;
  value: PayloadStatus | null;
  onSelect: (next: PayloadStatus | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const keepLabel = current ? `${STATUS_LABEL[current]} 유지` : "변경 없음";
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="상태"
          disabled={disabled}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-control border bg-card px-3.5 text-control-label text-foreground",
            open && !disabled ? "border-primary shadow-focus" : "border-border hover:bg-muted",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <span className="min-w-0 truncate">{value ? STATUS_LABEL[value] : keepLabel}</span>
          <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover">
        <ul role="listbox" aria-label="상태">
          {[null, ...PAYLOAD_STATUSES].map((option) => {
            const selected = option === value;
            return (
              <li key={option ?? "keep"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelect(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-meta",
                    selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option ? STATUS_LABEL[option] : keepLabel}</span>
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

/** 업무 줄의 「업무 갱신」(U-6) · 편집 모드의 「+ 연관 업무」 칩(U-7)이 부른다 — 전체 페이지에서만. */
export function openTaskPayloadDrawer(
  overlay: ReturnType<typeof useOverlay>,
  options: {
    agenda: MeetingAgenda | null;
    meetingProject: MeetingRefSummary | null;
    lineContent: string | null;
    /** 줄의 `taskId` 가 가리키는 업무 — 없으면 **빈 셀렉터**로 연다(앞 단계가 따로 없다). */
    initialTask: PickedTask | null;
    prefill: TaskLinePayload | null;
    submitMode: SubmitMode;
    onSubmit: (input: { taskId: number | null; changes: TaskLinePayload; content: string }) => Promise<unknown>;
  },
): void {
  const store = createTaskPickStore(options.initialTask);
  overlay.openDrawer({
    key: "meeting-task-payload",
    title: TASK_PAYLOAD_TITLE,
    renderHeader: ({ fullscreen, onClose }) => (
      <TaskDrawerHeader
        title={TASK_PAYLOAD_TITLE}
        subtitle={TASK_PAYLOAD_SUBTITLE}
        fullscreen={fullscreen}
        onClose={onClose}
        titleSlot={<TaskPickSelector store={store} meetingProject={options.meetingProject} />}
      />
    ),
    content: (
      <TaskPayloadDrawer
        store={store}
        agenda={options.agenda}
        meetingProject={options.meetingProject}
        lineContent={options.lineContent}
        prefill={options.prefill}
        submitMode={options.submitMode}
        onSubmit={async (input) => {
          await options.onSubmit(input);
          overlay.closeDrawer();
        }}
        onCancel={overlay.closeDrawer}
      />
    ),
  });
}

/** 줄의 요약(`line.task`)을 헤더 셀렉터가 물 수 있는 모양으로 — 상태 문자열은 아는 값일 때만 쓴다. */
export function pickedFromLineTask(taskId: number, task: LineTaskSummary): PickedTask {
  return {
    id: taskId,
    title: task.title,
    status: task.status in STATUS_LABEL ? (task.status as TaskStatus) : null,
    dueDate: task.dueDate,
  };
}

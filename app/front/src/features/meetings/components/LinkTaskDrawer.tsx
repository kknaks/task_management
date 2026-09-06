"use client";

/**
 * **추가 드로어 — 연관 업무**(SPEC-008 U-9 · 시안 L2306~2599 · [09] L744~745 · DEC-003 §4 L102). `DrawerFrame` 위 — 폭 · 스크림은 프레임이 정한다.
 *
 * 「내 업무에서 고른 업무에 이 회의의 변경을 반영합니다」. 업무 검색은 **내 업무가 제공**한다(기획 L84 → `GET /api/tasks/relations/candidates`,
 * `features/tasks` 가 내보낸 `fetchRelationCandidates`) — 이 드로어가 업무 API 를 직접 쓰는 곳은 **그 후보 검색 하나**뿐이다.
 *
 * - 업무 선택: **프로젝트 셀렉터** 「<프로젝트명> · n건」(기본값 = 회의의 프로젝트 · 무소속이면 「전체」) + 검색 입력(h34 「업무 검색」) +
 *   목록 행(라디오 · 제목 14/600 · 기한 `MM.DD`/「미정」 · 상태 「시작전/진행중/완료/취소」). **단일 선택.** 결과 없음 두 줄 · `total > 20` 이면 「n건 중 20건 · 검색어로 좁혀 주세요」
 * - 이 회의로 반영할 변경(캡션 「고른 항목만 갱신됩니다」): **기한**(기본값 없음 = 변경 없음 · 캡션 「현재 MM.DD」/「현재 기한 없음」) ·
 *   **상태**(기본값 「<현재 상태> 유지」 · 항목은 전이 그래프에서 갈 수 있는 것만 — `canTransition` · **「취소」 없음**) · **진행 메모로 남길 내용**(선택 → 업무 메모 새 항목)
 * - CTA 「취소」 · 「**연결하고 갱신**」 — 제출 가능 = 업무 하나 선택됨. ① `POST …/lines { taskId, pendingChange? }` 로 그 안건 맨 아래 업무 줄 →
 *   드로어 닫힘 → ② 변경이 있으면 소유자가 **U-6 「업무 갱신」과 같은 요청**을 낸다(`onLinked(line, hasChange)`). 변경을 하나도 안 골랐으면 ②는 나가지 않는다.
 *   **같은 상태 유지는 요청에 실리지 않는다**(SPEC-004 L478). ①과 ②는 다른 요청이라 ②가 실패해도 줄은 있다
 *
 * 드로어는 부모를 모른다 — 콜백만 받는다. 실패는 드로어 열린 채 인라인(+ 상태 가드는 토스트).
 */

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { EmptyState } from "@/components/shared/EmptyState";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { STATUS_LABEL, type TaskStatus } from "@/components/shared/StatusDot";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { canTransition, fetchRelationCandidates, type TaskRelation } from "@/features/tasks";
import { isMeetingNotFound, isValidationError, meetingInlineError } from "@/features/meetings/errors";
import type { AddLineInput, MeetingLine, MeetingRefSummary, PendingChange } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { formatDueDate, type DateKey } from "@/lib/datetime";
import { useProjectsQuery } from "@/lib/hooks/useWorkSettings";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

import { TaskDateField } from "@/features/meetings/components/TaskDateField";

export const LINK_TASK_TITLE = "연관 업무 연결";
export const LINK_TASK_SUBTITLE = "내 업무에서 고른 업무에 이 회의의 변경을 반영합니다";
export const LINK_TASK_CTA = "연결하고 갱신";
export const TASK_GONE_INLINE = "삭제된 업무입니다 · 다시 골라 주세요";
/** 후보 상한 — 서버가 상위 20건만 준다(SPEC-003 §4). */
const CANDIDATE_LIMIT = 20;
/** `pendingChange.status` 가 담을 수 있는 셋 — 「취소」는 사유가 필수라 여기 없다(DEC-003 §4 L102). */
const PENDING_STATUSES: readonly PendingStatus[] = ["todo", "in_progress", "done"];
type PendingStatus = NonNullable<PendingChange["status"]>;

/** 드로어 헤더 한 벌 — 제목 18/700 + 부제 12 + ×(전체 화면이면 `←`). U-10 드로어도 같은 것을 쓴다. */
export function TaskDrawerHeader({
  title,
  subtitle,
  fullscreen,
  onClose,
}: {
  title: string;
  subtitle: string;
  fullscreen: boolean;
  onClose: () => void;
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
          <h2 className="truncate text-drawer-title text-foreground">{title}</h2>
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

function isTaskStatus(value: string): value is TaskStatus {
  return value in STATUS_LABEL;
}

export function LinkTaskDrawer({
  meetingProject,
  agendaId,
  onAdd,
  onCancel,
  onLinked,
}: {
  /** 회의의 프로젝트 — 프로젝트 셀렉터 기본값. 무소속이면 「전체」. */
  meetingProject: MeetingRefSummary | null;
  agendaId: number;
  /** ① 줄 추가 — 거절은 throw(인라인). */
  onAdd: (input: AddLineInput) => Promise<MeetingLine>;
  onCancel: () => void;
  /** ① 성공 — 드로어를 닫고, 변경이 있으면 ② 「업무 갱신」 요청을 낸다. */
  onLinked: (line: MeetingLine, hasChange: boolean) => void;
}) {
  const client = useQueryClient();
  const { data: projects = [] } = useProjectsQuery();
  const [projectId, setProjectId] = useState<number | null>(meetingProject && !meetingProject.isDeleted ? meetingProject.id : null);
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<TaskRelation | null>(null);
  const [dueDate, setDueDate] = useState<DateKey | null>(null);
  const [status, setStatus] = useState<PendingStatus | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const scope = projectId !== null ? "project" : "all";
  const candidates = useQuery({
    queryKey: queryKeys.relationCandidates({ excludeId: null, projectId, dueDate: null, keyword, scope }),
    queryFn: () => fetchRelationCandidates({ keyword, projectId, scope }),
    staleTime: 0,
  });
  const items = candidates.data?.items ?? [];
  const total = candidates.data?.total ?? 0;

  const projectOptions: SelectorOption[] = projects.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }));
  const projectValue = projectOptions.find((item) => item.id === projectId) ?? null;
  const projectLabel = projectValue?.name ?? (projectId !== null && meetingProject ? meetingProject.name : "전체");

  const current: TaskStatus | null = picked && isTaskStatus(picked.status) ? picked.status : null;
  // 현재 상태에서 **갈 수 있는 것만**(SPEC-004 전이 그래프 — 화면은 미리 알려 줄 뿐 판정은 서버). 같은 상태는 항목이 아니라 「유지」다
  const statusOptions = current ? PENDING_STATUSES.filter((next) => next !== current && canTransition(current, next)) : [];

  const pendingChange: PendingChange = {};
  if (dueDate) {
    pendingChange.dueDate = dueDate;
  }
  if (status && status !== current) {
    pendingChange.status = status;
  }
  if (note.trim().length > 0) {
    pendingChange.note = note.trim();
  }
  const hasChange = Object.keys(pendingChange).length > 0;
  const canSubmit = picked !== null && !submitting;

  const pick = (candidate: TaskRelation) => {
    setPicked(candidate);
    setStatus(null);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit || !picked) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const line = await onAdd({ agendaId, kind: "task", taskId: picked.id, ...(hasChange ? { pendingChange } : {}) });
      onLinked(line, hasChange);
    } catch (caught) {
      // **드로어는 열린 채** — 상태 가드는 토스트, 그 밖은 인라인 + 「연결하고 갱신」이 곧 「다시 시도」(Case Matrix)
      const inline = meetingInlineError(caught);
      if (inline?.toast) {
        toast.error(inline.message);
      }
      if (isMeetingNotFound(caught)) {
        setError(TASK_GONE_INLINE);
        setPicked(null);
        void client.invalidateQueries({ queryKey: queryKeys.tasks() });
      } else {
        setError(inline?.message ?? (isValidationError(caught) ? "입력값을 확인해 주세요" : "연결하지 못했습니다 · 다시 시도해 주세요"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-[22px]">
      {/* ── 업무 선택 ─────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-meta font-semibold text-foreground">업무 선택</span>
          <span className="text-caption text-fg-caption">내 업무에서 불러옵니다</span>
        </div>
        <Selector
          label="프로젝트"
          placeholder="전체"
          value={projectValue}
          options={projectOptions}
          clearable
          onSelect={(option) => {
            setProjectId(option?.id ?? null);
            setPicked(null);
          }}
          renderTrigger={({ open }) => (
            <button
              type="button"
              aria-label="프로젝트"
              className={cn(
                "flex h-[42px] w-full items-center justify-between gap-2 rounded-control border bg-card px-3.5 text-control-label text-foreground",
                open ? "border-primary shadow-focus" : "border-border hover:bg-muted",
              )}
            >
              <span className="min-w-0 truncate">
                {projectLabel} · {total}건
              </span>
              <ChevronDown className="h-[7px] w-[11px] shrink-0 text-fg-meta" strokeWidth={1.6} aria-hidden />
            </button>
          )}
        />
        <Input
          ref={searchRef}
          aria-label="업무 검색"
          placeholder="업무 검색"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="h-[34px] text-meta"
        />
        <div role="radiogroup" aria-label="업무 목록" className="flex max-h-[300px] flex-col overflow-y-auto rounded-card border border-border">
          {candidates.isPending ? (
            <p className="py-6 text-center text-meta text-fg-caption">불러오는 중…</p>
          ) : candidates.isError ? (
            <EmptyState
              message="업무를 불러오지 못했습니다"
              action={
                <button type="button" onClick={() => void candidates.refetch()} className="flex h-8 items-center rounded-control border border-border px-3 text-meta text-fg-meta hover:bg-muted">
                  다시 시도
                </button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState message="검색 결과가 없습니다" hint="다른 검색어나 프로젝트를 골라 보세요" />
          ) : (
            items.map((candidate) => {
              const selected = picked?.id === candidate.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => pick(candidate)}
                  className={cn(
                    "flex h-[58px] w-full shrink-0 items-center gap-3 border-b border-row-divider px-4 text-left last:border-b-0",
                    selected ? "border-primary bg-row-selected" : "hover:bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary" : "border-border")}
                  >
                    {selected ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-control-label font-semibold text-foreground">{candidate.title}</span>
                  <span className="w-16 shrink-0 text-caption tabular-nums text-fg-meta">{candidate.dueDate ? formatDueDate(candidate.dueDate) : "미정"}</span>
                  <span className="w-14 shrink-0 text-right text-caption text-fg-caption">{isTaskStatus(candidate.status) ? STATUS_LABEL[candidate.status] : candidate.status}</span>
                </button>
              );
            })
          )}
        </div>
        {total > CANDIDATE_LIMIT ? (
          <span className="text-caption text-fg-caption">
            {total}건 중 {CANDIDATE_LIMIT}건 · 검색어로 좁혀 주세요
          </span>
        ) : null}
      </div>

      {/* ── 이 회의로 반영할 변경 ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-meta font-semibold text-foreground">이 회의로 반영할 변경</span>
          <span className="text-caption text-fg-caption">고른 항목만 갱신됩니다</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-due`} className="text-caption font-semibold text-foreground">
              기한
            </label>
            <TaskDateField value={dueDate} onChange={setDueDate} placeholder="변경 없음" ariaLabel="기한" disabled={picked === null} />
            <span className="text-caption text-fg-caption">{picked ? (picked.dueDate ? `현재 ${formatDueDate(picked.dueDate)}` : "현재 기한 없음") : "업무를 먼저 고르세요"}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold text-foreground">상태</span>
            <StatusSelect current={current} value={status} options={statusOptions} onSelect={setStatus} disabled={picked === null} />
            <span className="text-caption text-fg-caption">{current ? `현재 ${STATUS_LABEL[current]}` : "업무를 먼저 고르세요"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-note`} className="text-caption font-semibold text-foreground">
            진행 메모로 남길 내용
          </label>
          <Textarea
            id={`${ids}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="업무 메모에 새 항목으로 남습니다"
            className="min-h-[88px] resize-none rounded-control text-control-label"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
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
          {LINK_TASK_CTA}
        </button>
      </DrawerFooter>
    </div>
  );
}

/** 상태 셀렉터 44px — 「<현재> 유지」 + 전이 그래프에서 갈 수 있는 것. **「취소」 없음.** */
function StatusSelect({
  current,
  value,
  options,
  onSelect,
  disabled,
}: {
  current: TaskStatus | null;
  value: PendingStatus | null;
  options: readonly PendingStatus[];
  onSelect: (next: PendingStatus | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const keepLabel = current ? `${STATUS_LABEL[current]} 유지` : "유지";
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
          {[null, ...options].map((option) => {
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
                  className={cn("flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-meta", selected ? "bg-pick font-bold text-pick-foreground" : "text-foreground hover:bg-muted")}
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

/** 편집 모드의 「+ 연관 업무」 칩이 부른다 — 전체 페이지에서만. `openMeetingDrawers` 가 다시 내보낸다(순환 방지). */
export function openLinkTaskDrawer(
  overlay: ReturnType<typeof useOverlay>,
  options: {
    meetingProject: MeetingRefSummary | null;
    agendaId: number;
    onAdd: (input: AddLineInput) => Promise<MeetingLine>;
    onLinked: (line: MeetingLine, hasChange: boolean) => void;
  },
): void {
  overlay.openDrawer({
    key: "meeting-link-task",
    title: LINK_TASK_TITLE,
    renderHeader: ({ fullscreen, onClose }) => <TaskDrawerHeader title={LINK_TASK_TITLE} subtitle={LINK_TASK_SUBTITLE} fullscreen={fullscreen} onClose={onClose} />,
    content: (
      <LinkTaskDrawer
        meetingProject={options.meetingProject}
        agendaId={options.agendaId}
        onAdd={options.onAdd}
        onCancel={overlay.closeDrawer}
        onLinked={(line, hasChange) => {
          overlay.closeDrawer();
          options.onLinked(line, hasChange);
        }}
      />
    ),
  });
}

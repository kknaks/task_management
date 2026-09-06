"use client";

/**
 * **추가 드로어 — 액션 아이템 = 업무 생성**(SPEC-008 U-10 · 시안 L2600~2882 · [09] L748~749 · BASE-003 #10). `DrawerFrame` 위.
 *
 * 두 진입점이 **같은 드로어**를 연다 — 액션 줄의 「업무 생성」(U-6 · `line` 있음) · 안건의 「+ 액션 아이템」(U-7 · `line` 없음).
 * 업무 생성 규칙은 **SPEC-003 U-1 · §4 그대로**(제목 1자 + 유형 필수 → 「시작전」 + 로그 「업무 생성」).
 *
 * 필드 순서 — ① 안건(액션 줄에서 열었으면 **고정**, 칩이면 기본값 = 그 안건) ② 업무 제목(액션 줄 본문 **프리필**, 고칠 수 있다)
 * ③ 유형(필수 · 종류=업무) · 프로젝트(선택 · 기본값 = 회의의 프로젝트) 2열 ④ 기한(계획 종료) ⑤ 메모 → 업무의 **`description`**
 * (캡션 「업무의 설명에 들어갑니다」).
 *
 * **없는 것**(§7 제외): 「시작 상태」 셀렉터(L2850~2851 — 생성 시 항상 「시작전」 · DEC-002 §5) · 「회의록 줄을 연관 업무로 바꾸기」 토글
 * (L2863~2866 — 만들면 **항상** 그 줄이 업무 줄이 된다 · ERD M-14).
 *
 * 요청 — 액션 줄: `POST …/lines/{id}/task`(그 줄이 업무 줄로 바뀐다) · 칩: `POST …/lines { newTask }`(안건 맨 아래 업무 줄). 둘 다 업무 + 줄
 * **한 요청 · 한 트랜잭션**이다. 실패는 드로어 열린 채 — 유형 · 프로젝트 오류는 그 셀렉터 옆 인라인 + 목록 갱신(SPEC-003 Case Matrix).
 */

import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgendaSelect } from "@/features/meetings/components/AddLineDrawer";
import { TaskDrawerHeader } from "@/features/meetings/components/LinkTaskDrawer";
import { TaskDateField } from "@/features/meetings/components/TaskDateField";
import { isValidationError, meetingInlineError, validationFieldOf } from "@/features/meetings/errors";
import type { AddLineInput, MeetingAgenda, MeetingLine, MeetingRefSummary, NewTaskInput } from "@/features/meetings/types";
import { API_ERROR_CODE, inlineErrorMessage, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";
import type { DateKey } from "@/lib/datetime";
import { useProjectMutations, useProjectsQuery, useWorkTypesQuery } from "@/lib/hooks/useWorkSettings";
import { isEnterSubmit } from "@/lib/keyboard";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export const CREATE_TASK_TITLE = "업무 생성";
export const CREATE_TASK_SUBTITLE = "액션 아이템을 내 업무로 등록합니다";
export const MEMO_CAPTION = "업무의 설명에 들어갑니다";
export const INVALID_WORK_TYPE_MESSAGE = "삭제됐거나 쓸 수 없는 유형입니다. 다시 골라 주세요";
export const INVALID_PROJECT_MESSAGE = "삭제된 프로젝트입니다. 다시 골라 주세요";

type Field = "agenda" | "title" | "workType" | "project" | "due" | "memo" | "form";

/** 서버가 짚은 요청 필드 → 드로어 칸. 모르면 폼 전체(W-3 — 엉뚱한 칸을 짚지 않는다). */
function fieldOf(raw: string | null): Field {
  switch (raw) {
    case "agendaId":
      return "agenda";
    case "title":
      return "title";
    case "workTypeId":
      return "workType";
    case "projectId":
      return "project";
    case "dueDate":
      return "due";
    case "description":
      return "memo";
    default:
      return "form";
  }
}

export function CreateTaskFromLineDrawer({
  agendas,
  initialAgendaId,
  line = null,
  meetingProject,
  onCreateFromLine,
  onAddNewTask,
  onCancel,
  onCreated,
}: {
  /** 편집 대상 트랙의 안건 전량 — 칩 진입의 셀렉터 목록. */
  agendas: readonly MeetingAgenda[];
  initialAgendaId: number;
  /** 액션 줄에서 열었으면 그 줄 — 제목 프리필 · 안건 고정 · `POST …/lines/{id}/task`. */
  line?: MeetingLine | null;
  meetingProject: MeetingRefSummary | null;
  onCreateFromLine: (line: MeetingLine, input: NewTaskInput) => Promise<unknown>;
  onAddNewTask: (input: AddLineInput) => Promise<unknown>;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const client = useQueryClient();
  const { data: workTypes = [] } = useWorkTypesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const projectMutations = useProjectMutations();
  const ids = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  const [agendaId, setAgendaId] = useState(line?.agendaId ?? initialAgendaId);
  const [title, setTitle] = useState(line?.content ?? "");
  const [workType, setWorkType] = useState<SelectorOption | null>(null);
  const [project, setProject] = useState<SelectorOption | null>(
    meetingProject && !meetingProject.isDeleted ? { id: meetingProject.id, name: meetingProject.name, colorToken: meetingProject.colorToken } : null,
  );
  const [dueDate, setDueDate] = useState<DateKey | null>(null);
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const sorted = [...agendas].sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
  const agenda = sorted.find((item) => item.id === agendaId) ?? sorted[0] ?? null;
  // 유형은 **종류=업무**만(SPEC-002 목록). 회의 유형으로 업무를 만들 수 없다
  const taskTypeOptions: SelectorOption[] = workTypes.filter((item) => item.kind === "task").map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }));
  const projectOptions: SelectorOption[] = projects.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }));

  // **제목 1자 이상 + 유형 선택됨**(SPEC-003 U-1). 아니면 「업무 생성」 비활성
  const canSubmit = !submitting && title.trim().length > 0 && workType !== null && (line !== null || agenda !== null);

  const submit = async () => {
    if (!canSubmit || workType === null) {
      return;
    }
    const input: NewTaskInput = {
      title: title.trim(),
      workTypeId: workType.id,
      projectId: project?.id ?? null,
      dueDate,
      description: memo.trim().length > 0 ? memo.trim() : null,
    };
    setSubmitting(true);
    setError(null);
    try {
      if (line) {
        await onCreateFromLine(line, input);
      } else if (agenda) {
        await onAddNewTask({ agendaId: agenda.id, kind: "task", newTask: input });
      }
      onCreated();
    } catch (caught) {
      // **드로어는 열린 채** — 유형 · 프로젝트 오류는 그 셀렉터 옆 인라인 + 목록 갱신(SPEC-003 Case Matrix). 422 는 그 필드. 그 밖은 문구 + 「업무 생성」이 곧 「다시 시도」
      if (isApiError(caught) && caught.code === API_ERROR_CODE.INVALID_WORK_TYPE) {
        setError({ field: "workType", message: INVALID_WORK_TYPE_MESSAGE });
        void client.invalidateQueries({ queryKey: queryKeys.workTypes() });
      } else if (isApiError(caught) && caught.code === API_ERROR_CODE.INVALID_PROJECT) {
        setError({ field: "project", message: INVALID_PROJECT_MESSAGE });
        void client.invalidateQueries({ queryKey: queryKeys.projects() });
      } else {
        const inline = meetingInlineError(caught);
        if (inline?.toast) {
          toast.error(inline.message);
        }
        setError({
          field: isValidationError(caught) ? fieldOf(validationFieldOf(caught)) : "form",
          message: inline?.message ?? "업무를 만들지 못했습니다 · 다시 시도해 주세요",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const message = (field: Field) =>
    error?.field === field ? (
      <p role="alert" className="text-caption text-destructive">
        {error.message}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-[22px]">
      {/* ① 안건 — 액션 줄에서 열었으면 고정 */}
      <div className="flex flex-col gap-2">
        <span className="text-meta font-semibold text-foreground">안건</span>
        <AgendaSelect listboxId={`${ids}-agenda`} agendas={sorted} value={agenda} onSelect={(next) => setAgendaId(next.id)} invalid={error?.field === "agenda"} disabled={line !== null} />
        {message("agenda")}
      </div>

      {/* ② 업무 제목 — 액션 줄 본문 프리필 */}
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-title`} className="text-meta font-semibold text-foreground">
          업무 제목
        </label>
        <Input
          id={`${ids}-title`}
          ref={titleRef}
          value={title}
          placeholder="업무 제목"
          aria-invalid={error?.field === "title"}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (isEnterSubmit(event)) {
              event.preventDefault();
              void submit();
            }
          }}
          className={cn("h-11 text-body", error?.field === "title" && "border-destructive")}
        />
        {message("title")}
      </div>

      {/* ③ 유형(필수) · 프로젝트(선택) 2열 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-foreground">유형</span>
          <Selector label="유형" placeholder="유형 (필수)" value={workType} options={taskTypeOptions} onSelect={(next) => { setWorkType(next); setError(null); }} saveFailed={error?.field === "workType"} />
          {message("workType")}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-foreground">프로젝트</span>
          <Selector
            label="프로젝트"
            placeholder="프로젝트 (선택)"
            value={project}
            options={projectOptions}
            clearable
            onSelect={(next) => {
              setProject(next);
              setError(null);
            }}
            saveFailed={error?.field === "project"}
            creating={projectMutations.create.isPending}
            onCreate={async (input) => {
              const created = await projectMutations.create.mutateAsync(input);
              return { id: created.id, name: created.name, colorToken: created.colorToken };
            }}
            createErrorMessage={(caught) => inlineErrorMessage(caught, "project")}
          />
          {message("project")}
        </div>
      </div>

      {/* ④ 기한 — 계획 종료. 「시작 상태」 칸은 **없다**(생성 시 항상 「시작전」) */}
      <div className="flex flex-col gap-2">
        <span className="text-meta font-semibold text-foreground">기한</span>
        <TaskDateField value={dueDate} onChange={(next) => { setDueDate(next); setError(null); }} placeholder="미정" ariaLabel="기한" invalid={error?.field === "due"} />
        {message("due")}
      </div>

      {/* ⑤ 메모 → `description` */}
      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-memo`} className="text-meta font-semibold text-foreground">
          메모
        </label>
        <Textarea
          id={`${ids}-memo`}
          value={memo}
          aria-invalid={error?.field === "memo"}
          onChange={(event) => {
            setMemo(event.target.value);
            setError(null);
          }}
          className={cn("min-h-[88px] resize-none rounded-control text-control-label", error?.field === "memo" && "border-destructive")}
        />
        <span className="text-caption text-fg-caption">{MEMO_CAPTION}</span>
        {message("memo")}
      </div>

      {message("form")}

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
          {CREATE_TASK_TITLE}
        </button>
      </DrawerFooter>
    </div>
  );
}

/** 액션 줄의 「업무 생성」(U-6) · 편집 모드의 「+ 액션 아이템」 칩이 부른다 — 전체 페이지에서만. `openMeetingDrawers` 가 다시 내보낸다. */
export function openCreateTaskFromLineDrawer(
  overlay: ReturnType<typeof useOverlay>,
  options: {
    agendas: readonly MeetingAgenda[];
    agendaId: number;
    line?: MeetingLine | null;
    meetingProject: MeetingRefSummary | null;
    onCreateFromLine: (line: MeetingLine, input: NewTaskInput) => Promise<unknown>;
    onAddNewTask: (input: AddLineInput) => Promise<unknown>;
  },
): void {
  overlay.openDrawer({
    key: "meeting-create-task",
    title: CREATE_TASK_TITLE,
    renderHeader: ({ fullscreen, onClose }) => <TaskDrawerHeader title={CREATE_TASK_TITLE} subtitle={CREATE_TASK_SUBTITLE} fullscreen={fullscreen} onClose={onClose} />,
    content: (
      <CreateTaskFromLineDrawer
        agendas={options.agendas}
        initialAgendaId={options.agendaId}
        line={options.line ?? null}
        meetingProject={options.meetingProject}
        onCreateFromLine={options.onCreateFromLine}
        onAddNewTask={options.onAddNewTask}
        onCancel={overlay.closeDrawer}
        onCreated={overlay.closeDrawer}
      />
    ),
  });
}

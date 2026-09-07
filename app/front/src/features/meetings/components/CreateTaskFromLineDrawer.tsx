"use client";

/**
 * **액션 payload 드로어**(SPEC-008 U-10 · MF-13 · 61 · 64 정정 · 65 · 66 · 67). `DrawerFrame` 위.
 *
 * **회의록 것이다**(MF-67) — 업무 탭의 새 업무 드로어를 열지 않고 그 드로어에 슬롯·prop 을 얹지도 않는다.
 * 시각 규격의 참조는 이미 만들어진 `TaskCreateDrawer`(SPEC-003 U-1)이고 **그 파일은 고치지 않는다**(정적 검사).
 *
 * ## 드로어는 하나다(MF-65)
 *
 * AI 가 만든 줄이든 사람이 적은 줄이든 **같은 드로어 · 같은 필드 · 같은 저장 경로**다. 다른 것은 **`prefill` 이 차 있나 비어 있나**뿐 —
 * `line.track` · 「AI 줄인가」를 보는 코드가 없다. 채워진 필드에는 테두리 `#7181F8` + 캡션 「회의에서 반영」이 붙고 사람이 고칠 수 있다.
 *
 * ## 필드는 `payload` 키 그대로 일곱
 *
 * ① 안건(맨 위 · **읽기 전용**) ② 제목 ③ 유형 · 프로젝트 ④ 계획 시작 ~ 종료 ⑤ 설명 ⑥ 할일.
 * **없는 것** — 「시작 상태」(만들면 항상 「시작전」) · 참고자료 · 연관 업무 · 결과자료 · 첨부 · 로그(`payload` 키가 아니다).
 *
 * ## 푸터는 모드별 하나씩(MF-66 · 한 푸터에 셋을 두지 않는다)
 *
 * | `submitMode` | 버튼 | 뜻 | 조건 |
 * |---|---|---|---|
 * | `save`(편집 모드 · 칩 진입) | 「취소 · **저장**」 | `payload` 만 줄에 붙는다 — **업무는 아직 없다** | 제목 1자 |
 * | `insert`(보기 모드) | 「취소 · **넣기**」 | 업무를 만든다(`POST …/lines/{id}/task`) | 제목 1자 + **유형** |
 *
 * **인라인 자동 저장이 없다** — 포커스를 벗어나도 요청이 나가지 않는다. 「취소」·×·`Esc`·스크림은 아무것도 저장하지 않고,
 * 칩으로 열었으면 **줄이 안 생긴다**(MF-64 정정).
 */

import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TaskDrawerHeader } from "@/features/meetings/components/LinkTaskDrawer";
import { PayloadField, SUBMIT_LABEL, TodoDraftList, type SubmitMode } from "@/features/meetings/components/PayloadDrawerParts";
import { TaskDateField } from "@/features/meetings/components/TaskDateField";
import { isValidationError, meetingInlineError, validationFieldOf } from "@/features/meetings/errors";
import type { ActionLinePayload, MeetingAgenda, MeetingRefSummary } from "@/features/meetings/types";
import { API_ERROR_CODE, inlineErrorMessage, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/queryKeys";
import type { DateKey } from "@/lib/datetime";
import { useProjectMutations, useProjectsQuery, useWorkTypesQuery } from "@/lib/hooks/useWorkSettings";
import { isEnterSubmit } from "@/lib/keyboard";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export const ACTION_PAYLOAD_TITLE = "액션 아이템";
export const ACTION_PAYLOAD_SUBTITLE = "이 줄로 만들 업무의 값을 적습니다";
export const INVALID_WORK_TYPE_MESSAGE = "삭제됐거나 쓸 수 없는 유형입니다. 다시 골라 주세요";
export const INVALID_PROJECT_MESSAGE = "삭제된 프로젝트입니다. 다시 골라 주세요";

type Field = "title" | "workType" | "project" | "startDate" | "dueDate" | "description" | "todos" | "form";

/** 서버가 짚은 요청 필드 → 드로어 칸. 모르면 폼 전체 — 엉뚱한 칸을 짚지 않는다. */
function fieldOf(raw: string | null): Field {
  switch (raw) {
    case "title":
      return "title";
    case "workTypeId":
      return "workType";
    case "projectId":
      return "project";
    case "startDate":
      return "startDate";
    case "dueDate":
      return "dueDate";
    case "description":
      return "description";
    case "todos":
      return "todos";
    default:
      return "form";
  }
}

export function ActionPayloadDrawer({
  agenda,
  meetingProject,
  lineContent,
  prefill,
  submitMode,
  onSubmit,
  onCancel,
}: {
  /** 맨 위에 **고정**으로 보이는 안건 — 줄에서 열었으면 그 줄의 안건, 칩이면 칩을 누른 안건(U-10 ①). */
  agenda: MeetingAgenda;
  /** `payload` 에 프로젝트가 없을 때의 기본값(MF-61). */
  meetingProject: MeetingRefSummary | null;
  /** 줄에서 열었으면 그 본문 — 제목의 출발값. 칩 진입이면 `null`(빈 값). */
  lineContent: string | null;
  /** 줄의 `payload`. **이것이 차 있나 비어 있나가 유일한 갈래다**(MF-65). */
  prefill: ActionLinePayload | null;
  submitMode: SubmitMode;
  /** 「저장」/「넣기」 — 어떤 요청인지는 **호출자가** 정한다. 거절은 던진다(드로어가 인라인으로 받는다). */
  onSubmit: (payload: ActionLinePayload) => Promise<unknown>;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const { data: workTypes = [] } = useWorkTypesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const projectMutations = useProjectMutations();
  const ids = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(prefill?.title ?? lineContent ?? "");
  const [workTypeId, setWorkTypeId] = useState<number | null>(prefill?.workTypeId ?? null);
  const [projectId, setProjectId] = useState<number | null>(
    prefill ? (prefill.projectId ?? null) : (meetingProject && !meetingProject.isDeleted ? meetingProject.id : null),
  );
  const [startDate, setStartDate] = useState<DateKey | null>((prefill?.startDate ?? null) as DateKey | null);
  const [dueDate, setDueDate] = useState<DateKey | null>((prefill?.dueDate ?? null) as DateKey | null);
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [todos, setTodos] = useState<string[]>(prefill?.todos ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // 유형은 **종류=업무**만(SPEC-002 목록). 회의 유형으로 업무를 만들 수 없다
  const taskTypeOptions: SelectorOption[] = workTypes
    .filter((item) => item.kind === "task")
    .map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }));
  const projectOptions: SelectorOption[] = projects.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }));
  const workType = taskTypeOptions.find((item) => item.id === workTypeId) ?? null;
  const project = projectOptions.find((item) => item.id === projectId) ?? null;

  /** 「회의에서 반영」 — `payload` 가 채운 칸만. 사람이 고치면 그대로 두고 표시만 남긴다(값의 출처를 말하는 표시다). */
  const filled = (key: keyof ActionLinePayload) => prefill !== null && prefill[key] !== null && prefill[key] !== undefined;

  // **「저장」은 제목만 · 「넣기」는 제목 + 유형**(U-10 푸터 조건 · `payload.workTypeId=null` 이어도 저장은 된다)
  const canSubmit = !submitting && title.trim().length > 0 && (submitMode === "save" || workTypeId !== null);

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        workTypeId,
        projectId,
        startDate,
        dueDate,
        description: description.trim().length > 0 ? description.trim() : null,
        todos,
      });
    } catch (caught) {
      // **드로어는 열린 채** — 유형 · 프로젝트 오류는 그 셀렉터 옆 인라인 + 목록 갱신(SPEC-003 Case Matrix)
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
          message: inline?.message ?? "저장하지 못했습니다 · 다시 시도해 주세요",
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
      {/* ① 안건 — 맨 위 고정 · 읽기 전용(U-10) */}
      <PayloadField label="안건">
        <p data-agenda-fixed className="flex h-11 items-center rounded-control border border-border bg-muted px-3.5 text-control-label text-fg-meta">
          안건 {agenda.orderIndex + 1} · {agenda.title}
        </p>
      </PayloadField>

      {/* ② 제목 — 「저장」이면 이 값이 줄 본문이 된다(칩 진입) */}
      <PayloadField label="제목" htmlFor={`${ids}-title`} fromMeeting={filled("title")}>
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
          className={cn("h-11 text-body", filled("title") && "border-primary", error?.field === "title" && "border-destructive")}
        />
        {message("title")}
      </PayloadField>

      {/* ③ 유형 · 프로젝트 */}
      <div className="grid grid-cols-2 gap-3">
        <PayloadField label="유형" fromMeeting={filled("workTypeId")}>
          <Selector
            label="유형"
            placeholder={submitMode === "insert" ? "유형 (필수)" : "유형"}
            value={workType}
            options={taskTypeOptions}
            clearable
            onSelect={(next) => {
              setWorkTypeId(next?.id ?? null);
              setError(null);
            }}
            saveFailed={error?.field === "workType"}
          />
          {message("workType")}
        </PayloadField>
        <PayloadField label="프로젝트" fromMeeting={filled("projectId")}>
          <Selector
            label="프로젝트"
            placeholder="프로젝트 (선택)"
            value={project}
            options={projectOptions}
            clearable
            onSelect={(next) => {
              setProjectId(next?.id ?? null);
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
        </PayloadField>
      </div>

      {/* ④ 계획 시작 ~ 종료 — 시작일이 비던 자리를 둘로 둔다(U-10) */}
      <div className="grid grid-cols-2 gap-3">
        <PayloadField label="계획 시작" fromMeeting={filled("startDate")}>
          <TaskDateField
            value={startDate}
            onChange={(next) => {
              setStartDate(next);
              setError(null);
            }}
            placeholder="미정"
            ariaLabel="계획 시작"
            invalid={error?.field === "startDate"}
          />
          {message("startDate")}
        </PayloadField>
        <PayloadField label="계획 종료" fromMeeting={filled("dueDate")}>
          <TaskDateField
            value={dueDate}
            onChange={(next) => {
              setDueDate(next);
              setError(null);
            }}
            placeholder="미정"
            ariaLabel="계획 종료"
            invalid={error?.field === "dueDate"}
          />
          {message("dueDate")}
        </PayloadField>
      </div>

      {/* ⑤ 설명 */}
      <PayloadField label="설명" htmlFor={`${ids}-description`} fromMeeting={filled("description")}>
        <Textarea
          id={`${ids}-description`}
          value={description}
          aria-invalid={error?.field === "description"}
          onChange={(event) => {
            setDescription(event.target.value);
            setError(null);
          }}
          className={cn(
            "min-h-[88px] resize-none rounded-control text-control-label",
            filled("description") && "border-primary",
            error?.field === "description" && "border-destructive",
          )}
        />
        {message("description")}
      </PayloadField>

      {/* ⑥ 할일 */}
      <PayloadField label="할일" fromMeeting={filled("todos") && (prefill?.todos?.length ?? 0) > 0}>
        <TodoDraftList todos={todos} onChange={setTodos} />
        {message("todos")}
      </PayloadField>

      {message("form")}

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

/** 액션 줄의 「업무 생성」(U-6) · 편집 모드의 「+ 액션 아이템」 칩(U-7)이 부른다 — 전체 페이지에서만. */
export function openActionPayloadDrawer(
  overlay: ReturnType<typeof useOverlay>,
  options: {
    agenda: MeetingAgenda;
    meetingProject: MeetingRefSummary | null;
    lineContent: string | null;
    prefill: ActionLinePayload | null;
    submitMode: SubmitMode;
    onSubmit: (payload: ActionLinePayload) => Promise<unknown>;
  },
): void {
  overlay.openDrawer({
    key: "meeting-action-payload",
    title: ACTION_PAYLOAD_TITLE,
    renderHeader: ({ fullscreen, onClose }) => (
      <TaskDrawerHeader title={ACTION_PAYLOAD_TITLE} subtitle={ACTION_PAYLOAD_SUBTITLE} fullscreen={fullscreen} onClose={onClose} />
    ),
    content: (
      <ActionPayloadDrawer
        agenda={options.agenda}
        meetingProject={options.meetingProject}
        lineContent={options.lineContent}
        prefill={options.prefill}
        submitMode={options.submitMode}
        onSubmit={async (payload) => {
          await options.onSubmit(payload);
          overlay.closeDrawer();
        }}
        onCancel={overlay.closeDrawer}
      />
    ),
  });
}

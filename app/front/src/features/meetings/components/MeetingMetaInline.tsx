"use client";

/**
 * **제목 · 일시 · 유형 · 프로젝트 인라인 컨트롤 — 페이지 · 드로어 공용**(SPEC-008 U-3 · U-4 · SPEC-006 §4 `PATCH` · DEC-005 §5).
 *
 * 두 표면이 **같은 컨트롤**이다 — 다른 규격을 갖지 않는다(SPEC-003 U-4 의 결). 쓰기 표면은 WORK-006 의 `updateMeeting`(`PATCH /api/meetings/{id}`)
 * 하나이고 이 파일은 그것을 **부른다**. 일시는 **항상 둘을 함께**(`startAt`·`endAt`).
 *
 * - **낙관적이지 않다**(§5 표) — 일시 · 유형 · 프로젝트는 겹침 · 삭제된 항목이 거부할 수 있다. 그래서 **원복은 저절로 된다**: 값이 애초에 안 바뀐다
 * - `schedule_overlap` → 토스트 「그 시간에 다른 일정이 있습니다」 + 일시 실패 테두리. `invalid_meeting_status`(409) → 토스트 + 상세 재조회
 * - 그 밖의 실패는 **U-7 규격** — 토스트 + 그 필드 실패 표시 + 「다시 저장」. 소유자는 `useRowFailures`(내부 state 아님)
 * - `locked`(`generating` · 드로어의 `recording`) 이면 전부 읽기 전용이다(U-1 「헤더 메타 잠금」)
 *
 * 유형명은 **설정의 동적 유형 이름**이다 — 시안 L1437 「미팅 · 회의」 고정명을 쓰지 않는다(§A-7). 프로젝트가 없으면 「프로젝트 없음」 회색.
 */

import { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { AutoSaveFailureNotice, type AutoSaveFailure } from "@/components/shared/AutoSaveFailureNotice";
import { ColorDot } from "@/components/shared/ColorDot";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { Selector } from "@/components/shared/Selector";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MeetingDateTimeField, slotError, type MeetingSlot } from "@/features/meetings/components/MeetingDateTimeField";
import { INVALID_STATUS_MESSAGE, isInvalidMeetingStatus, meetingInlineError, autoSaveErrorToast } from "@/features/meetings/errors";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import type { MeetingDetail, UpdateMeetingInput } from "@/features/meetings/types";
import { inlineErrorMessage } from "@/lib/api/errors";
import { formatMeetingTimeRange, splitDateTime, toDateTimeIso } from "@/lib/datetime";
import { useProjectMutations, useProjectsQuery, useWorkTypesQuery } from "@/lib/hooks/useWorkSettings";
import { useRowFailures } from "@/lib/hooks/useRowFailures";
import { cn } from "@/lib/utils";

export const META_FIELD_LABEL = { title: "제목", time: "일시", workType: "유형", project: "프로젝트" } as const;
export type MetaField = keyof typeof META_FIELD_LABEL;

/** 메타 자동 저장 한 벌 — 헤더(페이지 · 드로어)가 같은 배선을 탄다. 블록마다 따로 부르면 실패 상태가 섞이지 않는다. */
export function useMeetingMetaSave(meeting: MeetingDetail) {
  const mutations = useMeetingMutations(meeting.id);
  const { failures, markFailed, clearFailed, hasFailed } = useRowFailures();

  const save = useCallback(
    async (field: MetaField, input: UpdateMeetingInput): Promise<void> => {
      try {
        await mutations.update.mutateAsync({ id: meeting.id, input });
        clearFailed(meeting.id, field);
      } catch (error) {
        if (isInvalidMeetingStatus(error)) {
          // 화면이 낡았다(다른 창에서 상태가 바뀜) — 「다시 저장」으로 풀 일이 아니다.
          toast.error(INVALID_STATUS_MESSAGE);
          clearFailed(meeting.id, field);
          void mutations.refreshDetail();
          return;
        }
        const inline = meetingInlineError(error);
        // 겹침은 토스트 문구가 더 많이 말해 준다 — 그대로 쓴다. 그 밖은 U-7 「저장하지 못했습니다 · <필드>」.
        toast.error(inline?.toast ? inline.message : autoSaveErrorToast(META_FIELD_LABEL[field]));
        markFailed(meeting.id, field, { retry: () => save(field, input) });
      }
    },
    [clearFailed, markFailed, meeting.id, mutations],
  );

  const row = failures[meeting.id] ?? {};
  const failureList: AutoSaveFailure[] = (Object.keys(row) as MetaField[]).map((field) => ({
    field,
    label: META_FIELD_LABEL[field],
    onRetry: () => void row[field].retry(),
  }));

  return {
    save,
    saving: mutations.update.isPending,
    hasFailed: (field: MetaField) => hasFailed(meeting.id, field),
    /** 캡션·「다시 저장」의 **헤더당 하나뿐인 자리**. */
    notice: <AutoSaveFailureNotice busy={mutations.update.isPending} failures={failureList} />,
  };
}

export type MetaSave = ReturnType<typeof useMeetingMetaSave>;

/** 제목 — 페이지 28/700 · 드로어 26/700. 포커스 해제 시 `PATCH {title}`. */
export function MeetingTitleInline({
  meeting,
  meta,
  size,
  locked,
}: {
  meeting: MeetingDetail;
  meta: MetaSave;
  size: "page" | "drawer";
  locked: boolean;
}) {
  const titleClass = size === "page" ? "text-page-title" : "text-detail-title";
  if (locked) {
    return <h1 className={cn("truncate text-foreground", titleClass)}>{meeting.title}</h1>;
  }
  return (
    <InlineEditText
      ariaLabel="제목"
      value={meeting.title}
      saveFailed={meta.hasFailed("title")}
      onSave={(next) => meta.save("title", { title: next })}
      className={cn("[&_input]:h-auto [&_input]:py-0.5 [&_input]:leading-tight", size === "page" ? "[&_input]:text-page-title" : "[&_input]:text-detail-title")}
    />
  );
}

/**
 * 일시 — 「08월 27일 (목) 09:30 – 10:30」 텍스트가 팝오버(날짜 + 시작 – 종료 시각 — 생성 드로어와 같은 칸)를 연다.
 * **팝오버가 닫힐 때(포커스 해제) 저장** — 바뀌었고 5~300분 안이면 `PATCH {startAt, endAt}` 둘을 함께.
 */
export function MeetingDateTimeInline({
  meeting,
  meta,
  locked,
  className,
}: {
  meeting: MeetingDetail;
  meta: MetaSave;
  locked: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<MeetingSlot | null>(null);
  const label = formatMeetingTimeRange(meeting.startAt, meeting.endAt);
  const failed = meta.hasFailed("time");

  const currentSlot = (): MeetingSlot => {
    const start = splitDateTime(meeting.startAt);
    const end = splitDateTime(meeting.endAt);
    return { date: start.date, start: start.time, end: end.time };
  };

  const commit = () => {
    if (!slot) {
      return;
    }
    const base = currentSlot();
    const changed = slot.date !== base.date || slot.start !== base.start || slot.end !== base.end;
    if (changed && slotError(slot) === null) {
      void meta.save("time", { startAt: toDateTimeIso(slot.date, slot.start), endAt: toDateTimeIso(slot.date, slot.end) });
    }
    setSlot(null);
  };

  if (locked) {
    return <span className={cn("text-meta text-fg-meta", className)}>{label}</span>;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSlot(currentSlot());
        } else {
          commit();
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="일시"
          data-save-failed={failed || undefined}
          className={cn(
            "rounded-chip text-meta text-fg-meta hover:text-foreground hover:underline",
            failed && "ring-1 ring-destructive",
            className,
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-auto rounded-card border-border bg-card p-4 shadow-popover">
        {slot ? <MeetingDateTimeField value={slot} onChange={setSlot} saveFailed={failed} /> : null}
      </PopoverContent>
    </Popover>
  );
}

/** 유형 — 페이지는 이름 텍스트, 드로어는 배지. 누르면 **회의 종류 유형** 목록(`kind='meeting'`)이 열린다. */
export function MeetingWorkTypeInline({
  meeting,
  meta,
  locked,
  variant,
}: {
  meeting: MeetingDetail;
  meta: MetaSave;
  locked: boolean;
  variant: "text" | "badge";
}) {
  const { data: workTypes = [] } = useWorkTypesQuery();
  const failed = meta.hasFailed("workType");
  const face =
    variant === "badge" ? (
      <span
        data-color-token={meeting.workType.colorToken}
        className={cn("inline-flex h-[22px] shrink-0 items-center rounded-chip bg-palette-bg px-2 text-caption font-semibold text-palette-fg", failed && "ring-1 ring-destructive")}
      >
        {meeting.workType.name}
      </span>
    ) : (
      <span className={cn("rounded-chip text-meta text-fg-meta", failed && "ring-1 ring-destructive")}>{meeting.workType.name}</span>
    );

  if (locked) {
    return face;
  }
  return (
    <Selector
      label="유형"
      placeholder="유형"
      value={{ id: meeting.workType.id, name: meeting.workType.name, colorToken: meeting.workType.colorToken }}
      options={workTypes.filter((item) => item.kind === "meeting").map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }))}
      onSelect={(option) => {
        if (option && option.id !== meeting.workType.id) {
          void meta.save("workType", { workTypeId: option.id });
        }
      }}
      renderTrigger={() => (
        <button type="button" aria-label="유형 바꾸기" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
          {face}
          {variant === "text" ? <ChevronDown className="h-2.5 w-2.5 text-fg-caption" aria-hidden /> : null}
        </button>
      )}
    />
  );
}

/** 프로젝트 — 없으면 「프로젝트 없음」 회색. 팝오버 목록에 「+ 새 프로젝트로 추가」 인라인 행(공용 `Selector`). */
export function MeetingProjectInline({
  meeting,
  meta,
  locked,
  variant,
}: {
  meeting: MeetingDetail;
  meta: MetaSave;
  locked: boolean;
  variant: "text" | "chip";
}) {
  const { data: projects = [] } = useProjectsQuery();
  const projectMutations = useProjectMutations();
  const failed = meta.hasFailed("project");
  const project = meeting.project;
  const face =
    variant === "chip" ? (
      <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-chip bg-chip-bg px-2 text-caption font-semibold text-fg-meta", failed && "ring-1 ring-destructive")}>
        {project ? <ColorDot colorToken={project.colorToken} /> : null}
        {project ? project.name : "프로젝트 없음"}
      </span>
    ) : (
      <span className={cn("rounded-chip text-meta", project ? "text-fg-meta" : "text-fg-caption", failed && "ring-1 ring-destructive")}>
        {project ? project.name : "프로젝트 없음"}
      </span>
    );

  if (locked) {
    return face;
  }
  return (
    <Selector
      label="프로젝트"
      placeholder="프로젝트 없음"
      clearable
      value={project ? { id: project.id, name: project.name, colorToken: project.colorToken } : null}
      options={projects.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }))}
      onSelect={(option) => {
        const nextId = option?.id ?? null;
        if (nextId !== (project?.id ?? null)) {
          void meta.save("project", { projectId: nextId });
        }
      }}
      creating={projectMutations.create.isPending}
      onCreate={async (input) => {
        const created = await projectMutations.create.mutateAsync(input);
        return { id: created.id, name: created.name, colorToken: created.colorToken };
      }}
      createErrorMessage={(error) => inlineErrorMessage(error, "project")}
      renderTrigger={() => (
        <button type="button" aria-label="프로젝트 바꾸기" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
          {face}
          {variant === "text" ? <ChevronDown className="h-2.5 w-2.5 text-fg-caption" aria-hidden /> : null}
        </button>
      )}
    />
  );
}

/**
 * 페이지 헤더의 메타 한 줄(시안 L1437) — 「<일시> · <n분> · <유형명> · <프로젝트명>」. 일시 · 유형 · 프로젝트가 각각 인라인 컨트롤이다.
 * 길이는 `durationMinutes`(서버 파생 — G-7)다.
 */
export function MeetingMetaLine({ meeting, meta, locked }: { meeting: MeetingDetail; meta: MetaSave; locked: boolean }) {
  const dot = <span aria-hidden className="text-fg-caption">·</span>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-meta text-fg-meta">
      <MeetingDateTimeInline meeting={meeting} meta={meta} locked={locked} />
      {dot}
      <span>{meeting.durationMinutes}분</span>
      {dot}
      <MeetingWorkTypeInline meeting={meeting} meta={meta} locked={locked} variant="text" />
      {dot}
      <MeetingProjectInline meeting={meeting} meta={meta} locked={locked} variant="text" />
    </div>
  );
}

"use client";

/**
 * **새 회의록 드로어**(SPEC-006 U-3 · 회의록.dc.html L439~532).
 *
 * 드로어 규격(폭·스크림·닫는 길)은 **`DrawerFrame` 이 정한다** — 여기는 헤더 내용·본문·푸터 내용만.
 * **부모를 모른다**(FE §6-2) — `onCreated(detail)` 콜백만 낸다. 캘린더가 `startAt`·`endAt` 을 미리 넣어
 * **같은 드로어**를 연다(SPEC-009 U-6). 라우터·부모 상태를 import 하지 않는다.
 *
 * - 열자마자 **제목 포커스** · 제출 조건 **제목 + 유형 + 일시(셋 다)** · 제출 중 비활성
 * - 유형 셀렉터는 **`kind='meeting'` 만**, 기본값 시드 「미팅·회의」(`isDefault`). 고정 칩 3종(L466~468)은 폐기
 * - 프로젝트 셀렉터 하단 「+ 새 프로젝트로 추가」 — `Selector` 공용 인라인 행(U-3 규격)
 * - 일시 **기본값**: 오늘 · 현재 시각 30분 올림 · +1시간
 * - 안건 행 44(「안건 n」 · 입력 · 「제거」) + 마지막 빈 행 + **「추가」 버튼 병행**. 공백 행은 저장하지 않는다
 * - 첨부: 점선 영역은 **`V2Gate`**(드롭 → 「v2에서 제공됩니다」 토스트, 요청 없음) + 「자료함에서 선택」 →
 *   **SPEC-003 U-7 팝오버**(문서 갈래 스텁 · 링크 갈래 실동작) · 목록 행 `AttachmentList`. **드로어 안에서 파일 드로어를 열지 않는다**
 * - 실패: 드로어가 닫히지 않고 인라인(§4 Case Matrix). `schedule_overlap` 은 **토스트 + 일시 실패 테두리**
 *
 * **없는 것**(§3·§7): 상태 필드 · 연관 업무 칸 · 「만들면 바로 회의 시작」 토글(L519~525) · 유형 고정 칩.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Paperclip, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { AttachmentList } from "@/components/shared/AttachmentList";
import { AttachmentPopover } from "@/components/shared/AttachmentPopover";
import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { V2Gate } from "@/components/shared/V2Gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MeetingDateTimeField, slotError, type MeetingSlot } from "@/features/meetings/components/MeetingDateTimeField";
import { meetingInlineError } from "@/features/meetings/errors";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import type { MeetingDetail } from "@/features/meetings/types";
import { inlineErrorMessage } from "@/features/settings/errors";
import { useProjectMutations, useProjectsQuery, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import { isEnterSubmit } from "@/lib/keyboard";
import { defaultMeetingSlot, splitDateTime, toDateTimeIso } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** 링크 첨부는 서버에 보내기 전까지 화면에만 있다 — 생성이 한 번에 가기 때문이다(§5). */
interface DraftLink {
  id: number;
  kind: "link";
  name: string;
  url: string;
  label: string | null;
  folderPath: null;
}

type FieldKey = "title" | "workType" | "project" | "time";

function initialSlot(initial?: { startAt?: string; endAt?: string }): MeetingSlot {
  if (initial?.startAt && initial.endAt) {
    const start = splitDateTime(initial.startAt);
    const end = splitDateTime(initial.endAt);
    return { date: start.date, start: start.time, end: end.time };
  }
  return defaultMeetingSlot();
}

/** 프레임의 `renderHeader` 에 꽂는 헤더 72 — 제목 18/700 + 캡션 12 + ×(시안 L442~448). */
export function MeetingCreateDrawerHeader({
  fullscreen,
  onClose,
}: {
  fullscreen: boolean;
  onClose: () => void;
}) {
  return (
    <header className={cn("flex items-center gap-3 border-b border-divider px-7", fullscreen ? "h-[74px]" : "h-[72px]")}>
      {fullscreen ? (
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <h2 className="text-[18px] font-bold tracking-title text-foreground">새 회의록</h2>
        <p className="text-caption text-fg-caption">안건을 미리 적어두면 회의 중 화면이 안건별로 열립니다</p>
      </div>
      {fullscreen ? null : (
        <button
          type="button"
          aria-label="드로어 닫기"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
        >
          <X className="h-[15px] w-[15px]" aria-hidden />
        </button>
      )}
    </header>
  );
}

export function MeetingCreateDrawer({
  onCreated,
  onCancel,
  initial,
}: {
  onCreated: (meeting: MeetingDetail) => void;
  onCancel: () => void;
  /** 캘린더가 고른 시각(SPEC-009 U-6). 없으면 기본값(오늘 · 다음 30분 경계 · +1시간). */
  initial?: { startAt?: string; endAt?: string };
}) {
  const { data: workTypes = [] } = useWorkTypesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const projectMutations = useProjectMutations();
  const { create } = useMeetingMutations();

  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [workType, setWorkType] = useState<SelectorOption | null>(null);
  const [project, setProject] = useState<SelectorOption | null>(null);
  const [slot, setSlot] = useState<MeetingSlot>(() => initialSlot(initial));
  const [agendas, setAgendas] = useState<string[]>([]);
  const [agendaDraft, setAgendaDraft] = useState("");
  const [links, setLinks] = useState<DraftLink[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  /** **종류=미팅 유형만**(DEC-003 §3 · M-2). 업무 유형은 목록에 없다. */
  const meetingTypes = workTypes.filter((item) => item.kind === "meeting");

  // 열자마자 **제목 입력에 포커스**(U-3 상태).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // 기본값은 **시드 기본 유형 「미팅·회의」**(삭제 불가 — DEC-001 §4). 목록이 도착하면 한 번 잡는다.
  useEffect(() => {
    if (workType === null && meetingTypes.length > 0) {
      const seed = meetingTypes.find((item) => item.isDefault) ?? meetingTypes[0];
      setWorkType({ id: seed.id, name: seed.name, colorToken: seed.colorToken });
    }
  }, [meetingTypes, workType]);

  const canSubmit =
    title.trim().length > 0 && workType !== null && slotError(slot) === null && !create.isPending;

  const addAgenda = () => {
    const text = agendaDraft.trim();
    if (text.length === 0) {
      // 공백만인 행은 저장하지 않는다(U-3).
      return;
    }
    setAgendas((prev) => [...prev, text]);
    setAgendaDraft("");
  };

  const submit = () => {
    if (!canSubmit || workType === null) {
      return;
    }
    setErrors({});
    void create
      .mutateAsync({
        title: title.trim(),
        workTypeId: workType.id,
        projectId: project?.id ?? null,
        startAt: toDateTimeIso(slot.date, slot.start),
        endAt: toDateTimeIso(slot.date, slot.end),
        agendas: agendas.map((item) => ({ title: item })),
        attachments: links.map((link) => ({ kind: "link" as const, url: link.url, label: link.label })),
      })
      .then(onCreated)
      .catch((error: unknown) => {
        const inline = meetingInlineError(error);
        if (inline) {
          // **드로어가 닫히지 않고 입력이 남는다**(§4 Case Matrix).
          setErrors({ [inline.field ?? "title"]: inline.message });
          if (inline.toast) {
            toast.error(inline.message);
          }
          return;
        }
        toast.error("회의록을 만들지 못했습니다");
      });
  };

  return (
    <>
      <div className="flex flex-col gap-[22px]">
        {/* ① 제목 44 */}
        <Field label="제목">
          <Input
            ref={titleRef}
            aria-label="회의 제목"
            placeholder="회의 제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={cn("h-11 text-body font-semibold", errors.title && "border-destructive")}
          />
          {errors.title ? <p role="alert" className="text-caption text-destructive">{errors.title}</p> : null}
        </Field>

        {/* ② 프로젝트 · 유형 2열 `1fr 1fr` gap 22 — 1280~1439 에서는 1열로 쌓인다(U-6) */}
        <div className="grid grid-cols-1 gap-[22px] wide:grid-cols-2">
          <Field label="프로젝트">
            <Selector
              label="프로젝트"
              placeholder="프로젝트 없음"
              value={project}
              clearable
              options={projects.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }))}
              onSelect={(next) => {
                setProject(next);
                setErrors((prev) => ({ ...prev, project: undefined }));
              }}
              saveFailed={Boolean(errors.project)}
              creating={projectMutations.create.isPending}
              onCreate={async (input) => {
                const created = await projectMutations.create.mutateAsync(input);
                return { id: created.id, name: created.name, colorToken: created.colorToken };
              }}
              createErrorMessage={(error) => inlineErrorMessage(error, "project")}
            />
            <p className="text-caption text-fg-caption">목록에 없으면 셀렉터 맨 아래 &apos;새 프로젝트로 추가&apos;</p>
            {errors.project ? <p role="alert" className="text-caption text-destructive">{errors.project}</p> : null}
          </Field>
          <Field label="유형">
            <Selector
              label="유형"
              placeholder="유형 (필수)"
              value={workType}
              options={meetingTypes.map((item) => ({ id: item.id, name: item.name, colorToken: item.colorToken }))}
              onSelect={(next) => {
                setWorkType(next);
                setErrors((prev) => ({ ...prev, workType: undefined }));
              }}
              saveFailed={Boolean(errors.workType)}
            />
            {errors.workType ? <p role="alert" className="text-caption text-destructive">{errors.workType}</p> : null}
          </Field>
        </div>

        {/* ③ 일시 — 날짜 200 + 시작 130 – 종료 130 */}
        <Field label="일시">
          <MeetingDateTimeField
            value={slot}
            onChange={(next) => {
              setSlot(next);
              setErrors((prev) => ({ ...prev, time: undefined }));
            }}
            saveFailed={Boolean(errors.time)}
          />
        </Field>

        {/* ④ 안건 — 행 44 + 마지막 빈 행 + 「추가」 버튼 병행 */}
        <Field label="안건" caption="Enter로 계속 추가">
          <div className="flex flex-col gap-2">
            {agendas.map((item, index) => (
              <div
                key={`${item}-${index}`}
                className="group flex h-11 items-center gap-3 rounded-control border border-border px-3.5"
              >
                <span className="w-10 shrink-0 text-[11px] font-bold text-fg-caption">안건 {index + 1}</span>
                <Input
                  aria-label={`안건 ${index + 1}`}
                  value={item}
                  onChange={(event) =>
                    setAgendas((prev) => prev.map((row, i) => (i === index ? event.target.value : row)))
                  }
                  onBlur={(event) => {
                    // 비워 두고 나가면 그 행을 저장하지 않는다(공백 행 미저장).
                    if (event.target.value.trim().length === 0) {
                      setAgendas((prev) => prev.filter((_, i) => i !== index));
                    }
                  }}
                  className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-control-label shadow-none focus-visible:ring-0"
                />
                <button
                  type="button"
                  aria-label={`안건 ${index + 1} 제거`}
                  onClick={() => setAgendas((prev) => prev.filter((_, i) => i !== index))}
                  className="shrink-0 text-fg-placeholder opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <div className="flex h-11 items-center gap-3 rounded-control border border-divider px-3.5">
              <span className="w-10 shrink-0 text-[11px] font-bold text-fg-caption">안건 {agendas.length + 1}</span>
              <Input
                aria-label="새 안건"
                placeholder="안건 입력 후 Enter"
                value={agendaDraft}
                onChange={(event) => setAgendaDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (isEnterSubmit(event)) {
                    event.preventDefault();
                    addAgenda();
                  }
                }}
                className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-control-label shadow-none focus-visible:ring-0"
              />
              <button
                type="button"
                aria-label="안건 추가"
                onClick={addAgenda}
                disabled={agendaDraft.trim().length === 0}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-[11px] text-caption font-semibold text-secondary-foreground disabled:opacity-50 [&_svg]:h-[11px] [&_svg]:w-[11px]"
              >
                <Plus aria-hidden />
                추가
              </button>
            </div>
          </div>
        </Field>

        {/* ⑤ 첨부 파일 — 점선 영역(`V2Gate`) + 「자료함에서 선택」(팝오버) + 목록 행 */}
        <Field label="첨부 파일" caption="회의 중에도 추가할 수 있습니다">
          <div className="flex items-center gap-3 rounded-control border border-dashed border-border bg-row-hover p-3.5">
            {/* 드롭 영역 — **`V2Gate` 하나** 아래. 놓으면 토스트만, 요청 없음(DEC-003 §1 표 · FE §9) */}
            <V2Gate reason="v2" className="flex min-w-0 flex-1 items-center gap-3">
              <span
                aria-hidden
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-row-divider text-fg-caption [&_svg]:h-4 [&_svg]:w-4"
              >
                <Paperclip aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-meta text-fg-caption">
                파일을 끌어다 놓거나 자료함에서 선택
              </span>
            </V2Gate>
            <AttachmentPopover
              role="reference"
              onAddLink={async ({ url, label }) => {
                setLinks((prev) => [
                  ...prev,
                  { id: -(prev.length + 1), kind: "link", name: label ?? url, url, label, folderPath: null },
                ]);
              }}
              trigger={
                <button
                  type="button"
                  className="flex h-[30px] shrink-0 items-center rounded-control border border-border bg-card px-3 text-caption font-semibold text-foreground hover:bg-muted"
                >
                  자료함에서 선택
                </button>
              }
            />
          </div>
          {links.length > 0 ? (
            <AttachmentList
              attachments={links}
              emptyMessage="첨부한 파일이 없습니다"
              onRemove={(link) => setLinks((prev) => prev.filter((item) => item.id !== link.id))}
            />
          ) : null}
        </Field>
      </div>

      {/* 푸터 80 — 자리는 프레임(76·구분선)이 갖고 내용만 여기서 넣는다 */}
      <DrawerFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={create.isPending}
          className="h-11 px-5 text-control-label text-fg-meta"
        >
          취소
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={submit} className="h-11 px-6 text-control-label font-semibold">
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          만들기
        </Button>
      </DrawerFooter>
    </>
  );
}

/** 라벨 13/600 + 캡션 12(시안 L452 · L483 · L507). 라벨↔입력 `gap 8`. */
function Field({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <h3 className="text-field-label text-foreground">{label}</h3>
        {caption ? <span className="text-caption text-fg-caption">{caption}</span> : null}
      </div>
      {children}
    </section>
  );
}

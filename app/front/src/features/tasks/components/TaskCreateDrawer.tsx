"use client";

/**
 * **U-1 새 업무 드로어**(SPEC-003 · P-20 정정 반영).
 *
 * 드로어 규격(폭·헤더·푸터·스크림)은 **이 파일이 정하지 않는다** —
 * `DrawerFrame` 하나가 정하고 여기는 **본문과 푸터 내용**만 준다(FE §6-2).
 *
 * - 열자마자 **제목 포커스** · 제출 조건 **제목 1자 + 유형 선택** · 제출 중 버튼 비활성
 * - **상태 필드가 없다.** 생성 시 항상 「시작전」이다(DEC-002 §5)
 * - **「임시저장」 배지를 두지 않는다**(디자인 정정 · S003-OQ-1)
 * - 드로어에 넣은 할일·참고자료·연관업무는 **함께** 저장된다 — 절반만 저장되는 상태가 없다(§5)
 * - 실패하면 **드로어가 닫히지 않고** 해당 필드에 인라인 안내(§4 Case Matrix)
 */

import { useEffect, useRef, useState } from "react";
import { Link2 as LinkIcon, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { isEnterSubmit } from "@/lib/keyboard";
import { AttachmentPopover } from "@/components/shared/AttachmentPopover";
import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { EmptyState } from "@/components/shared/EmptyState";
import { AddRowButton, ItemRow, ItemRows } from "@/components/shared/ItemRow";
import { StatusDot } from "@/components/shared/StatusDot";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DueDateField,
  isScheduleValid,
  type DueValue,
} from "@/features/tasks/components/DueDateField";
import { RelationPopover } from "@/features/tasks/components/RelationPopover";
import { taskInlineError } from "@/features/tasks/errors";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import type { TaskDetail, TaskRelation } from "@/features/tasks/types";
import { useProjectMutations, useProjectsQuery, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import { cn } from "@/lib/utils";

/** 링크 첨부는 서버에 보내기 전까지 화면에만 있다 — 생성이 한 번에 가기 때문이다(§5). */
interface DraftLink {
  role: "reference" | "deliverable";
  url: string;
  label: string | null;
}

export function TaskCreateDrawer({
  onCreated,
  onCancel,
}: {
  onCreated: (task: TaskDetail) => void;
  onCancel: () => void;
}) {
  const { data: workTypes = [] } = useWorkTypesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const projectMutations = useProjectMutations();
  const { create } = useTaskMutations();

  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [workType, setWorkType] = useState<SelectorOption | null>(null);
  const [project, setProject] = useState<SelectorOption | null>(null);
  const [due, setDue] = useState<DueValue>({ startDate: null, dueDate: null });
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");

  const [todos, setTodos] = useState<DraftTodo[]>([]);
  const [todoDraft, setTodoDraft] = useState("");
  const [links, setLinks] = useState<DraftLink[]>([]);
  const [relatedIds, setRelatedIds] = useState<number[]>([]);
  /**
   * 고른 연관업무의 **표시용 사본**. 저장에 나가는 것은 `relatedIds` 뿐이고
   * 이것은 시안의 행 카드(제목 + 상태 dot)를 그리기 위한 값이다(G-0b).
   */
  const [relatedTasks, setRelatedTasks] = useState<readonly TaskRelation[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // 열자마자 **제목 입력에 포커스**(U-1 상태).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // **제목 1자 이상 + 유형 선택됨.** 둘 중 하나라도 없으면 비활성(U-1).
  // **제목 1자 이상 + 유형 선택됨 + 일정이 뒤집히지 않음.** 하나라도 어긋나면 비활성(U-1 · F-1)
  const canSubmit =
    title.trim().length > 0 && workType !== null && isScheduleValid(due) && !create.isPending;

  const addTodo = () => {
    const text = todoDraft.trim();
    if (text.length === 0) {
      return;
    }
    setTodos((prev) => [...prev, { text, done: false }]);
    // 등록 후 입력이 비워지고 포커스가 남는다(U-5 CTA).
    setTodoDraft("");
  };

  const submit = () => {
    if (!canSubmit || workType === null) {
      return;
    }
    setFieldError(null);
    void create
      .mutateAsync({
        title: title.trim(),
        workTypeId: workType.id,
        projectId: project?.id ?? null,
        startDate: due.startDate,
        dueDate: due.dueDate,
        description: description.trim() || null,
        todos: todos.map((todo) => ({ text: todo.text })),
        attachments: links.map((link) => ({
          role: link.role,
          kind: "link" as const,
          url: link.url,
          label: link.label,
        })),
        relatedTaskIds: relatedIds,
      })
      .then(onCreated)
      .catch((error: unknown) => {
        const inline = taskInlineError(error);
        if (inline) {
          // **드로어가 닫히지 않고 입력이 남는다**(§4 Case Matrix).
          setFieldError(inline.message);
          if (inline.toast) {
            toast.error(inline.message);
          }
          return;
        }
        toast.error("업무를 만들지 못했습니다");
      });
  };

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* ① 제목 */}
        <Field label="제목">
          <Input
            ref={titleRef}
            aria-label="업무 제목"
            placeholder="업무 제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={cn("h-input-lg text-panel", fieldError && "border-destructive")}
          />
          {fieldError ? <p className="text-caption text-destructive">{fieldError}</p> : null}
        </Field>

        {/* ② 유형 240 · 프로젝트 250 · 일정 유동 — 시안 570~597줄, 필드 사이 `gap 12` */}
        <div className="flex flex-wrap items-start gap-3">
          <Field label="유형" className="w-[240px]">
          <Selector
            label="유형"
            placeholder="유형 (필수)"
            value={workType}
            options={workTypes.map((item) => ({
              id: item.id,
              name: item.name,
              colorToken: item.colorToken,
            }))}
            onSelect={setWorkType}
          />
          </Field>
          <Field label="프로젝트" className="w-[250px]">
          <Selector
            label="프로젝트"
            placeholder="프로젝트 (선택)"
            value={project}
            clearable
            options={projects.map((item) => ({
              id: item.id,
              name: item.name,
              colorToken: item.colorToken,
            }))}
            onSelect={setProject}
            creating={projectMutations.create.isPending}
            onCreate={async (input) => {
              const created = await projectMutations.create.mutateAsync(input);
              return { id: created.id, name: created.name, colorToken: created.colorToken };
            }}
          />
          </Field>
          <Field label="일정" className="min-w-[240px] flex-1">
            <DueDateField value={due} onChange={setDue} />
          </Field>
        </div>

        {/* ③ 설명 — `background`·`goal` 두 칸을 합친 하나다(DEC-002 · F-1b) */}
        <Field label="설명">
          <Textarea
            aria-label="설명"
            placeholder="이 업무에 대한 설명"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            /* 시안에 크기 손잡이가 없다 — 높이는 시안 80px 고정이다(602줄) */
            className="h-20 resize-none"
          />
        </Field>

        {/* ④ 할일 — 시안 610~625줄. 목록과 입력 행이 **한 카드 안**에 들어간다 */}
        <TodoBlock
          todos={todos}
          draft={todoDraft}
          onDraftChange={setTodoDraft}
          onAdd={addTodo}
          onToggle={(index) =>
            setTodos((prev) =>
              prev.map((todo, i) => (i === index ? { ...todo, done: !todo.done } : todo)),
            )
          }
          onRemove={(index) => setTodos((prev) => prev.filter((_, i) => i !== index))}
        />

        {/* ⑤ 참고자료 · 연관업무 2열 — **높이는 각자 내용만큼**이다(C-2 와 같은 자리) */}
        <div className="grid grid-cols-1 items-start gap-4 wide:grid-cols-2">
          <Field label="참고자료">
            <DraftLinkList
              links={links.filter((link) => link.role === "reference")}
              onRemove={(link) => setLinks((prev) => prev.filter((item) => item !== link))}
            />
            <AttachmentPopover
              role="reference"
              onAddLink={async (input) => {
                setLinks((prev) => [...prev, input]);
              }}
              trigger={
                <AddRowButton>
                  <Plus aria-hidden />
                  자료함에서 첨부
                </AddRowButton>
              }
            />
          </Field>
          <Field label="연관업무">
            {/* **비어 있을 때만 캡션.** 항목이 있으면 카드만 쌓인다(시안 646~654줄) */}
            {relatedIds.length === 0 ? (
              <EmptyState message="연결한 업무가 없습니다" />
            ) : (
              <ItemRows>
                {relatedIds.map((id) => {
                  const picked = relatedTasks.find((item) => item.id === id);
                  return (
                    <ItemRow
                      key={id}
                      leading={picked ? <StatusDot status={picked.status} /> : null}
                      trailing={
                        <button
                          type="button"
                          aria-label={`${picked?.title ?? id} 연결 해제`}
                          onClick={() => {
                            setRelatedIds((prev) => prev.filter((x) => x !== id));
                            setRelatedTasks((prev) => prev.filter((item) => item.id !== id));
                          }}
                          className="shrink-0 text-fg-caption opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      }
                    >
                      {picked?.title ?? `업무 #${id}`}
                    </ItemRow>
                  );
                })}
              </ItemRows>
            )}
            <RelationPopover
              // 생성 드로어는 **자기 id 가 없다** — 폼에 입력 중인 값을 정렬 근거로 준다(§4).
              projectId={project?.id ?? null}
              dueDate={due.dueDate}
              // **폼의 프로젝트 값이 바뀌면 이 판정도 따라 바뀐다**(U-8).
              hasBaseProject={project !== null}
              selectedIds={relatedIds}
              onChange={(next, picked) => {
                setRelatedIds(next);
                // 이미 고른 것 중 이번 후보 목록에 없던 항목의 제목을 잃지 않는다
                setRelatedTasks((prev) => {
                  const known = new Map(prev.map((item) => [item.id, item]));
                  picked.forEach((item) => known.set(item.id, item));
                  return next.map((id) => known.get(id)).filter((item) => item !== undefined);
                });
              }}
              trigger={
                <AddRowButton>
                  <Plus aria-hidden />
                  업무 연결
                </AddRowButton>
              }
            />
          </Field>
        </div>

        {/* ⑥ 메모 · 결과자료 2열 — 시안 662~671줄 */}
        <div className="grid grid-cols-1 items-start gap-5 wide:grid-cols-2">
          <Field label="메모">
            <Textarea
              aria-label="메모"
              placeholder="첫 메모를 남기면 로그에 함께 기록됩니다"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              className="h-14 resize-none"
            />
          </Field>
          {/* 결과자료 — **입력 없이 안내만**(U-1 6). 완료 게이트가 등록한다 */}
          <Field label="결과자료">
            <Hint>완료 처리 시 등록</Hint>
          </Field>
        </div>

        {/* ⑦ 로그 — 아래 한 줄, 안내만(시안 673~678줄) */}
        <Field label="로그">
          <span className="flex h-[46px] items-center gap-2.5 rounded-control border border-divider bg-row-hover px-3 text-caption text-fg-caption">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
            생성 시점부터 자동 기록
          </span>
        </Field>
      </div>

      {/*
        푸터 **자리**는 `DrawerFrame`(76·구분선)이 갖고 **내용만** 여기서 넣는다 —
        제출 조건이 이 폼의 상태라 CTA 가 폼 안에 살아야 한다(§6-2 규격은 프레임이 소유).
      */}
      <DrawerFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={create.isPending}>
          취소
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={submit}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          업무 만들기
        </Button>
      </DrawerFooter>
    </>
  );
}

/** 저장 전 할일 초안. 서버에는 `text` 만 나가고 `done` 은 **화면 안에서만** 산다. */
interface DraftTodo {
  text: string;
  done: boolean;
}

/**
 * **할일 블록**(시안 610~625줄 · 디자인 시스템 [07] Inline Add Row).
 *
 * 전에는 항목이 **그냥 텍스트 + `✕`** 라서 어디가 항목이고 어디가 입력칸인지 구분되지
 * 않았다(사용자 지적). 시안은 목록과 입력 행이 **테두리 하나로 묶인 카드**이고 각 행에
 * 체크박스가 있다.
 *
 * - 헤더 우측에 **진행률 `0 / 3`**
 * - 항목 행 **h40** · 체크박스 16 r4 · 행 사이 `border-top #F1F2F5`
 * - **입력 행은 맨 아래 고정** · h44 · 배경 `#FAFBFC` · **점선** 체크박스
 * - 삭제는 **행 hover 에서만** 뜬다 — 항상 띄우면 `✕` 가 목록을 채운다
 * - `Enter` 로 등록되지만 **「추가」 버튼을 항상 함께 둔다**([10] 단축키는 보조)
 */
function TodoBlock({
  todos,
  draft,
  onDraftChange,
  onAdd,
  onToggle,
  onRemove,
}: {
  todos: readonly DraftTodo[];
  draft: string;
  onDraftChange: (next: string) => void;
  onAdd: () => void;
  onToggle: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const done = todos.filter((todo) => todo.done).length;

  return (
    <section className="flex min-w-0 flex-col gap-[7px]">
      <div className="flex items-center justify-between">
        <h3 className="text-block-label text-fg-meta">할일</h3>
        <span className="text-caption text-fg-caption">
          {done} / {todos.length}
        </span>
      </div>

      <div className="flex flex-col overflow-hidden rounded-control border border-border">
        {todos.map((todo, index) => (
          <div
            key={`${todo.text}-${index}`}
            className="group flex h-10 items-center gap-2.5 border-b border-row-divider px-3 text-meta"
          >
            <Checkbox
              checked={todo.done}
              onCheckedChange={() => onToggle(index)}
              aria-label={todo.text}
              className="h-4 w-4 shrink-0 rounded-chip border-border"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                todo.done ? "text-fg-caption line-through" : "text-foreground",
              )}
            >
              {todo.text}
            </span>
            {/* **hover 에서만** — 항상 띄우면 `✕` 가 목록을 채운다 */}
            <button
              type="button"
              aria-label={`${todo.text} 삭제`}
              onClick={() => onRemove(index)}
              className="shrink-0 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}

        {/* 입력 행 — 목록 **맨 아래 고정**. 점선 체크박스가 「아직 항목이 아니다」를 말한다 */}
        <div className="flex h-11 items-center gap-2.5 bg-row-hover pl-3 pr-2">
          <span
            aria-hidden
            className="h-4 w-4 shrink-0 rounded-chip border border-dashed border-border"
          />
          <Input
            aria-label="할일"
            placeholder="할일 입력 후 Enter"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (isEnterSubmit(event)) onAdd();
            }}
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-meta shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={onAdd}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-[11px] text-caption font-semibold text-secondary-foreground hover:opacity-90"
          >
            <Plus className="h-[11px] w-[11px]" aria-hidden />
            추가
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * 블록·필드 라벨 — 시안은 **전부 12 / 700 / `#757575`** 이고 라벨↔입력 `gap 7` 이다
 * (566·572·586·612·629줄). `text-section`(15/700 Ink)이면 라벨이 본문보다 무거워진다(F-1①).
 */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-[7px]", className)}>
      <h3 className="text-block-label text-fg-meta">{label}</h3>
      {children}
    </section>
  );
}

/** 입력 없이 안내만 두는 자리 — 점선 상자(시안 665·669줄). */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-14 items-center rounded-control border border-dashed border-border px-3.5 text-meta text-fg-caption">
      {children}
    </span>
  );
}

function DraftLinkList({
  links,
  onRemove,
}: {
  links: readonly DraftLink[];
  onRemove: (link: DraftLink) => void;
}) {
  if (links.length === 0) {
    return <EmptyState message="첨부한 자료가 없습니다" />;
  }
  return (
    <ItemRows>
      {links.map((link, index) => (
        <ItemRow
          key={`${link.url}-${index}`}
          /* 좌측 타일 22px r5 — 저장 전 초안은 전부 링크라 유형 글자 대신 글리프다(시안 631줄) */
          leading={
            <span
              aria-hidden
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground"
            >
              <LinkIcon className="h-3 w-3" aria-hidden />
            </span>
          }
          trailing={
            <button
              type="button"
              aria-label={`${link.label ?? link.url} 제거`}
              onClick={() => onRemove(link)}
              className="shrink-0 text-fg-caption opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          }
        >
          {link.label ?? link.url}
        </ItemRow>
      ))}
    </ItemRows>
  );
}

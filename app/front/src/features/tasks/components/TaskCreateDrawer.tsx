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
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { AttachmentPopover } from "@/components/shared/AttachmentPopover";
import { DrawerFooter } from "@/components/shared/DrawerFrame";
import { EmptyState } from "@/components/shared/EmptyState";
import { Selector, type SelectorOption } from "@/components/shared/Selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DueDateField, type DueValue } from "@/features/tasks/components/DueDateField";
import { RelationPopover } from "@/features/tasks/components/RelationPopover";
import { taskInlineError } from "@/features/tasks/errors";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import type { TaskDetail } from "@/features/tasks/types";
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
  const [due, setDue] = useState<DueValue>({ dueDate: null, dueStartTime: null, dueEndTime: null });
  const [background, setBackground] = useState("");
  const [goal, setGoal] = useState("");
  const [todos, setTodos] = useState<string[]>([]);
  const [todoDraft, setTodoDraft] = useState("");
  const [links, setLinks] = useState<DraftLink[]>([]);
  const [relatedIds, setRelatedIds] = useState<number[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // 열자마자 **제목 입력에 포커스**(U-1 상태).
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // **제목 1자 이상 + 유형 선택됨.** 둘 중 하나라도 없으면 비활성(U-1).
  const canSubmit = title.trim().length > 0 && workType !== null && !create.isPending;

  const addTodo = () => {
    const text = todoDraft.trim();
    if (text.length === 0) {
      return;
    }
    setTodos((prev) => [...prev, text]);
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
        dueDate: due.dueDate,
        dueStartTime: due.dueStartTime,
        dueEndTime: due.dueEndTime,
        background: background.trim() || null,
        goal: goal.trim() || null,
        todos: todos.map((text) => ({ text })),
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
        <div className="flex flex-col gap-1">
          <Input
            ref={titleRef}
            aria-label="업무 제목"
            placeholder="업무 제목"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={cn("h-input-lg text-panel", fieldError && "border-destructive")}
          />
          {fieldError ? <p className="text-caption text-destructive">{fieldError}</p> : null}
        </div>

        {/* ② 유형(필수) · 프로젝트(선택) · 기한 한 줄 */}
        <div className="flex flex-wrap items-center gap-3">
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
          <DueDateField value={due} onChange={setDue} />
        </div>

        {/* ③ 배경 · 목표 2열 — 1280~1439 에서는 1열로 쌓인다(U-11) */}
        <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
          <Field label="배경">
            <Textarea
              aria-label="배경"
              placeholder="왜 하는가"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
              className="min-h-[96px]"
            />
          </Field>
          <Field label="목표">
            <Textarea
              aria-label="목표"
              placeholder="무엇이 되면 끝인가"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              className="min-h-[96px]"
            />
          </Field>
        </div>

        {/* ④ 할일 */}
        <Field label="할일">
          {todos.length === 0 ? (
            <EmptyState message="할일이 없습니다" />
          ) : (
            <ul className="flex flex-col">
              {todos.map((text, index) => (
                <li
                  key={`${text}-${index}`}
                  className="flex h-todo items-center gap-2 border-b border-row-divider px-1 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">{text}</span>
                  <button
                    type="button"
                    aria-label={`${text} 삭제`}
                    onClick={() => setTodos((prev) => prev.filter((_, i) => i !== index))}
                    className="shrink-0 text-fg-caption hover:text-destructive"
                  >
                    <X aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* 인라인 추가 행 — `Enter` 로 등록되지만 **「추가」 버튼을 항상 함께 둔다**([10]) */}
          <div className="mt-1 flex items-center gap-2 rounded-control bg-row-add px-2 py-1.5">
            <Input
              aria-label="할일"
              placeholder="할일 입력 후 Enter"
              value={todoDraft}
              onChange={(event) => setTodoDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addTodo();
              }}
              className="h-9 min-w-0 flex-1 border-transparent bg-transparent"
            />
            <Button
              type="button"
              variant="ghost"
              className="h-9 shrink-0 px-3 text-meta"
              onClick={addTodo}
            >
              추가
            </Button>
          </div>
        </Field>

        {/* ⑤ 참고자료 · 연관업무 2열 */}
        <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
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
                <Button type="button" variant="outline" className="h-9 w-full px-3 text-meta">
                  <Plus aria-hidden />
                  자료 첨부
                </Button>
              }
            />
          </Field>
          <Field label="연관업무">
            {relatedIds.length === 0 ? (
              <EmptyState message="연결한 업무가 없습니다" />
            ) : (
              <p className="py-2 text-meta text-fg-meta">{relatedIds.length}건 연결됨</p>
            )}
            <RelationPopover
              // 생성 드로어는 **자기 id 가 없다** — 폼에 입력 중인 값을 정렬 근거로 준다(§4).
              projectId={project?.id ?? null}
              dueDate={due.dueDate}
              selectedIds={relatedIds}
              onChange={setRelatedIds}
              trigger={
                <Button type="button" variant="outline" className="h-9 w-full px-3 text-meta">
                  <Plus aria-hidden />
                  업무 연결
                </Button>
              }
            />
          </Field>
        </div>

        {/* ⑥ 결과자료 · 완료 결과 — **입력 없이 안내만**(U-1 6) */}
        <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
          <Field label="결과자료 · 완료 결과">
            <p className="py-2 text-meta text-fg-caption">완료 처리할 때 등록합니다</p>
          </Field>
          {/* ⑦ 로그 — 안내만 */}
          <Field label="로그">
            <p className="py-2 text-meta text-fg-caption">생성 시점부터 자동으로 기록됩니다</p>
          </Field>
        </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-section text-foreground">{label}</h3>
      {children}
    </section>
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
    <ul className="flex flex-col">
      {links.map((link, index) => (
        <li
          key={`${link.url}-${index}`}
          className="flex h-todo items-center gap-2 border-b border-row-divider px-1 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate text-body text-foreground">
            {link.label ?? link.url}
          </span>
          <button
            type="button"
            aria-label={`${link.label ?? link.url} 제거`}
            onClick={() => onRemove(link)}
            className="shrink-0 text-fg-caption hover:text-destructive"
          >
            <X aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

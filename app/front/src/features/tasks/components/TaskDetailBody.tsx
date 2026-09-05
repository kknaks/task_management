"use client";

/**
 * **드로어와 전체 페이지가 공유하는 유일한 본문**(WORK-004 Internal Interface Contract).
 *
 * > 두 표면의 차이는 **감싸는 껍데기(스크림·헤더·2단 배치)뿐**이고 블록 규격·편집 규칙은
 * > 한 벌만 존재한다(SPEC-003 U-4 「드로어와 페이지가 다른 규격을 갖지 않는다」).
 * > 본문은 **부모를 모른다.**
 *
 * 블록 6 — ① 배경·목표 ② 할일 ③ 참고자료·연관업무 ④ 결과자료·완료 결과 ⑤ 메모 ⑥ 로그.
 * 전체 페이지는 ⑤⑥ 을 우측 단으로 떼어 가므로 `aside` 로 나눠 내보낸다 — **규격이 아니라
 * 배치만** 다르다.
 *
 * ## 자동 저장 실패는 이 블록이 소유한다
 *
 * `saveFailed` 를 **prop 으로 내려** 컨트롤은 테두리만 바꾸고, 캡션·「다시 저장」은
 * **그 행 아래 인라인 자리 하나**(`AutoSaveFailureNotice`)가 그린다
 * (SPEC-002 U-7 구현 규약 · WORK-003 검수 F-1). **내부 state 로 두지 않는다.**
 */

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AttachmentList } from "@/components/shared/AttachmentList";
import { AutoSaveFailureNotice } from "@/components/shared/AutoSaveFailureNotice";
import { AttachmentPopover } from "@/components/shared/AttachmentPopover";
import { EmptyState } from "@/components/shared/EmptyState";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { LogRow } from "@/components/shared/LogRow";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RelationPopover } from "@/features/tasks/components/RelationPopover";
import { useCollectionSave, useTaskFieldSave } from "@/features/tasks/hooks/useTaskFieldSave";
import type { CompletionCardFocus } from "@/features/tasks/hooks/useCompletionCardFocus";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import type { TaskAttachment, TaskDetail } from "@/features/tasks/types";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { formatDueDate, formatTimestamp } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function TaskDetailBody({
  task,
  /** 메모·로그를 우측 단으로 떼어 갈 때 `false`. **규격이 아니라 배치만** 다르다(U-4). */
  includeAside = true,
  completion,
}: {
  task: TaskDetail;
  includeAside?: boolean;
  /** 게이트 유도 진입(U-6) — WORK-005 가 `useCompletionCardFocus()` 로 만들어 넘긴다. */
  completion?: CompletionCardFocus;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TaskMainBlocks task={task} completion={completion} />
      {includeAside ? <TaskAsideBlocks task={task} /> : null}
    </div>
  );
}

/** 블록 ①~④ — 두 표면 모두 본문 자리에 둔다. */
export function TaskMainBlocks({
  task,
  completion,
}: {
  task: TaskDetail;
  completion?: CompletionCardFocus;
}) {
  const mutations = useTaskMutations(task.id);
  /**
   * 헤더와 **같은 규격**을 탄다 — 배선은 `useTaskFieldSave` 한 벌이다.
   * 훅을 블록마다 따로 부르므로 **실패 상태는 섞이지 않는다**(소유자는 블록 — U-7).
   */
  const { save, hasFailed, noticeFor, failureList } = useTaskFieldSave(task);

  /**
   * 첨부·연관 쓰기는 **낙관적이지 않다** — 값이 안 바뀌므로 원복은 저절로 되지만,
   * 그 말이 없으면 **조용히 아무 일도 안 일어난 것처럼 보인다.**
   * 카드가 셋이라 훅도 셋이다 — **소유자는 블록**이고 실패 상태가 섞이지 않는다(U-7).
   */
  const attachmentBusy = mutations.addAttachment.isPending || mutations.removeAttachment.isPending;
  const references = useCollectionSave(task.id, "참고자료", attachmentBusy);
  const deliverables = useCollectionSave(task.id, "결과자료", attachmentBusy);
  const relations = useCollectionSave(
    task.id,
    "연관업무",
    mutations.linkRelations.isPending || mutations.unlinkRelation.isPending,
  );

  /**
   * **없는 연관을 해제하려 했다** — 서버가 404 를 낸다(2026-09-06). 같은 요청을 다시 보내도
   * 또 404 라 「다시 저장」이 답이 아니다. **목록을 갱신해 화면을 맞춘다.**
   */
  const relationGone = (error: unknown): boolean => {
    if (!isApiError(error) || error.code !== API_ERROR_CODE.NOT_FOUND) {
      return false;
    }
    toast.error("이미 해제된 연관업무입니다 · 목록을 새로 고칩니다");
    void mutations.refresh();
    return true;
  };

  return (
    <>
      {/* ① 배경 · 목표 — 2열, 1280~1439 에서 1열로 쌓인다(U-11) */}
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
        <Block title="배경">
          <InlineEditText
            ariaLabel="배경"
            value={task.background ?? ""}
            placeholder="왜 하는가"
            multiline
            saveFailed={hasFailed("background")}
            onSave={(next) => save("background", { background: next || null })}
          />
          {noticeFor("background")}
        </Block>
        <Block title="목표">
          <InlineEditText
            ariaLabel="목표"
            value={task.goal ?? ""}
            placeholder="무엇이 되면 끝인가"
            multiline
            saveFailed={hasFailed("goal")}
            onSave={(next) => save("goal", { goal: next || null })}
          />
          {noticeFor("goal")}
        </Block>
      </div>

      {/* ② 할일 */}
      <Block
        title="할일"
        action={<ProgressBar done={task.todoProgress.done} total={task.todoProgress.total} />}
      >
        <TodoList task={task} />
      </Block>

      {/* ③ 참고자료 · 연관업무 2열 */}
      <div className="grid grid-cols-1 gap-4 wide:grid-cols-2">
        <Block title="참고자료">
          <AttachmentList
            attachments={task.attachments.filter((item) => item.role === "reference")}
            emptyMessage="첨부한 자료가 없습니다"
            onRemove={(attachment: TaskAttachment) =>
              void references.run(`attachment:${attachment.id}`, () =>
                mutations.removeAttachment.mutateAsync(attachment.id),
              )
            }
          />
          <AttachmentPopover
            role="reference"
            // 아직 행이 없다 — 키는 블록 단위고 「다시 저장」이 **같은 입력**을 다시 보낸다.
            onAddLink={(input) =>
              references.run("attachment:new", () => mutations.addAttachment.mutateAsync(input))
            }
            trigger={
              <Button type="button" variant="outline" className="mt-1 h-9 w-full px-3 text-meta">
                <Plus aria-hidden />
                자료 첨부
              </Button>
            }
          />
          {references.notice}
        </Block>

        <Block title="연관업무">
          <RelationList
            task={task}
            onUnlink={(relation) =>
              void relations.run(
                `relation:${relation.id}`,
                () => mutations.unlinkRelation.mutateAsync(relation.id),
                { onStale: relationGone },
              )
            }
            failedIds={task.relations
              .map((relation) => relation.id)
              .filter((id) => relations.hasFailed(`relation:${id}`))}
          />
          <RelationPopover
            // 상세는 `excludeId` 만 준다 — 서버가 그 업무의 project·due 를 쓰고
            // **이미 연결된 것도 함께 제외**한다(§4).
            excludeId={task.id}
            // 무소속 업무면 「이 프로젝트」 칩이 비활성이고 기본이 「전체」다(U-8).
            hasBaseProject={task.project !== null}
            selectedIds={task.relations.map((relation) => relation.id)}
            onChange={(ids) =>
              void relations.run("relation:new", () => mutations.linkRelations.mutateAsync(ids))
            }
            trigger={
              <Button type="button" variant="outline" className="mt-1 h-9 w-full px-3 text-meta">
                <Plus aria-hidden />
                업무 연결
              </Button>
            }
          />
          {relations.notice}
        </Block>
      </div>

      {/* ④ 결과자료 · 완료 결과 — 완료 게이트의 두 축을 **한 카드에 나란히**(U-6) */}
      <CompletionCard
        task={task}
        saveFailed={hasFailed("completionResult")}
        onSave={(next) => save("completionResult", { completionResult: next || null })}
        onAddLink={(input) =>
          deliverables.run("attachment:new", () => mutations.addAttachment.mutateAsync(input))
        }
        onRemove={(attachment) =>
          void deliverables.run(`attachment:${attachment.id}`, () =>
            mutations.removeAttachment.mutateAsync(attachment.id),
          )
        }
        /**
         * 이 카드는 **본체 필드(완료 결과)와 자식 컬렉션(결과자료)을 함께** 든다.
         * 줄은 늘어나도 **자리는 하나**여야 하므로 두 목록을 합쳐 한 번만 그린다(U-7).
         */
        notice={
          <AutoSaveFailureNotice
            busy={mutations.update.isPending || attachmentBusy}
            failures={[...failureList("completionResult"), ...deliverables.failureList()]}
          />
        }
        completion={completion}
      />
    </>
  );
}

/** 블록 ⑤⑥ — 전체 페이지에서는 우측 단으로 간다(U-4). */
export function TaskAsideBlocks({ task }: { task: TaskDetail }) {
  return (
    <>
      <Block title="메모">
        <MemoList task={task} />
      </Block>

      <Block title="로그">
        {task.logs.length === 0 ? (
          <EmptyState message="기록이 없습니다" />
        ) : (
          <ul>
            {task.logs.map((log, index) => (
              <LogRow
                key={log.id}
                text={log.text}
                createdAt={log.createdAt}
                latest={index === 0}
              />
            ))}
          </ul>
        )}
      </Block>
    </>
  );
}

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-section text-foreground">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function TodoList({ task }: { task: TaskDetail }) {
  const mutations = useTaskMutations(task.id);
  const [draft, setDraft] = useState("");
  /**
   * 체크는 **낙관적**이라(§5 표) 실패하면 값이 되돌아간다 — 되돌아가기만 하면 사용자는
   * 체크가 안 눌린 줄 안다. 그래서 U-7 표시를 **이 블록이 소유**한다.
   */
  const saves = useCollectionSave(
    task.id,
    "할일",
    mutations.addTodo.isPending || mutations.updateTodo.isPending || mutations.removeTodo.isPending,
  );

  const add = () => {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    void saves.run("add", async () => {
      await mutations.addTodo.mutateAsync(text);
      setDraft("");
    });
  };

  return (
    <>
      {task.todos.length === 0 ? (
        <EmptyState message="할일이 없습니다" />
      ) : (
        <ul className="flex flex-col">
          {task.todos.map((todo) => (
            <li
              key={todo.id}
              className="group flex h-todo items-center gap-2 border-b border-row-divider px-1 last:border-b-0"
            >
              <Checkbox
                checked={todo.done}
                aria-label={todo.text}
                // 컨트롤은 **테두리만** 바꾼다 — 문구는 블록 아래 인라인 자리가 그린다(U-7)
                className={cn(saves.hasFailed(`todo:${todo.id}`) && "border-destructive")}
                onCheckedChange={(checked) =>
                  void saves.run(`todo:${todo.id}`, () =>
                    mutations.updateTodo.mutateAsync({
                      todoId: todo.id,
                      input: { done: checked === true },
                    }),
                  )
                }
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-body",
                  todo.done ? "text-fg-caption line-through" : "text-foreground",
                )}
              >
                {todo.text}
              </span>
              {todo.dueDate ? (
                <span className="shrink-0 text-caption text-fg-caption">
                  {formatDueDate(todo.dueDate)}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                onClick={() =>
                  void saves.run(`todo:${todo.id}`, () => mutations.removeTodo.mutateAsync(todo.id))
                }
              >
                삭제
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* 인라인 추가 행 — `Enter` 로 등록되지만 **「추가」 버튼을 항상 함께 둔다**([10]) */}
      <div className="mt-1 flex items-center gap-2 rounded-control bg-row-add px-2 py-1.5">
        <Input
          aria-label="할일 추가"
          placeholder="할일 입력 후 Enter"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          className="h-9 min-w-0 flex-1 border-transparent bg-transparent"
        />
        <Button type="button" variant="ghost" className="h-9 shrink-0 px-3 text-meta" onClick={add}>
          추가
        </Button>
      </div>

      {/* U-7 — 롤백된 뒤에도 **말이 남는다**. 자리는 이 블록에 하나 */}
      {saves.notice}
    </>
  );
}

function RelationList({
  task,
  onUnlink,
  failedIds,
}: {
  task: TaskDetail;
  /** 연관 해제(§4 `DELETE /{id}/relations/{otherId}`). 실패해도 값이 안 바뀐다 — 말만 붙는다. */
  onUnlink: (relation: TaskDetail["relations"][number]) => void;
  /** 해제가 실패한 행 — 컨트롤은 **테두리·색만** 바꾸고 문구는 블록 아래 자리가 그린다(U-7). */
  failedIds: readonly number[];
}) {
  if (task.relations.length === 0) {
    return <EmptyState message="연결한 업무가 없습니다" />;
  }
  return (
    <>
      <ul className="flex flex-col">
        {task.relations.map((relation) => (
          <li
            key={relation.id}
            className="group flex h-todo items-center gap-2 border-b border-row-divider px-1 last:border-b-0 hover:bg-row-hover"
          >
            <StatusDot status={relation.status} />
            <span className="min-w-0 flex-1 truncate text-body text-foreground">
              {relation.title}
            </span>
            <span className="shrink-0 text-caption text-fg-caption">
              {STATUS_LABEL[relation.status]}
            </span>
            {/* 참고자료 행의 「제거」와 **같은 규격**이다 — 호버로 드러나는 고스트 버튼 */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive",
                failedIds.includes(relation.id) ? "text-destructive opacity-100" : "text-muted-foreground",
              )}
              onClick={() => onUnlink(relation)}
            >
              해제
            </Button>
          </li>
        ))}
      </ul>
      {/* 상세에는 **최근 5건 + 「전체 n 보기」** 만 노출한다(06-related-tasks) */}
      {task.relationTotal > task.relations.length ? (
        <p className="px-1 pt-1 text-caption text-fg-caption">전체 {task.relationTotal} 보기</p>
      ) : null}
    </>
  );
}

function MemoList({ task }: { task: TaskDetail }) {
  const mutations = useTaskMutations(task.id);
  const [draft, setDraft] = useState("");
  /** 메모 추가도 **낙관적**이라(§5 표) 실패하면 붙었던 행이 사라진다 — 말이 남아야 한다. */
  const saves = useCollectionSave(task.id, "메모", mutations.addMemo.isPending);

  const add = () => {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    void saves.run("add", async () => {
      await mutations.addMemo.mutateAsync(text);
      setDraft("");
    });
  };

  return (
    <>
      {task.memos.length === 0 ? (
        <EmptyState message="메모가 없습니다" />
      ) : (
        // 시간(78) + 내용 2단, 최신순. **작성자 표기 없음**(단일 사용자 — [10])
        <ul className="flex flex-col">
          {task.memos.map((memo) => (
            <li key={memo.id} className="flex gap-3 border-b border-row-divider py-2 last:border-b-0">
              <time
                dateTime={memo.createdAt}
                className="w-[78px] shrink-0 text-caption text-fg-caption"
              >
                {formatTimestamp(memo.createdAt)}
              </time>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-body text-foreground">
                {memo.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex items-center gap-2 rounded-control bg-row-add px-2 py-1.5">
        <Input
          aria-label="메모"
          placeholder="메모를 적습니다"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          className="h-9 min-w-0 flex-1 border-transparent bg-transparent"
        />
        <Button type="button" variant="ghost" className="h-9 shrink-0 px-3 text-meta" onClick={add}>
          등록
        </Button>
      </div>

      {saves.notice}
    </>
  );
}

function CompletionCard({
  task,
  saveFailed,
  onSave,
  onAddLink,
  onRemove,
  notice,
  completion,
}: {
  task: TaskDetail;
  saveFailed: boolean;
  onSave: (next: string) => Promise<void>;
  /** `false` 면 저장에 실패했다는 뜻 — 팝오버가 입력을 그대로 둔다(U-7 「값 유지」). */
  onAddLink: (input: {
    role: "reference" | "deliverable";
    url: string;
    label: string | null;
  }) => Promise<boolean | void>;
  onRemove: (attachment: TaskAttachment) => void;
  /** 이 카드의 자동 저장 실패 자리(U-7). 소유자는 블록이다. */
  notice: ReactNode;
  /** 게이트 유도 진입 — 스크롤 대상·포커스 대상·1.5초 강조를 훅이 들고 온다(U-6). */
  completion?: CompletionCardFocus;
}) {
  const deliverables = task.attachments.filter((item) => item.role === "deliverable");
  /**
   * 완료 게이트의 두 축 — **결과자료 ≥1 또는 완료 결과 작성**(U-6).
   * **판정은 서버**(SPEC-004 §5)이고 여기 칩은 그 조건을 화면에 비춘 것이다.
   */
  const unmet =
    deliverables.length === 0 &&
    (task.completionResult ?? "").trim().length === 0 &&
    task.status !== "done";

  return (
    <section
      id="task-completion-card"
      ref={completion?.cardRef}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-card border bg-card p-4",
        // 게이트 유도 진입에서 **1.5초 동안** 테두리가 primary 다(U-6).
        completion?.highlighted ? "border-primary" : "border-border",
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-section text-foreground">결과자료 · 완료 결과</h3>
        {unmet ? (
          <span className="inline-flex h-5 shrink-0 items-center rounded-chip border border-border bg-background px-2 text-badge text-muted-foreground">
            완료 시 필요
          </span>
        ) : null}
      </header>

      <AttachmentList
        attachments={deliverables}
        emptyMessage="결과자료를 등록하거나 완료 결과를 적으면 완료할 수 있습니다"
        onRemove={onRemove}
      />
      <AttachmentPopover
        role="deliverable"
        onAddLink={onAddLink}
        trigger={
          <Button type="button" variant="outline" className="h-9 w-full px-3 text-meta">
            <Plus aria-hidden />
            결과물 등록
          </Button>
        }
      />

      <InlineEditText
        ariaLabel="완료 결과"
        value={task.completionResult ?? ""}
        placeholder="무엇을 끝냈는지 적습니다"
        multiline
        saveFailed={saveFailed}
        onSave={onSave}
        fieldRef={completion?.inputRef}
      />
      {notice}
    </section>
  );
}

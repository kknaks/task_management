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
import { AttachmentPopover } from "@/components/shared/AttachmentPopover";
import { AutoSaveFailureNotice } from "@/components/shared/AutoSaveFailureNotice";
import { EmptyState } from "@/components/shared/EmptyState";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { LogRow } from "@/components/shared/LogRow";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RelationPopover } from "@/features/tasks/components/RelationPopover";
import { autoSaveErrorToast, taskInlineError } from "@/features/tasks/errors";
import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import { useRowFailures } from "@/features/settings/useRowFailures";
import type { TaskAttachment, TaskDetail, UpdateTaskInput } from "@/features/tasks/types";
import { formatDueDate, formatTimestamp } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** U-7 문구에 들어가는 필드 이름. 토스트와 행 아래 캡션이 **같은 이름**을 쓴다. */
const FIELD_LABEL = {
  background: "배경",
  goal: "목표",
  completionResult: "완료 결과",
} as const;

type EditableField = keyof typeof FIELD_LABEL;

export function TaskDetailBody({
  task,
  /** 메모·로그를 우측 단으로 떼어 갈 때 `false`. **규격이 아니라 배치만** 다르다(U-4). */
  includeAside = true,
}: {
  task: TaskDetail;
  includeAside?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TaskMainBlocks task={task} />
      {includeAside ? <TaskAsideBlocks task={task} /> : null}
    </div>
  );
}

/** 블록 ①~④ — 두 표면 모두 본문 자리에 둔다. */
export function TaskMainBlocks({ task }: { task: TaskDetail }) {
  const mutations = useTaskMutations(task.id);
  const { failures, markFailed, clearFailed, hasFailed } = useRowFailures();

  /**
   * 인라인 텍스트 자동 저장 한 번. **성공하면 그 필드의 실패 표시를 지우고**(해제 조건 ①·②),
   * 실패하면 켠다. **자동 재시도는 없다** — 눌린 만큼만 불린다.
   */
  const save = async (field: EditableField, input: UpdateTaskInput): Promise<void> => {
    try {
      await mutations.update.mutateAsync({ id: task.id, input });
      clearFailed(task.id, field);
    } catch (error) {
      const inline = taskInlineError(error);
      toast.error(inline?.message ?? autoSaveErrorToast(FIELD_LABEL[field]));
      markFailed(task.id, field, { retry: () => save(field, input) });
    }
  };

  const rowFailures = failures[task.id] ?? {};

  /**
   * **소유자는 블록**이다(WP Phase 6) — 캡션·「다시 저장」을 그 필드가 있는 블록 안에 둔다.
   * 전부를 화면 맨 아래 한 자리에 모으면 무엇이 실패했는지 **필드에서 멀어진다.**
   * 자리는 여전히 **블록당 하나**이고 그 블록에서 여러 필드가 실패하면 줄이 늘어난다.
   */
  const noticeFor = (...fields: EditableField[]) => (
    <AutoSaveFailureNotice
      busy={mutations.update.isPending}
      failures={fields
        .filter((field) => field in rowFailures)
        .map((field) => ({
          field,
          label: FIELD_LABEL[field],
          onRetry: () => void rowFailures[field].retry(),
        }))}
    />
  );

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
            saveFailed={hasFailed(task.id, "background")}
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
            saveFailed={hasFailed(task.id, "goal")}
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
              void mutations.removeAttachment.mutateAsync(attachment.id)
            }
          />
          <AttachmentPopover
            role="reference"
            onAddLink={async (input) => {
              await mutations.addAttachment.mutateAsync(input);
            }}
            trigger={
              <Button type="button" variant="outline" className="mt-1 h-9 w-full px-3 text-meta">
                <Plus aria-hidden />
                자료 첨부
              </Button>
            }
          />
        </Block>

        <Block title="연관업무">
          <RelationList task={task} />
          <RelationPopover
            // 상세는 `excludeId` 만 준다 — 서버가 그 업무의 project·due 를 쓰고
            // **이미 연결된 것도 함께 제외**한다(§4).
            excludeId={task.id}
            selectedIds={task.relations.map((relation) => relation.id)}
            onChange={(ids) => void mutations.linkRelations.mutateAsync(ids)}
            trigger={
              <Button type="button" variant="outline" className="mt-1 h-9 w-full px-3 text-meta">
                <Plus aria-hidden />
                업무 연결
              </Button>
            }
          />
        </Block>
      </div>

      {/* ④ 결과자료 · 완료 결과 — 완료 게이트의 두 축을 **한 카드에 나란히**(U-6) */}
      <CompletionCard
        task={task}
        saveFailed={hasFailed(task.id, "completionResult")}
        onSave={(next) => save("completionResult", { completionResult: next || null })}
        onAddLink={async (input) => {
          await mutations.addAttachment.mutateAsync(input);
        }}
        onRemove={(attachment) => void mutations.removeAttachment.mutateAsync(attachment.id)}
        notice={noticeFor("completionResult")}
      />
    </>
  );
}

/** 블록 ⑤⑥ — 전체 페이지에서는 우측 단으로 간다(U-4). */
export function TaskAsideBlocks({ task }: { task: TaskDetail }) {
  const now = new Date();

  return (
    <>
      <Block title="메모">
        <MemoList task={task} now={now} />
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
                now={now}
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

  const add = () => {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    void mutations.addTodo.mutateAsync(text).then(() => setDraft(""));
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
                onCheckedChange={(checked) =>
                  void mutations.updateTodo.mutateAsync({
                    todoId: todo.id,
                    input: { done: checked === true },
                  })
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
                onClick={() => void mutations.removeTodo.mutateAsync(todo.id)}
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
    </>
  );
}

function RelationList({ task }: { task: TaskDetail }) {
  if (task.relations.length === 0) {
    return <EmptyState message="연결한 업무가 없습니다" />;
  }
  return (
    <>
      <ul className="flex flex-col">
        {task.relations.map((relation) => (
          <li key={relation.id} className="flex h-todo items-center gap-2 px-1">
            <StatusDot status={relation.status} />
            <span className="min-w-0 flex-1 truncate text-body text-foreground">
              {relation.title}
            </span>
            <span className="shrink-0 text-caption text-fg-caption">
              {STATUS_LABEL[relation.status]}
            </span>
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

function MemoList({ task, now }: { task: TaskDetail; now: Date }) {
  const mutations = useTaskMutations(task.id);
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    void mutations.addMemo.mutateAsync(text).then(() => setDraft(""));
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
                {formatTimestamp(memo.createdAt, now)}
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
}: {
  task: TaskDetail;
  saveFailed: boolean;
  onSave: (next: string) => Promise<void>;
  onAddLink: (input: {
    role: "reference" | "deliverable";
    url: string;
    label: string | null;
  }) => Promise<void>;
  onRemove: (attachment: TaskAttachment) => void;
  /** 이 카드의 자동 저장 실패 자리(U-7). 소유자는 블록이다. */
  notice: ReactNode;
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
      className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4"
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
      />
      {notice}
    </section>
  );
}

"use client";

/**
 * **확장 페이지 수정 모드의 초안**(REDRAW-03 §1 규칙 2 · §3-3).
 *
 * > **전부 초안이다.** [저장] 이면 한 번에 반영, **[취소] 면 제목도 할일도 전부 버린다.**
 * > 제목만 저장되고 할일은 안 되는 상태를 만들지 마라.
 *
 * 드로어는 **인라인 자동 저장**(포커스 벗어나면 저장)이고 이 훅을 쓰지 않는다 — 두 표면의
 * 편집 방식이 다른 것이 §1 이 정한 계약이다.
 *
 * ## ⚠ 「한 번에」가 한 요청이 아니다 — 남는 위험
 *
 * 서버에 **일괄 저장 표면이 없다.** 본체는 `PATCH /tasks/{id}` 지만 자식은 전부 개별이다:
 * `POST/PATCH/DELETE /todos` · `POST /memos` · `POST/DELETE /attachments` ·
 * `POST/DELETE /relations`. 그래서 [저장] 한 번이 **요청 N개**로 나가고,
 * **중간에 실패하면 앞의 것은 이미 서버에 반영된 상태**가 된다.
 *
 * 클라이언트가 할 수 있는 데까지만 한다:
 * 1. **본체를 먼저** 보낸다 — 제목·설명·유형·프로젝트·일정이 한 요청으로 원자적이다
 * 2. 자식을 **순차 실행**하고 실패하면 **거기서 멈춘다**
 * 3. **성공한 조작은 초안에서 지운다** — 재시도가 같은 항목을 두 번 만들지 않는다
 * 4. **모드를 벗어나지 않는다.** 초안을 유지하고 실패를 표시한다
 * 5. **롤백하지 않는다** — 되돌리는 요청이 또 실패할 수 있고 그게 더 나쁘다
 *
 * **진짜 원자성이 필요하면 서버에 일괄 저장 엔드포인트가 있어야 한다.** 백엔드 몫이라
 * 여기서 흉내내지 않는다(REDRAW-03 §3-3 「서버 변경이 필요하면 물어라」 → 보고에 적었다).
 *
 * ## 메모는 추가만 있다
 *
 * 삭제 표면이 서버에 없다(`POST /memos` 뿐). SPEC-003 L208 도 「메모의 수정·삭제는 v1 에
 * 없다」이고 시안 메모 블록에도 삭제 UI 가 없다 — **삭제를 만들지 않는다**(코디 확인).
 */

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { useTaskMutations } from "@/features/tasks/hooks/useTaskMutations";
import { taskInlineError } from "@/features/tasks/errors";
import type { TaskDetail, UpdateTaskInput } from "@/features/tasks/types";

/** 저장 때 순차 실행할 자식 조작 하나. */
type ChildOp =
  | { kind: "todo:add"; text: string }
  | { kind: "todo:update"; id: number; input: { text?: string; done?: boolean } }
  | { kind: "todo:remove"; id: number }
  | { kind: "memo:add"; text: string }
  | { kind: "attachment:remove"; id: number }
  | { kind: "relation:unlink"; id: number };

/** 본체(한 요청으로 나가는 필드들). */
interface BodyDraft {
  title: string;
  description: string;
  completionResult: string;
  workTypeId: number;
  projectId: number | null;
  startDate: string | null;
  dueDate: string | null;
}

function bodyOf(task: TaskDetail): BodyDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    completionResult: task.completionResult ?? "",
    workTypeId: task.workType.id,
    projectId: task.project?.id ?? null,
    startDate: task.startDate,
    dueDate: task.dueDate,
  };
}

export interface TaskEditDraft {
  editing: boolean;
  saving: boolean;
  /** 마지막 저장에서 실패한 지점 — 모드를 벗어나지 않고 여기에 표시한다. */
  error: string | null;
  body: BodyDraft;
  setBody: (patch: Partial<BodyDraft>) => void;
  /** 화면에 그릴 할일 — 초안 조작이 얹힌 결과다(서버 값 + 추가/삭제/수정). */
  todos: { id: number | null; key: string; text: string; done: boolean; dueDate: string | null }[];
  addTodo: (text: string) => void;
  updateTodo: (key: string, patch: { text?: string; done?: boolean }) => void;
  removeTodo: (key: string) => void;
  /** 초안 메모(아직 안 나간 것) — 서버 메모 위에 얹어 보여준다. */
  pendingMemos: string[];
  addMemo: (text: string) => void;
  removedAttachmentIds: number[];
  removeAttachment: (id: number) => void;
  removedRelationIds: number[];
  unlinkRelation: (id: number) => void;
  /** 바꾼 것이 하나라도 있나 — [저장] 활성 판정. */
  dirty: boolean;
  start: () => void;
  cancel: () => void;
  save: () => void;
}

export function useTaskEditDraft(task: TaskDetail): TaskEditDraft {
  const mutations = useTaskMutations(task.id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBodyState] = useState<BodyDraft>(() => bodyOf(task));
  const [ops, setOps] = useState<ChildOp[]>([]);
  const setBody = useCallback((patch: Partial<BodyDraft>) => {
    setBodyState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 서버 값 위에 초안 조작을 얹은 **화면용 할일**. */
  const todos = useMemo(() => {
    const removed = new Set(
      ops.flatMap((op) => (op.kind === "todo:remove" ? [op.id] : [])),
    );
    const patches = new Map<number, { text?: string; done?: boolean }>();
    for (const op of ops) {
      if (op.kind === "todo:update") {
        patches.set(op.id, { ...patches.get(op.id), ...op.input });
      }
    }
    const existing = task.todos
      .filter((todo) => !removed.has(todo.id))
      .map((todo) => {
        const patch = patches.get(todo.id) ?? {};
        return {
          id: todo.id,
          key: `id:${todo.id}`,
          text: patch.text ?? todo.text,
          done: patch.done ?? todo.done,
          dueDate: todo.dueDate,
        };
      });
    const added = ops.flatMap((op, index) =>
      op.kind === "todo:add"
        ? [{ id: null, key: `new:${index}`, text: op.text, done: false, dueDate: null }]
        : [],
    );
    return [...existing, ...added];
  }, [ops, task.todos]);

  const pendingMemos = useMemo(
    () => ops.flatMap((op) => (op.kind === "memo:add" ? [op.text] : [])),
    [ops],
  );
  const removedAttachmentIds = useMemo(
    () => ops.flatMap((op) => (op.kind === "attachment:remove" ? [op.id] : [])),
    [ops],
  );
  const removedRelationIds = useMemo(
    () => ops.flatMap((op) => (op.kind === "relation:unlink" ? [op.id] : [])),
    [ops],
  );

  const bodyChanged = useMemo(() => {
    const base = bodyOf(task);
    return (Object.keys(base) as (keyof BodyDraft)[]).some((key) => base[key] !== body[key]);
  }, [body, task]);

  const dirty = bodyChanged || ops.length > 0;

  const start = useCallback(() => {
    setBodyState(bodyOf(task));
    setOps([]);
    setError(null);
    setEditing(true);
  }, [task]);

  /** **[취소] 는 전부 버린다** — 부분 저장이 없다(§1 규칙 2). */
  const cancel = useCallback(() => {
    setBodyState(bodyOf(task));
    setOps([]);
    setError(null);
    setEditing(false);
  }, [task]);

  const save = useCallback(() => {
    if (saving) {
      return;
    }
    void (async () => {
      setSaving(true);
      setError(null);
      try {
        // ① 본체 — 한 요청이라 여기까지는 원자적이다
        if (bodyChanged) {
          const base = bodyOf(task);
          const input: Record<string, unknown> = {};
          if (body.title !== base.title) input.title = body.title.trim();
          if (body.description !== base.description)
            input.description = body.description.trim() || null;
          if (body.completionResult !== base.completionResult)
            input.completionResult = body.completionResult.trim() || null;
          if (body.workTypeId !== base.workTypeId) input.workTypeId = body.workTypeId;
          if (body.projectId !== base.projectId) input.projectId = body.projectId;
          if (body.startDate !== base.startDate) input.startDate = body.startDate;
          if (body.dueDate !== base.dueDate) input.dueDate = body.dueDate;
          await mutations.update.mutateAsync({ id: task.id, input: input as UpdateTaskInput });
        }

        // ② 자식 — **순차**. 실패하면 거기서 멈추고 성공분은 초안에서 빠진다
        let remaining = [...ops];
        for (const op of ops) {
          switch (op.kind) {
            case "todo:add":
              await mutations.addTodo.mutateAsync(op.text);
              break;
            case "todo:update":
              await mutations.updateTodo.mutateAsync({ todoId: op.id, input: op.input });
              break;
            case "todo:remove":
              await mutations.removeTodo.mutateAsync(op.id);
              break;
            case "memo:add":
              await mutations.addMemo.mutateAsync(op.text);
              break;
            case "attachment:remove":
              await mutations.removeAttachment.mutateAsync(op.id);
              break;
            case "relation:unlink":
              await mutations.unlinkRelation.mutateAsync(op.id);
              break;
          }
          remaining = remaining.slice(1);
          setOps(remaining);
        }

        setOps([]);
        setEditing(false);
      } catch (caught) {
        /**
         * **모드를 벗어나지 않는다.** 초안이 남아 있으므로 고쳐서 다시 저장할 수 있고,
         * 이미 나간 요청은 초안에서 빠졌으니 **재시도가 중복을 만들지 않는다.**
         */
        const message = taskInlineError(caught)?.message ?? "저장하지 못했습니다";
        setError(message);
        toast.error(message);
      } finally {
        setSaving(false);
      }
    })();
  }, [body, bodyChanged, mutations, ops, saving, task]);

  return {
    editing,
    saving,
    error,
    body,
    setBody,
    todos,
    addTodo: (text) => {
      const trimmed = text.trim();
      if (trimmed) {
        setOps((prev) => [...prev, { kind: "todo:add", text: trimmed }]);
      }
    },
    updateTodo: (key, patch) => {
      if (key.startsWith("id:")) {
        const id = Number(key.slice(3));
        setOps((prev) => [...prev, { kind: "todo:update", id, input: patch }]);
        return;
      }
      // 아직 안 나간 항목은 **초안 안에서** 고친다 — 서버에 보낼 것이 하나로 유지된다
      const index = Number(key.slice(4));
      setOps((prev) =>
        prev.map((op, i) =>
          i === index && op.kind === "todo:add" && patch.text !== undefined
            ? { ...op, text: patch.text }
            : op,
        ),
      );
    },
    removeTodo: (key) => {
      if (key.startsWith("id:")) {
        setOps((prev) => [...prev, { kind: "todo:remove", id: Number(key.slice(3)) }]);
        return;
      }
      const index = Number(key.slice(4));
      setOps((prev) => prev.filter((_, i) => i !== index));
    },
    pendingMemos,
    addMemo: (text) => {
      const trimmed = text.trim();
      if (trimmed) {
        setOps((prev) => [...prev, { kind: "memo:add", text: trimmed }]);
      }
    },
    removedAttachmentIds,
    removeAttachment: (id) => setOps((prev) => [...prev, { kind: "attachment:remove", id }]),
    removedRelationIds,
    unlinkRelation: (id) => setOps((prev) => [...prev, { kind: "relation:unlink", id }]),
    dirty,
    start,
    cancel,
    save,
  };
}

export type { BodyDraft };

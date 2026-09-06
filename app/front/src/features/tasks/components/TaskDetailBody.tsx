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
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { isEnterSubmit } from "@/lib/keyboard";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentList } from "@/components/shared/AttachmentList";
import { BlockRow, DetailBlock, type BlockSize } from "@/components/shared/DetailBlock";
import { AddRowButton, DashedAddButton, ItemRow, ItemRows } from "@/components/shared/ItemRow";
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
import type { TaskEditDraft } from "@/features/tasks/hooks/useTaskEditDraft";
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

/**
 * **확장 페이지의 2단 본문**(시안 1574·1657줄 · REDRAW-03 §3-1).
 *
 * 드로어와 **블록 배치가 다르다** — 폭이 달라서다:
 * - **좌 1080** — 설명 · 할일 · 메모
 * - **우 528** — 참고자료 · 결과자료 · 연관업무 · 로그
 *
 * **블록 내부 규격은 같다**(`DetailBlock` 하나). 읽기 모드는 값을 텍스트로만 보여주고,
 * 수정 모드는 초안(`draft`)을 입력으로 받는다(§3-2·§3-3).
 */
export function TaskPageBlocks({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageDescription task={task} draft={draft} />
        <PageTodos task={task} draft={draft} />
        <PageMemos task={task} draft={draft} />
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-6 desk:w-[400px] wide:w-detail-aside">
        <PageReferences task={task} draft={draft} />
        <PageDeliverables task={task} draft={draft} />
        <PageRelations task={task} draft={draft} />
        <Block title="로그" hint="자동 기록" size="page">
          <LogRows task={task} />
        </Block>
      </aside>
    </>
  );
}

/** 로그 행 — h40 · dot 7×7(최신만 primary) · 우측 시각 12px(시안 2010줄). */
function LogRows({ task }: { task: TaskDetail }) {
  if (task.logs.length === 0) {
    return <p className="px-4 py-6 text-center text-caption text-fg-caption">기록이 없습니다</p>;
  }
  return (
    <ul>
      {task.logs.map((log, index) => (
        <LogRow key={log.id} text={log.text} createdAt={log.createdAt} latest={index === 0} />
      ))}
    </ul>
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
      {/**
        * ① 설명 — 시안은 **라벨(좌) + 값(우) 가로 배치**다(1930~1936줄).
        * 「배경 / 목표」 두 행이 `description` 하나로 합쳐졌으므로 **한 행**이 된다.
        * 라벨 위 · 입력 아래로 쌓지 않는다(§2-2 ①).
        */}
      <section className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-divider bg-card">
        <div className="flex gap-4 px-4 py-3">
          <span className="w-12 shrink-0 pt-0.5 text-caption font-bold text-fg-meta">설명</span>
          <div className="min-w-0 flex-1">
            <InlineEditText
              ariaLabel="설명"
              value={task.description ?? ""}
              placeholder="이 업무에 대한 설명"
              multiline
              saveFailed={hasFailed("description")}
              onSave={(next) => save("description", { description: next || null })}
            />
            {noticeFor("description")}
          </div>
        </div>
      </section>

      {/**
        * ② 할일 — **진행률이 제목 옆에 붙는다**(시안 1932줄). 전에는 우측 끝이었다.
        * `2 / 5` 12px `#757575` + 바 h6·r3(트랙 `#F1F2F5` · 필 `#7181F8`).
        */}
      <Block
        title="할일"
        lead={
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="shrink-0 text-caption text-fg-meta">
              {task.todoProgress.done} / {task.todoProgress.total}
            </span>
            <span className="h-1.5 max-w-[200px] flex-1 overflow-hidden rounded-[3px] bg-row-divider">
              <span
                className="block h-full bg-primary"
                style={{
                  width: `${task.todoProgress.total === 0 ? 0 : Math.round((task.todoProgress.done / task.todoProgress.total) * 100)}%`,
                }}
              />
            </span>
          </span>
        }
      >
        <TodoList task={task} />
      </Block>

      {/**
        * ③ 참고자료 · 연관업무 2열 — **높이는 각자 내용만큼**이다(시안 L1948: `flex; gap:16` +
        * 각 카드 `flex:1`). `items-start` 가 없으면 grid 기본 `stretch` 라 **짧은 카드가 긴 카드
        * 높이로 늘어나고**, 늘어난 부분이 「+ 자료 첨부」 아래 빈 여백으로 남는다(REDRAW-08 C-2).
        */}
      <div className="grid grid-cols-1 items-start gap-4 wide:grid-cols-2">
        <Block title="참고자료" hint={task.attachments.filter((a) => a.role === "reference").length}>
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
            /* 추가는 **마지막 행**이다 — 점선 박스가 아니다(시안 1961줄) */
            /**
             * **드로어는 「자료 첨부」다**(시안 L1962) — 확장 페이지의 「자료함에서 첨부」와
             * 문구가 다르다(L1661). 첨부는 **자료함 문서와 URL 링크 두 갈래**인데
             * 「자료함에서」라고만 쓰면 링크 갈래가 없어진 것처럼 읽힌다(REDRAW-07 B-3).
             */
            trigger={
              <AddRowButton>
                <Plus aria-hidden />
                자료 첨부
              </AddRowButton>
            }
          />
          {references.notice}
        </Block>

        <Block title="연관업무" hint={task.relations.length}>
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
              <AddRowButton>
                <Plus aria-hidden />
                업무 연결
              </AddRowButton>
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
      <Block title="메모" hint={`${task.memos.length} · 최신순`}>
        <MemoList task={task} />
      </Block>

      <Block title="로그" hint="자동 기록">
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

/**
 * 블록 껍데기는 **`DetailBlock` 하나**다(REDRAW-03 §2-2) — 드로어·확장이 갈릴 수 없다.
 * 여기서는 크기(`size`)만 넘긴다.
 */
function Block({
  title,
  hint,
  lead,
  size = "drawer",
  children,
}: {
  title: string;
  hint?: ReactNode;
  lead?: ReactNode;
  size?: BlockSize;
  children: ReactNode;
}) {
  return (
    <DetailBlock title={title} hint={hint} lead={lead} size={size}>
      {children}
    </DetailBlock>
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
            /* 항목 행 — h42 · `gap 11` · `padding 0 16` · 구분선 `#F1F2F5`(시안 1937줄) */
            <li
              key={todo.id}
              className="group flex h-[42px] items-center gap-[11px] border-b border-row-divider px-4 text-meta"
            >
              <Checkbox
                checked={todo.done}
                aria-label={todo.text}
                // 16px r4 — 완료면 `#7181F8` 채움 + 흰 체크(시안 1938줄)
                // 컨트롤은 **테두리만** 바꾼다 — 문구는 블록 아래 인라인 자리가 그린다(U-7)
                className={cn(
                  "h-4 w-4 shrink-0 rounded-chip border-[1.5px] border-border",
                  saves.hasFailed(`todo:${todo.id}`) && "border-destructive",
                )}
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
                  "min-w-0 flex-1 truncate",
                  todo.done ? "text-fg-caption line-through" : "text-foreground",
                )}
              >
                {todo.text}
              </span>
              {/* 우측 날짜 — 12px `#9EA2AE`(시안 1939줄) */}
              {todo.dueDate ? (
                <span className="shrink-0 text-caption text-fg-caption">
                  {formatDueDate(todo.dueDate)}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
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

      {/**
        * 입력 행 — **맨 아래 고정** · h44 · 배경 `#FAFBFC` · **점선 체크박스** ·
        * 우측 「추가」 h28 r6 `#F1F2FE`/`#4B52A8`(시안 1945줄).
        * `Enter` 로 등록되지만 **버튼을 항상 함께 둔다**([10] 단축키는 보조).
        */}
      <div className="flex h-11 shrink-0 items-center gap-[11px] bg-row-hover pl-4 pr-2.5">
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 rounded-chip border-[1.5px] border-dashed border-border"
        />
        <Input
          aria-label="할일 추가"
          placeholder="할일 입력 후 Enter"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isEnterSubmit(event)) add();
          }}
          className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-meta shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={add}
          className="flex h-7 shrink-0 items-center rounded-md bg-secondary px-[11px] text-caption font-semibold text-secondary-foreground hover:opacity-90"
        >
          추가
        </button>
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
      {/* 행 카드 — 흰 배경 · border `#D9D9D9` · r8 · h40(시안 646~654줄 · G-0b) */}
      <ItemRows>
        {task.relations.map((relation) => (
          <ItemRow
            key={relation.id}
            /* 좌측 dot 은 **상태 색**이다 — 시안 648·652줄이 `#33AAFF`·`#7181F8` 을 쓴다 */
            leading={<StatusDot status={relation.status} />}
            className={cn(failedIds.includes(relation.id) && "border-destructive")}
            trailing={
              <>
                <span className="shrink-0 text-caption text-fg-caption">
                  {STATUS_LABEL[relation.status]}
                </span>
                {/* 참고자료 행의 「제거」와 **같은 규격**이다 — 호버로 드러나는 고스트 버튼 */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 shrink-0 px-2 opacity-0 group-hover:opacity-100 hover:text-destructive",
                    failedIds.includes(relation.id)
                      ? "text-destructive opacity-100"
                      : "text-muted-foreground",
                  )}
                  onClick={() => onUnlink(relation)}
                >
                  해제
                </Button>
              </>
            }
          >
            {relation.title}
          </ItemRow>
        ))}
      </ItemRows>
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
            /* 항목 — `padding 13px 16px` · `gap 14` · 시각 폭 78 · 내용 13px lh1.65(시안 1998줄) */
            <li
              key={memo.id}
              className="flex gap-3.5 border-b border-row-divider px-4 py-[13px] last:border-b-0"
            >
              <time
                dateTime={memo.createdAt}
                className="w-[78px] shrink-0 pt-0.5 text-caption text-fg-caption"
              >
                {formatTimestamp(memo.createdAt)}
              </time>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-meta leading-[1.65] text-fg-muted">
                {memo.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 입력 행 — h44 · 배경 `#FAFBFC` · 「등록」 h28 r6(시안 2002줄) */}
      <div className="flex h-11 shrink-0 items-center gap-2.5 bg-row-hover pl-4 pr-2.5">
        <Input
          aria-label="메모"
          placeholder="메모 입력"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isEnterSubmit(event)) add();
          }}
          className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-meta shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={add}
          className="flex h-7 shrink-0 items-center rounded-md bg-secondary px-3 text-caption font-semibold text-secondary-foreground hover:opacity-90"
        >
          등록
        </button>
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
  return (
    <section
      id="task-completion-card"
      ref={completion?.cardRef}
      className={cn(
        "flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card",
        // 게이트 유도 진입에서 **1.5초 동안** 테두리가 primary 다(U-6).
        completion?.highlighted ? "border-primary" : "border-divider",
      )}
    >
      <header className="flex h-[42px] shrink-0 items-center gap-3 border-b border-divider px-4">
        {/* 카드 제목·배지 문구는 **시안**을 쓴다(§2-2 ④) */}
        <h3 className="text-meta font-bold text-foreground">결과자료</h3>
        <span className="ml-auto shrink-0 text-caption text-fg-caption">완료 시 필수</span>
      </header>

      {/* 본문 `padding 12px 16px`(시안 1987줄) */}
      <div className="flex flex-col gap-2.5 px-4 py-3">
        {deliverables.length > 0 ? (
          <AttachmentList attachments={deliverables} emptyMessage="" onRemove={onRemove} />
        ) : null}
        <AttachmentPopover
          role="deliverable"
          onAddLink={onAddLink}
          /* **점선 등록 버튼 h44**(시안 1988줄) — 이 카드에만 점선을 쓴다 */
          trigger={
            <DashedAddButton className="h-11">
              <Plus aria-hidden />
              결과물 등록
            </DashedAddButton>
          }
        />

        {/**
          * ⚠ **완료 결과 텍스트 에어리어는 시안에 없다**(2026-09-06 사용자 확정 · §2-2 ④).
          * 완료 게이트가 「결과자료 ≥1 **또는** 완료 결과」인데 시안은 전자만 그렸다 —
          * 적을 데가 없으면 **파일이 없는 사용자는 완료를 못 하는 줄 안다.**
          */}
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
      </div>
    </section>
  );
}


/* ── 확장 페이지 블록 — 읽기/수정 두 모드 ───────────────────────────────
 *
 * **읽기 모드는 값을 텍스트로만** 보여준다(§3-2). 입력칸도 인라인 편집도 없다.
 * **수정 모드는 전부 초안**이고 [저장] 전에는 서버로 아무것도 안 나간다(§1 규칙 2).
 */

/** 설명 — 라벨(폭 56) + 값 가로 배치. `padding 18px 20px` · `gap 20`(시안 1576줄). */
function PageDescription({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  return (
    <section className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-divider bg-card">
      <div className="flex gap-5 px-5 py-[18px]">
        <span className="w-14 shrink-0 pt-0.5 text-caption font-bold text-fg-meta">설명</span>
        {draft.editing ? (
          <Textarea
            aria-label="설명"
            value={draft.body.description}
            onChange={(event) => draft.setBody({ description: event.target.value })}
            placeholder="이 업무에 대한 설명"
            className="min-h-[96px] flex-1 resize-none text-control-label leading-[1.75]"
          />
        ) : (
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-control-label leading-[1.75] text-fg-muted">
            {task.description || <span className="text-fg-caption">설명이 없습니다</span>}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * 할일 — 읽기 모드에서는 **체크박스를 누를 수 없다**(§3-2). 바꾸려면 수정 모드로 간다.
 * 수정 모드에서는 텍스트 수정·삭제·추가·체크가 전부 **초안**이다.
 */
function PageTodos({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  const [text, setText] = useState("");
  const rows = draft.editing ? draft.todos : task.todos.map((t) => ({ ...t, key: `id:${t.id}` }));
  const done = rows.filter((row) => row.done).length;

  return (
    <Block
      title="할일"
      size="page"
      lead={
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 text-caption text-fg-meta">
            {done} / {rows.length}
          </span>
          <span className="h-1.5 max-w-[280px] flex-1 overflow-hidden rounded-[3px] bg-row-divider">
            <span
              className="block h-full bg-primary"
              style={{ width: `${rows.length === 0 ? 0 : Math.round((done / rows.length) * 100)}%` }}
            />
          </span>
        </span>
      }
    >
      {rows.map((row) => (
        <BlockRow key={row.key} size="page" className="group">
          <Checkbox
            checked={row.done}
            aria-label={row.text}
            // **읽기 모드에서는 못 누른다** — 체크 상태만 보인다(§3-2)
            disabled={!draft.editing}
            onCheckedChange={(checked) => draft.updateTodo(row.key, { done: checked === true })}
            className="h-[17px] w-[17px] shrink-0 rounded-chip border-[1.5px] border-border disabled:opacity-100"
          />
          {draft.editing ? (
            <input
              aria-label={`${row.text} 수정`}
              value={row.text}
              onChange={(event) => draft.updateTodo(row.key, { text: event.target.value })}
              className="min-w-0 flex-1 bg-transparent text-control-label text-foreground focus-visible:outline-none"
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-control-label",
                row.done ? "text-fg-caption line-through" : "text-foreground",
              )}
            >
              {row.text}
            </span>
          )}
          {row.dueDate ? (
            <span className="shrink-0 text-caption text-fg-caption">
              {formatDueDate(row.dueDate)}
            </span>
          ) : null}
          {draft.editing ? (
            <button
              type="button"
              aria-label={`${row.text} 삭제`}
              onClick={() => draft.removeTodo(row.key)}
              className="shrink-0 text-fg-caption opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </BlockRow>
      ))}

      {draft.editing ? (
        <div className="flex h-12 shrink-0 items-center gap-3 bg-row-hover pl-5 pr-3">
          <span
            aria-hidden
            className="h-[17px] w-[17px] shrink-0 rounded-chip border-[1.5px] border-dashed border-border"
          />
          <Input
            aria-label="할일 추가"
            placeholder="할일 입력 후 Enter"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (isEnterSubmit(event)) {
                draft.addTodo(text);
                setText("");
              }
            }}
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-control-label shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={() => {
              draft.addTodo(text);
              setText("");
            }}
            className="flex h-8 shrink-0 items-center rounded-md bg-secondary px-3.5 text-caption font-semibold text-secondary-foreground hover:opacity-90"
          >
            추가
          </button>
        </div>
      ) : null}
    </Block>
  );
}

/** 메모 — **추가만 있다.** 삭제 표면이 서버에 없다(SPEC-003 L208 · 코디 확인). */
function PageMemos({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  const [text, setText] = useState("");
  const total = task.memos.length + draft.pendingMemos.length;

  return (
    <Block title="메모" hint={`${total} · 최신순`} size="page">
      {draft.pendingMemos.map((memo, index) => (
        <div
          key={`pending-${index}`}
          className="flex gap-3.5 border-b border-row-divider px-[18px] py-[13px]"
        >
          <span className="w-[78px] shrink-0 pt-0.5 text-caption text-fg-caption">저장 전</span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-meta leading-[1.65] text-fg-muted">
            {memo}
          </span>
        </div>
      ))}
      {task.memos.map((memo) => (
        <div key={memo.id} className="flex gap-3.5 border-b border-row-divider px-[18px] py-[13px]">
          <time
            dateTime={memo.createdAt}
            className="w-[78px] shrink-0 pt-0.5 text-caption text-fg-caption"
          >
            {formatTimestamp(memo.createdAt)}
          </time>
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-meta leading-[1.65] text-fg-muted">
            {memo.text}
          </span>
        </div>
      ))}
      {total === 0 && !draft.editing ? (
        <p className="px-[18px] py-6 text-center text-caption text-fg-caption">메모가 없습니다</p>
      ) : null}

      {draft.editing ? (
        <div className="flex h-12 shrink-0 items-center gap-2.5 bg-row-hover pl-[18px] pr-3">
          <Input
            aria-label="메모"
            placeholder="메모 입력"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (isEnterSubmit(event)) {
                draft.addMemo(text);
                setText("");
              }
            }}
            className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-0 text-control-label shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={() => {
              draft.addMemo(text);
              setText("");
            }}
            className="flex h-8 shrink-0 items-center rounded-md bg-secondary px-3.5 text-caption font-semibold text-secondary-foreground hover:opacity-90"
          >
            등록
          </button>
        </div>
      ) : null}
    </Block>
  );
}

/** 참고자료 — 헤더 우측이 **개수가 아니라 「자료함에서 첨부」**다(시안 1661줄). */
function PageReferences({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  const { addAttachment } = useTaskMutations(task.id);
  const items = task.attachments
    .filter((item) => item.role === "reference")
    .filter((item) => !draft.removedAttachmentIds.includes(item.id));

  return (
    <Block title="참고자료" hint="자료함에서 첨부" size="page">
      {items.map((item) => (
        <BlockRow key={item.id} size="page" className="group">
          <FileTile attachment={item} size="page" />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <span className="shrink-0 text-caption text-fg-caption">{attachmentMeta(item)}</span>
          {draft.editing ? (
            <button
              type="button"
              aria-label={`${item.name} 제거`}
              onClick={() => draft.removeAttachment(item.id)}
              className="shrink-0 text-fg-caption opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </BlockRow>
      ))}
      {items.length === 0 && !draft.editing ? (
        <p className="px-[18px] py-6 text-center text-caption text-fg-caption">
          첨부한 자료가 없습니다
        </p>
      ) : null}

      {/**
        * **수정 모드에서만 추가 행이 생긴다**(REDRAW-08 D — 코디 확정).
        *
        * 읽기 모드는 **시안 그대로**다 — 헤더 우측 「자료함에서 첨부」는 **힌트 텍스트**이고
        * 누를 수 없다(시안 L1661). 확장 시안에는 추가 행이 없다.
        *
        * 수정 모드는 **시안에 없는 화면**이고(2026-09-06 사용자 확정으로 우리가 만든 것),
        * §3-3 이 「레이아웃은 읽기와 같고 값 자리가 입력으로 바뀐다」로 정했다 —
        * 추가 행이 그 「입력으로 바뀌는」 자리다. **기준은 시안이 아니라 드로어**다.
        */}
      {draft.editing ? (
        <AttachmentPopover
          role="reference"
          onAddLink={(input) => addAttachment.mutateAsync(input).then(() => true)}
          trigger={
            <AddRowButton className="px-[18px]">
              <Plus aria-hidden />
              자료 첨부
            </AddRowButton>
          }
        />
      ) : null}
    </Block>
  );
}

/** 결과자료 — 본문 `padding 18` · 점선 등록 h52(시안 1687줄). */
function PageDeliverables({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  const items = task.attachments
    .filter((item) => item.role === "deliverable")
    .filter((item) => !draft.removedAttachmentIds.includes(item.id));

  return (
    <Block title="결과자료" hint="완료 시 필수" size="page">
      <div className="flex flex-col gap-2.5 p-[18px]">
        {items.map((item) => (
          <span
            key={item.id}
            className="flex h-11 items-center gap-2.5 rounded-control border border-border px-3 text-meta"
          >
            <FileTile attachment={item} size="page" />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </span>
        ))}
        {draft.editing ? (
          <Textarea
            aria-label="완료 결과"
            value={draft.body.completionResult}
            onChange={(event) => draft.setBody({ completionResult: event.target.value })}
            placeholder="무엇을 끝냈는지 적습니다"
            className="min-h-[80px] resize-none text-control-label"
          />
        ) : task.completionResult ? (
          <p className="whitespace-pre-wrap text-control-label leading-[1.75] text-fg-muted">
            {task.completionResult}
          </p>
        ) : (
          <p className="text-caption text-fg-caption">완료 처리 시 등록</p>
        )}
      </div>
    </Block>
  );
}

/** 연관업무 — 항목 우측에 **상태 텍스트**가 붙는다(시안 1700줄대). */
function PageRelations({ task, draft }: { task: TaskDetail; draft: TaskEditDraft }) {
  const { linkRelations } = useTaskMutations(task.id);
  const items = task.relations.filter((item) => !draft.removedRelationIds.includes(item.id));

  return (
    <Block title="연관업무" hint={items.length} size="page">
      {items.map((relation) => (
        <BlockRow key={relation.id} size="page" className="group">
          <StatusDot status={relation.status} />
          <span className="min-w-0 flex-1 truncate">{relation.title}</span>
          <span className="shrink-0 text-caption text-fg-caption">
            {STATUS_LABEL[relation.status]}
          </span>
          {draft.editing ? (
            <button
              type="button"
              aria-label={`${relation.title} 연결 해제`}
              onClick={() => draft.unlinkRelation(relation.id)}
              className="shrink-0 text-fg-caption opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </BlockRow>
      ))}
      {items.length === 0 && !draft.editing ? (
        <p className="px-[18px] py-6 text-center text-caption text-fg-caption">
          연결한 업무가 없습니다
        </p>
      ) : null}

      {/* 수정 모드에서만 — 문구는 **드로어와 같은 「업무 연결」**이다(위 주석 참조) */}
      {draft.editing ? (
        <RelationPopover
          excludeId={task.id}
          hasBaseProject={task.project !== null}
          selectedIds={items.map((relation) => relation.id)}
          onChange={(ids) => void linkRelations.mutateAsync(ids)}
          trigger={
            <AddRowButton className="px-[18px]">
              <Plus aria-hidden />
              업무 연결
            </AddRowButton>
          }
        />
      ) : null}
    </Block>
  );
}

/** 파일 유형 타일 — 드로어 22×22 r5 · 확장 26×26 r6, 글자 10/700(시안 1954·1667줄). */
function FileTile({ attachment, size }: { attachment: TaskAttachment; size: BlockSize }) {
  const ext = attachment.kind === "link" ? "URL" : extensionOf(attachment.name);
  return (
    <span
      aria-hidden
      data-color-token={ext === "XLS" ? "indigo" : ext === "DOC" ? "steel" : "graphite"}
      className={cn(
        "flex shrink-0 items-center justify-center bg-palette-bg text-[10px] font-bold text-palette-fg",
        size === "drawer" ? "h-[22px] w-[22px] rounded-[5px]" : "h-[26px] w-[26px] rounded-md",
      )}
    >
      {ext}
    </span>
  );
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "DOC";
  const ext = name.slice(dot + 1).toUpperCase();
  if (ext.startsWith("XLS")) return "XLS";
  if (ext.startsWith("DOC") || ext === "MD") return "DOC";
  return ext.slice(0, 3);
}

/** 항목 우측 보조 — 크기·종류(시안 1668줄). 크기는 계약에 없어 **종류만** 적는다. */
function attachmentMeta(attachment: TaskAttachment): string {
  return attachment.kind === "link" ? "링크" : "문서";
}

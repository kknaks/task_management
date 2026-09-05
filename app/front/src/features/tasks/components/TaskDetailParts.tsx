"use client";

/**
 * 상세 표면 둘이 함께 쓰는 조각 — 스켈레톤 · **편집 가능한 헤더**(SPEC-003 U-2·U-3·U-4).
 *
 * ## 헤더는 표시 전용이 아니다
 *
 * U-2 의 인라인 편집 대상은 **제목**·배경·목표·완료 결과 넷이고, §4 PATCH 는 `workTypeId`·
 * `projectId`·기한도 받는다. 전에는 헤더가 배지·칩·기한을 **그리기만** 해서 편집 대상 4종이
 * 통째로 빠져 있었다(검수 F-1·F-2·F-3 — 뿌리가 하나다).
 *
 * **제목은 드로어 헤더가 아니라 여기 최상단**에 있다 — `openTaskDetailDrawer` 는 id 만 알고
 * 제목은 로드 후에 오기 때문이다. 그래서 **드로어와 전체 페이지가 같은 컴포넌트**로 제목을
 * 그린다(U-4 「두 표면이 다른 규격을 갖지 않는다」).
 *
 * **상태 드롭다운 · 「완료 처리」 · `⋯` 는 자리와 표시만**이다 — 동작은 SPEC-004(WORK-005)가
 * 정의한다. 여기서는 **비활성**이고 눌러도 아무 요청이 나가지 않는다.
 *
 * **낙관적 갱신을 하지 않는다** — 기한·유형·프로젝트는 겹침·삭제된 항목이 **거부할 수 있다**
 * (§5 표). 그래서 **원복은 저절로 된다**: 값이 애초에 안 바뀐다.
 */

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { InlineEditText } from "@/components/shared/InlineEditText";
import { Selector } from "@/components/shared/Selector";
import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { DueDateField } from "@/features/tasks/components/DueDateField";
import {
  useTaskFieldSave,
  type FieldInlineErrors,
  type TaskField,
} from "@/features/tasks/hooks/useTaskFieldSave";
import { useProjectsQuery, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import type { TaskDetail } from "@/features/tasks/types";

/** 로딩 — 회색 블록(`--tm-row-divider`), **애니메이션 없음**(데스크톱 도구라 깜빡임을 만들지 않는다). */
export function TaskDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="불러오는 중">
      <div className="h-8 w-2/3 rounded-control bg-row-divider" />
      <div className="h-24 rounded-card bg-row-divider" />
      <div className="h-24 rounded-card bg-row-divider" />
      <div className="h-40 rounded-card bg-row-divider" />
    </div>
  );
}

export function TaskHeaderControls({ task }: { task: TaskDetail }) {
  const { data: workTypes = [] } = useWorkTypesQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { save, hasFailed, noticeFor } = useTaskFieldSave(task);
  /** 삭제된 유형·프로젝트처럼 **그 컨트롤 옆에 붙는** 사유(§4 Case Matrix). */
  const [inlineErrors, setInlineErrors] = useState<FieldInlineErrors>({});

  const onInlineError = (field: TaskField, message: string) =>
    setInlineErrors((prev) => ({ ...prev, [field]: message }));
  const clearInline = (field: TaskField) =>
    setInlineErrors((prev) => ({ ...prev, [field]: null }));

  return (
    <header className="mb-4 flex flex-col gap-3 border-b border-divider pb-4">
      {/* 제목 26·700 — **드로어와 전체 페이지가 같은 컨트롤을 쓴다**(U-3 문구·구성 · U-4) */}
      <InlineEditText
        ariaLabel="업무 제목"
        value={task.title}
        placeholder="업무 제목"
        className="[&_input]:text-detail-title [&_input]:h-auto [&_input]:py-1"
        saveFailed={hasFailed("title")}
        onSave={(next) => save("title", { title: next })}
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* 유형(필수) · 프로젝트(0..1) — 값 표시는 그대로, 누르면 팝오버(F-3) */}
        <Selector
          label="유형"
          placeholder="유형"
          value={{
            id: task.workType.id,
            name: task.workType.name,
            colorToken: task.workType.colorToken,
          }}
          options={workTypes.map((item) => ({
            id: item.id,
            name: item.name,
            colorToken: item.colorToken,
          }))}
          saveFailed={hasFailed("workType")}
          onSelect={(option) => {
            if (!option) {
              return;
            }
            clearInline("workType");
            void save("workType", { workTypeId: option.id }, onInlineError);
          }}
        />
        <Selector
          label="프로젝트"
          placeholder="프로젝트 없음"
          clearable
          value={
            task.project
              ? {
                  id: task.project.id,
                  name: task.project.name,
                  colorToken: task.project.colorToken,
                }
              : null
          }
          options={projects.map((item) => ({
            id: item.id,
            name: item.name,
            colorToken: item.colorToken,
          }))}
          saveFailed={hasFailed("project")}
          onSelect={(option) => {
            clearInline("project");
            void save("project", { projectId: option?.id ?? null }, onInlineError);
          }}
        />

        <span className="flex items-center gap-1.5 text-meta text-fg-meta">
          <StatusDot status={task.status} overdue={task.isOverdue} />
          {STATUS_LABEL[task.status]}
        </span>

        <span className="flex-1" />

        {/*
          아래 셋은 **자리와 표시만**이다 — 동작은 SPEC-004(WORK-005).
          `disabled` 라 눌러도 **아무 요청이 나가지 않는다.**
        */}
        <Button type="button" variant="outline" size="sm" disabled title="다음 배치에서 연결됩니다">
          상태 변경
        </Button>
        <Button type="button" size="sm" disabled title="다음 배치에서 연결됩니다">
          완료 처리
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled
          aria-label="더 보기"
          title="다음 배치에서 연결됩니다"
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </div>

      {/* 기한 — 시간까지 지정하면 겹침 검사 대상이다(DEC-005 §7). 거부되면 값이 안 바뀐다 */}
      <DueDateField
        value={{
          dueDate: task.dueDate,
          dueStartTime: task.dueStartTime,
          dueEndTime: task.dueEndTime,
        }}
        saveFailed={hasFailed("due")}
        onChange={(next) => void save("due", next)}
      />

      {inlineErrors.workType ? (
        <p className="text-caption text-destructive">{inlineErrors.workType}</p>
      ) : null}
      {inlineErrors.project ? (
        <p className="text-caption text-destructive">{inlineErrors.project}</p>
      ) : null}

      {/* U-7 — 캡션·「다시 저장」은 **이 블록의 인라인 자리 하나**에 모인다 */}
      {noticeFor("title", "due", "workType", "project")}
    </header>
  );
}

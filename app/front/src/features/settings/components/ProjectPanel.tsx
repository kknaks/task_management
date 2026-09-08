"use client";

/**
 * **U-5 「프로젝트」 패널**(SPEC-002).
 *
 * 유형과 같은 구조인데 **종류가 없다** — 프로젝트는 이름 + 색뿐이다(DEC-001 §3).
 * **기본 프로젝트는 없다** — 전부 삭제 가능하다. 하나도 없으면 **빈 상태**가 보인다.
 *
 * 추가 행과 자동 저장 실패 규격은 유형 패널과 **같은 컴포넌트·같은 훅**을 쓴다 —
 * 복제하면 규격이 갈린다(검수 F-1 · W-6 이 그것이다).
 */

import { useState } from "react";
import { toast } from "sonner";

import { AutoSaveFailureNotice } from "@/components/shared/AutoSaveFailureNotice";
import { ColorDot } from "@/components/shared/ColorDot";
import { ColorPickerPopover } from "@/components/shared/ColorPickerPopover";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { InlineAddRow, ADD_ROW_CONTROL_HEIGHT } from "@/features/settings/components/InlineAddRow";
import { SettingsPanel } from "@/features/settings/components/SettingsPanel";
import { autoSaveErrorToast, isNotFound } from "@/features/settings/errors";
import { inlineErrorMessage } from "@/lib/api/errors";
import { useProjectMutations, useProjectsQuery } from "@/lib/hooks/useWorkSettings";
import { useRowFailures } from "@/lib/hooks/useRowFailures";
import { Button } from "@/components/ui/button";
import { DEFAULT_COLOR_TOKEN, type ColorToken } from "@/lib/palette";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import type { Project } from "@/types/api";

const FIELD_LABEL = { name: "프로젝트 이름", color: "프로젝트 색" } as const;

export function ProjectPanel() {
  const { data: projects = [], isPending, isError, refetch } = useProjectsQuery();
  const { create, update, remove } = useProjectMutations();
  const { openConfirm } = useOverlay();
  const { failures, markFailed, clearFailed, clearRow, hasFailed, attemptedValue } =
    useRowFailures();

  const [addOpen, setAddOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<ColorToken>(DEFAULT_COLOR_TOKEN);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string | null>>({});

  const openAddRow = () => {
    setAddOpen(true);
    setAddError(null);
  };

  const closeAddRow = () => {
    setAddOpen(false);
    setDraftName("");
    setDraftColor(DEFAULT_COLOR_TOKEN);
    setAddError(null);
  };

  const canSubmit = draftName.trim().length > 0 && !create.isPending;

  const submitAdd = () => {
    if (!canSubmit) {
      return;
    }
    setAddError(null);
    void create
      .mutateAsync({ name: draftName.trim(), colorToken: draftColor })
      .then(() => {
        setDraftName("");
        setDraftColor(DEFAULT_COLOR_TOKEN);
      })
      .catch((error: unknown) => {
        const inline = inlineErrorMessage(error, "project");
        if (inline) {
          setAddError(inline);
          return;
        }
        toast.error("프로젝트를 추가하지 못했습니다");
      });
  };

  /** 유형 패널과 **같은 규칙**이다 — U-7 은 컨트롤 종류·영역과 무관하게 같다. */
  const save = async (
    project: Project,
    field: keyof typeof FIELD_LABEL,
    input: { name: string } | { colorToken: ColorToken },
  ): Promise<void> => {
    setRowErrors((prev) => ({ ...prev, [project.id]: null }));
    try {
      await update.mutateAsync({ id: project.id, input });
      clearFailed(project.id, field);
    } catch (error) {
      if (isNotFound(error)) {
        toast.error("항목을 찾을 수 없습니다");
        clearRow(project.id);
        void refetch();
        return;
      }
      const inline = inlineErrorMessage(error, "project");
      if (inline) {
        setRowErrors((prev) => ({ ...prev, [project.id]: inline }));
        return;
      }
      toast.error(autoSaveErrorToast(FIELD_LABEL[field]));
      markFailed(project.id, field, {
        retry: () => save(project, field, input),
        // **값 유지**(U-7) — 팝오버 컨트롤이 옛 값으로 되돌아 보이지 않게 넣으려던 값을 든다.
        attempted: "colorToken" in input ? input.colorToken : input.name,
      });
    }
  };

  const confirmDelete = (project: Project) => {
    openConfirm({
      title: `'${project.name}' 프로젝트를 삭제할까요?`,
      summary:
        "이 프로젝트에 묶인 업무·회의는 그대로 남고, 프로젝트 이름도 지금대로 보입니다.",
      warning: "새 업무·회의에서는 더 이상 고를 수 없습니다. v1 에는 복원 화면이 없습니다.",
      confirmLabel: "삭제",
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(project.id);
          clearRow(project.id);
        } catch (error) {
          if (isNotFound(error)) {
            toast.error("항목을 찾을 수 없습니다");
            clearRow(project.id);
            void refetch();
            return;
          }
          toast.error("프로젝트를 삭제하지 못했습니다");
        }
      },
    });
  };

  return (
    <SettingsPanel
      title="프로젝트"
      caption="업무·회의를 묶는 단위입니다 · 입력을 마치면 자동으로 저장됩니다"
      actionLabel="프로젝트 등록"
      onAction={openAddRow}
    >
      {addOpen ? (
        <InlineAddRow
          nameLabel="프로젝트 이름"
          namePlaceholder="프로젝트 이름 (예: 9월 요금제 개편)"
          name={draftName}
          onNameChange={setDraftName}
          onSubmit={submitAdd}
          onCancel={closeAddRow}
          canSubmit={canSubmit}
          errorMessage={addError}
          // 프로젝트 추가 행은 색이 앞이다(U-5)
          leading={
            <ColorPickerPopover
              value={draftColor}
              onSelect={setDraftColor}
              variant="dot"
              label="색"
              className={ADD_ROW_CONTROL_HEIGHT}
            />
          }
        />
      ) : null}

      {isError ? (
        <div className="flex flex-col items-start gap-3 px-5 py-8">
          <p className="text-body text-destructive">프로젝트를 불러오지 못했습니다</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            다시 시도
          </Button>
        </div>
      ) : isPending ? (
        <p className="px-5 py-8 text-body text-muted-foreground">불러오는 중…</p>
      ) : projects.length === 0 ? (
        // 빈 상태 — 등록된 프로젝트가 하나도 없을 때만(U-5 문구 그대로)
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <p className="text-body text-foreground">아직 프로젝트가 없습니다</p>
          <p className="text-meta text-fg-meta">
            업무를 묶어 보려면 프로젝트를 하나 만들어 주세요
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={openAddRow}>
            프로젝트 등록
          </Button>
        </div>
      ) : (
        <ul>
          {projects.map((project) => {
            const rowFailures = failures[project.id] ?? {};
            return (
              <li key={project.id} className="border-b border-row-divider last:border-b-0">
                <div className="flex h-16 items-center gap-3 px-5 hover:bg-row-hover">
                  <ColorDot colorToken={project.colorToken} />

                  <div className="min-w-0 flex-1">
                    <InlineEditText
                      ariaLabel={`${project.name} 이름`}
                      value={project.name}
                      saveFailed={hasFailed(project.id, "name")}
                      errorMessage={rowErrors[project.id] ?? null}
                      onSave={(next) => save(project, "name", { name: next })}
                    />
                  </div>

                  <ColorPickerPopover
                    // 실패했으면 **넣으려던 색**을 그대로 보여준다(U-7 값 유지)
                    value={attemptedValue(project.id, "color") ?? project.colorToken}
                    onSelect={(token) => void save(project, "color", { colorToken: token })}
                    saveFailed={hasFailed(project.id, "color")}
                    variant="dot"
                    label={`${project.name} 색`}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-14 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => confirmDelete(project)}
                  >
                    삭제
                  </Button>
                </div>

                <AutoSaveFailureNotice
                  busy={update.isPending}
                  failures={Object.entries(rowFailures).map(([field, failure]) => ({
                    field,
                    label: FIELD_LABEL[field as keyof typeof FIELD_LABEL],
                    onRetry: () => void failure.retry(),
                  }))}
                />
              </li>
            );
          })}
        </ul>
      )}
    </SettingsPanel>
  );
}

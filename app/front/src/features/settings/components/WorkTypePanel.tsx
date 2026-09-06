"use client";

/**
 * **U-1~U-3 「업무 유형」 패널**(SPEC-002).
 *
 * 기본 유형 3종은 **이름·종류 읽기 전용 · 삭제 버튼 없음 · 색만 활성**(A-4).
 * 화면이 컨트롤을 감춰도 **서버 판정이 정본**이다 — 두 겹으로 막는다.
 *
 * **자동 저장 실패의 소유자가 이 패널이다**(U-7 구현 규약 · 검수 F-1) —
 * 이름과 색이 **같은 규격**을 지나고, 캡션·「다시 저장」은 행 아래 인라인 자리 하나가 그린다.
 */

import { useState } from "react";
import { toast } from "sonner";

import { AutoSaveFailureNotice } from "@/components/shared/AutoSaveFailureNotice";
import { ColorPickerPopover } from "@/components/shared/ColorPickerPopover";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { TypeBadge } from "@/components/shared/TypeBadge";
import { InlineAddRow, ADD_ROW_CONTROL_HEIGHT } from "@/features/settings/components/InlineAddRow";
import { SettingChip, SettingsPanel } from "@/features/settings/components/SettingsPanel";
import { autoSaveErrorToast, inlineErrorMessage, isNotFound } from "@/features/settings/errors";
import { useWorkTypeMutations, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import { useRowFailures } from "@/features/settings/useRowFailures";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_COLOR_TOKEN, type ColorToken } from "@/lib/palette";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import type { WorkType, WorkTypeKind } from "@/types/api";

/** 「미팅」/「업무」는 **표시 매핑**이다 — 저장·전송은 영문 소문자다(DB G-4). */
const KIND_LABEL: Record<WorkTypeKind, string> = { meeting: "미팅", task: "업무" };

/** U-7 문구에 들어가는 필드 이름. 토스트와 행 아래 캡션이 **같은 이름**을 쓴다. */
const FIELD_LABEL = { name: "유형 이름", color: "유형 색" } as const;

export function WorkTypePanel() {
  const { data: workTypes = [], isPending, isError, refetch } = useWorkTypesQuery();
  const { create, update, remove } = useWorkTypeMutations();
  const { openConfirm } = useOverlay();
  const { failures, markFailed, clearFailed, clearRow, hasFailed, attemptedValue } =
    useRowFailures();

  const [addOpen, setAddOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<WorkTypeKind | "">("");
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<ColorToken>(DEFAULT_COLOR_TOKEN);
  const [addError, setAddError] = useState<string | null>(null);
  /** 행별 인라인 사유 — 잠금·중복처럼 **그 항목 옆에 붙는** 것(§3-5). */
  const [rowErrors, setRowErrors] = useState<Record<number, string | null>>({});

  const openAddRow = () => {
    setAddOpen(true);
    setAddError(null);
  };

  const closeAddRow = () => {
    setAddOpen(false);
    setDraftKind("");
    setDraftName("");
    setDraftColor(DEFAULT_COLOR_TOKEN);
    setAddError(null);
  };

  // 종류가 선택되고 이름이 1자 이상일 때만 활성(U-2).
  const canSubmit = draftKind !== "" && draftName.trim().length > 0 && !create.isPending;

  const submitAdd = () => {
    // `canSubmit` 이 「종류가 골라졌다」를 포함하므로 여기를 지나면 `draftKind` 는 빈 값이 아니다.
    if (!canSubmit) {
      return;
    }
    setAddError(null);
    void create
      .mutateAsync({ kind: draftKind, name: draftName.trim(), colorToken: draftColor })
      .then(() => {
        // 추가되면 **행은 비워진 채로 열려 있다** — 연속 등록을 끊지 않는다(U-2 기대 결과).
        setDraftName("");
        setDraftKind("");
        setDraftColor(DEFAULT_COLOR_TOKEN);
      })
      .catch((error: unknown) => {
        const inline = inlineErrorMessage(error, "workType");
        if (inline) {
          // **행이 닫히지 않고 값이 남는다**(Case Matrix `duplicate_name`).
          setAddError(inline);
          return;
        }
        toast.error("유형을 추가하지 못했습니다");
      });
  };

  /**
   * 자동 저장 한 번. **성공하면 그 필드의 실패 표시를 지우고**(해제 조건 ①·②),
   * 실패하면 켠다 — 재요청 방법을 함께 들어 「다시 저장」이 같은 요청을 낸다.
   *
   * **자동 재시도는 없다.** 이 함수는 눌린 만큼만 불린다.
   */
  const save = async (
    workType: WorkType,
    field: keyof typeof FIELD_LABEL,
    input: { name: string } | { colorToken: ColorToken },
  ): Promise<void> => {
    setRowErrors((prev) => ({ ...prev, [workType.id]: null }));
    try {
      await update.mutateAsync({ id: workType.id, input });
      clearFailed(workType.id, field);
    } catch (error) {
      if (isNotFound(error)) {
        toast.error("항목을 찾을 수 없습니다");
        clearRow(workType.id);
        void refetch();
        return;
      }
      const inline = inlineErrorMessage(error, "workType");
      if (inline) {
        // 중복·잠금은 **그 항목 옆 인라인 안내**다 — 자동 저장 실패 표시와 다른 축이다.
        setRowErrors((prev) => ({ ...prev, [workType.id]: inline }));
        return;
      }
      // U-7 — 토스트 + **그 필드의 실패 표시**가 함께 뜬다.
      toast.error(autoSaveErrorToast(FIELD_LABEL[field]));
      markFailed(workType.id, field, {
        retry: () => save(workType, field, input),
        // **값 유지**(U-7) — 팝오버 컨트롤이 옛 값으로 되돌아 보이지 않게 넣으려던 값을 든다.
        attempted: "colorToken" in input ? input.colorToken : input.name,
      });
    }
  };

  const confirmDelete = (workType: WorkType) => {
    openConfirm({
      title: `'${workType.name}' 유형을 삭제할까요?`,
      summary:
        "이 유형을 쓰고 있는 업무·회의는 그대로 남고, 배지도 지금 이름과 색으로 보입니다.",
      warning: "새 업무·회의에서는 더 이상 고를 수 없습니다. v1 에는 복원 화면이 없습니다.",
      confirmLabel: "삭제",
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(workType.id);
          clearRow(workType.id);
        } catch (error) {
          // 확인 모달을 지났으므로 취소 경로가 없다 — 실패하면 토스트, 행은 남는다(Case Matrix).
          if (isNotFound(error)) {
            toast.error("항목을 찾을 수 없습니다");
            clearRow(workType.id);
            void refetch();
            return;
          }
          toast.error("유형을 삭제하지 못했습니다");
        }
      },
    });
  };

  return (
    <SettingsPanel
      title="업무 유형"
      caption="업무·회의의 종류를 나눕니다 · 입력을 마치면 자동으로 저장됩니다"
      actionLabel="유형 추가"
      onAction={openAddRow}
    >
      {addOpen ? (
        <InlineAddRow
          nameLabel="유형 이름"
          namePlaceholder="유형 이름 (예: 외부 미팅)"
          name={draftName}
          onNameChange={setDraftName}
          onSubmit={submitAdd}
          onCancel={closeAddRow}
          canSubmit={canSubmit}
          errorMessage={addError}
          leading={
            <Select value={draftKind} onValueChange={(next) => setDraftKind(next as WorkTypeKind)}>
              <SelectTrigger className={`${ADD_ROW_CONTROL_HEIGHT} w-[136px] shrink-0`} aria-label="종류">
                <SelectValue placeholder="종류" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">{KIND_LABEL.meeting}</SelectItem>
                <SelectItem value="task">{KIND_LABEL.task}</SelectItem>
              </SelectContent>
            </Select>
          }
          trailing={
            <ColorPickerPopover
              value={draftColor}
              onSelect={setDraftColor}
              label="색"
              className={ADD_ROW_CONTROL_HEIGHT}
            />
          }
        />
      ) : null}

      {isError ? (
        // 조용한 빈 목록으로 대체하지 않는다(§3-5 · DEC-003 §7).
        <div className="flex flex-col items-start gap-3 px-5 py-8">
          <p className="text-body text-destructive">유형을 불러오지 못했습니다</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            다시 시도
          </Button>
        </div>
      ) : isPending ? (
        <p className="px-5 py-8 text-body text-muted-foreground">불러오는 중…</p>
      ) : (
        <ul>
          {workTypes.map((workType) => {
            const rowFailures = failures[workType.id] ?? {};
            return (
              <li key={workType.id} className="border-b border-row-divider last:border-b-0">
                {/* 행 높이 64 는 실패가 있어도 바뀌지 않는다 — 표시는 이 아래에 따로 붙는다(U-7) */}
                <div className="flex h-16 items-center gap-3 px-5 hover:bg-row-hover">
                  <TypeBadge name={workType.name} colorToken={workType.colorToken} />

                  <div className="min-w-0 flex-1">
                    <InlineEditText
                      ariaLabel={`${workType.name} 이름`}
                      value={workType.name}
                      // 기본 유형은 **이름이 편집되지 않는다**(A-4). 서버도 같은 판정을 한다.
                      readOnly={workType.isDefault}
                      saveFailed={hasFailed(workType.id, "name")}
                      errorMessage={rowErrors[workType.id] ?? null}
                      onSave={(next) => save(workType, "name", { name: next })}
                    />
                  </div>

                  {workType.isDefault ? <SettingChip label="기본" muted /> : null}
                  {/* 종류는 만든 뒤 바꿀 수 없다 — 행에 편집 컨트롤을 두지 않는다(U-3) */}
                  <SettingChip label={KIND_LABEL[workType.kind]} />

                  <ColorPickerPopover
                    // 실패했으면 **넣으려던 색**을 그대로 보여준다(U-7 값 유지)
                    value={attemptedValue(workType.id, "color") ?? workType.colorToken}
                    onSelect={(token) => void save(workType, "color", { colorToken: token })}
                    saveFailed={hasFailed(workType.id, "color")}
                    label={`${workType.name} 색`}
                  />

                  {/* 기본 유형에는 **삭제 버튼이 없다**(A-4) */}
                  {workType.isDefault ? (
                    <span className="w-14 shrink-0" aria-hidden />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-14 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => confirmDelete(workType)}
                    >
                      삭제
                    </Button>
                  )}
                </div>

                {/* **캡션·「다시 저장」은 행 아래 인라인 자리 하나**에 모인다(U-7 팝오버 규격).
                    두 필드가 실패하면 줄이 늘어난다 — 자리는 여전히 하나다. */}
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

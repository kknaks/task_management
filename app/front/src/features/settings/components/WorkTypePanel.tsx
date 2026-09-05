"use client";

/**
 * **U-1~U-3 「업무 유형」 패널**(SPEC-002).
 *
 * 필드가 셋이라 **드로어를 열지 않는다** — 「한 줄짜리 개체는 인라인」·「필드가 4개 이하면
 * 드로어를 열지 않는다」([10] RULES). 참고 시안에 빠져 있던 **종류 셀렉터**가 여기 들어간다.
 *
 * 기본 유형 3종은 **이름·종류 읽기 전용 · 삭제 버튼 없음 · 색만 활성**(A-4).
 * 화면이 컨트롤을 감춰도 **서버 판정이 정본**이다 — 두 겹으로 막는다.
 */

import { useState } from "react";
import { toast } from "sonner";

import { ColorPickerPopover } from "@/components/shared/ColorPickerPopover";
import { InlineEditText } from "@/components/shared/InlineEditText";
import { TypeBadge } from "@/components/shared/TypeBadge";
import { SettingChip, SettingsPanel } from "@/features/settings/components/SettingsPanel";
import { autoSaveErrorToast, inlineErrorMessage, isNotFound } from "@/features/settings/errors";
import { useWorkTypeMutations, useWorkTypesQuery } from "@/features/settings/hooks/useWorkSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_COLOR_TOKEN } from "@/lib/palette";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";
import type { ColorToken, WorkType, WorkTypeKind } from "@/types/api";

/** 「미팅」/「업무」는 **표시 매핑**이다 — 저장·전송은 영문 소문자다(DB G-4). */
const KIND_LABEL: Record<WorkTypeKind, string> = { meeting: "미팅", task: "업무" };

export function WorkTypePanel() {
  const { data: workTypes = [], isPending, isError, refetch } = useWorkTypesQuery();
  const { create, update, remove } = useWorkTypeMutations();
  const { openConfirm } = useOverlay();

  const [addOpen, setAddOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<WorkTypeKind | "">("");
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<ColorToken>(DEFAULT_COLOR_TOKEN);
  const [addError, setAddError] = useState<string | null>(null);
  /** 행별 인라인 사유 — 잠금·중복처럼 **그 항목 옆에 붙는** 것(§3-5). */
  const [rowErrors, setRowErrors] = useState<Record<number, string | null>>({});

  const openAddRow = () => {
    // 추가 행이 이미 열려 있으면 그 행으로 포커스만 옮긴다 — 두 줄이 동시에 열리지 않는다(U-1).
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

  const submitAdd = async () => {
    // `canSubmit` 이 「종류가 골라졌다」를 포함하므로 여기를 지나면 `draftKind` 는 빈 값이 아니다.
    if (!canSubmit) {
      return;
    }
    setAddError(null);
    try {
      await create.mutateAsync({
        kind: draftKind,
        name: draftName.trim(),
        colorToken: draftColor,
      });
      // 추가되면 **행은 비워진 채로 열려 있다** — 연속 등록을 끊지 않는다(U-2 기대 결과).
      setDraftName("");
      setDraftKind("");
      setDraftColor(DEFAULT_COLOR_TOKEN);
    } catch (error) {
      const inline = inlineErrorMessage(error, "workType");
      if (inline) {
        // **행이 닫히지 않고 값이 남는다**(Case Matrix `duplicate_name`).
        setAddError(inline);
        return;
      }
      toast.error("유형을 추가하지 못했습니다");
    }
  };

  const saveName = async (workType: WorkType, name: string) => {
    setRowErrors((prev) => ({ ...prev, [workType.id]: null }));
    try {
      await update.mutateAsync({ id: workType.id, input: { name } });
    } catch (error) {
      handleRowError(error, workType.id, "유형 이름");
      // 던져야 `InlineEditText` 가 U-7 실패 표시를 남긴다.
      throw error;
    }
  };

  const saveColor = async (workType: WorkType, colorToken: ColorToken) => {
    setRowErrors((prev) => ({ ...prev, [workType.id]: null }));
    try {
      await update.mutateAsync({ id: workType.id, input: { colorToken } });
    } catch (error) {
      handleRowError(error, workType.id, "유형 색");
    }
  };

  const handleRowError = (error: unknown, id: number, fieldLabel: string) => {
    if (isNotFound(error)) {
      toast.error("항목을 찾을 수 없습니다");
      void refetch();
      return;
    }
    const inline = inlineErrorMessage(error, "workType");
    if (inline) {
      setRowErrors((prev) => ({ ...prev, [id]: inline }));
      return;
    }
    // U-7 — 토스트는 여기서, 필드 실패 표시는 `InlineEditText` 가.
    toast.error(autoSaveErrorToast(fieldLabel));
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
        } catch (error) {
          // 확인 모달을 지났으므로 취소 경로가 없다 — 실패하면 토스트, 행은 남는다(Case Matrix).
          if (isNotFound(error)) {
            toast.error("항목을 찾을 수 없습니다");
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
        <div className="border-b border-row-divider bg-row-hover px-5 py-2.5">
          <div className="flex h-9 items-center gap-3">
            <Select
              value={draftKind}
              onValueChange={(next) => setDraftKind(next as WorkTypeKind)}
            >
              <SelectTrigger className="h-9 w-[136px] shrink-0" aria-label="종류">
                <SelectValue placeholder="종류" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">{KIND_LABEL.meeting}</SelectItem>
                <SelectItem value="task">{KIND_LABEL.task}</SelectItem>
              </SelectContent>
            </Select>

            <Input
              aria-label="유형 이름"
              autoFocus
              placeholder="유형 이름 (예: 외부 미팅)"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                // `Enter` 로도 추가되지만 **버튼은 항상 있다**([10] 단축키는 보조).
                if (event.key === "Enter") void submitAdd();
                if (event.key === "Escape") closeAddRow();
              }}
              className={cn("h-9 min-w-[200px] flex-1", addError && "border-destructive")}
            />

            <ColorPickerPopover value={draftColor} onSelect={setDraftColor} label="색" />

            <Button type="button" variant="ghost" size="sm" onClick={closeAddRow}>
              취소
            </Button>
            <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void submitAdd()}>
              추가
            </Button>
          </div>

          {addError ? <p className="mt-1 text-caption text-destructive">{addError}</p> : null}
        </div>
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
          {workTypes.map((workType) => (
            <li
              key={workType.id}
              className="flex h-16 items-center gap-3 border-b border-row-divider px-5 last:border-b-0 hover:bg-row-hover"
            >
              <TypeBadge name={workType.name} colorToken={workType.colorToken} />

              <div className="min-w-0 flex-1">
                <InlineEditText
                  ariaLabel={`${workType.name} 이름`}
                  value={workType.name}
                  // 기본 유형은 **이름이 편집되지 않는다**(A-4). 서버도 같은 판정을 한다.
                  readOnly={workType.isDefault}
                  errorMessage={rowErrors[workType.id] ?? null}
                  onSave={(next) => saveName(workType, next)}
                />
              </div>

              {workType.isDefault ? <SettingChip label="기본" muted /> : null}
              {/* 종류는 만든 뒤 바꿀 수 없다 — 행에 편집 컨트롤을 두지 않는다(U-3) */}
              <SettingChip label={KIND_LABEL[workType.kind]} />

              <ColorPickerPopover
                value={workType.colorToken}
                onSelect={(token) => void saveColor(workType, token)}
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
            </li>
          ))}
        </ul>
      )}
    </SettingsPanel>
  );
}

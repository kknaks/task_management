"use client";

/**
 * **U-7 취소 모달 600**(SPEC-004).
 *
 * 「되돌리기 어려운 결정 하나」라 모달이다([10]). **새 프레임을 만들지 않고**
 * `ConfirmModal`(S-05) 위에 **사유 슬롯**만 얹는다 — 제목·요약·경고·푸터 규격이 갈리지 않게.
 *
 * - 사유 칩 4(일정 연기 / 요건 변경 / 중복 업무 / **직접 입력**) — 직접 입력이면 textarea
 * - 「취소 사유를 로그에 기록」 **기본 켜짐**(DEC-002 §6)
 * - **사유가 없으면 「업무 취소」가 눌리지 않는다**
 * - 서버가 `validation_error` 를 내면 **모달 안 인라인**이고 **모달이 닫히지 않는다**(§4)
 *
 * 팝오버·드로어가 열려 있으면 **먼저 닫고** 연다(FE §6-2) — `openCancelModal` 이 그 순서를 든다.
 */

import { useEffect, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelInput } from "@/features/tasks/hooks/useTaskStatus";
import type { TaskStatusInput } from "@/features/tasks/types";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import type { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

type Overlay = ReturnType<typeof useOverlay>;

/** 칩 3 + 「직접 입력」. 앞의 셋은 문구가 곧 사유다. */
const PRESETS = ["일정 연기", "요건 변경", "중복 업무"] as const;
const CUSTOM = "직접 입력";

/** 슬롯과 여는 쪽이 함께 보는 값 — 모달이 닫힐 때까지만 산다. */
interface CancelDraft {
  reason: string;
  logCancelReason: boolean;
  setError: (message: string | null) => void;
}

function CancelReasonFields({
  draft,
  setCanConfirm,
}: {
  draft: CancelDraft;
  setCanConfirm: (ok: boolean) => void;
}) {
  const [chip, setChip] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [logIt, setLogIt] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 서버가 낸 사유를 이 슬롯이 그린다 — 여는 쪽이 토스트로 흘려보내지 않는다.
  draft.setError = setError;

  const reason = chip === CUSTOM ? custom.trim() : (chip ?? "");
  draft.reason = reason;
  draft.logCancelReason = logIt;

  useEffect(() => {
    setCanConfirm(reason.length > 0);
  }, [reason, setCanConfirm]);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="취소 사유" className="flex flex-wrap gap-2">
        {[...PRESETS, CUSTOM].map((item) => {
          const selected = chip === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setChip(item);
                setError(null);
              }}
              className={cn(
                "h-8 rounded-chip border px-3 text-meta",
                selected
                  ? "border-primary bg-secondary text-secondary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {item}
            </button>
          );
        })}
      </div>

      {chip === CUSTOM ? (
        <Textarea
          aria-label="취소 사유"
          placeholder="취소 사유를 적습니다"
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
            setError(null);
          }}
          className="min-h-20 text-body"
        />
      ) : null}

      <span className="flex items-center gap-2">
        <Checkbox
          id="cancel-log"
          checked={logIt}
          onCheckedChange={(checked) => setLogIt(checked === true)}
        />
        <Label htmlFor="cancel-log" className="text-meta text-muted-foreground">
          취소 사유를 로그에 기록
        </Label>
      </span>

      {error ? <p className="text-caption text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * 취소 모달을 연다. **드로어가 열려 있으면 먼저 닫는다** — 겹치지 않는 것이 규칙이고
 * `openConfirm` 은 드로어가 있으면 개발 모드에서 세운다(§6-2).
 */
export function openCancelModal(
  overlay: Overlay,
  task: { id: number; title: string },
  submit: (input: TaskStatusInput) => Promise<boolean>,
): void {
  overlay.closeDrawer();

  const draft: CancelDraft = {
    reason: "",
    logCancelReason: true,
    setError: () => undefined,
  };

  overlay.openConfirm({
    title: "업무를 취소할까요?",
    summary: "취소한 업무는 목록에 남고, 제목에 취소선이 표시됩니다.",
    confirmLabel: "업무 취소",
    body: ({ setCanConfirm }) => (
      <CancelReasonFields draft={draft} setCanConfirm={setCanConfirm} />
    ),
    onConfirm: async () => {
      try {
        const ok = await submit(cancelInput(draft.reason, draft.logCancelReason));
        if (!ok) {
          // 전이 자체가 거부됐다 — 토스트는 훅이 이미 냈다. 모달은 닫지 않는다.
          throw new Error("cancel rejected");
        }
      } catch (error: unknown) {
        if (isApiError(error) && error.code === API_ERROR_CODE.VALIDATION_ERROR) {
          draft.setError("취소 사유를 입력해 주세요");
        }
        throw error;
      }
    },
  });
}

"use client";

/**
 * **S-05 확인 모달 — 공통 프레임**(SPEC-001 U-5 · `09-design-tokens.md` §오버레이 3종 · FE §6).
 *
 * 「되돌리기 어려운 결정 하나」의 표면이다. **편집은 드로어, 결정은 모달**이고,
 * **드로어 위에 겹치지 않는다** — 그 판정은 `OverlayProvider` 가 한다(§6-2).
 *
 * **크기는 둘**(SPEC-008 U-7 · MF-63) —
 * `heavy`(기본 · 600) = 회의 · 계정처럼 딸린 것이 많은 결정(입력 · 경고 슬롯을 쓴다) ·
 * `light`(420) = **제목 + 한 문장 + h32 취소/확인**뿐인 결정(줄 삭제). **`light` 는 경고 슬롯을 받지 않는다** —
 * 안 지워지는 것을 적지 않는 것이 U-7 의 요구다(갈래를 만들지 않는다).
 *
 * 프레임 — 헤더 제목 → 요약 → (경고 슬롯 — `heavy` 만) → 푸터 취소/확인.
 * **`Esc`·스크림 클릭·「취소」 세 가지로 닫힌다.** 단 **요청이 나간 뒤에는 닫히지 않는다**(U-5).
 *
 * 이 컴포넌트가 `Dialog` 를 직접 import 하는 **유일한 자리**다 — 화면은 이걸 통해서만 연다
 * (§6-1 · §11 금지 목록 3).
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConfirmRequest } from "@/lib/overlay/OverlayProvider";

export function ConfirmModal({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  /** 입력 슬롯이 없으면 언제나 확인할 수 있다 — 슬롯이 있을 때만 그쪽이 정한다. */
  const [canConfirm, setCanConfirm] = useState(true);
  const size = request.size ?? "heavy";
  const light = size === "light";

  const handleConfirm = async () => {
    setPending(true);
    try {
      await request.onConfirm();
      onClose();
    } catch {
      // **실패하면 닫지 않는다** — 사유 인라인이 모달 안에 떠야 하고(§4 Case Matrix),
      // 닫아 버리면 사용자가 무엇이 잘못됐는지 볼 자리를 잃는다.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // *확인 중*: `Esc`·스크림 클릭으로 닫히지 않는다(U-5).
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <DialogContent
        data-modal-size={size}
        /* 폭 600(`heavy`) / 420(`light`) · radius 16 · 모달 그림자. 생성물의 X 닫기는 규격에 없어 숨긴다(U-5 CTA 둘). */
        className={cn(
          "gap-6 rounded-card border-border bg-card p-0 shadow-modal [&>button:last-child]:hidden",
          light ? "w-modal-light max-w-modal-light gap-4" : "w-modal max-w-modal",
        )}
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className={cn("gap-2 text-left", light ? "px-6 pt-6" : "px-8 pt-8")}>
          <DialogTitle className="text-detail-title text-foreground">{request.title}</DialogTitle>
          <DialogDescription className="text-body text-muted-foreground">
            {request.summary}
          </DialogDescription>
        </DialogHeader>

        {/* 입력 슬롯 — 결정의 근거(취소 사유 등). 비어 있으면 줄 자체가 없다. `light` 에는 슬롯이 없다 */}
        {!light && request.body ? <div className="px-8">{request.body({ setCanConfirm })}</div> : null}

        {/* 경고 슬롯 — 비어 있으면 줄 자체가 없다. **`light` 는 받지 않는다**(U-7 「경고 슬롯 없음」) */}
        {!light && request.warning ? (
          <p className="mx-8 rounded-control bg-muted px-4 py-3 text-body font-bold text-foreground">
            {request.warning}
          </p>
        ) : null}

        <DialogFooter
          className={cn("flex-row justify-end gap-2 border-t border-divider", light ? "px-6 py-4" : "px-8 py-5")}
        >
          <Button type="button" variant="ghost" size={light ? "sm" : "default"} onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button
            type="button"
            variant={request.destructive ? "destructive" : "default"}
            size={light ? "sm" : "default"}
            onClick={() => void handleConfirm()}
            disabled={pending || !canConfirm}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {request.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

/**
 * **S-05 확인 모달 600 — 공통 프레임**(SPEC-001 U-5 · `09-design-tokens.md` §오버레이 3종).
 *
 * 「되돌리기 어려운 결정 하나」의 표면이다. **편집은 드로어, 결정은 모달**이고,
 * **드로어 위에 겹치지 않는다** — 그 판정은 `OverlayProvider` 가 한다(§6-2).
 *
 * 프레임 — 헤더 제목 → 요약 → (경고 슬롯) → 푸터 취소/확인.
 * **`Esc`·스크림 클릭·「취소」 세 가지로 닫힌다.** 단 **요청이 나간 뒤에는 닫히지 않는다**(U-5).
 *
 * 이 컴포넌트가 `Dialog` 를 직접 import 하는 **유일한 자리**다 — 화면은 이걸 통해서만 연다
 * (§6-1 · §11 금지 목록 3).
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

  const handleConfirm = async () => {
    setPending(true);
    try {
      await request.onConfirm();
      onClose();
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
        /* 폭 600 · radius 16 · 모달 그림자. 생성물의 X 닫기는 규격에 없어 숨긴다(U-5 CTA 둘). */
        className="w-modal max-w-modal gap-6 rounded-card border-border bg-card p-0 shadow-modal [&>button:last-child]:hidden"
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="gap-2 px-8 pt-8 text-left">
          <DialogTitle className="text-detail-title text-foreground">{request.title}</DialogTitle>
          <DialogDescription className="text-body text-muted-foreground">
            {request.summary}
          </DialogDescription>
        </DialogHeader>

        {/* 경고 슬롯 — 비어 있으면 줄 자체가 없다 */}
        {request.warning ? (
          <p className="mx-8 rounded-control bg-muted px-4 py-3 text-body font-bold text-foreground">
            {request.warning}
          </p>
        ) : null}

        <DialogFooter className="flex-row justify-end gap-2 border-t border-divider px-8 py-5">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button
            type="button"
            variant={request.destructive ? "destructive" : "default"}
            onClick={() => void handleConfirm()}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {request.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

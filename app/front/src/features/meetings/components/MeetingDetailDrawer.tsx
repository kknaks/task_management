"use client";

/**
 * **회의 상세 드로어 — 본문을 감싸는 껍데기**(폭은 `DrawerFrame` 이 정한다)(SPEC-008 U-4 · DEC-005 §2 · SPEC-003 U-3 구조).
 *
 * 캘린더(SPEC-009 U-7) · 목록이 `openMeetingDetailDrawer` 로 연다. **드로어는 부모를 모른다.**
 * 폭 · 스크림 · 닫는 길(`Esc` · × · 스크림)은 `DrawerFrame` 이 정한다 — 이 파일은 **헤더 내용과 본문**만 준다.
 *
 * 헤더 72(REDRAW-03 §2-1 결) — ① 유형 배지 + 프로젝트 칩 | `⋯`(삭제) ⤢ × ② 제목 26/700 인라인 ③ 일시 인라인 · 상태 칩.
 * 제목 · 유형 · 프로젝트 · 일시가 **수정 경로**다(SPEC-006 U-4 L180 · DEC-005 §5) — 페이지와 **같은 컨트롤**(`MeetingMetaInline`).
 * `generating`(U-1) · `recording`(U-4) 은 메타 잠금. `⋯` 「삭제」는 **드로어를 먼저 닫고** SPEC-006 U-5 모달을 연다(FE §6-2 · `openMeetingDeleteModal` 이 그렇게 한다).
 *
 * 본문은 `MeetingDetailBody mode="drawer"` **하나** — 전체 페이지와 같은 본문이다. 드로어에서 빠진 것은
 * 「편집 · 줄 버튼 · 스크립트 패널 · 첨부 쓰기」 넷뿐이다(U-4 기대 결과).
 */

import Link from "next/link";
import { ArrowLeft, Maximize2, MoreHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MeetingDetailBody } from "@/features/meetings/components/MeetingDetailBody";
import { openMeetingDeleteModal } from "@/features/meetings/components/MeetingDeleteModal";
import {
  MeetingDateTimeInline,
  MeetingProjectInline,
  MeetingTitleInline,
  MeetingWorkTypeInline,
  useMeetingMetaSave,
} from "@/features/meetings/components/MeetingMetaInline";
import { MeetingDetailSkeleton } from "@/features/meetings/components/MeetingSkeleton";
import { MeetingStatusChip } from "@/features/meetings/components/MeetingStatusChip";
import { isMeetingNotFound } from "@/features/meetings/errors";
import { useMeetingDetail } from "@/features/meetings/hooks/useMeetingDetail";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import type { MeetingDetail } from "@/features/meetings/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border border-divider bg-card text-fg-meta hover:bg-muted"
    >
      {children}
    </button>
  );
}

/** `⋯` — 항목은 「삭제」 하나(SPEC-006 U-5 L205). */
function MoreMenu({ onDelete, disabled }: { onDelete: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="더 보기"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control border border-divider bg-card text-fg-meta hover:bg-muted"
        >
          <MoreHorizontal className="h-[15px] w-[15px]" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-meta text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-3.5 [&_svg]:w-3.5"
        >
          <Trash2 aria-hidden />
          삭제
        </button>
      </PopoverContent>
    </Popover>
  );
}

function DrawerHeader({
  meeting,
  fullscreen,
  expand,
  onClose,
}: {
  meeting: MeetingDetail;
  fullscreen: boolean;
  expand: (() => void) | null;
  onClose: () => void;
}) {
  const overlay = useOverlay();
  const mutations = useMeetingMutations(meeting.id);
  const meta = useMeetingMetaSave(meeting);
  // `generating` 은 메타 · 삭제 잠금(U-1) · `recording` 은 메타 잠금(U-4 — 삭제도 서버가 409 라 함께 막는다).
  const locked = meeting.status === "generating" || meeting.status === "recording";

  const confirmDelete = () =>
    // 드로어를 **먼저 닫고** 모달을 연다 — `openMeetingDeleteModal` 안에서 `closeDrawer()` 가 먼저 불린다.
    openMeetingDeleteModal(overlay, meeting, async () => {
      await mutations.remove.mutateAsync(meeting.id);
    });

  return (
    <header className="flex flex-col gap-3.5 border-b border-divider px-7 pb-[18px] pt-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {fullscreen ? (
            <IconButton label="닫기" onClick={onClose}>
              <ArrowLeft className="h-[15px] w-[15px]" aria-hidden />
            </IconButton>
          ) : null}
          <MeetingWorkTypeInline meeting={meeting} meta={meta} locked={locked} variant="badge" />
          <MeetingProjectInline meeting={meeting} meta={meta} locked={locked} variant="chip" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MoreMenu onDelete={confirmDelete} disabled={locked} />
          {expand ? (
            <IconButton label="전체 페이지로 열기" onClick={expand}>
              <Maximize2 className="h-[13px] w-[13px]" aria-hidden />
            </IconButton>
          ) : null}
          {fullscreen ? null : (
            <IconButton label="드로어 닫기" onClick={onClose}>
              <X className="h-3 w-3" aria-hidden />
            </IconButton>
          )}
        </div>
      </div>

      <MeetingTitleInline meeting={meeting} meta={meta} size="drawer" locked={locked} />

      <div className="flex flex-wrap items-center gap-2.5">
        <MeetingDateTimeInline meeting={meeting} meta={meta} locked={locked} />
        {meeting.status === "generating" || meeting.status === "ended" ? (
          <MeetingStatusChip status={meeting.status} className="ml-auto h-7 text-caption" />
        ) : null}
      </div>
      {meta.notice}
    </header>
  );
}

/**
 * 드로어 헤더 — `renderHeader` 는 **여는 시점**에 불리므로 `meetingId` 만 안다. 같은 상세 쿼리를 다시 읽는다 —
 * TanStack Query 가 키를 합쳐 요청이 늘지 않는다. 로드 전에는 닫기만 둔다(빈 껍데기를 먼저 보여주지 않는다).
 */
export function MeetingDrawerHeaderConnected({
  meetingId,
  fullscreen,
  expand,
  onClose,
}: {
  meetingId: number;
  fullscreen: boolean;
  expand: (() => void) | null;
  onClose: () => void;
}) {
  const { data: meeting } = useMeetingDetail(meetingId);
  if (!meeting) {
    return (
      <header className="flex items-center justify-end gap-2 border-b border-divider px-7 pb-[18px] pt-5">
        <IconButton label={fullscreen ? "닫기" : "드로어 닫기"} onClick={onClose}>
          {fullscreen ? <ArrowLeft className="h-[15px] w-[15px]" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
        </IconButton>
      </header>
    );
  }
  return <DrawerHeader meeting={meeting} fullscreen={fullscreen} expand={expand} onClose={onClose} />;
}

export function MeetingDetailDrawer({ meetingId }: { meetingId: number }) {
  const { data: meeting, isPending, error, refetch } = useMeetingDetail(meetingId);

  if (isPending) {
    return <MeetingDetailSkeleton />;
  }
  if (error) {
    // **리다이렉트하지 않는다**(U-4 로딩 · 없는 항목 — SPEC-003 U-3 와 같다).
    return isMeetingNotFound(error) ? (
      <EmptyState
        message="없는 회의록입니다"
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/meetings/">목록으로</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        message="회의록을 불러오지 못했습니다"
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            다시 시도
          </Button>
        }
      />
    );
  }
  return <MeetingDetailBody meeting={meeting} mode="drawer" />;
}

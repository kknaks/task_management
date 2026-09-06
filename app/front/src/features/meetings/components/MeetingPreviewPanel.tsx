"use client";

/**
 * **우측 미리보기 패널**(SPEC-006 U-8 · 회의록.dc.html L148~228).
 *
 * 목록에서 고른 회의를 **읽기 전용**으로 보여준다 — 편집·입력은 없다(상세 페이지가 한다).
 * 헤더 64(제목 16/700 · 일시 범위 12 · 「상세보기」 30) → 탭 44 「회의록」/「원문」 → 본문 28/32.
 *
 * 본문은 **상태로 갈린다**(U-8 표) —
 * | `scheduled` | 사람 트랙 안건 목록(`MeetingAgendaList` 읽기 전용) + 하단 첨부 행 |
 * | `recording` | 「기록 중입니다」 + 「상세보기」 안내 — **미리보기는 스트림을 열지 않는다** |
 * | `generating` | 「회의록 생성중」 + 진행 표시 |
 * | `ended` + succeeded | **AI 한 줄 요약 바**(`headline` 있을 때만 · `MeetingStatusBar variant="headline"`) + 통합본 트리(**WORK-008 플레이스홀더**) + 첨부 행 |
 * | `ended` + failed | 요약 바 없이 사람 원본 트리 + 「통합 정리 실패」 캡션 |
 *
 * **그리지 않는 것**(§7): 「· 회의실 A」 · 「요약 · AI 생성」 문단 · 취소 행 · PNG 첨부 행.
 * `['meetings','detail',id]` 를 상세 페이지와 **공유**한다 — 삭제·생성·상태 변화가 목록에 반영되면 패널도 바뀐다.
 */

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { AttachmentList } from "@/components/shared/AttachmentList";
import { EmptyState } from "@/components/shared/EmptyState";
import { PanelTabs } from "@/components/shared/PanelTabs";
import { MeetingAgendaList } from "@/features/meetings/components/MeetingAgendaList";
import { formatBytes } from "@/features/meetings/components/MeetingAttachmentsTab";
import { MeetingDetailSkeleton } from "@/features/meetings/components/MeetingSkeleton";
import { MeetingStatusBar } from "@/features/meetings/components/MeetingStatusBar";
import { domainOf } from "@/components/shared/AttachmentList";
import { isMeetingNotFound } from "@/features/meetings/errors";
import { useMeetingDetail } from "@/features/meetings/hooks/useMeetingDetail";
import type { MeetingAttachment, MeetingDetail } from "@/features/meetings/types";
import { formatMeetingTimeRange } from "@/lib/datetime";

type PreviewTab = "notes" | "transcript";

const TABS = [
  { key: "notes", label: "회의록" },
  { key: "transcript", label: "원문" },
] as const;

export function meetingDetailHref(id: number): string {
  return `/meetings/detail/?id=${id}`;
}

/** U-8 첨부 행 메타 — 문서 「<크기> · <폴더 경로>」 / 링크 「<도메인>」(시안 L222~226 시각). */
function previewAttachmentMeta(attachment: MeetingAttachment): string {
  if (attachment.kind === "link") {
    return attachment.url ? domainOf(attachment.url) : "";
  }
  return [formatBytes(attachment.sizeBytes), attachment.folderPath]
    .filter((part) => part && part.length > 0)
    .join(" · ");
}

export function MeetingPreviewPanel({ meetingId }: { meetingId: number | null }) {
  const [tab, setTab] = useState<PreviewTab>("notes");
  const { data: meeting, isPending, error } = useMeetingDetail(meetingId);

  return (
    <section
      aria-label="회의록 미리보기"
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-card"
    >
      {meetingId === null ? (
        <EmptyState className="my-auto" message="회의록을 고르면 여기에 보입니다" />
      ) : isPending ? (
        <div className="p-8">
          <MeetingDetailSkeleton />
        </div>
      ) : error ? (
        <EmptyState
          className="my-auto"
          message={isMeetingNotFound(error) ? "없는 회의록입니다" : "회의록을 불러오지 못했습니다"}
        />
      ) : (
        <>
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border px-6">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <span className="truncate text-panel text-foreground">{meeting.title}</span>
              {/* 「· 회의실 A」는 **그리지 않는다** — 장소는 v1 에 없다(DEC-003 §1) */}
              <span className="text-caption text-fg-caption">
                {formatMeetingTimeRange(meeting.startAt, meeting.endAt)}
              </span>
            </div>
            <Link
              href={meetingDetailHref(meeting.id)}
              className="flex h-[30px] shrink-0 items-center rounded-control border border-border px-3 text-meta text-fg-meta hover:bg-muted hover:text-foreground"
            >
              상세보기
            </Link>
          </header>

          <PanelTabs ariaLabel="미리보기 탭" tabs={TABS} value={tab} onChange={setTab} className="px-6" />

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-7">
            {tab === "notes" ? <NotesBody meeting={meeting} /> : <TranscriptBody meeting={meeting} />}
          </div>
        </>
      )}
    </section>
  );
}

function NotesBody({ meeting }: { meeting: MeetingDetail }) {
  switch (meeting.status) {
    case "scheduled":
      return (
        <>
          <MeetingAgendaList
            agendas={meeting.agendas.human}
            readOnly
            empty={<EmptyState message="아직 안건이 없습니다" />}
          />
          <AttachmentRows attachments={meeting.attachments} />
        </>
      );
    case "recording":
      return (
        <EmptyState
          className="my-auto"
          message="기록 중입니다"
          hint="회의 중 화면은 「상세보기」에서 봅니다"
        />
      );
    case "generating":
      return (
        <div className="my-auto flex flex-col items-center gap-2 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          <p className="text-meta font-bold text-fg-meta">회의록 생성중</p>
        </div>
      );
    case "ended":
      return meeting.integrationState === "failed" ? (
        <>
          <p className="text-caption text-destructive">통합 정리 실패</p>
          <MeetingAgendaList
            agendas={meeting.agendas.human}
            readOnly
            empty={<EmptyState message="아직 안건이 없습니다" />}
          />
          <AttachmentRows attachments={meeting.attachments} />
        </>
      ) : (
        <>
          {/* **한 개만**, 본문 첫 요소. `headline` 이 `null` 이면 바가 **없다** — 빈 바를 두지 않는다 */}
          {meeting.headline ? (
            <MeetingStatusBar variant="headline" headline={meeting.headline} summary={meeting.mergedSummary} />
          ) : null}
          {/* 통합본(`merged`) 트리 렌더 규격은 SPEC-008 이 정본 — WORK-008 이 이 자리를 채운다 */}
          <EmptyState message="통합본 트리는 WORK-008 에서 만든다" />
          <AttachmentRows attachments={meeting.attachments} />
        </>
      );
  }
}

function TranscriptBody({ meeting }: { meeting: MeetingDetail }) {
  if (meeting.status === "ended") {
    // 트랜스크립트 — SPEC-007 스크립트 패널 규격을 읽기 전용으로. WORK-007·008 이 채운다.
    return <EmptyState className="my-auto" message="트랜스크립트는 WORK-007·008 에서 만든다" />;
  }
  return <EmptyState className="my-auto" message="아직 회의 전입니다" />;
}

/** 하단 첨부 행 — 구분선 위 `AttachmentList` 읽기 전용(제거 없음). 비어 있으면 줄 자체가 없다. */
function AttachmentRows({ attachments }: { attachments: readonly MeetingAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-divider pt-[18px]">
      <AttachmentList
        attachments={attachments}
        emptyMessage="첨부한 파일이 없습니다"
        renderMeta={previewAttachmentMeta}
      />
    </div>
  );
}

"use client";

/**
 * **회의 시작 전 화면**(SPEC-006 U-4 · 회의록.dc.html L565~646 · 첨부 탭 L739~757).
 *
 * breadcrumb 「홈 › 회의록 › 시작 전」 → 헤더(제목 28/700 · 서브 「… 예정 · <유형> · <프로젝트>」 · `⋯`(삭제) ·
 * 「회의 시작」 34) → **`MeetingStatusBar variant="waiting"`**(WORK-007 이 `MeetingTopBar` 를 흡수한 한 파일) → 좌 1160(회의록 | AI 요약) / 우 464(실시간 스크립트 | 첨부 파일 n).
 * 1280~1439 에서는 우 400(U-6).
 *
 * **없는 것**(§3·§7): 「회의 정보 수정」 버튼(L579) · 「새 안건 ▾」 칩 · 추천 칩 · 전송 버튼 · 「안건 초안을 만들어 줍니다」 ·
 * 푸터 「MacBook Pro 마이크 · 내 목소리 등록됨」(L643~645).
 *
 * - 「회의 시작」 → `POST /start` → 성공 시 캐시가 `recording` 이 되어 **스위치가 바뀐다**(페이지 이동 없음).
 *   409 → 토스트 + 상세 재조회. **낙관적이지 않다**
 * - 안건: `AgendaInputBar`(`Enter` + 「추가」) · `MeetingAgendaList`(인라인 편집 · 「제거」 확인 없음).
 *   자동 저장 실패는 **WORK-003 U-7 규격 그대로**(`useAgendaAutoSave`)
 * - 첨부: `MeetingAttachmentsTab` · 문서 행 → 파일 드로어 · 링크 행 → 기본 브라우저
 * - `⋯` → 「삭제」 → **U-5 모달** → 삭제 후 **목록으로 이동**
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DetailHeaderBar, HOME_CRUMB, MEETINGS_CRUMB, MEETINGS_ROUTE } from "@/components/shared/AppShell";
import { EmptyState } from "@/components/shared/EmptyState";
import { PanelTabs } from "@/components/shared/PanelTabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgendaInputBar } from "@/features/meetings/components/AgendaInputBar";
import { AgendaEmptyState, MeetingAgendaList } from "@/features/meetings/components/MeetingAgendaList";
import { AttachmentAddTrigger, MeetingAttachmentsTab } from "@/features/meetings/components/MeetingAttachmentsTab";
import { openMeetingDeleteModal } from "@/features/meetings/components/MeetingDeleteModal";
import { MeetingBadgeRow, useMeetingMetaSave } from "@/features/meetings/components/MeetingMetaInline";
import { MeetingStatusBar } from "@/features/meetings/components/MeetingStatusBar";
import { INVALID_STATUS_MESSAGE, isInvalidMeetingStatus, meetingInlineError } from "@/features/meetings/errors";
import { useAgendaAutoSave } from "@/features/meetings/hooks/useAgendaAutoSave";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import { openAttachmentFileDrawer } from "@/features/meetings/openMeetingDrawers";
import type { MeetingDetail } from "@/features/meetings/types";
import { formatMeetingTimeRange } from "@/lib/datetime";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

type LeftTab = "notes" | "ai";
type RightTab = "transcript" | "attachments";

export function MeetingScheduledPage({ meeting }: { meeting: MeetingDetail }) {
  const router = useRouter();
  const overlay = useOverlay();
  const mutations = useMeetingMutations(meeting.id);
  // 배지 줄의 유형 · 프로젝트 인라인 셀렉터가 쓰는 저장 훅(U-4 — 「누르면 팝오버 · `PATCH /api/meetings/{id}`」)
  const meta = useMeetingMetaSave(meeting);
  const agenda = useAgendaAutoSave(meeting.id);
  const [leftTab, setLeftTab] = useState<LeftTab>("notes");
  const [rightTab, setRightTab] = useState<RightTab>("transcript");

  const attachmentCount = meeting.attachments.length;

  const start = async () => {
    try {
      await mutations.start.mutateAsync(meeting.id);
    } catch (error) {
      // 이미 시작됐다(다른 창) — 토스트 + **상세 재조회**(Case Matrix `invalid_meeting_status`).
      if (isInvalidMeetingStatus(error)) {
        toast.error(INVALID_STATUS_MESSAGE);
        void mutations.refreshDetail();
        return;
      }
      toast.error(meetingInlineError(error)?.message ?? "회의를 시작하지 못했습니다");
    }
  };

  const confirmDelete = () =>
    openMeetingDeleteModal(overlay, meeting, async () => {
      await mutations.remove.mutateAsync(meeting.id);
      // 상세 페이지에서 지웠으면 **목록으로 이동**한다(U-5 기대 결과).
      router.push("/meetings/");
    });

  const addLink = async ({ url, label }: { url: string; label: string | null }) => {
    try {
      await mutations.addAttachment.mutateAsync({ kind: "link", url, label });
      return true;
    } catch (error) {
      toast.error(meetingInlineError(error)?.message ?? "저장하지 못했습니다 · 첨부");
      if (isInvalidMeetingStatus(error)) {
        void mutations.refreshDetail();
      }
      return false;
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    try {
      await mutations.removeAttachment.mutateAsync(attachmentId);
    } catch (error) {
      toast.error(meetingInlineError(error)?.message ?? "저장하지 못했습니다 · 첨부");
      void mutations.refreshDetail();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ① breadcrumb + 「←」 — 「홈」·「회의록」은 링크, 「←」는 `/meetings/`(MF-7 · FE §6-3) */}
      <DetailHeaderBar trail={[HOME_CRUMB, MEETINGS_CRUMB, { label: meeting.title }]} backTo={MEETINGS_ROUTE} />

      {/* 헤더 — ② 배지 줄 → ③ 제목 → ④ 메타(MF-8 · 업무 상세 헤더가 정본). 「회의 정보 수정」은 **없다**(§7) */}
      <header className="mt-2 flex min-w-0 flex-col gap-1.5">
        <MeetingBadgeRow
          meeting={meeting}
          meta={meta}
          locked={false}
          actions={
            <>
              <HeaderMoreMenu onDelete={confirmDelete} />
              <button
                type="button"
                onClick={() => void start()}
                disabled={mutations.start.isPending}
                className="flex h-[34px] items-center gap-2 rounded-control bg-primary px-[18px] text-meta font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {mutations.start.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                    <path d="M3 1.6 10 6l-7 4.4V1.6Z" />
                  </svg>
                )}
                회의 시작
              </button>
            </>
          }
        />
        <h1 className="truncate text-page-title text-foreground">{meeting.title}</h1>
        {/* 제목 · 일시의 수정 경로는 상세 드로어와 캘린더다(U-4) — 여기서는 표시만 */}
        <p data-header-meta className="text-meta text-fg-meta">
          {formatMeetingTimeRange(meeting.startAt, meeting.endAt)} · {meeting.durationMinutes}분 · 예정
        </p>
        {meta.notice}
      </header>

      {/* 상단 바 슬롯 — top 150 · 본문 폭 전체 · 56 */}
      <div className="mt-6">
        <MeetingStatusBar variant="waiting" />
      </div>

      {/* 좌 1160 / 우 464(1280~1439 는 400) — 둘 다 top 224 */}
      <div className="mt-[18px] flex min-h-[520px] min-w-0 flex-1 gap-4">
        <section
          aria-label="회의록"
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-card"
        >
          <PanelTabs
            size="md"
            ariaLabel="회의록 탭"
            value={leftTab}
            onChange={setLeftTab}
            tabs={[
              { key: "notes", label: "회의록", dotClassName: "bg-dot-idle" },
              { key: "ai", label: "AI 요약", dotClassName: "bg-dot-idle" },
            ]}
          />
          {leftTab === "notes" ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <MeetingAgendaList
                  agendas={meeting.agendas.human}
                  onRename={agenda.rename}
                  onRemove={(id) => void agenda.remove(id)}
                  hasFailed={agenda.hasFailed}
                  notice={agenda.notice}
                  empty={<AgendaEmptyState />}
                  className="px-6 py-5"
                />
              </div>
              <AgendaInputBar onAdd={agenda.add} adding={agenda.adding} />
            </>
          ) : (
            // **시작 전 AI 는 아무것도 하지 않는다**(BASE-003 L37 · DEC-003 §4)
            <EmptyState className="my-auto" message="회의를 시작하면 AI 요약이 여기에 쌓입니다" />
          )}
        </section>

        <section
          aria-label="실시간 스크립트 · 첨부 파일"
          className="flex w-[400px] shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-card wide:w-[464px]"
        >
          <PanelTabs
            ariaLabel="우측 패널 탭"
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { key: "transcript", label: "실시간 스크립트", dotClassName: "bg-dot-idle" },
              {
                key: "attachments",
                // **0 이면 숫자 생략**([09] L720)
                label: attachmentCount > 0 ? `첨부 파일 ${attachmentCount}` : "첨부 파일",
                dotClassName: "bg-dot-fixed",
              },
            ]}
            trailing={rightTab === "attachments" ? <AttachmentAddTrigger onAddLink={addLink} /> : null}
          />
          {rightTab === "transcript" ? (
            // 푸터 「MacBook Pro 마이크 · 내 목소리 등록됨」은 **없다**(§7 — M-10)
            <div className="my-auto flex flex-col items-center gap-2.5 px-6 text-center">
              <p className="text-section text-fg-meta">아직 회의 전입니다</p>
              <p className="text-meta text-fg-caption">회의를 시작하면 스크립트가 이 자리에 쌓입니다</p>
            </div>
          ) : (
            <MeetingAttachmentsTab
              attachments={meeting.attachments}
              onAddLink={addLink}
              onRemove={(attachment) => void removeAttachment(attachment.id)}
              onOpenDoc={(attachment) => openAttachmentFileDrawer(overlay, attachment)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** 헤더 `⋯` 30px 고스트(시안 없음 → [06] 패널 헤더 버튼 규격) — 항목은 「삭제」 하나. */
function HeaderMoreMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="더 보기"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-control text-fg-meta hover:bg-muted"
        >
          <MoreHorizontal className="h-[15px] w-[15px]" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-popover-menu rounded-card border-border bg-card p-1 shadow-popover">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left text-meta text-destructive hover:bg-muted [&_svg]:h-3.5 [&_svg]:w-3.5"
        >
          <Trash2 aria-hidden />
          삭제
        </button>
      </PopoverContent>
    </Popover>
  );
}

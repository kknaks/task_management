"use client";

/**
 * **회의 중 화면**(SPEC-007 §2 · 회의록.dc.html L761~1402) — `/meetings/detail?id=` 의 `status='recording'` 분기(F-10).
 *
 * breadcrumb 「홈 › 회의록 › 회의 중」 → 헤더(제목 28/700 · 부제 「MM월 DD일 (요일) HH:MM 시작 · <유형명>」 — **장소 없음** ·
 * [일시정지]/[재개] · [회의 종료]) → **`MeetingStatusBar`**(상단 바 한 자리 — 5상태) → 좌(회의록 | AI 요약) / 우(실시간 스크립트 | 첨부 파일 n).
 *
 * ## 조립만 한다 — 부품은 전부 공용이다
 *
 * `AgendaLineTree`(두 탭이 **같은 컴포넌트**, 차이는 prop) · `PromptBar` · `TranscriptPanel` · `MeetingStatusBar` · `useMeetingStream` ·
 * WORK-006 의 `MeetingAttachmentsTab`·`AttachmentAddTrigger`·`openAttachmentFileDrawer`(첨부 열기 드로어 — 두 벌 만들지 않는다).
 *
 * ## 연결은 사용자 동작에만 붙는다
 *
 * `useMeetingStream` 은 `paused/stream` 으로 시작한다. **「회의 시작」을 이 세션에서 눌렀을 때만**(`meetingStartIntent` 표지) 진입 즉시
 * `resume()` 을 부른다(S-1). 새로고침·재실행은 표지가 없어 「서버 연결이 끊겼습니다」로 시작하고 사용자가 「재개」를 누른다(State/Lifecycle).
 *
 * ## 없는 것(§7-B · 정책)
 *
 * 상태 바 파형·「자동 저장」 · 부제 「회의실 A」 · 프롬프트 「+」 · AI 요약 카드 · 첨부 PNG/PDF·「회의 중 작성」 · 잠정 발화 시각 ·
 * 화자 이름 입력 · 사람 줄 편집/삭제 · 안건 제목 수정 · AI 줄 업무 버튼 · 「다시 연결」 버튼(재개가 그 역할) · 자동 재연결 · 낙관적 갱신.
 * 「회의 종료」는 **자리 + 활성 조건**(`connecting` 빼고 활성 — `paused/stream` 에서도)만 두고 동작은 WORK-008(`onEnd`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";

import { Breadcrumb } from "@/components/shared/AppShell";
import { PanelTabs } from "@/components/shared/PanelTabs";
import { LIVE_AGENDA_BADGE } from "@/features/meetings/agendaBadges";
import { AgendaLineTree, type AgendaBadge } from "@/features/meetings/components/AgendaLineTree";
import { AttachmentAddTrigger, MeetingAttachmentsTab } from "@/features/meetings/components/MeetingAttachmentsTab";
import { MeetingStatusBar, type MeetingStatusBarProps } from "@/features/meetings/components/MeetingStatusBar";
import { PromptBar } from "@/features/meetings/components/PromptBar";
import { TranscriptPanel, type TranscriptPanelHandle } from "@/features/meetings/components/TranscriptPanel";
import { INVALID_STATUS_MESSAGE, isInvalidMeetingStatus, meetingInlineError } from "@/features/meetings/errors";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import { speakerCountOf, useTranscriptQuery } from "@/features/meetings/hooks/useMeetingLive";
import { useMeetingStream } from "@/features/meetings/hooks/useMeetingStream";
import { openAttachmentFileDrawer } from "@/features/meetings/openMeetingDrawers";
import type { AgendaState, LineKind, MeetingAgenda, MeetingDetail, StreamStatus } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { formatClockMs, formatMeetingDateTime } from "@/lib/datetime";
import { useOverlay } from "@/lib/overlay/OverlayProvider";

type LeftTab = "notes" | "ai";
type RightTab = "transcript" | "attachments";

/** 회의 중 어휘(DEC-003 §1 표 · SPEC-007 §7-A) — `next` 는 **「대기」**. 정의는 `agendaBadges.ts`(WORK-008 이 올렸다 — 종료 후 「다음 논의로」는 `closeState.ts`). */
export { LIVE_AGENDA_BADGE };

/** AI 가 새로 만든 안건(`sourceAgendaId: null`)의 캡션(U-4). */
const AI_AGENDA_CAPTION: AgendaBadge = { tone: "caption", label: "AI 안건" };

const SEND_FAILED_MESSAGE = "저장하지 못했습니다 · 다시 보내 주세요";
const AGENDA_FAILED_MESSAGE = "저장하지 못했습니다 · 안건";

function statusBarProps(status: StreamStatus, elapsedFrom: string | null): MeetingStatusBarProps {
  switch (status.kind) {
    case "connecting":
      return { variant: "connecting", elapsedFrom };
    case "live":
      return { variant: "live", elapsedFrom: elapsedFrom ?? "" };
    case "paused":
      return { variant: "paused", pauseReason: status.reason, elapsedFrom };
  }
}

export function MeetingLiveView({ meeting, onEnd }: { meeting: MeetingDetail; onEnd?: () => void }) {
  const client = useQueryClient();
  const overlay = useOverlay();
  const mutations = useMeetingMutations(meeting.id);
  const stream = useMeetingStream({ meetingId: meeting.id });
  const transcript = useTranscriptQuery(meeting.id);
  const transcriptRef = useRef<TranscriptPanelHandle>(null);

  const [leftTab, setLeftTab] = useState<LeftTab>("notes");
  const [rightTab, setRightTab] = useState<RightTab>("transcript");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [seenAiVersion, setSeenAiVersion] = useState(0);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [pendingRange, setPendingRange] = useState<{ fromMs: number; toMs: number; nonce: number } | null>(null);

  // 「회의 시작」 표지 — 이 세션에서 눌렀을 때만 바로 연다(S-1). 표지는 한 번 읽고 지운다.
  const resumeRef = useRef(stream.resume);
  resumeRef.current = stream.resume;
  useEffect(() => {
    const key = queryKeys.meetingStartIntent(meeting.id);
    if (client.getQueryData(key)) {
      client.removeQueries({ queryKey: key });
      void resumeRef.current();
    }
  }, [client, meeting.id]);

  // AI 탭을 열면 미확인 점이 꺼진다(U-4).
  useEffect(() => {
    if (leftTab === "ai") {
      setSeenAiVersion(stream.aiVersion);
    }
  }, [leftTab, stream.aiVersion]);

  // 근거 칩 → 스크립트 탭이 그려진 **뒤에** 스크롤한다(첨부 탭을 보고 있었어도 — U-6).
  useEffect(() => {
    if (pendingRange && rightTab === "transcript") {
      transcriptRef.current?.scrollToRange(pendingRange.fromMs, pendingRange.toMs);
      setPendingRange(null);
    }
  }, [pendingRange, rightTab]);

  const recordingStartedAt = stream.recordingStartedAt ?? meeting.recordingStartedAt;
  const human = meeting.agendas.human;
  const activeAgenda = human.find((agenda) => agenda.state === "active") ?? null;
  const humanById = useMemo(() => new Map(human.map((agenda) => [agenda.id, agenda])), [human]);
  const unseenAi = stream.aiVersion > seenAiVersion && leftTab !== "ai";
  const paused = stream.status.kind === "paused";
  const speakerCount = speakerCountOf(transcript.data);
  const attachmentCount = meeting.attachments.length;

  const humanBadge = (agenda: MeetingAgenda): AgendaBadge => (agenda.state ? LIVE_AGENDA_BADGE[agenda.state] : null);
  const aiBadge = (agenda: MeetingAgenda): AgendaBadge => {
    if (agenda.sourceAgendaId === null) {
      return AI_AGENDA_CAPTION;
    }
    const source = humanById.get(agenda.sourceAgendaId);
    return source?.state ? LIVE_AGENDA_BADGE[source.state] : null;
  };

  /** 화면이 낡아서 난 실패(409·404) — 토스트 + 상세 재조회(Case Matrix). */
  const handleStale = (error: unknown): boolean => {
    if (isInvalidMeetingStatus(error)) {
      toast.error(INVALID_STATUS_MESSAGE);
      void mutations.refreshDetail();
      return true;
    }
    if (isApiError(error) && error.code === API_ERROR_CODE.NOT_FOUND) {
      void mutations.refreshDetail();
      return true;
    }
    return false;
  };

  const setAgendaState = async (agendaId: number, state: AgendaState): Promise<boolean> => {
    try {
      await mutations.setAgendaState.mutateAsync({ agendaId, state });
      setLastSavedAt(Date.now());
      return true;
    } catch (error) {
      if (!handleStale(error)) {
        // 배지는 서버 값 그대로다 — 낙관적으로 바꾼 적이 없으니 되돌릴 것도 없다(§5).
        toast.error(AGENDA_FAILED_MESSAGE);
      }
      return false;
    }
  };

  const sendLine = async (kind: LineKind, content: string): Promise<boolean> => {
    if (!activeAgenda) {
      return false;
    }
    try {
      await mutations.addLine.mutateAsync({ agendaId: activeAgenda.id, kind, content });
      setInlineError(null);
      setLastSavedAt(Date.now());
      return true;
    } catch (error) {
      if (isApiError(error) && error.code === API_ERROR_CODE.VALIDATION_ERROR) {
        // 프롬프트 바 아래 인라인 · 입력 유지(Case Matrix).
        setInlineError(error.detail);
        return false;
      }
      if (!handleStale(error)) {
        toast.error(SEND_FAILED_MESSAGE);
      }
      return false;
    }
  };

  /** 「새 안건」 — `POST agendas` → 201 → `PATCH state:"active"`. 두 요청이 순서대로 나간다(U-3). */
  const createAgenda = async (title: string): Promise<boolean> => {
    const before = new Set(human.map((agenda) => agenda.id));
    let created: MeetingAgenda | undefined;
    try {
      const detail = await mutations.addAgenda.mutateAsync(title);
      created = detail.agendas.human.find((agenda) => !before.has(agenda.id));
      setLastSavedAt(Date.now());
    } catch (error) {
      if (!handleStale(error)) {
        toast.error(meetingInlineError(error)?.message ?? AGENDA_FAILED_MESSAGE);
      }
      return false;
    }
    if (created) {
      await setAgendaState(created.id, "active");
    }
    return true;
  };

  const chipClick = (fromMs: number, toMs: number): boolean => {
    const items = transcript.data?.items ?? [];
    if (!items.some((item) => item.atMs <= toMs && item.endMs >= fromMs)) {
      return false;
    }
    setRightTab("transcript");
    setPendingRange({ fromMs, toMs, nonce: Date.now() });
    return true;
  };

  const addLink = async ({ url, label }: { url: string; label: string | null }) => {
    try {
      await mutations.addAttachment.mutateAsync({ kind: "link", url, label });
      return true;
    } catch (error) {
      if (!handleStale(error)) {
        toast.error(meetingInlineError(error)?.message ?? "저장하지 못했습니다 · 첨부");
      }
      return false;
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    try {
      await mutations.removeAttachment.mutateAsync(attachmentId);
    } catch (error) {
      if (!handleStale(error)) {
        toast.error(meetingInlineError(error)?.message ?? "저장하지 못했습니다 · 첨부");
      }
    }
  };

  const sending = mutations.addLine.isPending || mutations.addAgenda.isPending || mutations.setAgendaState.isPending;
  const connecting = stream.status.kind === "connecting";
  const outlineButton =
    "flex h-[34px] items-center gap-[7px] rounded-control border border-border bg-card px-3.5 text-meta text-fg-meta hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb trail={["홈", "회의록", "회의 중"]} />

      <header className="mt-2 flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-page-title text-foreground">{meeting.title}</h1>
          {/* 부제 — 날짜 · 유형명. **「회의실 A」 같은 장소는 없다**(DEC-003 §1 표) */}
          <p className="text-meta text-fg-meta">
            {formatMeetingDateTime(meeting.startAt)} 시작 · {meeting.workType.name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {paused ? (
            <button
              type="button"
              onClick={() => void stream.resume()}
              disabled={!stream.canResume}
              className={outlineButton}
            >
              <Play className="h-[13px] w-[13px]" aria-hidden />
              재개
            </button>
          ) : (
            <button type="button" onClick={stream.pause} disabled={connecting} className={outlineButton}>
              {connecting ? <Loader2 className="h-[13px] w-[13px] animate-spin" aria-hidden /> : <Pause className="h-[13px] w-[13px]" aria-hidden />}
              일시정지
            </button>
          )}
          {/* 자리 + 활성 조건만(SPEC-007 U-1) — `connecting` 빼고 항상 활성. 동작(`/end`)은 WORK-008 */}
          <button
            type="button"
            onClick={onEnd}
            disabled={connecting}
            className="flex h-[34px] items-center gap-[7px] rounded-control bg-primary px-4 text-meta font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Square className="h-[11px] w-[11px] fill-current" aria-hidden />
            회의 종료
          </button>
        </div>
      </header>

      {/* 상단 바 슬롯 — top 150 · 본문 폭 · 56. 회의 생애 전체에서 한 자리([09] L733) */}
      <div className="mt-6">
        <MeetingStatusBar {...statusBarProps(stream.status, recordingStartedAt)} />
      </div>

      {/*
        좌 1fr / 우 464 → 400(≥1440) · 우 400 고정(1280~1439) — U-8. 우 열은 `clamp(400, 컨테이너 − 좌 1160 − gap, 464)` 라
        1640 에서 464, 좁아지면 우가 먼저 400 까지 줄고 그 뒤 좌가 준다. 높이는 뷰포트에 맞추고 패널 안에서 스크롤한다.
      */}
      <div className="mt-[18px] grid h-[calc(100vh-274px)] min-h-[480px] min-w-0 grid-cols-[minmax(0,1fr)_clamp(400px,calc(100%-1176px),464px)] gap-4">
        <section
          aria-label="회의록"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-card"
        >
          <PanelTabs
            size="md"
            ariaLabel="회의록 탭"
            value={leftTab}
            onChange={setLeftTab}
            tabs={[
              { key: "notes", label: "회의록", dotClassName: "bg-dot-idle" },
              {
                key: "ai",
                label: (
                  <span className="flex items-center gap-1.5">
                    AI 요약
                    {/* 미확인 증분 점 6px(U-4) — AI 탭을 열면 꺼진다 */}
                    {unseenAi ? <span aria-hidden data-testid="ai-unseen" className="h-1.5 w-1.5 rounded-full bg-dot-ai" /> : null}
                  </span>
                ),
                dotClassName: "bg-dot-ai",
                halo: true,
              },
            ]}
          />

          {/* 안내 바 48 — 회의록: 입력 안내 + 「자동 저장 · HH:MM」 / AI: 「첫 배치를 기다리는 중」·「배치 n회 반영 · HH:MM」 */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-6">
            {leftTab === "notes" ? (
              <span className="text-caption text-fg-caption">
                입력창에서 <span className="font-bold text-ai-bar-badge">/</span> 를 입력해 안건 · 논의 · 결정 · 업무 · 액션을 고릅니다
              </span>
            ) : null}
            <span className="ml-auto text-caption text-fg-caption" data-testid={leftTab === "notes" ? "autosave-caption" : "batch-caption"}>
              {leftTab === "notes"
                ? lastSavedAt
                  ? `자동 저장 · ${formatClockMs(lastSavedAt)}`
                  : ""
                : meeting.latestBatchSeq > 0
                  ? `배치 ${meeting.latestBatchSeq}회 반영${stream.lastBatchAt ? ` · ${formatClockMs(stream.lastBatchAt)}` : ""}`
                  : "첫 배치를 기다리는 중"}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-[22px]">
            {leftTab === "notes" ? (
              <AgendaLineTree
                agendas={human}
                activeAgendaId={activeAgenda?.id ?? null}
                expandable={false}
                onToggleDone={(agenda) => void setAgendaState(agenda.id, agenda.state === "done" ? "next" : "done")}
                badgeFor={humanBadge}
                recordingStartedAt={recordingStartedAt}
                empty={<p className="text-meta text-fg-caption">/ 로 첫 안건을 만들어 기록을 시작합니다</p>}
              />
            ) : (
              <AgendaLineTree
                agendas={meeting.agendas.ai}
                expandable
                onChipClick={chipClick}
                badgeFor={aiBadge}
                recordingStartedAt={recordingStartedAt}
                empty={
                  <p className="flex h-full min-h-40 items-center justify-center text-center text-meta text-fg-faint">
                    기록이 쌓이면 요약이 생성됩니다
                  </p>
                }
              />
            )}
          </div>

          {leftTab === "notes" ? (
            <PromptBar
              agendas={human}
              activeAgendaId={activeAgenda?.id ?? null}
              sending={sending}
              inlineError={inlineError}
              onSendLine={sendLine}
              onCreateAgenda={createAgenda}
              onActivateAgenda={(agendaId) => setAgendaState(agendaId, "active")}
            />
          ) : (
            <div className="flex h-12 shrink-0 items-center border-t border-divider px-6">
              <span className="text-caption text-fg-caption">회의 종료 시 안건별 요약이 회의록에 반영됩니다</span>
            </div>
          )}
        </section>

        <section
          aria-label="실시간 스크립트 · 첨부 파일"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-card"
        >
          <PanelTabs
            ariaLabel="우측 패널 탭"
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { key: "transcript", label: "실시간 스크립트", dotClassName: "bg-primary", halo: true },
              {
                key: "attachments",
                // **0 이면 숫자 생략**([09] L720)
                label: attachmentCount > 0 ? `첨부 파일 ${attachmentCount}` : "첨부 파일",
                dotClassName: "bg-dot-fixed",
              },
            ]}
            trailing={
              rightTab === "attachments" ? (
                <AttachmentAddTrigger onAddLink={addLink} />
              ) : speakerCount > 0 ? (
                // 익명 라벨 수까지만 — **이름 입력 자리 없음**(DEC-003 §2 · M-10)
                <span className="text-caption text-fg-caption">화자 {speakerCount}명</span>
              ) : null
            }
          />

          {rightTab === "transcript" ? (
            transcript.isError ? (
              // 가리지 않는다 — 빈 목록으로 대체하지 않는다(Case Matrix · FE §3-5)
              <div className="my-auto flex flex-col items-center gap-3 px-6 text-center">
                <p className="text-meta text-fg-caption">불러오지 못했습니다</p>
                <button
                  type="button"
                  onClick={() => void transcript.refetch()}
                  className="flex h-8 items-center rounded-control border border-border bg-card px-3 text-meta text-fg-meta hover:bg-muted"
                >
                  다시 시도
                </button>
              </div>
            ) : transcript.isPending ? (
              <p className="my-auto text-center text-meta text-fg-caption">불러오는 중…</p>
            ) : (
              <TranscriptPanel
                ref={transcriptRef}
                items={transcript.data.items}
                partial={stream.partial}
                recordingStartedAt={recordingStartedAt}
                paused={paused}
              />
            )
          ) : (
            // WORK-006 첨부 탭 그대로 — 목록 · 추가 팝오버 · 로컬 업로드 V2Gate. 문서 행 → 파일 드로어(이동 없음 — U-7)
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

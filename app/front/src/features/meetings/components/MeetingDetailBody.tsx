"use client";

/**
 * **드로어와 전체 페이지가 공유하는 유일한 본문**(SPEC-008 U-1 ~ U-5 · U-7 · WP §Internal Interface Contract).
 *
 * > 두 표면의 차이는 감싸는 껍데기(스크림 · 헤더 · 2단 배치)뿐이고 규격은 한 벌이다.
 * > 드로어에서 빠진 것은 규격이 다른 게 아니라 **없는 것**이고, 그 목록은 「편집 · 줄 버튼 · 스크립트 패널 · 첨부 쓰기」 넷이 전부다(U-4).
 *
 * ## 상단 바 슬롯 — 이 파일 **하나**가 그린다(정적 검사)
 *
 * | `generating` | `MeetingStatusBar variant="generating"` — 스피너 + 단계 문구 + 「경과」 · 폴링 실패면 「다시 확인」 |
 * | `ended`+`failed` | `variant="failed"` — 배너 + 「다시 생성」 |
 * | `ended`+`succeeded` · `headline` 있음 | `variant="headline"` — 페이지 56 한 줄 / 드로어 72 두 줄. **`null` 이면 그리지 않는다** |
 *
 * ## 트리는 WORK-007 컴포넌트 하나를 **`agendas.merged`(또는 사람 원본)** 로 부를 뿐이다
 *
 * 회의록 탭이 그리는 트랙은 `notesTrackOf`(성공 통합본 · 그 밖 사람 원본), 편집 대상은 `editTrackOf` — 트리는 트랙을 모른다.
 * 배지 어휘는 종료 후 것(「다음 논의로」). 회의록 탭 화살표는 `detail`·`evidence` 있는 줄만(U-5). AI 탭은 SPEC-007 U-4 그대로.
 *
 * ## `mode`
 *
 * `page` — 「편집」 · 편집 모드(U-7) · 줄 「제거」 · **줄 버튼(업무 생성 · 업무 갱신 — U-6, 회의록 탭만)** · 드로어 U-9 · U-10 ·
 * 우 패널(스크립트 | 첨부 n 쓰기) · 근거 칩 → 스크립트 스크롤.
 * `drawer` — 캡션 「편집과 업무 연동은 전체 페이지에서 합니다」 · 칩은 표시만 · 첨부 n 읽기 전용 · `scheduled`/`recording` 스냅숏 · 줄 버튼 없음.
 * 업무 연동의 요청은 `useMeetingTaskLink` 하나(생성 · 갱신 각 뮤테이션 하나) — 판정은 서버 `task_service` 다.
 * 부모를 모른다 — 라우터를 import 하지 않는다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AttachmentList, domainOf } from "@/components/shared/AttachmentList";
import { EmptyState } from "@/components/shared/EmptyState";
import { PanelTabs } from "@/components/shared/PanelTabs";
import { AgendaLineTree, type AgendaBadge } from "@/features/meetings/components/AgendaLineTree";
import { AttachmentAddTrigger, formatBytes, MeetingAttachmentsTab } from "@/features/meetings/components/MeetingAttachmentsTab";
import { AgendaEmptyState, MeetingAgendaList } from "@/features/meetings/components/MeetingAgendaList";
import { MeetingStatusBar } from "@/features/meetings/components/MeetingStatusBar";
import { openLineDeleteModal } from "@/features/meetings/components/LineDeleteModal";
import { TranscriptPanel, type TranscriptPanelHandle } from "@/features/meetings/components/TranscriptPanel";
import { LIVE_AGENDA_BADGE } from "@/features/meetings/agendaBadges";
import { editTrackOf, endedAiBadge, endedNotesBadge, notesAgendasOf } from "@/features/meetings/closeState";
import { INTEGRATE_FAILED_MESSAGE, INVALID_STATUS_MESSAGE, isInvalidMeetingStatus, meetingInlineError } from "@/features/meetings/errors";
import { useMeetingEdit } from "@/features/meetings/hooks/useMeetingEdit";
import { useMeetingFinalizeJob } from "@/features/meetings/hooks/useMeetingFinalizeJob";
import { speakerCountOf, useTranscriptQuery } from "@/features/meetings/hooks/useMeetingLive";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import { openAddLineDrawer } from "@/features/meetings/components/AddLineDrawer";
import { openAttachmentFileDrawer } from "@/features/meetings/components/AttachmentFileDrawer";
import { openCreateTaskFromLineDrawer } from "@/features/meetings/components/CreateTaskFromLineDrawer";
import { openLinkTaskDrawer } from "@/features/meetings/components/LinkTaskDrawer";
import { LineTaskButton } from "@/features/meetings/components/LineTaskButton";
import { useMeetingTaskLink } from "@/features/meetings/hooks/useMeetingTaskLink";
import type { MeetingAgenda, MeetingAttachment, MeetingDetail, MeetingLine } from "@/features/meetings/types";
import { formatClock } from "@/lib/datetime";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export type MeetingDetailMode = "page" | "drawer";

type LeftTab = "notes" | "ai";
type RightTab = "transcript" | "attachments";

export const DRAWER_EDIT_CAPTION = "편집과 업무 연동은 전체 페이지에서 합니다";
export const DRAWER_CHIP_CAPTION = "스크립트는 전체 페이지에서 볼 수 있습니다";
export const GENERATING_NOTES_CAPTION = "통합이 끝나면 이 탭이 통합본으로 바뀝니다";
export const EDITING_CAPTION = "변경은 자동 저장됩니다";
export const DRAWER_SCHEDULED_CAPTION = "회의 시작은 전체 페이지에서 합니다";
export const DRAWER_RECORDING_CAPTION = "진행 중인 회의입니다 · 전체 페이지에서 보기";

/** 통합본 줄의 화살표 — `detail`·`evidence` 둘 다 없으면 없다(U-5). */
function notesExpandable(line: MeetingLine): boolean {
  return Boolean(line.detail) || line.evidence.length > 0;
}

/** AI 탭 안내 바 우측(U-1 · U-2 · U-3) — `finalBatchState` · `latestBatchSeq` 파생. */
function aiCaption(meeting: MeetingDetail): string {
  const batches = meeting.latestBatchSeq > 0 ? `배치 ${meeting.latestBatchSeq}회 반영 · ` : "";
  if (meeting.status === "generating") {
    return `${batches}종결 정리 중`;
  }
  if (meeting.finalBatchState === "succeeded") {
    // 마지막 배치 성공 시각은 `MeetingDetail` 에 없다 — 통합 시각(`mergedSummary.integratedAt`)으로 대신 적는다(보고 「실물 확인 필요」).
    const at = meeting.mergedSummary?.integratedAt ?? meeting.updatedAt;
    return `종결 · ${formatClock(at)}`;
  }
  return `${batches}종결 정리 실패`;
}

export function MeetingDetailBody({ meeting, mode }: { meeting: MeetingDetail; mode: MeetingDetailMode }) {
  const overlay = useOverlay();
  const mutations = useMeetingMutations(meeting.id);
  const finalize = useMeetingFinalizeJob(meeting);
  const edit = useMeetingEdit(meeting);
  const taskLink = useMeetingTaskLink(meeting);
  const isPage = mode === "page";
  const transcript = useTranscriptQuery(meeting.id, isPage && meeting.status !== "scheduled");
  const transcriptRef = useRef<TranscriptPanelHandle>(null);

  const [leftTab, setLeftTab] = useState<LeftTab>("notes");
  const [rightTab, setRightTab] = useState<RightTab>("transcript");
  const [editing, setEditing] = useState(false);
  const [pendingRange, setPendingRange] = useState<{ fromMs: number; toMs: number; nonce: number } | null>(null);

  const editTrack = editTrackOf(meeting);
  const canEdit = isPage && editTrack !== null;
  // 편집 중에 상태가 바뀌면(다른 창에서 「다시 생성」 등) 보기 모드로 돌아간다 — 잠금이 먼저다.
  useEffect(() => {
    if (!canEdit && editing) {
      setEditing(false);
    }
  }, [canEdit, editing]);

  // 근거 칩 → 스크립트 탭이 그려진 뒤에 스크롤한다(U-6 — WORK-007 규칙 그대로).
  useEffect(() => {
    if (pendingRange && rightTab === "transcript") {
      transcriptRef.current?.scrollToRange(pendingRange.fromMs, pendingRange.toMs);
      setPendingRange(null);
    }
  }, [pendingRange, rightTab]);

  const humanById = useMemo(() => new Map(meeting.agendas.human.map((agenda) => [agenda.id, agenda])), [meeting.agendas.human]);
  const notesAgendas = notesAgendasOf(meeting);
  const editAgendas = editTrack ? meeting.agendas[editTrack] : [];
  const recordingStartedAt = meeting.recordingStartedAt;
  const attachmentCount = meeting.attachments.length;
  const generating = meeting.status === "generating";
  const ended = meeting.status === "ended";

  const chipClick = isPage
    ? (fromMs: number, toMs: number): boolean => {
        const items = transcript.data?.items ?? [];
        if (!items.some((item) => item.atMs <= toMs && item.endMs >= fromMs)) {
          return false;
        }
        setRightTab("transcript");
        setPendingRange({ fromMs, toMs, nonce: Date.now() });
        return true;
      }
    : undefined;

  const regenerate = async () => {
    try {
      await finalize.integrate();
    } catch (error) {
      if (isInvalidMeetingStatus(error)) {
        toast.error(INVALID_STATUS_MESSAGE);
        void mutations.refreshDetail();
        return;
      }
      toast.error(meetingInlineError(error)?.message ?? INTEGRATE_FAILED_MESSAGE);
    }
  };

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

  /* ── 상단 바 슬롯 — 세 상태가 한 자리를 나눠 쓴다([09] L733) ─────────────────────────────── */
  const topBar = generating ? (
    <MeetingStatusBar
      variant="generating"
      phase={finalize.phase}
      attempt={finalize.attempt}
      elapsedFromMs={finalize.startedAtMs}
      pollFailed={finalize.pollFailed}
      onRecheck={finalize.recheck}
    />
  ) : ended && meeting.integrationState === "failed" ? (
    <MeetingStatusBar variant="failed" onRegenerate={() => void regenerate()} regenerating={finalize.integrating} />
  ) : ended && meeting.headline ? (
    <MeetingStatusBar variant="headline" headline={meeting.headline} summary={meeting.mergedSummary} layout={isPage ? "single" : "stacked"} />
  ) : null;

  /* ── 드로어의 시작 전 · 회의 중 스냅숏(U-4) ──────────────────────────────────────────────── */
  if (!isPage && meeting.status === "scheduled") {
    return (
      <div data-testid="meeting-detail-body" data-mode={mode} className="flex flex-col gap-5">
        <p className="text-caption text-fg-caption">{DRAWER_SCHEDULED_CAPTION}</p>
        <MeetingAgendaList agendas={meeting.agendas.human} readOnly empty={<AgendaEmptyState />} />
        <AttachmentRows attachments={meeting.attachments} />
      </div>
    );
  }
  if (!isPage && meeting.status === "recording") {
    const liveBadge = (agenda: MeetingAgenda): AgendaBadge => (agenda.state ? LIVE_AGENDA_BADGE[agenda.state] : null);
    return (
      <div data-testid="meeting-detail-body" data-mode={mode} className="flex flex-col gap-5">
        <p className="text-caption text-fg-caption">{DRAWER_RECORDING_CAPTION}</p>
        {/* 사람 트랙 스냅숏 — **WS 를 붙이지 않는다**(FE §8 「`useMeetingStream` 하나가 소유」) */}
        <AgendaLineTree
          agendas={meeting.agendas.human}
          expandable={false}
          badgeFor={liveBadge}
          recordingStartedAt={recordingStartedAt}
          empty={<p className="text-meta text-fg-caption">아직 기록이 없습니다</p>}
        />
        <AttachmentRows attachments={meeting.attachments} />
      </div>
    );
  }

  /* ── 편집 모드 슬롯(U-7 — 페이지 · `ended` 만) ─────────────────────────────────────────── */
  const renderLineAction = (line: MeetingLine) => (
    <button
      type="button"
      aria-label={`줄 제거`}
      onClick={() => openLineDeleteModal(overlay, line, () => edit.deleteLineConfirmed(line).then(() => undefined))}
      className="shrink-0 rounded-chip px-1.5 text-caption text-fg-caption opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
    >
      제거
    </button>
  );
  /* ── 업무 연동(U-6 · U-9 · U-10 — 페이지 · 회의록 탭만) ───────────────────────────────────── */
  const openCreate = (agenda: MeetingAgenda, line: MeetingLine | null) =>
    openCreateTaskFromLineDrawer(overlay, {
      agendas: editAgendas,
      agendaId: agenda.id,
      line,
      meetingProject: meeting.project,
      onCreateFromLine: taskLink.createTaskFromLine,
      onAddNewTask: edit.addLineFromDrawer,
    });
  const openLink = (agenda: MeetingAgenda) =>
    openLinkTaskDrawer(overlay, {
      meetingProject: meeting.project,
      agendaId: agenda.id,
      onAdd: edit.addLineFromDrawer,
      // ② — 변경이 있을 때만. `applyPendingChange` 는 던지지 않는다(실패는 토스트 · 줄은 「업무 갱신」 활성으로 남는다)
      onLinked: (line, hasChange) => {
        if (hasChange) {
          void taskLink.applyPendingChange(line);
        }
      },
    });
  // 줄 버튼 슬롯 — 보기 · 편집 모드 같은 자리. `generating` 이면 전부 잠금(U-1). 드로어 · AI 탭에는 없다
  const renderLineActions = isPage
    ? (line: MeetingLine, agenda: MeetingAgenda) => (
        <LineTaskButton
          line={line}
          locked={!canEdit}
          busy={taskLink.applyingLineId === line.id}
          onCreate={(target) => openCreate(agenda, target)}
          onApply={(target) => void taskLink.applyPendingChange(target)}
        />
      )
    : undefined;

  const renderAgendaFooter = (agenda: MeetingAgenda) => {
    const chip = "flex h-7 items-center gap-[5px] rounded-md border border-chip-border px-2.5 text-caption text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
    const openAdd = (kind: "discussion" | "decision") =>
      openAddLineDrawer(overlay, { meeting, agendas: editAgendas, agendaId: agenda.id, kind, onAdd: edit.addLineFromDrawer });
    return (
      <div className="ml-[37px] flex items-center gap-1.5 pt-1.5">
        <button type="button" onClick={() => openAdd("discussion")} className={chip}>
          <Plus className="h-2.5 w-2.5" aria-hidden />
          논의
        </button>
        <button type="button" onClick={() => openAdd("decision")} className={chip}>
          <Plus className="h-2.5 w-2.5" aria-hidden />
          결정
        </button>
        {/* 「+ 연관 업무」(U-9) — 줄 추가 → 변경이 있으면 곧바로 U-6 「업무 갱신」과 같은 요청(다른 요청 · ②가 실패해도 줄은 있다) */}
        <button type="button" onClick={() => openLink(agenda)} className={chip}>
          <Plus className="h-2.5 w-2.5" aria-hidden />
          연관 업무
        </button>
        {/* 「+ 액션 아이템」(U-10 칩 진입) — 업무 생성 + 줄 한 요청 */}
        <button type="button" onClick={() => openCreate(agenda, null)} className={chip}>
          <Plus className="h-2.5 w-2.5" aria-hidden />
          액션 아이템
        </button>
      </div>
    );
  };

  const notesTree = (
    <AgendaLineTree
      agendas={editing ? editAgendas : notesAgendas}
      expandable={editing ? false : notesExpandable}
      onChipClick={chipClick}
      chipCaption={isPage ? undefined : DRAWER_CHIP_CAPTION}
      badgeFor={endedNotesBadge}
      recordingStartedAt={recordingStartedAt}
      renderLineActions={renderLineActions}
      empty={<p className="text-meta text-fg-caption">기록된 안건이 없습니다</p>}
      editable={editing}
      onSaveLineContent={edit.saveLineContent}
      onChangeKind={(line, kind) => void edit.changeLineKind(line, kind)}
      onRenameAgenda={edit.renameAgendaTitle}
      renderLineAction={renderLineAction}
      renderAgendaFooter={renderAgendaFooter}
      lineSaveFailed={edit.lineSaveFailed}
      agendaSaveFailed={edit.agendaSaveFailed}
      lineAttempted={edit.lineAttempted}
      agendaAttempted={edit.agendaAttempted}
    />
  );

  const aiTree = (
    <AgendaLineTree
      agendas={meeting.agendas.ai}
      expandable
      onChipClick={chipClick}
      chipCaption={isPage ? undefined : DRAWER_CHIP_CAPTION}
      badgeFor={(agenda) => endedAiBadge(agenda, humanById)}
      recordingStartedAt={recordingStartedAt}
      empty={<p className="flex min-h-40 items-center justify-center text-center text-meta text-fg-faint">AI 요약이 없습니다</p>}
    />
  );

  /* 안내 바 48 — 회의록: 생성중 캡션 / 드로어 캡션 · AI: 「종결 · HH:MM」 계열. 적을 것이 없으면 줄 자체가 없다 */
  const notesCaption = generating ? GENERATING_NOTES_CAPTION : isPage ? null : DRAWER_EDIT_CAPTION;
  const infoBar =
    leftTab === "notes" ? (
      notesCaption ? (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-6">
          <span className="text-caption text-fg-caption">{notesCaption}</span>
        </div>
      ) : null
    ) : (
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-6">
        {isPage ? null : <span className="text-caption text-fg-caption">{DRAWER_EDIT_CAPTION}</span>}
        <span className="ml-auto text-caption text-fg-caption" data-testid="batch-caption">
          {aiCaption(meeting)}
        </span>
      </div>
    );

  /* 탭 줄 우측 — 「편집」 / 「변경은 자동 저장됩니다 · 편집 완료」. **「되돌리기」는 없다**(§7) */
  const editControls =
    canEdit && leftTab === "notes" ? (
      editing ? (
        <span className="flex items-center gap-2.5">
          <span className="text-caption text-fg-caption">{EDITING_CAPTION}</span>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex h-[30px] items-center rounded-control bg-primary px-3.5 text-caption font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            편집 완료
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex h-[30px] items-center rounded-control border border-border bg-card px-3 text-caption font-semibold text-foreground hover:bg-muted"
        >
          편집
        </button>
      )
    ) : null;

  const leftPanel = (
    <section aria-label="회의록" className={cn("flex min-h-0 min-w-0 flex-col", isPage && "overflow-hidden rounded-panel border border-border bg-card")}>
      <PanelTabs
        size={isPage ? "md" : "sm"}
        ariaLabel="회의록 탭"
        value={leftTab}
        onChange={setLeftTab}
        tabs={[
          // 회의록 dot — 완료 `#7181F8` · 생성중·실패 `#B3B3B3`([09] L708) · AI 탭 — 생성중 ① 은 진행색 + 광륜, 그 밖 `#B3B3B3`
          { key: "notes", label: "회의록", dotClassName: ended && meeting.integrationState === "succeeded" ? "bg-primary" : "bg-dot-idle" },
          { key: "ai", label: "AI 요약", dotClassName: generating && finalize.phase !== "integration" ? "bg-dot-ai" : "bg-dot-idle", halo: generating && finalize.phase !== "integration" },
        ]}
        trailing={editControls}
        className={isPage ? undefined : "px-0"}
      />
      {infoBar}
      <div className={cn("min-h-0 flex-1", isPage ? "overflow-y-auto px-8 py-[22px]" : "py-5")}>
        {leftTab === "notes" ? notesTree : aiTree}
        {editing ? edit.notice : null}
      </div>
    </section>
  );

  if (!isPage) {
    return (
      <div data-testid="meeting-detail-body" data-mode={mode} className="flex flex-col gap-5">
        {topBar}
        {leftPanel}
        <AttachmentRows attachments={meeting.attachments} />
      </div>
    );
  }

  const speakerCount = speakerCountOf(transcript.data);
  const lastEndMs = transcript.data?.items.at(-1)?.endMs ?? 0;
  const transcriptMinutes = Math.ceil(lastEndMs / 60_000);

  return (
    <div data-testid="meeting-detail-body" data-mode={mode} className="flex min-h-0 flex-1 flex-col">
      {/* 상단 바 슬롯 — top 150 · 본문 폭 · 56. 한 자리다 */}
      {topBar ? <div className="mt-6">{topBar}</div> : null}

      {/* 좌(유동) / 우 464 → 400(1280~1439) — SPEC-007 U-8 · SPEC-008 U-11 같은 규칙 */}
      <div className="mt-[18px] grid h-[calc(100vh-274px)] min-h-[480px] min-w-0 grid-cols-[minmax(0,1fr)_clamp(400px,calc(100%-1176px),464px)] gap-4">
        {leftPanel}

        <section aria-label="실시간 스크립트 · 첨부 파일" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-border bg-card">
          <PanelTabs
            ariaLabel="우측 패널 탭"
            value={rightTab}
            onChange={setRightTab}
            tabs={[
              { key: "transcript", label: "실시간 스크립트", dotClassName: "bg-dot-idle" },
              { key: "attachments", label: attachmentCount > 0 ? `첨부 파일 ${attachmentCount}` : "첨부 파일", dotClassName: "bg-dot-fixed" },
            ]}
            // 첨부 추가 · 제거는 `ended` 에서만(SPEC-006 상태별 허용 표 — `generating` 은 전부 거부)
            trailing={rightTab === "attachments" && ended ? <AttachmentAddTrigger onAddLink={addLink} /> : null}
          />
          {rightTab === "transcript" ? (
            transcript.isError ? (
              <div className="my-auto flex flex-col items-center gap-3 px-6 text-center">
                <p className="text-meta text-fg-caption">불러오지 못했습니다</p>
                <button type="button" onClick={() => void transcript.refetch()} className="flex h-8 items-center rounded-control border border-border bg-card px-3 text-meta text-fg-meta hover:bg-muted">
                  다시 시도
                </button>
              </div>
            ) : transcript.isPending ? (
              <p className="my-auto text-center text-meta text-fg-caption">불러오는 중…</p>
            ) : (
              <TranscriptPanel
                ref={transcriptRef}
                items={transcript.data.items}
                partial={null}
                recordingStartedAt={transcript.data.recordingStartedAt ?? recordingStartedAt}
                paused
                footer={
                  <span className="text-caption text-fg-caption">
                    전체 스크립트 {transcriptMinutes}분 · 화자 {speakerCount}명
                  </span>
                }
              />
            )
          ) : (
            <MeetingAttachmentsTab
              attachments={meeting.attachments}
              onAddLink={addLink}
              onRemove={(attachment) => (ended ? void removeAttachment(attachment.id) : undefined)}
              onOpenDoc={(attachment) => openAttachmentFileDrawer(overlay, attachment)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** 드로어의 첨부 n 행 — SPEC-006 U-7 목록 행 규격, **읽기 전용**(추가 · 제거는 전체 페이지). 비어 있으면 줄 자체가 없다. */
function AttachmentRows({ attachments }: { attachments: readonly MeetingAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 border-t border-divider pt-[18px]">
      <span className="text-caption text-fg-caption">첨부 파일 {attachments.length}</span>
      <AttachmentList
        attachments={attachments}
        emptyMessage="첨부한 파일이 없습니다"
        renderMeta={(attachment) =>
          attachment.kind === "link"
            ? attachment.url
              ? domainOf(attachment.url)
              : ""
            : [formatBytes(attachment.sizeBytes), attachment.folderPath].filter((part) => part && part.length > 0).join(" · ")
        }
      />
    </div>
  );
}

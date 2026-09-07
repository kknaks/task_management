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
 * | `ended`+`failed` | `variant="failed"` — 배너 + 「다시 시도」(`POST …/finalize` — ①부터) |
 * | `ended`+`succeeded` · `headline` 있음 | `variant="headline"` — 페이지 56 한 줄 / 드로어 72 두 줄. **`null` 이면 그리지 않는다** |
 *
 * ## 트리는 WORK-007 컴포넌트 하나를 **`agendas.merged`(또는 사람 원본)** 로 부를 뿐이다
 *
 * 회의록 탭이 그리는 트랙은 `notesTrackOf`(성공하면 최종 회의록 · 그 밖 사람 원본), 편집 대상은 `editTrackOf` — 트리는 트랙을 모른다.
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
import { editTrackOf, endedAiBadge, endedNotesBadge, notesAgendasOf, notesExpandable } from "@/features/meetings/closeState";
import { FINALIZE_FAILED_MESSAGE, INVALID_STATUS_MESSAGE, isInvalidMeetingStatus, meetingInlineError } from "@/features/meetings/errors";
import { useMeetingEdit } from "@/features/meetings/hooks/useMeetingEdit";
import { useMeetingFinalizeJob } from "@/features/meetings/hooks/useMeetingFinalizeJob";
import { speakerCountOf, useTranscriptQuery } from "@/features/meetings/hooks/useMeetingLive";
import { useMeetingMutations } from "@/features/meetings/hooks/useMeetingMutations";
import { openAddLineDrawer } from "@/features/meetings/components/AddLineDrawer";
import { openAttachmentFileDrawer } from "@/features/meetings/components/AttachmentFileDrawer";
import { openActionPayloadDrawer } from "@/features/meetings/components/CreateTaskFromLineDrawer";
import { openTaskPayloadDrawer, pickedFromLineTask } from "@/features/meetings/components/LinkTaskDrawer";
import type { SubmitMode } from "@/features/meetings/components/PayloadDrawerParts";
import { actionPayloadOf, taskPayloadOf } from "@/features/meetings/linePayload";
import { LineTaskButton } from "@/features/meetings/components/LineTaskButton";
import { useMeetingTaskLink } from "@/features/meetings/hooks/useMeetingTaskLink";
import type { MeetingAgenda, MeetingAttachment, MeetingDetail, MeetingLine } from "@/features/meetings/types";
import { useOverlay } from "@/lib/overlay/OverlayProvider";
import { cn } from "@/lib/utils";

export type MeetingDetailMode = "page" | "drawer";

type LeftTab = "notes" | "ai";
type RightTab = "transcript" | "attachments";

export const DRAWER_EDIT_CAPTION = "편집과 업무 연동은 전체 페이지에서 합니다";
export const DRAWER_CHIP_CAPTION = "스크립트는 전체 페이지에서 볼 수 있습니다";
export const GENERATING_NOTES_CAPTION = "정리가 끝나면 이 탭이 최종 회의록으로 바뀝니다";
export const EDITING_CAPTION = "변경은 자동 저장됩니다";
export const DRAWER_SCHEDULED_CAPTION = "회의 시작은 전체 페이지에서 합니다";
export const DRAWER_RECORDING_CAPTION = "진행 중인 회의입니다 · 전체 페이지에서 보기";

/**
 * AI 탭 안내 바 우측 — **회의 중 마지막 값 그대로**다(SPEC-008 U-1 · U-2 · U-3 · MF-56).
 *
 * 종료 후 배치가 다시 돌지 않으므로 이 값은 더 움직이지 않는다. 「종결」·「종결 정리 중」 같은 문구를 **두지 않는다** —
 * 통합 단계가 없어졌고 AI 탭은 로그성 기록이다(DEC-003 §6).
 *
 * **남은 계약 공백** — 시안 문구는 「배치 n회 반영 · HH:MM」인데 그 `HH:MM`(마지막 배치를 받은 시각)은 **회의 중 화면이 세던 값**이라
 * `MeetingDetail` 에 없다(`mergedSummary` 는 카운트 다섯뿐이고 `integratedAt` 은 MF-56 으로 사라졌다). 새로 고치면 시각을 잃는다 —
 * 여기서 `updatedAt` 같은 다른 시각을 끌어다 쓰지 않는다(성공·실패 시각이 섞인다). 필드를 더할지는 문서가 정한다.
 */
function aiCaption(meeting: MeetingDetail): string {
  return meeting.latestBatchSeq > 0 ? `배치 ${meeting.latestBatchSeq}회 반영` : "AI 요약 없음";
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
  // 편집 중에 상태가 바뀌면(다른 창에서 「다시 시도」 등) 보기 모드로 돌아간다 — 잠금이 먼저다.
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

  /** 「다시 시도」 — `POST …/finalize`. ①(재전사)부터 다시 돈다(U-2 · MF-58). */
  const retryFinalize = async () => {
    try {
      await finalize.retry();
    } catch (error) {
      if (isInvalidMeetingStatus(error)) {
        toast.error(INVALID_STATUS_MESSAGE);
        void mutations.refreshDetail();
        return;
      }
      toast.error(meetingInlineError(error)?.message ?? FINALIZE_FAILED_MESSAGE);
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
    <MeetingStatusBar
      variant="failed"
      onRetry={() => void retryFinalize()}
      retrying={finalize.retrying}
      errorCode={finalize.errorCode}
    />
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
      onClick={() => openLineDeleteModal(overlay, () => edit.deleteLineConfirmed(line).then(() => undefined))}
      className="shrink-0 rounded-chip px-1.5 text-caption text-fg-caption opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
    >
      제거
    </button>
  );
  /* ── payload 드로어 둘(U-6 · U-9 · U-10 — 페이지 · 회의록 탭만) ─────────────────────────────
   *
   * **모드가 푸터를 가른다**(MF-66) — 편집 모드는 「저장」(줄에 `payload` 만 붙는다) · 보기 모드는 「넣기」(업무가 생기거나 바뀐다).
   * **AI 줄과 사람 줄을 가르지 않는다**(MF-65) — 드로어가 보는 것은 `prefill` 이 차 있나뿐이다.
   */
  const submitMode: SubmitMode = editing ? "save" : "insert";

  /** 액션 payload 드로어 — 줄에서 열거나(`line`) 「+ 액션 아이템」 칩에서 연다(`line=null`). */
  const openActionPayload = (agenda: MeetingAgenda, line: MeetingLine | null) =>
    openActionPayloadDrawer(overlay, {
      agenda,
      meetingProject: meeting.project,
      lineContent: line?.content ?? null,
      prefill: line ? actionPayloadOf(line) : null,
      submitMode,
      onSubmit: async (payload) => {
        if (submitMode === "insert" && line) {
          // 「넣기」 — 업무를 만든다. 유형은 드로어가 필수로 받았다
          await taskLink.insertNewTask(line, {
            title: payload.title,
            workTypeId: payload.workTypeId as number,
            projectId: payload.projectId ?? null,
            startDate: payload.startDate ?? null,
            dueDate: payload.dueDate ?? null,
            description: payload.description ?? null,
            todos: payload.todos ?? [],
          });
          return;
        }
        if (line) {
          await edit.savePayload(line, { payload }, { payload });
          return;
        }
        // 칩 진입 — 줄과 `payload` 가 **한 요청**으로 생긴다(MF-64 정정). 닫으면 줄이 없다
        await edit.addLineFromDrawer({ agendaId: agenda.id, kind: "action", content: payload.title, payload });
      },
    });

  /** 업무 payload 드로어 — 줄에서 열거나 「+ 연관 업무」 칩에서 연다. 업무는 **헤더 셀렉터**에서 고른다. */
  const openTaskPayload = (agenda: MeetingAgenda, line: MeetingLine | null) =>
    openTaskPayloadDrawer(overlay, {
      agenda: line ? null : agenda,
      meetingProject: meeting.project,
      lineContent: line?.content ?? null,
      initialTask: line?.task && line.taskId !== null ? pickedFromLineTask(line.taskId, line.task) : null,
      prefill: line ? taskPayloadOf(line) : null,
      submitMode,
      onSubmit: async ({ taskId, changes, content }) => {
        if (submitMode === "insert" && line && taskId !== null) {
          await taskLink.applyTaskUpdate(line, { taskId, ...changes });
          return;
        }
        if (line) {
          await edit.savePayload(line, { taskId, payload: changes }, { taskId, payload: changes });
          return;
        }
        await edit.addLineFromDrawer({ agendaId: agenda.id, kind: "task", content, taskId, payload: changes });
      },
    });

  // 줄 버튼 슬롯 — 보기 · 편집 모드 같은 자리. `generating` 이면 전부 잠금(U-1). 드로어 · AI 탭에는 없다
  const renderLineActions = isPage
    ? (line: MeetingLine, agenda: MeetingAgenda) => (
        <LineTaskButton
          line={line}
          locked={!canEdit}
          busy={taskLink.busyLineId === line.id}
          onOpenAction={(target) => openActionPayload(agenda, target)}
          onOpenTask={(target) => openTaskPayload(agenda, target)}
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
        {/* 「+ 연관 업무」(U-9 칩 진입) — **payload 드로어가 바로** 뜬다. 「저장」이 줄 + `payload` 를 한 요청으로 만든다(MF-64 정정) */}
        <button type="button" onClick={() => openTaskPayload(agenda, null)} className={chip}>
          <Plus className="h-2.5 w-2.5" aria-hidden />
          연관 업무
        </button>
        {/* 「+ 액션 아이템」(U-10 칩 진입) — 〃. **줄 추가 드로어를 거치지 않는다** */}
        <button type="button" onClick={() => openActionPayload(agenda, null)} className={chip}>
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

  /* 안내 바 48 — 회의록: 생성중 캡션 / 드로어 캡션 · AI: 「배치 n회 반영」. 적을 것이 없으면 줄 자체가 없다 */
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
          // 회의록 dot — 완료 `#7181F8` · 생성중·실패 `#B3B3B3`([09] L708)
          { key: "notes", label: "회의록", dotClassName: ended && meeting.integrationState === "succeeded" ? "bg-primary" : "bg-dot-idle" },
          // AI 탭 dot 은 **언제나** `#B3B3B3` — 종료 후 배치가 다시 돌지 않아 이 탭은 바뀌지 않는다(U-1 · MF-56)
          { key: "ai", label: "AI 요약", dotClassName: "bg-dot-idle" },
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
                // 종료 후에는 스크립트가 더 늘지 않는다 — 열자마자 끝으로 튀지 않게 따라가기를 끈다(U-3)
                follow={false}
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

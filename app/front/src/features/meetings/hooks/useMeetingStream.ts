"use client";

/**
 * **회의 스트림 훅 — WS 클라이언트 + 상태 기계 + 마이크 캡처**(SPEC-007 §4 stateDiagram · FE §8 · WP §Internal Interface Contract).
 *
 * ## 상태 5종
 *
 * `connecting`(ready 전) · `live` · `paused/user` · `paused/mic` · `paused/stream`(`upstream` · `write_failed` · 예고 없는 close ·
 * `4409 meeting_stream_active` = `stream:elsewhere`). **화면 진입 시 `paused/stream` 으로 시작한다** — 자동으로 붙지 않는다.
 *
 * ## `resume()` 만이 WS 를 연다(BE-12)
 *
 * 마운트·에러·타이머로 여는 코드가 **없다.** 「회의 시작」 직후의 첫 연결도 화면이 그 클릭 표지(`meetingStartIntent`)를 보고
 * `resume()` 을 부른다. 재연결 타이머가 이 파일에 없다. 끊기면 `paused/stream` 으로 드러내고 사용자가 「재개」를
 * 누를 때 **새 WS·새 STT 세션**이 열린다(S-7 — 화자 번호가 이어지지 않을 수 있다. 정정하지 않는다).
 *
 * ## 프레임 분배
 *
 * | 프레임 | 처리 |
 * |---|---|
 * | `ready` | `recordingStartedAt` · 잠정 비움 · 캡처 시작/재개 → `live`. `latestBatchSeq` 가 캐시보다 크면 상세 재조회(끊긴 동안 놓친 배치) |
 * | `transcript.partial` | **교체** — 화면 표시용. 저장하지 않는다(M-9) |
 * | `transcript.final` | 트랜스크립트 캐시 `['meetings','transcript',id]` 에 **append** + 화자 수 갱신 |
 * | `ai.batch` | 상세 캐시 `['meetings','detail',id]` 에 **즉시 병합**(`mergeAiBatch`) — 버퍼링 없음(BE-11). `aiVersion` +1 |
 * | `error` | 사유를 기억한다 — 뒤따르는 close 가 `paused/stream` 문구를 정한다 |
 *
 * ## 마이크
 *
 * `getUserMedia` 는 `resume()` 안에서만 부른다(권한 프롬프트가 사용자 동작에 붙는다). 트랙 `ended` → `pause{mic}` 프레임 + `paused/mic`.
 * 「재개」 → 다시 잡고, 못 잡으면 같은 상태 + 토스트 「마이크를 사용할 수 없습니다」(Case Matrix).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { mergeAiBatch } from "@/features/meetings/aiBatch";
import { INVALID_STATUS_MESSAGE } from "@/features/meetings/errors";
import {
  AUDIO_DECLARATION,
  hasLiveAudioTrack,
  releaseMicrophone,
  requestMicrophone,
  startCapture,
  type Capture,
} from "@/features/meetings/hooks/audioCapture";
import type {
  MeetingDetail,
  PartialSegment,
  StreamClientFrame,
  StreamServerFrame,
  StreamStatus,
  TranscriptResponse,
} from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { WS_CLOSE, openAuthenticatedSocket, type AuthenticatedSocket, type SocketCloseEvent } from "@/lib/api/ws";

export const MIC_UNAVAILABLE_MESSAGE = "마이크를 사용할 수 없습니다";

const INITIAL_STATUS: StreamStatus = { kind: "paused", reason: "stream:upstream" };

export interface UseMeetingStreamResult {
  status: StreamStatus;
  /** `false` 면 「재개」 비활성 — 다른 창에서 기록 중이다(`4409 meeting_stream_active`). */
  canResume: boolean;
  /** 사용자 일시정지 — `pause{user}` 프레임 + 캡처 멈춤. WS 는 열린 채다. */
  pause: () => void;
  /** **WS 를 여는 유일한 문.** 살아 있으면 `resume` 프레임, 죽어 있으면 새 연결. */
  resume: () => Promise<void>;
  /** 잠정 발화 — `null` 이면 없음. */
  partial: PartialSegment[] | null;
  /** `ready` 가 준 기준점. 없으면 상세의 값을 쓰라는 뜻이다. */
  recordingStartedAt: string | null;
  /** `ai.batch` 를 받은 횟수 — 미확인 점의 원천. 회차(`seq`)는 상세 캐시 `latestBatchSeq` 다. */
  aiVersion: number;
  /** 마지막 `ai.batch` 를 받은 시각(`Date.now()`) — 「배치 n회 반영 · HH:MM」. */
  lastBatchAt: number | null;
}

export function useMeetingStream({ meetingId }: { meetingId: number }): UseMeetingStreamResult {
  const client = useQueryClient();
  const detailKey = useMemo(() => queryKeys.meetingDetail(meetingId), [meetingId]);
  const transcriptKey = useMemo(() => queryKeys.meetingTranscript(meetingId), [meetingId]);

  const [status, setStatus] = useState<StreamStatus>(INITIAL_STATUS);
  const [elsewhere, setElsewhere] = useState(false);
  const [partial, setPartial] = useState<PartialSegment[] | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [aiVersion, setAiVersion] = useState(0);
  const [lastBatchAt, setLastBatchAt] = useState<number | null>(null);

  const statusRef = useRef<StreamStatus>(INITIAL_STATUS);
  const socketRef = useRef<AuthenticatedSocket | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const captureRef = useRef<Capture | null>(null);
  const pendingErrorRef = useRef<"upstream" | "write_failed" | null>(null);
  const unmountedRef = useRef(false);
  /** 트랙 `ended` 리스너 — 우리가 놓는 트랙(`stop()`)에서는 떼고 놓는다. 브라우저도 `stop()` 에는 `ended` 를 내지 않는다. */
  const endedHandlerRef = useRef<(() => void) | null>(null);

  const transition = useCallback((next: StreamStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const sendControl = useCallback((frame: StreamClientFrame) => {
    socketRef.current?.send(JSON.stringify(frame));
  }, []);

  const stopCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
  }, []);

  const releaseMic = useCallback(() => {
    const mic = micRef.current;
    if (mic) {
      const handler = endedHandlerRef.current;
      if (handler) {
        for (const track of mic.getAudioTracks()) {
          track.removeEventListener("ended", handler);
        }
      }
      releaseMicrophone(mic);
      micRef.current = null;
    }
  }, []);

  /** 트랙이 끊겼다(장치 분리) — 스스로 `paused/mic` 로 떨어지고 서버에 알린다(S-7). */
  const onTrackEnded = useCallback(() => {
    stopCapture();
    micRef.current = null;
    setPartial(null);
    const current = statusRef.current;
    if (current.kind === "live" || current.kind === "connecting") {
      sendControl({ type: "pause", reason: "mic" });
      transition({ kind: "paused", reason: "mic" });
    }
  }, [sendControl, stopCapture, transition]);

  const acquireMic = useCallback(async (): Promise<boolean> => {
    if (hasLiveAudioTrack(micRef.current)) {
      return true;
    }
    try {
      const stream = await requestMicrophone();
      endedHandlerRef.current = onTrackEnded;
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", onTrackEnded);
      }
      micRef.current = stream;
      return true;
    } catch {
      transition({ kind: "paused", reason: "mic" });
      toast.error(MIC_UNAVAILABLE_MESSAGE);
      return false;
    }
  }, [onTrackEnded, transition]);

  /** `ready` 뒤 — 같은 마이크면 이어서, 새 마이크·새 세션이면 새 recorder. */
  const ensureCapturing = useCallback(() => {
    const mic = micRef.current;
    if (!hasLiveAudioTrack(mic)) {
      return;
    }
    if (captureRef.current && captureRef.current.stream === mic) {
      captureRef.current.resume();
      return;
    }
    stopCapture();
    try {
      captureRef.current = startCapture(mic, (chunk) => socketRef.current?.send(chunk));
    } catch {
      onTrackEnded();
    }
  }, [onTrackEnded, stopCapture]);

  const onFrame = useCallback(
    (frame: StreamServerFrame) => {
      switch (frame.type) {
        case "ready": {
          setRecordingStartedAt(frame.recordingStartedAt);
          setPartial(null);
          const cached = client.getQueryData<MeetingDetail>(detailKey);
          if (cached && frame.latestBatchSeq > cached.latestBatchSeq) {
            // 끊긴 동안 배치가 돌았다 — push 를 못 받았으니 상세로 따라잡는다(WP `push_ai_batch` 행).
            void client.invalidateQueries({ queryKey: detailKey });
          }
          ensureCapturing();
          transition({ kind: "live" });
          return;
        }
        case "transcript.partial":
          setPartial(frame.segments);
          return;
        case "transcript.final": {
          const previous = client.getQueryData<TranscriptResponse>(transcriptKey);
          if (!previous) {
            // 진입 조회가 아직이다 — 서버에는 이미 들어갔으니 조회가 실어 온다. 경합이면 다시 읽는다.
            void client.invalidateQueries({ queryKey: transcriptKey });
            return;
          }
          if (previous.items.some((item) => item.id === frame.item.id)) {
            return;
          }
          const items = [...previous.items, frame.item];
          const labels = new Set(items.map((item) => item.speakerLabel));
          client.setQueryData<TranscriptResponse>(transcriptKey, {
            ...previous,
            items,
            speakerCount: Math.max(previous.speakerCount, labels.size),
          });
          return;
        }
        case "ai.batch": {
          const cached = client.getQueryData<MeetingDetail>(detailKey);
          if (!cached) {
            void client.invalidateQueries({ queryKey: detailKey });
          } else {
            const merged = mergeAiBatch(cached, frame);
            client.setQueryData<MeetingDetail>(detailKey, merged.detail);
            if (merged.orphaned > 0) {
              void client.invalidateQueries({ queryKey: detailKey });
            }
          }
          setLastBatchAt(Date.now());
          setAiVersion((version) => version + 1);
          return;
        }
        case "error":
          pendingErrorRef.current = frame.reason;
          return;
      }
    },
    [client, detailKey, ensureCapturing, transcriptKey, transition],
  );

  const onSocketClose = useCallback(
    (event: SocketCloseEvent) => {
      socketRef.current = null;
      stopCapture();
      releaseMic();
      setPartial(null);
      if (unmountedRef.current) {
        return;
      }
      const errorReason = pendingErrorRef.current;
      pendingErrorRef.current = null;

      if (event.code === WS_CLOSE.CONFLICT && event.reason.includes("meeting_stream_active")) {
        setElsewhere(true);
        transition({ kind: "paused", reason: "stream:elsewhere" });
        return;
      }
      if (event.code === WS_CLOSE.CONFLICT) {
        // `invalid_meeting_status` — 화면이 낡았다. 토스트 + 상세 재조회(Case Matrix).
        toast.error(INVALID_STATUS_MESSAGE);
        void client.invalidateQueries({ queryKey: detailKey });
        transition({ kind: "paused", reason: "stream:upstream" });
        return;
      }
      if (event.code === WS_CLOSE.NOT_FOUND) {
        void client.invalidateQueries({ queryKey: detailKey });
        transition({ kind: "paused", reason: "stream:upstream" });
        return;
      }
      transition({
        kind: "paused",
        reason: errorReason === "write_failed" ? "stream:write_failed" : "stream:upstream",
      });
    },
    [client, detailKey, releaseMic, stopCapture, transition],
  );

  const openSocket = useCallback(() => {
    pendingErrorRef.current = null;
    transition({ kind: "connecting" });
    socketRef.current = openAuthenticatedSocket<StreamServerFrame>({
      path: `/api/meetings/${meetingId}/stream`,
      authFrame: (accessToken) => ({ type: "auth", accessToken, audio: AUDIO_DECLARATION }) satisfies StreamClientFrame,
      onMessage: onFrame,
      onClose: onSocketClose,
    });
  }, [meetingId, onFrame, onSocketClose, transition]);

  const pause = useCallback(() => {
    if (statusRef.current.kind !== "live") {
      return;
    }
    captureRef.current?.pause();
    setPartial(null);
    sendControl({ type: "pause", reason: "user" });
    transition({ kind: "paused", reason: "user" });
  }, [sendControl, transition]);

  const resume = useCallback(async () => {
    const current = statusRef.current;
    if (elsewhere || current.kind === "live" || current.kind === "connecting") {
      return;
    }
    // 마이크가 먼저다(S-1) — 못 잡으면 WS 를 열지 않는다.
    if (!(await acquireMic())) {
      return;
    }
    if (socketRef.current?.isOpen) {
      // 세션이 살아 있다 — 같은 STT 세션을 잇는다. `ready` 가 다시 오면 `live`.
      transition({ kind: "connecting" });
      sendControl({ type: "resume" });
      return;
    }
    openSocket();
  }, [acquireMic, elsewhere, openSocket, sendControl, transition]);

  // 화면을 떠나면 닫는다 — 이 close 는 상태로 드러내지 않는다.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      socketRef.current?.close(WS_CLOSE.NORMAL, "leave");
      socketRef.current = null;
      captureRef.current?.stop();
      captureRef.current = null;
      releaseMic();
    };
  }, [meetingId, releaseMic]);

  return {
    status,
    canResume: !elsewhere,
    pause,
    resume,
    partial,
    recordingStartedAt,
    aiVersion,
    lastBatchAt,
  };
}

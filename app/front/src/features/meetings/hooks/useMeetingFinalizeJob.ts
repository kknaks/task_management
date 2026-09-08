"use client";

/**
 * **종료 파이프라인의 화면 쪽 — 요청 둘 + 폴링 하나**(SPEC-008 U-1 · U-2 · §4 수치 · FE §8 「종료」).
 *
 * - `end()` — `POST …/end` → `202 { jobId }` → **그 자리에서** 상세 캐시를 `generating` 으로 바꾼다(페이지 이동 없음). WS 는 서버가 닫는다
 * - `retry()` — `POST …/finalize`(「다시 시도」) → 같은 방식으로 **①(재전사)부터** 다시 돈다(MF-58 — 부분 재시도가 없다)
 * - 폴링 — `GET /api/jobs/{id}` **2초 간격 · 1230회 상한**. `succeeded`/`failed` 에서 멈추고 `['meetings','detail',id]` +
 *   `['meetings','list',…]` + **트랜스크립트**를 무효화한다(재전사가 블록을 갈아끼운다 — M-9-a. job 은 결과를 담지 않는다)
 * - 폴링 실패(5xx · 네트워크) · 상한 초과 → **멈추고** 「다시 확인」 상태만 남긴다. **자동 재시도 없음**(`retry:false` · DEC-001 §7).
 *   「다시 확인」이 한 번 더 읽고, 살아 있으면 폴링이 다시 붙는다. 서버가 job 을 2400초에 `failed` 로 마감하므로 무한 스피너가 없다
 * - `errorCode` — **마지막으로 종결된 job** 의 사유(실패 배너의 툴팁 · U-2). job 이 끝나면 `activeJobId` 가 `null` 이 되어
 *   더 읽을 수 없으므로 이 훅이 들고 있는다. 새로고침으로 들어오면 볼 job 이 없어 `null` 이고 배너는 사유 없이 뜬다
 * - 페이지 재진입은 **`MeetingDetail.activeJobId`** 로 잇는다 — 이 훅은 그 값을 볼 뿐 job id 를 따로 기억하지 않는다
 *
 * 타이머는 TanStack Query 의 `refetchInterval` 하나다 — `setInterval`·`setTimeout` 을 이 파일이 만들지 않는다.
 * 「경과 mm:ss」의 기준(`startedAtMs`)은 종료 요청 응답 시각이고, 재진입이면 폴링을 처음 붙인 시각이다(표시 전용).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { endMeeting, fetchJob, finalizeMeeting } from "@/features/meetings/api";
import type { JobErrorCode, JobItem, MeetingDetail } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";

/** SPEC-008 §4 수치 — 폴링 간격 **2초** · 상한 **1230회**(≈41분 = job 상한 2400초 + 60초). */
export const JOB_POLL_INTERVAL_MS = 2000;
export const JOB_POLL_MAX_COUNT = 1230;

function isTerminal(job: JobItem | undefined): boolean {
  return job?.status === "succeeded" || job?.status === "failed";
}

export function useMeetingFinalizeJob(meeting: MeetingDetail) {
  const client = useQueryClient();
  const detailKey = queryKeys.meetingDetail(meeting.id);
  const jobId = meeting.status === "generating" ? meeting.activeJobId : null;

  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [exhausted, setExhausted] = useState(false);
  /** 마지막으로 종결된 job 의 실패 사유 — 배너 툴팁(U-2). 종결 뒤 `activeJobId` 가 사라져 다시 읽을 수 없다. */
  const [errorCode, setErrorCode] = useState<JobErrorCode | null>(null);
  const countRef = useRef(0);
  const settledRef = useRef<number | null>(null);

  const job = useQuery({
    queryKey: queryKeys.job(jobId ?? 0),
    queryFn: () => {
      countRef.current += 1;
      return fetchJob(jobId as number);
    },
    enabled: jobId !== null && !exhausted,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    /**
     * **계약된 주기로만.** 종결 · 조회 실패 · 상한에서는 `false` — 다음 폴링이 없다.
     * 상한은 `queryFn` 이 센 횟수로 판정하고 `exhausted` 로 `enabled` 도 끈다(포커스·재마운트로 되살아나지 않게).
     */
    refetchInterval: (query) => {
      if (query.state.status === "error" || isTerminal(query.state.data)) {
        return false;
      }
      if (countRef.current >= JOB_POLL_MAX_COUNT) {
        return false;
      }
      return JOB_POLL_INTERVAL_MS;
    },
  });

  // 상한 판정 — 마지막 폴링이 끝난 뒤 `enabled` 를 끈다.
  useEffect(() => {
    if (jobId !== null && !exhausted && countRef.current >= JOB_POLL_MAX_COUNT && !isTerminal(job.data)) {
      setExhausted(true);
    }
  }, [exhausted, job.data, job.dataUpdatedAt, jobId]);

  // 재진입(서버의 `activeJobId`) — 경과 시간의 기준이 없으면 지금부터 센다.
  useEffect(() => {
    if (jobId !== null && startedAtMs === null) {
      setStartedAtMs(Date.now());
    }
    if (jobId === null) {
      countRef.current = 0;
      setExhausted(false);
      setStartedAtMs(null);
    }
  }, [jobId, startedAtMs]);

  /**
   * 종결 — **상세 GET 한 번**(+ 목록 + 트랜스크립트). job 하나당 한 번만 무효화한다.
   * 트랜스크립트까지 읽는 것은 ①(재전사)이 블록을 통째로 갈아끼우기 때문이다(M-9-a).
   */
  useEffect(() => {
    const data = job.data;
    if (!data || !isTerminal(data) || settledRef.current === data.id) {
      return;
    }
    settledRef.current = data.id;
    setErrorCode(data.errorCode);
    void Promise.all([
      client.invalidateQueries({ queryKey: detailKey }),
      client.invalidateQueries({ queryKey: queryKeys.meetingsListAll() }),
      client.invalidateQueries({ queryKey: queryKeys.meetingTranscript(meeting.id) }),
    ]);
  }, [client, detailKey, job.data, meeting.id]);

  /** `202` 를 받으면 캐시를 그 자리에서 바꾼다 — 스위치가 `generating` 화면으로 바뀐다(U-1 진입). */
  const enterGenerating = useCallback(
    (nextJobId: number) => {
      countRef.current = 0;
      setExhausted(false);
      setErrorCode(null);
      setStartedAtMs(Date.now());
      client.setQueryData<MeetingDetail>(detailKey, (snapshot) =>
        snapshot
          ? { ...snapshot, status: "generating", integrationState: "running", activeJobId: nextJobId }
          : snapshot,
      );
    },
    [client, detailKey],
  );

  const end = useMutation({
    mutationFn: () => endMeeting(meeting.id),
    onSuccess: (accepted) => enterGenerating(accepted.jobId),
  });

  /** 「다시 시도」 — `POST …/finalize`. ①부터 다시 도므로 문구가 `transcription` 으로 돌아간다(U-2). */
  const retry = useMutation({
    mutationFn: () => finalizeMeeting(meeting.id),
    onSuccess: (accepted) => enterGenerating(accepted.jobId),
  });

  /** 「다시 확인」 — 한 번 더 읽는다. 살아 있으면 `refetchInterval` 이 다시 돈다. */
  const recheck = useCallback(() => {
    countRef.current = 0;
    setExhausted(false);
    void job.refetch();
  }, [job]);

  return {
    /** 폴링 대상 job. `generating` 이 아니면 `null`. */
    jobId,
    job: job.data ?? null,
    phase: job.data?.progress?.phase ?? null,
    attempt: job.data?.progress?.attempt ?? 0,
    /** 마지막으로 종결된 job 의 실패 사유(U-2 툴팁). 못 본 job 이면 `null`. */
    errorCode,
    /** 조회 실패 또는 상한 — 스피너는 그대로, 「다시 확인」만 남긴다(U-1). */
    pollFailed: job.isError || exhausted,
    startedAtMs,
    recheck,
    end: () => end.mutateAsync(),
    retry: () => retry.mutateAsync(),
    ending: end.isPending,
    retrying: retry.isPending,
  };
}

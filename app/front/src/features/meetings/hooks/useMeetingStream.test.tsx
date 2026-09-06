/**
 * **스트림 훅 상태 기계 — 대역 WS + 목 마이크**(WP Phase 5 검증 · SPEC-007 §4 stateDiagram · Case Matrix).
 *
 * - 진입은 `paused/stream` · 마운트로 여는 연결 **0건**
 * - `resume()` → 마이크 → **연결 1건** → `auth` 첫 프레임 → `ready` → `live` · 캡처 시작 · 오디오는 바이너리 프레임
 * - `error{upstream}` + close → `paused/stream:upstream` · **재연결 0건**(WebSocket 생성 스파이) · 다시 `resume()` 때만 +1
 * - `write_failed` 문구 · `4409 meeting_stream_active` → `stream:elsewhere` + `canResume=false`
 * - 마이크 트랙 `ended` → `paused/mic` + `pause{mic}` 프레임 · 새 연결 없음
 * - `startCapture` 가 던지면(설계 밖 실패) **마이크 실패로 접히지 않는다** — `pause{mic}` 0건 · 예외 전파(검수 F-2)
 * - `4404` 는 상태 바를 갈지 않는다 — 재조회(404) 결과로만 갈린다(검수 W-3)
 * - 사용자 `pause()` → `pause{user}` · 잠정 비움 · `resume()` 은 **같은 소켓에 `resume` 프레임**(새 연결 없음)
 * - 잠정 교체 · 확정 append(트랜스크립트 캐시) · `ai.batch` 즉시 병합(`latestBatchSeq` · `aiVersion`)
 * - 마이크 거부 → `paused/mic` + 토스트, 연결 없음
 * - 이 파일과 `ws.ts` 에 `setInterval`·`setTimeout` 이 없다(정적 검사)
 */

import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMeetingDetail } from "@/features/meetings/hooks/useMeetingDetail";
import { MIC_UNAVAILABLE_MESSAGE, useMeetingStream } from "@/features/meetings/hooks/useMeetingStream";
import { createTestClient, meetingDetail, renderWithProviders } from "@/features/meetings/testUtils";
import type { MeetingDetail, TranscriptResponse } from "@/features/meetings/types";
import { queryKeys } from "@/lib/api/queryKeys";
import { tokenStore } from "@/lib/auth/tokenStore";
import { FakeWebSocket } from "@/test/fakeWebSocket";
import { FakeMediaRecorder, installMedia } from "@/test/mediaMock";
import { API_BASE, server } from "@/test/server";
import { screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import type { ReactNode } from "react";

const MEETING = 21;
const READY = { type: "ready", recordingStartedAt: "2026-08-27T00:31:00Z", latestBatchSeq: 0, speakerCount: 0 } as const;

let media: ReturnType<typeof installMedia>;
let client: QueryClient;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

function mount() {
  return renderHook(() => useMeetingStream({ meetingId: MEETING }), { wrapper });
}

/** 화면처럼 상세 쿼리 관찰자를 함께 둔다 — 무효화가 재조회로 이어지는 것을 보려면 관찰자가 있어야 한다. */
function mountWithDetail() {
  return renderHook(
    () => {
      useMeetingDetail(MEETING);
      return useMeetingStream({ meetingId: MEETING });
    },
    { wrapper },
  );
}

/** `resume()` → 소켓 열림 → `ready` 까지. */
async function goLive(result: ReturnType<typeof mount>["result"]) {
  await act(async () => {
    await result.current.resume();
    await flush();
  });
  const ws = FakeWebSocket.last;
  act(() => {
    ws.serverOpen();
    ws.serverSend(READY);
  });
  return ws;
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  media = installMedia();
  tokenStore.setAccess("A1");
  client = createTestClient();
  client.setQueryData<MeetingDetail>(
    queryKeys.meetingDetail(MEETING),
    meetingDetail({ status: "recording", recordingStartedAt: "2026-08-27T00:31:00Z", latestBatchSeq: 0 }),
  );
  client.setQueryData<TranscriptResponse>(queryKeys.meetingTranscript(MEETING), {
    recordingStartedAt: "2026-08-27T00:31:00Z",
    speakerCount: 0,
    items: [],
  });
});

afterEach(async () => {
  media.restore();
  vi.unstubAllGlobals();
  await tokenStore.clear();
});

describe("진입 · 연결", () => {
  it("진입은 `paused/stream` 이고 **마운트로 여는 연결이 0건**이다", async () => {
    const { result } = mount();
    await flush();
    expect(result.current.status).toEqual({ kind: "paused", reason: "stream:upstream" });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("`resume()` → 마이크 → 연결 1건 → `auth` 첫 프레임 → `connecting` → `ready` → `live` · 캡처 시작 · 오디오는 바이너리", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.resume();
      await flush();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.status).toEqual({ kind: "connecting" });

    const ws = FakeWebSocket.last;
    act(() => ws.serverOpen());
    expect(ws.sentFrames[0]).toEqual({ type: "auth", accessToken: "A1", audio: { format: "auto", sampleRate: 48000, channels: 1 } });
    // `ready` 전에는 캡처가 없다 — 오디오를 보내지 않는다.
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    act(() => ws.serverSend(READY));
    expect(result.current.status).toEqual({ kind: "live" });
    expect(result.current.recordingStartedAt).toBe("2026-08-27T00:31:00Z");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");

    act(() => FakeMediaRecorder.instances[0].emit(1200));
    expect(ws.sentBinaryCount).toBe(1);
  });

  it("마이크가 거부되면 `paused/mic` + 토스트, **연결을 열지 않는다**", async () => {
    media.failNext();
    const { result } = renderHook(() => useMeetingStream({ meetingId: MEETING }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          {children}
          <Toaster />
        </QueryClientProvider>
      ),
    });
    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.status).toEqual({ kind: "paused", reason: "mic" });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(await screen.findByText(MIC_UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});

describe("실패 3종 — 일시정지 경로 하나로 모인다 · 자동 재연결 없음", () => {
  it("`error{upstream}` + close → `paused/stream:upstream` · **새 연결 0건** · `resume()` 때만 새 연결", async () => {
    const { result } = mount();
    const ws = await goLive(result);
    act(() => ws.serverSend({ type: "transcript.partial", segments: [{ speakerLabel: "1", atMs: 1000, text: "잠정" }] }));
    expect(result.current.partial).toHaveLength(1);

    act(() => {
      ws.serverSend({ type: "error", code: "meeting_stream_disconnected", reason: "upstream" });
      ws.serverClose(1011, "meeting_stream_disconnected");
    });
    expect(result.current.status).toEqual({ kind: "paused", reason: "stream:upstream" });
    expect(result.current.partial).toBeNull();
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await result.current.resume();
      await flush();
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(result.current.status).toEqual({ kind: "connecting" });
  });

  it("`error{write_failed}` → 「녹음 파일을 저장하지 못했습니다」 사유", async () => {
    const { result } = mount();
    const ws = await goLive(result);
    act(() => {
      ws.serverSend({ type: "error", code: "meeting_stream_disconnected", reason: "write_failed" });
      ws.serverClose(1011, "meeting_stream_disconnected");
    });
    expect(result.current.status).toEqual({ kind: "paused", reason: "stream:write_failed" });
  });

  it("예고 없는 close(네트워크·서버 다운) → `paused/stream:upstream`", async () => {
    const { result } = mount();
    const ws = await goLive(result);
    act(() => ws.serverClose(1006, ""));
    expect(result.current.status).toEqual({ kind: "paused", reason: "stream:upstream" });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("`4409 meeting_stream_active` → `stream:elsewhere` · `canResume=false` · `resume()` 이 연결을 열지 않는다", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.resume();
      await flush();
    });
    act(() => FakeWebSocket.last.serverClose(4409, "meeting_stream_active"));
    expect(result.current.status).toEqual({ kind: "paused", reason: "stream:elsewhere" });
    expect(result.current.canResume).toBe(false);
    await act(async () => {
      await result.current.resume();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("`4404` → 상세 재조회만 — 상태 바를 「서버 연결이 끊겼습니다」로 갈지 **않는다**(서버는 살아 있다 · SPEC-007 §4 close code 표)", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/${MEETING}`, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json(meetingDetail({ status: "recording" }))
          : HttpResponse.json({ detail: "없는 회의록입니다", code: "not_found" }, { status: 404 });
      }),
    );
    const { result } = mountWithDetail();
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => {
      await result.current.resume();
      await flush();
    });
    const before = result.current.status;
    act(() => FakeWebSocket.last.serverClose(4404, "not_found"));
    expect(result.current.status).toEqual(before);
    expect(result.current.status).not.toEqual({ kind: "paused", reason: "stream:upstream" });
    // 재조회가 404 로 돌아온다 — 「없는 회의록입니다」는 그 결과로 화면이 그린다(MeetingDetailPage)
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(client.getQueryState(queryKeys.meetingDetail(MEETING))?.status).toBe("error"));
    expect(result.current.status).not.toEqual({ kind: "paused", reason: "stream:upstream" });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("`4409 invalid_meeting_status` → 상세 재조회(화면이 낡았다)", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/${MEETING}`, () => {
        reads += 1;
        return HttpResponse.json(meetingDetail({ status: "ended" }));
      }),
    );
    const { result } = mountWithDetail();
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => {
      await result.current.resume();
      await flush();
    });
    act(() => FakeWebSocket.last.serverClose(4409, "invalid_meeting_status"));
    await waitFor(() => expect(reads).toBe(2));
    expect(result.current.status).toEqual({ kind: "paused", reason: "stream:upstream" });
  });

  it("마이크 트랙 `ended` → `paused/mic` + **`pause{mic}` 프레임** · 새 연결 없음 · 「재개」 → 마이크 다시 잡고 같은 소켓에 `resume`", async () => {
    const { result } = mount();
    const ws = await goLive(result);
    act(() => media.streams[0].tracks[0].unplug());
    expect(result.current.status).toEqual({ kind: "paused", reason: "mic" });
    expect(ws.sentFrames.at(-1)).toEqual({ type: "pause", reason: "mic" });
    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await result.current.resume();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sentFrames.at(-1)).toEqual({ type: "resume" });
    expect(result.current.status).toEqual({ kind: "connecting" });
    act(() => ws.serverSend(READY));
    expect(result.current.status).toEqual({ kind: "live" });
    // 새 마이크 → 새 recorder
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(FakeMediaRecorder.instances[1].state).toBe("recording");
  });
});

describe("설계 밖 실패 — 마이크 실패로 접지 않는다(DEC-003 §7 · 검수 F-2)", () => {
  it("`startCapture` 가 던지면(`MediaRecorder` 가 mime 을 전부 거부) **`pause{mic}` 0건 · `paused/mic` 아님** · 예외가 그대로 전파된다", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.resume();
      await flush();
    });
    const ws = FakeWebSocket.last;
    act(() => ws.serverOpen());

    // 환경 실패 — 이 recorder 는 어떤 mime 도 못 연다(audioCapture.ts 의 `NotSupportedError` 자리)
    vi.stubGlobal(
      "MediaRecorder",
      class {
        static isTypeSupported(): boolean {
          return false;
        }
        constructor() {
          throw new DOMException("no supported mime", "NotSupportedError");
        }
      },
    );

    expect(() => act(() => ws.serverSend(READY))).toThrow(/no supported mime/);
    expect(ws.sentFrames.filter((frame) => frame.type === "pause")).toEqual([]);
    expect(result.current.status).not.toEqual({ kind: "paused", reason: "mic" });
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("사용자 일시정지 · 재개 — 같은 세션", () => {
  it("`pause()` → `pause{user}` · 잠정 비움 · 캡처 pause. `resume()` → 같은 소켓에 `resume`(새 연결 없음) → `ready` → `live`", async () => {
    const { result } = mount();
    const ws = await goLive(result);
    act(() => ws.serverSend({ type: "transcript.partial", segments: [{ speakerLabel: "1", atMs: 1000, text: "잠정" }] }));

    act(() => result.current.pause());
    expect(result.current.status).toEqual({ kind: "paused", reason: "user" });
    expect(result.current.partial).toBeNull();
    expect(ws.sentFrames.at(-1)).toEqual({ type: "pause", reason: "user" });
    expect(FakeMediaRecorder.instances[0].state).toBe("paused");

    await act(async () => {
      await result.current.resume();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(ws.sentFrames.at(-1)).toEqual({ type: "resume" });
    expect(result.current.status).toEqual({ kind: "connecting" });

    act(() => ws.serverSend(READY));
    expect(result.current.status).toEqual({ kind: "live" });
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].state).toBe("recording");
  });
});

describe("프레임 분배", () => {
  it("잠정은 **교체**, 확정은 트랜스크립트 캐시에 **append** + 화자 수 갱신", async () => {
    const { result } = mount();
    const ws = await goLive(result);
    act(() => ws.serverSend({ type: "transcript.partial", segments: [{ speakerLabel: "1", atMs: 1000, text: "좋습니다" }] }));
    act(() => ws.serverSend({ type: "transcript.partial", segments: [{ speakerLabel: "1", atMs: 1000, text: "좋습니다. 그러면" }] }));
    expect(result.current.partial).toEqual([{ speakerLabel: "1", atMs: 1000, text: "좋습니다. 그러면" }]);

    act(() => ws.serverSend({ type: "transcript.final", item: { id: 301, speakerLabel: "1", atMs: 1000, endMs: 4000, content: "첫 블록" } }));
    act(() => ws.serverSend({ type: "transcript.final", item: { id: 302, speakerLabel: "2", atMs: 5000, endMs: 8000, content: "둘째 블록" } }));
    // 같은 id 는 두 번 붙지 않는다.
    act(() => ws.serverSend({ type: "transcript.final", item: { id: 302, speakerLabel: "2", atMs: 5000, endMs: 8000, content: "둘째 블록" } }));

    const cached = client.getQueryData<TranscriptResponse>(queryKeys.meetingTranscript(MEETING));
    expect(cached?.items.map((item) => item.content)).toEqual(["첫 블록", "둘째 블록"]);
    expect(cached?.speakerCount).toBe(2);
  });

  it("`ai.batch` 는 **즉시** 상세 캐시에 병합된다 — `latestBatchSeq` 증가 · `aiVersion` +1 · 재조회 없음", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/${MEETING}`, () => {
        reads += 1;
        return HttpResponse.json(meetingDetail());
      }),
    );
    const { result } = mount();
    const ws = await goLive(result);
    const aiAgenda = { id: 40, track: "ai", title: "개정 대상 섹션 확정", orderIndex: 0, state: null, sourceAgendaId: 301, lines: [] };
    const aiLine = {
      id: 620, track: "ai", agendaId: 40, kind: "decision", content: "3건만 유지", detail: "상세", evidence: [{ fromMs: 1000, toMs: 4000 }],
      orderIndex: 0, taskId: null, pendingChange: null, sourceHumanLineId: null, sourceAiLineId: null, task: null, createdAt: "2026-08-27T00:41:02Z",
    };
    act(() => ws.serverSend({ type: "ai.batch", seq: 1, agendas: [aiAgenda], lines: [aiLine] }));

    const detail = client.getQueryData<MeetingDetail>(queryKeys.meetingDetail(MEETING));
    expect(detail?.latestBatchSeq).toBe(1);
    expect(detail?.agendas.ai[0].lines.map((line) => line.id)).toEqual([620]);
    expect(result.current.aiVersion).toBe(1);
    expect(result.current.lastBatchAt).not.toBeNull();

    act(() => ws.serverSend({ type: "ai.batch", seq: 2, agendas: [], lines: [{ ...aiLine, id: 621, content: "둘째" }] }));
    expect(client.getQueryData<MeetingDetail>(queryKeys.meetingDetail(MEETING))?.latestBatchSeq).toBe(2);
    expect(result.current.aiVersion).toBe(2);
    await flush();
    expect(reads).toBe(0);
  });

  it("재연결 뒤 `ready.latestBatchSeq` 가 캐시보다 크면 **상세를 다시 읽어** 놓친 배치를 따라잡는다", async () => {
    let reads = 0;
    server.use(
      http.get(`${API_BASE}/api/meetings/${MEETING}`, () => {
        reads += 1;
        return HttpResponse.json(meetingDetail({ status: "recording", latestBatchSeq: 3 }));
      }),
    );
    const { result } = mountWithDetail();
    await waitFor(() => expect(reads).toBe(1));
    // 관찰자의 첫 조회가 캐시를 3 으로 올리지 않도록 — 끊긴 동안 배치가 돈 상황을 만든다.
    client.setQueryData<MeetingDetail>(queryKeys.meetingDetail(MEETING), meetingDetail({ status: "recording", latestBatchSeq: 1 }));
    await act(async () => {
      await result.current.resume();
      await flush();
    });
    act(() => {
      FakeWebSocket.last.serverOpen();
      FakeWebSocket.last.serverSend({ ...READY, latestBatchSeq: 3 });
    });
    await waitFor(() => expect(reads).toBe(2));
  });
});

describe("떠날 때", () => {
  it("언마운트하면 소켓을 닫고(1000) 마이크를 놓는다 — 상태로 드러내지 않는다", async () => {
    const { result, unmount } = mount();
    const ws = await goLive(result);
    unmount();
    expect(ws.clientClosed).toEqual({ code: 1000, reason: "leave" });
    expect(media.streams[0].tracks[0].readyState).toBe("ended");
    expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
  });
});

// `renderWithProviders` 는 여기서 쓰지 않지만 시드 픽스처와 같은 파일에 산다 — import 정리를 위해 남긴다.
void renderWithProviders;

/**
 * fetch 래퍼 — **모든 호출이 이 파일을 지난다**(frontend/README.md §2 규칙 5).
 *
 * WORK-001 은 최소판이다. 아직 없는 것:
 * - `Authorization: Bearer` 부착 · `401 token_expired` → refresh 1회 → 원 요청 재시도 → **WORK-002**(§4-2)
 * - WS 첫 프레임 토큰 규약 → 회의록 배치(§4-2)
 *
 * 이미 있는 것: **에러를 `ApiError{status, code, detail}` 로 바꾸는 규약**.
 * 여기서 조용한 기본값·빈 배열로 대체하지 않는다(§3-5 · DEC-003 §7).
 */

import { env } from "@/lib/env";
import { ApiError, CLIENT_ERROR_CODE } from "@/lib/api/errors";

export interface ApiRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

function buildUrl(path: string): string {
  return path.startsWith("http") ? path : `${env.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 요청이 서버에 **닿기는 했는지** 확인한다.
 *
 * `fetch` 는 CORS 차단과 「서버가 없다」를 똑같은 `TypeError` 로 던져 구분할 수 없다.
 * SPEC-000 §4 Case Matrix 가 그 둘을 **다른 문구**로 요구하므로(「서버가 응답하지 않습니다」 /
 * 「요청이 서버에서 거부되었습니다(CORS)」) 실패했을 때만 `mode:"no-cors"` 로 한 번 더 두드린다.
 * opaque 응답은 상태코드와 무관하게 resolve 하므로 **「닿았다 = CORS 문제」** 로 읽을 수 있다.
 *
 * 이건 **재시도가 아니라 진단**이다 — 성공 경로에서는 나가지 않고, 실패 경로에서도
 * 헬스 요청 자체를 다시 보내지 않는다(`retry:false` 계약을 건드리지 않는다).
 */
async function isServerReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallbackDetail = `HTTP ${response.status}`;
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object") {
      const body = payload as { detail?: unknown; code?: unknown };
      const detail = typeof body.detail === "string" ? body.detail : fallbackDetail;
      const code = typeof body.code === "string" ? body.code : `http_${response.status}`;
      return new ApiError(response.status, code, detail);
    }
  } catch {
    // 본문이 JSON 이 아니면 상태코드만 남는다 — 가리지 않고 그대로 올린다.
  }
  return new ApiError(response.status, `http_${response.status}`, fallbackDetail);
}

export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const url = buildUrl(path);
  const { body, headers, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const reachable = await isServerReachable(url);
    throw reachable
      ? new ApiError(0, CLIENT_ERROR_CODE.CORS_BLOCKED, "요청이 서버에서 거부되었습니다(CORS)")
      : new ApiError(
          0,
          CLIENT_ERROR_CODE.NETWORK_UNREACHABLE,
          `서버가 응답하지 않습니다 · ${env.apiBase}`,
        );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

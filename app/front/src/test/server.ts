import { setupServer } from "msw/node";

/**
 * MSW 서버 하나. 핸들러는 **각 테스트가 `server.use()` 로 붙인다** — 기본 핸들러를 두면
 * 「나가면 안 되는 요청」이 조용히 성공해 버린다(§11 ⑦ 이 그걸 잡는 테스트다).
 */
export const server = setupServer();

/** `env.apiBase` 와 같은 값. 테스트가 절대 URL 로 핸들러를 건다. */
export const API_BASE = "http://localhost:8000";

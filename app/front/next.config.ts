import type { NextConfig } from "next";

/**
 * 정적 빌드 계약 — `frontend/README.md` §1-3.
 *
 * 여기 세 값은 **바꾸지 않는다.** Route Handler(`src/app/api/**`) · `middleware.ts` ·
 * Server Action · 동적 세그먼트(`[id]`)를 만들지 않는 전제가 이 설정이다.
 */
const nextConfig: NextConfig = {
  // FE-C1 — 서버 런타임이 없다. `next build` 가 `out/` 을 굽고 Tauri 셸이 그걸 싣는다.
  output: "export",
  // 정적 서빙에서 `/tasks/` 가 `tasks/index.html` 로 안정적으로 떨어진다.
  trailingSlash: true,
  // 이미지 최적화 서버가 없다.
  images: { unoptimized: true },
};

export default nextConfig;

import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 러너 = **Vitest + React Testing Library**, 네트워크는 **MSW 로 `lib/api/client.ts` 아래에서**
 * 가로챈다(`frontend/README.md` §11). 훅·컴포넌트를 목으로 바꾸지 않는다.
 *
 * `env.ts` 가 `NEXT_PUBLIC_API_BASE` 를 **필수**로 읽고 없으면 던지므로(SPEC-000 §5),
 * 테스트 환경에도 값을 준다 — 기본값을 코드에 심지 않기 위한 계약이라 여기서 채운다.
 */
export default defineConfig({
  // `@vitejs/plugin-react` 를 쓰지 않는다 — Fast Refresh 는 테스트에 필요 없고, 그 플러그인이
  // 무는 vite 사본이 vitest 쪽과 달라 `tsc` 가 타입 충돌로 선다. JSX 변환은 아래 esbuild 가 한다.
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  /**
   * `tsconfig.json` 은 `jsx: "preserve"` 다 — Next 가 변환을 맡기 때문이다. 테스트는 Next 를
   * 지나지 않으므로 여기서 **automatic 런타임**을 켠다(안 켜면 classic 으로 떨어져 `React` 를 찾는다).
   */
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      NEXT_PUBLIC_API_BASE: "http://localhost:8000",
      NEXT_PUBLIC_APP_VERSION: "0.1.0",
    },
  },
});

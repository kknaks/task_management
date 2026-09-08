/**
 * **필수 테스트 ⑧ — 정적 빌드 산출**(`frontend/README.md` §11 8).
 *
 * > `next build` 가 `out/` 을 만들고, `app/api/**`·`middleware.ts` 가 없으며,
 * > **동적 세그먼트 디렉토리(`[…]`)가 없다**(FE-C1 · §1-2).
 *
 * **빌드를 이 테스트가 돌리지 않는다.** 대신 산출을 결정하는 **소스 불변식**을 항상 검사하고,
 * `out/` 이 이미 있으면 그 트리도 함께 검사한다(`npm run build` 뒤에 돌리면 자동으로 켜진다).
 * 소스 불변식 넷이 성립하면 `out/` 의 형태는 따라온다 — Route Handler·미들웨어·동적 세그먼트가
 * 소스에 없으면 산출물에도 없다.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(ROOT, "src/app");
const OUT_DIR = path.join(ROOT, "out");

/** 디렉토리 트리를 걷는다. `node_modules` 는 들어가지 않는다. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = path.join(dir, entry);
    found.push(full);
    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
    }
  }
  return found;
}

describe("⑧ 정적 빌드 산출 — 소스 불변식", () => {
  it("동적 세그먼트 디렉토리가 없다", () => {
    const dynamic = walk(APP_DIR)
      .filter((entry) => statSync(entry).isDirectory())
      .filter((entry) => /\[.+\]/.test(path.basename(entry)));

    // `output:'export'` 는 빌드 시점에 모든 경로를 구워야 하는데 id 는 런타임에 생긴다(§1-2).
    expect(dynamic).toEqual([]);
  });

  it("Route Handler(`app/api/**`) 와 `middleware.ts` 가 없다", () => {
    expect(existsSync(path.join(APP_DIR, "api"))).toBe(false);
    expect(existsSync(path.join(ROOT, "src/middleware.ts"))).toBe(false);
    expect(existsSync(path.join(ROOT, "middleware.ts"))).toBe(false);

    // Server Action 도 쓰지 않는다. **디렉토리 첫 줄**로 선언되므로 그 자리만 본다 —
    // 본문에 문자열로 등장하는 것(이 파일이 그렇다)까지 잡으면 자기 자신에 걸린다.
    const serverActions = walk(path.join(ROOT, "src"))
      .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      .filter((entry) => /^\s*["']use server["']/.test(readFileSync(entry, "utf8")));
    expect(serverActions).toEqual([]);
  });

  it("모든 `page.tsx` 가 `'use client'` 로 시작한다", () => {
    const pages = walk(APP_DIR).filter((entry) => path.basename(entry) === "page.tsx");

    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(readFileSync(page, "utf8").startsWith('"use client"')).toBe(true);
    }
  });

  it("`next.config.ts` 가 `output: 'export'` 를 고정한다", () => {
    const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");

    expect(config).toMatch(/output:\s*["']export["']/);
    expect(config).toMatch(/trailingSlash:\s*true/);
  });
});

describe("⑧ 정적 빌드 산출 — `out/` 트리", () => {
  // 빌드를 돌리는 것은 이 테스트의 몫이 아니다. 산출물이 있으면 함께 검사한다.
  const hasOut = existsSync(OUT_DIR);

  it.skipIf(!hasOut)("`out/` 에 동적 세그먼트 디렉토리가 없고 진입 문서가 있다", () => {
    const dynamic = walk(OUT_DIR)
      .filter((entry) => statSync(entry).isDirectory())
      .filter((entry) => /\[.+\]/.test(path.basename(entry)));

    expect(dynamic).toEqual([]);
    expect(existsSync(path.join(OUT_DIR, "index.html"))).toBe(true);
    expect(existsSync(path.join(OUT_DIR, "login/index.html"))).toBe(true);
    expect(existsSync(path.join(OUT_DIR, "tasks/index.html"))).toBe(true);
  });
});

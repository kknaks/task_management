/**
 * **정적 검사 — WORK-006 Phase 4·5·6 이 grep 으로 요구한 것**(frontend/README.md §11 금지 목록).
 *
 * 1. `Sheet`/`Dialog` 직접 import 0건 (§6-1)
 * 2. 인라인 색 hex 0건 (§5-3)
 * 3. 컴포넌트에서 `new Date()` 포맷 0건 — 시각 변환은 `lib/datetime` 하나 (§3-6)
 * 4. 동적 세그먼트 0건 · 모든 `page.tsx` 가 `'use client'` (§1-2 — `staticExport.test.ts` 가 전체를 본다, 여기는 회의록 라우트)
 * 5. `tokenStore` 밖 저장소 호출 0건 (§4-1)
 * 6. 상단 바 컴포넌트 **1개 파일**
 * 7. `MeetingCreateDrawer` 가 라우터·부모 상태를 import 하지 않는다 · 드로어 폭 리터럴이 `DrawerFrame` 밖에 0건
 * 8. 공용 부품(`MeetingAttachmentsTab` · `AttachmentFileDrawer` · `MeetingAgendaList` · `MeetingStatusBar`)이
 *    회의 상태·라우트를 import 하지 않는다 · 자동 저장 실패를 `useState` 로 드는 컴포넌트 0건
 * 9. 영역 사이 import 0건 — **모든 `features/*`** 가 다른 영역을 부르지 않는다 (§2 규칙 4).
 *    WORK-006 검수 W-1 — meetings→settings 만 보던 검사가 tasks→settings 를 놓쳤다. 이제 전 영역을 본다
 * 10. `text-[NNpx]` 임의 글꼴 크기 0건 — 타이포 계단은 프리셋으로만 (§5-1 · W-4)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const MEETINGS = path.join(SRC, "features/meetings");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const meetingSources = walk(MEETINGS).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => path.relative(SRC, file);

describe("① 오버레이 — Sheet/Dialog 직접 import 0건", () => {
  it("features/meetings 에 `components/ui/sheet` · `components/ui/dialog` import 가 없다", () => {
    const offenders = meetingSources.filter((file) =>
      /from ["']@\/components\/ui\/(sheet|dialog)["']/.test(read(file)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("② 색 — 인라인 hex 0건", () => {
  it("features/meetings · PanelTabs · MeetingTopBar 에 `#rrggbb` 리터럴이 없다(주석 제외)", () => {
    const targets = [...meetingSources, path.join(SRC, "components/shared/PanelTabs.tsx")];
    const offenders = targets.filter((file) => {
      const code = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return /#[0-9a-fA-F]{3,8}\b/.test(code);
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("③ 시각 — 컴포넌트에서 new Date() 포맷 0건", () => {
  it("features/meetings 의 컴포넌트·훅에 `new Date(` 가 없다 — 변환은 lib/datetime 하나", () => {
    const offenders = meetingSources.filter((file) => /new Date\(/.test(read(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("④ 라우트 — 동적 세그먼트 0건 · page 는 'use client'", () => {
  it("`app/(app)/meetings` 아래에 `[…]` 디렉토리가 없고 두 page.tsx 가 'use client' 로 시작한다", () => {
    const dir = path.join(SRC, "app/(app)/meetings");
    const dynamic = walk(dir).filter((entry) => statSync(entry).isDirectory() && /\[.+\]/.test(path.basename(entry)));
    expect(dynamic).toEqual([]);
    for (const page of ["page.tsx", "detail/page.tsx"]) {
      const file = path.join(dir, page);
      expect(existsSync(file)).toBe(true);
      expect(read(file).startsWith('"use client"')).toBe(true);
    }
  });
});

describe("⑤ 토큰 저장소 — tokenStore 밖 저장소 호출 0건", () => {
  it("features/meetings 에 localStorage · sessionStorage · @tauri-apps 호출이 없다", () => {
    const offenders = meetingSources.filter((file) =>
      /localStorage|sessionStorage|@tauri-apps/.test(read(file)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("⑥ 상단 바 — 파일 하나", () => {
  it("`TopBar`·`StatusBar` 이름을 가진 컴포넌트 파일이 `MeetingStatusBar.tsx` 하나다 — WORK-007 이 WORK-006 의 `MeetingTopBar` 를 흡수했다", () => {
    const files = walk(SRC)
      .filter((file) => /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file))
      .filter((file) => /(TopBar|StatusBar)/i.test(path.basename(file)));
    expect(files.map(rel)).toEqual(["features/meetings/components/MeetingStatusBar.tsx"]);
  });
});

describe("⑦ 드로어 — 부모를 모른다 · 폭 리터럴 없음", () => {
  it("`MeetingCreateDrawer` 가 next/navigation · 목록 훅 · 뷰 파라미터를 import 하지 않는다(콜백만)", () => {
    const code = read(path.join(MEETINGS, "components/MeetingCreateDrawer.tsx"));
    expect(code).not.toMatch(/from ["']next\/navigation["']/);
    expect(code).not.toMatch(/useMeetingsViewParams|useMeetingsQuery|MeetingsScreen|MeetingListPanel/);
  });

  it("드로어 폭 리터럴이 features/meetings 에 0건 — 폭은 `DrawerFrame` 하나가 정한다", () => {
    // 리터럴을 이 파일에도 적지 않는다 — `DrawerFrame.test` 의 전역 grep 에 이 파일이 걸린다.
    const width = [8, 4, 0].join("");
    const pattern = new RegExp(`w-\\[${width}px\\]|\\b${width}\\b`);
    const offenders = meetingSources.filter((file) => pattern.test(read(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("⑧ 공용 부품 — 상태·라우트 무의존 · 실패 state 0건", () => {
  const shared = ["MeetingAttachmentsTab", "AttachmentFileDrawer", "MeetingAgendaList", "MeetingStatusBar", "AgendaInputBar"];

  it("공용 부품이 next/navigation · useMeetingDetail · useMeetingMutations · useSearchParams 를 import 하지 않는다", () => {
    for (const name of shared) {
      const code = read(path.join(MEETINGS, `components/${name}.tsx`));
      expect(code, name).not.toMatch(/from ["']next\/navigation["']/);
      expect(code, name).not.toMatch(/useMeetingDetail|useMeetingMutations|useMeetingsViewParams|useSearchParams|useRouter/);
      // `status === "recording"` 같은 상태 분기가 없다 — 화면별 조건은 prop 으로 온다.
      expect(code, name).not.toMatch(/status\s*===\s*["'](scheduled|recording|generating|ended)["']/);
    }
  });

  it("자동 저장 실패 상태를 `useState` 로 드는 컴포넌트가 0건이다 — 소유자는 useRowFailures", () => {
    const offenders = meetingSources
      .filter((file) => file.includes("/components/"))
      .filter((file) => /useState<[^>]*(Fail|fail)/.test(read(file)) || /set(Save)?Failed\(/.test(read(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("⑨ 영역 사이 import 금지 — 전 영역", () => {
  it("features/<a> 가 features/<b> 를 import 하지 않는다(테스트 파일 제외) — 공유는 lib/ · components/shared/", () => {
    const FEATURES = path.join(SRC, "features");
    const offenders: string[] = [];
    for (const area of readdirSync(FEATURES)) {
      const sources = walk(path.join(FEATURES, area)).filter(
        (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
      );
      for (const file of sources) {
        const imports = read(file).match(/@\/features\/([a-z-]+)\//g) ?? [];
        // 규칙 4 의 단 하나의 예외(캘린더가 업무·회의 드로어를 재사용)는 아직 없는 영역이다 — 예외 목록 없음.
        if (imports.some((hit) => hit !== `@/features/${area}/`)) {
          offenders.push(rel(file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("⑩ 타이포 — 임의 글꼴 크기 0건", () => {
  it("features/meetings 에 `text-[NNpx]` 가 없다 — 계단은 tailwind.config.ts 프리셋으로만(§5-1)", () => {
    const offenders = meetingSources.filter((file) => /text-\[\d+px\]/.test(read(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

/* ── WORK-007 — 회의 중 화면의 정적 검사(WP Phase 5·6 · 발주 §7) ──────────────────────────── */

describe("⑪ WS — `new WebSocket(` 은 `lib/api/ws.ts` 하나 · 재연결 타이머 0", () => {
  it("`new WebSocket(` 이 `lib/api/ws.ts` 밖에 0건이다(테스트 파일 제외)", () => {
    const offenders = walk(SRC)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("/test/"))
      .filter((file) => /new WebSocket\(/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual(["lib/api/ws.ts"]);
  });

  it("`lib/api/ws.ts` · `useMeetingStream.ts` · `audioCapture.ts` 에 `setInterval`·`setTimeout`·`reconnect`·`retry` 가 없다 — 자동 재연결 없음(BE-12)", () => {
    for (const file of ["lib/api/ws.ts", "features/meetings/hooks/useMeetingStream.ts", "features/meetings/hooks/audioCapture.ts"]) {
      const code = read(path.join(SRC, file))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/setInterval|setTimeout|reconnect|backoff|\bretry\b/i);
    }
  });

  it("`useMeetingStream` 이 마운트 effect 에서 소켓을 열지 않는다 — `openAuthenticatedSocket` 호출은 `openSocket` 한 함수 안 1건", () => {
    const code = read(path.join(MEETINGS, "hooks/useMeetingStream.ts"));
    expect(code.match(/openAuthenticatedSocket</g) ?? []).toHaveLength(1);
    // 마운트 effect 는 정리(닫기)만 한다.
    expect(code).not.toMatch(/useEffect\([\s\S]{0,400}openSocket\(\)/);
  });
});

describe("⑫ 트리 — `AgendaLineTree` 안에 `track` 비교 0건", () => {
  it("`AgendaLineTree` · `AgendaHeader` · `LineRow` · `EvidenceChip` · `TranscriptPanel` 에 `track ===`·`track !==`·`.track` 이 없다 — 차이는 props 뿐", () => {
    for (const name of ["AgendaLineTree", "AgendaHeader", "LineRow", "EvidenceChip", "TranscriptPanel"]) {
      const code = read(path.join(MEETINGS, `components/${name}.tsx`))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/track\s*[!=]==?|\.track\b|["']human["']|["']ai["']|["']merged["']/);
    }
  });
});

describe("⑬ 회의 중 공용 부품 — 상태·라우트 무의존", () => {
  it("`AgendaLineTree` · `TranscriptPanel` · `PromptBar` · `LineKindPopover` · `MeetingStatusBar` · `EvidenceChip` 이 next/navigation · 상세·뮤테이션 훅 · 회의 상태를 import 하지 않는다", () => {
    for (const name of ["AgendaLineTree", "AgendaHeader", "LineRow", "EvidenceChip", "TranscriptPanel", "PromptBar", "LineKindPopover", "MeetingStatusBar"]) {
      const code = read(path.join(MEETINGS, `components/${name}.tsx`));
      expect(code, name).not.toMatch(/from ["']next\/navigation["']/);
      expect(code, name).not.toMatch(/useMeetingDetail|useMeetingMutations|useMeetingStream|useSearchParams|useRouter|useQueryClient/);
      expect(code, name).not.toMatch(/status\s*===\s*["'](scheduled|recording|generating|ended)["']/);
    }
  });
});

describe("⑭ 시안에 있으나 그리지 않는 것(SPEC-007 §7-B) — 문구 0건", () => {
  it("회의 중 화면 파일에 「회의실」·「회의 중 작성」·「PNG」·「PDF」·「다시 연결」 이 없고, 상태 바에 「자동 저장」·파형이 없다", () => {
    const live = ["MeetingLiveView", "MeetingStatusBar", "PromptBar", "TranscriptPanel", "AgendaLineTree", "LineRow", "AgendaHeader"];
    for (const name of live) {
      const code = read(path.join(MEETINGS, `components/${name}.tsx`))
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(code, name).not.toMatch(/회의실|회의 중 작성|PNG|PDF|다시 연결/);
    }
    const bar = read(path.join(MEETINGS, "components/MeetingStatusBar.tsx"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(bar).not.toMatch(/자동 저장|wave|파형/);
  });
});

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
 *    WORK-006 검수 W-1 — meetings→settings 만 보던 검사가 tasks→settings 를 놓쳤다. 이제 전 영역을 본다.
 *    WORK-008 검수 F-1 — `@/features/<b>/…` 만 잡던 정규식이 **배럴 `@/features/<b>`** 를 통과시켰다. 이제 배럴도 잡고,
 *    규칙 4 의 단 하나의 예외(드로어 재사용)만 **이름 목록**으로 둔다
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

/**
 * **규칙 4 의 단 하나의 예외 — 이름 목록**(frontend/README.md §2 규칙 4 · DEC-005 §2).
 *
 * 「업무·회의 상세/생성 드로어는 캘린더·회의록이 재사용한다」 — 지금 실제로 다른 영역이 쓰는 것은 회의록의 「결과 입력」 →
 * 업무 상세 드로어(`openTaskDetailDrawer` · SPEC-004 U-6 · SPEC-008 U-6) **하나**다. 그래서 목록도 하나다.
 * 캘린더가 업무 생성 드로어·회의 드로어를 가져가는 work 가 오면 **그때 그 이름을 여기 더한다** — 미리 열어 두지 않는다.
 *
 * 드로어가 아닌 것(훅 · API · 전이 표 · 타입)은 예외가 아니다 — `lib/` 로 올린다(WORK-006 검수 W-1 → G-5 · WORK-008 검수 F-1).
 * 배럴(`@/features/<b>`)로 가져와도 이 목록 밖의 이름이면 위반이다.
 */
const CROSS_AREA_ALLOWED: Record<string, ReadonlySet<string>> = {
  // `openTaskDetailDrawer` — 「결과 입력」 유도(WORK-008) · `RelationPopover` — SPEC-008 U-9 가 「업무 화면의 부품을 **그대로 재사용**」
  // 하라고 못박은 자리(WORK-013). 둘 다 **두 벌을 만들지 않으려는** 예외이고 배럴로만 나간다.
  tasks: new Set(["openTaskDetailDrawer", "RelationPopover"]),
};

/**
 * 파일 하나의 영역 사이 import 위반 목록 — 문자열로 돌려준다(어느 경로 · 어느 이름이 걸렸는지 실패 메시지에 그대로 실린다).
 *
 * - `@/features/<b>/…`(내부 경로) — **전부 위반**. 예외도 배럴로만 가져온다.
 * - `@/features/<b>`(배럴) — `import { … } from` 의 이름이 **전부** `CROSS_AREA_ALLOWED[b]` 안에 있을 때만 통과.
 *   기본 import · `* as` · `import()` · `export … from` 은 이름을 추출하지 않으므로 위반이다.
 */
function crossAreaViolations(code: string, area: string): string[] {
  const violations: string[] = [];
  // 이름을 판정한 배럴 import 문(통과 · 위반 모두) — 아래 원시 리터럴 검사에서 같은 수만큼 빼 준다(위반은 한 번만 센다).
  const judgedBarrel = new Map<string, number>();
  for (const match of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@\/features\/([a-z-]+)["']/g)) {
    const [, clause, other] = match;
    if (other === area) {
      continue;
    }
    const names = clause.split(",").map((name) => name.trim().replace(/^type\s+/, "").replace(/\s+as\s+.*$/, "")).filter(Boolean);
    const allowed = CROSS_AREA_ALLOWED[other] ?? new Set<string>();
    const rejected = names.filter((name) => !allowed.has(name));
    if (rejected.length > 0) {
      violations.push(`@/features/${other} { ${rejected.join(", ")} }`);
    }
    judgedBarrel.set(other, (judgedBarrel.get(other) ?? 0) + 1);
  }
  // 원시 리터럴 — import 문 형태와 무관하게 `@/features/<b>` · `@/features/<b>/…` 전부를 센다.
  for (const match of code.matchAll(/["']@\/features\/([a-z-]+)(\/[^"']*)?["']/g)) {
    const [, other, subpath] = match;
    if (other === area) {
      continue;
    }
    if (subpath) {
      violations.push(`@/features/${other}${subpath}`);
      continue;
    }
    const remaining = judgedBarrel.get(other) ?? 0;
    if (remaining > 0) {
      judgedBarrel.set(other, remaining - 1);
    } else {
      violations.push(`@/features/${other} (배럴 — 허용 이름 목록 밖 형태)`);
    }
  }
  return violations;
}

describe("⑨ 영역 사이 import 금지 — 전 영역 · 배럴 포함", () => {
  const FEATURES = path.join(SRC, "features");
  const areaSources = (area: string) =>
    walk(path.join(FEATURES, area)).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));

  it("features/<a> 가 features/<b> 를 import 하지 않는다(테스트 파일 제외 · 배럴 `@/features/<b>` 포함) — 공유는 lib/ · components/shared/ · 예외는 드로어 이름 목록뿐", () => {
    const offenders: string[] = [];
    for (const area of readdirSync(FEATURES)) {
      for (const file of areaSources(area)) {
        for (const violation of crossAreaViolations(read(file), area)) {
          offenders.push(`${rel(file)} → ${violation}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("예외 목록에 실제로 쓰이는 드로어 하나만 있다 — 목록에 있는 이름은 다른 영역이 실제로 가져간다(죽은 예외 0)", () => {
    for (const [owner, names] of Object.entries(CROSS_AREA_ALLOWED)) {
      const importers = readdirSync(FEATURES)
        .filter((area) => area !== owner)
        .flatMap((area) => areaSources(area))
        .map(read);
      for (const name of names) {
        const used = importers.some((code) => new RegExp(`import\\s+\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+["']@/features/${owner}["']`).test(code));
        expect(used, `${owner}.${name}`).toBe(true);
      }
    }
  });

  it("검사 자신이 배럴을 잡는다 — 배럴 · 내부 경로 · 목록 밖 이름 · 기본 import 를 넣으면 전부 위반으로 센다(⑨ 의 자기 검증 · F-1 재발 방지)", () => {
    expect(crossAreaViolations('import { canTransition } from "@/features/tasks";', "meetings")).toEqual(["@/features/tasks { canTransition }"]);
    expect(crossAreaViolations('import { openTaskDetailDrawer, useTaskDoneToast } from "@/features/tasks";', "meetings")).toEqual(["@/features/tasks { useTaskDoneToast }"]);
    expect(crossAreaViolations('import { fetchRelationCandidates } from "@/features/tasks/api";', "meetings")).toEqual(["@/features/tasks/api"]);
    expect(crossAreaViolations('import type { TaskRelation } from "@/features/tasks";', "meetings")).toEqual(["@/features/tasks { TaskRelation }"]);
    expect(crossAreaViolations('import tasks from "@/features/tasks";', "meetings")).toEqual(["@/features/tasks (배럴 — 허용 이름 목록 밖 형태)"]);
    expect(crossAreaViolations('const m = await import("@/features/tasks");', "meetings")).toEqual(["@/features/tasks (배럴 — 허용 이름 목록 밖 형태)"]);
    expect(crossAreaViolations('export { openTaskDetailDrawer } from "@/features/tasks";', "meetings")).toEqual(["@/features/tasks (배럴 — 허용 이름 목록 밖 형태)"]);
    // 통과하는 것 — 예외 이름만 · 자기 영역 · 타입 import 라도 이름이 목록 안이면
    expect(crossAreaViolations('import { openTaskDetailDrawer } from "@/features/tasks";', "meetings")).toEqual([]);
    expect(crossAreaViolations('import { x } from "@/features/meetings/api";', "meetings")).toEqual([]);
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
      // 「회의 중 작성」은 첨부 메타 라벨이다 — SPEC-008 U-2 실패 배너 문구 「회의 중 작성한 원본을 …」(상단 바 파일)은 다른 것이라 뺀다.
      expect(code, name).not.toMatch(/회의실|회의 중 작성(?!한 원본)|PNG|PDF|다시 연결/);
    }
    const bar = read(path.join(MEETINGS, "components/MeetingStatusBar.tsx"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(bar).not.toMatch(/자동 저장|wave|파형/);
  });
});

/* ── WORK-008 — 종료 후 화면의 정적 검사(WP Phase 3·4·6 · 발주 §7) ──────────────────────────── */

const WORK_008_FILES = [
  "closeState.ts",
  "hooks/useMeetingFinalizeJob.ts",
  "hooks/useMeetingEdit.tsx",
  "components/MeetingDetailBody.tsx",
  "components/MeetingClosedPage.tsx",
  "components/MeetingDetailDrawer.tsx",
  "components/MeetingMetaInline.tsx",
  "components/MeetingStatusChip.tsx",
  "components/AddLineDrawer.tsx",
  "components/LineDeleteModal.tsx",
  "components/AgendaTitleInline.tsx",
  "components/InlineFieldInput.tsx",
  "openMeetingDrawers.tsx",
  // Phase 5 — 업무 연동
  "hooks/useMeetingTaskLink.tsx",
  "components/LineTaskButton.tsx",
  "components/LinkTaskDrawer.tsx",
  "components/CreateTaskFromLineDrawer.tsx",
  "components/PayloadDrawerParts.tsx",
  "components/TaskDateField.tsx",
];

const stripComments = (code: string) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("⑮ 트리 — 컴포넌트 하나 · `track` prop 으로 부르지 않는다", () => {
  it("`features/meetings/components` 에 `Tree` 이름을 가진 컴포넌트 파일이 `AgendaLineTree.tsx` 하나다(두 번째 트리 0건)", () => {
    const trees = meetingSources.filter((file) => /Tree/i.test(path.basename(file))).map(rel);
    expect(trees).toEqual(["features/meetings/components/AgendaLineTree.tsx"]);
  });

  it("`<AgendaLineTree` 호출에 `track=` prop 이 없다 — 최종 회의록은 `agendas={…merged}` 로 부를 뿐이다", () => {
    const offenders = meetingSources.filter((file) => /<AgendaLineTree[\s\S]*?track=/.test(read(file))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("`AgendaLineTree` 안에 `track` 비교가 여전히 0건이다(⑫ 재실행)", () => {
    const code = stripComments(read(path.join(MEETINGS, "components/AgendaLineTree.tsx")));
    expect(code).not.toMatch(/track\s*[!=]==?|\.track\b|["']human["']|["']ai["']|["']merged["']/);
  });
});

describe("⑯ 상단 바 슬롯 — `MeetingDetailBody` 하나", () => {
  it("`variant=\"generating\"` · `variant=\"failed\"` 를 그리는 곳이 `MeetingDetailBody.tsx` 하나다(상단 바 파일 자신 제외)", () => {
    const users = meetingSources
      .filter((file) => !file.endsWith("MeetingStatusBar.tsx"))
      .filter((file) => /variant="(generating|failed)"/.test(read(file)))
      .map(rel);
    expect(users).toEqual(["features/meetings/components/MeetingDetailBody.tsx"]);
  });

  it("WORK-008 파일 중 `<MeetingStatusBar` 를 그리는 곳이 `MeetingDetailBody.tsx` 하나다", () => {
    const users = WORK_008_FILES.filter((name) => /<MeetingStatusBar\b/.test(read(path.join(MEETINGS, name))));
    expect(users).toEqual(["components/MeetingDetailBody.tsx"]);
  });
});

describe("⑰ 본문 껍데기 둘 — 페이지 · 드로어", () => {
  it("`MeetingDetailBody` 를 import 하는 파일이 `MeetingClosedPage.tsx` · `MeetingDetailDrawer.tsx` 둘이다(본문이 셋이 아니다)", () => {
    const users = meetingSources
      .filter((file) => /from ["']@\/features\/meetings\/components\/MeetingDetailBody["']/.test(read(file)))
      .map(rel)
      .sort();
    expect(users).toEqual([
      "features/meetings/components/MeetingClosedPage.tsx",
      "features/meetings/components/MeetingDetailDrawer.tsx",
    ]);
  });

  it("`MeetingDetailBody` 가 라우터 · 검색 파라미터를 import 하지 않는다(부모를 모른다)", () => {
    const code = read(path.join(MEETINGS, "components/MeetingDetailBody.tsx"));
    expect(code).not.toMatch(/from ["']next\/navigation["']/);
    expect(code).not.toMatch(/useSearchParams|useRouter/);
  });
});

describe("⑱ 시안에 있으나 그리지 않는 것(SPEC-008 §7) — 문구 0건", () => {
  it("WORK-008 파일(주석 제외)에 「되돌리기」 버튼 · 「구간 추가」 · 「비워두면 회의 종료 후」 · 「시작 상태」 · 「연관 업무로 바꾸기」 · 「미팅 · 회의」 · 「다음으로」 · 「MM.DD HH:mm 생성」 · 「대기」 배지가 없다", () => {
    for (const name of WORK_008_FILES) {
      const code = stripComments(read(path.join(MEETINGS, name)));
      expect(code, name).not.toMatch(/[>"'`]되돌리기[<"'`]/);
      expect(code, name).not.toMatch(/구간 추가|비워두면|시작 상태|연관 업무로 바꾸기|미팅 · 회의|["'>]다음으로["'<]|:\d\d 생성|HH:mm 생성/);
      expect(code, name).not.toMatch(/["'>]대기["'<]/);
    }
    // 문단 요약(「요약 · AI 생성」)도 없다 — 한 줄 요약 바와 다른 것이다(§7)
    for (const name of WORK_008_FILES) {
      expect(stripComments(read(path.join(MEETINGS, name))), name).not.toMatch(/요약 · AI 생성/);
    }
  });

  it("종료 후 배지 어휘 — `closeState.ts` 의 `next` 는 「다음 논의로」", () => {
    const code = read(path.join(MEETINGS, "closeState.ts"));
    expect(code).toMatch(/next:\s*\{\s*tone:\s*"next",\s*label:\s*"다음 논의로"\s*\}/);
  });
});

describe("⑲ 편집 저장 경계 — 삭제는 낙관적이지 않다 · 폴링은 계약 주기로만", () => {
  it("`useMeetingEdit` 의 삭제 뮤테이션(`removeLine`)에 `onMutate` 가 없다 — 모달을 지나 204 뒤에만 지운다", () => {
    const code = read(path.join(MEETINGS, "hooks/useMeetingEdit.tsx"));
    const start = code.indexOf("const removeLine = useMutation({");
    const end = code.indexOf("});", start);
    expect(start).toBeGreaterThan(0);
    expect(code.slice(start, end)).not.toMatch(/onMutate/);
    // 삭제 모달을 여는 곳은 `LineDeleteModal` 하나 · `openConfirm` 을 직접 부르는 WORK-008 화면 파일이 없다
    const direct = WORK_008_FILES.filter((name) => name !== "components/LineDeleteModal.tsx" && /openConfirm\(/.test(read(path.join(MEETINGS, name))));
    expect(direct).toEqual([]);
  });

  it("`useMeetingFinalizeJob` 에 타이머·자동 재시도가 없고 주기 2000 · 상한 **1230** 이 상수로 있다(SPEC-008 §4 수치)", () => {
    const code = stripComments(read(path.join(MEETINGS, "hooks/useMeetingFinalizeJob.ts")));
    // `retry` 는 「다시 시도」(`POST …/finalize`)의 이름이라 살아 있다 — 막는 것은 **자동** 재시도다
    expect(code).not.toMatch(/setInterval|setTimeout|retry:\s*(true|\d)|retryDelay|backoff/);
    expect(code).toMatch(/JOB_POLL_INTERVAL_MS = 2000/);
    expect(code).toMatch(/JOB_POLL_MAX_COUNT = 1230/);
  });

  it("자동 저장 실패를 `useState` 로 드는 WORK-008 컴포넌트가 0건이다 — 소유자는 `useRowFailures`", () => {
    const offenders = WORK_008_FILES.filter((name) => name.startsWith("components/")).filter((name) => {
      const code = read(path.join(MEETINGS, name));
      return /useState<[^>]*(Fail|fail)/.test(code) || /set(Save)?Failed\(/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

/* ── WORK-008 Phase 5 — 업무 연동의 정적 검사(완료 게이트 우회 0건 · WORK-005 L294 · WP Phase 5 검증 ③) ──────────── */

describe("⑳ 업무 연동 — 업무 API 직접 호출 0건 · 판정 코드 0건 · 「업무 갱신」 요청 하나", () => {
  const ALL_SOURCES = walk(SRC).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("/test/"));

  it("`features/meetings` 에 `/api/tasks` 리터럴이 0건이다(주석 제외) — 생성 · 갱신은 전부 `/api/meetings/…/task`", () => {
    // `@/lib/api/tasks`(모듈 경로)는 URL 리터럴이 아니다 — 앞 글자가 단어 문자면 경로라서 뺀다(F-1 수정으로 `lib/api/tasks` 가 생겼다).
    const offenders = meetingSources.filter((file) => /(?<!\w)\/api\/tasks/.test(stripComments(read(file)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("`features/meetings` 에 업무 생성 · 갱신 · 상태 전이 · 실행취소 호출이 0건이다 — `features/tasks` 에서 가져가는 이름은 ⑨ 의 예외 목록(상세 드로어 하나)이 판정한다", () => {
    for (const file of meetingSources) {
      expect(read(file), rel(file)).not.toMatch(/changeTaskStatus|undoTaskStatus|createTask\b|updateTask\b|addMemo|useTaskStatus|useTaskMutations/);
    }
  });

  it("`changeTaskStatus(` 를 부르는 곳이 `useTaskStatus.ts` 하나다(WORK-005 검사 재실행) · 업무를 바꾸는 회의록 요청 둘의 호출자가 `useMeetingTaskLink.tsx` 하나다", () => {
    const status = ALL_SOURCES.filter((file) => !file.endsWith("features/tasks/api.ts") && /changeTaskStatus\(/.test(read(file))).map(rel);
    expect(status).toEqual(["features/tasks/hooks/useTaskStatus.ts"]);
    // 「넣기」 둘 — `POST …/lines/{id}/task` · `PATCH …/lines/{id}/task`. **`payload` 저장은 여기 없다**(줄을 고치는 것이라 `useMeetingEdit` 이 한다)
    const apply = ALL_SOURCES.filter(
      (file) => !file.endsWith("features/meetings/api.ts") && /applyLineTaskUpdate\(|createTaskFromLine\(/.test(read(file)),
    ).map(rel);
    expect(apply).toEqual(["features/meetings/hooks/useMeetingTaskLink.tsx"]);
  });

  it("회의록 쪽에 완료 조건 판정이 없다 — `deliverable` · `completionResult` · `attachments.length` · `canTransition` 을 「업무 갱신」 경로(훅 · 버튼)가 보지 않는다", () => {
    for (const name of ["hooks/useMeetingTaskLink.tsx", "components/LineTaskButton.tsx"]) {
      const code = stripComments(read(path.join(MEETINGS, name)));
      expect(code, name).not.toMatch(/deliverable|completionResult|attachments\.length|canTransition|transitionBlockedReason/);
    }
  });

  it("「시작 상태」 · 「연관 업무로 바꾸기」 가 Phase 5 화면 파일(주석 제외)에 0건이다(⑱ 재실행)", () => {
    for (const name of ["components/LinkTaskDrawer.tsx", "components/CreateTaskFromLineDrawer.tsx", "components/LineTaskButton.tsx"]) {
      const code = stripComments(read(path.join(MEETINGS, name)));
      expect(code, name).not.toMatch(/시작 상태|연관 업무로 바꾸기|["'>]대기["'<]/);
    }
  });
});

describe("㉑ WORK-011 — 줄 시각 0건 · 고아 판정 0건 · 명령어 목록 하나 · 직접 fetch 0건", () => {
  it("줄 행이 `createdAt` 을 포맷하는 코드가 0건이다 — `LineRow.tsx` 에 `formatClock` 이 없다(MF-9)", () => {
    const lineRow = stripComments(read(path.join(MEETINGS, "components/LineRow.tsx")));
    expect(lineRow).not.toMatch(/formatClock/);
    const offenders = meetingSources.filter((file) => /formatClock\(\s*line/.test(stripComments(read(file)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("안건 헤더의 시각은 남는다 — `AgendaLineTree` 가 첫 줄 시각을 `formatClock` 으로 그린다(MF-9 의 경계)", () => {
    const tree = stripComments(read(path.join(MEETINGS, "components/AgendaLineTree.tsx")));
    expect(tree).toMatch(/formatClock\(/);
  });

  it("`aiBatch.ts` 에 고아 판정(`orphaned`)이 0건이다 — 프레임이 AI 트랙 전체라 재조회 갈래가 없다(MF-53)", () => {
    expect(stripComments(read(path.join(MEETINGS, "aiBatch.ts")))).not.toMatch(/orphaned/);
    expect(stripComments(read(path.join(MEETINGS, "hooks/useMeetingStream.ts")))).not.toMatch(/orphaned/);
  });

  it("슬래시 명령어 라벨의 원천이 `LineKindPopover.tsx` 하나다 — 마우스 길과 키보드 길이 같은 목록을 본다(U-3)", () => {
    const owners = meetingSources.filter((file) => /export function commandLabel|NEW_AGENDA_COMMAND =/.test(read(file))).map(rel);
    expect(owners).toEqual(["features/meetings/components/LineKindPopover.tsx"]);
    // 명령어 문자열 리터럴(`/결정` …)을 손으로 적은 곳이 없다 — 라벨에서 파생한다
    const offenders = meetingSources.filter((file) => /["'`]\/(논의|결정|업무|액션|새안건)/.test(stripComments(read(file)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("`features/meetings` 에 `fetch(` 직접 호출이 0건이다 — 요청은 `lib/api` 하나를 지난다(FE 금지 목록)", () => {
    const offenders = meetingSources.filter((file) => /(^|[^.\w])fetch\s*\(/.test(stripComments(read(file)))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("㉒ WORK-012 — 옛 통합 어휘 0건 · 경로 하나 · 수치", () => {
  it("화면 문구에 「종결」·「다시 생성」이 0건이다(주석 제외) — 통합 단계가 사라졌다(MF-56 · U-1 · U-2)", () => {
    const offenders = meetingSources.filter((file) => /종결|다시 생성/.test(stripComments(read(file)))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("옛 계약 이름이 0건이다 — `pendingChange` · `integratedAt` · `final_batch` · `finalBatchState` · `\"integration\"`(주석 제외)", () => {
    // `finalBatchState` 는 SPEC-008 §7 #3 이 지운 필드다 — 백엔드가 응답에서 뺐으므로 타입 · 픽스처에도 없다(검수 W-3)
    const offenders = meetingSources
      .filter((file) => /pendingChange|integratedAt|final_batch|finalBatchState|["']integration["']/.test(stripComments(read(file))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("종료 재시도 경로가 `POST …/finalize` 하나다 — `/integrate` 를 부르는 코드가 0건(주석 제외)", () => {
    const offenders = meetingSources.filter((file) => /\/integrate/.test(stripComments(read(file)))).map(rel);
    expect(offenders).toEqual([]);
    const api = read(path.join(MEETINGS, "api.ts"));
    expect(api).toMatch(/\/finalize`/);
    // 요청을 부르는 곳은 폴링 훅 하나다 — 두 번째 호출자를 만들지 않는다
    const callers = meetingSources.filter((file) => /finalizeMeeting\(/.test(read(file))).map(rel);
    expect(callers.sort()).toEqual(["features/meetings/api.ts", "features/meetings/hooks/useMeetingFinalizeJob.ts"]);
  });

  it("실패 배너 · 단계 문구가 `MeetingStatusBar.tsx` 하나에만 있다 — 두 번째 바를 만들지 않는다(⑥ 재실행)", () => {
    const owners = meetingSources
      .filter((file) => /녹음을 다시 받아쓰고 있습니다|회의록을 정리하고 있습니다|회의록 생성 실패/.test(read(file)))
      .map(rel);
    expect(owners).toEqual(["features/meetings/components/MeetingStatusBar.tsx"]);
  });
});

describe("㉓ WORK-013 — payload 드로어 둘 · 종류 셀렉터 폐기 · 모달 하나", () => {
  it("**AI 줄 / 사람 줄로 드로어를 가르는 코드가 0건**이다 — 갈래는 `payload` 가 차 있나뿐이다(MF-65)", () => {
    const offenders = meetingSources
      .filter((file) => /isAiLine|line\.track\s*===|track === ["']ai["']/.test(stripComments(read(file))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("줄 종류를 바꾸는 표면이 0건이다 — `LineKindSelector` · `onChangeKind` · `kind:` PATCH 본문(MF-60)", () => {
    expect(existsSync(path.join(MEETINGS, "components/LineKindSelector.tsx"))).toBe(false);
    const offenders = meetingSources
      .filter((file) => /LineKindSelector|onChangeKind|changeLineKind/.test(stripComments(read(file))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("옛 이름이 0건이다 — `pendingChange` · `applyPendingChange` · `newTask` · `applyLineTaskChange`(주석 제외)", () => {
    const offenders = meetingSources
      .filter((file) => /pendingChange|applyPendingChange|newTask|applyLineTaskChange/.test(stripComments(read(file))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("**업무 탭 드로어를 회의록이 열지 않는다**(MF-67) — `TaskCreateDrawer` · `TaskDetailDrawer` · `openTaskCreateDrawer` import 0건", () => {
    // 「보지 않는다」가 아니라 **열지 않는다** — 주석의 규격 참조는 그대로 두고 import · 호출만 막는다
    const offenders = meetingSources
      .filter((file) => /from ["'][^"']*Task(Create|Detail)Drawer["']|openTaskCreateDrawer\(|<Task(Create|Detail)Drawer\b/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("`Dialog` 를 직접 import 하는 자리가 `ConfirmModal.tsx` **하나**다(FE §6-1 · 모달 크기 둘이 같은 프레임을 쓴다)", () => {
    const sources = walk(SRC).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("/test/"));
    const offenders = sources
      .filter((file) => !file.endsWith("components/ui/dialog.tsx") && /from ["']@\/components\/ui\/dialog["']/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual(["components/shared/ConfirmModal.tsx"]);
  });

  it("**푸터 버튼은 모드별 하나**다 — 두 드로어가 `SUBMIT_LABEL[submitMode]` 하나만 그린다(MF-66)", () => {
    for (const name of ["components/CreateTaskFromLineDrawer.tsx", "components/LinkTaskDrawer.tsx"]) {
      const code = read(path.join(MEETINGS, name));
      // 제출 버튼의 문구가 **한 자리**에서만 온다 — 「저장」·「넣기」를 손으로 적은 버튼이 없다
      expect(code.match(/SUBMIT_LABEL\[submitMode\]/g) ?? [], name).toHaveLength(1);
      expect(stripComments(code), name).not.toMatch(/>\s*(저장|넣기)\s*</);
    }
  });

  it("`payload` 를 저장하는 자리가 `useMeetingEdit` 하나다 — 「저장」은 업무 API 를 지나지 않는다", () => {
    const owners = meetingSources.filter((file) => /savePayload\b/.test(stripComments(read(file)))).map(rel).sort();
    expect(owners).toEqual([
      "features/meetings/components/MeetingDetailBody.tsx",
      "features/meetings/hooks/useMeetingEdit.tsx",
    ]);
  });
});


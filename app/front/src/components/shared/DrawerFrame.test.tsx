/**
 * **드로어 규격이 한 곳에서만 정해지는지**(frontend/README.md §6-2, 2026-09-06 확정).
 *
 * > **폭은 전 드로어가 같다 — 840 고정.** `DrawerFrame` 이 한 곳에서 정하고 **폭을 `prop` 으로
 * > 받지 않는다**(`width`·`size`·`className` 으로 폭을 넘기는 길을 두지 않는다).
 * > 검수 항목: **`Sheet` 직접 import 0건** · **폭 리터럴이 `DrawerFrame` 밖에 0건**.
 *
 * 회의·캘린더가 이 프레임을 **쓰기만** 하므로 여기서 닫아 둔다 — 규격이 새면 세 번 더 샌다.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DrawerFrame } from "@/components/shared/DrawerFrame";

const SRC = path.resolve(__dirname, "../..");
const FRAME = path.join(SRC, "components/shared/DrawerFrame.tsx");
const SHEET = path.join(SRC, "components/ui/sheet.tsx");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(SRC).filter((file) => /\.tsx?$/.test(file));

describe("§6-2 드로어 규격은 한 곳이 소유한다", () => {
  it("`Sheet` 를 import 하는 파일은 `DrawerFrame` 하나뿐이다", () => {
    const importers = sourceFiles.filter(
      (file) =>
        file !== FRAME &&
        file !== SHEET &&
        /from ["']@\/components\/ui\/sheet["']/.test(readFileSync(file, "utf8")),
    );

    expect(importers).toEqual([]);
  });

  it("폭 리터럴(`840` · `w-[840px]`)이 `DrawerFrame` 밖에 없다", () => {
    const offenders = sourceFiles
      .filter((file) => file !== FRAME && !file.endsWith("DrawerFrame.test.tsx"))
      .filter((file) => /w-\[840px\]|\b840\b/.test(readFileSync(file, "utf8")));

    // 값은 `tokens.css` 의 `--tm-drawer-width` 하나이고 코드에는 리터럴이 없다.
    expect(offenders).toEqual([]);
  });

  it("`DrawerFrame` 이 폭 관련 prop 을 받지 않는다", () => {
    const source = readFileSync(FRAME, "utf8");
    const props = source.slice(
      source.indexOf("export interface DrawerFrameProps"),
      source.indexOf("export function DrawerFrame"),
    );

    // `width`·`size`·`className` 으로 폭을 넘기는 길이 없다(§6-2).
    expect(props).not.toMatch(/\bwidth\??:/);
    expect(props).not.toMatch(/\bsize\??:/);
    expect(props).not.toMatch(/\bclassName\??:/);
  });
});

/** jsdom 기본 폭은 1024 라 전체화면 구간이다 — 구간을 시험이 직접 정한다(§7-1). */
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

describe("드로어 프레임 동작", () => {
  beforeEach(() => setViewport(1600));
  it("`Esc` 로 닫힌다 — 닫는 길을 항상 열어 둔다(§1-1)", async () => {
    const onClose = vi.fn();
    render(
      <DrawerFrame title="새 업무" onClose={onClose}>
        <p>본문</p>
      </DrawerFrame>,
    );

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("× 로 닫힌다", async () => {
    const onClose = vi.fn();
    render(
      <DrawerFrame title="새 업무" onClose={onClose}>
        <p>본문</p>
      </DrawerFrame>,
    );

    await userEvent.click(screen.getByRole("button", { name: "드로어 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("`expandTo` 가 없으면 ⤢ 를 그리지 않는다 — 생성 드로어는 승격할 대상이 없다(U-1)", () => {
    render(
      <DrawerFrame title="새 업무" onClose={vi.fn()}>
        <p>본문</p>
      </DrawerFrame>,
    );

    expect(screen.queryByRole("button", { name: "전체 페이지로 열기" })).not.toBeInTheDocument();
  });

  it("`expandTo` 가 있으면 ⤢ 가 있다 — 승격은 한 방향이다(F-5)", () => {
    render(
      <DrawerFrame title="업무 상세" expandTo="/tasks/detail/?id=1" onClose={vi.fn()}>
        <p>본문</p>
      </DrawerFrame>,
    );

    expect(screen.getByRole("button", { name: "전체 페이지로 열기" })).toBeVisible();
  });

  it("1439 이하에서는 **전체 화면**이 되고 닫는 길이 좌측 `←` 로 바뀐다(U-11)", async () => {
    setViewport(1300);
    const onClose = vi.fn();
    render(
      <DrawerFrame title="업무 상세" onClose={onClose}>
        <p>본문</p>
      </DrawerFrame>,
    );

    // 스크림이 사라지고 헤더 좌측에 `←` 가 생긴다 — × 를 겹쳐 두지 않는다.
    expect(screen.queryByRole("button", { name: "드로어 닫기" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("**판정이 프레임 안에 있다** — 폭 구간을 바깥에서 넘기는 길이 없다(§6-2 유일한 예외)", () => {
    setViewport(1300);
    const { container } = render(
      <DrawerFrame title="업무 상세" onClose={vi.fn()}>
        <p>본문</p>
      </DrawerFrame>,
    );

    // 전체화면 전환이 폭 prop 없이 **창 폭만 보고** 일어난다.
    expect(container.ownerDocument.querySelector("[role=dialog]")?.className).toContain("w-full");
  });
});

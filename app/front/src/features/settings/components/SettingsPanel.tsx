"use client";

/**
 * 설정 패널 프레임 — 헤더 60 + 본문(SPEC-002 §2 Placement · `11-auth-profile.md` §설정 공통 골격).
 *
 * **성격이 다른 묶음은 패널을 나눈다**([10] RULES 「설정은 패널 스택」). 유형과 프로젝트가
 * 다른 축이라 패널이 둘이고, 이 컴포넌트가 그 둘의 공통 껍데기다.
 *
 * **패널에 저장 버튼이 없다**([10] 「자동 저장 화면엔 저장 버튼이 없다」) — 캡션이 그 사실을 알린다.
 */

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function SettingsPanel({
  title,
  caption,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  caption: string;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-card">
      <header className="flex h-[60px] items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-panel text-foreground">{title}</h2>
          <p className="truncate text-caption text-fg-caption">{caption}</p>
        </div>
        <Button type="button" size="sm" className="h-control shrink-0" onClick={onAction}>
          {actionLabel}
        </Button>
      </header>

      <div className="border-t border-divider">{children}</div>
    </section>
  );
}

/** 「기본」 칩 · 종류 칩 공통 — `09-design-tokens.md` §형태(r4 · 11/600). */
export function SettingChip({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? "inline-flex h-5 shrink-0 items-center rounded-chip border border-border bg-background px-2 text-badge text-muted-foreground"
          : "inline-flex h-5 shrink-0 items-center rounded-chip bg-row-divider px-2 text-badge text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}

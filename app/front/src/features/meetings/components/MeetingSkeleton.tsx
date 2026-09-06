"use client";

/**
 * **스켈레톤**(SPEC-006 U-2 로딩 · U-4 · U-8) — 회색 블록 `#F1F2F5`, **애니메이션 없음**.
 * 목록은 행 자리에 6줄 · **첫 로딩에만**(달·필터를 바꿀 때는 이전 결과 유지 + 진행 표시).
 */

export function MeetingListSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 border-b border-row-divider px-[18px] py-3.5">
          <div className="h-3 w-1/3 rounded-chip bg-row-divider" />
          <div className="h-4 w-2/3 rounded-chip bg-row-divider" />
          <div className="h-3 w-1/2 rounded-chip bg-row-divider" />
        </div>
      ))}
    </div>
  );
}

/** 미리보기 본문 · 시작 전 화면의 로딩 — 빈 화면을 먼저 보여주지 않는다(U-4 로딩). */
export function MeetingDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="불러오는 중">
      <div className="h-8 w-2/3 rounded-control bg-row-divider" />
      <div className="h-14 rounded-xl bg-row-divider" />
      <div className="h-40 rounded-panel bg-row-divider" />
    </div>
  );
}

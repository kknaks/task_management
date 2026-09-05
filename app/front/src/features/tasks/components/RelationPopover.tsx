"use client";

/**
 * **U-8 연관업무 팝오버 382**(SPEC-003).
 *
 * 검색 입력 + 결과 행 52 + 푸터 「n건 선택됨」 · 「연결」.
 * **「새 업무로 만들기」·「전체 목록에서 고르기」는 v1 에 없다**(§7).
 *
 * 후보는 **컬렉션 표면 하나**에서 온다(`GET /api/tasks/relations/candidates`, 2026-09-06 신설).
 * 표면이 하나라 **생성 드로어와 상세 드로어가 같은 코드·같은 정렬**을 탄다 — 정렬 근거만
 * 다르게 넘긴다.
 *
 * | 부르는 곳 | 넘기는 것 |
 * |---|---|
 * | 상세 드로어 | `excludeId` 만 — 서버가 그 업무의 project·due 를 쓰고 이미 연결된 것도 제외 |
 * | 생성 드로어 | `excludeId` 없이 **폼에 입력 중인** `projectId`·`dueDate` |
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchRelationCandidates } from "@/features/tasks/api";
import { formatDueDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export function RelationPopover({
  excludeId = null,
  projectId = null,
  dueDate = null,
  selectedIds,
  onChange,
  trigger,
}: {
  /** 상세 드로어가 자기 id 를 준다. **생성 드로어는 보내지 않는다.** */
  excludeId?: number | null;
  /** 생성 드로어가 **폼에 입력 중인** 값을 준다. 상세 드로어는 서버가 쓴다. */
  projectId?: number | null;
  dueDate?: string | null;
  selectedIds: readonly number[];
  onChange: (next: number[]) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState<number[]>([]);

  const { data: candidates = [], isPending } = useQuery({
    queryKey: ["tasks", "relationCandidates", { excludeId, projectId, dueDate, keyword }],
    queryFn: () => fetchRelationCandidates({ keyword, excludeId, projectId, dueDate }),
    enabled: open,
    staleTime: 0,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft([...selectedIds]);
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-popover-relation rounded-card border-border bg-card p-3 shadow-popover"
      >
        <Input
          aria-label="업무 검색"
          placeholder="업무 검색"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="h-9"
        />

        <ul className="mt-2 max-h-64 overflow-y-auto">
          {isPending ? (
            <li className="py-6 text-center text-meta text-fg-caption">불러오는 중…</li>
          ) : candidates.length === 0 ? (
            <li className="flex flex-col gap-1 py-6 text-center">
              <span className="text-meta text-fg-caption">검색 결과가 없습니다</span>
              <span className="text-caption text-fg-caption">다른 검색어나 필터를 써 보세요</span>
            </li>
          ) : (
            candidates.map((candidate) => {
              const checked = draft.includes(candidate.id);
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) =>
                        checked ? prev.filter((id) => id !== candidate.id) : [...prev, candidate.id],
                      )
                    }
                    className={cn(
                      "flex h-row w-full items-center gap-2 rounded-control px-2 text-left",
                      checked ? "bg-secondary" : "hover:bg-muted",
                    )}
                  >
                    <Checkbox checked={checked} tabIndex={-1} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">
                        {candidate.title}
                      </span>
                      <span className="block truncate text-caption text-fg-caption">
                        {[
                          candidate.projectName,
                          candidate.dueDate ? formatDueDate(candidate.dueDate) : null,
                          STATUS_LABEL[candidate.status],
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <StatusDot status={candidate.status} />
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="mt-2 flex items-center justify-between border-t border-divider pt-2">
          <span className="text-caption text-fg-caption">{draft.length}건 선택됨</span>
          <Button
            type="button"
            className="h-9 px-3 text-meta"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            연결
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

"use client";

/**
 * **U-8 연관업무 팝오버 382**(SPEC-003).
 *
 * 검색 입력 + **필터 칩 3** + 우측 카운트 「n건 중 m」 + 결과 행 52 + 푸터 「n건 선택됨」 · 「연결」.
 * **「새 업무로 만들기」·「전체 목록에서 고르기」는 v1 에 없다**(§7).
 *
 * 후보는 **컬렉션 표면 하나**에서 온다(`GET /api/tasks/relations/candidates`).
 * 표면이 하나라 **생성 드로어와 상세 드로어가 같은 코드·같은 정렬**을 탄다 — 넘기는 것만 다르다.
 *
 * | 부르는 곳 | 넘기는 것 |
 * |---|---|
 * | 상세 드로어 | `excludeId` 만 — 서버가 그 업무의 project·due 를 쓰고 이미 연결된 것도 제외 |
 * | 생성 드로어 | `excludeId` 없이 **폼에 입력 중인** `projectId`·`dueDate` |
 *
 * ## 칩 3 ↔ `scope` 1:1
 *
 * 「이 프로젝트」=`project`(기본) · 「최근 30일」=`recent30` · 「전체」=`all`.
 * `scope` 는 **정렬 힌트가 아니라 후보를 잘라내는 필터**다 — 그래서 칩을 바꾸면 목록이 실제로 바뀐다.
 *
 * **기준 프로젝트가 없으면**(무소속 업무 · 생성 드로어에서 프로젝트 미선택) 「이 프로젝트」는
 * **비활성**이고 기본 선택이 **「전체」로 내려간다.** 서버도 그 경우 `project` 를 `all` 처럼 답하지만
 * **화면이 먼저 정직해야 한다** — 누를 수 있는데 아무 효과 없는 칩을 두지 않는다.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { StatusDot, STATUS_LABEL } from "@/components/shared/StatusDot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchRelationCandidates, type RelationScope } from "@/features/tasks/api";
import { formatDueDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

const CHIPS: readonly { scope: RelationScope; label: string }[] = [
  { scope: "project", label: "이 프로젝트" },
  { scope: "recent30", label: "최근 30일" },
  { scope: "all", label: "전체" },
];

export function RelationPopover({
  excludeId = null,
  projectId = null,
  dueDate = null,
  hasBaseProject,
  selectedIds,
  onChange,
  trigger,
}: {
  /** 상세 드로어가 자기 id 를 준다. **생성 드로어는 보내지 않는다.** */
  excludeId?: number | null;
  /** 생성 드로어가 **폼에 입력 중인** 값을 준다. 상세 드로어는 서버가 쓴다. */
  projectId?: number | null;
  dueDate?: string | null;
  /**
   * 기준 프로젝트가 있나 — 「이 프로젝트」 칩의 활성 여부다.
   * 상세는 그 업무의 프로젝트 유무, 생성은 **폼에서 고른 값**이라 고르면 따라 바뀐다.
   */
  hasBaseProject: boolean;
  selectedIds: readonly number[];
  onChange: (next: number[]) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState<number[]>([]);
  const [scope, setScope] = useState<RelationScope>(hasBaseProject ? "project" : "all");

  /**
   * 기준 프로젝트가 사라지면(생성 드로어에서 프로젝트를 지웠다) **「전체」로 내려간다** —
   * 비활성 칩이 선택된 채로 남지 않게. 다시 생기면 기본값 「이 프로젝트」로 돌아간다.
   */
  useEffect(() => {
    setScope((current) => {
      if (!hasBaseProject && current === "project") {
        return "all";
      }
      if (hasBaseProject && current === "all") {
        return "project";
      }
      return current;
    });
  }, [hasBaseProject]);

  const { data, isPending } = useQuery({
    queryKey: [
      "tasks",
      "relationCandidates",
      { excludeId, projectId, dueDate, keyword, scope },
    ],
    queryFn: () => fetchRelationCandidates({ keyword, excludeId, projectId, dueDate, scope }),
    enabled: open,
    staleTime: 0,
  });

  const candidates = data?.items ?? [];
  // `n` = `total`(scope 적용 후 총계) · `m` = `items.length`(상위 20건).
  const total = data?.total ?? 0;

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

        {/* 필터 칩 3 + 우측 카운트 「n건 중 m」 */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div role="group" aria-label="후보 범위" className="flex items-center gap-1">
            {CHIPS.map((chip) => {
              // **누를 수 있는데 아무 효과 없는 칩을 두지 않는다** — 기준이 없으면 비활성이다.
              const disabled = chip.scope === "project" && !hasBaseProject;
              const selected = scope === chip.scope;
              return (
                <button
                  key={chip.scope}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => setScope(chip.scope)}
                  className={cn(
                    "h-6 shrink-0 rounded-chip border px-2 text-badge",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    selected
                      ? "border-primary bg-secondary text-secondary-foreground"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <span className="shrink-0 text-caption text-fg-caption">
            {total}건 중 {candidates.length}
          </span>
        </div>

        <ul className="mt-2 max-h-64 overflow-y-auto">
          {isPending ? (
            <li className="py-6 text-center text-meta text-fg-caption">불러오는 중…</li>
          ) : candidates.length === 0 ? (
            // 칩을 바꿔 0건이 돼도 같은 자리·같은 문구다(U-8 *검색 결과 없음*).
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

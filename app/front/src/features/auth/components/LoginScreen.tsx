"use client";

/**
 * **U-1 로그인 화면**(SPEC-001 · P-04 — **디자인 정정 반영**).
 *
 * 정정 둘(§A-9 · DEC-001 §1) — 라벨이 「이메일」이 아니라 **「아이디」**이고,
 * **「비밀번호 찾기」·「회원가입」이 없다.** 계정은 시드로만 생기므로 그 경로가 존재하지 않는다.
 *
 * 실패 처리는 Case Matrix 그대로다(SPEC-001 §4).
 * - `invalid_credentials`·`validation_error` → 두 입력 테두리 실패색 + **비밀번호 아래 인라인**.
 *   **입력값을 지우지 않는다**(지우면 오타 확인이 불가능하다). 횟수를 세거나 잠그지 않는다
 * - 그 밖 5xx·네트워크 → **토스트**. 자격 증명 문제가 아니므로 폼 옆에 붙이지 않는다
 */

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { BrandMark } from "@/features/auth/components/BrandMark";
import { BrandPanel } from "@/features/auth/components/BrandPanel";
import type { LoginFormValues } from "@/features/auth/types";
import { V2Gate } from "@/components/shared/V2Gate";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_ERROR_CODE, isApiError } from "@/lib/api/errors";
import { KeychainError, login } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/** 로그인 후 기본 진입(FE §1 · SPEC-001 U-1 기대 결과). 직전에 요청했던 주소로 되돌리지 않는다. */
const AFTER_LOGIN = "/tasks/";

/** 하단 3링크 — 정책 근거가 없어 **전부 v2 게이트**다(SPEC-001 S001-OQ-4). */
const FOOTER_LINKS = ["이용약관", "개인정보 처리방침", "고객지원"];

/**
 * 「회사 계정으로 계속하기」 좌측 글리프 — 시안 93줄의 사각형 + 세로선.
 * 실제 서비스 로고를 쓰지 않는다(디자인 시스템 [02] 채널 규칙과 같은 이유).
 * 색은 `currentColor` 로 받아 hex 가 이 파일에 남지 않는다.
 */
function WorkspaceGlyph() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.6" y="3" width="12.8" height="12" rx="1.8" />
      <path d="M2.6 7h12.8M6 3v12" />
    </svg>
  );
}

export function LoginScreen() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [persist, setPersist] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  /** 폼 안에 붙는 인라인 사유. 자격 증명 계열에서만 채워진다. */
  const [inlineError, setInlineError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (values: LoginFormValues) =>
      login({ loginId: values.loginId, password: values.password }, values.persist),
    onMutate: () => setInlineError(null),
    onSuccess: () => router.replace(AFTER_LOGIN),
    onError: (error: unknown) => {
      if (
        isApiError(error) &&
        (error.code === API_ERROR_CODE.INVALID_CREDENTIALS ||
          error.code === API_ERROR_CODE.VALIDATION_ERROR)
      ) {
        // 문구는 백엔드 `detail` 이 정본이다 — 화면은 `code` 로만 갈린다(FE §3-5).
        setInlineError(error.detail);
        return;
      }
      // 키체인 거부는 **자격 증명 문제가 아니다.** 「로그인에 실패했습니다」로 뭉개면
      // 사용자가 비밀번호를 의심한다 — 사유를 그대로 말한다(DEC-001 §4 개정 · DEC-003 §7).
      if (error instanceof KeychainError) {
        toast.error(error.message, { id: "keychain-error" });
        return;
      }
      // 그 밖 5xx·네트워크도 가리지 않고 토스트로 드러낸다.
      toast.error(isApiError(error) ? error.detail : "로그인에 실패했습니다");
    },
  });

  const submitting = mutation.isPending;
  // *빈 입력*: 「로그인」 버튼 비활성. 둘 다 한 글자 이상이면 활성(U-1).
  const canSubmit = loginId.trim().length > 0 && password.length > 0 && !submitting;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // **중복 제출이 나가지 않는다** — 제출 중에는 버튼이 비활성이고 여기서도 한 번 막는다.
    if (!canSubmit) {
      return;
    }
    mutation.mutate({ loginId: loginId.trim(), password, persist });
  };

  const invalid = inlineError !== null;
  const fieldClassName = cn(
    "h-input-lg rounded-control px-4 text-body",
    invalid && "border-destructive focus-visible:ring-destructive",
  );

  return (
    <div className="flex min-h-screen w-full">
      <BrandPanel />

      {/**
       * 폼 컬럼 — 폼 폭 400 은 **고정**이다(U-8).
       *
       * 세로는 시안 1080 기준이다: 폼 `top 264`(= `24.44vh`) · 푸터 `bottom 56`(= `5.19vh`).
       * **가운데 정렬이 아니다** — 중앙보다 위다. `absolute` 로 박지 않고(FE-C4) 위 여백만
       * 비율로 두고 푸터를 `mt-auto` 로 내린다.
       */}
      <div className="flex min-h-screen flex-1 flex-col items-center gap-8 px-gutter pb-[5.19vh] pt-[24.44vh]">
        {/* 1280~1439 — 패널이 사라지는 대신 로고 + 헤드라인 1줄을 폼 위에 남긴다(U-8) */}
        <div className="flex w-[400px] flex-col gap-3 wide:hidden">
          <BrandMark />
          {/**
           * 같은 화면의 폼 제목 「로그인」이 `page-title`(28)이라 헤드라인이 그보다 크거나
           * 같으면 위계가 뒤집힌다. 24(`hero-date`)는 [03] TYPE 에 실재하는 스케일이다.
           */}
          <p className="text-hero-date text-foreground">오늘 한 일이 내일의 기록이 되도록</p>
        </div>

        {/**
         * 세로 리듬은 시안 55~96줄 그대로 **세 겹**이다 — 바깥 32 · 입력 묶음 18 · 버튼 묶음 14.
         * 평평하게 한 겹으로 두면 입력 사이가 32 로 벌어져 시안과 어긋난다.
         *
         * 시안의 네 번째 자식 「아직 계정이 없나요? · 회원가입」은 **정정 §A-9 로 없다**.
         */}
        <form className="flex w-[400px] flex-col gap-8" onSubmit={handleSubmit} noValidate>
          <header className="flex flex-col gap-2">
            <h1 className="text-page-title text-foreground">로그인</h1>
            <p className="text-control-label text-fg-meta">개인 워크스페이스에 접속합니다</p>
          </header>

          {/* 입력 묶음 — 시안 62~81줄 · gap 18 */}
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-col gap-2">
              {/**
               * `font-semibold` 는 shadcn `Label` 자체의 `font-medium`(500)을 걷어내려는 것이다 —
               * 프리셋의 600 은 `font-weight` 유틸에 밀린다. 크기·색은 프리셋과 토큰이 낸다.
               */}
              <Label htmlFor="loginId" className="text-field-label font-semibold text-foreground">
                아이디
              </Label>
              <Input
                id="loginId"
                name="loginId"
                autoComplete="username"
                autoFocus
                placeholder="아이디를 입력하세요"
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                // *제출 중*: 두 입력은 읽기 전용이다(U-1). 값은 그대로 보인다.
                readOnly={submitting}
                aria-invalid={invalid}
                className={fieldClassName}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-field-label font-semibold text-foreground">
                비밀번호
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  readOnly={submitting}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? "login-error" : undefined}
                  className={cn(fieldClassName, "pr-12")}
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? "비밀번호 숨기기" : "비밀번호 표시"}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-fg-placeholder hover:text-foreground"
                >
                  {passwordVisible ? (
                    <EyeOff className="h-[18px] w-[18px]" aria-hidden />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" aria-hidden />
                  )}
                </button>
              </div>

              {/* 실패 인라인 — 비밀번호 입력 **아래 12px**(U-1). 입력값은 남는다 */}
              {invalid ? (
                <p id="login-error" role="alert" className="mt-[4px] text-caption text-destructive">
                  {inlineError}
                </p>
              ) : null}
            </div>

            {/* 체크박스 행 — 입력 묶음의 셋째 자식. 캡션은 이 행에 딸린 것이라 안에 둔다(gap 6) */}
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-center gap-[10px]">
                <Checkbox
                  id="persist"
                  checked={persist}
                  onCheckedChange={(checked) => setPersist(checked === true)}
                  disabled={submitting}
                  // 시안 78줄 — 18px 상자에 11px 체크. shadcn 생성물의 16/16 을 여기서만 덮는다.
                  className="h-[18px] w-[18px] [&_svg]:h-[11px] [&_svg]:w-[11px]"
                />
                {/* `font-normal` — 위와 같은 이유로 `Label` 의 `font-medium` 을 걷어낸다 */}
                <Label
                  htmlFor="persist"
                  className="text-control-label font-normal text-muted-foreground"
                >
                  로그인 상태 유지
                </Label>
              </div>
              {/* 체크박스 18 + gap 10 = 28 만큼 들여 라벨 글자와 좌측을 맞춘다 */}
              <p className="pl-7 text-caption text-fg-caption">앱을 껐다 켜도 로그인이 유지됩니다</p>
            </div>
          </div>

          {/* 버튼 묶음 — 시안 83~96줄 · gap 14 */}
          <div className="flex flex-col gap-[14px]">
            <Button
              type="submit"
              disabled={!canSubmit}
              className="h-cta w-full text-body font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  로그인 중…
                </>
              ) : (
                "로그인"
              )}
            </Button>

            <div className="flex items-center gap-[14px]">
              <span className="h-px flex-1 bg-divider" />
              <span className="text-caption text-fg-caption">또는</span>
              <span className="h-px flex-1 bg-divider" />
            </div>

            {/* 화면에 그대로 그리되 **v2 게이트**(U-1 CTA · U-2 적용 대상) */}
            <V2Gate reason="v2" className="w-full">
              <Button
                type="button"
                variant="outline"
                // 글리프 18 · gap 10 — 버튼 기본값(16 · 8)을 이 자리에서만 덮는다(시안 92~94줄)
                className="h-cta w-full gap-[10px] text-body font-semibold text-muted-foreground [&_svg]:h-[18px] [&_svg]:w-[18px]"
              >
                <WorkspaceGlyph />
                회사 계정으로 계속하기
              </Button>
            </V2Gate>
          </div>
        </form>

        {/**
         * 하단 3링크 — 시안 104~109줄. 폼 컬럼 기준 중앙이고 **`bottom 56`** 이라
         * 폼 바로 아래가 아니다. 링크 사이에 3px 원 구분자가 들어간다. **셋 다 v2 게이트**(U-1).
         */}
        <nav className="mt-auto flex w-[400px] items-center justify-center gap-4">
          {FOOTER_LINKS.map((label, index) => (
            <Fragment key={label}>
              {index > 0 ? (
                <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-border" />
              ) : null}
              <V2Gate reason="v2">
                <button type="button" className="text-caption text-fg-caption hover:text-fg-meta">
                  {label}
                </button>
              </V2Gate>
            </Fragment>
          ))}
        </nav>
      </div>
    </div>
  );
}

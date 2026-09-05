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

import { useState } from "react";
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

      {/* 폼 컬럼 — 남은 폭의 가운데. 폼 폭 400 은 **고정**이다(U-8) */}
      <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-8 px-gutter py-16">
        {/* 1280~1439 — 패널이 사라지는 대신 로고 + 헤드라인 1줄을 폼 위에 남긴다(U-8) */}
        <div className="flex w-[400px] flex-col gap-3 wide:hidden">
          <BrandMark />
          <p className="text-detail-title text-foreground">오늘 한 일이 내일의 기록이 되도록</p>
        </div>

        <form className="flex w-[400px] flex-col gap-6" onSubmit={handleSubmit} noValidate>
          <header className="flex flex-col gap-1">
            <h1 className="text-page-title text-foreground">로그인</h1>
            <p className="text-meta text-fg-meta">개인 워크스페이스에 접속합니다</p>
          </header>

          <div className="flex flex-col gap-2">
            <Label htmlFor="loginId" className="text-section text-foreground">
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
            <Label htmlFor="password" className="text-section text-foreground">
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
                className="absolute right-4 top-1/2 -translate-y-1/2 text-fg-caption hover:text-foreground"
              >
                {passwordVisible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </button>
            </div>

            {/* 실패 인라인 — 비밀번호 입력 **아래 12px**(U-1). 입력값은 남는다 */}
            {invalid ? (
              <p id="login-error" role="alert" className="mt-[4px] text-caption text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="persist"
                checked={persist}
                onCheckedChange={(checked) => setPersist(checked === true)}
                disabled={submitting}
              />
              <Label htmlFor="persist" className="text-body text-foreground">
                로그인 상태 유지
              </Label>
            </div>
            <p className="pl-6 text-caption text-fg-caption">앱을 껐다 켜도 로그인이 유지됩니다</p>
          </div>

          <Button type="submit" disabled={!canSubmit} className="h-cta w-full text-body font-semibold">
            {submitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                로그인 중…
              </>
            ) : (
              "로그인"
            )}
          </Button>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-divider" />
            <span className="text-caption text-fg-caption">또는</span>
            <span className="h-px flex-1 bg-divider" />
          </div>

          {/* 화면에 그대로 그리되 **v2 게이트**(U-1 CTA · U-2 적용 대상) */}
          <V2Gate reason="v2" className="w-full">
            <Button
              type="button"
              variant="outline"
              className="h-cta w-full text-body font-semibold"
            >
              회사 계정으로 계속하기
            </Button>
          </V2Gate>
        </form>

        {/* 하단 3링크 — 폼 컬럼 기준 중앙. **셋 다 v2 게이트**(U-1) */}
        <nav className="flex w-[400px] items-center justify-center gap-4">
          {FOOTER_LINKS.map((label) => (
            <V2Gate key={label} reason="v2">
              <button type="button" className="text-caption text-fg-caption">
                {label}
              </button>
            </V2Gate>
          ))}
        </nav>
      </div>
    </div>
  );
}

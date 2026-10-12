"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-fields";
import { keepFormOnSubmit } from "@/lib/use-keep-form";
import type { ActionResult } from "@/lib/validation/users";
import { changePasswordAction } from "./actions";

export function PasswordForm({
  firstTime = false,
  hint,
  numericOnly = false,
}: {
  firstTime?: boolean;
  hint: string;
  /** 직원: 숫자 키패드를 띄운다 (숫자 외 입력도 허용) */
  numericOnly?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(changePasswordAction, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};
  const inputMode = numericOnly ? "numeric" : undefined;

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
    } else toast.error(state.message);
  }, [state]);

  return (
    <form ref={formRef} onSubmit={keepFormOnSubmit(action)} className="max-w-sm space-y-4">
      {!firstTime && (
        <Field label="현재 비밀번호" htmlFor="currentPassword" error={fe.currentPassword}>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            inputMode={inputMode}
            autoComplete="current-password"
            className="h-11 text-base"
          />
        </Field>
      )}
      <Field label="새 비밀번호" htmlFor="newPassword" error={fe.newPassword} hint={hint}>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          inputMode={inputMode}
          autoComplete="new-password"
          className="h-11 text-base"
        />
      </Field>
      <Field label="새 비밀번호 한 번 더" htmlFor="confirmPassword" error={fe.confirmPassword}>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          inputMode={inputMode}
          autoComplete="new-password"
          className="h-11 text-base"
        />
      </Field>
      <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
        {pending ? "변경 중…" : firstTime ? "비밀번호 정하고 시작하기" : "비밀번호 변경"}
      </Button>
    </form>
  );
}

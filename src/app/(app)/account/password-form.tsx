"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-fields";
import { keepFormOnSubmit } from "@/lib/use-keep-form";
import type { ActionResult } from "@/lib/validation/users";
import { changePasswordAction } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(changePasswordAction, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (!state.message) return;
    if (state.ok) {
      toast.success(state.message);
      formRef.current?.reset();
    } else toast.error(state.message);
  }, [state]);

  return (
    <form ref={formRef} onSubmit={keepFormOnSubmit(action)} className="max-w-sm space-y-4">
      <Field label="현재 비밀번호" htmlFor="currentPassword" error={fe.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" />
      </Field>
      <Field label="새 비밀번호" htmlFor="newPassword" error={fe.newPassword} hint="10자 이상, 영문+숫자 포함">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" />
      </Field>
      <Field label="새 비밀번호 확인" htmlFor="confirmPassword" error={fe.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "변경 중…" : "비밀번호 변경"}
      </Button>
    </form>
  );
}

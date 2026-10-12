"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, NativeSelect } from "@/components/form-fields";
import { ROLE_LABEL, ROLES, type Role } from "@/lib/auth/roles";
import type { ActionResult } from "@/lib/validation/users";
import { keepFormOnSubmit } from "@/lib/use-keep-form";
import { createUserAction, resetPasswordAction, updateUserAction } from "./actions";

export interface StoreOption {
  id: string;
  name: string;
}

export interface EditableUser {
  id: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  storeIds: string[];
  identifier: string;
}

const initial: ActionResult = { ok: false };

/** 액션 결과를 토스트로 알리고, 성공 시 콜백 실행 */
function useResultToast(state: ActionResult, onSuccess?: () => void) {
  useEffect(() => {
    if (!state.message) return;
    if (state.ok) {
      toast.success(state.message);
      onSuccess?.();
    } else {
      toast.error(state.message);
    }
    // state 객체가 바뀔 때만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

function StoreCheckboxes({ stores, selected, error }: { stores: StoreOption[]; selected: string[]; error?: string }) {
  return (
    <Field label="소속 지점" error={error} hint="대표는 지점 선택과 관계없이 전체 지점에 접근합니다.">
      <div className="flex flex-wrap gap-3">
        {stores.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="storeIds"
              value={s.id}
              defaultChecked={selected.includes(s.id)}
              className="size-4"
            />
            {s.name}
          </label>
        ))}
      </div>
    </Field>
  );
}

function RoleSelect({ defaultValue, disabled }: { defaultValue: Role; disabled?: boolean }) {
  return (
    <NativeSelect id="role" name="role" defaultValue={defaultValue} disabled={disabled}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </NativeSelect>
  );
}

export function CreateUserDialog({ stores }: { stores: StoreOption[] }) {
  const [open, setOpen] = useState(false);
  const [loginType, setLoginType] = useState<"id" | "email">("id");
  const [state, action, pending] = useActionState(createUserAction, initial);
  useResultToast(state, () => setOpen(false));
  const fe = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>새 계정 만들기</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 계정 만들기</DialogTitle>
          <DialogDescription>
            만든 즉시 사용 가능합니다. 임시 비밀번호를 직원에게 직접 전달하세요.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={keepFormOnSubmit(action)} className="space-y-4">
          <Field label="이름" htmlFor="fullName" error={fe.fullName}>
            <Input id="fullName" name="fullName" required maxLength={50} />
          </Field>

          <Field label="로그인 방식">
            <div className="flex gap-4 text-sm">
              {(["id", "email"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="loginType"
                    value={t}
                    checked={loginType === t}
                    onChange={() => setLoginType(t)}
                  />
                  {t === "id" ? "아이디 (이메일 없는 직원)" : "이메일"}
                </label>
              ))}
            </div>
          </Field>

          {loginType === "id" ? (
            <Field label="아이디" htmlFor="loginId" error={fe.loginId} hint="영문 소문자·숫자·._- 3~30자">
              <Input id="loginId" name="loginId" autoCapitalize="none" autoComplete="off" />
            </Field>
          ) : (
            <Field label="이메일" htmlFor="email" error={fe.email}>
              <Input id="email" name="email" type="email" autoComplete="off" />
            </Field>
          )}

          <Field label="임시 비밀번호" htmlFor="password" error={fe.password} hint="10자 이상, 영문+숫자 포함">
            <Input id="password" name="password" type="text" autoComplete="new-password" />
          </Field>

          <Field label="역할" htmlFor="role" error={fe.role}>
            <RoleSelect defaultValue="staff" />
          </Field>

          <StoreCheckboxes stores={stores} selected={[]} error={fe.storeIds} />

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "만드는 중…" : "계정 만들기"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  stores,
  isSelf,
}: {
  user: EditableUser;
  stores: StoreOption[];
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateUserAction, initial);
  const [pwState, pwAction, pwPending] = useActionState(resetPasswordAction, initial);
  useResultToast(state, () => setOpen(false));
  useResultToast(pwState);
  const fe = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>수정</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user.fullName} 계정 수정</DialogTitle>
          <DialogDescription>로그인: {user.identifier}</DialogDescription>
        </DialogHeader>

        <form onSubmit={keepFormOnSubmit(action)} className="space-y-4">
          <input type="hidden" name="userId" value={user.id} />
          <Field label="이름" htmlFor={`name-${user.id}`} error={fe.fullName}>
            <Input id={`name-${user.id}`} name="fullName" defaultValue={user.fullName} maxLength={50} />
          </Field>
          <Field
            label="역할"
            error={fe.role}
            hint={isSelf ? "본인 계정의 역할은 바꿀 수 없습니다." : undefined}
          >
            {isSelf && <input type="hidden" name="role" value={user.role} />}
            <RoleSelect defaultValue={user.role} disabled={isSelf} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            {isSelf && <input type="hidden" name="isActive" value="on" />}
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={user.isActive}
              disabled={isSelf}
              className="size-4"
            />
            사용 중 (해제하면 즉시 로그인·데이터 접근이 차단됩니다)
          </label>
          <StoreCheckboxes stores={stores} selected={user.storeIds} error={fe.storeIds} />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </form>

        <form onSubmit={keepFormOnSubmit(pwAction)} className="mt-2 space-y-3 border-t pt-4">
          <input type="hidden" name="userId" value={user.id} />
          <Field
            label="비밀번호 초기화"
            htmlFor={`pw-${user.id}`}
            error={pwState.fieldErrors?.password}
            hint="새 임시 비밀번호 (10자 이상, 영문+숫자)"
          >
            <Input id={`pw-${user.id}`} name="password" type="text" autoComplete="new-password" />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={pwPending}>
            {pwPending ? "변경 중…" : "임시 비밀번호로 변경"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

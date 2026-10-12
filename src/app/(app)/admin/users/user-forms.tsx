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
import { loginIdFromName } from "@/lib/auth/login-id";
import { passwordHintFor, type ActionResult } from "@/lib/validation/users";
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
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {stores.map((s) => (
          <label key={s.id} className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="storeIds"
              value={s.id}
              defaultChecked={selected.includes(s.id)}
              className="size-5"
            />
            {s.name}
          </label>
        ))}
      </div>
    </Field>
  );
}

function RoleSelect(props: { value?: Role; defaultValue?: Role; disabled?: boolean; onChange?: (r: Role) => void }) {
  return (
    <NativeSelect
      id="role"
      name="role"
      value={props.value}
      defaultValue={props.defaultValue}
      disabled={props.disabled}
      onChange={(e) => props.onChange?.(e.target.value as Role)}
    >
      {/* 가장 많이 만드는 '일반 직원'을 맨 위에 */}
      {[...ROLES].reverse().map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
          {r === "staff" ? " — 생년월일 비밀번호" : " — 10자 이상 비밀번호"}
        </option>
      ))}
    </NativeSelect>
  );
}

export function CreateUserDialog({ stores }: { stores: StoreOption[] }) {
  const [open, setOpen] = useState(false);
  const [loginType, setLoginType] = useState<"name" | "email">("name");
  const [role, setRole] = useState<Role>("staff");
  const [name, setName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [loginIdEdited, setLoginIdEdited] = useState(false);
  const [state, action, pending] = useActionState(createUserAction, initial);
  const fe = state.fieldErrors ?? {};
  const isStaff = role === "staff";

  useResultToast(state, () => {
    setOpen(false);
    setName("");
    setLoginId("");
    setLoginIdEdited(false);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>새 계정 만들기</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>새 계정 만들기</DialogTitle>
          <DialogDescription>
            직원은 <b>이름</b>으로 로그인하고, 비밀번호는 <b>생년월일 6자리</b>입니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={keepFormOnSubmit(action)} className="space-y-4">
          <Field label="역할" htmlFor="role" error={fe.role}>
            <RoleSelect value={role} onChange={setRole} />
          </Field>

          <Field label="이름" htmlFor="fullName" error={fe.fullName}>
            <Input
              id="fullName"
              name="fullName"
              required
              maxLength={50}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!loginIdEdited) setLoginId(loginIdFromName(e.target.value));
              }}
              className="h-10 text-base"
            />
          </Field>

          <Field label="로그인 방식">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {(["name", "email"] as const).map((t) => (
                <label key={t} className="flex min-h-10 items-center gap-2">
                  <input
                    type="radio"
                    name="loginType"
                    value={t}
                    checked={loginType === t}
                    onChange={() => setLoginType(t)}
                    className="size-4"
                  />
                  {t === "name" ? "이름으로 로그인 (추천)" : "이메일로 로그인"}
                </label>
              ))}
            </div>
          </Field>

          {loginType === "name" ? (
            <Field
              label="아이디"
              htmlFor="loginId"
              error={fe.loginId}
              hint="이름이 자동으로 들어갑니다. 같은 이름의 직원이 있으면 뒤에 숫자를 붙이세요 (예: 김민수2)"
            >
              <Input
                id="loginId"
                name="loginId"
                autoCapitalize="none"
                autoComplete="off"
                value={loginId}
                onChange={(e) => {
                  setLoginId(e.target.value);
                  setLoginIdEdited(true);
                }}
                className="h-10 text-base"
              />
            </Field>
          ) : (
            <Field label="이메일" htmlFor="email" error={fe.email}>
              <Input id="email" name="email" type="email" autoComplete="off" className="h-10 text-base" />
            </Field>
          )}

          <Field
            label={isStaff ? "비밀번호 (생년월일 6자리)" : "비밀번호"}
            htmlFor="password"
            error={fe.password}
            hint={passwordHintFor(role, "initial")}
          >
            <Input
              id="password"
              name="password"
              type="text"
              inputMode={isStaff ? "numeric" : undefined}
              maxLength={isStaff ? 6 : 72}
              autoComplete="off"
              className="h-10 text-base"
            />
          </Field>

          <StoreCheckboxes stores={stores} selected={[]} error={fe.storeIds} />

          <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
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
  const isStaff = user.role === "staff";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>수정</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user.fullName} 계정 수정</DialogTitle>
          <DialogDescription>아이디: {user.identifier}</DialogDescription>
        </DialogHeader>

        <form onSubmit={keepFormOnSubmit(action)} className="space-y-4">
          <input type="hidden" name="userId" value={user.id} />
          <Field label="이름" htmlFor={`name-${user.id}`} error={fe.fullName}>
            <Input id={`name-${user.id}`} name="fullName" defaultValue={user.fullName} maxLength={50} className="h-10 text-base" />
          </Field>
          <Field
            label="역할"
            error={fe.role}
            hint={isSelf ? "본인 계정의 역할은 바꿀 수 없습니다." : undefined}
          >
            {isSelf && <input type="hidden" name="role" value={user.role} />}
            <RoleSelect defaultValue={user.role} disabled={isSelf} />
          </Field>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            {isSelf && <input type="hidden" name="isActive" value="on" />}
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={user.isActive}
              disabled={isSelf}
              className="size-5"
            />
            사용 중 (해제하면 즉시 로그인·데이터 접근이 차단됩니다)
          </label>
          <StoreCheckboxes stores={stores} selected={user.storeIds} error={fe.storeIds} />
          <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </form>

        {!isSelf && (
          <form onSubmit={keepFormOnSubmit(pwAction)} className="mt-2 space-y-3 border-t pt-4">
            <input type="hidden" name="userId" value={user.id} />
            <Field
              label={isStaff ? "비밀번호 잊었을 때: 생년월일로 초기화" : "비밀번호 초기화"}
              htmlFor={`pw-${user.id}`}
              error={pwState.fieldErrors?.password}
              hint={passwordHintFor(user.role, "initial")}
            >
              <Input
                id={`pw-${user.id}`}
                name="password"
                type="text"
                inputMode={isStaff ? "numeric" : undefined}
                maxLength={isStaff ? 6 : 72}
                autoComplete="off"
                className="h-10 text-base"
              />
            </Field>
            <Button type="submit" variant="secondary" className="h-11 w-full text-base" disabled={pwPending}>
              {pwPending ? "변경 중…" : "비밀번호 초기화"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

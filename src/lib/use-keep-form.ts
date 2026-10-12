"use client";

import { startTransition, type FormEvent } from "react";

/**
 * React 19 의 <form action> 은 제출 후 입력값을 초기화한다. 검증 오류 시 입력값이 사라지지 않도록
 * onSubmit 으로 직접 액션을 호출한다.
 */
export function keepFormOnSubmit(action: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
}

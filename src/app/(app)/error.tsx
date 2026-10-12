"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4">
      <ErrorState title="화면을 불러오는 중 오류가 발생했습니다">
        잠시 후 다시 시도하세요. 문제가 계속되면 아래 오류 번호를 관리자에게 알려주세요.
        {error.digest && <span className="mt-1 block font-mono text-xs">오류 번호: {error.digest}</span>}
      </ErrorState>
      <Button variant="outline" onClick={reset}>
        다시 시도
      </Button>
    </div>
  );
}

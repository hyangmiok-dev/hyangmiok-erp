import { getAppEnv } from "@/lib/env";

/** 운영(production)이 아닌 환경에서는 항상 상단에 표시해 테스트 데이터와 실적을 혼동하지 않게 한다. */
export function EnvBanner() {
  const env = getAppEnv();
  if (env === "production") return null;
  const label = env === "staging" ? "스테이징" : "개발·테스트";
  return (
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
      {label} 환경입니다 — 이 화면의 숫자는 실제 매장 실적이 아닙니다.
    </div>
  );
}

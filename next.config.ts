import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components(PPR) 는 끈다 (2026-10-13):
  //  - Cloudflare Workers(workerd)의 setTimeout 구현 차이로 Next.js 가 동작을 보장하지 못하고
  //    실제로 요청이 멈추는(hang) 문제가 확인됨 (무료 배포를 위해 Cloudflare 사용).
  //  - 이 앱의 화면은 로그인 사용자·재무 데이터라 어차피 매 요청 새로 그린다(캐시 금지).
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

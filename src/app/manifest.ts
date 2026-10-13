import type { MetadataRoute } from "next";

/** 휴대폰 '홈 화면에 추가' 시 앱처럼 열리게 한다 (주소창 없이 전체 화면). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "향미옥 경영관리",
    short_name: "향미옥",
    description: "향미옥 매출·지출·손익 관리",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "ko",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    // 홈 화면 아이콘을 길게 누르면 바로 가기 (안드로이드)
    shortcuts: [
      { name: "입고 입력", short_name: "입고", url: "/deliveries" },
      { name: "매출 입력", short_name: "매출", url: "/sales" },
    ],
  };
}

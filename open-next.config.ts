// Cloudflare Workers 배포 설정 (OpenNext)
// 이 앱의 화면은 로그인 사용자별로 매 요청마다 새로 그리므로(재무 데이터 캐시 금지),
// 증분 캐시는 빌드 때 만든 정적 결과만 읽는 static-assets 캐시를 쓴다.
// → R2(카드 등록 필요) 없이 Cloudflare 무료 요금제로 운영 가능.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});

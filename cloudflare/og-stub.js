// 이 앱은 OG 이미지(next/og, ImageResponse)를 쓰지 않는다.
// Next.js 내부의 동적 import 때문에 @vercel/og(resvg.wasm 등 약 1.4MB)가 Worker 에 묶여
// Cloudflare 무료 요금제 크기 제한(압축 3MB)을 넘으므로, wrangler alias 로 이 빈 모듈로 대체한다.
export class ImageResponse {
  constructor() {
    throw new Error("ImageResponse(next/og)는 이 배포에서 지원하지 않습니다.");
  }
}
export default { ImageResponse };

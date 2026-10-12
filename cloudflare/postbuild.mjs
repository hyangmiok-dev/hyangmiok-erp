// OpenNext(Cloudflare) 빌드 후처리. `npm run cf:build` 에서 opennextjs-cloudflare build 직후 자동 실행.
//
// 1) @vercel/og wasm 제거 (약 1.4MB)
//    이 앱은 OG 이미지(ImageResponse)를 쓰지 않는데, proxy(미들웨어) 번들에 딸려 들어와
//    Cloudflare 무료 요금제 크기 제한(압축 3MB)을 넘긴다. wasm import 를 undefined 로 바꾼다.
//
// 2) preview-props.json 인라인
//    Next.js 16.4 가 새로 읽는 .next/server/preview-props.json 을 OpenNext 1.20.10 이 아직
//    loadManifest 인라인 목록에 넣지 않아 "Unexpected loadManifest(...preview-props.json)" 500 오류가 난다.
//    OpenNext 가 지원하면 이 단계는 '이미 처리됨'으로 넘어간다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", ".open-next");
const handlers = [join(root, "server-functions", "default", "handler.mjs"), join(root, "middleware", "handler.mjs")];
const previewPropsFile = join(root, "server-functions", "default", ".next", "server", "preview-props.json");

const OG_WASM = /import\s+(\w+)\s+from\s+"[^"]*@vercel\/og\/(?:resvg|yoga)\.wasm\?module";/g;
// 압축된 코드: throw new Error(`Unexpected loadManifest(${path2}) call!`)
const UNEXPECTED = /throw new Error\(`Unexpected loadManifest\(\$\{(\w+)\}\) call!`\)/g;

let failed = false;
for (const file of handlers) {
  if (!existsSync(file)) continue;
  let src = readFileSync(file, "utf8");
  const name = file.slice(root.length + 1);

  let og = 0;
  src = src.replace(OG_WASM, (_m, v) => {
    og++;
    return `const ${v} = undefined; /* stripped @vercel/og wasm (not used) */`;
  });

  let pp = 0;
  if (!src.includes('endsWith("/server/preview-props.json")')) {
    if (!existsSync(previewPropsFile)) {
      console.error(`✖ ${previewPropsFile} 가 없습니다.`);
      failed = true;
    } else {
      const json = JSON.stringify(JSON.parse(readFileSync(previewPropsFile, "utf8")));
      src = src.replace(UNEXPECTED, (m, v) => {
        pp++;
        return `if(${v}.endsWith("/server/preview-props.json"))return ${json};${m}`;
      });
    }
  }

  writeFileSync(file, src, "utf8");
  console.log(`${name}: og wasm ${og}개 제거, preview-props 인라인 ${pp}곳`);
}

if (failed) process.exit(1);

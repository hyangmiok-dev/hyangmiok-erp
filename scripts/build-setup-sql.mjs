// supabase/migrations/*.sql 을 순서대로 합쳐 supabase/setup-new-project.sql 을 만든다.
// 새 Supabase 프로젝트(운영용 등)에 SQL Editor 로 한 번에 붙여넣기 위한 파일.
// 실행: node scripts/build-setup-sql.mjs   (마이그레이션을 추가하면 다시 실행)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

export function buildSetupSql() {
  const header = [
    "-- =====================================================================",
    "-- 향미옥 경영관리 — 새 Supabase 프로젝트 초기 설정 (자동 생성 파일, 직접 수정 금지)",
    "-- 만든 방법: node scripts/build-setup-sql.mjs",
    "-- 사용법: 새 프로젝트의 SQL Editor 에 전체를 붙여넣고 Run 한 번.",
    "--         이미 설정된 프로젝트에 다시 실행하면 'already exists' 오류가 나며 아무것도 바뀌지 않습니다.",
    `-- 포함: ${files.join(", ")}`,
    "-- =====================================================================",
    "",
  ].join("\n");
  return header + files.map((f) => `\n-- >>>>> ${f}\n` + readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n")).join("\n");
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const out = join(import.meta.dirname, "..", "supabase", "setup-new-project.sql");
  writeFileSync(out, buildSetupSql(), "utf8");
  console.log(`작성: ${out} (${files.length}개 마이그레이션)`);
}

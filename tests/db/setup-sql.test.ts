import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildSetupSql } from "../../scripts/build-setup-sql.mjs";

const ROOT = join(__dirname, "..", "..");

describe("새 프로젝트용 통합 SQL (supabase/setup-new-project.sql)", () => {
  it("마이그레이션 최신 내용과 같다 (다르면: node scripts/build-setup-sql.mjs)", () => {
    const file = readFileSync(join(ROOT, "supabase", "setup-new-project.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(file).toBe(buildSetupSql());
  });

  it("빈 DB 에 한 번에 실행된다", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
    await db.exec(buildSetupSql());
    const r = await db.query<{ n: number }>(`select count(*)::int n from public.stores`);
    expect(r.rows[0].n).toBe(3);
    const c = await db.query<{ n: number }>(`select count(*)::int n from public.expense_categories`);
    expect(c.rows[0].n).toBe(18);
  }, 60_000);
});

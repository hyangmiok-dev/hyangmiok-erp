import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000e1";
const HQ = "00000000-0000-4000-8000-0000000000e2";
const MGR1 = "00000000-0000-4000-8000-0000000000e3";

let db: PGlite;

const setPct = (uid: string, pct: number, code = "S1") =>
  asUser(db, uid, (tx) => tx.query(`update public.stores set stock_reserve_pct = $1 where code = $2`, [pct, code]));
const pctOf = async (code: string) =>
  Number((await db.query<{ p: string }>(`select stock_reserve_pct p from public.stores where code = $1`, [code])).rows[0].p);

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
}, 60_000);

describe("냉장고 재고 비율 (지점별, 대표만)", () => {
  it("처음 값은 세 지점 모두 5%", async () => {
    const r = await db.query<{ code: string; p: string }>(`select code, stock_reserve_pct p from public.stores order by code`);
    expect(r.rows.map((x) => [x.code, Number(x.p)])).toEqual([
      ["S1", 5],
      ["S2", 5],
      ["S3", 5],
    ]);
  });

  it("대표는 지점마다 따로 바꿀 수 있다", async () => {
    await setPct(OWNER, 7, "S1");
    await setPct(OWNER, 10, "S2");
    expect(await pctOf("S1")).toBe(7);
    expect(await pctOf("S2")).toBe(10);
    expect(await pctOf("S3")).toBe(5);
  });

  it("5~10% 밖은 거부", async () => {
    await expect(setPct(OWNER, 4)).rejects.toThrow(/stores_stock_reserve_pct_range/);
    await expect(setPct(OWNER, 10.5)).rejects.toThrow(/stores_stock_reserve_pct_range/);
    await expect(setPct(OWNER, 0)).rejects.toThrow(/stores_stock_reserve_pct_range/);
    expect(await pctOf("S1")).toBe(7);
  });

  it("본사 관리자·지점 관리자는 바꿀 수 없다 (0행), 보기는 가능", async () => {
    for (const uid of [HQ, MGR1]) {
      const r = await setPct(uid, 9);
      expect(r.affectedRows).toBe(0);
      const seen = await asUser(db, uid, (tx) => tx.query<{ p: string }>(`select stock_reserve_pct p from public.stores where code = 'S1'`));
      expect(Number(seen.rows[0].p)).toBe(7);
    }
    expect(await pctOf("S1")).toBe(7);
  });

  it("바꾼 기록이 변경 이력에 남는다", async () => {
    await setPct(OWNER, 8);
    const r = await db.query<{ actor_id: string; old_data: { stock_reserve_pct: number }; new_data: { stock_reserve_pct: number } }>(
      `select actor_id, old_data, new_data from public.audit_logs
       where table_name = 'stores' and action = 'UPDATE' order by id desc limit 1`,
    );
    expect(r.rows[0].actor_id).toBe(OWNER);
    expect(Number(r.rows[0].old_data.stock_reserve_pct)).toBe(7);
    expect(Number(r.rows[0].new_data.stock_reserve_pct)).toBe(8);
  });
});

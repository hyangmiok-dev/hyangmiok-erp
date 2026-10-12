import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000c1";
const HQ = "00000000-0000-4000-8000-0000000000c2";
const MGR1 = "00000000-0000-4000-8000-0000000000c3";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
}, 60_000);

const vendorNames = async (code: string) =>
  (
    await db.query<{ name: string }>(
      `select v.name from public.vendors v
       join public.vendor_stores vs on vs.vendor_id = v.id
       join public.stores s on s.id = vs.store_id
       where s.code = $1 order by v.name`,
      [code],
    )
  ).rows.map((r) => r.name);

describe("엑셀에서 가져온 초기 거래처", () => {
  it("18곳이 식재료비 기본 항목으로 들어간다", async () => {
    const r = await db.query<{ n: number; food: number }>(
      `select count(*)::int n,
              count(*) filter (where default_category_id = (select id from public.expense_categories where code='food'))::int food
       from public.vendors`,
    );
    expect(r.rows[0]).toEqual({ n: 18, food: 18 });
  });

  it("1호점 13곳, 2호점 15곳 (엑셀 그대로), 3호점은 대표 요청으로 18곳 모두 (0500 마이그레이션)", async () => {
    expect(await vendorNames("S1")).toHaveLength(13);
    expect(await vendorNames("S2")).toHaveLength(15);
    expect(await vendorNames("S3")).toHaveLength(18);
  });

  it("같은 곳으로 보이는 표기는 합치고 원래 표기를 메모에 남긴다", async () => {
    const r = await db.query<{ memo: string }>(`select memo from public.vendors where name = '예길식품'`);
    expect(r.rows[0].memo).toContain("1호점 '예길'");
    expect(await vendorNames("S1")).toContain("예길식품");
    expect(await vendorNames("S2")).toContain("예길식품");
  });

  it("매입 합계가 큰 순서로 정렬된다 (엠앤아이가 맨 앞)", async () => {
    const r = await db.query<{ name: string }>(`select name from public.vendors order by sort_order limit 3`);
    expect(r.rows.map((x) => x.name)).toEqual(["엠앤아이", "씨앤푸드", "투웰브"]);
  });
});

describe("거래처 권한", () => {
  it("대표는 추가·수정할 수 있다", async () => {
    await asUser(db, OWNER, async (tx) => {
      await tx.query(`insert into public.vendors (name) values ('새거래처')`);
      await tx.query(`update public.vendors set phone = '02-000-0000' where name = '새거래처'`);
    });
  });

  it("본사 관리자는 볼 수만 있고, 소속 지점(1호점) 연결만 보인다", async () => {
    const v = await asUser(db, HQ, (tx) => tx.query(`select * from public.vendors`));
    expect(v.rows.length).toBeGreaterThan(0);
    const s1 = await storeId(db, "S1");
    const links = await asUser(db, HQ, (tx) => tx.query<{ store_id: string }>(`select store_id from public.vendor_stores`));
    expect(links.rows.every((x) => x.store_id === s1)).toBe(true);
    await expect(
      asUser(db, HQ, (tx) => tx.query(`insert into public.vendors (name) values ('본사추가')`)),
    ).rejects.toThrow(/row-level security/);
  });

  it("지점 관리자는 거래처를 볼 수 없다", async () => {
    const r = await asUser(db, MGR1, (tx) => tx.query(`select * from public.vendors`));
    expect(r.rows).toHaveLength(0);
  });

  it("거래 지점 교체는 대표만 (set_vendor_stores)", async () => {
    const s3 = await storeId(db, "S3");
    const id = (await db.query<{ id: string }>(`select id from public.vendors where name='새거래처'`)).rows[0].id;
    await asUser(db, OWNER, (tx) => tx.query(`select public.set_vendor_stores($1, $2)`, [id, [s3]]));
    const r = await db.query<{ n: number }>(`select count(*)::int n from public.vendor_stores where vendor_id=$1`, [id]);
    expect(r.rows[0].n).toBe(1);
    await expect(
      asUser(db, HQ, (tx) => tx.query(`select public.set_vendor_stores($1, $2)`, [id, []])),
    ).rejects.toThrow(/권한이 없습니다/);
  });
});

describe("지출에 거래처 연결", () => {
  it("지출에 vendor_id 를 저장하고, 거래 기록이 있는 거래처는 삭제할 수 없다 (원장 보호)", async () => {
    const s1 = await storeId(db, "S1");
    const food = (await db.query<{ id: string }>(`select id from public.expense_categories where code='food'`)).rows[0].id;
    const vid = (await db.query<{ id: string }>(`select id from public.vendors where name='새거래처'`)).rows[0].id;
    await asUser(db, OWNER, (tx) =>
      tx.query(
        `insert into public.expenses (store_id, expense_date, category_id, vendor, vendor_id, amount)
         values ($1, app.seoul_today(), $2, '새거래처', $3, 50000)`,
        [s1, food, vid],
      ),
    );
    await expect(asUser(db, OWNER, (tx) => tx.query(`delete from public.vendors where id = $1`, [vid]))).rejects.toThrow(
      /expenses_vendor_id_fkey/,
    );
  });
});
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000d1";
const HQ = "00000000-0000-4000-8000-0000000000d2";
const MGR1 = "00000000-0000-4000-8000-0000000000d3";

let db: PGlite;
let s1: string;
let s2: string;
let food: string;
let vendor: string;
let today: string;

const lines = [
  { item_name: "차돌양지", quantity: 10, unit: "kg", unit_price: 32000, amount: 320000 },
  { item_name: "숙주", quantity: 2, unit: "박스", unit_price: 15000, amount: 30000 },
];

async function save(uid: string, expense: Record<string, unknown>, ls: unknown[], expected: string | null = null) {
  return asUser(db, uid, (tx) =>
    tx.query<{ id: string }>(`select public.save_expense_with_lines($1::jsonb, $2::jsonb, $3) as id`, [
      JSON.stringify(expense),
      JSON.stringify(ls),
      expected,
    ]),
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  s1 = await storeId(db, "S1");
  s2 = await storeId(db, "S2");
  food = (await db.query<{ id: string }>(`select id from public.expense_categories where code='food'`)).rows[0].id;
  vendor = (await db.query<{ id: string }>(`select id from public.vendors where name='엠앤아이'`)).rows[0].id;
  today = (await db.query<{ d: string }>(`select app.seoul_today()::text d`)).rows[0].d;
}, 60_000);

const base = () => ({
  store_id: s1,
  expense_date: today,
  category_id: food,
  vendor: "엠앤아이",
  vendor_id: vendor,
  amount: 350000,
  basis: "actual",
  on_credit: true,
});

describe("3호점 거래처 연결", () => {
  it("3호점도 18곳 모두와 연결된다", async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from public.vendor_stores vs join public.stores s on s.id = vs.store_id where s.code='S3'`,
    );
    expect(r.rows[0].n).toBe(18);
  });
});

describe("거래명세표 저장 (save_expense_with_lines)", () => {
  let id: string;

  it("지출과 품목 줄을 한 번에 저장한다", async () => {
    const r = await save(OWNER, base(), lines);
    id = r.rows[0].id;
    const l = await db.query<{ item_name: string; line_no: number }>(
      `select item_name, line_no from public.expense_lines where expense_id = $1 order by line_no`,
      [id],
    );
    expect(l.rows).toEqual([
      { item_name: "차돌양지", line_no: 1 },
      { item_name: "숙주", line_no: 2 },
    ]);
  });

  it("품목 합계와 금액이 다르면 아무것도 저장되지 않는다", async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n;
    await expect(save(OWNER, { ...base(), amount: 999 }, lines)).rejects.toThrow(/품목 금액 합계/);
    const after = (await db.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n;
    expect(after).toBe(before);
  });

  it("수정하면 품목 줄이 새 내용으로 바뀐다 (동시 수정 감지 포함)", async () => {
    const cur = (await db.query<{ updated_at: string }>(`select updated_at::text from public.expenses where id=$1`, [id])).rows[0];
    await save(OWNER, { ...base(), id, amount: 30000 }, [lines[1]], cur.updated_at);
    const l = await db.query<{ n: number }>(`select count(*)::int n from public.expense_lines where expense_id=$1`, [id]);
    expect(l.rows[0].n).toBe(1);
    await expect(save(OWNER, { ...base(), id, amount: 30000 }, [lines[1]], cur.updated_at)).rejects.toThrow(/먼저 수정/);
  });

  it("외상인데 거래처가 없으면 거부", async () => {
    await expect(save(OWNER, { ...base(), vendor_id: null, amount: 1000 }, [])).rejects.toThrow(/거래처를 골라야/);
  });

  it("대표가 아니면 저장할 수 없다", async () => {
    await expect(save(HQ, base(), lines)).rejects.toThrow(/권한이 없습니다/);
  });

  it("품목 줄 조회: 본사 관리자는 소속 지점만, 지점 관리자는 불가", async () => {
    const h = await asUser(db, HQ, (tx) => tx.query(`select * from public.expense_lines`));
    expect(h.rows.length).toBeGreaterThan(0);
    const m = await asUser(db, MGR1, (tx) => tx.query(`select * from public.expense_lines`));
    expect(m.rows).toHaveLength(0);
  });

  it("지출을 지우면 품목 줄도 같이 지워진다", async () => {
    await asUser(db, OWNER, (tx) => tx.query(`delete from public.expenses where id=$1`, [id]));
    const l = await db.query<{ n: number }>(`select count(*)::int n from public.expense_lines where expense_id=$1`, [id]);
    expect(l.rows[0].n).toBe(0);
  });
});

describe("결제·이월 미수 (vendor_payments)", () => {
  const pay = (uid: string, store: string, kind = "payment", amount = 100000, date?: string) =>
    asUser(db, uid, (tx) =>
      tx.query(
        `insert into public.vendor_payments (store_id, vendor_id, paid_date, kind, amount, method) values ($1,$2,$3,$4,$5,'transfer')`,
        [store, vendor, date ?? today, kind, amount],
      ),
    );

  it("대표는 결제·이월 미수를 기록하고, 입력자가 남는다", async () => {
    await pay(OWNER, s1, "opening", 500000);
    await pay(OWNER, s1, "payment", 200000);
    const r = await db.query<{ created_by: string }>(`select created_by from public.vendor_payments limit 1`);
    expect(r.rows[0].created_by).toBe(OWNER);
  });

  it("미래 날짜·0원은 거부", async () => {
    const tomorrow = (await db.query<{ d: string }>(`select (app.seoul_today()+1)::text d`)).rows[0].d;
    await expect(pay(OWNER, s1, "payment", 1000, tomorrow)).rejects.toThrow(/미래 날짜/);
    await expect(pay(OWNER, s1, "payment", 0)).rejects.toThrow(/check/);
  });

  it("본사 관리자는 소속 지점 결제만 보고, 입력은 못 한다", async () => {
    await pay(OWNER, s2, "payment", 50000);
    const r = await asUser(db, HQ, (tx) => tx.query<{ store_id: string }>(`select store_id from public.vendor_payments`));
    expect(r.rows.every((x) => x.store_id === s1)).toBe(true);
    await expect(pay(HQ, s1)).rejects.toThrow(/row-level security/);
  });

  it("지점 관리자는 결제 기록을 볼 수 없다", async () => {
    const r = await asUser(db, MGR1, (tx) => tx.query(`select * from public.vendor_payments`));
    expect(r.rows).toHaveLength(0);
  });

  it("결제 기록이 있는 거래처는 삭제할 수 없다", async () => {
    await expect(asUser(db, OWNER, (tx) => tx.query(`delete from public.vendors where id=$1`, [vendor]))).rejects.toThrow(
      /foreign key|violates/,
    );
  });

  it("결제 수정·삭제가 감사로그에 남는다", async () => {
    await asUser(db, OWNER, (tx) => tx.query(`update public.vendor_payments set amount = 210000 where amount = 200000`));
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from public.audit_logs where table_name='vendor_payments' and action='UPDATE'`,
    );
    expect(r.rows[0].n).toBe(1);
  });
});

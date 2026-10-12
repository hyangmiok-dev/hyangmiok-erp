import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const HQ = "00000000-0000-4000-8000-0000000000b2";
const MGR1 = "00000000-0000-4000-8000-0000000000b3";
const STAFF1 = "00000000-0000-4000-8000-0000000000b4";

let db: PGlite;
let s1: string;
let s2: string;
let food: string;
let today: string;

async function addExpense(uid: string, store: string, amount = 50000, date?: string) {
  return asUser(db, uid, (tx) =>
    tx.query(
      `insert into public.expenses (store_id, expense_date, category_id, vendor, amount) values ($1, $2, $3, '청수상사', $4)`,
      [store, date ?? today, food, amount],
    ),
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF1, name: "직원", role: "staff", storeCodes: ["S1"] });
  s1 = await storeId(db, "S1");
  s2 = await storeId(db, "S2");
  food = (await db.query<{ id: string }>(`select id from public.expense_categories where code='food'`)).rows[0].id;
  today = (await db.query<{ d: string }>(`select app.seoul_today()::text d`)).rows[0].d;
}, 60_000);

describe("지출 항목", () => {
  it("기본 항목이 손익 구분과 함께 생성된다", async () => {
    const r = await db.query<{ section: string; n: number }>(
      `select section, count(*)::int n from public.expense_categories group by section order by section`,
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.section, x.n]))).toEqual({ cogs: 1, labor: 3, opex: 11, excluded: 3 });
  });
  it("지점 관리자는 지출 항목도 볼 수 없다", async () => {
    const r = await asUser(db, MGR1, (tx) => tx.query(`select * from public.expense_categories`));
    expect(r.rows).toHaveLength(0);
  });
});

describe("지출 입력 권한 (대표만)", () => {
  it("대표는 입력하고, 입력자가 기록된다", async () => {
    await addExpense(OWNER, s1, 120000);
    const r = await db.query<{ created_by: string }>(`select created_by from public.expenses limit 1`);
    expect(r.rows[0].created_by).toBe(OWNER);
  });
  it("본사 관리자·지점 관리자·직원은 입력할 수 없다", async () => {
    for (const uid of [HQ, MGR1, STAFF1]) {
      await expect(addExpense(uid, s1)).rejects.toThrow(/row-level security/);
    }
  });
  it("미래 날짜·0원·음수는 거부", async () => {
    const tomorrow = (await db.query<{ d: string }>(`select (app.seoul_today()+1)::text d`)).rows[0].d;
    await expect(addExpense(OWNER, s1, 1000, tomorrow)).rejects.toThrow(/미래 날짜/);
    await expect(addExpense(OWNER, s1, 0)).rejects.toThrow(/check/);
    await expect(addExpense(OWNER, s1, -5)).rejects.toThrow(/check/);
  });
});

describe("지출 조회 권한", () => {
  it("본사 관리자는 소속 지점(1호점)만 본다", async () => {
    await addExpense(OWNER, s2, 77000);
    const r = await asUser(db, HQ, (tx) => tx.query<{ store_id: string }>(`select store_id from public.expenses`));
    expect(r.rows.every((x) => x.store_id === s1)).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
  });
  it("지점 관리자·직원은 자기 지점 지출도 볼 수 없다", async () => {
    for (const uid of [MGR1, STAFF1]) {
      const r = await asUser(db, uid, (tx) => tx.query(`select * from public.expenses`));
      expect(r.rows).toHaveLength(0);
    }
  });
  it("본사 관리자는 수정·삭제할 수 없다 (0행)", async () => {
    const u = await asUser(db, HQ, (tx) => tx.query(`update public.expenses set amount = 1`));
    expect(u.affectedRows).toBe(0);
    const d = await asUser(db, HQ, (tx) => tx.query(`delete from public.expenses`));
    expect(d.affectedRows).toBe(0);
  });
});

describe("수정 이력·무결성", () => {
  it("금액 수정이 감사로그에 남는다", async () => {
    await asUser(db, OWNER, (tx) => tx.query(`update public.expenses set amount = 130000 where amount = 120000`));
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from public.audit_logs where table_name='expenses' and action='UPDATE'`,
    );
    expect(r.rows[0].n).toBe(1);
  });
  it("지점은 바꿀 수 없다", async () => {
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`update public.expenses set store_id = $1 where store_id = $2`, [s2, s1])),
    ).rejects.toThrow(/지점은 바꿀 수 없습니다/);
  });
});

describe("월말 재고", () => {
  it("같은 지점·날짜는 한 번만", async () => {
    const ins = () =>
      asUser(db, OWNER, (tx) =>
        tx.query(`insert into public.inventory_counts (store_id, count_date, amount) values ($1, $2, 1500000)`, [s1, today]),
      );
    await ins();
    await expect(ins()).rejects.toThrow(/inventory_counts_store_date_key/);
  });
  it("지점 관리자는 재고 금액을 볼 수 없다", async () => {
    const r = await asUser(db, MGR1, (tx) => tx.query(`select * from public.inventory_counts`));
    expect(r.rows).toHaveLength(0);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const HQ = "00000000-0000-4000-8000-0000000000a2";
const MGR1 = "00000000-0000-4000-8000-0000000000a3";
const MGR2 = "00000000-0000-4000-8000-0000000000a4";
const STAFF1 = "00000000-0000-4000-8000-0000000000a5";

let db: PGlite;
let s1: string;
let s2: string;
let today: string;

/** 한국 날짜 기준 n일 전 (DB 함수로 계산해 테스트와 DB 의 기준을 일치) */
async function daysAgo(n: number): Promise<string> {
  const r = await db.query<{ d: string }>(`select (app.seoul_today() - $1::int)::text as d`, [n]);
  return r.rows[0].d;
}

async function insertSale(uid: string, store: string, date: string, net = 100000, orders = 10) {
  return asUser(db, uid, (tx) =>
    tx.query(
      `insert into public.daily_sales (store_id, business_date, net_sales, order_count) values ($1, $2, $3, $4)`,
      [store, date, net, orders],
    ),
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR2, name: "2호점장", role: "store_manager", storeCodes: ["S2"] });
  await createUser(db, { id: STAFF1, name: "1호점직원", role: "staff", storeCodes: ["S1"] });
  s1 = await storeId(db, "S1");
  s2 = await storeId(db, "S2");
  today = await daysAgo(0);
}, 60_000);

describe("매출 입력", () => {
  it("점장은 자기 지점 오늘 매출을 입력하고, 입력자가 자동 기록된다", async () => {
    await insertSale(MGR1, s1, today, 1_234_000, 87);
    const r = await db.query<{ created_by: string; updated_by: string; net_sales: string }>(
      `select created_by, updated_by, net_sales::text from public.daily_sales where store_id = $1 and business_date = $2`,
      [s1, today],
    );
    expect(r.rows[0]).toEqual({ created_by: MGR1, updated_by: MGR1, net_sales: "1234000" });
  });

  it("같은 지점·같은 날은 두 번 입력할 수 없다", async () => {
    await expect(insertSale(MGR1, s1, today)).rejects.toThrow(/daily_sales_store_date_key/);
  });

  it("다른 지점 매출은 입력할 수 없다", async () => {
    await expect(insertSale(MGR1, s2, today)).rejects.toThrow(/row-level security/);
  });

  it("직원은 매출을 입력할 수 없다", async () => {
    await expect(insertSale(STAFF1, s1, await daysAgo(1))).rejects.toThrow(/row-level security/);
  });

  it("미래 날짜는 입력할 수 없다", async () => {
    const tomorrow = await daysAgo(-1);
    await expect(insertSale(MGR1, s1, tomorrow)).rejects.toThrow(/미래 날짜/);
  });

  it("점장은 7일이 지난 날짜를 입력할 수 없고, 대표는 가능하다", async () => {
    const old = await daysAgo(8);
    await expect(insertSale(MGR1, s1, old)).rejects.toThrow(/7일이 지난/);
    await insertSale(OWNER, s1, old, 500000, 40);
  });

  it("점장은 7일이 지난 매출을 수정할 수 없다", async () => {
    const old = await daysAgo(8);
    const r = await asUser(db, MGR1, (tx) =>
      tx
        .query(`update public.daily_sales set net_sales = 1 where store_id = $1 and business_date = $2`, [s1, old])
        .then(() => "ok")
        .catch((e: Error) => e.message),
    );
    expect(r).toMatch(/7일이 지난/);
  });

  it("휴무일은 매출·건수가 0 이어야 한다", async () => {
    const d = await daysAgo(2);
    await expect(
      asUser(db, MGR1, (tx) =>
        tx.query(
          `insert into public.daily_sales (store_id, business_date, net_sales, order_count, is_closed) values ($1,$2,100,1,true)`,
          [s1, d],
        ),
      ),
    ).rejects.toThrow(/daily_sales_closed_zero/);
    await asUser(db, MGR1, (tx) =>
      tx.query(
        `insert into public.daily_sales (store_id, business_date, net_sales, order_count, is_closed) values ($1,$2,0,0,true)`,
        [s1, d],
      ),
    );
  });

  it("음수 금액은 거부된다", async () => {
    await expect(insertSale(MGR1, s1, await daysAgo(3), -1000, 1)).rejects.toThrow(/check/);
  });

  it("입력자(created_by)를 위조할 수 없다", async () => {
    const d = await daysAgo(4);
    await asUser(db, MGR1, (tx) =>
      tx.query(
        `insert into public.daily_sales (store_id, business_date, net_sales, order_count, created_by) values ($1,$2,1000,1,$3)`,
        [s1, d, OWNER],
      ),
    );
    const r = await db.query<{ created_by: string }>(
      `select created_by from public.daily_sales where store_id=$1 and business_date=$2`,
      [s1, d],
    );
    expect(r.rows[0].created_by).toBe(MGR1);
  });
});

describe("매출 조회 권한", () => {
  it("직원은 매출을 볼 수 없다", async () => {
    const r = await asUser(db, STAFF1, (tx) => tx.query(`select * from public.daily_sales`));
    expect(r.rows).toHaveLength(0);
  });

  it("2호점장은 1호점 매출을 볼 수 없다", async () => {
    const r = await asUser(db, MGR2, (tx) => tx.query(`select * from public.daily_sales where store_id = $1`, [s1]));
    expect(r.rows).toHaveLength(0);
  });

  it("본사 관리자는 소속(1호점) 매출을 본다", async () => {
    const r = await asUser(db, HQ, (tx) => tx.query(`select * from public.daily_sales where store_id = $1`, [s1]));
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("점장은 매출을 삭제할 수 없다 (0행), 대표는 가능", async () => {
    const d = await daysAgo(4);
    const r = await asUser(db, MGR1, (tx) =>
      tx.query(`delete from public.daily_sales where store_id=$1 and business_date=$2`, [s1, d]),
    );
    expect(r.affectedRows).toBe(0);
    const o = await asUser(db, OWNER, (tx) =>
      tx.query(`delete from public.daily_sales where store_id=$1 and business_date=$2`, [s1, d]),
    );
    expect(o.affectedRows).toBe(1);
  });
});

describe("수정 이력", () => {
  it("매출 수정 시 변경 전/후 값과 수정자가 감사로그에 남는다", async () => {
    await asUser(db, MGR1, (tx) =>
      tx.query(`update public.daily_sales set net_sales = 1300000 where store_id=$1 and business_date=$2`, [s1, today]),
    );
    const r = await db.query<{ actor_id: string; old_data: { net_sales: number }; new_data: { net_sales: number } }>(
      `select actor_id, old_data, new_data from public.audit_logs
       where table_name='daily_sales' and action='UPDATE' order by id desc limit 1`,
    );
    expect(r.rows[0].actor_id).toBe(MGR1);
    expect(Number(r.rows[0].old_data.net_sales)).toBe(1234000);
    expect(Number(r.rows[0].new_data.net_sales)).toBe(1300000);
  });
});

describe("CSV 일괄 등록 (import_daily_sales)", () => {
  const rows = (store: string, dates: string[]) =>
    JSON.stringify(dates.map((d, i) => ({ store_id: store, business_date: d, net_sales: 100000 + i, order_count: 10 + i })));

  it("새 행은 추가, 기존 행은 덮어쓰기 안 함이면 건너뜀", async () => {
    const d5 = await daysAgo(5);
    const d6 = await daysAgo(6);
    const res = await asUser(db, MGR1, (tx) =>
      tx.query<{ r: { inserted: number; skipped: number; updated: number } }>(
        `select public.import_daily_sales('test.csv', $1::jsonb, false) as r`,
        [rows(s1, [d5, d6, today])],
      ),
    );
    expect(res.rows[0].r).toMatchObject({ inserted: 2, skipped: 1, updated: 0 });
    const src = await db.query<{ source: string }>(
      `select source from public.daily_sales where store_id=$1 and business_date=$2`,
      [s1, d5],
    );
    expect(src.rows[0].source).toBe("csv");
  });

  it("덮어쓰기면 기존 행을 갱신", async () => {
    const res = await asUser(db, MGR1, (tx) =>
      tx.query<{ r: { updated: number } }>(`select public.import_daily_sales('test.csv', $1::jsonb, true) as r`, [
        rows(s1, [today]),
      ]),
    );
    expect(res.rows[0].r.updated).toBe(1);
  });

  it("권한 없는 지점 행이 섞이면 전체가 취소된다 (부분 반영 없음)", async () => {
    const d1 = await daysAgo(1);
    const before = await db.query<{ n: number }>(`select count(*)::int n from public.daily_sales`);
    await expect(
      asUser(db, MGR1, (tx) =>
        tx.query(`select public.import_daily_sales('mix.csv', $1::jsonb, false)`, [
          JSON.stringify([
            { store_id: s1, business_date: d1, net_sales: 1, order_count: 1 },
            { store_id: s2, business_date: d1, net_sales: 1, order_count: 1 },
          ]),
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const after = await db.query<{ n: number }>(`select count(*)::int n from public.daily_sales`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("직원은 일괄 등록할 수 없다", async () => {
    await expect(
      asUser(db, STAFF1, (tx) =>
        tx.query(`select public.import_daily_sales('x.csv', $1::jsonb, false)`, [rows(s1, [today])]),
      ),
    ).rejects.toThrow(/권한이 없습니다/);
  });
});

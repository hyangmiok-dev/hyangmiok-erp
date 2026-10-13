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
let vendor: string; // 엠앤아이 (외상)
let today: string;

const day = async (n: number) => (await db.query<{ d: string }>(`select (app.seoul_today() + $1::int)::text d`, [n])).rows[0].d;

const LINES = [
  { item_name: "차돌양지", quantity: 10, unit: "kg", unit_price: 32000 },
  { item_name: "숙주", quantity: "2.5", unit: "박스", unit_price: "15000" },
];

function record(
  uid: string,
  opts: { store?: string; date?: string; lines?: unknown; vat?: number; onCredit?: boolean | null; vendorId?: string } = {},
) {
  return asUser(db, uid, (tx) =>
    tx.query<{ id: string }>(`select public.record_delivery($1, $2, $3::date, $4::jsonb, $5, $6, '아침 입고') as id`, [
      opts.store ?? s1,
      opts.vendorId ?? vendor,
      opts.date ?? today,
      JSON.stringify(opts.lines ?? LINES),
      opts.vat ?? 0,
      opts.onCredit ?? null,
    ]),
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  await createUser(db, { id: MGR2, name: "2호점장", role: "store_manager", storeCodes: ["S2"] });
  await createUser(db, { id: STAFF1, name: "직원", role: "staff", storeCodes: ["S1"] });
  s1 = await storeId(db, "S1");
  s2 = await storeId(db, "S2");
  vendor = (await db.query<{ id: string }>(`select id from public.vendors where name = '엠앤아이'`)).rows[0].id;
  today = await day(0);
}, 60_000);

describe("입고 빠른 입력 — 저장", () => {
  it("점장이 저장하면 식재료 지출(외상) + 품목 줄, 금액은 수량×단가로 DB 가 계산", async () => {
    const r = await record(MGR1, { lines: [{ ...LINES[0] }, { ...LINES[1] }], vat: 0 });
    const id = r.rows[0].id;
    const e = await db.query<{ amount: number; on_credit: boolean; created_by: string; description: string; code: string }>(
      `select e.amount::int, e.on_credit, e.created_by, e.description, c.code
       from public.expenses e join public.expense_categories c on c.id = e.category_id where e.id = $1`,
      [id],
    );
    expect(e.rows[0]).toMatchObject({ amount: 320000 + 37500, on_credit: true, created_by: MGR1, code: "food" });
    expect(e.rows[0].description).toBe("입고 입력 · 아침 입고");
    const l = await db.query<{ item_name: string; amount: number }>(
      `select item_name, amount::int from public.expense_lines where expense_id = $1 order by line_no`,
      [id],
    );
    expect(l.rows).toEqual([
      { item_name: "차돌양지", amount: 320000 },
      { item_name: "숙주", amount: 37500 },
    ]);
  });

  it("부가세가 있으면 '부가세' 줄을 더하고 합계에 포함", async () => {
    const r = await record(OWNER, { vat: 5000, onCredit: false });
    const e = await db.query<{ amount: number; on_credit: boolean }>(`select amount::int, on_credit from public.expenses where id = $1`, [
      r.rows[0].id,
    ]);
    expect(e.rows[0]).toEqual({ amount: 357500 + 5000, on_credit: false });
    const last = await db.query<{ item_name: string; amount: number }>(
      `select item_name, amount::int from public.expense_lines where expense_id = $1 order by line_no desc limit 1`,
      [r.rows[0].id],
    );
    expect(last.rows[0]).toEqual({ item_name: "부가세", amount: 5000 });
  });

  it("다른 지점·직원은 저장할 수 없다", async () => {
    await expect(record(MGR2)).rejects.toThrow(/권한이 없습니다/);
    await expect(record(STAFF1)).rejects.toThrow(/권한이 없습니다/);
    await record(HQ); // 본사 관리자(1호점 소속)는 가능
  });

  it("미래 날짜 거부, 7일 넘게 지난 것은 대표만", async () => {
    await expect(record(MGR1, { date: await day(1) })).rejects.toThrow(/미래 날짜/);
    await expect(record(MGR1, { date: await day(-8) })).rejects.toThrow(/대표만/);
    await record(MGR1, { date: await day(-7) });
    await record(OWNER, { date: await day(-40) });
  });

  it("빈 품목·0 수량·잘못된 숫자·'부가세' 품목명은 거부하고 아무것도 안 만든다", async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n;
    const bad = [
      [],
      [{ item_name: " ", quantity: 1, unit_price: 1000 }],
      [{ item_name: "숙주", quantity: 0, unit_price: 1000 }],
      [{ item_name: "숙주", quantity: "많이", unit_price: 1000 }],
      [{ item_name: "숙주", quantity: 1, unit_price: -1 }],
      [{ item_name: "부가세", quantity: 1, unit_price: 1000 }],
      [{ item_name: "숙주", quantity: 1, unit_price: 0 }],
    ];
    for (const b of bad) await expect(record(MGR1, { lines: b })).rejects.toThrow(/품목|합계/);
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n).toBe(before);
  });

  it("거래 중이 아닌 거래처는 안 된다", async () => {
    await db.query(`update public.vendors set is_active = false where id = $1`, [vendor]);
    await expect(record(MGR1)).rejects.toThrow(/거래 중인 거래처가 아닙니다/);
    await db.query(`update public.vendors set is_active = true where id = $1`, [vendor]);
  });

  it("점장은 저장해도 지출 표를 직접 볼 수 없다", async () => {
    const r = await asUser(db, MGR1, (tx) => tx.query(`select * from public.expenses`));
    expect(r.rows).toHaveLength(0);
  });
});

describe("지난번 품목 불러오기", () => {
  it("거래처별 품목·마지막 단가·수량·횟수, 바로 지난번 입고 품목 표시", async () => {
    await record(MGR1, { lines: [{ item_name: "숙주", quantity: 3, unit: "박스", unit_price: 16000 }] });
    const r = await asUser(db, MGR1, (tx) =>
      tx.query<{ item_name: string; last_price: number; last_qty: string; times: number; in_last: boolean }>(
        `select item_name, last_price::int, last_qty::text, times, in_last from public.delivery_items($1) where vendor_id = $2`,
        [s1, vendor],
      ),
    );
    const sukju = r.rows.find((x) => x.item_name === "숙주")!;
    expect(sukju).toMatchObject({ last_price: 16000, in_last: true });
    expect(Number(sukju.last_qty)).toBe(3);
    expect(sukju.times).toBeGreaterThan(1);
    const chadol = r.rows.find((x) => x.item_name === "차돌양지")!;
    expect(chadol.in_last).toBe(false);
    expect(r.rows.map((x) => x.item_name)).not.toContain("부가세");
    expect(r.rows[0].item_name).toBe("숙주"); // 지난번 품목이 먼저
  });

  it("다른 지점 점장·직원은 볼 수 없다", async () => {
    await expect(asUser(db, MGR2, (tx) => tx.query(`select * from public.delivery_items($1)`, [s1]))).rejects.toThrow(/권한이 없습니다/);
    await expect(asUser(db, STAFF1, (tx) => tx.query(`select * from public.delivery_items($1)`, [s1]))).rejects.toThrow(/권한이 없습니다/);
    const own = await asUser(db, MGR2, (tx) => tx.query(`select * from public.delivery_items($1)`, [s2]));
    expect(own.rows).toHaveLength(0);
  });
});

describe("최근 입고 목록 · 취소", () => {
  it("최근 3일 목록, 본인이 오늘 입력한 것만 취소 가능 표시", async () => {
    const r = await asUser(db, MGR1, (tx) =>
      tx.query<{ vendor_name: string; created_by_name: string; can_cancel: boolean; item_count: number; expense_date: string }>(
        `select vendor_name, created_by_name, can_cancel, item_count, expense_date::text from public.recent_deliveries($1)`,
        [s1],
      ),
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.vendor_name === "엠앤아이")).toBe(true);
    expect(r.rows.some((x) => x.created_by_name === "대표" && !x.can_cancel)).toBe(true);
    expect(r.rows.some((x) => x.created_by_name === "1호점장" && x.can_cancel)).toBe(true);
    expect(r.rows.every((x) => x.expense_date >= today.slice(0, 4))).toBe(true);
    expect(r.rows.some((x) => x.item_count === 2)).toBe(true); // 부가세 줄은 품목 수에서 뺀다
  });

  it("점장은 본인이 오늘 입력한 것만 취소, 남이 입력한 건 못 함", async () => {
    const mine = (await record(MGR1)).rows[0].id;
    const ownerOne = (await record(OWNER)).rows[0].id;
    await asUser(db, MGR1, (tx) => tx.query(`select public.cancel_delivery($1)`, [mine]));
    expect((await db.query(`select 1 from public.expenses where id = $1`, [mine])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.expense_lines where expense_id = $1`, [mine])).rows).toHaveLength(0);
    await expect(asUser(db, MGR1, (tx) => tx.query(`select public.cancel_delivery($1)`, [ownerOne]))).rejects.toThrow(/본인이 오늘/);
    await expect(asUser(db, MGR2, (tx) => tx.query(`select public.cancel_delivery($1)`, [ownerOne]))).rejects.toThrow(/권한이 없습니다/);
    await asUser(db, OWNER, (tx) => tx.query(`select public.cancel_delivery($1)`, [ownerOne]));
  });

  it("어제 입력한 것은 점장이 취소할 수 없다", async () => {
    const id = (await record(MGR1)).rows[0].id;
    // 입력자 기록 트리거가 created_at 을 지키므로, 시험용으로 트리거를 잠시 끄고 어제로 돌린다
    await db.exec(`set session_replication_role = replica`);
    await db.query(`update public.expenses set created_at = now() - interval '2 days' where id = $1`, [id]);
    await db.exec(`set session_replication_role = default`);
    await expect(asUser(db, MGR1, (tx) => tx.query(`select public.cancel_delivery($1)`, [id]))).rejects.toThrow(/본인이 오늘/);
  });

  it("취소가 변경 이력에 삭제로 남는다", async () => {
    const id = (await record(MGR1)).rows[0].id;
    await asUser(db, MGR1, (tx) => tx.query(`select public.cancel_delivery($1)`, [id]));
    const r = await db.query<{ actor_id: string }>(
      `select actor_id from public.audit_logs where table_name = 'expenses' and action = 'DELETE' and record_id = $1`,
      [id],
    );
    expect(r.rows[0].actor_id).toBe(MGR1);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000e1";
const MGR1 = "00000000-0000-4000-8000-0000000000e2";
const STAFF1 = "00000000-0000-4000-8000-0000000000e3";
const STAFF2 = "00000000-0000-4000-8000-0000000000e4";

let db: PGlite;
let s1: string;
let s2: string;
let today: string;
const vendor: Record<string, string> = {};

type Entry = { vendor_id: string; amount: number | string };
type SheetRow = { vendor_name: string; amount: number | null; has_lines: boolean; entered_by: string | null; on_credit: boolean };

const save = (uid: string, store: string, date: string, entries: Entry[] | unknown) =>
  asUser(db, uid, async (tx) => {
    const r = await tx.query<{ n: number }>(`select public.save_slips($1, $2::date, $3::jsonb) as n`, [store, date, JSON.stringify(entries)]);
    return r.rows[0].n;
  });

const sheet = (uid: string, store: string, date: string) =>
  asUser(db, uid, async (tx) => {
    const r = await tx.query<SheetRow>(
      `select vendor_name, amount::int as amount, has_lines, entered_by, on_credit from public.slip_sheet($1, $2::date)`,
      [store, date],
    );
    return r.rows;
  });

/** 관리자(superuser)로 본 전표 지출 */
const slips = async (store: string) =>
  (
    await db.query<{ id: string; vendor: string; amount: number; on_credit: boolean; description: string; created_by: string; updated_by: string; category: string }>(
      `select e.id, e.vendor, e.amount::int as amount, e.on_credit, e.description, e.created_by, e.updated_by, c.code as category
       from public.expenses e join public.expense_categories c on c.id = e.category_id
       where e.store_id = $1 and e.is_slip order by e.vendor`,
      [store],
    )
  ).rows;

const daysAgo = async (n: number) => (await db.query<{ d: string }>(`select (app.seoul_today() - $1::int)::text as d`, [n])).rows[0].d;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF1, name: "1호점직원", role: "staff", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF2, name: "2호점직원", role: "staff", storeCodes: ["S2"] });
  s1 = await storeId(db, "S1");
  s2 = await storeId(db, "S2");
  today = await daysAgo(0);
  for (const r of (await db.query<{ id: string; name: string }>(`select id, name from public.vendors`)).rows) vendor[r.name] = r.id;
}, 60_000);

describe("전표 입력 (거래처별 하루 총금액)", () => {
  it("직원도 자기 지점 전표를 적으면 외상 지출 1건, 다시 적으면 고쳐지고 0 이면 지워진다", async () => {
    expect(await save(STAFF1, s1, today, [{ vendor_id: vendor["엠앤아이"], amount: 75000 }])).toBe(1);
    let rows = await slips(s1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendor: "엠앤아이", amount: 75000, on_credit: true, description: "전표 총금액", created_by: STAFF1, category: "food" });

    // 점장이 고침 → 같은 1건, 고친 사람 기록
    expect(await save(MGR1, s1, today, [{ vendor_id: vendor["엠앤아이"], amount: "80000" }])).toBe(1);
    rows = await slips(s1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 80000, created_by: STAFF1, updated_by: MGR1 });

    // 같은 금액이면 바뀐 것 없음
    expect(await save(STAFF1, s1, today, [{ vendor_id: vendor["엠앤아이"], amount: 80000 }])).toBe(0);

    // 0 → 지움 (변경 이력에는 남는다)
    expect(await save(STAFF1, s1, today, [{ vendor_id: vendor["엠앤아이"], amount: 0 }])).toBe(1);
    expect(await slips(s1)).toHaveLength(0);
    const audit = await db.query<{ n: number }>(
      `select count(*)::int n from public.audit_logs where table_name = 'expenses' and action = 'DELETE'`,
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it("여러 거래처를 한 번에 저장, 거래처 기본 항목(소모품비 등)을 따른다", async () => {
    await db.query(
      `update public.vendors set default_category_id = (select id from public.expense_categories where code <> 'food' and section = 'opex' order by sort_order limit 1)
       where name = '참사랑마트'`,
    );
    expect(
      await save(STAFF2, s2, today, [
        { vendor_id: vendor["경희상회"], amount: 120000 },
        { vendor_id: vendor["참사랑마트"], amount: 33000 },
        { vendor_id: vendor["엠앤아이"], amount: 0 },
      ]),
    ).toBe(2);
    const rows = await slips(s2);
    expect(rows.map((r) => [r.vendor, r.amount, r.category === "food"])).toEqual([
      ["경희상회", 120000, true],
      ["참사랑마트", 33000, false],
    ]);
  });

  it("다른 지점·거래 안 하는 거래처·미래·8일 전(대표 외)·잘못된 금액은 막는다", async () => {
    const m = vendor["엠앤아이"];
    await expect(save(STAFF2, s1, today, [{ vendor_id: m, amount: 1000 }])).rejects.toThrow(/권한이 없습니다/);
    await expect(save(STAFF1, s1, today, [{ vendor_id: vendor["피플블라썸"], amount: 1000 }])).rejects.toThrow(/거래하는 거래처가 아닙니다/);
    await expect(save(STAFF1, s1, await daysAgo(-1), [{ vendor_id: m, amount: 1000 }])).rejects.toThrow(/미래 날짜/);
    await expect(save(MGR1, s1, await daysAgo(8), [{ vendor_id: m, amount: 1000 }])).rejects.toThrow(/7일보다 지난/);
    expect(await save(MGR1, s1, await daysAgo(7), [{ vendor_id: m, amount: 1000 }])).toBe(1);
    expect(await save(OWNER, s1, await daysAgo(40), [{ vendor_id: m, amount: 2000 }])).toBe(1);
    for (const amount of [-5, "abc", 1.5, "10000000000"]) {
      await expect(save(STAFF1, s1, today, [{ vendor_id: m, amount }])).rejects.toThrow(/금액은 0원부터/);
    }
    await expect(
      save(STAFF1, s1, today, [
        { vendor_id: m, amount: 1 },
        { vendor_id: m, amount: 2 },
      ]),
    ).rejects.toThrow(/두 번/);
    await expect(save(STAFF1, s1, today, [])).rejects.toThrow(/저장할 금액이 없습니다/);
    await expect(save(STAFF1, s1, today, { vendor_id: m, amount: 1 })).rejects.toThrow(/저장할 금액이 없습니다/);
    // 막힌 시도는 아무것도 남기지 않음 (위에서 일부러 넣은 7일 전·40일 전 2건만)
    expect((await slips(s1)).map((r) => r.amount).sort()).toEqual([1000, 2000]);
  });

  it("전표 칸: 지점 거래처 + 적힌 금액·적은 사람, 다른 지점은 못 본다", async () => {
    await save(STAFF1, s1, today, [{ vendor_id: vendor["씨앤푸드"], amount: 50000 }]);
    const rows = await sheet(STAFF1, s1, today);
    const names = rows.map((r) => r.vendor_name);
    expect(names).toContain("엠앤아이");
    expect(names).not.toContain("피플블라썸"); // 1호점과 거래 안 함
    expect(rows.find((r) => r.vendor_name === "씨앤푸드")).toMatchObject({ amount: 50000, entered_by: "1호점직원", on_credit: true, has_lines: false });
    expect(rows.find((r) => r.vendor_name === "엠앤아이")).toMatchObject({ amount: null, entered_by: null });
    await expect(sheet(STAFF2, s1, today)).rejects.toThrow(/권한이 없습니다/);

    // 거래를 끊은(사용 중지) 거래처라도 그 날 적힌 전표는 보인다
    await db.query(`update public.vendors set is_active = false where name = '씨앤푸드'`);
    expect((await sheet(STAFF1, s1, today)).map((r) => r.vendor_name)).toContain("씨앤푸드");
    expect((await sheet(STAFF1, s1, await daysAgo(1))).map((r) => r.vendor_name)).not.toContain("씨앤푸드");
    await db.query(`update public.vendors set is_active = true where name = '씨앤푸드'`);
  });

  it("품목 상세가 붙은 전표(대표가 지출 입력에서 줄 추가)는 여기서 금액을 못 바꾼다", async () => {
    await save(STAFF1, s1, today, [{ vendor_id: vendor["투웰브"], amount: 64000 }]);
    const id = (await slips(s1)).find((r) => r.vendor === "투웰브")!.id;
    const e = (
      await db.query<Record<string, unknown>>(
        `select id, store_id, expense_date::text as expense_date, category_id, vendor, vendor_id, description, basis, on_credit
         from public.expenses where id = $1`,
        [id],
      )
    ).rows[0];
    await asUser(db, OWNER, (tx) =>
      tx.query(`select public.save_expense_with_lines($1::jsonb, $2::jsonb)`, [
        JSON.stringify({ ...e, amount: 64000 }),
        JSON.stringify([{ item_name: "쌀면", quantity: 2, unit: "박스", unit_price: 32000, amount: 64000 }]),
      ]),
    );
    expect((await sheet(STAFF1, s1, today)).find((r) => r.vendor_name === "투웰브")).toMatchObject({ amount: 64000, has_lines: true });
    await expect(save(STAFF1, s1, today, [{ vendor_id: vendor["투웰브"], amount: 70000 }])).rejects.toThrow(/품목 상세/);
    await expect(save(STAFF1, s1, today, [{ vendor_id: vendor["투웰브"], amount: 0 }])).rejects.toThrow(/품목 상세/);
    expect(await save(STAFF1, s1, today, [{ vendor_id: vendor["투웰브"], amount: 64000 }])).toBe(0);
    // 대표가 지출 입력에서 고쳐도 전표 표시는 그 금액을 따른다 (한 곳에만 저장)
    expect((await slips(s1)).find((r) => r.vendor === "투웰브")?.amount).toBe(64000);
  });

  it("최근 2주 날짜별 합계 (지난 기록)", async () => {
    const days = await asUser(db, STAFF1, async (tx) =>
      (await tx.query<{ slip_date: string; total: number; vendors: number }>(
        `select slip_date::text, total::int as total, vendors from public.slip_days($1)`,
        [s1],
      )).rows,
    );
    expect(days[0]).toEqual({ slip_date: today, total: 50000 + 64000, vendors: 2 });
    expect(days.map((d) => d.slip_date)).toContain(await daysAgo(7));
    expect(days.map((d) => d.slip_date)).not.toContain(await daysAgo(40)); // 2주 넘은 것은 목록에 없음
  });

  it("직원은 지출 표를 직접 못 본다 (전표는 함수로만), 비로그인은 함수 실행 불가", async () => {
    const seen = await asUser(db, STAFF1, async (tx) => (await tx.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n);
    expect(seen).toBe(0);
    await expect(
      asUser(db, null, (tx) => tx.query(`select * from public.slip_sheet($1, $2::date)`, [s1, today]), "anon"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, null, (tx) => tx.query(`select public.save_slips($1, $2::date, '[]'::jsonb)`, [s1, today]), "anon"),
    ).rejects.toThrow(/permission denied/);
  });
});

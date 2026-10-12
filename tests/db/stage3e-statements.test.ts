import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000f1";
const HQ = "00000000-0000-4000-8000-0000000000f2";
const MGR1 = "00000000-0000-4000-8000-0000000000f3";
const MGR2 = "00000000-0000-4000-8000-0000000000f4";
const STAFF1 = "00000000-0000-4000-8000-0000000000f5";

let db: PGlite;
let s1: string;
let s2: string;
let vendor: string; // 엠앤아이 (외상 거래처)
let today: string;

const photo = (store: string) => `${store}/2026-10/${randomUUID()}.jpg`;

async function upload(uid: string, name: string) {
  return asUser(db, uid, (tx) =>
    tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('statements', $1, $2)`, [name, uid]),
  );
}

async function newStatement(uid: string, store = s1, extra = "") {
  const path = photo(store);
  const r = await asUser(db, uid, (tx) =>
    tx.query<{ id: string; status: string }>(
      `insert into public.purchase_statements (store_id, vendor_id, photo_path, photo_bytes${extra ? ", status, ai_result, ai_attempts" : ""})
       values ($1, $2, $3, 200000${extra})
       returning id, status`,
      [store, vendor, path],
    ),
  );
  return r.rows[0];
}

const rpc = <T = Record<string, unknown>>(uid: string, sql: string, params: unknown[]) =>
  asUser(db, uid, (tx) => tx.query<T>(sql, params));

const lines = (over: Record<string, unknown>[] = []) =>
  JSON.stringify(
    over.length
      ? over
      : [
          { item_name: "차돌양지", quantity: 10, unit: "kg", unit_price: 32000, amount: 320000 },
          { item_name: "숙주", quantity: "2", unit: "박스", unit_price: "15000", amount: "30000" },
        ],
  );

const confirm = (uid: string, id: string, opts: { date?: string; lines?: string; onCredit?: boolean | null } = {}) =>
  rpc<{ expense_id: string }>(
    uid,
    `select public.confirm_purchase_statement($1, $2::date, $3::jsonb, $4, 350000, 1200000, '테스트') as expense_id`,
    [id, opts.date ?? today, opts.lines ?? lines(), opts.onCredit ?? null],
  );

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
  today = (await db.query<{ d: string }>(`select app.seoul_today()::text d`)).rows[0].d;
}, 60_000);

describe("사진 보관함 (statements 버킷)", () => {
  it("비공개 버킷이 만들어진다 (5MB, JPEG)", async () => {
    const r = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'statements'`,
    );
    expect({ ...r.rows[0], file_size_limit: Number(r.rows[0].file_size_limit) }).toEqual({
      public: false,
      file_size_limit: 5242880,
      allowed_mime_types: ["image/jpeg"],
    });
  });

  it("지점 관리자는 자기 지점 폴더에만 올릴 수 있다", async () => {
    await upload(MGR1, photo(s1));
    await expect(upload(MGR1, photo(s2))).rejects.toThrow(/row-level security/);
    await expect(upload(MGR1, `${s1}/아무거나.png`)).rejects.toThrow(/row-level security/);
    await expect(upload(STAFF1, photo(s1))).rejects.toThrow(/row-level security/);
    await expect(upload(HQ, photo(s2))).rejects.toThrow(/row-level security/);
    await upload(OWNER, photo(s2));
  });

  it("사진은 그 지점 관리자·대표만 본다, 고치거나 지울 수 없다", async () => {
    const seen = async (uid: string) =>
      (await asUser(db, uid, (tx) => tx.query<{ name: string }>(`select name from storage.objects`))).rows.map((r) => r.name);
    expect((await seen(MGR1)).every((n) => n.startsWith(s1))).toBe(true);
    expect((await seen(MGR1)).length).toBeGreaterThan(0);
    expect((await seen(MGR2)).every((n) => n.startsWith(s2))).toBe(true);
    expect(await seen(STAFF1)).toHaveLength(0);
    expect((await seen(OWNER)).length).toBeGreaterThanOrEqual(2);

    for (const uid of [MGR1, OWNER]) {
      const u = await asUser(db, uid, (tx) => tx.query(`update storage.objects set name = name || 'x'`));
      expect(u.affectedRows).toBe(0);
      const d = await asUser(db, uid, (tx) => tx.query(`delete from storage.objects`));
      expect(d.affectedRows).toBe(0);
    }
  });
});

describe("거래명세표 올리기", () => {
  it("지점 관리자가 올리면 항상 '올림' 상태로 시작한다 (확정·AI 결과를 직접 넣을 수 없음)", async () => {
    const s = await newStatement(MGR1, s1, ", 'confirmed', '{\"lines\":[]}'::jsonb, 3");
    expect(s.status).toBe("uploaded");
    const r = await db.query<{ ai_result: unknown; ai_attempts: number; created_by: string }>(
      `select ai_result, ai_attempts, created_by from public.purchase_statements where id = $1`,
      [s.id],
    );
    expect(r.rows[0]).toEqual({ ai_result: null, ai_attempts: 0, created_by: MGR1 });
  });

  it("다른 지점·직원은 올릴 수 없고, 사진 경로는 그 지점 폴더여야 한다", async () => {
    await expect(newStatement(MGR1, s2)).rejects.toThrow(/row-level security/);
    await expect(newStatement(STAFF1, s1)).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, MGR1, (tx) =>
        tx.query(
          `insert into public.purchase_statements (store_id, vendor_id, photo_path, photo_bytes) values ($1, $2, $3, 1000)`,
          [s1, vendor, photo(s2)],
        ),
      ),
    ).rejects.toThrow(/purchase_statements_photo_path_check/);
  });

  it("거래 중이 아닌 거래처는 고를 수 없다", async () => {
    await db.query(`update public.vendors set is_active = false where id = $1`, [vendor]);
    await expect(newStatement(OWNER)).rejects.toThrow(/거래 중인 거래처가 아닙니다/);
    await db.query(`update public.vendors set is_active = true where id = $1`, [vendor]);
  });

  it("직접 고치기·지우기는 누구도 못 한다 (상태 변경은 함수로만)", async () => {
    const s = await newStatement(MGR1);
    for (const uid of [MGR1, OWNER]) {
      await expect(
        asUser(db, uid, (tx) => tx.query(`update public.purchase_statements set status = 'confirmed' where id = $1`, [s.id])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asUser(db, uid, (tx) => tx.query(`delete from public.purchase_statements where id = $1`, [s.id])),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("조회: 소속 지점만 (본사 관리자 포함), 직원 불가", async () => {
    await newStatement(MGR2, s2);
    const stores = async (uid: string) =>
      (await asUser(db, uid, (tx) => tx.query<{ store_id: string }>(`select store_id from public.purchase_statements`))).rows;
    expect((await stores(MGR1)).every((r) => r.store_id === s1)).toBe(true);
    expect((await stores(HQ)).every((r) => r.store_id === s1)).toBe(true);
    expect((await stores(MGR2)).every((r) => r.store_id === s2)).toBe(true);
    expect(await stores(STAFF1)).toHaveLength(0);
    expect((await stores(OWNER)).some((r) => r.store_id === s2)).toBe(true);
  });
});

describe("AI 읽기 기록", () => {
  const begin = (uid: string, id: string) =>
    rpc<{ r: { photo_path: string; vendor_name: string; attempt: number } }>(uid, `select public.begin_statement_ai($1) as r`, [id]);
  const finish = (uid: string, id: string, ok: boolean, result: unknown, error: string | null = null) =>
    rpc(uid, `select public.finish_statement_ai($1, $2, $3::jsonb, 'claude-opus-5-5', '{"input_tokens":10}'::jsonb, $4)`, [
      id,
      ok,
      result === null ? null : JSON.stringify(result),
      error,
    ]);
  const row = async (id: string) =>
    (
      await db.query<{ status: string; ai_attempts: number; ai_result: { total?: number } | null; ai_error: string | null }>(
        `select status, ai_attempts, ai_result, ai_error from public.purchase_statements where id = $1`,
        [id],
      )
    ).rows[0];

  it("시작하면 횟수가 늘고 사진 경로·거래처 이름을 돌려준다", async () => {
    const s = await newStatement(MGR1);
    const r = await begin(MGR1, s.id);
    expect(r.rows[0].r.vendor_name).toBe("엠앤아이");
    expect(r.rows[0].r.photo_path.startsWith(`${s1}/`)).toBe(true);
    expect(r.rows[0].r.attempt).toBe(1);
    expect((await row(s.id)).ai_attempts).toBe(1);
  });

  it("성공 → '읽음' + 결과 저장, 다음 시도가 실패해도 앞의 결과는 남는다", async () => {
    const s = await newStatement(MGR1);
    await begin(MGR1, s.id);
    await finish(MGR1, s.id, true, { total: 350000, lines: [] });
    expect(await row(s.id)).toMatchObject({ status: "read", ai_result: { total: 350000 }, ai_error: null });
    await begin(MGR1, s.id);
    await finish(MGR1, s.id, false, null, "시간 초과");
    expect(await row(s.id)).toMatchObject({ status: "read", ai_result: { total: 350000 }, ai_error: "시간 초과" });
  });

  it("처음부터 실패하면 '실패' (직접 적기)", async () => {
    const s = await newStatement(MGR1);
    await begin(MGR1, s.id);
    await finish(MGR1, s.id, false, null, "흐린 사진");
    expect(await row(s.id)).toMatchObject({ status: "failed", ai_error: "흐린 사진" });
  });

  it("한 장에 3번까지만", async () => {
    const s = await newStatement(MGR1);
    for (let i = 0; i < 3; i++) await begin(MGR1, s.id);
    await expect(begin(MGR1, s.id)).rejects.toThrow(/3번까지/);
  });

  it("지점당 하루 50장까지 (이미 오늘 읽은 장은 다시 읽기 가능)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await newStatement(MGR2, s2)).id);
    await db.query(`update public.purchase_statements set ai_read_at = now(), ai_attempts = 1 where id = any($1::uuid[])`, [ids]);
    const extra = await newStatement(MGR2, s2);
    await expect(begin(MGR2, extra.id)).rejects.toThrow(/50장/);
    await begin(MGR2, ids[0]); // 오늘 이미 읽은 장의 재시도는 허용
    // 다른 지점은 영향 없음
    await begin(MGR1, (await newStatement(MGR1)).id);
  });

  it("시작하지 않고 결과만 넣거나, 다른 지점 것을 읽을 수 없다", async () => {
    const s = await newStatement(MGR1);
    await expect(finish(MGR1, s.id, true, { lines: [] })).rejects.toThrow(/시작하지 않았습니다/);
    await expect(begin(MGR2, s.id)).rejects.toThrow(/권한이 없습니다/);
    await expect(begin(STAFF1, s.id)).rejects.toThrow(/권한이 없습니다/);
  });
});

describe("확인 후 확정", () => {
  it("지점 관리자가 확정하면 식재료 지출(외상) + 품목 줄이 생긴다", async () => {
    const s = await newStatement(MGR1);
    const r = await confirm(MGR1, s.id);
    const expenseId = r.rows[0].expense_id;
    expect(expenseId).toBeTruthy();

    const e = await db.query<{
      amount: number;
      on_credit: boolean;
      vendor: string;
      vendor_id: string;
      created_by: string;
      code: string;
      description: string;
    }>(
      `select e.amount::int, e.on_credit, e.vendor, e.vendor_id, e.created_by, c.code, e.description
       from public.expenses e join public.expense_categories c on c.id = e.category_id where e.id = $1`,
      [expenseId],
    );
    expect(e.rows[0]).toMatchObject({
      amount: 350000,
      on_credit: true, // 거래처 기본값(외상)
      vendor: "엠앤아이",
      vendor_id: vendor,
      created_by: MGR1,
      code: "food",
    });
    expect(e.rows[0].description).toContain("거래명세표 사진");

    const l = await db.query<{ line_no: number; item_name: string; quantity: string; amount: string }>(
      `select line_no, item_name, quantity, amount from public.expense_lines where expense_id = $1 order by line_no`,
      [expenseId],
    );
    expect(l.rows.map((x) => [x.line_no, x.item_name, Number(x.quantity), Number(x.amount)])).toEqual([
      [1, "차돌양지", 10, 320000],
      [2, "숙주", 2, 30000],
    ]);

    const st = await db.query<{ status: string; expense_id: string; confirmed_by: string; statement_balance: number }>(
      `select status, expense_id, confirmed_by, statement_balance::int from public.purchase_statements where id = $1`,
      [s.id],
    );
    expect(st.rows[0]).toMatchObject({ status: "confirmed", expense_id: expenseId, confirmed_by: MGR1, statement_balance: 1200000 });
  });

  it("확정해도 지점 관리자는 지출 표를 볼 수 없다 (대표·본사 관리자는 보임)", async () => {
    const mine = await asUser(db, MGR1, (tx) => tx.query(`select * from public.expenses`));
    expect(mine.rows).toHaveLength(0);
    const owner = await asUser(db, OWNER, (tx) => tx.query(`select * from public.expenses`));
    expect(owner.rows.length).toBeGreaterThan(0);
    const hq = await asUser(db, HQ, (tx) => tx.query(`select * from public.expenses`));
    expect(hq.rows.length).toBeGreaterThan(0);
  });

  it("외상 여부는 확인 화면에서 바꿀 수 있다", async () => {
    const s = await newStatement(MGR1);
    const r = await confirm(MGR1, s.id, { onCredit: false });
    const e = await db.query<{ on_credit: boolean }>(`select on_credit from public.expenses where id = $1`, [r.rows[0].expense_id]);
    expect(e.rows[0].on_credit).toBe(false);
  });

  it("두 번 확정할 수 없다", async () => {
    const s = await newStatement(MGR1);
    await confirm(MGR1, s.id);
    await expect(confirm(MGR1, s.id)).rejects.toThrow(/이미 처리된/);
  });

  it("빈 품목·0 수량·숫자 아닌 값은 거부하고 아무것도 만들지 않는다", async () => {
    const s = await newStatement(MGR1);
    const before = (await db.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n;
    const bad = [
      [{ item_name: " ", quantity: 1, unit: "kg", unit_price: 1000, amount: 1000 }],
      [{ item_name: "숙주", quantity: 0, unit: "kg", unit_price: 1000, amount: 1000 }],
      [{ item_name: "숙주", quantity: "abc", unit: "kg", unit_price: 1000, amount: 1000 }],
      [{ item_name: "숙주", quantity: 1, unit: "kg", unit_price: -5, amount: 1000 }],
      [{ item_name: "숙주", quantity: 1.2345, unit: "kg", unit_price: 1000, amount: 1000 }],
      [{ item_name: "숙주", quantity: 1, unit: "kg", unit_price: 0, amount: 0 }],
    ];
    for (const b of bad) {
      await expect(confirm(MGR1, s.id, { lines: lines(b) })).rejects.toThrow(/품목|합계/);
    }
    await expect(confirm(MGR1, s.id, { lines: "[]" })).rejects.toThrow(/1~50줄/);
    const after = (await db.query<{ n: number }>(`select count(*)::int n from public.expenses`)).rows[0].n;
    expect(after).toBe(before);
  });

  it("미래 날짜 거부, 31일 넘은 것은 대표만", async () => {
    const s = await newStatement(MGR1);
    const d = (n: number) => db.query<{ d: string }>(`select (app.seoul_today() + $1::int)::text d`, [n]).then((r) => r.rows[0].d);
    await expect(confirm(MGR1, s.id, { date: await d(1) })).rejects.toThrow(/미래 날짜/);
    await expect(confirm(MGR1, s.id, { date: await d(-40) })).rejects.toThrow(/대표만/);
    await confirm(OWNER, s.id, { date: await d(-40) });
  });

  it("다른 지점 관리자·직원은 확정할 수 없다", async () => {
    const s = await newStatement(MGR1);
    await expect(confirm(MGR2, s.id)).rejects.toThrow(/권한이 없습니다/);
    await expect(confirm(STAFF1, s.id)).rejects.toThrow(/권한이 없습니다/);
  });

  it("버리기: 확정 전만 가능, 버린 것은 다시 확정 못 함", async () => {
    const s = await newStatement(MGR1);
    await rpc(MGR1, `select public.discard_purchase_statement($1, '잘못 찍음')`, [s.id]);
    const r = await db.query<{ status: string; memo: string }>(`select status, memo from public.purchase_statements where id = $1`, [s.id]);
    expect(r.rows[0]).toEqual({ status: "discarded", memo: "잘못 찍음" });
    await expect(confirm(MGR1, s.id)).rejects.toThrow(/이미 처리된/);

    const done = await newStatement(MGR1);
    await confirm(MGR1, done.id);
    await expect(rpc(MGR1, `select public.discard_purchase_statement($1, null)`, [done.id])).rejects.toThrow(/버릴 수 없습니다/);
  });

  it("확정 기록이 변경 이력에 남는다 (누가 했는지)", async () => {
    const s = await newStatement(MGR1);
    await confirm(MGR1, s.id);
    const r = await db.query<{ actor_id: string; table_name: string }>(
      `select actor_id, table_name from public.audit_logs
       where record_id = $1 and action = 'UPDATE' order by id desc limit 1`,
      [s.id],
    );
    expect(r.rows[0]).toEqual({ actor_id: MGR1, table_name: "purchase_statements" });
  });
});

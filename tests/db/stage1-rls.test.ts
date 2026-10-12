import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-000000000001";
const HQ = "00000000-0000-4000-8000-000000000002";
const MGR1 = "00000000-0000-4000-8000-000000000003";
const STAFF1 = "00000000-0000-4000-8000-000000000004";
const STAFF2 = "00000000-0000-4000-8000-000000000005";
const INACTIVE = "00000000-0000-4000-8000-000000000006";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: HQ, name: "본사", role: "hq_manager", storeCodes: ["S1", "S2"] });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF1, name: "1호점직원", role: "staff", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF2, name: "2호점직원", role: "staff", storeCodes: ["S2"] });
  await createUser(db, {
    id: INACTIVE,
    name: "퇴사자",
    role: "store_manager",
    active: false,
    storeCodes: ["S1"],
  });
}, 60_000);

const codes = (rows: { code: string }[]) => rows.map((r) => r.code).sort();

describe("초기 지점 마스터", () => {
  it("3개 지점이 생성되고, 미확인 정보는 NULL 이다", async () => {
    const r = await db.query<{ code: string; address: string | null; seat_count: number | null }>(
      `select code, address, seat_count from public.stores order by code`,
    );
    expect(r.rows.map((s) => s.code)).toEqual(["S1", "S2", "S3"]);
    expect(r.rows.every((s) => s.address === null)).toBe(true);
    expect(r.rows.find((s) => s.code === "S1")?.seat_count).toBe(9);
    expect(r.rows.find((s) => s.code === "S2")?.seat_count).toBeNull();
  });
});

describe("지점 접근 제한 (RLS)", () => {
  it("비로그인(anon)은 지점 테이블에 접근할 수 없다", async () => {
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.stores`), "anon")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("대표는 모든 지점을 본다", async () => {
    const r = await asUser(db, OWNER, (tx) => tx.query<{ code: string }>(`select code from public.stores`));
    expect(codes(r.rows)).toEqual(["S1", "S2", "S3"]);
  });

  it("본사 관리자는 승인(소속)된 지점만 본다", async () => {
    const r = await asUser(db, HQ, (tx) => tx.query<{ code: string }>(`select code from public.stores`));
    expect(codes(r.rows)).toEqual(["S1", "S2"]);
  });

  it("지점 관리자·직원은 담당 지점만 본다", async () => {
    const m = await asUser(db, MGR1, (tx) => tx.query<{ code: string }>(`select code from public.stores`));
    expect(codes(m.rows)).toEqual(["S1"]);
    const s = await asUser(db, STAFF2, (tx) => tx.query<{ code: string }>(`select code from public.stores`));
    expect(codes(s.rows)).toEqual(["S2"]);
  });

  it("비활성(승인 대기·퇴사) 사용자는 소속이 있어도 아무것도 못 본다", async () => {
    const r = await asUser(db, INACTIVE, (tx) => tx.query(`select * from public.stores`));
    expect(r.rows).toHaveLength(0);
  });

  it("재무 조회 권한: 직원 불가, 관리자는 담당 지점만", async () => {
    const s1 = await storeId(db, "S1");
    const s2 = await storeId(db, "S2");
    const q = (uid: string, sid: string) =>
      asUser(db, uid, (tx) =>
        tx.query<{ ok: boolean }>(`select app.can_view_store_financials($1) as ok`, [sid]),
      ).then((r) => r.rows[0].ok);
    expect(await q(STAFF1, s1)).toBe(false);
    expect(await q(MGR1, s1)).toBe(true);
    expect(await q(MGR1, s2)).toBe(false);
    expect(await q(HQ, s2)).toBe(true);
    expect(await q(OWNER, s2)).toBe(true);
  });
});

describe("프로필 조회 범위", () => {
  it("지점 관리자는 같은 지점 직원만 본다 (타 지점 직원 X)", async () => {
    const r = await asUser(db, MGR1, (tx) =>
      tx.query<{ id: string }>(`select id from public.profiles`),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(STAFF1);
    expect(ids).not.toContain(STAFF2);
  });

  it("직원은 본인 프로필만 본다", async () => {
    const r = await asUser(db, STAFF1, (tx) => tx.query<{ id: string }>(`select id from public.profiles`));
    expect(r.rows.map((x) => x.id)).toEqual([STAFF1]);
  });
});

describe("권한 상승 방지", () => {
  it("직원은 자기 역할을 owner 로 바꿀 수 없다", async () => {
    await expect(
      asUser(db, STAFF1, (tx) => tx.query(`update public.profiles set role = 'owner' where id = $1`, [STAFF1])),
    ).rejects.toThrow(/권한이 없습니다/);
  });

  it("직원은 자기 이름은 바꿀 수 있다", async () => {
    await asUser(db, STAFF1, (tx) =>
      tx.query(`update public.profiles set full_name = '직원A' where id = $1`, [STAFF1]),
    );
    const r = await db.query<{ full_name: string }>(`select full_name from public.profiles where id = $1`, [
      STAFF1,
    ]);
    expect(r.rows[0].full_name).toBe("직원A");
  });

  it("직원은 다른 사람 프로필을 수정할 수 없다 (0행)", async () => {
    const r = await asUser(db, STAFF1, (tx) =>
      tx.query(`update public.profiles set full_name = 'x' where id = $1`, [STAFF2]),
    );
    expect(r.affectedRows).toBe(0);
  });

  it("지점 관리자는 지점 정보 수정·소속 추가를 할 수 없다", async () => {
    const r = await asUser(db, MGR1, (tx) => tx.query(`update public.stores set name = '해킹' where code = 'S1'`));
    expect(r.affectedRows).toBe(0);
    const s2 = await storeId(db, "S2");
    await expect(
      asUser(db, MGR1, (tx) =>
        tx.query(`insert into public.store_members (user_id, store_id) values ($1, $2)`, [MGR1, s2]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("회원가입 메타데이터에 role=owner 를 넣어도 staff·비활성으로 생성된다", async () => {
    const id = "00000000-0000-4000-8000-0000000000ff";
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      "evil@example.test",
      JSON.stringify({ full_name: "공격자", role: "owner" }),
    ]);
    const r = await db.query<{ role: string; is_active: boolean }>(
      `select role, is_active from public.profiles where id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ role: "staff", is_active: false });
  });

  it("마지막 대표는 강등할 수 없다", async () => {
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`update public.profiles set role = 'staff' where id = $1`, [OWNER])),
    ).rejects.toThrow(/마지막 대표/);
  });

  it("대표는 다른 사용자의 역할을 바꿀 수 있다", async () => {
    await asUser(db, OWNER, async (tx) => {
      await tx.query(`update public.profiles set role = 'store_manager' where id = $1`, [STAFF2]);
      await tx.query(`update public.profiles set role = 'staff' where id = $1`, [STAFF2]);
    });
  });
});

describe("이름 아이디 · 첫 비밀번호 변경 (1단계 보완)", () => {
  it("한글 이름 아이디를 저장할 수 있다", async () => {
    await asUser(db, OWNER, (tx) =>
      tx.query(`update public.profiles set login_id = '김민수2' where id = $1`, [STAFF2]),
    );
    const r = await db.query<{ login_id: string }>(`select login_id from public.profiles where id = $1`, [STAFF2]);
    expect(r.rows[0].login_id).toBe("김민수2");
  });

  it("공백·특수문자가 있는 아이디는 거부된다", async () => {
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`update public.profiles set login_id = '김 민수' where id = $1`, [STAFF2])),
    ).rejects.toThrow(/profiles_login_id_check/);
  });

  it("대표는 비밀번호 변경요구를 설정할 수 있다", async () => {
    await asUser(db, OWNER, (tx) =>
      tx.query(`update public.profiles set must_change_password = true where id = $1`, [STAFF1]),
    );
    const r = await db.query<{ v: boolean }>(`select must_change_password v from public.profiles where id = $1`, [
      STAFF1,
    ]);
    expect(r.rows[0].v).toBe(true);
  });

  it("직원은 본인의 비밀번호 변경요구를 스스로 해제할 수 없다", async () => {
    await expect(
      asUser(db, STAFF1, (tx) =>
        tx.query(`update public.profiles set must_change_password = false where id = $1`, [STAFF1]),
      ),
    ).rejects.toThrow(/권한이 없습니다/);
  });

  it("서버(service_role)는 해제할 수 있다", async () => {
    await asUser(
      db,
      null,
      (tx) => tx.query(`update public.profiles set must_change_password = false where id = $1`, [STAFF1]),
      "service_role",
    );
    const r = await db.query<{ v: boolean }>(`select must_change_password v from public.profiles where id = $1`, [
      STAFF1,
    ]);
    expect(r.rows[0].v).toBe(false);
  });
});

describe("소속 지점 일괄 변경 (set_store_memberships)", () => {
  it("대표는 소속을 교체할 수 있고 결과가 정확하다", async () => {
    const s2 = await storeId(db, "S2");
    const s3 = await storeId(db, "S3");
    await asUser(db, OWNER, (tx) => tx.query(`select public.set_store_memberships($1, $2)`, [HQ, [s2, s3]]));
    const r = await asUser(db, HQ, (tx) => tx.query<{ code: string }>(`select code from public.stores`));
    expect(codes(r.rows)).toEqual(["S2", "S3"]);
    // 원상복구
    const s1 = await storeId(db, "S1");
    await asUser(db, OWNER, (tx) => tx.query(`select public.set_store_memberships($1, $2)`, [HQ, [s1, s2]]));
  });

  it("대표가 아니면 거부된다", async () => {
    const s3 = await storeId(db, "S3");
    await expect(
      asUser(db, HQ, (tx) => tx.query(`select public.set_store_memberships($1, $2)`, [HQ, [s3]])),
    ).rejects.toThrow(/권한이 없습니다/);
  });

  it("비로그인(anon)은 함수를 실행할 수 없다", async () => {
    await expect(
      asUser(db, null, (tx) => tx.query(`select public.set_store_memberships($1, $2)`, [HQ, []]), "anon"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("감사 로그", () => {
  it("지점 정보 변경이 수행자와 함께 기록된다", async () => {
    await asUser(db, OWNER, (tx) => tx.query(`update public.stores set address = '테스트주소' where code = 'S3'`));
    const r = await db.query<{ actor_id: string; actor_role: string; old_data: { address: null }; new_data: { address: string } }>(
      `select actor_id, actor_role, old_data, new_data from public.audit_logs
       where table_name = 'stores' and action = 'UPDATE' order by id desc limit 1`,
    );
    expect(r.rows[0].actor_id).toBe(OWNER);
    expect(r.rows[0].actor_role).toBe("authenticated");
    expect(r.rows[0].old_data.address).toBeNull();
    expect(r.rows[0].new_data.address).toBe("테스트주소");
  });

  it("대표 외에는 감사 로그를 볼 수 없다", async () => {
    const r = await asUser(db, HQ, (tx) => tx.query(`select * from public.audit_logs`));
    expect(r.rows).toHaveLength(0);
    const o = await asUser(db, OWNER, (tx) => tx.query(`select * from public.audit_logs`));
    expect(o.rows.length).toBeGreaterThan(0);
  });

  it("대표라도 감사 로그를 수정·삭제할 수 없다", async () => {
    await expect(asUser(db, OWNER, (tx) => tx.query(`delete from public.audit_logs`))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`update public.audit_logs set action = 'DELETE'`)),
    ).rejects.toThrow(/permission denied/);
  });
});

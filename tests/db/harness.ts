import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const ROOT = join(__dirname, "..", "..");

/** Supabase 스텁 + 모든 마이그레이션을 순서대로 적용한 인메모리 Postgres 를 만든다. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));

  const dir = join(ROOT, "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return db;
}

type Role = "anon" | "authenticated" | "service_role";

/**
 * 지정한 사용자(JWT sub)·DB 역할로 콜백을 실행한다. 실제 Supabase(PostgREST)가
 * 요청마다 하는 것과 같이 트랜잭션 안에서 SET LOCAL ROLE + jwt claims 를 설정한다.
 * 콜백이 throw 하면 롤백된다.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
  role: Role = "authenticated",
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      userId ? JSON.stringify({ sub: userId, role }) : "",
    ]);
    return fn(tx);
  });
}

/** 관리자(superuser) 권한으로 auth 사용자 + 프로필 + 지점 소속을 만든다. */
export async function createUser(
  db: PGlite,
  opts: {
    id: string;
    name: string;
    role: "owner" | "hq_manager" | "store_manager" | "staff";
    active?: boolean;
    storeCodes?: string[];
  },
): Promise<void> {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    opts.id,
    `${opts.name}@example.test`,
    JSON.stringify({ full_name: opts.name }),
  ]);
  await db.query(`update public.profiles set role = $2, is_active = $3 where id = $1`, [
    opts.id,
    opts.role,
    opts.active ?? true,
  ]);
  for (const code of opts.storeCodes ?? []) {
    await db.query(
      `insert into public.store_members (user_id, store_id)
       select $1, id from public.stores where code = $2`,
      [opts.id, code],
    );
  }
}

export async function storeId(db: PGlite, code: string): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from public.stores where code = $1`, [code]);
  if (!r.rows[0]) throw new Error(`store ${code} not found`);
  return r.rows[0].id;
}

import { describe, expect, it } from "vitest";
import {
  canAccessStore,
  canManageStore,
  canViewStoreFinancials,
  navItemsFor,
  NAV_ITEMS,
} from "@/lib/auth/roles";
import { toAuthEmail } from "@/lib/auth/login-id";
import { safeNextPath } from "@/lib/safe-redirect";
import { createUserSchema, passwordSchema, updateUserSchema } from "@/lib/validation/users";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

describe("역할 권한 (DB app.* 함수와 동일해야 함)", () => {
  it("대표는 모든 지점", () => {
    const owner = { role: "owner" as const, storeIds: [] };
    expect(canAccessStore(owner, S2)).toBe(true);
    expect(canViewStoreFinancials(owner, S2)).toBe(true);
  });
  it("지점 관리자는 소속 지점만 관리·재무 조회", () => {
    const m = { role: "store_manager" as const, storeIds: [S1] };
    expect(canManageStore(m, S1)).toBe(true);
    expect(canManageStore(m, S2)).toBe(false);
    expect(canViewStoreFinancials(m, S2)).toBe(false);
  });
  it("직원은 소속 지점 접근만, 관리·재무 불가", () => {
    const s = { role: "staff" as const, storeIds: [S1] };
    expect(canAccessStore(s, S1)).toBe(true);
    expect(canManageStore(s, S1)).toBe(false);
    expect(canViewStoreFinancials(s, S1)).toBe(false);
  });
});

describe("메뉴 노출", () => {
  it("직원에게 손익·계정관리·지점비교 메뉴가 없다", () => {
    const hrefs = navItemsFor("staff").map((i) => i.href);
    expect(hrefs).not.toContain("/pnl");
    expect(hrefs).not.toContain("/admin/users");
    expect(hrefs).not.toContain("/compare");
  });
  it("관리 메뉴는 대표만", () => {
    for (const item of NAV_ITEMS.filter((i) => i.href.startsWith("/admin"))) {
      expect(item.roles).toEqual(["owner"]);
    }
  });
});

describe("로그인 아이디 → Auth 이메일", () => {
  const D = "staff.hyangmiok.invalid";
  it("아이디는 내부 도메인 이메일로", () => {
    expect(toAuthEmail("  Kim01 ", D)).toBe(`kim01@${D}`);
  });
  it("이메일은 그대로(소문자)", () => {
    expect(toAuthEmail("Boss@Example.com", D)).toBe("boss@example.com");
  });
  it("잘못된 형식은 거부", () => {
    expect(toAuthEmail("ab", D)).toBeNull();
    expect(toAuthEmail("김철수", D)).toBeNull();
    expect(toAuthEmail("a@b", D)).toBeNull();
    expect(toAuthEmail("", D)).toBeNull();
  });
});

describe("로그인 후 이동 경로 (오픈 리다이렉트 방지)", () => {
  it("내부 경로만 허용", () => {
    expect(safeNextPath("/admin/users")).toBe("/admin/users");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});

describe("계정 입력 검증", () => {
  it("비밀번호 정책", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletters").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(false);
    expect(passwordSchema.safeParse("hyangmi2026").success).toBe(true);
  });
  it("직원은 소속 지점이 필수", () => {
    const r = createUserSchema.safeParse({
      fullName: "홍길동",
      loginType: "id",
      loginId: "hong",
      password: "hyangmi2026",
      role: "staff",
      storeIds: [],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["storeIds"]);
  });
  it("대표는 소속 지점 없이 가능", () => {
    const r = updateUserSchema.safeParse({
      userId: S1,
      fullName: "대표",
      role: "owner",
      isActive: true,
      storeIds: [],
    });
    expect(r.success).toBe(true);
  });
  it("아이디 형식 오류", () => {
    const r = createUserSchema.safeParse({
      fullName: "홍길동",
      loginType: "id",
      loginId: "홍길동",
      password: "hyangmi2026",
      role: "staff",
      storeIds: [S1],
    });
    expect(r.success).toBe(false);
  });
});

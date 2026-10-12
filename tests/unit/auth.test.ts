import { describe, expect, it } from "vitest";
import {
  canAccessStore,
  canManageStore,
  canViewStoreFinancials,
  navItemsFor,
  NAV_ITEMS,
} from "@/lib/auth/roles";
import { loginIdFromName, toAuthEmail } from "@/lib/auth/login-id";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  birthdatePasswordSchema,
  changeOwnPasswordSchema,
  createUserSchema,
  staffOwnPasswordSchema,
  strongPasswordSchema,
  updateUserSchema,
} from "@/lib/validation/users";

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

describe("로그인 아이디(이름) → Auth 이메일", () => {
  const D = "staff.hyangmiok.invalid";
  it("한글 이름은 16진수 내부 이메일로 (ASCII 만 사용)", () => {
    const e = toAuthEmail("김민수", D)!;
    expect(e).toBe(`id-${Buffer.from("김민수").toString("hex")}@${D}`);
    expect(/^[\x00-\x7f]+$/.test(e)).toBe(true);
  });
  it("앞뒤·중간 공백은 무시, 영문은 소문자로", () => {
    expect(toAuthEmail(" 김 민수 ", D)).toBe(toAuthEmail("김민수", D));
    expect(toAuthEmail("Kim01", D)).toBe(toAuthEmail("kim01", D));
  });
  it("동명이인 숫자 구분", () => {
    expect(toAuthEmail("김민수2", D)).not.toBe(toAuthEmail("김민수", D));
  });
  it("이메일은 그대로(소문자)", () => {
    expect(toAuthEmail("Boss@Example.com", D)).toBe("boss@example.com");
  });
  it("잘못된 형식은 거부", () => {
    expect(toAuthEmail("김", D)).toBeNull();
    expect(toAuthEmail("김민수!", D)).toBeNull();
    expect(toAuthEmail("a@b", D)).toBeNull();
    expect(toAuthEmail("", D)).toBeNull();
  });
  it("이름에서 아이디 자동 생성", () => {
    expect(loginIdFromName(" 김 민수 ")).toBe("김민수");
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

describe("비밀번호 정책", () => {
  it("관리자: 10자 이상 영문+숫자", () => {
    expect(strongPasswordSchema.safeParse("short1").success).toBe(false);
    expect(strongPasswordSchema.safeParse("onlyletters").success).toBe(false);
    expect(strongPasswordSchema.safeParse("hyangmi2026").success).toBe(true);
  });
  it("직원 첫 비밀번호: 생년월일 6자리", () => {
    expect(birthdatePasswordSchema.safeParse("950312").success).toBe(true);
    expect(birthdatePasswordSchema.safeParse("951312").success).toBe(false); // 13월
    expect(birthdatePasswordSchema.safeParse("95031").success).toBe(false);
    expect(birthdatePasswordSchema.safeParse("1995-03-12").success).toBe(false);
  });
  it("직원 본인 비밀번호: 6자리 이상이면 단순해도 허용 (대표 결정)", () => {
    expect(staffOwnPasswordSchema.safeParse("482913").success).toBe(true);
    expect(staffOwnPasswordSchema.safeParse("111111").success).toBe(true);
    expect(staffOwnPasswordSchema.safeParse("12345").success).toBe(false);
  });
  it("첫 변경은 현재 비밀번호 없이, 평소 변경은 현재 비밀번호 필요", () => {
    const first = changeOwnPasswordSchema("staff", false).safeParse({ newPassword: "482913", confirmPassword: "482913" });
    expect(first.success).toBe(true);
    const normal = changeOwnPasswordSchema("staff", true).safeParse({ newPassword: "482913", confirmPassword: "482913" });
    expect(normal.success).toBe(false);
  });
  it("새 비밀번호 확인 불일치", () => {
    const r = changeOwnPasswordSchema("staff", false).safeParse({ newPassword: "482913", confirmPassword: "482914" });
    expect(r.error?.issues[0].path).toEqual(["confirmPassword"]);
  });
});

describe("계정 생성 검증", () => {
  const base = { fullName: "김민수", loginType: "name", loginId: "김민수", storeIds: [S1] };
  it("직원은 이름 아이디 + 생년월일로 생성 가능", () => {
    expect(createUserSchema.safeParse({ ...base, password: "950312", role: "staff" }).success).toBe(true);
  });
  it("관리자는 생년월일 비밀번호 불가 (10자 이상 필요)", () => {
    const r = createUserSchema.safeParse({ ...base, password: "950312", role: "store_manager" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["password"]);
  });
  it("직원은 소속 지점이 필수", () => {
    const r = createUserSchema.safeParse({ ...base, password: "950312", role: "staff", storeIds: [] });
    expect(r.error?.issues.some((i) => i.path[0] === "storeIds")).toBe(true);
  });
  it("아이디 공백은 자동 제거되어 통과", () => {
    const r = createUserSchema.safeParse({ ...base, loginId: "김 민수", password: "950312", role: "staff" });
    expect(r.success && r.data.loginId).toBe("김민수");
  });
  it("대표는 소속 지점 없이 가능", () => {
    const r = updateUserSchema.safeParse({ userId: S1, fullName: "대표", role: "owner", isActive: true, storeIds: [] });
    expect(r.success).toBe(true);
  });
});

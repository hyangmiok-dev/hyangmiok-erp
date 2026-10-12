/**
 * 역할·권한 규칙 (순수 함수).
 * UI 표시와 서버 액션 사전검사에 사용한다. **최종 권한 강제는 DB RLS** 이며,
 * 여기의 규칙은 supabase/migrations 의 app.* 함수와 반드시 같은 의미여야 한다.
 */

export const ROLES = ["owner", "hq_manager", "store_manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "최고관리자(대표)",
  hq_manager: "본사 관리자",
  store_manager: "지점 관리자",
  staff: "일반 직원",
};

export interface SessionUser {
  id: string;
  fullName: string;
  role: Role;
  loginId: string | null;
  email: string | null;
  /** 소속 지점 id. 대표는 전체 지점 접근이므로 이 목록과 무관. */
  storeIds: string[];
  /** true 면 다른 화면을 쓰기 전에 비밀번호를 바꿔야 한다 (계정 생성·초기화 직후). */
  mustChangePassword: boolean;
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** app.has_store_access 와 동일 */
export function canAccessStore(user: Pick<SessionUser, "role" | "storeIds">, storeId: string): boolean {
  return user.role === "owner" || user.storeIds.includes(storeId);
}

/** app.can_manage_store 와 동일 */
export function canManageStore(user: Pick<SessionUser, "role" | "storeIds">, storeId: string): boolean {
  if (user.role === "owner") return true;
  if (user.role === "hq_manager" || user.role === "store_manager") return user.storeIds.includes(storeId);
  return false;
}

/** app.can_view_store_financials 와 동일 */
export function canViewStoreFinancials(user: Pick<SessionUser, "role" | "storeIds">, storeId: string): boolean {
  return canManageStore(user, storeId);
}

/** app.can_view_store_pnl 와 동일: 지출·손익은 대표 전체, 본사 관리자는 소속 지점만 */
export function canViewStorePnl(user: Pick<SessionUser, "role" | "storeIds">, storeId: string): boolean {
  if (user.role === "owner") return true;
  if (user.role === "hq_manager") return user.storeIds.includes(storeId);
  return false;
}

export function isManager(role: Role): boolean {
  return role === "owner" || role === "hq_manager" || role === "store_manager";
}

/** 대표를 제외한 역할은 최소 1개 지점에 소속되어야 데이터에 접근할 수 있다. */
export function requiresStoreMembership(role: Role): boolean {
  return role === "store_manager" || role === "staff" || role === "hq_manager";
}

// ---------------------------------------------------------------------
// 내비게이션
// ---------------------------------------------------------------------

/** 현재 구현이 완료된 개발 단계. 이보다 큰 단계의 메뉴는 '준비 중'으로 표시된다. */
export const CURRENT_STAGE = 3;

export type NavIcon =
  | "home"
  | "sales"
  | "pnl"
  | "staff"
  | "checklist"
  | "inventory"
  | "recipe"
  | "compare"
  | "expense"
  | "vendor"
  | "purchases"
  | "payables"
  | "store"
  | "users"
  | "audit";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  roles: readonly Role[];
  stage: number;
  group: "업무" | "분석" | "관리";
}

const ALL: readonly Role[] = ROLES;
const MANAGERS: readonly Role[] = ["owner", "hq_manager", "store_manager"];

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "홈", icon: "home", roles: ALL, stage: 1, group: "업무" },
  { href: "/sales", label: "매출 입력", icon: "sales", roles: MANAGERS, stage: 2, group: "업무" },
  { href: "/checklists", label: "오픈·마감 점검", icon: "checklist", roles: ALL, stage: 4, group: "업무" },
  { href: "/inventory", label: "재고·발주", icon: "inventory", roles: ALL, stage: 5, group: "업무" },
  { href: "/production", label: "레시피·육수 생산", icon: "recipe", roles: MANAGERS, stage: 5, group: "업무" },
  { href: "/staff", label: "직원·근태", icon: "staff", roles: MANAGERS, stage: 4, group: "업무" },
  { href: "/expenses", label: "지출 입력", icon: "expense", roles: ["owner"], stage: 3, group: "업무" },
  { href: "/payables", label: "거래처 미수", icon: "payables", roles: ["owner", "hq_manager"], stage: 3, group: "업무" },
  { href: "/pnl", label: "손익", icon: "pnl", roles: ["owner", "hq_manager"], stage: 3, group: "분석" },
  { href: "/purchases", label: "거래처별 매입", icon: "purchases", roles: ["owner", "hq_manager"], stage: 3, group: "분석" },
  { href: "/compare", label: "지점 비교", icon: "compare", roles: ["owner", "hq_manager"], stage: 6, group: "분석" },
  { href: "/admin/stores", label: "지점 설정", icon: "store", roles: ["owner"], stage: 2, group: "관리" },
  { href: "/admin/vendors", label: "거래처 관리", icon: "vendor", roles: ["owner"], stage: 3, group: "관리" },
  { href: "/admin/users", label: "계정 관리", icon: "users", roles: ["owner"], stage: 1, group: "관리" },
  { href: "/admin/audit", label: "변경 이력", icon: "audit", roles: ["owner"], stage: 1, group: "관리" },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

export function isNavItemReady(item: NavItem): boolean {
  return item.stage <= CURRENT_STAGE;
}

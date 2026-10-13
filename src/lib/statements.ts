/**
 * 거래명세표 사진 → 검토 화면 (순수 함수).
 * - AI 결과(ai_result)를 검토 화면의 품목 줄로 바꾼다.
 * - AI 가 못 읽은 칸은 비워 두고 '확인 필요'로 표시 → 올린 사람이 사진을 보고 직접 적는다 (대표 결정 2026-10-13).
 * - 금액 기준은 부가세 포함: 명세표에 세액이 따로 있으면 '부가세' 줄을 하나 더해 저장한다.
 */
import { StatementRead, type LineField } from "../../supabase/functions/read-statement/schema.ts";
import { addDays, isDateKey, type DateKey } from "@/lib/period";
import { lineAmount } from "@/lib/payables";

export { StatementRead };

export type StatementStatus = "uploaded" | "read" | "failed" | "confirmed" | "discarded";

export const STATUS_LABEL: Record<StatementStatus, string> = {
  uploaded: "AI 읽기 전",
  read: "확인 필요",
  failed: "직접 적기",
  confirmed: "확정",
  discarded: "버림",
};

export const VAT_ITEM_NAME = "부가세";
export const MAX_AI_ATTEMPTS = 3;

/** AI 에 보낼 사진 (선명하게, 약 3.75MP 이내 — 손글씨 숫자를 읽기 위해) / 보관할 사진 (작게: 무료 저장공간 1GB 절약) */
export const AI_IMAGE = { maxEdge: 2576, maxPixels: 3_750_000, quality: 0.85 } as const;
export const ARCHIVE_IMAGE = { maxEdge: 1600, maxPixels: 2_000_000, quality: 0.7 } as const;
/** Supabase 무료 저장공간 */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export type DraftField = "itemName" | "quantity" | "unit" | "unitPrice" | "amount";

const FIELD_OF: Record<LineField, DraftField | null> = {
  name: "itemName",
  quantity: "quantity",
  unit: "unit",
  unit_price: "unitPrice",
  amount: "amount",
  tax: null,
};

export interface DraftLine {
  itemName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  /** 명세표에 적힌 금액이면 수량×단가로 덮어쓰지 않는다 */
  amountEdited: boolean;
  /** AI 가 못 읽었거나 확실하지 않은 칸 */
  flags: DraftField[];
}

export interface StatementDraft {
  lines: DraftLine[];
  vat: string;
  vatFlag: boolean;
  date: DateKey;
  dateFlag: boolean;
  /** 명세표에 적힌 이번 거래 합계 (부가세 포함) */
  total: number | null;
  balance: string;
  balanceFlag: boolean;
  vendorName: string | null;
  notes: string | null;
}

export function parseAiResult(raw: unknown): StatementRead | null {
  const r = StatementRead.safeParse(raw);
  return r.success ? r.data : null;
}

const won = (n: number | null | undefined): number | null => (n == null || !Number.isFinite(n) || n < 0 ? null : Math.round(n));
const qty = (n: number | null | undefined): number | null =>
  n == null || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 1000) / 1000;

/** AI 결과 → 검토 화면 초기값. AI 결과가 없으면 빈 화면(직접 적기) */
export function draftFromAi(ai: StatementRead | null, today: DateKey): StatementDraft {
  if (!ai) {
    return {
      lines: [],
      vat: "0",
      vatFlag: false,
      date: today,
      dateFlag: true,
      total: null,
      balance: "",
      balanceFlag: false,
      vendorName: null,
      notes: null,
    };
  }

  const lines: DraftLine[] = ai.lines.map((l) => {
    const flags = new Set<DraftField>();
    for (const f of l.unclear) {
      const d = FIELD_OF[f];
      if (d) flags.add(d);
    }
    const name = (l.name ?? "").trim().slice(0, 60);
    if (!name) flags.add("itemName");
    const q = qty(l.quantity);
    if (q === null) flags.add("quantity");
    const p = won(l.unit_price);
    if (p === null) flags.add("unitPrice");
    let a = won(l.amount);
    let amountEdited = true;
    if (a === null) {
      flags.add("amount");
      // 금액 칸을 못 읽었으면 수량×단가를 넣어 두되 '확인 필요'로 남긴다
      if (q !== null && p !== null) {
        a = lineAmount(q, p);
        amountEdited = false;
      }
    }
    return {
      itemName: name,
      quantity: q === null ? "" : String(q),
      unit: (l.unit ?? "").trim().slice(0, 10),
      unitPrice: p === null ? "" : String(p),
      amount: a === null ? "" : String(a),
      amountEdited,
      flags: [...flags],
    };
  });

  const linesSum = lines.reduce((n, l) => n + (Number(l.amount) || 0), 0);
  const total = won(ai.total);
  const taxes = ai.lines.map((l) => won(l.tax)).filter((t): t is number => t !== null);
  let vat = won(ai.tax_total) ?? (taxes.length ? taxes.reduce((n, t) => n + t, 0) : null);
  let vatFlag = ai.lines.some((l) => l.unclear.includes("tax"));
  if (vat === null) {
    // 세액 칸이 없는데 합계가 품목 합보다 크면 그 차이를 부가세로 보고 확인을 요청한다
    if (total !== null && total > linesSum) {
      vat = total - linesSum;
      vatFlag = true;
    } else vat = 0;
  }

  const d = ai.date && isDateKey(ai.date) ? ai.date : null;
  const dateOk = d !== null && d <= today && d >= addDays(today, -62);
  const balance = ai.balance == null || !Number.isFinite(ai.balance) ? null : Math.round(ai.balance);

  return {
    lines,
    vat: String(vat),
    vatFlag,
    date: dateOk ? d : today,
    dateFlag: !dateOk || ai.unclear.includes("date"),
    total,
    balance: balance === null ? "" : String(balance),
    balanceFlag: ai.unclear.includes("balance"),
    vendorName: ai.vendor_name?.trim() || null,
    notes: ai.notes?.trim() || null,
  };
}

/** 품목 합계 + 부가세 = 명세표 합계 인지 */
export function totalsCheck(linesSum: number, vat: number, total: number | null): { status: "ok" | "mismatch" | "unknown"; diff: number } {
  if (total === null) return { status: "unknown", diff: 0 };
  const diff = linesSum + vat - total;
  return { status: diff === 0 ? "ok" : "mismatch", diff };
}

const normVendor = (s: string) =>
  s
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, "")
    .replace(/[\s()·.,-]/g, "")
    .toLowerCase();

/** 고른 거래처와 명세표 상호가 많이 달라 보이는지 (서로 포함 관계가 아니면 '다름') */
export function vendorLooksDifferent(selected: string, read: string | null): boolean {
  if (!read) return false;
  const a = normVendor(selected);
  const b = normVendor(read);
  if (!a || !b) return false;
  return !(a.includes(b) || b.includes(a));
}

/** 확정 함수(confirm_purchase_statement)에 보낼 품목 줄. 부가세가 있으면 '부가세' 줄을 더한다 */
export function toConfirmLines(
  lines: { itemName: string; quantity: number; unit: string | null; unitPrice: number; amount: number }[],
  vat: number,
): { item_name: string; quantity: number; unit: string | null; unit_price: number; amount: number }[] {
  const out = lines.map((l) => ({ item_name: l.itemName, quantity: l.quantity, unit: l.unit, unit_price: l.unitPrice, amount: l.amount }));
  if (vat > 0) out.push({ item_name: VAT_ITEM_NAME, quantity: 1, unit: null, unit_price: vat, amount: vat });
  return out;
}

/** 큰 사진을 비율 유지하며 줄인 크기 */
export function fitSize(width: number, height: number, maxEdge: number, maxPixels: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const PHOTO_PATH = /^([0-9a-f-]{36})\/(\d{4}-\d{2})\/([0-9a-f-]{36})\.jpg$/;

/** 보관 사진 경로: <지점>/<YYYY-MM>/<uuid>.jpg (DB 정책과 같은 모양) */
export function photoPathFor(storeId: string, monthKey: string, id: string): string {
  return `${storeId}/${monthKey}/${id}.jpg`;
}

export function isPhotoPathOf(storeId: string, path: string): boolean {
  const m = PHOTO_PATH.exec(path);
  return !!m && m[1] === storeId;
}

/**
 * 매출 CSV 가져오기/내보내기 (순수 함수, 브라우저·서버 공용).
 * 엑셀에서 '다른 이름으로 저장 → CSV' 한 파일을 받는다. 인코딩(UTF-8 / EUC-KR) 판별은 decodeCsvBytes.
 */
import { isDateKey, type DateKey } from "@/lib/period";

export interface ImportRow {
  line: number;
  storeId: string;
  storeName: string;
  businessDate: DateKey;
  netSales: number;
  orderCount: number;
  isClosed: boolean;
  memo: string | null;
}

export interface ImportError {
  line: number;
  message: string;
}

export interface StoreRef {
  id: string;
  code: string;
  name: string;
}

/** UTF-8 로 읽어 깨지면 EUC-KR(한국어 엑셀 기본)로 다시 읽는다. */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const text = utf8.includes("�") ? new TextDecoder("euc-kr").decode(bytes) : utf8;
  return text.replace(/^﻿/, "");
}

/** 따옴표·쉼표·줄바꿈을 처리하는 최소 CSV 파서 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const HEADERS = {
  date: ["날짜", "영업일", "일자", "date"],
  store: ["지점", "매장", "점포", "store"],
  netSales: ["실매출", "순매출", "매출액", "매출", "net_sales"],
  orderCount: ["건수", "주문건수", "영수증건수", "orders", "order_count"],
  closed: ["휴무", "closed"],
  memo: ["메모", "비고", "특이사항", "memo"],
} as const;

type Col = keyof typeof HEADERS;

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 2026-10-13 / 2026.10.13 / 2026/10/13 / 2026. 10. 13. / 20261013 */
export function parseDateCell(raw: string): DateKey | null {
  const s = raw.trim().replace(/\.$/, "");
  let m = /^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})$/.exec(s.replace(/\s*\.\s*/g, "."));
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const key = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isDateKey(key) ? key : null;
}

/** '1,234,000원' → 1234000. 정수·0 이상만 */
export function parseAmountCell(raw: string): number | null {
  const s = raw.replace(/[,\s원건]/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

function parseBool(raw: string | undefined): boolean {
  return ["o", "y", "yes", "true", "1", "휴무", "예", "v", "✓"].includes(norm(raw ?? ""));
}

export function matchStore(raw: string, stores: StoreRef[]): StoreRef | null {
  const v = norm(raw);
  if (!v) return null;
  return (
    stores.find((s) => norm(s.code) === v) ??
    stores.find((s) => norm(s.name) === v) ??
    // '1호점' 처럼 이름 끝부분만 쓴 경우 (유일할 때만)
    (() => {
      const hits = stores.filter((s) => norm(s.name).endsWith(v));
      return hits.length === 1 ? hits[0] : null;
    })()
  );
}

export function mapSalesCsv(
  text: string,
  stores: StoreRef[],
): { rows: ImportRow[]; errors: ImportError[]; missingColumns: string[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [], missingColumns: ["날짜", "지점", "실매출", "건수"] };

  const header = table[0].map(norm);
  const idx = {} as Record<Col, number>;
  for (const col of Object.keys(HEADERS) as Col[]) {
    idx[col] = header.findIndex((h) => (HEADERS[col] as readonly string[]).some((name) => h === norm(name)));
  }
  const required: [Col, string][] = [
    ["date", "날짜"],
    ["store", "지점"],
    ["netSales", "실매출"],
    ["orderCount", "건수"],
  ];
  const missingColumns = required.filter(([c]) => idx[c] < 0).map(([, label]) => label);
  if (missingColumns.length) return { rows: [], errors: [], missingColumns };

  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seen = new Map<string, number>();

  table.slice(1).forEach((cells, i) => {
    const line = i + 2; // 엑셀 행 번호 (머리글이 1행)
    const get = (c: Col) => (idx[c] >= 0 ? (cells[idx[c]] ?? "").trim() : "");
    const problems: string[] = [];

    const date = parseDateCell(get("date"));
    if (!date) problems.push(`날짜 형식 오류 '${get("date")}'`);
    const store = matchStore(get("store"), stores);
    if (!store) problems.push(`지점을 찾을 수 없음 '${get("store")}'`);
    const isClosed = parseBool(get("closed"));
    const net = get("netSales") === "" && isClosed ? 0 : parseAmountCell(get("netSales"));
    if (net === null) problems.push(`실매출 숫자 오류 '${get("netSales")}'`);
    const orders = get("orderCount") === "" && isClosed ? 0 : parseAmountCell(get("orderCount"));
    if (orders === null) problems.push(`건수 숫자 오류 '${get("orderCount")}'`);
    if (isClosed && ((net ?? 0) > 0 || (orders ?? 0) > 0)) problems.push("휴무인데 매출/건수가 있음");

    if (date && store) {
      const key = `${store.id}|${date}`;
      const prev = seen.get(key);
      if (prev) problems.push(`${prev}행과 같은 지점·날짜가 중복됨`);
      else seen.set(key, line);
    }

    if (problems.length) {
      errors.push({ line, message: problems.join(", ") });
      return;
    }
    const memo = get("memo");
    rows.push({
      line,
      storeId: store!.id,
      storeName: store!.name,
      businessDate: date!,
      netSales: net!,
      orderCount: orders!,
      isClosed,
      memo: memo ? memo.slice(0, 500) : null,
    });
  });

  return { rows, errors, missingColumns: [] };
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  // 엑셀이 한글을 올바르게 읽도록 BOM 포함
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const SALES_CSV_TEMPLATE = toCsv([
  ["날짜", "지점", "실매출", "건수", "휴무", "메모"],
  ["2026-10-01", "1호점", "1234000", "87", "", ""],
  ["2026-10-01", "2호점", "", "", "휴무", "정기휴무"],
]);

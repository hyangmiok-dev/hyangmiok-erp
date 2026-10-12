"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lineAmount } from "@/lib/payables";
import { cn } from "@/lib/utils";

export interface ItemSuggestion {
  name: string;
  unit: string | null;
  lastPrice: number;
  lastDate: string;
}

export interface LineDraft {
  key: string;
  itemName: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  /** 금액을 직접 고쳤으면 수량×단가로 다시 계산하지 않는다 */
  amountEdited: boolean;
}

let seq = 0;
export function emptyLine(): LineDraft {
  seq += 1;
  return { key: `l${Date.now()}-${seq}`, itemName: "", quantity: "", unit: "", unitPrice: "", amount: "", amountEdited: false };
}

const digits = (v: string) => v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
const decimal = (v: string) => {
  const s = v.replace(/[^\d.]/g, "");
  const [a, ...rest] = s.split(".");
  return rest.length ? `${a}.${rest.join("").slice(0, 3)}` : a;
};
const comma = (v: string) => (v ? Number(v).toLocaleString("ko-KR") : "");

export function linesTotal(lines: LineDraft[]): number {
  return lines.reduce((n, l) => n + (Number(l.amount) || 0), 0);
}

/** 서버로 보낼 품목 줄 (빈 줄 제외) */
export function serializeLines(lines: LineDraft[]): string {
  return JSON.stringify(
    lines
      .filter((l) => l.itemName.trim() || l.quantity || l.unitPrice || l.amount)
      .map((l) => ({ itemName: l.itemName, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, amount: l.amount })),
  );
}

export type LineField = "itemName" | "quantity" | "unit" | "unitPrice" | "amount";

const FLAG_CLASS = "border-amber-500 bg-amber-50 dark:bg-amber-950/40";
const FLAG_TITLE = "사진에서 확실히 읽지 못한 칸이에요. 사진을 보고 확인해 주세요.";

export function LineItemsEditor({
  lines,
  onChange,
  suggestions,
  error,
  flags,
  onFieldEdit,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  suggestions: ItemSuggestion[];
  error?: string;
  /** 확인이 필요한 칸 (거래명세표 사진 AI 읽기): 줄 key → 칸 이름 */
  flags?: Record<string, LineField[]>;
  /** 칸을 고치면 알림 (확인 표시 지우기용) */
  onFieldEdit?: (key: string, field: LineField) => void;
}) {
  const byName = new Map(suggestions.map((s) => [s.name, s]));
  const flagged = (key: string, field: LineField) => flags?.[key]?.includes(field) ?? false;
  const flagProps = (key: string, field: LineField) =>
    flagged(key, field) ? { "aria-invalid": true as const, title: FLAG_TITLE } : {};

  function update(key: string, patch: Partial<LineDraft>) {
    if (onFieldEdit) {
      for (const f of ["itemName", "quantity", "unit", "unitPrice", "amount"] as const) {
        if (patch[f] !== undefined) onFieldEdit(key, f);
      }
    }
    onChange(
      lines.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // 아는 품목이면 단위·지난 단가를 채워준다 (비어 있을 때만)
        if (patch.itemName !== undefined) {
          const s = byName.get(patch.itemName.trim());
          if (s) {
            if (!next.unit && s.unit) next.unit = s.unit;
            if (!next.unitPrice) next.unitPrice = String(s.lastPrice);
          }
        }
        if (!next.amountEdited && (patch.quantity !== undefined || patch.unitPrice !== undefined || patch.itemName !== undefined)) {
          const q = Number(next.quantity);
          if (q > 0 && next.unitPrice !== "") next.amount = String(lineAmount(q, Number(next.unitPrice)));
        }
        return next;
      }),
    );
  }

  return (
    <div className="space-y-2">
      <datalist id="item-list">
        {suggestions.map((s) => (
          <option key={`${s.name}|${s.unit ?? ""}`} value={s.name} />
        ))}
      </datalist>

      <div className="hidden grid-cols-[1fr_5rem_4rem_7rem_8rem_2.5rem] gap-2 px-1 text-xs text-muted-foreground sm:grid">
        <span>품목</span>
        <span className="text-right">수량</span>
        <span>단위</span>
        <span className="text-right">단가</span>
        <span className="text-right">금액</span>
        <span />
      </div>

      {lines.map((l, i) => {
        const s = byName.get(l.itemName.trim());
        const price = Number(l.unitPrice);
        const priceChanged = s && l.unitPrice !== "" && price !== s.lastPrice;
        const changePct = s && s.lastPrice > 0 ? ((price - s.lastPrice) / s.lastPrice) * 100 : 0;
        const calc = Number(l.quantity) > 0 && l.unitPrice !== "" ? lineAmount(Number(l.quantity), price) : null;
        return (
          <div key={l.key} className="rounded-lg border p-2 sm:border-0 sm:p-0">
            <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_5rem_4rem_7rem_8rem_2.5rem]">
              <Input
                aria-label={`${i + 1}번째 품목 이름`}
                list="item-list"
                placeholder="품목 (예: 차돌양지)"
                value={l.itemName}
                maxLength={60}
                onChange={(e) => update(l.key, { itemName: e.target.value })}
                className={cn("h-10 text-base", flagged(l.key, "itemName") && FLAG_CLASS)}
                {...flagProps(l.key, "itemName")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={`${i + 1}번째 줄 지우기`}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                className="sm:order-last"
              >
                <X className="size-4" />
              </Button>
              <div className="col-span-2 grid grid-cols-[1fr_4rem_1fr] gap-2 sm:col-span-4 sm:grid-cols-[5rem_4rem_7rem_8rem]">
                <Input
                  aria-label="수량"
                  inputMode="decimal"
                  placeholder="수량"
                  value={l.quantity}
                  onChange={(e) => update(l.key, { quantity: decimal(e.target.value) })}
                  className={cn("h-10 text-right text-base tabular-nums", flagged(l.key, "quantity") && FLAG_CLASS)}
                  {...flagProps(l.key, "quantity")}
                />
                <Input
                  aria-label="단위"
                  placeholder="kg"
                  value={l.unit}
                  maxLength={10}
                  onChange={(e) => update(l.key, { unit: e.target.value })}
                  className={cn("h-10 text-base", flagged(l.key, "unit") && FLAG_CLASS)}
                  {...flagProps(l.key, "unit")}
                />
                <Input
                  aria-label="단가"
                  inputMode="numeric"
                  placeholder="단가"
                  value={comma(l.unitPrice)}
                  onChange={(e) => update(l.key, { unitPrice: digits(e.target.value).slice(0, 9) })}
                  className={cn("h-10 text-right text-base tabular-nums", flagged(l.key, "unitPrice") && FLAG_CLASS)}
                  {...flagProps(l.key, "unitPrice")}
                />
                <Input
                  aria-label="금액"
                  inputMode="numeric"
                  placeholder="금액"
                  value={comma(l.amount)}
                  onChange={(e) => update(l.key, { amount: digits(e.target.value).slice(0, 10), amountEdited: true })}
                  className={cn(
                    "col-span-3 h-10 text-right text-base font-semibold tabular-nums sm:col-span-1",
                    flagged(l.key, "amount") && FLAG_CLASS,
                  )}
                  {...flagProps(l.key, "amount")}
                />
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 px-1 text-xs text-muted-foreground">
              {s && (
                <span className={cn(priceChanged && (changePct > 0 ? "text-red-700" : "text-emerald-700"))}>
                  지난 단가 {s.lastPrice.toLocaleString("ko-KR")}원 ({Number(s.lastDate.slice(5, 7))}/{Number(s.lastDate.slice(8, 10))})
                  {priceChanged && ` → ${changePct > 0 ? "▲" : "▼"} ${Math.abs(changePct).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`}
                </span>
              )}
              {l.amountEdited && calc !== null && calc !== Number(l.amount) && (
                <span>
                  수량×단가 = {calc.toLocaleString("ko-KR")}원{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => update(l.key, { amount: String(calc), amountEdited: false })}
                  >
                    이 금액으로
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, emptyLine()])}>
        <Plus className="size-4" /> 품목 추가
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

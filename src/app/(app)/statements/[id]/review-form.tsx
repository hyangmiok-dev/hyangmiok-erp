"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-fields";
import { formatKoreanWon, formatKRW } from "@/lib/format";
import { MAX_AI_ATTEMPTS, totalsCheck, vendorLooksDifferent, type StatementDraft } from "@/lib/statements";
import { readWithAi } from "@/lib/statement-client";
import type { FieldErrors } from "@/lib/validation/users";
import { cn } from "@/lib/utils";
import { LineItemsEditor, emptyLine, linesTotal, serializeLines, type LineDraft, type LineField } from "../../expenses/line-items";
import { confirmStatementAction, discardStatementAction } from "../actions";

const FLAG = "border-amber-500 bg-amber-50 dark:bg-amber-950/40";
const digits = (v: string) => v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
const signed = (v: string) => {
  const neg = v.trim().startsWith("-");
  const d = digits(v);
  return neg && d ? `-${d}` : d;
};
const comma = (v: string) => (v === "" || v === "-" ? v : Number(v).toLocaleString("ko-KR"));

function initial(draft: StatementDraft) {
  const rows = draft.lines.map((l) => {
    const line: LineDraft = {
      ...emptyLine(),
      itemName: l.itemName,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      amount: l.amount,
      amountEdited: l.amountEdited,
    };
    return { line, flags: l.flags as LineField[] };
  });
  return {
    lines: rows.length ? rows.map((r) => r.line) : [emptyLine()],
    flags: Object.fromEntries(rows.filter((r) => r.flags.length).map((r) => [r.line.key, r.flags])) as Record<string, LineField[]>,
  };
}

export function ReviewForm({
  statementId,
  storeId,
  vendorName,
  vendorOnCredit,
  draft,
  status,
  aiError,
  aiAttempts,
  today,
  minDate,
  duplicates,
}: {
  statementId: string;
  storeId: string;
  vendorName: string;
  vendorOnCredit: boolean;
  draft: StatementDraft;
  status: "uploaded" | "read" | "failed";
  aiError: string | null;
  aiAttempts: number;
  today: string;
  /** 지점·본사 관리자는 31일 전까지만 */
  minDate: string | undefined;
  duplicates: { id: string; total: number | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const [init] = useState(() => initial(draft));
  const [lines, setLines] = useState<LineDraft[]>(init.lines);
  const [flags, setFlags] = useState<Record<string, LineField[]>>(init.flags);
  const [vat, setVat] = useState(draft.vat);
  const [vatFlag, setVatFlag] = useState(draft.vatFlag);
  const [date, setDate] = useState(draft.date);
  const [dateFlag, setDateFlag] = useState(draft.dateFlag);
  const [total, setTotal] = useState(draft.total === null ? "" : String(draft.total));
  const [balance, setBalance] = useState(draft.balance);
  const [onCredit, setOnCredit] = useState(vendorOnCredit);
  const [memo, setMemo] = useState("");
  const [checked, setChecked] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const linesSum = linesTotal(lines);
  const vatNum = Number(vat || 0);
  const check = totalsCheck(linesSum, vatNum, total === "" ? null : Number(total));
  const flaggedCount = Object.values(flags).reduce((n, f) => n + f.length, 0) + (vatFlag ? 1 : 0) + (dateFlag ? 1 : 0);
  const vendorWarn = vendorLooksDifferent(vendorName, draft.vendorName);
  const canRetry = aiAttempts < MAX_AI_ATTEMPTS;

  function unflag(key: string, field: LineField) {
    setFlags((f) => (f[key]?.includes(field) ? { ...f, [key]: f[key].filter((x) => x !== field) } : f));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("statementId", statementId);
    fd.set("date", date);
    fd.set("lines", serializeLines(lines));
    fd.set("vat", vat || "0");
    if (onCredit) fd.set("onCredit", "on");
    fd.set("statementTotal", total);
    fd.set("statementBalance", balance);
    fd.set("memo", memo);
    if (checked) fd.set("checked", "on");
    startTransition(async () => {
      const r = await confirmStatementAction({ ok: false }, fd);
      if (r.ok) {
        toast.success(r.message);
        router.push(`/statements?store=${storeId}`);
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.message ?? "확인할 곳이 있어요.", { duration: 8000 });
      }
    });
  }

  async function retry() {
    setAiBusy(true);
    const r = await readWithAi(statementId);
    setAiBusy(false);
    if (r.ok) toast.success("다시 읽었어요. 내용을 확인해 주세요.");
    else toast.error(r.error, { duration: 8000 });
    router.refresh();
  }

  function discard() {
    const reason = window.prompt("이 거래명세표를 버릴까요? 이유를 적어 주세요 (예: 잘못 찍음, 다시 찍음)", "");
    if (reason === null) return;
    startTransition(async () => {
      const r = await discardStatementAction(statementId, reason);
      if (r.ok) {
        toast.success(r.message);
        router.push(`/statements?store=${storeId}`);
      } else toast.error(r.message);
    });
  }

  return (
    <div className="space-y-4">
      {/* AI 상태 */}
      {status !== "read" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <p className="font-semibold">
            {status === "uploaded" ? "아직 AI가 읽지 않았어요." : "AI가 읽지 못했어요."} 사진을 보고 직접 적거나 다시 읽혀 보세요.
          </p>
          {aiError && <p className="mt-1">이유: {aiError}</p>}
        </div>
      )}
      {(status === "read" || canRetry) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canRetry && (
            <Button type="button" variant="outline" size="sm" disabled={aiBusy || pending} onClick={retry}>
              <RefreshCw className={cn("size-4", aiBusy && "animate-spin")} />
              {aiBusy ? "AI가 읽는 중… (최대 1분)" : status === "uploaded" ? "AI로 읽기" : "AI로 다시 읽기"} ({aiAttempts}/{MAX_AI_ATTEMPTS})
            </Button>
          )}
          {status === "read" && <span className="text-muted-foreground">AI가 읽은 내용이에요. 틀릴 수 있으니 꼭 사진과 비교해 주세요.</span>}
        </div>
      )}
      {draft.notes && <p className="rounded-lg bg-muted px-3 py-2 text-sm">AI 메모: {draft.notes}</p>}
      {vendorWarn && (
        <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          명세표의 상호가 &apos;{draft.vendorName}&apos;(으)로 보여요. 거래처를 &apos;{vendorName}&apos;(으)로 고른 게 맞는지 확인하세요. 틀렸으면 [버리기] 후
          다시 올려 주세요.
        </p>
      )}
      {duplicates.length > 0 && (
        <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          같은 날 같은 거래처 명세표가 이미 {duplicates.length}장 확정돼 있어요
          {duplicates.some((d) => d.total !== null) && ` (${duplicates.map((d) => formatKRW(d.total)).join(", ")})`}. 같은 명세표를 두 번 올린 건
          아닌지 확인하세요.
        </p>
      )}
      {flaggedCount > 0 && (
        <p className="rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          노란 칸 {flaggedCount}개는 AI가 확실히 읽지 못했어요. 사진을 보고 맞게 고쳐 주세요.
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-5 rounded-xl border bg-card p-4">
        <Field label="거래 날짜" htmlFor="st-date" error={errors.date}>
          <Input
            id="st-date"
            type="date"
            value={date}
            max={today}
            min={minDate}
            onChange={(e) => {
              setDate(e.target.value);
              setDateFlag(false);
            }}
            className={cn("h-10 text-base", dateFlag && FLAG)}
          />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium">품목 (명세표에 적힌 그대로)</p>
          <LineItemsEditor lines={lines} onChange={setLines} suggestions={[]} error={errors.lines} flags={flags} onFieldEdit={unflag} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="부가세 (세액 합계, 없으면 0)" htmlFor="st-vat" error={errors.vat}>
            <Input
              id="st-vat"
              inputMode="numeric"
              value={comma(vat)}
              onChange={(e) => {
                setVat(digits(e.target.value).slice(0, 10));
                setVatFlag(false);
              }}
              className={cn("h-10 text-right text-base tabular-nums", vatFlag && FLAG)}
            />
          </Field>
          <Field
            label="명세표에 적힌 합계 (부가세 포함)"
            htmlFor="st-total"
            error={errors.statementTotal}
            hint={total ? formatKoreanWon(Number(total)) : "합계가 적혀 있으면 넣어 주세요 (비교용)"}
          >
            <Input
              id="st-total"
              inputMode="numeric"
              value={comma(total)}
              onChange={(e) => setTotal(digits(e.target.value).slice(0, 10))}
              className="h-10 text-right text-base tabular-nums"
            />
          </Field>
        </div>

        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            check.status === "ok" && "bg-emerald-50 text-emerald-950",
            check.status === "mismatch" && "bg-red-50 text-red-950",
            check.status === "unknown" && "bg-muted",
          )}
        >
          <p className="flex flex-wrap items-center gap-x-2 font-semibold tabular-nums">
            {check.status === "ok" && <CircleCheck className="size-4" aria-hidden />}
            {check.status === "mismatch" && <TriangleAlert className="size-4" aria-hidden />}
            품목 {formatKRW(linesSum)} + 부가세 {formatKRW(vatNum)} = {formatKRW(linesSum + vatNum)}
          </p>
          <p className="text-xs">
            {check.status === "ok" && "명세표 합계와 같아요."}
            {check.status === "mismatch" &&
              `명세표 합계와 ${formatKRW(Math.abs(check.diff))} ${check.diff > 0 ? "많아요" : "적어요"}. 빠진 줄이나 잘못 읽은 숫자가 없는지 확인하세요.`}
            {check.status === "unknown" && "명세표 합계를 넣으면 맞는지 비교해 줘요."}
          </p>
        </div>

        <Field
          label="명세표에 적힌 잔액·미수 (있으면)"
          htmlFor="st-balance"
          error={errors.statementBalance}
          hint="거래처 장부와 비교하는 데 써요. 없으면 비워 두세요."
        >
          <Input
            id="st-balance"
            inputMode="numeric"
            value={comma(balance)}
            onChange={(e) => setBalance(signed(e.target.value).slice(0, 11))}
            className={cn("h-10 text-right text-base tabular-nums", draft.balanceFlag && balance === draft.balance && FLAG)}
          />
        </Field>

        <label className="flex min-h-10 items-center gap-3 text-base">
          <input type="checkbox" className="size-5" checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} />
          외상 (나중에 결제) — 체크하면 거래처 미수에 더해져요
        </label>

        <Field label="메모 (선택)" htmlFor="st-memo" error={errors.memo}>
          <Input
            id="st-memo"
            value={memo}
            maxLength={200}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 숙주 1박스 반품"
            className="h-10 text-base"
          />
        </Field>

        <label
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-base font-medium",
            errors.checked && "border-destructive",
          )}
        >
          <input type="checkbox" className="size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          사진과 한 줄씩 비교해서 확인했어요
        </label>
        {errors.checked && (
          <p className="text-xs text-destructive" role="alert">
            {errors.checked}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-12 flex-1 text-base" disabled={pending || aiBusy}>
            {pending ? "저장 중…" : `확정 (${formatKRW(linesSum + vatNum)})`}
          </Button>
          <Button type="button" variant="ghost" className="h-12 text-destructive" disabled={pending || aiBusy} onClick={discard}>
            버리기
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          확정하면 식재료 지출로 들어가요{onCredit ? " (외상 → 거래처 미수)" : ""}. 확정 후 고칠 곳이 있으면 대표가 [지출 입력]에서 고쳐요.
        </p>
      </form>
    </div>
  );
}

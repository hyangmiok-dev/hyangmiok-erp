"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decodeCsvBytes, mapSalesCsv, SALES_CSV_TEMPLATE, type ImportError, type ImportRow, type StoreRef } from "@/lib/sales/csv";
import { formatKRW } from "@/lib/format";
import { importSalesAction } from "../actions";

export function ImportClient({ stores }: { stores: StoreRef[] }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("파일이 너무 큽니다 (2MB 이하).");
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      toast.error("엑셀 파일은 '다른 이름으로 저장 → CSV(쉼표로 분리)'로 저장한 뒤 올려주세요.");
      return;
    }
    const text = decodeCsvBytes(await file.arrayBuffer());
    const r = mapSalesCsv(text, stores);
    setFileName(file.name);
    setRows(r.rows);
    setErrors(r.errors);
    setMissingColumns(r.missingColumns);
  }

  function downloadTemplate() {
    const blob = new Blob([SALES_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "향미옥_매출_양식.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function submit() {
    startTransition(async () => {
      const res = await importSalesAction({
        fileName,
        overwrite,
        rows: rows.map((r) => ({
          store_id: r.storeId,
          business_date: r.businessDate,
          net_sales: r.netSales,
          order_count: r.orderCount,
          is_closed: r.isClosed,
          memo: r.memo,
        })),
      });
      if (res.ok) {
        toast.success(res.message);
        setResult(res.message ?? null);
        setRows([]);
        setErrors([]);
      } else toast.error(res.message, { duration: 10000 });
    });
  }

  const total = rows.reduce((s, r) => s + r.netSales, 0);

  return (
    <div className="space-y-6">
      <ol className="list-decimal space-y-1 rounded-lg border bg-muted/30 p-4 pl-8 text-sm">
        <li>
          <button type="button" onClick={downloadTemplate} className="font-medium underline underline-offset-4">
            양식 내려받기
          </button>{" "}
          — 열 이름: <b>날짜, 지점, 실매출, 건수</b> (휴무·메모는 선택)
        </li>
        <li>엑셀에서 채운 뒤 <b>파일 → 다른 이름으로 저장 → CSV (쉼표로 분리)</b></li>
        <li>아래에서 파일을 선택하면 저장 전에 미리보기로 확인합니다.</li>
      </ol>

      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center hover:bg-muted/40">
        <FileUp className="size-7 text-muted-foreground" />
        <span className="font-medium">{fileName || "CSV 파일 선택"}</span>
        <span className="text-xs text-muted-foreground">날짜 예: 2026-10-01, 지점 예: 1호점 / 향미옥 1호점 / S1</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>

      {result && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{result}</p>}

      {missingColumns.length > 0 && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          필수 열이 없습니다: {missingColumns.join(", ")} — 첫 줄(머리글)을 확인하세요.
        </p>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 p-3 text-sm">
          <p className="mb-2 font-medium text-destructive">오류 {errors.length}행 (이 행들은 등록되지 않습니다)</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {errors.map((e) => (
              <li key={e.line}>
                {e.line}행: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm">
            등록 가능 <b>{rows.length}행</b> · 실매출 합계 <b>{formatKRW(total)}</b>
          </p>
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>행</TableHead>
                  <TableHead>날짜</TableHead>
                  <TableHead>지점</TableHead>
                  <TableHead className="text-right">실매출</TableHead>
                  <TableHead className="text-right">건수</TableHead>
                  <TableHead>메모</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.line}>
                    <TableCell>{r.line}</TableCell>
                    <TableCell>{r.businessDate}</TableCell>
                    <TableCell>{r.storeName}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.isClosed ? "휴무" : formatKRW(r.netSales)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.isClosed ? "" : r.orderCount}</TableCell>
                    <TableCell className="text-muted-foreground">{r.memo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="size-5" />
            이미 입력된 날짜는 파일 내용으로 덮어쓰기 (체크 안 하면 건너뜀)
          </label>
          <Button onClick={submit} disabled={pending} className="h-12 w-full text-base">
            {pending ? "등록 중…" : `${rows.length}행 등록하기`}
          </Button>
          <p className="text-xs text-muted-foreground">
            하나라도 저장에 실패하면 전체가 취소됩니다(일부만 저장되지 않음). 모든 등록은 변경 이력에 남습니다.
          </p>
        </div>
      )}
    </div>
  );
}

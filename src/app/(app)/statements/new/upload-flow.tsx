"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AI_IMAGE, ARCHIVE_IMAGE, photoPathFor } from "@/lib/statements";
import { blobToBase64, encodeJpeg, loadImage, readWithAi, uploadPhoto } from "@/lib/statement-client";
import { cn } from "@/lib/utils";
import { createStatementAction } from "../actions";

interface VendorOption {
  id: string;
  name: string;
  items: string | null;
  onCredit: boolean;
  linked: boolean;
}

type Phase = { step: "pick" } | { step: "work"; label: string } | { step: "error"; message: string };

export function UploadFlow({
  storeId,
  storeName,
  vendors,
  monthKey,
}: {
  storeId: string;
  storeName: string;
  vendors: VendorOption[];
  monthKey: string;
}) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  const [seconds, setSeconds] = useState(0);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  const working = phase.step === "work";
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [working]);

  const linked = vendors.filter((v) => v.linked);
  const others = vendors.filter((v) => !v.linked);
  const shown = showAll || linked.length === 0 ? vendors : linked;
  const vendor = vendors.find((v) => v.id === vendorId) ?? null;

  async function onFile(file: File | undefined) {
    if (!file || !vendor) return;
    setSeconds(0);
    let statementId: string | null = null;
    try {
      setPhase({ step: "work", label: "사진을 줄이는 중…" });
      const img = await loadImage(file);
      const [forAi, forKeep] = await Promise.all([encodeJpeg(img, AI_IMAGE), encodeJpeg(img, ARCHIVE_IMAGE)]);

      setPhase({ step: "work", label: "사진을 보관함에 올리는 중…" });
      const path = photoPathFor(storeId, monthKey, crypto.randomUUID());
      await uploadPhoto(path, forKeep);
      const created = await createStatementAction({ storeId, vendorId: vendor.id, photoPath: path, photoBytes: forKeep.size });
      if (!created.ok) throw new Error(created.message);
      statementId = created.id;

      setPhase({ step: "work", label: "AI가 거래명세표를 읽는 중… (보통 20초~1분)" });
      const read = await readWithAi(statementId, await blobToBase64(forAi));
      if (read.ok) toast.success("다 읽었어요. 사진과 한 줄씩 비교해 확인해 주세요.");
      else toast.error(`${read.error} 사진을 보고 직접 적어 주세요.`, { duration: 10000 });
      router.push(`/statements/${statementId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "올리기에 실패했어요.";
      if (statementId) {
        // 사진·기록은 저장됨 → 확인 화면에서 다시 읽거나 직접 적기
        toast.error(message);
        router.push(`/statements/${statementId}`);
        return;
      }
      setPhase({ step: "error", message });
    } finally {
      if (cameraRef.current) cameraRef.current.value = "";
      if (albumRef.current) albumRef.current.value = "";
    }
  }

  if (phase.step === "work") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-12 text-center" role="status" aria-live="polite">
        <Loader2 className="size-10 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-lg font-semibold">{phase.label}</p>
        <p className="text-sm text-muted-foreground">
          {vendor?.name} · {storeName} · {seconds}초
        </p>
        <p className="text-xs text-muted-foreground">이 화면을 닫지 말고 기다려 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="vendor-h">
        <h2 id="vendor-h" className="mb-2 font-semibold">
          ① 거래처 고르기
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="거래처">
          {shown.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={vendorId === v.id}
              onClick={() => setVendorId(v.id)}
              className={cn(
                "min-h-12 rounded-xl border px-3 py-2 text-left text-base",
                vendorId === v.id ? "border-foreground bg-foreground text-background" : "bg-background",
              )}
            >
              <span className="block font-semibold">{v.name}</span>
              {v.items && <span className="block truncate text-xs opacity-70">{v.items}</span>}
            </button>
          ))}
        </div>
        {others.length > 0 && linked.length > 0 && (
          <button type="button" className="mt-2 text-sm underline underline-offset-2" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "이 지점 거래처만 보기" : `다른 거래처도 보기 (${others.length})`}
          </button>
        )}
      </section>

      <section aria-labelledby="photo-h">
        <h2 id="photo-h" className="mb-2 font-semibold">
          ② 사진 찍기
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          명세표 전체가 화면에 꽉 차게, 그림자 없이, 글자가 또렷하게 찍어 주세요. 여러 장이면 한 장씩 올려요.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-14 text-base" disabled={!vendor} onClick={() => cameraRef.current?.click()}>
            <Camera className="size-5" /> 사진 찍기
          </Button>
          <Button type="button" variant="outline" className="h-14 text-base" disabled={!vendor} onClick={() => albumRef.current?.click()}>
            <ImageUp className="size-5" /> 앨범에서 고르기
          </Button>
        </div>
        {!vendor && <p className="mt-2 text-sm text-amber-700">먼저 ① 거래처를 골라 주세요.</p>}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </section>

      {phase.step === "error" && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {phase.message}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        AI가 읽는 데 사진 1장에 약 100~200원이 들어요. 사진은 보관함에 저장되고(지우기 불가), 확정 전까지는 지출에 들어가지 않아요.
      </p>
    </div>
  );
}

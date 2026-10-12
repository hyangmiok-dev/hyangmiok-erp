"use client";

import { useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 거래명세표 사진: 기본은 화면 폭에 맞춤, [크게]를 누르면 2배로 키워 손가락으로 옮겨 본다 */
export function PhotoViewer({ url }: { url: string | null }) {
  const [zoom, setZoom] = useState(false);
  if (!url) {
    return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">사진을 불러오지 못했어요. 새로고침해 보세요.</p>;
  }
  return (
    <div className="rounded-xl border bg-card p-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="text-sm font-medium">거래명세표 사진</span>
        <span className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => !z)}>
            {zoom ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />} {zoom ? "맞추기" : "크게"}
          </Button>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded-md px-2 text-sm underline underline-offset-2">
            새 창
          </a>
        </span>
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-lg lg:max-h-[80vh]">
        {/* eslint-disable-next-line @next/next/no-img-element -- 30분짜리 비공개 서명 주소라 이미지 최적화를 쓰지 않는다 */}
        <img src={url} alt="거래명세표 사진" className={zoom ? "max-w-none" : "w-full"} style={zoom ? { width: "200%" } : undefined} />
      </div>
    </div>
  );
}

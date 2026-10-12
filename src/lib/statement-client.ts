/**
 * 거래명세표 사진 처리 (브라우저 전용): 사진 줄이기, base64 변환, AI 읽기(Edge Function) 호출.
 * Netlify 무료 서버는 10초 제한이 있어서, 오래 걸리는 AI 읽기는 브라우저 → Supabase Edge Function(최대 150초)으로 바로 부른다.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { fitSize } from "@/lib/statements";

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // 휴대폰 사진의 회전(EXIF)은 브라우저가 반영한다
    return img;
  } finally {
    // decode 가 끝나면 그림은 메모리에 있다
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** 비율을 유지해 줄인 JPEG */
export async function encodeJpeg(
  img: HTMLImageElement,
  spec: { maxEdge: number; maxPixels: number; quality: number },
): Promise<Blob> {
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, spec.maxEdge, spec.maxPixels);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이 휴대폰에서는 사진을 줄일 수 없어요.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", spec.quality));
  if (!blob) throw new Error("사진을 JPEG 로 바꾸지 못했어요.");
  return blob;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("사진을 읽지 못했어요."));
    r.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** 보관함(비공개)에 올리기 — 경로의 첫 폴더(지점)로 DB 가 권한을 확인한다 */
export async function uploadPhoto(path: string, blob: Blob): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from("statements").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(error.message.includes("row-level security") ? "이 지점에 사진을 올릴 권한이 없어요." : "사진 올리기에 실패했어요. 인터넷 연결을 확인하세요.");
}

/** AI 읽기. image 를 안 주면 보관된 사진으로 다시 읽는다 */
export async function readWithAi(statementId: string, image?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("read-statement", { body: image ? { statementId, image } : { statementId } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "AI 읽기에 실패했어요." };
    }
    return { ok: false, error: "AI 읽기 서버에 연결하지 못했어요. 잠시 후 다시 해 주세요." };
  }
  const body = data as { ok?: boolean; error?: string } | null;
  return body?.ok ? { ok: true } : { ok: false, error: body?.error ?? "AI 가 읽지 못했어요. 직접 적어 주세요." };
}

import { readPngDataUrl } from "./image";

export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("clipboardUnavailable");
  await navigator.clipboard.writeText(text);
}

export async function copyPng(dataUrl: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem !== "function")
    throw new Error("clipboardUnavailable");
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": readPngDataUrl(dataUrl) }),
  ]);
}

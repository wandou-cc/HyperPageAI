import type { SelectionSnapshot } from "./messages";

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const IMAGE_BYTE_LIMIT = 5 * 1024 * 1024;
export const IMAGE_PIXEL_LIMIT = 16_000_000;

export function validateImageCrop(crop: CropRegion, width: number, height: number): void {
  if (![crop.x, crop.y, crop.width, crop.height, width, height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > width || crop.y + crop.height > height)
    throw new Error("imageCropInvalid");
}

export function readPngDataUrl(dataUrl: string): Blob {
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix) || dataUrl.length > prefix.length + Math.ceil(IMAGE_BYTE_LIMIT / 3) * 4) throw new Error("imageAttachmentInvalid");
  const encoded = dataUrl.slice(prefix.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("imageAttachmentInvalid");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.length > IMAGE_BYTE_LIMIT || bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
    ![73, 72, 68, 82].every((byte, index) => bytes[index + 12] === byte)) throw new Error("imageAttachmentInvalid");
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (!width || !height || width * height > IMAGE_PIXEL_LIMIT) throw new Error("imageAttachmentInvalid");
  return new Blob([bytes], { type: "image/png" });
}

export async function blobToImageDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export async function normalizeImageBlob(blob: Blob): Promise<string> {
  if (!blob.type.startsWith("image/") || blob.size > IMAGE_BYTE_LIMIT) throw new Error("imageAttachmentInvalid");
  const bitmap = await createImageBitmap(blob);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > IMAGE_PIXEL_LIMIT) throw new Error("imageAttachmentInvalid");
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("imageContextUnavailable");
    context.drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    if (png.size > IMAGE_BYTE_LIMIT) throw new Error("imageAttachmentInvalid");
    return await blobToImageDataUrl(png);
  } finally { bitmap.close(); }
}

export async function cropImage(dataUrl: string, crop: CropRegion): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  const bitmap = await createImageBitmap(readPngDataUrl(dataUrl));
  try {
    validateImageCrop(crop, bitmap.width, bitmap.height);
    if (crop.width * crop.height > IMAGE_PIXEL_LIMIT) throw new Error("imageAttachmentInvalid");
    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("imageContextUnavailable");
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (blob.size > IMAGE_BYTE_LIMIT) throw new Error("imageAttachmentInvalid");
    return { dataUrl: await blobToImageDataUrl(blob), width: crop.width, height: crop.height, bytes: blob.size };
  } finally { bitmap.close(); }
}

// Maps a visible CSS-pixel selection rectangle onto captured bitmap pixels.
export function calculateCropRegion(
  selection: SelectionSnapshot,
  imageWidth: number,
  imageHeight: number,
): CropRegion {
  const left = Math.max(0, selection.rect.x);
  const top = Math.max(0, selection.rect.y);
  const right = Math.min(
    selection.viewport.width,
    selection.rect.x + selection.rect.width,
  );
  const bottom = Math.min(
    selection.viewport.height,
    selection.rect.y + selection.rect.height,
  );

  if (right <= left || bottom <= top) {
    throw new Error("selectionOutsideViewport");
  }

  const scaleX = imageWidth / selection.viewport.width;
  const scaleY = imageHeight / selection.viewport.height;
  const x = Math.floor(left * scaleX);
  const y = Math.floor(top * scaleY);
  const rightPixel = Math.min(imageWidth, Math.ceil(right * scaleX));
  const bottomPixel = Math.min(imageHeight, Math.ceil(bottom * scaleY));

  return {
    x,
    y,
    width: rightPixel - x,
    height: bottomPixel - y,
  };
}

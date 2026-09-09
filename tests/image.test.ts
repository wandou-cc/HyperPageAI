import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";

import { calculateCropRegion, normalizeImageBlob, readPngDataUrl, validateImageCrop, IMAGE_BYTE_LIMIT, IMAGE_PIXEL_LIMIT } from "../shared/image";
import { checkCaptureArea } from "../lib/capture-guard";
import type { SelectionSnapshot } from "../shared/messages";

// Creates a complete geometry fixture while allowing each crop case to set its rectangle.
function selectionAt(
  x: number,
  y: number,
  width: number,
  height: number,
): SelectionSnapshot {
  return {
    kind: "image",
    tagName: "img",
    text: "",
    accessibleName: "",
    role: "",
    editable: false,
    rect: { x, y, width, height },
    viewport: { width: 1000, height: 500 },
  };
}

describe("screenshot crop geometry", () => {
  it("maps CSS coordinates to a high-density screenshot", () => {
    expect(calculateCropRegion(selectionAt(100, 50, 300, 100), 2000, 1000)).toEqual({
      x: 200,
      y: 100,
      width: 600,
      height: 200,
    });
  });

  it("clips an element to the current visible viewport", () => {
    expect(calculateCropRegion(selectionAt(-50, 450, 200, 100), 1000, 500)).toEqual({
      x: 0,
      y: 450,
      width: 150,
      height: 50,
    });
  });

  it("rejects a selection fully outside the viewport", () => {
    expect(() =>
      calculateCropRegion(selectionAt(1100, 20, 100, 100), 1000, 500),
    ).toThrow("selectionOutsideViewport");
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("resource image normalization", () => {
  it("decodes original image bytes to PNG and releases the bitmap", async () => {
    const png = new NodeBlob([readFileSync("public/icon/32.png")], { type: "image/png" });
    const bitmap = { width: 32, height: 32, close: vi.fn() };
    const decode = vi.fn().mockResolvedValue(bitmap);
    const drawImage = vi.fn();
    const encode = vi.fn().mockResolvedValue(png);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() { return { drawImage }; }
      convertToBlob = encode;
    });
    const original = new Blob(["jpeg image bytes"], { type: "image/jpeg" });
    const result = await normalizeImageBlob(original);
    expect(decode).toHaveBeenCalledWith(original);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(encode).toHaveBeenCalledWith({ type: "image/png" });
    expect(readPngDataUrl(result).size).toBe(png.size);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("rejects invalid types and excessive image sizes before drawing", async () => {
    const bitmap = { width: IMAGE_PIXEL_LIMIT + 1, height: 1, close: vi.fn() };
    const decode = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    for (const blob of [new Blob(["login"], { type: "text/html" }), new Blob([new Uint8Array(IMAGE_BYTE_LIMIT + 1)], { type: "image/png" })]) {
      await expect(normalizeImageBlob(blob)).rejects.toThrow("imageAttachmentInvalid");
    }
    expect(decode).not.toHaveBeenCalled();
    await expect(normalizeImageBlob(new Blob(["image"], { type: "image/png" }))).rejects.toThrow("imageAttachmentInvalid");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});

describe("image input and capture protection", () => {
  it("accepts a packaged PNG and rejects remote URLs, invalid payloads and excessive decoded dimensions", () => {
    const png = readFileSync("public/icon/32.png");
    expect(readPngDataUrl(`data:image/png;base64,${png.toString("base64")}`).size).toBe(png.length);
    for (const data of ["https://example.com/private.png", "data:image/png;base64,not png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AAAA"]) expect(() => readPngDataUrl(data)).toThrow("imageAttachmentInvalid");
    const huge = Buffer.from(png);
    huge.writeUInt32BE(100_000, 16);
    huge.writeUInt32BE(100_000, 20);
    expect(() => readPngDataUrl(`data:image/png;base64,${huge.toString("base64")}`)).toThrow("imageAttachmentInvalid");
  });

  it("rejects invalid pixel crops without clamping the user's selected area", () => {
    expect(() => validateImageCrop({ x: 4, y: 5, width: 10, height: 20 }, 32, 32)).not.toThrow();
    for (const crop of [
      { x: -1, y: 0, width: 10, height: 10 }, { x: 0.5, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 }, { x: 30, y: 0, width: 10, height: 10 },
    ]) expect(() => validateImageCrop(crop, 32, 32)).toThrow("imageCropInvalid");
  });

  it("blocks visible sensitive and opaque embedded areas without reading field values", () => {
    document.body.innerHTML = '<input autocomplete="one-time-code" value="private"><iframe></iframe>';
    vi.spyOn(HTMLInputElement.prototype, "value", "get").mockImplementation(() => { throw new Error("Value read"); });
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const field = document.querySelector("input");
    const frame = document.querySelector("iframe");
    if (!field || !frame) throw new Error("Missing capture fixture");
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 100, 30));
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(200, 10, 100, 30));
    expect(() => checkCaptureArea({ x: 0, y: 0, width: 150, height: 100 }, viewport)).toThrow("captureAreaProtected");
    expect(() => checkCaptureArea({ x: 180, y: 0, width: 150, height: 100 }, viewport)).toThrow("captureAreaProtected");
    expect(() => checkCaptureArea({ x: 0, y: 100, width: 150, height: 100 }, viewport)).not.toThrow();
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10_000, 100, 30));
    frame.remove();
    expect(() => checkCaptureArea({ x: 0, y: 0, width: 150, height: 20_000 }, viewport)).not.toThrow();
    expect(() => checkCaptureArea({ x: 0, y: 0, width: 150, height: 100 }, { width: 2, height: 2 })).toThrow("requestContextChanged");
  });
});

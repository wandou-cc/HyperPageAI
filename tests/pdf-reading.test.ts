// @vitest-environment node
import { File } from "node:buffer";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadPdfFile } from "../lib/pdf-reading";
import { getFileCitations } from "../shared/files";

function fixture(): File {
  const stream = (value: string) =>
    `<< /Length ${value.length} >>\nstream\n${value}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream("BT /F1 12 Tf 20 380 Td (First page text.) Tj ET"),
    stream("BT /F1 12 Tf 20 380 Td (Second page text.) Tj ET"),
    "<< /Type /Outlines /First 9 0 R /Last 9 0 R /Count 1 >>",
    "<< /Title (Second chapter) /Parent 8 0 R /Dest [4 0 R /Fit] >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([pdf], "report.pdf");
}

describe("local PDF extraction", () => {
  it("extracts real page text, page citations and outline destinations without an AI request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const progress = vi.fn();
    const loaded = await loadPdfFile(
      fixture(),
      {
        standardFontDataUrl: `${resolve("node_modules/pdfjs-dist/standard_fonts")}/`,
      },
      progress,
    );
    try {
      expect(loaded.snapshot.pageCount).toBe(2);
      expect(
        loaded.snapshot.blocks.map((block) => [block.text, block.pageNumber]),
      ).toEqual([
        ["First page text.", 1],
        ["Second page text.", 2],
      ]);
      expect(loaded.outline).toEqual([
        { title: "Second chapter", pageNumber: 2, depth: 0 },
      ]);
      expect(getFileCitations(loaded.snapshot)[1]).toMatchObject({
        blockId: "2.1",
        pageNumber: 2,
        title: "report.pdf",
        documentId: loaded.snapshot.id,
      });
      expect(progress).toHaveBeenLastCalledWith(2, 2);
      expect(
        (await loaded.document.getPage(2)).getViewport({ scale: 1 }),
      ).toMatchObject({ width: 300, height: 400 });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await loaded.document.loadingTask.destroy();
      fetch.mockRestore();
    }
  });

  it("rejects non-PDF files, oversized input and malformed PDF data", async () => {
    await expect(
      loadPdfFile(new File(["text"], "report.txt"), {}, vi.fn()),
    ).rejects.toThrow("pdfFileInvalid");
    const oversized = new File(["%PDF-1.7"], "report.pdf");
    Object.defineProperty(oversized, "size", { value: 20 * 1024 * 1024 + 1 });
    await expect(loadPdfFile(oversized, {}, vi.fn())).rejects.toThrow(
      "pdfFileInvalid",
    );
    await expect(
      loadPdfFile(new File(["not a PDF"], "report.pdf"), {}, vi.fn()),
    ).rejects.toThrow("Invalid PDF structure");
  });
});

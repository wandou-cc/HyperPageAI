import {
  getDocument,
  PasswordException,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";
import { z } from "zod";
import type { FileReadingSnapshot } from "../shared/messages";

import { PDF_FILE_BYTE_LIMIT } from "../shared/files";
export const PDF_PAGE_LIMIT = 500;
export interface PdfOutlineEntry {
  title: string;
  pageNumber: number | null;
  depth: number;
}
export interface LoadedPdf {
  document: PDFDocumentProxy;
  snapshot: FileReadingSnapshot;
  outline: PdfOutlineEntry[];
}

const outlineNodeSchema = z.object({
  title: z.string(),
  dest: z.union([z.string(), z.array(z.unknown()), z.null()]),
  items: z.array(z.unknown()),
});
const referenceSchema = z.object({
  num: z.number().int().nonnegative(),
  gen: z.number().int().nonnegative(),
});

async function readOutline(
  document: PDFDocumentProxy,
): Promise<PdfOutlineEntry[]> {
  const source: unknown = await document.getOutline();
  const parsed = z.array(z.unknown()).nullable().safeParse(source);
  if (!parsed.success) throw new Error("pdfOutlineInvalid");
  const entries: PdfOutlineEntry[] = [];
  async function walk(items: unknown[], depth: number): Promise<void> {
    if (depth > 30) throw new Error("pdfOutlineInvalid");
    for (const value of items) {
      const result = outlineNodeSchema.safeParse(value);
      if (!result.success) throw new Error("pdfOutlineInvalid");
      const node = result.data;
      const destination: unknown =
        typeof node.dest === "string"
          ? await document.getDestination(node.dest)
          : node.dest;
      let pageNumber: number | null = null;
      if (destination !== null) {
        if (!Array.isArray(destination) || !destination.length)
          throw new Error("pdfOutlineInvalid");
        const target: unknown = destination[0];
        if (typeof target === "number" && Number.isInteger(target))
          pageNumber = target + 1;
        else {
          const reference = referenceSchema.safeParse(target);
          if (!reference.success) throw new Error("pdfOutlineInvalid");
          pageNumber = (await document.getPageIndex(reference.data)) + 1;
        }
        if (pageNumber < 1 || pageNumber > document.numPages)
          throw new Error("pdfOutlineInvalid");
      }
      entries.push({ title: node.title, pageNumber, depth });
      await walk(node.items, depth + 1);
    }
  }
  if (parsed.data) await walk(parsed.data, 0);
  return entries;
}

export async function loadPdfFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  options: Pick<
    DocumentInitParameters,
    "password" | "cMapUrl" | "standardFontDataUrl" | "wasmUrl" | "iccUrl"
  >,
  onProgress: (completed: number, total: number) => void,
): Promise<LoadedPdf> {
  if (!/\.pdf$/i.test(file.name) || file.size > PDF_FILE_BYTE_LIMIT)
    throw new Error("pdfFileInvalid");
  const loading = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    ...options,
    cMapPacked: true,
    stopAtErrors: true,
    enableXfa: false,
    useSystemFonts: false,
  });
  try {
    const document = await loading.promise;
    if (document.numPages > PDF_PAGE_LIMIT) throw new Error("pdfTooManyPages");
    const snapshot: FileReadingSnapshot = {
      id: crypto.randomUUID(),
      name: file.name,
      format: "pdf",
      pageCount: document.numPages,
      blocks: [],
    };
    for (let number = 1; number <= document.numPages; number++) {
      onProgress(number - 1, document.numPages);
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) =>
          "str" in item ? [item.str, item.hasEOL ? "\n" : ""] : [],
        )
        .join("")
        .trim();
      if (text)
        snapshot.blocks.push({
          id: `${number}.1`,
          text,
          heading: "",
          headingLevel: null,
          pageNumber: number,
        });
      page.cleanup();
    }
    const outline = await readOutline(document);
    onProgress(document.numPages, document.numPages);
    return { document, snapshot, outline };
  } catch (failure) {
    await loading.destroy();
    if (failure instanceof PasswordException)
      throw new Error("pdfPasswordRequired");
    throw failure;
  }
}

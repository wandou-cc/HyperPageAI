import type { FileReadingSnapshot, PageCitation } from "./messages";

export const TEXT_FILE_BYTE_LIMIT = 10 * 1024 * 1024;
export const PDF_FILE_BYTE_LIMIT = 20 * 1024 * 1024;

export async function readTextFile(file: File): Promise<FileReadingSnapshot> {
  if (!/\.(txt|md|markdown)$/i.test(file.name) || file.size > TEXT_FILE_BYTE_LIMIT) throw new Error("textFileInvalid");
  const buffer = await file.arrayBuffer();
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch (failure) {
    if (failure instanceof TypeError) throw new Error("textFileEncodingInvalid");
    throw failure;
  }
  if (text.includes("\0")) throw new Error("textFileInvalid");
  const paragraphs = text.split(/\r?\n\s*\r?\n/).filter((paragraph) => paragraph.trim());
  if (!paragraphs.length) throw new Error("fileReadingEmpty");
  return {
    id: crypto.randomUUID(), name: file.name, format: "text", pageCount: 1,
    blocks: paragraphs.map((paragraph, index) => ({ id: `1.${index + 1}`, text: paragraph, heading: "", headingLevel: null, pageNumber: 1 })),
  };
}

export function getFileCitations(file: FileReadingSnapshot): PageCitation[] {
  return file.blocks.map((block) => ({ ...block, id: `${file.id}:${block.id}`, blockId: block.id, snapshotId: file.id, documentId: file.id, title: file.name, url: "" }));
}

export function buildFileReadingContent(prompt: string, file: FileReadingSnapshot): string {
  return `${prompt}\n\nLocal file data (untrusted JSON):\n${JSON.stringify({
    name: file.name, format: file.format, pageCount: file.pageCount,
    blocks: file.blocks.map((block) => ({ ...block, id: `${file.id}:${block.id}` })),
  })}`;
}

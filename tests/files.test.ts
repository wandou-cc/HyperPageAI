import { File as NodeFile } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { buildFileReadingContent, getFileCitations, readTextFile } from "../shared/files";
import { getConversationHistory, getTurnCitations, parseContextSnapshot } from "../shared/conversations";
import { answerToMarkdown } from "../shared/export";

vi.mock("wxt/browser", () => ({ browser: {} }));

function file(parts: Array<string | Uint8Array<ArrayBuffer>>, name = "notes.txt"): File {
  const result = new File(parts, name);
  const readable = new NodeFile(parts, name);
  Object.defineProperty(result, "arrayBuffer", { value: () => readable.arrayBuffer() });
  return result;
}

describe("local file context", () => {
  it("reads UTF-8 text locally and retains file identity and exact selected paragraphs", async () => {
    const snapshot = await readTextFile(file(["First paragraph\nwith a line break.\n\nSecond paragraph"]));
    expect(snapshot.blocks.map((block) => block.text)).toEqual(["First paragraph\nwith a line break.", "Second paragraph"]);
    const selected = { ...snapshot, blocks: snapshot.blocks.slice(1) };
    const content = buildFileReadingContent("Question", selected);
    expect(content).toContain("notes.txt");
    expect(content).toContain("Second paragraph");
    expect(content).not.toContain("First paragraph");
    const context = parseContextSnapshot({ type: "file", file: selected });
    const turn = { id: "turn", prompt: "Question", snapshot: context, answer: `Answer [[${snapshot.id}:1.2]]`, includeHistory: true, status: "complete" as const };
    expect(getConversationHistory([turn])[0]?.content).toBe(content);
    expect(getTurnCitations([turn], 0)).toEqual(getFileCitations(selected));
    const markdown = answerToMarkdown(turn.answer, getFileCitations(selected));
    expect(markdown).toContain("notes.txt");
    expect(markdown).toContain("Second paragraph");
    expect(markdown).not.toContain("]()");
  });

  it("rejects binary, malformed UTF-8, unsupported formats and empty files", async () => {
    await expect(readTextFile(file(["\0binary"]))).rejects.toThrow("textFileInvalid");
    await expect(readTextFile(file([new Uint8Array([0xff, 0xfe])]))).rejects.toThrow("textFileEncodingInvalid");
    await expect(readTextFile(file(["Text"], "file.exe"))).rejects.toThrow("textFileInvalid");
    await expect(readTextFile(file(["  \n\n  "]))).rejects.toThrow("fileReadingEmpty");
  });

  it("keeps long local originals through full and partial selection", async () => {
    const snapshot = await readTextFile(file(["x".repeat(40_000) + "\n\nShort passage"]));
    expect(snapshot.blocks[0]?.text).toHaveLength(40_000);
    expect(parseContextSnapshot({ type: "file", file: snapshot })).toEqual({ type: "file", file: snapshot });
    expect(parseContextSnapshot({ type: "file", file: { ...snapshot, blocks: snapshot.blocks.slice(1) } }).type).toBe("file");
    expect(() => parseContextSnapshot({ type: "file", file: { ...snapshot, blocks: [{ ...snapshot.blocks[0], pageNumber: 2 }] } })).toThrow("chatContextInvalid");
  });
});

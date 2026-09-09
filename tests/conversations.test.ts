import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONVERSATION_STORAGE_PREFIX,
  deleteConversation,
  exportConversations,
  getConversationHistory,
  getTurnCitations,
  importConversations,
  loadConversations,
  parseContextSnapshot,
  parseSavedConversation,
  saveConversation,
  type ConversationTurn,
  type SavedConversation,
} from "../shared/conversations";
import { conversationToMarkdown, markdownToText } from "../shared/export";

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("wxt/browser", () => ({ browser: { storage: { local: storage } } }));
const turn: ConversationTurn = {
  id: "turn",
  prompt: "Question",
  snapshot: {
    type: "page",
    page: {
      id: "page-a",
      title: "Article",
      url: "https://example.com",
      blocks: [
        { id: "1.1", text: "Original", heading: "Heading", headingLevel: null },
      ],
    },
  },
  includeHistory: true,
  answer: "Answer [[page-a:1.1]]",
  status: "complete",
};
const record: SavedConversation = parseSavedConversation({
  version: 1,
  id: "acda0ef6-e179-463a-a5ca-e62846c0ba47",
  name: "Research",
  title: "Article",
  url: "https://example.com",
  createdAt: 1,
  updatedAt: 2,
  turns: [turn],
});

beforeEach(() => {
  vi.clearAllMocks();
  storage.get.mockResolvedValue({});
  storage.set.mockResolvedValue(undefined);
  storage.remove.mockResolvedValue(undefined);
});

describe("conversation data", () => {
  it("preserves long legacy archives through load, replay, save and export", async () => {
    if (turn.snapshot.type !== "page") throw new Error("Missing page fixture");
    const text = "x".repeat(800_000);
    const snapshot = { ...turn.snapshot, page: { ...turn.snapshot.page, blocks: [{ ...turn.snapshot.page.blocks[0], text }] } };
    const legacy = { ...record, turns: [{ ...turn, snapshot: { ...snapshot, processing: "chunked" } }] };
    storage.get.mockResolvedValue({ [`${CONVERSATION_STORAGE_PREFIX}${record.id}`]: legacy });
    const records = await loadConversations();
    expect(records[0]?.turns[0]?.snapshot).toEqual(snapshot);
    expect(parseContextSnapshot(snapshot)).toEqual(snapshot);
    expect(getConversationHistory(records[0]!.turns)[0]?.content).toContain(text);
    await saveConversation(records[0]);
    const archive = exportConversations(records);
    expect(archive).not.toContain('"processing"');
    expect(archive).toContain(text);
    await importConversations(archive);
    expect(Object.values(storage.set.mock.calls.at(-1)?.[0] ?? {})[0]).toMatchObject({ turns: [{ snapshot }] });
    expect(() => parseSavedConversation({ ...record, turns: [{ ...turn, snapshot: { ...snapshot, processing: "unknown" } }] })).toThrow("conversationsInvalid");
  });

  it("preserves image attachments in history and archives and rejects invalid stored images", async () => {
    const image = { id: crypto.randomUUID(), name: "Chart", dataUrl: `data:image/png;base64,${readFileSync("public/icon/32.png").toString("base64")}` };
    const snapshot = parseContextSnapshot({ type: "image", image });
    const imageTurn = { ...turn, snapshot };
    expect(getConversationHistory([imageTurn])[0]).toMatchObject({ role: "user", imageDataUrl: image.dataUrl });
    const archive = exportConversations([parseSavedConversation({ ...record, turns: [imageTurn] })]);
    await importConversations(archive);
    expect(Object.values(storage.set.mock.calls[0]![0])[0]).toMatchObject({ turns: [expect.objectContaining({ snapshot })] });
    const invalid = { type: "image", image: { ...image, dataUrl: "https://example.com/private.png" } };
    expect(() => parseContextSnapshot(invalid)).toThrow("chatContextInvalid");
    expect(() => parseSavedConversation({ ...record, turns: [{ ...turn, snapshot: invalid }] })).toThrow("conversationsInvalid");
    storage.set.mockClear();
    await expect(importConversations(archive.replace(image.dataUrl, "data:image/png;base64,AAAA"))).rejects.toThrow("conversationsInvalid");
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("preserves multiple source snapshots through history and exports and rejects duplicate sources", () => {
    if (turn.snapshot.type !== "page") throw new Error("Missing page fixture");
    const page = turn.snapshot.page;
    const snapshot = parseContextSnapshot({ type: "elements", pages: [page, { ...page, id: "page-b", blocks: [{ ...page.blocks[0], text: "Second original" }] }] });
    const elementTurn = { ...turn, snapshot, answer: "Answer [[page-a:1.1]] [[page-b:1.1]]" };
    expect(getConversationHistory([elementTurn])[0]?.content).toContain("Second original");
    expect(getTurnCitations([elementTurn], 0).map((item) => item.id)).toEqual(["page-a:1.1", "page-b:1.1"]);
    expect(exportConversations([parseSavedConversation({ ...record, turns: [elementTurn] })])).toContain("Second original");
    const longPages = [
      { ...page, blocks: [{ ...page.blocks[0], text: "x".repeat(20_000) }] },
      { ...page, id: "page-b", blocks: [{ ...page.blocks[0], text: "x".repeat(20_000) }] },
    ];
    expect(parseContextSnapshot({ type: "elements", pages: longPages })).toEqual({ type: "elements", pages: longPages });
    for (const pages of [[], [page, page]]) expect(() => parseContextSnapshot({ type: "elements", pages })).toThrow("chatContextInvalid");
  });

  it("builds history from completed snapshots without adding unfinished answers", () => {
    const history = getConversationHistory([
      turn,
      { ...turn, id: "failed", status: "failed", answer: "Partial" },
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]?.content).toContain("Original");
    expect(history[0]?.content).toContain('"id":"page-a:1.1"');
    expect(history[1]?.content).toBe(turn.answer);
  });

  it("distinguishes identical paragraph numbers from different page snapshots", () => {
    if (turn.snapshot.type !== "page") throw new Error("Missing page fixture");
    const other = {
      ...turn,
      id: "second",
      snapshot: {
        type: "page" as const,
        page: { ...turn.snapshot.page, id: "page-b" },
      },
    };
    expect(
      getTurnCitations([turn, other], 1).map((citation) => citation.id),
    ).toEqual(["page-a:1.1", "page-b:1.1"]);
    expect(
      getTurnCitations([turn, { ...other, includeHistory: false }], 1).map(
        (citation) => citation.id,
      ),
    ).toEqual(["page-b:1.1"]);
  });

  it("saves and deletes only the explicitly selected conversation", async () => {
    await loadConversations();
    expect(storage.set).not.toHaveBeenCalled();
    await saveConversation(record);
    expect(storage.set).toHaveBeenCalledWith({
      [`${CONVERSATION_STORAGE_PREFIX}${record.id}`]: record,
    });
    storage.get.mockResolvedValue({
      [`${CONVERSATION_STORAGE_PREFIX}${record.id}`]: record,
      "hyperpage.settings": { apiKey: "never-export" },
    });
    expect(await loadConversations()).toEqual([record]);
    expect(exportConversations(await loadConversations())).not.toContain(
      "never-export",
    );
    await deleteConversation(record.id);
    expect(storage.remove).toHaveBeenCalledWith(
      `${CONVERSATION_STORAGE_PREFIX}${record.id}`,
    );
  });

  it("imports valid archives under new IDs and rejects the entire invalid archive", async () => {
    await importConversations(exportConversations([record]));
    const written = storage.set.mock.calls[0]?.[0];
    expect(Object.keys(written)).toHaveLength(1);
    expect(Object.keys(written)[0]).not.toBe(
      `${CONVERSATION_STORAGE_PREFIX}${record.id}`,
    );
    expect(Object.values(written)[0]).toMatchObject({
      name: record.name,
      turns: record.turns,
    });
    storage.set.mockClear();
    for (const text of [
      "broken",
      JSON.stringify({
        kind: "hyperpage.conversations",
        version: 2,
        conversations: [record],
      }),
      JSON.stringify({
        kind: "hyperpage.conversations",
        version: 1,
        conversations: [
          record,
          { ...record, turns: [{ ...turn, status: "streaming" }] },
        ],
      }),
    ]) {
      await expect(importConversations(text)).rejects.toThrow(
        "conversationsInvalid",
      );
    }
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("validates replay snapshots and surfaces invalid local records", async () => {
    expect(() =>
      parseContextSnapshot({ type: "none", secret: "unexpected" }),
    ).toThrow("chatContextInvalid");
    if (turn.snapshot.type !== "page") throw new Error("Missing page fixture");
    const page = turn.snapshot.page;
    expect(() =>
      parseContextSnapshot({
        type: "page",
        page: {
          ...page,
          blocks: [
            {
              id: "1.1",
              heading: "",
              headingLevel: null,
              text: "",
            },
          ],
        },
      }),
    ).toThrow("chatContextInvalid");
    storage.get.mockResolvedValue({
      [`${CONVERSATION_STORAGE_PREFIX}wrong-id`]: record,
    });
    await expect(loadConversations()).rejects.toThrow("conversationsInvalid");
  });
});

describe("conversation export", () => {
  it("retains source passages and marks unfinished output", () => {
    const markdown = conversationToMarkdown(
      [
        turn,
        { ...turn, id: "partial", status: "cancelled", answer: "Partial" },
      ],
      { user: "User", assistant: "Assistant", incomplete: "Incomplete" },
    );
    expect(markdown).toContain("Original");
    expect(markdown).toContain("https://example.com");
    expect(markdown).toContain("Incomplete");
  });
  it("exports readable plain text including tables and code", () => {
    const text = markdownToText(
      "# Title\n\n**Bold** and [link](https://example.com)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```",
    );
    expect(text).toBe("Title\n\nBold and link\n\nA\tB\n1\t2\n\nconst x = 1;");
  });
});

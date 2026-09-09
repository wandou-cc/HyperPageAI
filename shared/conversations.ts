import { browser } from "wxt/browser";
import { z } from "zod";
import type {
  ChatContextSnapshot,
  ChatModelMessage,
  PageCitation,
} from "./messages";
import {
  buildPageReadingContent,
  getPageCitations,
} from "./page-reading";
import { buildSelectedElementUserContent } from "./prompts";
import { buildFileReadingContent, getFileCitations } from "./files";
import { youtubeVideoId } from "./video";
import { readPngDataUrl } from "./image";

z.config({ jitless: true });

const point = z.number().finite();
const selectionSchema = z
  .object({
    kind: z.enum(["text", "image", "video", "canvas", "editable", "element"]),
    tagName: z.string(),
    text: z.string(),
    accessibleName: z.string(),
    role: z.string(),
    editable: z.boolean(),
    rect: z
      .object({
        x: point,
        y: point,
        width: point.nonnegative(),
        height: point.nonnegative(),
      })
      .strict(),
    viewport: z
      .object({ width: point.nonnegative(), height: point.nonnegative() })
      .strict(),
  })
  .strict();
const pageSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    videoId: z.string().regex(/^[\w-]{11}$/).optional(),
    sourceKind: z.enum(["search", "article"]).optional(),
    url: z
      .url()
      .refine((url) => ["http:", "https:"].includes(new URL(url).protocol)),
    blocks: z
      .array(
        z
          .object({
            id: z.string().regex(/^\d+\.\d+$/),
            text: z.string(),
            heading: z.string(),
            headingLevel: z.number().int().min(1).max(6).nullable(),
            timeSeconds: z.number().finite().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .refine(
    (page) =>
      new Set(page.blocks.map((block) => block.id)).size ===
        page.blocks.length &&
      page.blocks.every((block) => block.text.trim().length > 0 && (page.videoId ? block.timeSeconds !== undefined : block.timeSeconds === undefined)) &&
      (!page.videoId || youtubeVideoId(page.url) === page.videoId),
  );

const fileSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(255), format: z.enum(["text", "pdf"]), pageCount: z.number().int().min(1),
  blocks: z.array(z.object({
    id: z.string().regex(/^\d+\.\d+$/), text: z.string().refine((text) => Boolean(text.trim())),
    heading: z.string(), headingLevel: z.number().int().min(1).max(6).nullable(), pageNumber: z.number().int().min(1),
  }).strict()).min(1),
}).strict().refine((file) => new Set(file.blocks.map((block) => block.id)).size === file.blocks.length &&
  file.blocks.every((block) => block.pageNumber <= file.pageCount) && (file.format !== "text" || file.pageCount === 1));

const snapshotSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("image"), image: z.object({
    id: z.uuid(), name: z.string().min(1).max(255), dataUrl: z.string().refine((value) => {
      try { readPngDataUrl(value); return true; }
      catch { return false; }
    }),
  }).strict() }).strict(),
  z
    .object({ type: z.literal("selection"), selection: selectionSchema })
    .strict(),
  z.object({ type: z.literal("page"), page: pageSchema }).strict(),
  z.object({ type: z.literal("elements"), pages: z.array(pageSchema).min(1) }).strict().refine(
    ({ pages }) => new Set(pages.map((page) => page.id)).size === pages.length,
  ),
  z.object({ type: z.literal("file"), file: fileSchema }).strict(),
]);

// Preserve archived source text while removing the retired processing preference.
const legacySnapshotSchema = z.object({
  type: z.enum(["page", "elements", "file"]), processing: z.literal("chunked"),
}).passthrough().transform(({ processing: _removed, ...snapshot }): unknown => snapshot).pipe(snapshotSchema);
const storedSnapshotSchema = z.union([snapshotSchema, legacySnapshotSchema]);

export const conversationTurnSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().trim().min(1),
    snapshot: storedSnapshotSchema,
    includeHistory: z.boolean(),
    webSearch: z.boolean().optional(),
    answer: z.string(),
    status: z.enum(["complete", "cancelled", "failed"]),
  })
  .strict()
  .refine((turn) => turn.status !== "complete" || Boolean(turn.answer.trim()));

export interface ConversationTurn {
  id: string;
  prompt: string;
  snapshot: ChatContextSnapshot;
  includeHistory: boolean;
  webSearch?: boolean;
  answer: string;
  status: "streaming" | "complete" | "cancelled" | "failed";
}

const conversationSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    url: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ||
          (url.protocol === "chrome-extension:" && ["/documents.html", "/research.html"].includes(url.pathname) && !url.search && !url.hash && !url.username && !url.password);
      }),
    title: z.string(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    turns: z.array(conversationTurnSchema).min(1),
  })
  .strict()
  .refine(
    (record) =>
      record.updatedAt >= record.createdAt &&
      new Set(record.turns.map((turn) => turn.id)).size === record.turns.length,
  );

export type SavedConversation = z.infer<typeof conversationSchema>;
export const CONVERSATION_STORAGE_PREFIX = "hyperpage.conversation.";

export function parseContextSnapshot(value: unknown): ChatContextSnapshot {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) throw new Error("chatContextInvalid");
  return result.data;
}

export function buildTurnContent(
  prompt: string,
  snapshot: ChatContextSnapshot,
): string {
  switch (snapshot.type) {
    case "none":
      return prompt;
    case "image":
      return `${prompt}\n\nImage metadata (untrusted JSON):\n${JSON.stringify({ name: snapshot.image.name })}`;
    case "selection":
      return buildSelectedElementUserContent(prompt, snapshot.selection);
    case "page":
      return buildPageReadingContent(prompt, snapshot.page);
    case "elements":
      return [prompt, ...snapshot.pages.map((page) => buildPageReadingContent("", page))].join("\n\n");
    case "file":
      return buildFileReadingContent(prompt, snapshot.file);
  }
}

export function getContextCitations(snapshot: ChatContextSnapshot): PageCitation[] {
  if (snapshot.type === "page") return getPageCitations(snapshot.page);
  if (snapshot.type === "elements") return snapshot.pages.flatMap(getPageCitations);
  if (snapshot.type === "file") return getFileCitations(snapshot.file);
  return [];
}

export function getConversationHistory(
  turns: ConversationTurn[],
): ChatModelMessage[] {
  return turns
    .filter((turn) => turn.status === "complete")
    .flatMap((turn) => [
      {
        role: "user" as const,
        ...(turn.snapshot.type === "image" ? { imageDataUrl: turn.snapshot.image.dataUrl } : {}),
        content: buildTurnContent(turn.prompt, turn.snapshot),
      },
      { role: "assistant" as const, content: turn.answer },
    ]);
}

export function getTurnCitations(
  turns: ConversationTurn[],
  index: number,
): PageCitation[] {
  const turn = turns[index];
  if (!turn) return [];
  const contexts = turn.includeHistory
    ? turns
        .slice(0, index)
        .filter((item) => item.status === "complete")
        .concat(turn)
    : [turn];
  return [
    ...new Map(
      contexts
        .flatMap((item) => getContextCitations(item.snapshot))
        .map((citation) => [citation.id, citation]),
    ).values(),
  ];
}

export function parseSavedConversation(value: unknown): SavedConversation {
  const result = conversationSchema.safeParse(value);
  if (!result.success) throw new Error("conversationsInvalid");
  return result.data;
}

export async function loadConversations(): Promise<SavedConversation[]> {
  const values = await browser.storage.local.get(null);
  return Object.entries(values)
    .filter(([key]) => key.startsWith(CONVERSATION_STORAGE_PREFIX))
    .map(([key, value]) => {
      const record = parseSavedConversation(value);
      if (key !== `${CONVERSATION_STORAGE_PREFIX}${record.id}`)
        throw new Error("conversationsInvalid");
      return record;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveConversation(
  value: unknown,
): Promise<SavedConversation> {
  const record = parseSavedConversation(value);
  await browser.storage.local.set({
    [`${CONVERSATION_STORAGE_PREFIX}${record.id}`]: record,
  });
  return record;
}

export async function deleteConversation(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) throw new Error("conversationsInvalid");
  await browser.storage.local.remove(`${CONVERSATION_STORAGE_PREFIX}${id}`);
}

export function exportConversations(records: SavedConversation[]): string {
  return JSON.stringify(
    {
      kind: "hyperpage.conversations",
      version: 1,
      conversations: records.map(parseSavedConversation),
    },
    null,
    2,
  );
}

export async function importConversations(text: string): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("conversationsInvalid");
  }
  const parsed = z
    .object({
      kind: z.literal("hyperpage.conversations"),
      version: z.literal(1),
      conversations: z.array(conversationSchema).min(1),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw new Error("conversationsInvalid");
  const records = parsed.data.conversations.map((record) => ({
    ...record,
    id: crypto.randomUUID(),
  }));
  await browser.storage.local.set(
    Object.fromEntries(
      records.map((record) => [
        `${CONVERSATION_STORAGE_PREFIX}${record.id}`,
        record,
      ]),
    ),
  );
}

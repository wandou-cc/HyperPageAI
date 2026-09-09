import { z } from "zod";
import type { ChatContextSnapshot, CommandResult } from "./messages";

export const RESOURCE_PORT = "hyperpage.page-resources";

export interface PageResource {
  id: string;
  kind: "document" | "image" | "video";
  name: string;
  url: string | null;
  format: string;
  reader: "pdf" | "text" | "image" | "transcript" | "youtube" | null;
}

export interface ResourceCatalog {
  type: "catalog";
  url: string;
  title: string;
  resources: PageResource[];
}

export type ResourceSource = Extract<ChatContextSnapshot, { type: "file" | "page" | "image" }>;
export type ResourceResult = ResourceCatalog | ResourceSource
  | { type: "bytes"; format: "pdf" | "text"; name: string; base64: string }
  | { type: "located"; found: boolean };

export const resourceCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scan") }).strict(),
  z.object({ type: z.literal("read"), resourceId: z.uuid() }).strict(),
  z.object({ type: z.literal("reveal"), resourceId: z.uuid() }).strict(),
  z.object({ type: z.literal("locate"), snapshotId: z.string().min(1), blockId: z.string().min(1) }).strict(),
]);
export type ResourceCommand = z.infer<typeof resourceCommandSchema>;
export const resourceRequestSchema = z.object({ requestId: z.uuid(), command: resourceCommandSchema }).strict();
export interface ResourceEvent { requestId: string; result: CommandResult<ResourceResult> }
export interface ResourceContentRequest { target: "resources-content"; command: ResourceCommand }

export function decodeResourceFile(result: Extract<ResourceResult, { type: "bytes" }>): File {
  return new File([Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0))], result.name, {
    type: result.format === "pdf" ? "application/pdf" : "text/plain",
  });
}

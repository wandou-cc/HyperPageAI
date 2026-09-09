import { z } from "zod";
import type { ProviderCredentials } from "../shared/messages";

export function providerHeaders(provider: ProviderCredentials): Record<string, string> {
  switch (provider.protocol) {
    case "anthropic":
      return { "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    case "gemini":
      return { "x-goog-api-key": provider.apiKey };
    case "chat-completions":
    case "responses":
      return { Authorization: `Bearer ${provider.apiKey}` };
  }
}

export async function providerHttpError(response: Response, apiKey: string): Promise<Error> {
  const body = (await response.text()).replaceAll(apiKey, "[redacted]").slice(0, 500);
  return new Error(`apiRequestFailed:${response.status}:${body}`);
}

export async function providerFetch(provider: ProviderCredentials, url: string | URL, init: RequestInit = {}): Promise<Response> {
  if (new URL(url).origin !== new URL(provider.baseUrl).origin) throw new Error("providerOriginMismatch");
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...providerHeaders(provider) },
  });
  if (!response.ok) throw await providerHttpError(response, provider.apiKey);
  return response;
}

export async function readProviderJson(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("apiResponseInvalid");
  }
}

export async function listProviderModels(provider: ProviderCredentials): Promise<string[]> {
  const models: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const url = new URL(`${provider.baseUrl}/models`);
    if (provider.protocol === "anthropic") {
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("after_id", cursor);
    } else if (provider.protocol === "gemini") {
      url.searchParams.set("pageSize", "1000");
      if (cursor) url.searchParams.set("pageToken", cursor);
    }
    const response = await providerFetch(provider, url.href, { method: "GET" });
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error("modelListResponseInvalid"); }
    if (provider.protocol === "gemini") {
      const result = z.object({
        models: z.array(z.object({ name: z.string().regex(/^models\/.+/), supportedGenerationMethods: z.array(z.string()).optional() })),
        nextPageToken: z.string().min(1).optional(),
      }).safeParse(value);
      if (!result.success) throw new Error("modelListResponseInvalid");
      models.push(...result.data.models.filter((model) => model.supportedGenerationMethods?.includes("generateContent")).map((model) => model.name.slice("models/".length)));
      cursor = result.data.nextPageToken;
    } else {
      const result = z.object({ data: z.array(z.object({ id: z.string().trim().min(1) })) }).safeParse(value);
      if (!result.success) throw new Error("modelListResponseInvalid");
      models.push(...result.data.data.map((model) => model.id));
      cursor = undefined;
      if (provider.protocol === "anthropic") {
        const page = z.object({ has_more: z.boolean(), last_id: z.string().nullable() }).safeParse(value);
        if (!page.success || (page.data.has_more && !page.data.last_id)) throw new Error("modelListResponseInvalid");
        if (page.data.has_more && page.data.last_id) cursor = page.data.last_id;
      }
    }
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("modelListResponseInvalid");
      cursors.add(cursor);
    }
  } while (cursor);
  if (!models.length) throw new Error("modelListEmpty");
  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

// SSE records can span byte chunks; only a blank line dispatches an event.
export async function* readProviderEvents(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error("apiStreamInvalid");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      while (buffer) {
        const end = buffer.search(/[\r\n]/);
        if (end < 0 || (buffer[end] === "\r" && end === buffer.length - 1 && !chunk.done)) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + (buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1));
        if (!line) {
          if (data.length) {
            signal.throwIfAborted();
            yield data.join("\n");
          }
          data = [];
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (chunk.done) {
        if (buffer || data.length) throw new Error("apiStreamIncomplete");
        return;
      }
    }
  } finally {
    try { await reader.cancel(); }
    finally { reader.releaseLock(); }
  }
}

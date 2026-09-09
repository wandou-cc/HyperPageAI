import { z } from "zod";
import type { ProviderConfig } from "../shared/messages";
import type { ChatContent } from "../shared/prompts";
import { readPngDataUrl } from "../shared/image";
import { parseWebSearchResponse } from "../shared/web-search";
import { providerFetch, readProviderEvents, readProviderJson } from "./provider-http";

const objectSchema = z.record(z.string(), z.unknown());
const toolCallSchema = z.object({ id: z.string().min(1), type: z.literal("function"), function: z.object({ name: z.string().min(1), arguments: z.string() }) });
type ToolCall = z.infer<typeof toolCallSchema>;
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: ChatContent | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
const toolSchema = z.object({ type: z.literal("function"), function: z.object({ name: z.string(), description: z.string().optional(), parameters: objectSchema }) });
const toolChoiceSchema = z.union([z.enum(["auto", "none", "required"]), z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) })]);
type ToolChoice = z.infer<typeof toolChoiceSchema>;
interface NativeOptions {
  signal: AbortSignal;
  stream: boolean;
  onDelta?: (text: string) => Promise<void>;
  webSearch?: boolean;
  tools?: z.infer<typeof toolSchema>[];
  toolChoice?: ToolChoice;
  history?: NativeHistory;
}
interface NativeHistory {
  turns: Map<string, unknown[]>;
  calls: Map<string, { name: string; nativeId?: string }>;
}
interface NativeResult {
  text: string;
  calls: ToolCall[];
  blocks: unknown[];
}

function parse<T>(schema: z.ZodType<T>, value: unknown, error = "apiResponseInvalid"): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(error);
  return result.data;
}

function parts(message: ModelMessage): Exclude<ChatContent, string> {
  if (Array.isArray(message.content)) return message.content;
  return message.content ? [{ type: "text", text: message.content }] : [];
}

function imageBase64(url: string): string {
  readPngDataUrl(url);
  return url.slice("data:image/png;base64,".length);
}

function savedTurn(message: ModelMessage, history?: NativeHistory): unknown[] | undefined {
  const call = message.tool_calls?.[0];
  if (!call) return undefined;
  const blocks = history?.turns.get(call.id);
  if (!blocks) throw new Error("apiResponseInvalid");
  return blocks;
}

function buildRequest(provider: ProviderConfig, messages: ModelMessage[], options: NativeOptions): { url: string; body: Record<string, unknown> } {
  const system = messages.filter((message) => message.role === "system").flatMap(parts).map((part) => {
    if (part.type !== "text") throw new Error("apiResponseInvalid");
    return part.text;
  }).join("\n\n");
  const conversation = messages.filter((message) => message.role !== "system");
  const functions = options.tools?.map((tool) => tool.function);
  const namedTool = typeof options.toolChoice === "object" ? options.toolChoice.function.name : undefined;
  switch (provider.protocol) {
    case "responses": {
      const input = conversation.flatMap((message): unknown[] => {
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        const saved = savedTurn(message, options.history);
        if (saved) return saved;
        return [{ role: message.role, content: parts(message).map((part) => part.type === "text"
          ? { type: "input_text", text: part.text }
          : { type: "input_image", image_url: part.image_url.url, detail: "auto" }) }];
      });
      return { url: `${provider.baseUrl}/responses`, body: {
        model: provider.model, input, ...(system ? { instructions: system } : {}), stream: options.stream, store: false,
        ...(functions ? { tools: functions.map((tool) => ({ type: "function", ...tool, strict: false })), parallel_tool_calls: false, tool_choice: namedTool ? { type: "function", name: namedTool } : options.toolChoice, include: ["reasoning.encrypted_content"] } : {}),
        ...(options.webSearch ? { tools: [{ type: "web_search", external_web_access: true }], tool_choice: "required" } : {}),
      } };
    }
    case "anthropic": {
      const nativeMessages: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];
      for (const message of conversation) {
        let content: unknown[];
        if (message.role === "tool") content = [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }];
        else content = savedTurn(message, options.history) ?? parts(message).map((part) => part.type === "text"
          ? { type: "text", text: part.text }
          : { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64(part.image_url.url) } });
        const role = message.role === "assistant" ? "assistant" : "user";
        const previous = nativeMessages.at(-1);
        if (previous?.role === role) previous.content.push(...content);
        else nativeMessages.push({ role, content: [...content] });
      }
      return { url: `${provider.baseUrl}/messages`, body: {
        model: provider.model, messages: nativeMessages, ...(system ? { system } : {}), max_tokens: 8192, stream: options.stream,
        ...(functions ? { tools: functions.map(({ parameters, ...tool }) => ({ ...tool, input_schema: parameters })), tool_choice: namedTool
          ? { type: "tool", name: namedTool, disable_parallel_tool_use: true }
          : options.toolChoice === "none" ? { type: "none" } : { type: options.toolChoice === "required" ? "any" : "auto", disable_parallel_tool_use: true } } : {}),
        ...(options.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] } : {}),
      } };
    }
    case "gemini": {
      const contents: Array<{ role: "user" | "model"; parts: unknown[] }> = [];
      for (const message of conversation) {
        let nativeParts: unknown[];
        if (message.role === "tool") {
          const call = message.tool_call_id ? options.history?.calls.get(message.tool_call_id) : undefined;
          if (!call) throw new Error("apiResponseInvalid");
          nativeParts = [{ functionResponse: { name: call.name, ...(call.nativeId ? { id: call.nativeId } : {}), response: { result: message.content } } }];
        } else nativeParts = savedTurn(message, options.history) ?? parts(message).map((part) => part.type === "text"
          ? { text: part.text }
          : { inlineData: { mimeType: "image/png", data: imageBase64(part.image_url.url) } });
        const role = message.role === "assistant" ? "model" : "user";
        const previous = contents.at(-1);
        if (previous?.role === role) previous.parts.push(...nativeParts);
        else contents.push({ role, parts: [...nativeParts] });
      }
      const method = options.stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return { url: `${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:${method}`, body: {
        contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(functions ? { tools: [{ functionDeclarations: functions.map(({ parameters, ...tool }) => ({ ...tool, parametersJsonSchema: parameters })) }],
          toolConfig: { functionCallingConfig: { mode: namedTool || options.toolChoice === "required" ? "ANY" : options.toolChoice === "none" ? "NONE" : "AUTO", ...(namedTool ? { allowedFunctionNames: [namedTool] } : {}) } } } : {}),
        ...(options.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
      } };
    }
    case "chat-completions": throw new Error("settingsInvalid");
  }
}

function checkFinish(reason: string, protocol: "responses" | "anthropic" | "gemini"): void {
  if (reason === "max_tokens" || reason === "MAX_TOKENS" || reason === "max_output_tokens") throw new Error("modelOutputLimit");
  if (["refusal", "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "content_filter"].includes(reason)) throw new Error("modelOutputFiltered");
  const allowed = protocol === "responses" ? ["completed"] : protocol === "anthropic" ? ["end_turn", "stop_sequence", "tool_use"] : ["STOP"];
  if (!allowed.includes(reason)) throw new Error("apiResponseInvalid");
}

function citationLink(url: string, index: number): string {
  const parsed = parse(z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)), url);
  return `[${index}](<${parsed.replace(/[<>\s\\]/g, (character) => encodeURIComponent(character))}>)`;
}

function readResponses(value: unknown, webSearch: boolean): NativeResult {
  const response = parse(z.object({ status: z.string(), output: z.array(z.object({ type: z.string() }).passthrough()), incomplete_details: z.object({ reason: z.string() }).nullable().optional() }), value);
  checkFinish(response.status === "incomplete" && response.incomplete_details ? response.incomplete_details.reason : response.status, "responses");
  const text: string[] = [];
  const calls: ToolCall[] = [];
  for (const item of response.output) {
    if (item.type === "message") {
      const message = parse(z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }), item);
      for (const part of message.content) {
        if (part.type === "refusal") throw new Error("modelOutputFiltered");
        if (part.type !== "output_text" || part.text === undefined) throw new Error("apiResponseInvalid");
        text.push(part.text);
      }
    } else if (item.type === "function_call") {
      const call = parse(z.object({ call_id: z.string().min(1), name: z.string().min(1), arguments: z.string() }), item);
      calls.push({ id: call.call_id, type: "function", function: { name: call.name, arguments: call.arguments } });
    } else if (item.type !== "reasoning" && !(webSearch && item.type === "web_search_call")) throw new Error("apiResponseInvalid");
  }
  return { text: webSearch ? parseWebSearchResponse(value) : text.join("\n\n"), calls, blocks: response.output };
}

function readAnthropic(value: unknown, webSearch: boolean): NativeResult {
  const response = parse(z.object({ stop_reason: z.string(), content: z.array(z.object({ type: z.string() }).passthrough()) }), value);
  checkFinish(response.stop_reason, "anthropic");
  const calls: ToolCall[] = [];
  const texts: string[] = [];
  const urls = new Map<string, number>();
  let searched = false;
  for (const block of response.content) {
    if (block.type === "text") {
      const part = parse(z.object({ text: z.string(), citations: z.array(z.object({ type: z.string(), url: z.string().optional() })).nullable().optional() }), block);
      let text = part.text;
      if (webSearch) {
        for (const citation of part.citations ?? []) {
          if (citation.type !== "web_search_result_location" || !citation.url) throw new Error("apiResponseInvalid");
          const index = urls.get(citation.url) ?? urls.size + 1;
          urls.set(citation.url, index);
          text += ` ${citationLink(citation.url, index)}`;
        }
      }
      texts.push(text);
    } else if (block.type === "tool_use") {
      const call = parse(z.object({ id: z.string().min(1), name: z.string().min(1), input: objectSchema }), block);
      calls.push({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } });
    } else if (webSearch && block.type === "web_search_tool_result") {
      if (!Array.isArray(block.content)) throw new Error("webSearchFailed");
      searched = true;
    } else if (!["thinking", "redacted_thinking", "server_tool_use"].includes(block.type)) throw new Error("apiResponseInvalid");
  }
  if (webSearch && (!searched || !urls.size)) throw new Error("webSearchNotPerformed");
  return { text: texts.join("\n\n"), calls, blocks: response.content };
}

const geminiPartSchema = z.object({
  text: z.string().optional(), thought: z.boolean().optional(), thoughtSignature: z.string().optional(),
  functionCall: z.object({ id: z.string().optional(), name: z.string().min(1), args: objectSchema.optional() }).optional(),
}).passthrough();
const groundingSchema = z.object({
  webSearchQueries: z.array(z.string()).optional(),
  groundingChunks: z.array(z.object({ web: z.object({ uri: z.string(), title: z.string().optional() }).optional() })).optional(),
});
const geminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(geminiPartSchema) }).optional(),
    finishReason: z.string().optional(), groundingMetadata: groundingSchema.optional(),
  })).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

function readGemini(value: unknown, webSearch: boolean, history?: NativeHistory): NativeResult {
  const response = parse(geminiResponseSchema, value);
  if (response.promptFeedback?.blockReason) throw new Error("modelOutputFiltered");
  const candidate = response.candidates?.[0];
  if (!candidate?.finishReason) throw new Error("apiStreamIncomplete");
  checkFinish(candidate.finishReason, "gemini");
  if (!candidate.content) throw new Error("apiResponseInvalid");
  const calls: ToolCall[] = [];
  const texts: string[] = [];
  for (const part of candidate.content.parts) {
    if (part.functionCall) {
      const { id, name, args } = part.functionCall;
      const callId = id || crypto.randomUUID();
      calls.push({ id: callId, type: "function", function: { name, arguments: JSON.stringify(args ?? {}) } });
      history?.calls.set(callId, { name, ...(id ? { nativeId: id } : {}) });
    } else if (part.text !== undefined && !part.thought) texts.push(part.text);
  }
  if (webSearch) {
    const grounding = candidate.groundingMetadata;
    const urls = [...new Set(grounding?.groundingChunks?.flatMap((chunk) => chunk.web ? [chunk.web.uri] : []))];
    if (!grounding?.webSearchQueries?.length || !urls.length) throw new Error("webSearchNotPerformed");
    texts.push(`\n\n${urls.map((url, index) => citationLink(url, index + 1)).join(" ")}`);
  }
  return { text: texts.join(""), calls, blocks: candidate.content.parts };
}

async function readNativeStream(provider: ProviderConfig, response: Response, options: NativeOptions): Promise<unknown> {
  const blocks: Array<Record<string, unknown>> = [];
  let stopReason: string | undefined;
  let messageStarted = false;
  let grounding: z.infer<typeof groundingSchema> | undefined;
  for await (const data of readProviderEvents(response, options.signal)) {
    let value: unknown;
    try { value = JSON.parse(data); }
    catch { throw new Error("apiStreamInvalid"); }
    if (provider.protocol === "gemini") {
      const chunk = parse(geminiResponseSchema, value, "apiStreamInvalid");
      if (chunk.promptFeedback?.blockReason) throw new Error("modelOutputFiltered");
      const candidate = chunk.candidates?.[0];
      if (candidate?.content) {
        if (stopReason) throw new Error("apiStreamInvalid");
        blocks.push(...candidate.content.parts);
        for (const part of candidate.content.parts) {
          if (part.text && !part.thought) {
            options.signal.throwIfAborted();
            await options.onDelta?.(part.text);
          }
        }
      }
      if (candidate?.groundingMetadata) grounding = candidate.groundingMetadata;
      if (candidate?.finishReason) {
        checkFinish(candidate.finishReason, "gemini");
        stopReason = candidate.finishReason;
      }
      continue;
    }
    const event = parse(z.object({ type: z.string() }).passthrough(), value, "apiStreamInvalid");
    if (event.type === "error" || event.type === "response.failed") throw new Error(options.webSearch ? "webSearchFailed" : "apiResponseInvalid");
    if (provider.protocol === "responses") {
      if (event.type === "response.output_text.delta") await options.onDelta?.(parse(z.string(), event.delta, "apiStreamInvalid"));
      else if (event.type === "response.completed" || event.type === "response.incomplete") return event.response;
      continue;
    }
    if (event.type === "message_start") {
      if (messageStarted) throw new Error("apiStreamInvalid");
      messageStarted = true;
    } else if (event.type === "content_block_start") {
      const start = parse(z.object({ index: z.number().int().nonnegative(), content_block: z.object({ type: z.string() }).passthrough() }), event, "apiStreamInvalid");
      if (!messageStarted || start.index !== blocks.length) throw new Error("apiStreamInvalid");
      blocks.push(start.content_block);
      if (start.content_block.type === "text") await options.onDelta?.(parse(z.string(), start.content_block.text, "apiStreamInvalid"));
    } else if (event.type === "content_block_delta") {
      const chunk = parse(z.object({ index: z.number().int().nonnegative(), delta: z.object({ type: z.string() }).passthrough() }), event, "apiStreamInvalid");
      const block = blocks[chunk.index];
      if (!block) throw new Error("apiStreamInvalid");
      if (chunk.delta.type === "text_delta") {
        const text = parse(z.string(), chunk.delta.text, "apiStreamInvalid");
        block.text = parse(z.string(), block.text, "apiStreamInvalid") + text;
        await options.onDelta?.(text);
      } else if (chunk.delta.type === "citations_delta") {
        const citations = block.citations === null || block.citations === undefined ? [] : parse(z.array(z.unknown()), block.citations, "apiStreamInvalid");
        block.citations = [...citations, chunk.delta.citation];
      }
    } else if (event.type === "message_delta") {
      const delta = parse(z.object({ stop_reason: z.string() }), event.delta, "apiStreamInvalid");
      checkFinish(delta.stop_reason, "anthropic");
      stopReason = delta.stop_reason;
    } else if (event.type === "message_stop") {
      if (!messageStarted || !stopReason) throw new Error("apiStreamIncomplete");
      return { content: blocks, stop_reason: stopReason };
    }
  }
  if (provider.protocol === "gemini" && stopReason) return { candidates: [{ content: { parts: blocks }, finishReason: stopReason, ...(grounding ? { groundingMetadata: grounding } : {}) }] };
  throw new Error("apiStreamIncomplete");
}

async function requestNativeModel(provider: ProviderConfig, messages: ModelMessage[], options: NativeOptions): Promise<NativeResult> {
  options.signal.throwIfAborted();
  const request = buildRequest(provider, messages, options);
  const response = await providerFetch(provider, request.url, { method: "POST", body: JSON.stringify(request.body), signal: options.signal });
  const value = options.stream ? await readNativeStream(provider, response, options) : await readProviderJson(response);
  options.signal.throwIfAborted();
  const result = provider.protocol === "responses" ? readResponses(value, options.webSearch === true)
    : provider.protocol === "anthropic" ? readAnthropic(value, options.webSearch === true) : readGemini(value, options.webSearch === true, options.history);
  if (result.calls.length && !options.tools) throw new Error("modelTextResponseRequired");
  if (!result.calls.length && !result.text.trim()) throw new Error("apiResponseInvalid");
  if (options.history) for (const call of result.calls) options.history.turns.set(call.id, result.blocks);
  return result;
}

export async function callNativeModel(provider: ProviderConfig, messages: ModelMessage[], options: Omit<NativeOptions, "tools" | "toolChoice" | "history">): Promise<string> {
  return (await requestNativeModel(provider, messages, options)).text.trim();
}

// The task SDK consumes OpenAI tool messages. Keep opaque native assistant blocks
// for subsequent turns, including Gemini thought signatures and Responses reasoning.
export function createNativeAgentFetch(provider: ProviderConfig): typeof fetch {
  const history: NativeHistory = { turns: new Map(), calls: new Map() };
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${provider.baseUrl}/chat/completions` || typeof init?.body !== "string") throw new Error("providerOriginMismatch");
    let value: unknown;
    try { value = JSON.parse(init.body); }
    catch { throw new Error("apiResponseInvalid"); }
    const request = parse(z.object({
      messages: z.array(z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().nullable().optional(), tool_calls: z.array(toolCallSchema).optional(), tool_call_id: z.string().optional() })),
      tools: z.array(toolSchema), tool_choice: toolChoiceSchema,
    }), value);
    const result = await requestNativeModel(provider, request.messages, {
      signal: init.signal ?? new AbortController().signal, stream: false, tools: request.tools, toolChoice: request.tool_choice, history,
    });
    return new Response(JSON.stringify({ choices: [{ finish_reason: result.calls.length ? "tool_calls" : "stop", message: { role: "assistant", content: result.text, tool_calls: result.calls } }] }), { headers: { "Content-Type": "application/json" } });
  };
}

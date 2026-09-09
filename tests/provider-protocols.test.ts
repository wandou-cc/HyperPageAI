import { afterEach, describe, expect, it, vi } from "vitest";
import { callNativeModel, createNativeAgentFetch, type ModelMessage } from "../lib/native-models";
import { listProviderModels, providerFetch } from "../lib/provider-http";
import type { ProviderConfig, ProviderProtocol } from "../shared/messages";
import { createUnknownCapabilities } from "../shared/settings";

const provider = (protocol: ProviderProtocol): ProviderConfig => ({
  protocol, baseUrl: `https://service.example/${protocol === "gemini" ? "v1beta" : "v1"}`,
  apiKey: "test-secret", model: "test-model", targetLanguage: "English", capabilities: createUnknownCapabilities(),
});
const messages: ModelMessage[] = [{ role: "system", content: "System instruction" }, { role: "user", content: "Question" }, { role: "assistant", content: "Earlier answer" }, { role: "user", content: "Follow up" }];
const signal = () => new AbortController().signal;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function getCall(mock: ReturnType<typeof vi.fn>, index = 0) {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`Missing fetch call ${index}`);
  return call;
}
function sse(events: unknown[], cancel = vi.fn(), chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) controller.enqueue(bytes.slice(index, index + chunkSize));
      controller.close();
    }, cancel,
  }));
}
function textResponse(protocol: ProviderProtocol, text = "Answer") {
  if (protocol === "responses") return { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] };
  if (protocol === "anthropic") return { stop_reason: "end_turn", content: [{ type: "text", text }] };
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] };
}
function textEvents(protocol: ProviderProtocol, text = "Answer") {
  if (protocol === "responses") return [{ type: "response.output_text.delta", delta: text }, { type: "response.completed", response: textResponse(protocol, text) }];
  if (protocol === "anthropic") return [
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
  return [{ candidates: [{ content: { parts: [{ text }] } }] }, { candidates: [{ finishReason: "STOP" }] }, { usageMetadata: { totalTokenCount: 12 } }];
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("native model protocols", () => {
  it.each(["responses", "anthropic", "gemini"] as const)("sends %s text requests with native roles and authentication", async (protocol) => {
    const config = provider(protocol);
    const fetchMock = vi.fn().mockResolvedValue(json(textResponse(protocol)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callNativeModel(config, messages, { signal: signal(), stream: false })).resolves.toBe("Answer");
    const [url, init] = getCall(fetchMock);
    const body = JSON.parse(init.body);
    expect(init.redirect).toBe("error");
    if (protocol === "responses") {
      expect(url).toBe(`${config.baseUrl}/responses`);
      expect(init.headers.Authorization).toBe("Bearer test-secret");
      expect(body).toMatchObject({ model: "test-model", instructions: "System instruction", store: false, stream: false });
      expect(body.input.map((message: { role: string }) => message.role)).toEqual(["user", "assistant", "user"]);
    } else if (protocol === "anthropic") {
      expect(url).toBe(`${config.baseUrl}/messages`);
      expect(init.headers).toMatchObject({ "x-api-key": "test-secret", "anthropic-version": "2023-06-01" });
      expect(init.headers.Authorization).toBeUndefined();
      expect(body).toMatchObject({ system: "System instruction", max_tokens: 8192, messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }] });
    } else {
      expect(url).toBe(`${config.baseUrl}/models/test-model:generateContent`);
      expect(init.headers["x-goog-api-key"]).toBe("test-secret");
      expect(body).toMatchObject({ systemInstruction: { parts: [{ text: "System instruction" }] }, contents: [{ role: "user" }, { role: "model" }, { role: "user" }] });
      expect(body.model).toBeUndefined();
    }
  });

  it.each(["responses", "anthropic", "gemini"] as const)("streams %s across split UTF-8 and CRLF boundaries", async (protocol) => {
    const text = "Answer 中文";
    const fetchMock = vi.fn().mockResolvedValue(sse(textEvents(protocol, text)));
    vi.stubGlobal("fetch", fetchMock);
    const onDelta = vi.fn().mockResolvedValue(undefined);
    await expect(callNativeModel(provider(protocol), messages, { signal: signal(), stream: true, onDelta })).resolves.toBe(text);
    expect(onDelta.mock.calls.flat().join("")).toBe(text);
    if (protocol === "gemini") expect(getCall(fetchMock)[0]).toContain(":streamGenerateContent?alt=sse");
  });

  it.each(["responses", "anthropic", "gemini"] as const)("rejects an unfinished %s stream", async (protocol) => {
    const events = textEvents(protocol);
    const incomplete = protocol === "gemini" ? events.slice(0, 1) : protocol === "anthropic" ? events.slice(0, -1) : events.slice(0, -1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(incomplete)));
    await expect(callNativeModel(provider(protocol), messages, { signal: signal(), stream: true })).rejects.toThrow("apiStreamIncomplete");
  });

  it.each(["responses", "anthropic", "gemini"] as const)("maps %s output limits to an explicit error", async (protocol) => {
    const response = protocol === "responses" ? { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }
      : protocol === "anthropic" ? { stop_reason: "max_tokens", content: [{ type: "text", text: "Partial" }] }
      : { candidates: [{ content: { parts: [{ text: "Partial" }] }, finishReason: "MAX_TOKENS" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(response)));
    await expect(callNativeModel(provider(protocol), messages, { signal: signal(), stream: false })).rejects.toThrow("modelOutputLimit");
  });

  it.each(["responses", "anthropic", "gemini"] as const)("converts a PNG attachment to the %s content format", async (protocol) => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const fetchMock = vi.fn().mockResolvedValue(json(textResponse(protocol)));
    vi.stubGlobal("fetch", fetchMock);
    await callNativeModel(provider(protocol), [{ role: "user", content: [{ type: "text", text: "Describe" }, { type: "image_url", image_url: { url: dataUrl } }] }], { signal: signal(), stream: false });
    const body = JSON.parse(getCall(fetchMock)[1].body);
    if (protocol === "responses") expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: dataUrl, detail: "auto" });
    if (protocol === "anthropic") expect(body.messages[0].content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: dataUrl.slice(22) } });
    if (protocol === "gemini") expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: dataUrl.slice(22) } });
  });

  it("retains Claude search citations and rejects search tool errors", async () => {
    const events = [
      { type: "message_start" },
      { type: "content_block_start", index: 0, content_block: { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://example.com" }] } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: [] } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Source answer" } },
      { type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://example.com" } } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(sse(events)).mockResolvedValueOnce(json({ stop_reason: "end_turn", content: [{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callNativeModel(provider("anthropic"), messages, { signal: signal(), stream: true, webSearch: true })).resolves.toBe("Source answer [1](<https://example.com>)");
    expect(JSON.parse(getCall(fetchMock)[1].body).tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
    await expect(callNativeModel(provider("anthropic"), messages, { signal: signal(), stream: false, webSearch: true })).rejects.toThrow("webSearchFailed");
  });

  it("uses Gemini grounding sources and requires evidence of search", async () => {
    const grounded = { candidates: [{ content: { parts: [{ thought: true, text: "Internal" }, { text: "Grounded answer" }] }, finishReason: "STOP", groundingMetadata: {
      webSearchQueries: ["question"], groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
    } }] };
    const fetchMock = vi.fn().mockResolvedValueOnce(sse([grounded])).mockResolvedValueOnce(json(textResponse("gemini")));
    vi.stubGlobal("fetch", fetchMock);
    const onDelta = vi.fn();
    await expect(callNativeModel(provider("gemini"), messages, { signal: signal(), stream: true, webSearch: true, onDelta })).resolves.toBe("Grounded answer\n\n[1](<https://example.com>)");
    expect(onDelta.mock.calls.flat().join("")).toBe("Grounded answer");
    expect(JSON.parse(getCall(fetchMock)[1].body).tools).toEqual([{ googleSearch: {} }]);
    await expect(callNativeModel(provider("gemini"), messages, { signal: signal(), stream: false, webSearch: true })).rejects.toThrow("webSearchNotPerformed");
  });

  it("propagates cancellation and rejects origin changes before sending credentials", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = callNativeModel(provider("anthropic"), messages, { signal: controller.signal, stream: true });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(providerFetch(provider("gemini"), "https://other.example/models")).rejects.toThrow("providerOriginMismatch");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["responses", "anthropic", "gemini"] as const)("stops buffered %s deltas immediately after cancellation", async (protocol) => {
    const controller = new AbortController();
    const events = protocol === "responses" ? [
      { type: "response.output_text.delta", delta: "First" },
      { type: "response.output_text.delta", delta: "Second" },
      { type: "response.completed", response: textResponse(protocol, "FirstSecond") },
    ] : protocol === "anthropic" ? [
      { type: "message_start" },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "First" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Second" } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ] : [{ candidates: [{ content: { parts: [{ text: "First" }, { text: "Second" }] }, finishReason: "STOP" }] }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(events, vi.fn(), 100_000)));
    const onDelta = vi.fn().mockImplementation(async () => controller.abort());
    await expect(callNativeModel(provider(protocol), messages, { signal: controller.signal, stream: true, onDelta })).rejects.toMatchObject({ name: "AbortError" });
    expect(onDelta).toHaveBeenCalledTimes(1);
  });

  it("redacts native credentials in HTTP errors without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("test-secret rejected", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callNativeModel(provider("gemini"), messages, { signal: signal(), stream: false })).rejects.toThrow("apiRequestFailed:401:[redacted] rejected");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("native page task tools", () => {
  it.each(["responses", "anthropic", "gemini"] as const)("preserves native %s context across two SDK tool turns", async (protocol) => {
    const config = provider(protocol);
    const nativeBlocks: unknown[] = protocol === "responses" ? [{ type: "reasoning", id: "reasoning-1", encrypted_content: "opaque" }, { type: "function_call", id: "fc-1", call_id: "call-1", name: "AgentOutput", arguments: '{"action":"click"}' }]
      : protocol === "anthropic" ? [{ type: "thinking", thinking: "private reasoning", signature: "opaque" }, { type: "tool_use", id: "call-1", name: "AgentOutput", input: { action: "click" } }]
      : [{ thoughtSignature: "opaque", functionCall: { id: "call-1", name: "AgentOutput", args: { action: "click" } } }];
    const first = protocol === "responses" ? { status: "completed", output: nativeBlocks }
      : protocol === "anthropic" ? { stop_reason: "tool_use", content: nativeBlocks }
      : { candidates: [{ content: { parts: nativeBlocks }, finishReason: "STOP" }] };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(first)).mockResolvedValueOnce(json(textResponse(protocol, "Done")));
    vi.stubGlobal("fetch", fetchMock);
    const bridge = createNativeAgentFetch(config);
    const tool = { type: "function", function: { name: "AgentOutput", description: "Act", parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] } } };
    const tools = [tool];
    const body = { messages: messages.slice(0, 2), tools, tool_choice: { type: "function", function: { name: "AgentOutput" } } };
    const response = await bridge(`${config.baseUrl}/chat/completions`, { body: JSON.stringify(body), signal: signal() });
    const output = await response.json();
    expect(output.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { tool_calls: [{ id: "call-1", function: { name: "AgentOutput", arguments: '{"action":"click"}' } }] } });
    await bridge(`${config.baseUrl}/chat/completions`, { body: JSON.stringify({ ...body, messages: [...body.messages, output.choices[0].message, { role: "tool", tool_call_id: "call-1", content: "Clicked" }, { role: "user", content: "Continue" }] }), signal: signal() });
    const sent = JSON.parse(getCall(fetchMock, 1)[1].body);
    if (protocol === "responses") {
      expect(sent.input).toEqual(expect.arrayContaining(nativeBlocks));
      expect(sent.input).toContainEqual({ type: "function_call_output", call_id: "call-1", output: "Clicked" });
      expect(sent.tool_choice).toEqual({ type: "function", name: "AgentOutput" });
    } else if (protocol === "anthropic") {
      expect(sent.messages[1].content).toEqual(nativeBlocks);
      expect(sent.messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "call-1", content: "Clicked" });
      expect(sent.tools[0].input_schema).toEqual(tool.function.parameters);
      expect(sent.tool_choice).toEqual({ type: "tool", name: "AgentOutput", disable_parallel_tool_use: true });
    } else {
      expect(sent.contents[1].parts).toEqual(nativeBlocks);
      expect(sent.contents[2].parts[0]).toEqual({ functionResponse: { name: "AgentOutput", id: "call-1", response: { result: "Clicked" } } });
      expect(sent.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["AgentOutput"] });
      expect(sent.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(tool.function.parameters);
    }
  });
});

describe("protocol model lists", () => {
  it("paginates Claude models using its own authentication and cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ data: [{ id: "model-b" }], has_more: true, last_id: "model-b" }))
      .mockResolvedValueOnce(json({ data: [{ id: "model-a" }], has_more: false, last_id: "model-a" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listProviderModels(provider("anthropic"))).resolves.toEqual(["model-a", "model-b"]);
    expect(getCall(fetchMock, 1)[0]).toContain("after_id=model-b");
    expect(getCall(fetchMock)[1].headers["x-api-key"]).toBe("test-secret");
  });

  it("filters Gemini model methods and follows page tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ models: [{ name: "models/text-b", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "page-2" }))
      .mockResolvedValueOnce(json({ models: [{ name: "models/text-a", supportedGenerationMethods: ["generateContent"] }] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listProviderModels(provider("gemini"))).resolves.toEqual(["text-a", "text-b"]);
    expect(getCall(fetchMock, 1)[0]).toContain("pageToken=page-2");
    expect(getCall(fetchMock)[1].headers["x-goog-api-key"]).toBe("test-secret");
  });

  it("rejects a repeated pagination cursor", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ data: [{ id: "one" }], has_more: true, last_id: "one" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listProviderModels(provider("anthropic"))).rejects.toThrow("modelListResponseInvalid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

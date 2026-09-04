import { browser } from "wxt/browser";

import { calculateCropRegion } from "../shared/image";
import type {
  AiExecutionResult,
  BackgroundRequest,
  CommandResult,
  ContentEvent,
  ContentRequest,
  ContentResponse,
  InlineAiRequest,
  PageCommand,
  PageState,
  PanelEvent,
  ProviderConfig,
  ProviderCredentials,
  RunAiRequest,
  SelectionSnapshot,
} from "../shared/messages";
import {
  actionNeedsImage,
  buildAiMessages,
  type ChatMessage,
} from "../shared/prompts";
import {
  loadPanelVisibility,
  savePanelVisibility,
} from "../shared/panel";
import {
  getChatCompletionsUrl,
  getModelsUrl,
  loadSettings,
} from "../shared/settings";

interface ActiveTab {
  id: number;
  windowId: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

const activeRequests = new Map<string, AbortController>();
let sessionAccessReady: Promise<void> = Promise.resolve();

// Fetches the exact model IDs exposed by the provider's OpenAI-compatible API.
export async function fetchAvailableModels(
  credentials: ProviderCredentials,
): Promise<string[]> {
  const response = await fetch(getModelsUrl(credentials.baseUrl), {
    method: "GET",
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`apiRequestFailed:${response.status}:${body}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("modelListResponseInvalid");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw new Error("modelListResponseInvalid");
  }

  const models: string[] = [];
  for (const item of payload.data) {
    if (
      !item ||
      typeof item !== "object" ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !item.id.trim()
    ) {
      throw new Error("modelListResponseInvalid");
    }
    models.push(item.id.trim());
  }
  if (models.length === 0) throw new Error("modelListEmpty");
  return models.sort((left, right) => left.localeCompare(right));
}

// Resolves the HTTP(S) tab that sent a page-bound request.
function getSourceTab(sourceTab?: Browser.tabs.Tab): ActiveTab {
  if (sourceTab?.id === undefined || sourceTab.windowId === undefined) {
    throw new Error("activeTabUnavailable");
  }
  return { id: sourceTab.id, windowId: sourceTab.windowId };
}

// Sends one typed command to the declarative controller in the source tab.
async function sendPageCommand(
  tabId: number,
  command: PageCommand,
): Promise<PageState> {
  const request: ContentRequest = { target: "content", command };
  const response = (await browser.tabs.sendMessage(
    tabId,
    request,
  )) as ContentResponse;
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

// Encodes a worker-produced image blob for messaging and multimodal API input.
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

// Captures and crops the selected element's visible intersection in the active tab.
async function captureSelection(
  tab: ActiveTab,
  selection: SelectionSnapshot,
): Promise<string> {
  await sendPageCommand(tab.id, { type: "suspend-overlay" });
  try {
    const screenshot = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    const sourceBlob = await (await fetch(screenshot)).blob();
    const bitmap = await createImageBitmap(sourceBlob);
    try {
      const crop = calculateCropRegion(selection, bitmap.width, bitmap.height);
      const canvas = new OffscreenCanvas(crop.width, crop.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("imageContextUnavailable");
      context.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
      return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
    } finally {
      bitmap.close();
    }
  } finally {
    await sendPageCommand(tab.id, { type: "restore-overlay" });
  }
}

// Calls the configured OpenAI-compatible endpoint and enforces its text response contract.
async function callModel(
  provider: ProviderConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(getChatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`apiRequestFailed:${response.status}:${body}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error("apiResponseInvalid");
  }
  const firstChoice = data.choices[0];
  if (!firstChoice?.message || typeof firstChoice.message.content !== "string") {
    throw new Error("apiResponseInvalid");
  }
  const content = firstChoice.message.content.trim();
  if (!content) throw new Error("apiResponseInvalid");
  return content;
}

// Executes one AI action against a fresh selection and an optional cropped image.
async function runAiAction(
  tab: ActiveTab,
  request: RunAiRequest,
  requestId: string,
): Promise<AiExecutionResult> {
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    const settings = await loadSettings(browser.i18n.getUILanguage());
    if (!settings.provider) throw new Error("providerRequired");

    const state = await sendPageCommand(tab.id, { type: "get-page-state" });
    if (!state.selection) throw new Error("selectionRequired");
    if (state.selection.text.length > 30_000) throw new Error("selectionTooLong");

    const needsImage = actionNeedsImage(request.action, state.selection);
    if (needsImage && !settings.provider.supportsVision) {
      throw new Error("visionRequired");
    }
    if (!needsImage && !state.selection.text) {
      throw new Error("selectionTextRequired");
    }

    const imageDataUrl = needsImage
      ? await captureSelection(tab, state.selection)
      : undefined;
    controller.signal.throwIfAborted();
    const prompt = request.action === "custom" ? request.prompt : undefined;
    const messages = buildAiMessages(
      request.action,
      state.selection,
      settings.provider,
      imageDataUrl,
      prompt,
    );
    const content = await callModel(
      settings.provider,
      messages,
      controller.signal,
    );
    const currentState = await sendPageCommand(tab.id, {
      type: "get-page-state",
    });
    if (
      !currentState.selection ||
      currentState.selectionRevision !== state.selectionRevision ||
      currentState.selection.text !== state.selection.text
    ) {
      throw new Error("requestContextChanged");
    }
    return {
      content,
      selectionRevision: currentState.selectionRevision,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("requestCancelled");
    }
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

// Executes an AI action for a text range or image supplied by the page controller.
async function runInlineAiAction(
  tab: ActiveTab,
  request: InlineAiRequest,
  requestId: string,
  selection: SelectionSnapshot,
): Promise<string> {
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    const settings = await loadSettings(browser.i18n.getUILanguage());
    if (!settings.provider) throw new Error("providerRequired");
    if (selection.text.length > 30_000) throw new Error("selectionTooLong");

    const needsImage = actionNeedsImage(request.action, selection);
    if (needsImage && !settings.provider.supportsVision) {
      throw new Error("visionRequired");
    }
    if (!needsImage && !selection.text) {
      throw new Error("selectionTextRequired");
    }

    const imageDataUrl = needsImage
      ? await captureSelection(tab, selection)
      : undefined;
    controller.signal.throwIfAborted();
    const prompt = request.action === "custom" ? request.prompt : undefined;
    const messages = buildAiMessages(
      request.action,
      selection,
      settings.provider,
      imageDataUrl,
      prompt,
    );
    return await callModel(settings.provider, messages, controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("requestCancelled");
    }
    throw error;
  } finally {
    activeRequests.delete(requestId);
  }
}

// Verifies text access and, when selected, real image input support for one model.
async function testConnection(provider: ProviderConfig): Promise<void> {
  await callModel(provider, [
    {
      role: "system",
      content: "This is a connection test. Follow the user's response format exactly.",
    },
    { role: "user", content: "Reply with exactly OK." },
  ]);

  if (!provider.supportsVision) return;
  const iconBlob = await (await fetch(browser.runtime.getURL("/icon/128.png"))).blob();
  const iconDataUrl = await blobToDataUrl(iconBlob);
  await callModel(provider, [
    {
      role: "system",
      content: "This is an image-input connection test.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Inspect this image and reply with exactly OK." },
        { type: "image_url", image_url: { url: iconDataUrl } },
      ],
    },
  ]);
}

// Handles floating-panel and page-level commands at the background boundary.
export async function handleBackgroundRequest(
  request: BackgroundRequest,
  sourceTab?: Browser.tabs.Tab,
): Promise<CommandResult<unknown>> {
  try {
    if (request.type === "get-panel-visibility") {
      await sessionAccessReady;
      return { ok: true, data: await loadPanelVisibility() };
    }

    if (request.type === "set-panel-visibility") {
      await sessionAccessReady;
      await savePanelVisibility(request.visible);
      return { ok: true, data: null };
    }

    if (request.type === "cancel-ai") {
      const controller = activeRequests.get(request.requestId);
      if (!controller) throw new Error("requestUnavailable");
      controller.abort();
      return { ok: true, data: null };
    }

    if (request.type === "test-connection") {
      await testConnection(request.provider);
      return { ok: true, data: null };
    }

    if (request.type === "list-models") {
      return {
        ok: true,
        data: await fetchAvailableModels(request.credentials),
      };
    }

    if (request.type === "run-inline-ai") {
      const tab = getSourceTab(sourceTab);
      return {
        ok: true,
        data: await runInlineAiAction(
          tab,
          request.request,
          request.requestId,
          request.selection,
        ),
      };
    }

    const tab = getSourceTab(sourceTab);
    if (request.type === "page-command") {
      return {
        ok: true,
        data: await sendPageCommand(tab.id, request.command),
      };
    }
    if (request.type === "capture-selection") {
      const state = await sendPageCommand(tab.id, { type: "get-page-state" });
      if (!state.selection) throw new Error("selectionRequired");
      return { ok: true, data: await captureSelection(tab, state.selection) };
    }
    return {
      ok: true,
      data: await runAiAction(tab, request.request, request.requestId),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Toggles the session-wide page panel and routes state within each source tab.
export default defineBackground(() => {
  sessionAccessReady = browser.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
  });

  browser.action.onClicked.addListener(() => {
    void (async () => {
      await sessionAccessReady;
      const visible = await loadPanelVisibility();
      await savePanelVisibility(!visible);
    })();
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if ((message as ContentEvent).type === "page-state-changed") {
      const event = message as ContentEvent;
      if (event.target !== "background" || !sender.tab?.id) return undefined;
      const panelEvent: PanelEvent = {
        target: "panel",
        type: "page-state-changed",
        state: event.state,
      };
      void browser.tabs.sendMessage(sender.tab.id, panelEvent);
      return undefined;
    }

    const request = message as BackgroundRequest;
    if (request.target !== "background") return undefined;
    void handleBackgroundRequest(request, sender.tab).then(sendResponse);
    return true;
  });
});

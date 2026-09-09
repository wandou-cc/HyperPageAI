import { browser } from "wxt/browser";
import { message as notify } from "@/components/ui/toast";
import { ALLOWED_ELEMENT_ATTRIBUTES, ALLOWED_STYLE_PROPERTIES } from "../shared/messages";

import type {
  AgentActionResult,
  AgentBrowserState,
  AgentContentRequest,
  AgentContentResponse,
  AgentPageCommand,
  AgentPageCommandResult,
  BackgroundRequest,
  CommandResult,
  ContentEvent,
  ContentRequest,
  ContentResponse,
  EditingContentRequest,
  EditablePreview,
  PageEditingCommand,
  ReadingContentRequest,
  ReadingContentResponse,
  InlineAiRequest,
  Locale,
  PageCommand,
  PageCommandResult,
  PageState,
  ResultDisplayMode,
  SelectionSnapshot,
  StoredSettings,
  ViewportRect,
} from "../shared/messages";
import { createSelectionSnapshot } from "../shared/selection";
import { containsSensitiveField, getVisibleText, isSensitiveElement } from "../shared/dom-content";
import { PageReading } from "./page-reading";
import { PageResources } from "./page-resources";
import { resourceCommandSchema, type ResourceContentRequest, type ResourceResult } from "../shared/page-resources";
import { checkCaptureArea } from "./capture-guard";
import { assertSiteAllowed, parseSiteOrigins } from "../shared/task-templates";
import { PageEditing, setEditableValue } from "./page-editing";
import { formatError, t } from "../entrypoints/sidepanel/translations";

interface InlineActionTarget {
  selection: SelectionSnapshot;
  anchor: HTMLElement;
  range?: Range;
}

export class PageController {
  private reading = new PageReading();
  private resources = new PageResources();
  private editing = new PageEditing();
  private agentElements = new Map<number, HTMLElement>();
  private agentLastUpdateTime = 0;
  private automationMask: HTMLDivElement | null = null;
  private automationTarget: HTMLDivElement | null = null;
  private automationCursor: HTMLDivElement | null = null;
  private automationClickRipple: HTMLDivElement | null = null;
  private selectedElement: Element | null = null;
  private pageTaskElements = new Set<Element>();
  private hoveredElement: Element | null = null;
  private selecting = false;
  private selectingPageTaskElement = false;
  private selectionRevision = 0;
  private overlayHost: HTMLDivElement;
  private overlayShadowRoot: ShadowRoot;
  private hoverOutline: HTMLDivElement;
  private selectedOutline: HTMLDivElement;
  private textTrigger: HTMLButtonElement;
  private textMenu: HTMLDivElement;
  private textTranslateButton: HTMLButtonElement;
  private textExplainButton: HTMLButtonElement;
  private textPromptInput: HTMLInputElement;
  private textPromptButton: HTMLButtonElement;
  private imageTrigger: HTMLButtonElement;
  private imageMenu: HTMLDivElement;
  private imageOcrButton: HTMLButtonElement;
  private imagePromptButton: HTMLButtonElement;
  private floatingResult: HTMLDivElement;
  private floatingResultTitle: HTMLDivElement;
  private floatingResultContent: HTMLDivElement;
  private floatingResultCloseButton: HTMLButtonElement;
  private resizeObserver: ResizeObserver;
  private mutationObserver: MutationObserver;
  private insertedResults: HTMLElement[] = [];
  private updateScheduled = false;
  private overlaySuspended = false;
  private inlineRequestPending = false;
  private textMenuOpen = false;
  private imageMenuOpen = false;
  private textActionTarget: InlineActionTarget | null = null;
  private hoveredImage: HTMLImageElement | null = null;
  private locale: Locale;
  private resultDisplayMode: ResultDisplayMode;
  private floatingResultVisibleBeforeSuspend = false;
  private suspendedPanelVisibility: string | null = null;
  private cursorValue = "";
  private cursorPriority = "";

  // Creates one isolated overlay and installs the command listener for this page.
  constructor(settings: Pick<StoredSettings, "locale" | "resultDisplayMode">) {
    this.locale = settings.locale;
    this.resultDisplayMode = settings.resultDisplayMode;
    this.overlayHost = document.createElement("div");
    this.overlayHost.dataset.hyperpageUi = "overlay";
    this.overlayHost.dataset.pageAgentNotInteractive = "true";
    this.overlayHost.style.setProperty("all", "initial", "important");
    this.overlayHost.style.setProperty("display", "block", "important");
    this.overlayHost.style.setProperty("position", "fixed", "important");
    this.overlayHost.style.setProperty("inset", "0", "important");
    this.overlayHost.style.setProperty("width", "100%", "important");
    this.overlayHost.style.setProperty("height", "100%", "important");
    this.overlayHost.style.setProperty("overflow", "visible", "important");
    this.overlayHost.style.setProperty("pointer-events", "none", "important");
    this.overlayHost.style.setProperty("visibility", "visible", "important");
    this.overlayHost.style.setProperty("opacity", "1", "important");
    this.overlayHost.style.setProperty("transform", "none", "important");
    this.overlayHost.style.setProperty("isolation", "isolate", "important");
    this.overlayHost.style.setProperty("z-index", "2147483647", "important");
    this.overlayShadowRoot = this.overlayHost.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .outline {
        position: fixed;
        z-index: 2147483647;
        display: none;
        box-sizing: border-box;
        pointer-events: none;
        border: 1px solid #71717a;
      }
      .outline.selected {
        border-color: #18181b;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.72);
      }
      .automation-mask {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: none;
        overflow: hidden;
        pointer-events: auto;
        background: transparent;
        cursor: progress;
      }
      .automation-target {
        position: fixed;
        display: none;
        box-sizing: border-box;
        pointer-events: none;
        border: 2px solid #2563eb;
        border-radius: 4px;
        background: rgba(37, 99, 235, 0.06);
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.9),
          0 4px 14px rgba(0, 0, 0, 0.16);
        transition:
          left 160ms ease-out,
          top 160ms ease-out,
          width 160ms ease-out,
          height 160ms ease-out;
      }
      .automation-cursor {
        position: fixed;
        display: none;
        width: 20px;
        height: 26px;
        pointer-events: none;
        filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.32));
        transition: left 180ms ease-out, top 180ms ease-out;
      }
      .automation-cursor::before,
      .automation-cursor::after {
        content: "";
        position: absolute;
        inset: 0;
        clip-path: polygon(0 0, 0 22px, 6px 16px, 10px 25px, 14px 23px, 10px 15px, 19px 15px);
      }
      .automation-cursor::before {
        background: #18181b;
      }
      .automation-cursor::after {
        inset: 2px 3px 4px 2px;
        background: #ffffff;
      }
      .automation-click-ripple {
        position: fixed;
        display: none;
        width: 18px;
        height: 18px;
        box-sizing: border-box;
        pointer-events: none;
        border: 2px solid #2563eb;
        border-radius: 50%;
      }
      .automation-click-ripple.active {
        display: block;
        animation: hp-agent-click 360ms ease-out forwards;
      }
      .trigger,
      .menu {
        position: fixed;
        z-index: 2147483647;
        display: none;
        box-sizing: border-box;
        border: 1px solid #e4e4e7;
        border-radius: 6px;
        background: #ffffff;
        color: #18181b;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
        font: 14px/20px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        pointer-events: auto;
      }
      .trigger {
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        cursor: pointer;
        animation: hp-control-enter 140ms ease-out;
        transition: background-color 140ms ease, box-shadow 140ms ease;
      }
      .trigger:hover,
      .trigger:focus-visible,
      .action:hover,
      .action:focus-visible {
        background: #f4f4f5;
      }
      .trigger:focus-visible,
      .action:focus-visible,
      .prompt-input:focus-visible,
      .prompt-button:focus-visible {
        outline: 2px solid #a1a1aa;
        outline-offset: 2px;
      }
      .trigger img {
        display: block;
        width: 18px;
        height: 18px;
      }
      .menu {
        width: 232px;
        padding: 6px;
        transform-origin: top right;
        animation: hp-menu-enter 160ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .action-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
      }
      .action,
      .prompt-button {
        min-width: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: inherit;
        letter-spacing: 0;
      }
      .action {
        min-height: 30px;
        padding: 5px 8px;
        text-align: left;
      }
      .prompt-form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px;
        margin-top: 6px;
      }
      .prompt-input {
        box-sizing: border-box;
        min-width: 0;
        height: 30px;
        border: 1px solid #e4e4e7;
        border-radius: 5px;
        background: #ffffff;
        color: #18181b;
        padding: 0 8px;
        font: inherit;
        letter-spacing: 0;
      }
      .prompt-button {
        height: 30px;
        background: #18181b;
        color: #fafafa;
        padding: 0 10px;
      }
      .prompt-button:hover,
      .prompt-button:focus-visible {
        background: #27272a;
      }
      .floating-result {
        position: fixed;
        z-index: 2147483647;
        display: none;
        box-sizing: border-box;
        max-height: calc(100vh - 16px);
        overflow: hidden;
        border: 1px solid #e4e4e7;
        border-radius: 8px;
        background: #ffffff;
        color: #18181b;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
        font: 14px/20px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        pointer-events: auto;
        transform-origin: top right;
        animation: hp-menu-enter 180ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .floating-result-header {
        display: flex;
        min-height: 40px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid #e4e4e7;
        padding: 6px 8px 6px 12px;
        font-weight: 600;
      }
      .floating-result-content {
        max-height: min(360px, calc(100vh - 72px));
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .floating-result-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: 18px/1 system-ui, sans-serif;
      }
      .floating-result-close:hover,
      .floating-result-close:focus-visible {
        background: #f4f4f5;
      }
      .floating-result-close:focus-visible {
        outline: 2px solid #a1a1aa;
        outline-offset: 1px;
      }
      :host([data-pending="true"]) button {
        cursor: wait;
        opacity: 0.55;
      }
      @keyframes hp-control-enter {
        from {
          opacity: 0;
          transform: scale(0.92);
        }
      }
      @keyframes hp-agent-click {
        from {
          opacity: 1;
          transform: scale(0.35);
        }
        to {
          opacity: 0;
          transform: scale(2.2);
        }
      }
      @keyframes hp-menu-enter {
        from {
          opacity: 0;
          transform: translateY(-4px) scale(0.98);
        }
      }
      @media (prefers-color-scheme: dark) {
        .outline {
          border-color: #a1a1aa;
        }
        .outline.selected {
          border-color: #fafafa;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.72);
        }
        .trigger,
        .menu,
        .prompt-input,
        .floating-result {
          border-color: #3f3f46;
          background: #18181b;
          color: #fafafa;
        }
        .floating-result-header {
          border-bottom-color: #3f3f46;
        }
        .trigger:hover,
        .trigger:focus-visible,
        .action:hover,
        .action:focus-visible {
          background: #27272a;
        }
        .prompt-button {
          background: #f4f4f5;
          color: #18181b;
        }
        .prompt-button:hover,
        .prompt-button:focus-visible {
          background: #e4e4e7;
        }
        .floating-result-close:hover,
        .floating-result-close:focus-visible {
          background: #27272a;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .trigger,
        .menu,
        .floating-result {
          animation: none;
          transition: none;
        }
      }
    `;
    this.hoverOutline = document.createElement("div");
    this.hoverOutline.className = "outline";
    this.selectedOutline = document.createElement("div");
    this.selectedOutline.className = "outline selected";

    this.textTrigger = document.createElement("button");
    this.textTrigger.type = "button";
    this.textTrigger.className = "trigger";
    this.textTrigger.setAttribute("aria-label", t(this.locale, "aiTools"));
    this.textTrigger.setAttribute("aria-expanded", "false");
    const textTriggerIcon = document.createElement("img");
    textTriggerIcon.src = browser.runtime.getURL("/icon/16.png");
    textTriggerIcon.alt = "";
    this.textTrigger.append(textTriggerIcon);

    this.textMenu = document.createElement("div");
    this.textMenu.className = "menu";
    this.textMenu.setAttribute("role", "dialog");
    this.textMenu.setAttribute("aria-label", t(this.locale, "aiTools"));
    const textActions = document.createElement("div");
    textActions.className = "action-row";
    this.textTranslateButton = this.createActionButton(
      t(this.locale, "translate"),
    );
    this.textExplainButton = this.createActionButton(t(this.locale, "explain"));
    textActions.append(this.textTranslateButton, this.textExplainButton);
    const promptForm = document.createElement("form");
    promptForm.className = "prompt-form";
    this.textPromptInput = document.createElement("input");
    this.textPromptInput.className = "prompt-input";
    this.textPromptInput.placeholder = t(this.locale, "customPrompt");
    this.textPromptInput.setAttribute("aria-label", t(this.locale, "custom"));
    this.textPromptButton = document.createElement("button");
    this.textPromptButton.type = "submit";
    this.textPromptButton.className = "prompt-button";
    this.textPromptButton.textContent = t(this.locale, "run");
    promptForm.append(this.textPromptInput, this.textPromptButton);
    this.textMenu.append(textActions, promptForm);

    this.imageTrigger = document.createElement("button");
    this.imageTrigger.type = "button";
    this.imageTrigger.className = "trigger";
    this.imageTrigger.setAttribute(
      "aria-label",
      t(this.locale, "imageActions"),
    );
    this.imageTrigger.setAttribute("aria-expanded", "false");
    const imageTriggerIcon = document.createElement("img");
    imageTriggerIcon.src = browser.runtime.getURL("/icon/16.png");
    imageTriggerIcon.alt = "";
    this.imageTrigger.append(imageTriggerIcon);

    this.imageMenu = document.createElement("div");
    this.imageMenu.className = "menu";
    this.imageMenu.setAttribute("role", "dialog");
    this.imageMenu.setAttribute("aria-label", t(this.locale, "imageActions"));
    const imageActions = document.createElement("div");
    imageActions.className = "action-row";
    this.imageOcrButton = this.createActionButton(t(this.locale, "ocr"));
    this.imagePromptButton = this.createActionButton(
      t(this.locale, "imagePrompt"),
    );
    imageActions.append(this.imageOcrButton, this.imagePromptButton);
    this.imageMenu.append(imageActions);

    this.floatingResult = document.createElement("div");
    this.floatingResult.className = "floating-result";
    this.floatingResult.dataset.hyperpageUi = "floating-result";
    this.floatingResult.setAttribute("role", "dialog");
    this.floatingResultTitle = document.createElement("div");
    this.floatingResultTitle.className = "floating-result-title";
    this.floatingResultContent = document.createElement("div");
    this.floatingResultContent.className = "floating-result-content";
    this.floatingResultCloseButton = document.createElement("button");
    this.floatingResultCloseButton.type = "button";
    this.floatingResultCloseButton.className = "floating-result-close";
    this.floatingResultCloseButton.textContent = "×";
    const floatingResultHeader = document.createElement("div");
    floatingResultHeader.className = "floating-result-header";
    floatingResultHeader.append(
      this.floatingResultTitle,
      this.floatingResultCloseButton,
    );
    this.floatingResult.append(
      floatingResultHeader,
      this.floatingResultContent,
    );
    this.updateSettings(settings);

    this.overlayShadowRoot.append(
      style,
      this.hoverOutline,
      this.selectedOutline,
      this.textTrigger,
      this.textMenu,
      this.imageTrigger,
      this.imageMenu,
      this.floatingResult,
    );
    document.documentElement.append(this.overlayHost);

    // Prevents toolbar clicks from replacing the page text range they act on.
    const preserveTextSelection = (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    for (const button of [
      this.textTrigger,
      this.textTranslateButton,
      this.textExplainButton,
      this.textPromptButton,
      this.imageTrigger,
      this.imageOcrButton,
      this.imagePromptButton,
      this.floatingResultCloseButton,
    ]) {
      button.addEventListener("pointerdown", preserveTextSelection);
    }

    this.floatingResultCloseButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.hideFloatingResult();
    });

    this.textTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      this.textMenuOpen = !this.textMenuOpen;
      this.textTrigger.setAttribute("aria-expanded", String(this.textMenuOpen));
      this.positionTextControls();
    });
    this.textTranslateButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.textActionTarget) return;
      void this.runInlineAiAction(
        { action: "translate" },
        this.textActionTarget,
      );
    });
    this.textExplainButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.textActionTarget) return;
      void this.runInlineAiAction({ action: "explain" }, this.textActionTarget);
    });
    promptForm.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.textActionTarget) return;
      const prompt = this.textPromptInput.value.trim();
      if (!prompt) {
        this.textPromptInput.focus();
        return;
      }
      void this.runInlineAiAction(
        { action: "custom", prompt },
        this.textActionTarget,
      );
    });

    this.imageTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      this.imageMenuOpen = !this.imageMenuOpen;
      this.imageTrigger.setAttribute(
        "aria-expanded",
        String(this.imageMenuOpen),
      );
      this.positionImageControls();
    });
    this.imageOcrButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.hoveredImage) return;
      void this.runInlineAiAction(
        { action: "ocr" },
        {
          selection: createSelectionSnapshot(this.hoveredImage),
          anchor: this.hoveredImage,
        },
      );
    });
    this.imagePromptButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!this.hoveredImage) return;
      void this.runInlineAiAction(
        { action: "image-prompt" },
        {
          selection: createSelectionSnapshot(this.hoveredImage),
          anchor: this.hoveredImage,
        },
      );
    });

    this.resizeObserver = new ResizeObserver(() =>
      this.scheduleOutlineUpdate(),
    );
    this.mutationObserver = new MutationObserver((records) => {
      for (const element of this.pageTaskElements) {
        if (!element.isConnected) this.pageTaskElements.delete(element);
      }
      const selectedElement = this.selectedElement;
      if (selectedElement && !selectedElement.isConnected) {
        this.selectedElement = null;
        this.selectionRevision += 1;
        this.selectedOutline.style.display = "none";
        this.emitState();
      } else if (
        selectedElement &&
        records.some(
          (record) =>
            record.target === selectedElement ||
            selectedElement.contains(record.target),
        )
      ) {
        this.selectionRevision += 1;
        this.emitState();
      } else {
        this.scheduleOutlineUpdate();
      }
    });
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.addEventListener("scroll", this.handleViewportChange, true);
    window.addEventListener("resize", this.handleViewportChange);
    document.addEventListener("input", this.handleSelectedInput, true);
    document.addEventListener(
      "selectionchange",
      this.handleTextSelectionChange,
    );
    document.addEventListener(
      "pointermove",
      this.handleAmbientPointerMove,
      true,
    );
    document.addEventListener("pointerdown", this.handlePagePointerDown, true);
    browser.runtime.onMessage.addListener(this.handleMessage);
  }

  // Creates one compact text action used by the isolated floating menus.
  private createActionButton(label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    button.textContent = label;
    return button;
  }

  // Applies persisted display preferences to all page-level controls.
  updateSettings(
    settings: Pick<StoredSettings, "locale" | "resultDisplayMode">,
  ): void {
    this.locale = settings.locale;
    this.resultDisplayMode = settings.resultDisplayMode;
    this.textTrigger.setAttribute("aria-label", t(this.locale, "aiTools"));
    this.textMenu.setAttribute("aria-label", t(this.locale, "aiTools"));
    this.imageTrigger.setAttribute(
      "aria-label",
      t(this.locale, "imageActions"),
    );
    this.imageMenu.setAttribute("aria-label", t(this.locale, "imageActions"));
    this.textPromptInput.placeholder = t(this.locale, "customPrompt");
    this.textPromptInput.setAttribute("aria-label", t(this.locale, "custom"));
    this.floatingResultTitle.textContent = t(this.locale, "result");
    this.floatingResult.setAttribute("aria-label", t(this.locale, "result"));
    this.floatingResultCloseButton.setAttribute(
      "aria-label",
      t(this.locale, "closeResult"),
    );
    if (!this.inlineRequestPending) {
      this.textTranslateButton.textContent = t(this.locale, "translate");
      this.textExplainButton.textContent = t(this.locale, "explain");
      this.textPromptButton.textContent = t(this.locale, "run");
      this.imageOcrButton.textContent = t(this.locale, "ocr");
      this.imagePromptButton.textContent = t(this.locale, "imagePrompt");
    }
  }

  // Returns the current localized label for one page-level AI action.
  private getInlineActionLabel(action: InlineAiRequest["action"]): string {
    switch (action) {
      case "translate":
        return t(this.locale, "translate");
      case "explain":
        return t(this.locale, "explain");
      case "custom":
        return t(this.locale, "run");
      case "ocr":
        return t(this.locale, "ocr");
      case "image-prompt":
        return t(this.locale, "imagePrompt");
    }
  }

  // Receives typed commands from the extension background worker.
  private handleMessage = (
    message: ContentRequest | AgentContentRequest | ReadingContentRequest | EditingContentRequest | ResourceContentRequest,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: ContentResponse | AgentContentResponse | ReadingContentResponse | CommandResult<EditablePreview | PageState | ResourceResult | null>) => void,
  ): true | undefined => {
    if (_sender.id !== browser.runtime.id) return undefined;
    if (message.target === "resources-content") {
      const parsed = resourceCommandSchema.safeParse(message.command);
      if (!parsed.success) { sendResponse({ ok: false, error: "requestInvalid" }); return undefined; }
      void this.resources.execute(parsed.data).then(
        (data) => sendResponse({ ok: true, data }),
        (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return true;
    }
    if (message.target === "editing-content") {
      try { sendResponse({ ok: true, data: this.executeEditing(message.command) }); }
      catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
      return undefined;
    }
    if (message.target === "reading-content") {
      if (message.command.type === "read-video") {
        void this.reading.readVideo().then(
          (data) => sendResponse({ ok: true, data }),
          (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        );
        return true;
      }
      try {
        if (message.command.type === "read-selected-element") {
          if (!this.selectedElement?.isConnected) throw new Error("selectionRequired");
          sendResponse({ ok: true, data: this.reading.read(this.selectedElement) });
        } else {
          sendResponse({ ok: true, data: this.reading.execute(message.command) });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return undefined;
    }
    if (message.target === "page-agent-content") {
      void this.executeAgentCommand(message.command, message.allowedOrigins)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: unknown) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }
    if (message.target !== "content") return undefined;
    try {
      sendResponse({ ok: true, data: this.execute(message.command) });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  };

  // Creates the isolated automation indicators together with the interaction mask.
  private ensureAutomationMask(): void {
    if (this.automationMask) return;
    this.automationMask = document.createElement("div");
    this.automationMask.className = "automation-mask";
    this.automationMask.dataset.hyperpageUi = "agent-mask";
    this.automationMask.setAttribute("aria-hidden", "true");

    this.automationTarget = document.createElement("div");
    this.automationTarget.className = "automation-target";
    this.automationTarget.dataset.hyperpageAutomationTarget = "true";
    this.automationCursor = document.createElement("div");
    this.automationCursor.className = "automation-cursor";
    this.automationCursor.dataset.hyperpageAutomationCursor = "true";
    this.automationClickRipple = document.createElement("div");
    this.automationClickRipple.className = "automation-click-ripple";
    this.automationClickRipple.dataset.hyperpageAutomationClick = "true";
    this.automationMask.append(
      this.automationTarget,
      this.automationClickRipple,
      this.automationCursor,
    );
    this.overlayShadowRoot.append(this.automationMask);
  }

  // Positions the target outline and simulated cursor from the live element box.
  private showAutomationTarget(element: HTMLElement, clicking = false): void {
    this.ensureAutomationMask();
    if (
      !this.automationMask ||
      !this.automationTarget ||
      !this.automationCursor ||
      !this.automationClickRipple
    ) {
      throw new Error("Automation indicators are unavailable");
    }

    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    if (right <= left || bottom <= top) {
      this.clearAutomationTarget();
      return;
    }

    this.automationMask.style.cursor = "none";
    this.automationTarget.style.left = `${left}px`;
    this.automationTarget.style.top = `${top}px`;
    this.automationTarget.style.width = `${right - left}px`;
    this.automationTarget.style.height = `${bottom - top}px`;
    this.automationTarget.style.display = "block";

    const cursorX = Math.min(
      Math.max(left + (right - left) / 2, 4),
      window.innerWidth - 20,
    );
    const cursorY = Math.min(
      Math.max(top + (bottom - top) / 2, 4),
      window.innerHeight - 26,
    );
    this.automationCursor.style.left = `${cursorX}px`;
    this.automationCursor.style.top = `${cursorY}px`;
    this.automationCursor.style.display = "block";

    if (clicking) {
      this.automationClickRipple.style.left = `${cursorX - 9}px`;
      this.automationClickRipple.style.top = `${cursorY - 9}px`;
      this.automationClickRipple.style.removeProperty("display");
      this.automationClickRipple.classList.remove("active");
      void this.automationClickRipple.offsetWidth;
      this.automationClickRipple.classList.add("active");
    }
  }

  // Hides target-specific feedback while keeping the task cursor available.
  private clearAutomationTarget(): void {
    if (this.automationTarget) this.automationTarget.style.display = "none";
    if (this.automationClickRipple) {
      this.automationClickRipple.classList.remove("active");
      this.automationClickRipple.style.display = "none";
    }
  }

  // Clears one finished action while leaving the blocking task mask in place.
  private clearAutomationActionFeedback(): void {
    this.clearAutomationTarget();
    if (this.automationCursor) this.automationCursor.style.display = "none";
    if (this.automationMask) this.automationMask.style.cursor = "progress";
  }

  // Removes the automation surface and every indicator owned by it.
  private removeAutomationMask(): void {
    this.automationMask?.remove();
    this.automationMask = null;
    this.automationTarget = null;
    this.automationCursor = null;
    this.automationClickRipple = null;
  }

  // Executes one indexed DOM command for the background-hosted page agent.
  private async executeAgentCommand(
    command: AgentPageCommand,
    allowedOrigins: string[] = [],
  ): Promise<AgentPageCommandResult> {
    if (!["hide-mask", "clean-up-highlights", "clear-action-feedback", "dispose"].includes(command.type)) {
      assertSiteAllowed(window.location.href, parseSiteOrigins(allowedOrigins));
    }
    if (command.type === "dispose") {
      this.agentElements.clear();
      this.agentLastUpdateTime = 0;
      this.removeAutomationMask();
      return null;
    }

    switch (command.type) {
      case "get-browser-state": {
        const content = this.updateAgentTree();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const pageWidth = Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
          viewportWidth,
        );
        const pageHeight = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
          viewportHeight,
        );
        const pixelsAbove = Math.max(0, window.scrollY);
        const pixelsBelow = Math.max(
          0,
          pageHeight - pixelsAbove - viewportHeight,
        );
        const scrollRange = Math.max(0, pageHeight - viewportHeight);
        const scrollPercent = scrollRange
          ? Math.min(100, Math.round((pixelsAbove / scrollRange) * 100))
          : 0;
        const title = document.title.replace(/\s+/g, " ").trim();
        const escapedTitle = title
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
        const state: AgentBrowserState = {
          url: window.location.href,
          title,
          header: `Current Page: [${escapedTitle}](${window.location.href})\nPage info: ${viewportWidth}x${viewportHeight}px viewport, ${pageWidth}x${pageHeight}px total page size, ${pixelsAbove}px above, ${pixelsBelow}px below, at ${scrollPercent}% of page\n\nInteractive elements and visible text in the current viewport:\n\n${pixelsAbove > 4 ? `... ${pixelsAbove}px above - scroll to see more ...` : "[Start of page]"}`,
          content,
          footer:
            pixelsBelow > 4
              ? `... ${pixelsBelow}px below - scroll to see more ...`
              : "[End of page]",
        };
        return state;
      }
      case "get-last-update-time":
        return this.agentLastUpdateTime;
      case "update-tree":
        return this.updateAgentTree();
      case "clean-up-highlights":
        return null;
      case "show-mask": {
        this.ensureAutomationMask();
        if (!this.automationMask) {
          throw new Error("Automation mask is unavailable");
        }
        this.clearAutomationActionFeedback();
        this.automationMask.style.display = "block";
        return null;
      }
      case "hide-mask":
        this.clearAutomationActionFeedback();
        if (this.automationMask) this.automationMask.style.display = "none";
        return null;
      case "click-element": {
        try {
          const element = this.getAgentElement(command.index);
          if (element.matches(":disabled, [aria-disabled='true']")) {
            throw new Error("Element is disabled");
          }
          if (
            element instanceof HTMLAnchorElement &&
            element.target.toLowerCase() === "_blank"
          ) {
            throw new Error("Links that open another tab are not supported");
          }
          const link = element.closest<HTMLAnchorElement>("a[href]");
          if (link) assertSiteAllowed(link.href, allowedOrigins);
          if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === "submit" && element.form) {
            assertSiteAllowed(element.hasAttribute("formaction") ? element.formAction : element.form.action, allowedOrigins);
          }
          this.showAutomationTarget(element, true);
          element.focus({ preventScroll: true });
          element.click();
          return {
            success: true,
            message: `Clicked element [${command.index}].`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to click element: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      case "input-text": {
        try {
          const element = this.getAgentElement(command.index);
          if (containsSensitiveField(element)) throw new Error(t(this.locale, "sensitiveFieldBlocked"));
          if (element.matches(":disabled, [readonly]")) {
            throw new Error("Element is not editable");
          }
          this.showAutomationTarget(element);
          element.focus({ preventScroll: true });
          if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            if (
              element instanceof HTMLInputElement &&
              [
                "button",
                "checkbox",
                "color",
                "file",
                "hidden",
                "image",
                "radio",
                "range",
                "reset",
                "submit",
              ].includes(element.type)
            ) {
              throw new Error("Input type does not accept text");
            }
            setEditableValue(element, command.text);
          } else if (
            element.isContentEditable ||
            element.matches('[contenteditable]:not([contenteditable="false"])')
          ) {
            element.textContent = command.text;
            element.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                data: command.text,
                inputType: "insertText",
              }),
            );
            element.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            throw new Error(
              "Element is not an input, textarea, or editable area",
            );
          }
          return {
            success: true,
            message: `Entered text in element [${command.index}].`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to enter text: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      case "select-option": {
        try {
          const element = this.getAgentElement(command.index);
          if (!(element instanceof HTMLSelectElement)) {
            throw new Error("Element is not a native select");
          }
          if (element.disabled) throw new Error("Select is disabled");
          this.showAutomationTarget(element);
          const requestedText = command.text.replace(/\s+/g, " ").trim();
          const option = Array.from(element.options).find(
            (item) =>
              item.textContent?.replace(/\s+/g, " ").trim() === requestedText,
          );
          if (!option) {
            throw new Error(`Option "${requestedText}" was not found`);
          }
          if (option.disabled) throw new Error("Option is disabled");
          const setter = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            "value",
          )?.set;
          if (!setter) throw new Error("Select setter is unavailable");
          setter.call(element, option.value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return {
            success: true,
            message: `Selected "${requestedText}" in element [${command.index}].`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to select option: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      case "modify-element": {
        try {
          const element = this.getAgentElement(command.index);
          if (containsSensitiveField(element)) throw new Error(t(this.locale, "sensitiveFieldBlocked"));
          for (const change of command.changes) {
            if ((change.type === "set-style" || change.type === "remove-style") && !ALLOWED_STYLE_PROPERTIES.some((name) => name === change.name)) {
              throw new Error(t(this.locale, "elementStyleBlocked"));
            }
            if ((change.type === "set-attribute" || change.type === "remove-attribute") &&
              !ALLOWED_ELEMENT_ATTRIBUTES.some((name) => name === change.name)) {
              throw new Error(t(this.locale, "elementAttributeBlocked"));
            }
          }
          this.showAutomationTarget(element);
          for (const change of command.changes) {
            switch (change.type) {
              case "set-style":
                element.style.setProperty(change.name, change.value);
                break;
              case "remove-style":
                element.style.removeProperty(change.name);
                break;
              case "set-attribute":
                element.setAttribute(change.name, change.value);
                break;
              case "remove-attribute":
                element.removeAttribute(change.name);
                break;
              case "set-text":
                element.textContent = change.text;
                break;
            }
          }
          return {
            success: true,
            message: `Applied ${command.changes.length} DOM change(s) to element [${command.index}].`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to modify element: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      case "remove-element": {
        try {
          const element = this.getAgentElement(command.index);
          if (containsSensitiveField(element)) throw new Error(t(this.locale, "sensitiveFieldBlocked"));
          if (
            element === document.documentElement ||
            element === document.body
          ) {
            throw new Error("The document root cannot be removed");
          }
          this.showAutomationTarget(element);
          this.pageTaskElements.delete(element);
          element.remove();
          this.agentElements.delete(command.index);
          return {
            success: true,
            message: `Removed element [${command.index}] from the page.`,
          };
        } catch (error) {
          return {
            success: false,
            message: `Failed to remove element: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      case "scroll": {
        try {
          const amount =
            (command.options.pixels ??
              command.options.numPages * window.innerHeight) *
            (command.options.down ? 1 : -1);
          if (command.options.index === undefined) {
            this.clearAutomationActionFeedback();
            window.scrollBy({ top: amount, behavior: "auto" });
            return {
              success: true,
              message: `Scrolled the page vertically by ${amount}px.`,
            };
          }

          let element: HTMLElement | null = this.getAgentElement(
            command.options.index,
          );
          while (element) {
            const style = window.getComputedStyle(element);
            if (
              /(auto|scroll|overlay)/.test(style.overflowY) &&
              element.scrollHeight > element.clientHeight
            ) {
              this.showAutomationTarget(element);
              const maximum = element.scrollHeight - element.clientHeight;
              element.scrollTop = Math.max(
                0,
                Math.min(maximum, element.scrollTop + amount),
              );
              element.dispatchEvent(new Event("scroll"));
              return {
                success: true,
                message: `Scrolled container [${command.options.index}] vertically by ${amount}px.`,
              };
            }
            element = element.parentElement;
          }
          throw new Error("No vertically scrollable container was found");
        } catch (error) {
          return {
            success: false,
            message: `Failed to scroll vertically: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      case "scroll-horizontally": {
        try {
          const amount =
            command.options.pixels * (command.options.right ? 1 : -1);
          if (command.options.index === undefined) {
            this.clearAutomationActionFeedback();
            window.scrollBy({ left: amount, behavior: "auto" });
            return {
              success: true,
              message: `Scrolled the page horizontally by ${amount}px.`,
            };
          }

          let element: HTMLElement | null = this.getAgentElement(
            command.options.index,
          );
          while (element) {
            const style = window.getComputedStyle(element);
            if (
              /(auto|scroll|overlay)/.test(style.overflowX) &&
              element.scrollWidth > element.clientWidth
            ) {
              this.showAutomationTarget(element);
              const maximum = element.scrollWidth - element.clientWidth;
              element.scrollLeft = Math.max(
                0,
                Math.min(maximum, element.scrollLeft + amount),
              );
              element.dispatchEvent(new Event("scroll"));
              return {
                success: true,
                message: `Scrolled container [${command.options.index}] horizontally by ${amount}px.`,
              };
            }
            element = element.parentElement;
          }
          throw new Error("No horizontally scrollable container was found");
        } catch (error) {
          return {
            success: false,
            message: `Failed to scroll horizontally: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    }
  }

  // Rebuilds the current viewport's text snapshot and stable element index map.
  private updateAgentTree(): string {
    this.agentElements.clear();
    const interactiveIndexes = new Map<HTMLElement, number>();
    const pageTaskAgentTargets = new Set<HTMLElement>();
    for (const element of this.pageTaskElements) {
      let target: Element | null = element;
      while (target && !(target instanceof HTMLElement)) {
        target = target.parentElement;
      }
      if (target) pageTaskAgentTargets.add(target);
    }
    const interactiveRoles = new Set([
      "button",
      "checkbox",
      "combobox",
      "link",
      "menuitem",
      "option",
      "radio",
      "searchbox",
      "slider",
      "spinbutton",
      "switch",
      "tab",
      "textbox",
    ]);

    for (const candidate of document.body.querySelectorAll("*")) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (
        candidate.closest(
          "[data-hyperpage-ui], [data-page-agent-not-interactive]",
        ) ||
        candidate.closest("[hidden], [inert], [aria-hidden='true']")
      ) {
        continue;
      }
      const style = window.getComputedStyle(candidate);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0"
      ) {
        continue;
      }
      const bounds = candidate.getBoundingClientRect();
      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.bottom <= 0 ||
        bounds.right <= 0 ||
        bounds.top >= window.innerHeight ||
        bounds.left >= window.innerWidth
      ) {
        continue;
      }

      const role = candidate.getAttribute("role")?.trim().toLowerCase();
      const nativeInteractive = candidate.matches(
        'a[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable]:not([contenteditable="false"])',
      );
      const scriptedInteractive =
        candidate.hasAttribute("onclick") ||
        candidate.onclick !== null ||
        candidate.tabIndex >= 0 ||
        Boolean(role && interactiveRoles.has(role));
      const verticallyScrollable =
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        candidate.scrollHeight > candidate.clientHeight;
      const horizontallyScrollable =
        /(auto|scroll|overlay)/.test(style.overflowX) &&
        candidate.scrollWidth > candidate.clientWidth;
      const userSelected = pageTaskAgentTargets.has(candidate);
      if (
        !nativeInteractive &&
        !scriptedInteractive &&
        !verticallyScrollable &&
        !horizontallyScrollable &&
        !userSelected
      ) {
        continue;
      }

      const index = this.agentElements.size;
      this.agentElements.set(index, candidate);
      interactiveIndexes.set(candidate, index);
    }

    const lines: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node instanceof HTMLElement) {
            if (
              ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(
                node.tagName,
              ) ||
              node.closest(
                "[data-hyperpage-ui], [data-page-agent-not-interactive]",
              ) ||
              node.closest("[hidden], [inert], [aria-hidden='true']")
              || (isSensitiveElement(node) && !interactiveIndexes.has(node))
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            const style = window.getComputedStyle(node);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              style.opacity === "0"
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            return interactiveIndexes.has(node)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }

          const parent = node.parentElement;
          if (!parent || !node.textContent?.replace(/\s+/g, " ").trim()) {
            return NodeFilter.FILTER_SKIP;
          }
          let ancestor: HTMLElement | null = parent;
          while (ancestor) {
            if (interactiveIndexes.has(ancestor)) {
              return NodeFilter.FILTER_SKIP;
            }
            ancestor = ancestor.parentElement;
          }
          const range = document.createRange();
          range.selectNodeContents(node);
          const bounds = range.getBoundingClientRect();
          return bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.bottom > 0 &&
            bounds.right > 0 &&
            bounds.top < window.innerHeight &&
            bounds.left < window.innerWidth
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      },
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.replace(/\s+/g, " ").trim();
        if (text) {
          lines.push(
            text
              .slice(0, 1_000)
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;"),
          );
        }
        continue;
      }

      const element = node as HTMLElement;
      const index = interactiveIndexes.get(element);
      if (index === undefined) continue;
      const attributes: Array<[string, string]> = [];
      if (pageTaskAgentTargets.has(element)) {
        attributes.push(["data-hyperpage-selected", "true"]);
      }
      for (const name of [
        "title",
        "type",
        "name",
        "role",
        "placeholder",
        "alt",
        "aria-label",
        "aria-expanded",
        "aria-checked",
        "aria-haspopup",
        "target",
        "contenteditable",
      ]) {
        const value = element.getAttribute(name)?.replace(/\s+/g, " ").trim();
        if (value) attributes.push([name, value]);
      }
      if (element.matches(":disabled")) attributes.push(["disabled", "true"]);
      if (element.matches("[readonly]")) attributes.push(["readonly", "true"]);
      if (
        element instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(element.type)
      ) {
        attributes.push(["checked", String(element.checked)]);
      }

      let text = "";
      if (isSensitiveElement(element)) {
        attributes.push(["data-hyperpage-protected", "true"]);
      } else if (element instanceof HTMLInputElement) {
        text = element.value;
      } else if (element instanceof HTMLTextAreaElement) {
        text = element.value;
      } else if (element instanceof HTMLSelectElement) {
        text = Array.from(element.options)
          .map((option) => option.textContent?.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" | ");
        attributes.push(["value", element.value]);
      } else {
        text = getVisibleText(element);
      }
      text = text.replace(/\s+/g, " ").trim().slice(0, 500);

      const style = window.getComputedStyle(element);
      const scrollParts: string[] = [];
      if (
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight
      ) {
        scrollParts.push(
          `top=${Math.round(element.scrollTop)}`,
          `bottom=${Math.round(element.scrollHeight - element.clientHeight - element.scrollTop)}`,
        );
      }
      if (
        /(auto|scroll|overlay)/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth
      ) {
        scrollParts.push(
          `left=${Math.round(element.scrollLeft)}`,
          `right=${Math.round(element.scrollWidth - element.clientWidth - element.scrollLeft)}`,
        );
      }
      if (scrollParts.length) {
        attributes.push(["data-scrollable", scrollParts.join(", ")]);
      }

      let depth = 0;
      let ancestor = element.parentElement;
      while (ancestor) {
        if (interactiveIndexes.has(ancestor)) depth += 1;
        ancestor = ancestor.parentElement;
      }
      const serializedAttributes = attributes
        .map(
          ([name, value]) =>
            `${name}="${value
              .slice(0, 160)
              .replaceAll("&", "&amp;")
              .replaceAll('"', "&quot;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")}"`,
        )
        .join(" ");
      const openingTag = `<${element.tagName.toLowerCase()}${serializedAttributes ? ` ${serializedAttributes}` : ""}`;
      const escapedText = text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      lines.push(
        `${"\t".repeat(depth)}[${index}]${openingTag}${escapedText ? `>${escapedText}</${element.tagName.toLowerCase()}>` : " />"}`,
      );
    }

    this.agentLastUpdateTime = Date.now();
    return lines.length ? lines.join("\n") : "<EMPTY>";
  }

  // Resolves an element only from the most recent page snapshot.
  private getAgentElement(index: number): HTMLElement {
    if (!this.agentLastUpdateTime) {
      throw new Error("The page has not been indexed yet");
    }
    const element = this.agentElements.get(index);
    if (!element || !element.isConnected) {
      throw new Error(
        `No current interactive element exists at index ${index}`,
      );
    }
    if (isSensitiveElement(element)) throw new Error(t(this.locale, "sensitiveFieldBlocked"));
    return element;
  }

  // Routes the complete page command union to its exact controller operation.
  execute(command: PageCommand): PageCommandResult {
    switch (command.type) {
      case "start-selection":
        this.startSelection(false);
        break;
      case "start-page-task-selection":
        this.startSelection(true);
        break;
      case "add-selection-to-page-task":
        if (!this.selectedElement) throw new Error("selectionRequired");
        this.pageTaskElements.add(this.selectedElement);
        break;
      case "select-parent":
        this.selectParent();
        break;
      case "cancel-selection":
        this.cancelSelection();
        break;
      case "get-page-state":
        break;
      case "undo-replace":
        this.editing.undo();
        this.emitState();
        break;
      case "insert-result":
        this.insertResult(command.text);
        break;
      case "remove-insertion":
        this.removeInsertion();
        break;
      case "suspend-overlay":
        this.suspendOverlay();
        break;
      case "restore-overlay":
        this.restoreOverlay();
        break;
      case "check-capture-area":
        checkCaptureArea(command.rect, command.viewport);
        break;
      default:
        throw new Error("requestInvalid");
    }

    return this.getPageState();
  }

  executeEditing(command: PageEditingCommand): EditablePreview | PageState | null {
    switch (command.type) {
      case "prepare-edit":
        if (command.selectionRevision !== this.selectionRevision) throw new Error("requestContextChanged");
        return this.editing.prepare(this.selectedElement, command.mode, command.text);
      case "apply-edit":
        this.editing.apply(command.previewId);
        this.emitState();
        return this.getPageState();
      case "cancel-edit":
        this.editing.cancel(command.previewId);
        return null;
      default:
        throw new Error("requestInvalid");
    }
  }

  // Releases every observer, event listener, and DOM node owned by this controller.
  destroy(): void {
    this.reading.clear();
    this.editing.destroy();
    this.resources.destroy();
    this.stopSelection();
    this.agentElements.clear();
    this.pageTaskElements.clear();
    this.agentLastUpdateTime = 0;
    this.removeAutomationMask();
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    window.removeEventListener("scroll", this.handleViewportChange, true);
    window.removeEventListener("resize", this.handleViewportChange);
    document.removeEventListener("input", this.handleSelectedInput, true);
    document.removeEventListener(
      "selectionchange",
      this.handleTextSelectionChange,
    );
    document.removeEventListener(
      "pointermove",
      this.handleAmbientPointerMove,
      true,
    );
    document.removeEventListener(
      "pointerdown",
      this.handlePagePointerDown,
      true,
    );
    browser.runtime.onMessage.removeListener(this.handleMessage);
    this.overlayHost.remove();
  }

  // Starts inspector mode and intercepts only the click used to confirm selection.
  private startSelection(forPageTask: boolean): void {
    if (this.selecting) return;
    this.selecting = true;
    this.selectingPageTaskElement = forPageTask;
    this.textActionTarget = null;
    this.hoveredImage = null;
    this.hideTextControls();
    this.hideImageControls();
    this.cursorValue =
      document.documentElement.style.getPropertyValue("cursor");
    this.cursorPriority =
      document.documentElement.style.getPropertyPriority("cursor");
    document.documentElement.style.setProperty(
      "cursor",
      "crosshair",
      "important",
    );
    document.addEventListener("pointermove", this.handlePointerMove, true);
    document.addEventListener("click", this.handleSelectionClick, true);
    document.addEventListener("keydown", this.handleSelectionKeydown, true);
    this.emitState();
  }

  // Stops inspector mode while preserving the current confirmed selection.
  private stopSelection(): void {
    if (!this.selecting) return;
    this.selecting = false;
    this.hoveredElement = null;
    this.hoverOutline.style.display = "none";
    if (this.cursorValue) {
      document.documentElement.style.setProperty(
        "cursor",
        this.cursorValue,
        this.cursorPriority,
      );
    } else {
      document.documentElement.style.removeProperty("cursor");
    }
    document.removeEventListener("pointermove", this.handlePointerMove, true);
    document.removeEventListener("click", this.handleSelectionClick, true);
    document.removeEventListener("keydown", this.handleSelectionKeydown, true);
  }

  // Cancels inspector mode and clears the confirmed selection outline.
  private cancelSelection(): void {
    this.stopSelection();
    this.selectingPageTaskElement = false;
    this.resizeObserver.disconnect();
    if (this.selectedElement) this.selectionRevision += 1;
    this.selectedElement = null;
    this.selectedOutline.style.display = "none";
    this.emitState();
  }

  // Tracks the deepest page-owned element under the pointer.
  private handlePointerMove = (event: PointerEvent): void => {
    const element = this.getEventElement(event);
    if (!element || element === this.hoveredElement) return;
    this.hoveredElement = element;
    this.drawOutline(this.hoverOutline, element);
  };

  // Confirms a target without allowing the underlying page action to run.
  private handleSelectionClick = (event: MouseEvent): void => {
    const element = this.getEventElement(event);
    if (!element) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.confirmSelection(element);
  };

  // Gives Escape a predictable way to leave inspector mode.
  private handleSelectionKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelSelection();
  };

  // Reports whether an event originated from either HyperPage AI shadow tree.
  private isHyperpageUiEvent(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (node) =>
          node instanceof Element && node.hasAttribute("data-hyperpage-ui"),
      );
  }

  // Extracts the original composed-path element and excludes HyperPage AI UI nodes.
  private getEventElement(event: Event): Element | null {
    if (this.isHyperpageUiEvent(event)) return null;
    const element = event
      .composedPath()
      .find((node) => node instanceof Element);
    if (!(element instanceof Element)) return null;
    return element;
  }

  // Promotes the selection to its direct HTML parent when one exists.
  private selectParent(): void {
    if (!this.selectedElement) throw new Error("selectionRequired");
    const parent = this.selectedElement.parentElement;
    if (!parent) throw new Error("parentUnavailable");
    this.confirmSelection(parent);
  }

  // Stores a confirmed element and begins tracking its live bounds.
  private confirmSelection(element: Element): void {
    const pageTaskElement = this.selectingPageTaskElement;
    this.stopSelection();
    this.selectingPageTaskElement = false;
    this.resizeObserver.disconnect();
    this.selectedElement = element;
    if (pageTaskElement) this.pageTaskElements.add(element);
    this.selectionRevision += 1;
    this.resizeObserver.observe(element);
    this.drawOutline(this.selectedOutline, element);
    this.emitState();
  }

  // Schedules one outline update for clustered scroll, resize, and DOM events.
  private scheduleOutlineUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    requestAnimationFrame(() => {
      this.updateScheduled = false;
      if (this.selectedElement) {
        this.drawOutline(this.selectedOutline, this.selectedElement);
      }
      if (this.selecting && this.hoveredElement) {
        this.drawOutline(this.hoverOutline, this.hoveredElement);
      }
      if (this.hoveredImage) {
        this.positionImageControls();
      } else if (this.textActionTarget) {
        this.positionTextControls();
      }
    });
  }

  // Responds to viewport movement without doing synchronous repeated layout work.
  private handleViewportChange = (): void => {
    this.scheduleOutlineUpdate();
  };

  // Invalidates results when the page or user changes the selected editable content.
  private handleSelectedInput = (event: Event): void => {
    if (
      this.selectedElement &&
      event.target instanceof Node &&
      (event.target === this.selectedElement ||
        this.selectedElement.contains(event.target))
    ) {
      this.selectionRevision += 1;
      this.emitState();
    }
  };

  // Tracks a native page text range without changing the element inspector selection.
  private handleTextSelectionChange = (): void => {
    if (this.selecting || this.inlineRequestPending || this.textMenuOpen)
      return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      this.textActionTarget = null;
      this.hideTextControls();
      return;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const commonNode = range.commonAncestorContainer;
    const anchor =
      commonNode instanceof HTMLElement ? commonNode : commonNode.parentElement;
    const rect = range.getBoundingClientRect();
    if (
      !anchor ||
      containsSensitiveField(anchor) ||
      anchor === document.body ||
      anchor === document.documentElement ||
      anchor.closest("[data-hyperpage-ui]") ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      this.textActionTarget = null;
      this.hideTextControls();
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      this.textActionTarget = null;
      this.hideTextControls();
      return;
    }

    const elementSelection = createSelectionSnapshot(anchor);
    this.textActionTarget = {
      anchor,
      range,
      selection: {
        ...elementSelection,
        kind: "text",
        text,
        editable: false,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      },
    };
    this.textMenuOpen = false;
    this.textPromptInput.value = "";
    this.positionTextControls();
  };

  // Shows the image action trigger only while the pointer is over a page image.
  private handleAmbientPointerMove = (event: PointerEvent): void => {
    if (this.selecting || this.overlaySuspended) {
      this.hoveredImage = null;
      this.hideImageControls();
      return;
    }
    if (this.inlineRequestPending) return;
    if (this.isHyperpageUiEvent(event)) return;

    const element = event
      .composedPath()
      .find((node) => node instanceof Element);
    const image =
      element instanceof HTMLImageElement
        ? element
        : element instanceof Element
          ? element.closest("img")
          : null;
    if (!(image instanceof HTMLImageElement)) {
      this.hoveredImage = null;
      this.hideImageControls();
      if (this.textActionTarget) this.positionTextControls();
      return;
    }

    this.hoveredImage = image;
    this.hideTextControls();
    this.positionImageControls();
  };

  // Closes open floating menus when the user resumes interacting with the page.
  private handlePagePointerDown = (event: PointerEvent): void => {
    if (this.isHyperpageUiEvent(event)) return;
    this.textMenuOpen = false;
    this.textTrigger.setAttribute("aria-expanded", "false");
    this.textMenu.style.display = "none";
    this.imageMenuOpen = false;
    this.imageTrigger.setAttribute("aria-expanded", "false");
    this.imageMenu.style.display = "none";
  };

  // Hides the text trigger and closes its menu while retaining any stored range.
  private hideTextControls(): void {
    this.textMenuOpen = false;
    this.textTrigger.setAttribute("aria-expanded", "false");
    this.textTrigger.style.display = "none";
    this.textMenu.style.display = "none";
  }

  // Hides the image trigger and closes its menu while retaining the hovered image.
  private hideImageControls(): void {
    this.imageMenuOpen = false;
    this.imageTrigger.setAttribute("aria-expanded", "false");
    this.imageTrigger.style.display = "none";
    this.imageMenu.style.display = "none";
  }

  // Positions the text trigger and optional menu against the live selected range.
  private positionTextControls(): void {
    const target = this.textActionTarget;
    if (
      this.overlaySuspended ||
      !target ||
      !target.anchor.isConnected ||
      containsSensitiveField(target.anchor) ||
      !target.range
    ) {
      this.textTrigger.style.display = "none";
      this.textMenu.style.display = "none";
      return;
    }

    const rect = target.range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.hideTextControls();
      return;
    }
    target.selection.rect = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    target.selection.viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const left = Math.max(8, Math.min(rect.right - 30, window.innerWidth - 38));
    const top =
      rect.bottom + 38 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(8, rect.top - 36);
    this.textTrigger.style.display = "flex";
    this.textTrigger.style.left = `${left}px`;
    this.textTrigger.style.top = `${top}px`;

    if (!this.textMenuOpen) {
      this.textMenu.style.display = "none";
      return;
    }
    const menuLeft = Math.max(
      8,
      Math.min(left + 30 - 232, window.innerWidth - 240),
    );
    const menuTop =
      top + 124 <= window.innerHeight ? top + 36 : Math.max(8, top - 88);
    this.textMenu.style.display = "block";
    this.textMenu.style.left = `${menuLeft}px`;
    this.textMenu.style.top = `${menuTop}px`;
  }

  // Positions the image trigger inside the hovered image and its menu alongside it.
  private positionImageControls(): void {
    const image = this.hoveredImage;
    if (this.overlaySuspended || !image || !image.isConnected) {
      this.imageTrigger.style.display = "none";
      this.imageMenu.style.display = "none";
      return;
    }

    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.hideImageControls();
      return;
    }
    const left = Math.max(8, Math.min(rect.right - 36, window.innerWidth - 38));
    const top = Math.max(8, Math.min(rect.top + 6, window.innerHeight - 38));
    this.imageTrigger.style.display = "flex";
    this.imageTrigger.style.left = `${left}px`;
    this.imageTrigger.style.top = `${top}px`;

    if (!this.imageMenuOpen) {
      this.imageMenu.style.display = "none";
      return;
    }
    const menuLeft = Math.max(
      8,
      Math.min(left + 30 - 232, window.innerWidth - 240),
    );
    const menuTop =
      top + 78 <= window.innerHeight ? top + 30 : Math.max(8, top - 42);
    this.imageMenu.style.display = "block";
    this.imageMenu.style.left = `${menuLeft}px`;
    this.imageMenu.style.top = `${menuTop}px`;
  }

  // Runs one page-level AI action and renders it in the configured destination.
  private async runInlineAiAction(
    request: InlineAiRequest,
    target: InlineActionTarget,
  ): Promise<void> {
    if (
      this.inlineRequestPending ||
      !target.anchor.isConnected ||
      containsSensitiveField(target.anchor) ||
      target.anchor === document.body ||
      target.anchor === document.documentElement
    ) {
      return;
    }

    this.inlineRequestPending = true;
    const resultDisplayMode = this.resultDisplayMode;
    this.overlayHost.dataset.pending = "true";
    for (const control of [
      this.textTrigger,
      this.textTranslateButton,
      this.textExplainButton,
      this.textPromptInput,
      this.textPromptButton,
      this.imageTrigger,
      this.imageOcrButton,
      this.imagePromptButton,
    ]) {
      control.disabled = true;
    }
    let pendingControl: HTMLButtonElement;
    switch (request.action) {
      case "translate":
        pendingControl = this.textTranslateButton;
        break;
      case "explain":
        pendingControl = this.textExplainButton;
        break;
      case "custom":
        pendingControl = this.textPromptButton;
        break;
      case "ocr":
        pendingControl = this.imageOcrButton;
        break;
      case "image-prompt":
        pendingControl = this.imagePromptButton;
        break;
    }
    pendingControl.textContent = t(this.locale, "processing");

    let output: string;
    try {
      const message: BackgroundRequest = {
        target: "background",
        type: "run-inline-ai",
        requestId: crypto.randomUUID(),
        request,
        selection: target.selection,
      };
      const response = (await browser.runtime.sendMessage(
        message,
      )) as CommandResult<string>;
      if (!response.ok) throw new Error(response.error);
      output = response.data;
    } catch (error) {
      notify.error(formatError(this.locale, error));
      return;
    } finally {
      this.inlineRequestPending = false;
      delete this.overlayHost.dataset.pending;
      pendingControl.textContent = this.getInlineActionLabel(request.action);
      for (const control of [
        this.textTrigger,
        this.textTranslateButton,
        this.textExplainButton,
        this.textPromptInput,
        this.textPromptButton,
        this.imageTrigger,
        this.imageOcrButton,
        this.imagePromptButton,
      ]) {
        control.disabled = false;
      }
      this.textActionTarget = null;
      this.hoveredImage = null;
      this.hideTextControls();
      this.hideImageControls();
    }
    if (resultDisplayMode === "floating") {
      this.showFloatingResult(output, target.selection.rect);
    } else if (target.anchor.isConnected) {
      this.insertResult(output, target.anchor);
    }
  }

  // Displays one non-layout-changing result window beside the source region.
  private showFloatingResult(
    text: string,
    anchorRect: ViewportRect,
  ): void {
    const title = t(this.locale, "result");
    this.floatingResult.setAttribute("role", "dialog");
    this.floatingResultTitle.textContent = title;
    this.floatingResult.setAttribute("aria-label", title);
    this.floatingResultContent.textContent = text;
    const width = Math.min(360, window.innerWidth - 16);
    this.floatingResult.style.width = `${width}px`;
    this.floatingResult.style.display = "block";
    this.floatingResult.style.visibility = "hidden";

    const height = this.floatingResult.getBoundingClientRect().height;
    const below = anchorRect.y + anchorRect.height + 8;
    const top =
      below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, anchorRect.y - height - 8);
    const left = Math.max(
      8,
      Math.min(anchorRect.x, window.innerWidth - width - 8),
    );
    this.floatingResult.style.top = `${top}px`;
    this.floatingResult.style.left = `${left}px`;
    this.floatingResult.style.visibility = "visible";
  }

  // Closes the current floating result without modifying page content.
  private hideFloatingResult(): void {
    this.floatingResult.style.display = "none";
    this.floatingResultContent.textContent = "";
  }

  // Positions an isolated fixed outline over an element without changing layout.
  private drawOutline(outline: HTMLDivElement, element: Element): void {
    if (this.overlaySuspended) {
      outline.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      outline.style.display = "none";
      return;
    }
    outline.style.display = "block";
    outline.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
  }

  // Inserts a safe plain-text result after an explicit page anchor.
  private insertResult(
    text: string,
    anchor: Element | null = this.selectedElement,
  ): HTMLDivElement {
    if (!(anchor instanceof HTMLElement)) {
      throw new Error("htmlElementRequired");
    }
    if (anchor === document.documentElement || anchor === document.body) {
      throw new Error("rootElementModificationBlocked");
    }
    const parent = anchor.parentNode;
    if (!parent) throw new Error("insertionUnavailable");

    const host = document.createElement("div");
    host.dataset.hyperpageUi = "result";
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("margin", "8px 0", "important");
    host.style.setProperty("visibility", "visible", "important");
    host.style.setProperty("opacity", "1", "important");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .result {
        position: relative;
        box-sizing: border-box;
        border-left: 2px solid #18181b;
        border-radius: 0 6px 6px 0;
        background: #fafafa;
        color: #18181b;
        padding: 10px 36px 10px 12px;
        font: 14px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        white-space: pre-wrap;
        animation: hp-result-enter 180ms ease-out;
      }
      .close {
        position: absolute;
        top: 6px;
        right: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font: 12px/1 system-ui, sans-serif;
        opacity: 0;
        pointer-events: none;
      }
      .result:hover .close,
      .result:focus-within .close {
        opacity: 1;
        pointer-events: auto;
      }
      .close:hover,
      .close:focus-visible {
        background: #e4e4e7;
      }
      .close:focus-visible {
        outline: 2px solid #a1a1aa;
        outline-offset: 1px;
      }
      @keyframes hp-result-enter {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
      }
      @media (prefers-color-scheme: dark) {
        .result {
          border-left-color: #fafafa;
          background: #18181b;
          color: #fafafa;
        }
        .close:hover,
        .close:focus-visible {
          background: #3f3f46;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .result,
        .close {
          animation: none;
          transition: none;
        }
      }
    `;
    const wrapper = document.createElement("div");
    wrapper.className = "result";
    const result = document.createElement("div");
    result.textContent = text;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "close";
    closeButton.textContent = "X";
    closeButton.setAttribute("aria-label", t(this.locale, "closeResult"));
    closeButton.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = this.insertedResults.indexOf(host);
      if (index === -1) return;
      this.insertedResults.splice(index, 1);
      host.remove();
      this.emitState();
    });
    wrapper.append(result, closeButton);
    shadowRoot.append(style, wrapper);
    parent.insertBefore(host, anchor.nextSibling);
    this.insertedResults.push(host);
    this.emitState();
    return result;
  }

  // Removes the most recently inserted HyperPage AI result from the document.
  private removeInsertion(): void {
    const result = this.insertedResults.pop();
    if (!result) throw new Error("nothingToUndo");
    result.remove();
    this.emitState();
  }

  // Removes HyperPage AI outlines from screenshots while retaining the selection.
  private suspendOverlay(): void {
    this.overlaySuspended = true;
    this.floatingResultVisibleBeforeSuspend =
      this.floatingResult.style.display === "block";
    this.hoverOutline.style.display = "none";
    this.selectedOutline.style.display = "none";
    this.textTrigger.style.display = "none";
    this.textMenu.style.display = "none";
    this.imageTrigger.style.display = "none";
    this.imageMenu.style.display = "none";
    this.floatingResult.style.display = "none";

    const panel = document.querySelector<HTMLElement>(
      '[data-hyperpage-ui="panel"]',
    );
    if (panel) {
      this.suspendedPanelVisibility = panel.style.visibility;
      panel.style.setProperty("visibility", "hidden", "important");
    }
  }

  // Restores the live selection outline after screenshot capture completes.
  private restoreOverlay(): void {
    this.overlaySuspended = false;
    if (this.floatingResultVisibleBeforeSuspend) {
      this.floatingResult.style.display = "block";
      this.floatingResultVisibleBeforeSuspend = false;
    }
    const panel = document.querySelector<HTMLElement>(
      '[data-hyperpage-ui="panel"]',
    );
    if (panel && this.suspendedPanelVisibility !== null) {
      panel.style.setProperty(
        "visibility",
        this.suspendedPanelVisibility,
        "important",
      );
    }
    this.suspendedPanelVisibility = null;
    this.scheduleOutlineUpdate();
  }

  // Returns a fresh serializable page state rather than retaining stale geometry.
  private getPageState(): PageState {
    const selection: SelectionSnapshot | null = this.selectedElement
      ? createSelectionSnapshot(this.selectedElement)
      : null;
    return {
      selection,
      selectionRevision: this.selectionRevision,
      canUndoReplace: this.editing.canUndo,
      canRemoveInsertion: this.insertedResults.length > 0,
      selecting: this.selecting,
    };
  }

  // Publishes the current state so the page's floating panel updates immediately.
  private emitState(): void {
    const event: ContentEvent = {
      target: "background",
      type: "page-state-changed",
      state: this.getPageState(),
    };
    void browser.runtime.sendMessage(event);
  }
}

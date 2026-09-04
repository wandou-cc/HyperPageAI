import { browser } from "wxt/browser";

import type {
  BackgroundRequest,
  CommandResult,
  ContentEvent,
  ContentRequest,
  ContentResponse,
  InlineAiRequest,
  Locale,
  PageState,
  ResultDisplayMode,
  SelectionSnapshot,
  StoredSettings,
  ViewportRect,
} from "../shared/messages";
import { createSelectionSnapshot } from "../shared/selection";
import { formatError, t } from "../entrypoints/sidepanel/translations";

interface HiddenChange {
  element: HTMLElement;
  displayValue: string;
  displayPriority: string;
}

type EditableChange =
  | {
      kind: "value";
      element: HTMLInputElement | HTMLTextAreaElement;
      value: string;
    }
  | { kind: "html"; element: HTMLElement; html: string };

interface InlineActionTarget {
  selection: SelectionSnapshot;
  anchor: HTMLElement;
  range?: Range;
}

export class PageController {
  private selectedElement: Element | null = null;
  private hoveredElement: Element | null = null;
  private selecting = false;
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
  private hiddenChanges: HiddenChange[] = [];
  private editableChanges: EditableChange[] = [];
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
    message: ContentRequest,
    _sender: Browser.runtime.MessageSender,
    sendResponse: (response?: ContentResponse) => void,
  ): void => {
    if (message.target !== "content") return undefined;
    try {
      sendResponse({ ok: true, data: this.execute(message.command) });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Executes one page command against the controller's current selection state.
  execute(command: ContentRequest["command"]): PageState {
    switch (command.type) {
      case "start-selection":
        this.startSelection();
        break;
      case "select-parent":
        this.selectParent();
        break;
      case "cancel-selection":
        this.cancelSelection();
        break;
      case "get-page-state":
        break;
      case "hide-selection":
        this.hideSelection();
        break;
      case "undo-hide":
        this.undoHide();
        break;
      case "replace-editable":
        this.replaceEditable(command.text);
        break;
      case "undo-replace":
        this.undoReplace();
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
    }

    return this.getPageState();
  }

  // Releases every observer, event listener, and DOM node owned by this controller.
  destroy(): void {
    this.stopSelection();
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
  private startSelection(): void {
    if (this.selecting) return;
    this.selecting = true;
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
    this.stopSelection();
    this.resizeObserver.disconnect();
    this.selectedElement = element;
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

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0).cloneRange();
    const commonNode = range.commonAncestorContainer;
    const anchor =
      commonNode instanceof HTMLElement ? commonNode : commonNode.parentElement;
    const rect = range.getBoundingClientRect();
    if (
      !text ||
      !anchor ||
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
      output = formatError(this.locale, error);
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
  private showFloatingResult(text: string, anchorRect: ViewportRect): void {
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

  // Temporarily hides the selected HTML element and records its exact inline style.
  private hideSelection(): void {
    if (!(this.selectedElement instanceof HTMLElement)) {
      throw new Error("htmlElementRequired");
    }
    if (
      this.selectedElement === document.documentElement ||
      this.selectedElement === document.body
    ) {
      throw new Error("rootElementModificationBlocked");
    }
    this.hiddenChanges.push({
      element: this.selectedElement,
      displayValue: this.selectedElement.style.getPropertyValue("display"),
      displayPriority:
        this.selectedElement.style.getPropertyPriority("display"),
    });
    this.selectedElement.style.setProperty("display", "none", "important");
    this.selectedOutline.style.display = "none";
    this.emitState();
  }

  // Restores the most recently hidden element's original inline display declaration.
  private undoHide(): void {
    const change = this.hiddenChanges.pop();
    if (!change) throw new Error("nothingToUndo");
    if (change.displayValue) {
      change.element.style.setProperty(
        "display",
        change.displayValue,
        change.displayPriority,
      );
    } else {
      change.element.style.removeProperty("display");
    }
    this.scheduleOutlineUpdate();
    this.emitState();
  }

  // Replaces a selected editable value and dispatches the browser events sites expect.
  private replaceEditable(text: string): void {
    const element = this.selectedElement;
    if (!element || !createSelectionSnapshot(element).editable) {
      throw new Error("editableRequired");
    }

    if (element instanceof HTMLInputElement) {
      this.editableChanges.push({
        kind: "value",
        element,
        value: element.value,
      });
      this.setNativeValue(element, text);
    } else if (element instanceof HTMLTextAreaElement) {
      this.editableChanges.push({
        kind: "value",
        element,
        value: element.value,
      });
      this.setNativeValue(element, text);
    } else if (element instanceof HTMLElement) {
      this.editableChanges.push({
        kind: "html",
        element,
        html: element.innerHTML,
      });
      element.textContent = text;
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: text }),
      );
    }
    this.emitState();
  }

  // Applies a value through the native setter so controlled inputs observe the change.
  private setNativeValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("editableSetterUnavailable");
    setter.call(element, value);
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: value }),
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Restores the most recently replaced editable value or HTML fragment.
  private undoReplace(): void {
    const change = this.editableChanges.pop();
    if (!change) throw new Error("nothingToUndo");
    if (change.kind === "value") {
      this.setNativeValue(change.element, change.value);
    } else {
      change.element.innerHTML = change.html;
      change.element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    this.emitState();
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
      canUndoHide: this.hiddenChanges.length > 0,
      canUndoReplace: this.editableChanges.length > 0,
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

import { beforeAll, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";

import { PageController } from "../lib/page-controller";
import {
  createSelectionSnapshot,
  getAccessibleName,
  getElementText,
} from "../shared/selection";

class ResizeObserverMock {
  // The controller only requires the lifecycle methods in this DOM test.
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeAll(() => {
  vi.spyOn(browser.i18n, "getUILanguage").mockReturnValue("en");
  vi.spyOn(browser.runtime, "getURL").mockImplementation(
    (path) => `chrome-extension://test${path}`,
  );
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({
      x: 20,
      y: 30,
      width: 180,
      height: 22,
      top: 30,
      right: 200,
      bottom: 52,
      left: 20,
      toJSON: () => ({}),
    })),
  });
});

describe("selection extraction", () => {
  it("reads editable values while never exposing password values", () => {
    const input = document.createElement("input");
    input.value = "  readable value  ";
    expect(getElementText(input)).toBe("readable value");
    expect(createSelectionSnapshot(input).editable).toBe(true);

    input.type = "password";
    input.value = "secret";
    expect(getElementText(input)).toBe("");
    expect(createSelectionSnapshot(input).editable).toBe(false);
  });

  it("uses semantic image text for the accessible label", () => {
    const image = document.createElement("img");
    image.alt = "Product diagram";
    expect(getAccessibleName(image)).toBe("Product diagram");
    image.setAttribute("aria-label", "Architecture diagram");
    expect(getAccessibleName(image)).toBe("Architecture diagram");
  });
});

describe("page controller", () => {
  it("selects without activating the page and reverses every page mutation", async () => {
    document.body.innerHTML =
      '<section><a href="#opened">Open</a><input value="draft"></section>';
    document.documentElement.style.cursor = "wait";
    const link = document.querySelector("a");
    const input = document.querySelector("input");
    const section = document.querySelector("section");
    if (!link || !input || !section)
      throw new Error("Missing DOM test fixture");
    Object.defineProperty(link, "innerText", {
      configurable: true,
      value: "Open",
    });
    Object.defineProperty(section, "innerText", {
      configurable: true,
      value: "Open",
    });
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      width: 80,
      height: 24,
      top: 20,
      right: 90,
      bottom: 44,
      left: 10,
      toJSON: () => ({}),
    });

    const controller = new PageController({
      locale: "en",
      resultDisplayMode: "floating",
    });
    const overlay = document.querySelector<HTMLElement>(
      '[data-hyperpage-ui="overlay"]',
    );
    if (!overlay) throw new Error("Missing isolated overlay host");
    expect(overlay.style.getPropertyValue("z-index")).toBe("2147483647");
    expect(overlay.style.getPropertyPriority("z-index")).toBe("important");
    expect(overlay.style.getPropertyPriority("position")).toBe("important");
    expect(controller.execute({ type: "start-selection" }).selecting).toBe(
      true,
    );
    expect(document.documentElement.style.cursor).toBe("crosshair");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(
      controller.execute({ type: "get-page-state" }).selection?.tagName,
    ).toBe("a");
    expect(document.documentElement.style.cursor).toBe("wait");

    expect(
      controller.execute({ type: "select-parent" }).selection?.tagName,
    ).toBe("section");
    controller.execute({ type: "start-selection" });
    input.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    controller.execute({ type: "replace-editable", text: "polished" });
    expect(input.value).toBe("polished");
    controller.execute({ type: "undo-replace" });
    expect(input.value).toBe("draft");

    controller.execute({ type: "hide-selection" });
    expect(input.style.getPropertyValue("display")).toBe("none");
    controller.execute({ type: "undo-hide" });
    expect(input.style.getPropertyValue("display")).toBe("");

    controller.execute({ type: "insert-result", text: "Translated" });
    const insertedResult = document.querySelector<HTMLElement>(
      '[data-hyperpage-ui="result"]',
    );
    if (!insertedResult?.shadowRoot) {
      throw new Error("Missing inserted result shadow root");
    }
    expect(insertedResult.style.getPropertyPriority("display")).toBe(
      "important",
    );
    const closeResult =
      insertedResult.shadowRoot.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove result"]',
      );
    if (!closeResult) throw new Error("Missing result close button");
    closeResult.click();
    expect(document.querySelector('[data-hyperpage-ui="result"]')).toBeNull();
    expect(
      controller.execute({ type: "get-page-state" }).canRemoveInsertion,
    ).toBe(false);

    controller.execute({ type: "insert-result", text: "Translated again" });
    controller.execute({ type: "remove-insertion" });
    expect(document.querySelector('[data-hyperpage-ui="result"]')).toBeNull();

    const revision = controller.execute({
      type: "get-page-state",
    }).selectionRevision;
    input.remove();
    await Promise.resolve();
    const disconnectedState = controller.execute({ type: "get-page-state" });
    expect(disconnectedState.selection).toBeNull();
    expect(disconnectedState.selectionRevision).toBeGreaterThan(revision);
    controller.destroy();
  });

  it("routes page-level AI results to the configured destination", async () => {
    document.body.innerHTML = '<p>Selected phrase</p><img alt="Reference">';
    const paragraph = document.querySelector("p");
    const image = document.querySelector("img");
    if (!paragraph || !image) throw new Error("Missing inline action fixture");
    Object.defineProperty(paragraph, "innerText", {
      configurable: true,
      value: "Selected phrase",
    });
    Object.defineProperty(image, "innerText", {
      configurable: true,
      value: "",
    });
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 300,
      y: 80,
      width: 240,
      height: 160,
      top: 80,
      right: 540,
      bottom: 240,
      left: 300,
      toJSON: () => ({}),
    });

    const controller = new PageController({
      locale: "en",
      resultDisplayMode: "floating",
    });
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    if (!selection) throw new Error("Missing document selection");
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const controls = controller as unknown as {
      textTrigger: HTMLButtonElement;
      textActionTarget: { selection: { text: string } } | null;
      imageTrigger: HTMLButtonElement;
      imageMenu: HTMLDivElement;
      imagePromptButton: HTMLButtonElement;
      floatingResult: HTMLDivElement;
      floatingResultCloseButton: HTMLButtonElement;
    };
    expect(controls.textTrigger.style.display).toBe("flex");
    expect(controls.textActionTarget?.selection.text).toBe("Selected phrase");

    image.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    expect(controls.imageTrigger.style.display).toBe("flex");
    expect(controls.textTrigger.style.display).toBe("none");

    const sendMessage = vi
      .spyOn(browser.runtime, "sendMessage")
      .mockResolvedValue({ ok: true, data: "Detailed image prompt" } as never);
    controls.imageTrigger.click();
    expect(controls.imageMenu.style.display).toBe("block");
    controls.imagePromptButton.click();
    await vi.waitFor(() => {
      expect(controls.floatingResult.style.display).toBe("block");
    });
    expect(controls.floatingResult.textContent).toContain(
      "Detailed image prompt",
    );
    expect(document.querySelector('[data-hyperpage-ui="result"]')).toBeNull();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run-inline-ai",
        request: { action: "image-prompt" },
        selection: expect.objectContaining({ kind: "image" }),
      }),
    );
    controls.floatingResultCloseButton.click();
    expect(controls.floatingResult.style.display).toBe("none");

    controller.updateSettings({ locale: "en", resultDisplayMode: "inline" });
    image.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    controls.imageTrigger.click();
    controls.imagePromptButton.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-hyperpage-ui="result"]'),
      ).not.toBeNull();
    });
    const inlineResult = document.querySelector<HTMLElement>(
      '[data-hyperpage-ui="result"]',
    );
    expect(inlineResult?.shadowRoot?.textContent).toContain(
      "Detailed image prompt",
    );

    inlineResult?.remove();
    sendMessage.mockRestore();
    selection.removeAllRanges();
    controller.destroy();
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";

import { PageController } from "../lib/page-controller";
import type {
  AgentBrowserState,
  AgentPageCommand,
  AgentPageCommandResult,
} from "../shared/messages";
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

interface AgentTestController {
  agentElements: Map<number, HTMLElement>;
  agentLastUpdateTime: number;
  automationMask: HTMLDivElement | null;
  executeAgentCommand(
    command: AgentPageCommand,
  ): Promise<AgentPageCommandResult>;
}

// Creates a visible form fixture with stable indexes for page-agent DOM tests.
function createAgentFixture(): {
  controller: PageController;
  agent: AgentTestController;
  button: HTMLButtonElement;
  input: HTMLInputElement;
  select: HTMLSelectElement;
  scrollable: HTMLDivElement;
  rectSpy: ReturnType<typeof vi.spyOn>;
} {
  document.body.innerHTML = `
    <p>Visible account settings</p>
    <button aria-label="Save settings">Save</button>
    <input name="displayName" value="Alice">
    <input name="password" type="password" value="top-secret">
    <select name="country">
      <option>China</option>
      <option selected>Canada</option>
    </select>
    <div id="scrollable" style="overflow-y: auto; overflow-x: auto">Scrollable results</div>
    <div data-hyperpage-ui="panel"><button>HyperPage only</button></div>
  `;
  const rectSpy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 10,
      y: 20,
      width: 240,
      height: 40,
      top: 20,
      right: 250,
      bottom: 60,
      left: 10,
      toJSON: () => ({}),
    });
  const button = document.querySelector("button");
  const input = document.querySelector<HTMLInputElement>(
    'input[name="displayName"]',
  );
  const select = document.querySelector("select");
  const scrollable = document.querySelector<HTMLDivElement>("#scrollable");
  if (!button || !input || !select || !scrollable) {
    throw new Error("Missing page-agent test fixture");
  }
  Object.defineProperties(scrollable, {
    clientHeight: { configurable: true, value: 100 },
    clientWidth: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 500 },
    scrollWidth: { configurable: true, value: 600 },
  });
  const controller = new PageController({
    locale: "en",
    resultDisplayMode: "floating",
  });
  return {
    controller,
    agent: controller as unknown as AgentTestController,
    button,
    input,
    select,
    scrollable,
    rectSpy,
  };
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
  it("selects without activating the page and manages AI result mutations", async () => {
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

    sendMessage.mockResolvedValueOnce({
      ok: false,
      error: "apiRequestFailed:500:Service unavailable",
    } as never);
    image.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    controls.imageTrigger.click();
    controls.imagePromptButton.click();
    await vi.waitFor(() => {
      expect(controls.floatingResult.dataset.variant).toBe("error");
    });
    expect(controls.floatingResult.textContent).toContain("Failed");
    expect(controls.floatingResult.textContent).toContain(
      "API request failed (500): Service unavailable",
    );
    expect(document.querySelector('[data-hyperpage-ui="result"]')).toBeNull();

    sendMessage.mockRestore();
    selection.removeAllRanges();
    controller.destroy();
  });

  it("indexes visible page controls while omitting extension UI and password values", async () => {
    const fixture = createAgentFixture();
    document.title = "Account settings";

    const state = (await fixture.agent.executeAgentCommand({
      type: "get-browser-state",
    })) as AgentBrowserState;

    expect(state.title).toBe("Account settings");
    expect(state.url).toBe(window.location.href);
    expect(state.header).toContain("Page info:");
    expect(state.content).toContain("Visible account settings");
    expect(state.content).toContain(
      '[0]<button aria-label="Save settings">Save</button>',
    );
    expect(state.content).toContain("Alice");
    expect(state.content).toContain('type="password"');
    expect(state.content).toContain("China | Canada");
    expect(state.content).toContain(
      'data-scrollable="top=0, bottom=400, left=0, right=400"',
    );
    expect(state.content).not.toContain("top-secret");
    expect(state.content).not.toContain("HyperPage only");
    expect(fixture.agent.agentElements.size).toBe(5);

    fixture.controller.destroy();
    fixture.rectSpy.mockRestore();
  });

  it("indexes every page-task element selected across a continuous flow", async () => {
    document.body.innerHTML = `
      <div id="first-task-target">Submit this order</div>
      <div id="second-task-target">Confirm payment</div>
    `;
    const firstTarget =
      document.querySelector<HTMLDivElement>("#first-task-target");
    const secondTarget = document.querySelector<HTMLDivElement>(
      "#second-task-target",
    );
    if (!firstTarget || !secondTarget) {
      throw new Error("Missing selected target fixture");
    }
    Object.defineProperty(firstTarget, "innerText", {
      configurable: true,
      value: "Submit this order",
    });
    Object.defineProperty(secondTarget, "innerText", {
      configurable: true,
      value: "Confirm payment",
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 10,
        y: 20,
        width: 160,
        height: 32,
        top: 20,
        right: 170,
        bottom: 52,
        left: 10,
        toJSON: () => ({}),
      });
    const controller = new PageController({
      locale: "en",
      resultDisplayMode: "floating",
    });
    const agent = controller as unknown as AgentTestController;
    controller.execute({ type: "start-page-task-selection" });
    firstTarget.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    controller.execute({ type: "start-page-task-selection" });
    secondTarget.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    const state = (await agent.executeAgentCommand({
      type: "get-browser-state",
    })) as AgentBrowserState;
    expect(state.content).toContain(
      '[0]<div data-hyperpage-selected="true">Submit this order</div>',
    );
    expect(state.content).toContain(
      '[1]<div data-hyperpage-selected="true">Confirm payment</div>',
    );

    const clickListener = vi.fn();
    secondTarget.addEventListener("click", clickListener);
    await expect(
      agent.executeAgentCommand({ type: "click-element", index: 1 }),
    ).resolves.toMatchObject({ success: true });
    expect(clickListener).toHaveBeenCalledOnce();

    controller.destroy();
    rectSpy.mockRestore();
  });

  it("modifies and removes a selected page element through indexed DOM commands", async () => {
    document.body.innerHTML =
      '<h1 id="target" title="Original" style="font-size: 20px">Heading</h1>';
    const target = document.querySelector<HTMLHeadingElement>("#target");
    if (!target) throw new Error("Missing DOM mutation fixture");
    Object.defineProperty(target, "innerText", {
      configurable: true,
      value: "Heading",
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 10,
        y: 20,
        width: 240,
        height: 48,
        top: 20,
        right: 250,
        bottom: 68,
        left: 10,
        toJSON: () => ({}),
      });
    const controller = new PageController({
      locale: "en",
      resultDisplayMode: "floating",
    });
    const agent = controller as unknown as AgentTestController;
    controller.execute({ type: "start-page-task-selection" });
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    const state = (await agent.executeAgentCommand({
      type: "get-browser-state",
    })) as AgentBrowserState;
    expect(state.content).toContain(
      '[0]<h1 data-hyperpage-selected="true" title="Original">Heading</h1>',
    );

    await expect(
      agent.executeAgentCommand({
        type: "modify-element",
        index: 0,
        changes: [
          { type: "set-style", name: "color", value: "red" },
          { type: "set-style", name: "font-size", value: "32px" },
          { type: "set-attribute", name: "title", value: "Revised" },
          { type: "set-text", text: "Changed heading" },
        ],
      }),
    ).resolves.toMatchObject({ success: true });
    expect(target.style.color).toBe("red");
    expect(target.style.fontSize).toBe("32px");
    expect(target.title).toBe("Revised");
    expect(target.textContent).toBe("Changed heading");

    await agent.executeAgentCommand({
      type: "modify-element",
      index: 0,
      changes: [
        { type: "remove-style", name: "font-size" },
        { type: "remove-attribute", name: "title" },
      ],
    });
    expect(target.style.fontSize).toBe("");
    expect(target.hasAttribute("title")).toBe(false);

    await expect(
      agent.executeAgentCommand({ type: "remove-element", index: 0 }),
    ).resolves.toMatchObject({ success: true });
    expect(target.isConnected).toBe(false);

    controller.destroy();
    rectSpy.mockRestore();
  });

  it("adds the current regular selection to the page-task element set", async () => {
    document.body.innerHTML = '<div id="task-target">Open order details</div>';
    const target = document.querySelector<HTMLDivElement>("#task-target");
    if (!target) throw new Error("Missing selected target fixture");
    Object.defineProperty(target, "innerText", {
      configurable: true,
      value: "Open order details",
    });
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 10,
        y: 20,
        width: 160,
        height: 32,
        top: 20,
        right: 170,
        bottom: 52,
        left: 10,
        toJSON: () => ({}),
      });
    const controller = new PageController({
      locale: "en",
      resultDisplayMode: "floating",
    });
    const agent = controller as unknown as AgentTestController;

    expect(() =>
      controller.execute({ type: "add-selection-to-page-task" }),
    ).toThrow("selectionRequired");
    controller.execute({ type: "start-selection" });
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    controller.execute({ type: "add-selection-to-page-task" });

    const state = (await agent.executeAgentCommand({
      type: "get-browser-state",
    })) as AgentBrowserState;
    expect(state.content).toContain(
      '[0]<div data-hyperpage-selected="true">Open order details</div>',
    );

    controller.destroy();
    rectSpy.mockRestore();
  });

  it("clicks, enters text, selects options, and scrolls indexed elements", async () => {
    const fixture = createAgentFixture();
    await fixture.agent.executeAgentCommand({ type: "update-tree" });
    const clickListener = vi.fn();
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    fixture.button.addEventListener("click", clickListener);
    fixture.input.addEventListener("input", inputListener);
    fixture.select.addEventListener("change", changeListener);

    await expect(
      fixture.agent.executeAgentCommand({ type: "click-element", index: 0 }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      fixture.agent.executeAgentCommand({
        type: "input-text",
        index: 1,
        text: "Bob",
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      fixture.agent.executeAgentCommand({
        type: "select-option",
        index: 3,
        text: "China",
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      fixture.agent.executeAgentCommand({
        type: "scroll",
        options: { down: true, numPages: 1, pixels: 80, index: 4 },
      }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      fixture.agent.executeAgentCommand({
        type: "scroll-horizontally",
        options: { right: true, pixels: 60, index: 4 },
      }),
    ).resolves.toMatchObject({ success: true });

    expect(clickListener).toHaveBeenCalledOnce();
    expect(fixture.input.value).toBe("Bob");
    expect(inputListener).toHaveBeenCalledOnce();
    expect(fixture.select.value).toBe("China");
    expect(changeListener).toHaveBeenCalledOnce();
    expect(fixture.scrollable.scrollTop).toBe(80);
    expect(fixture.scrollable.scrollLeft).toBe(60);

    fixture.controller.destroy();
    fixture.rectSpy.mockRestore();
  });

  it("keeps automation feedback visible between agent steps", async () => {
    const fixture = createAgentFixture();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    await fixture.agent.executeAgentCommand({ type: "update-tree" });
    await fixture.agent.executeAgentCommand({ type: "show-mask" });

    await fixture.agent.executeAgentCommand({
      type: "click-element",
      index: 0,
    });
    const mask = fixture.agent.automationMask;
    const target = mask?.querySelector<HTMLElement>(
      '[data-hyperpage-automation-target="true"]',
    );
    const cursor = mask?.querySelector<HTMLElement>(
      '[data-hyperpage-automation-cursor="true"]',
    );
    const click = mask?.querySelector<HTMLElement>(
      '[data-hyperpage-automation-click="true"]',
    );

    expect(target?.style.display).toBe("block");
    expect(target?.style.left).toBe("10px");
    expect(target?.style.top).toBe("20px");
    expect(target?.style.width).toBe("240px");
    expect(target?.style.height).toBe("40px");
    expect(cursor?.style.display).toBe("block");
    expect(cursor?.style.left).toBe("130px");
    expect(cursor?.style.top).toBe("40px");
    expect(click).toHaveClass("active");

    await fixture.agent.executeAgentCommand({ type: "get-browser-state" });
    expect(mask?.style.display).toBe("block");
    expect(target?.style.display).toBe("block");
    expect(cursor?.style.display).toBe("block");
    expect(click).toHaveClass("active");

    await fixture.agent.executeAgentCommand({
      type: "scroll",
      options: { down: true, numPages: 1, pixels: 80 },
    });
    expect(scrollBy).toHaveBeenCalledWith({ top: 80, behavior: "auto" });
    expect(target?.style.display).toBe("none");
    expect(cursor?.style.display).toBe("none");

    await fixture.agent.executeAgentCommand({
      type: "input-text",
      index: 1,
      text: "Bob",
    });
    expect(target?.style.display).toBe("block");
    await fixture.agent.executeAgentCommand({
      type: "click-element",
      index: 0,
    });
    expect(click?.style.display).toBe("");
    expect(click).toHaveClass("active");
    await fixture.agent.executeAgentCommand({ type: "hide-mask" });
    expect(target?.style.display).toBe("none");
    expect(cursor?.style.display).toBe("none");

    scrollBy.mockRestore();
    fixture.controller.destroy();
    fixture.rectSpy.mockRestore();
  });

  it("removes the interaction mask and indexed references on disposal", async () => {
    const fixture = createAgentFixture();
    await fixture.agent.executeAgentCommand({ type: "update-tree" });
    await fixture.agent.executeAgentCommand({ type: "show-mask" });
    const mask = fixture.agent.automationMask;

    expect(mask?.style.display).toBe("block");
    expect(mask?.isConnected).toBe(true);
    await fixture.agent.executeAgentCommand({ type: "hide-mask" });
    expect(mask?.style.display).toBe("none");
    await fixture.agent.executeAgentCommand({ type: "show-mask" });
    await fixture.agent.executeAgentCommand({ type: "dispose" });

    expect(mask?.isConnected).toBe(false);
    expect(fixture.agent.automationMask).toBeNull();
    expect(fixture.agent.agentElements.size).toBe(0);
    expect(fixture.agent.agentLastUpdateTime).toBe(0);

    fixture.controller.destroy();
    fixture.rectSpy.mockRestore();
  });

});

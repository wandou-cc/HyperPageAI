import { vi } from "vitest";

// JSDOM has no layout engine; supply geometry for the real virtualizer only.
export function mockSourceTextLayout() {
  const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-source-list") ? 256 : this.hasAttribute("data-source-row") ? 104 : 0;
  });
  const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-source-list") ? 400 : 0;
  });
  const clientHeight = vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-source-list") ? 256 : 0;
  });
  const scrollHeight = vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return this.hasAttribute("data-source-list") && this.firstElementChild instanceof HTMLElement
      ? Number.parseFloat(this.firstElementChild.style.height) : 0;
  });
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      if (!this.hasAttribute("data-source-list")) return;
      const top = Math.max(0, Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight));
      if (this.scrollTop === top) return;
      this.scrollTop = top;
      this.dispatchEvent(new Event("scroll"));
    },
  });
  return () => {
    height.mockRestore();
    width.mockRestore();
    clientHeight.mockRestore();
    scrollHeight.mockRestore();
    if (previous) Object.defineProperty(HTMLElement.prototype, "scrollTo", previous);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  };
}

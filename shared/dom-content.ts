const EXCLUDED_CONTENT =
  "script, style, noscript, template, iframe, object, embed, [data-hyperpage-ui], [data-page-agent-not-interactive]";

export function isSensitiveField(element: Element): boolean {
  if (element.matches('input[type="password" i]')) return true;
  return (element.getAttribute("autocomplete") ?? "")
    .toLowerCase()
    .split(/\s+/)
    .some(
      (token) =>
        token === "current-password" ||
        token === "new-password" ||
        token === "one-time-code" ||
        token.startsWith("cc-") ||
        token === "transaction-amount" ||
        token === "transaction-currency",
    );
}

export function isSensitiveElement(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (isSensitiveField(current)) return true;
    current = current.parentElement;
  }
  return false;
}

export function containsSensitiveField(element: Element): boolean {
  return (
    isSensitiveElement(element) ||
    Array.from(element.querySelectorAll("input, [autocomplete]")).some(
      isSensitiveField,
    )
  );
}

export function isVisibleContent(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      current.matches(
        `${EXCLUDED_CONTENT}, [hidden], [inert], [aria-hidden='true']`,
      )
    )
      return false;
    if (
      current.parentElement instanceof HTMLDetailsElement &&
      !current.parentElement.open &&
      current.tagName !== "SUMMARY"
    )
      return false;
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0" ||
      style.contentVisibility === "hidden"
    )
      return false;
    current = current.parentElement;
  }
  return true;
}

// Read text nodes so descendants cannot leak hidden text or protected form values.
export function getVisibleText(element: Element): string {
  if (!isVisibleContent(element) || isSensitiveElement(element)) return "";
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node instanceof Element) {
          return !isVisibleContent(node) ||
            isSensitiveElement(node) ||
            node.matches("input, textarea, select")
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent) parts.push(node.textContent);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

import { parseTranslationResult, type PageTranslationCommand, type TranslationDisplayMode } from "../shared/page-translation";
import type { PageReading } from "./page-reading";

export class PageTranslation {
  private originals: Array<{ wrapper: HTMLSpanElement; node: Text; text: string }> = [];
  private translations: HTMLSpanElement[] = [];

  constructor(private reading: PageReading) {}

  execute(command: PageTranslationCommand): null {
    if (command.type === "restore-translation") this.restore();
    else if (command.type === "translation-mode") this.setMode(command.mode);
    else if (command.type === "apply-translation") {
      if (this.translations.length) throw new Error("translationAlreadyApplied");
      const result = parseTranslationResult(command.result);
      const entries = result.translations.map((item) => ({ ...item, nodes: this.reading.getBlockNodes(result.snapshotId, item.blockId) }));
      for (const entry of entries) {
        let last: HTMLSpanElement | undefined;
        for (const node of entry.nodes) {
          const wrapper = document.createElement("span");
          node.before(wrapper);
          wrapper.append(node);
          this.originals.push({ wrapper, node, text: node.data });
          last = wrapper;
        }
        if (!last) throw new Error("citationUnavailable");
        const translation = document.createElement("span");
        translation.dataset.hyperpageUi = "translation";
        translation.style.setProperty("display", "block", "important");
        translation.style.setProperty("white-space", "pre-wrap", "important");
        translation.textContent = entry.text;
        last.after(translation);
        this.translations.push(translation);
      }
      this.setMode("bilingual");
    } else throw new Error("requestInvalid");
    return null;
  }

  private setMode(mode: TranslationDisplayMode): void {
    if (!["original", "bilingual", "translated"].includes(mode)) throw new Error("requestInvalid");
    if (!this.translations.length) throw new Error("translationUnavailable");
    if (this.translations.some((node) => !node.isConnected) ||
      this.originals.some(({ wrapper, node, text }) => !wrapper.isConnected || wrapper.childNodes.length !== 1 || wrapper.firstChild !== node || node.data !== text)) throw new Error("translationPageChanged");
    for (const { wrapper } of this.originals) wrapper.style.setProperty("display", mode === "translated" ? "none" : "contents", "important");
    for (const translation of this.translations) translation.style.setProperty("display", mode === "original" ? "none" : "block", "important");
  }

  restore(): void {
    for (const translation of this.translations) translation.remove();
    // Unwrap the current children so website edits made during translation survive.
    for (const { wrapper } of this.originals) wrapper.replaceWith(...wrapper.childNodes);
    this.originals = [];
    this.translations = [];
  }
}

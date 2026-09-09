import { afterEach, describe, expect, it, vi } from "vitest";
import { PageReading } from "../lib/page-reading";
import { PageTranslation } from "../lib/page-translation";
import { loadTranslationTerms, saveTranslationTerms, translateReading } from "../shared/page-translation";
import { clearLocalData, loadLocalData } from "../shared/local-data";

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), getBytesInUse: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { storage: { local: storage } } }));
afterEach(() => vi.clearAllMocks());

describe("page translation", () => {
  it("preserves actual DOM nodes and event handlers across bilingual, original, translated and restored views", () => {
    document.body.innerHTML = "<p>First <b>passage</b>.</p><p>Second</p><textarea>Private</textarea>";
    const reading = new PageReading();
    const translation = new PageTranslation(reading);
    const page = reading.read();
    const markup = document.body.innerHTML;
    const bold = document.querySelector("b");
    const text = bold?.firstChild;
    const clicked = vi.fn();
    bold?.addEventListener("click", clicked);
    translation.execute({ type: "apply-translation", result: { snapshotId: page.id, translations: page.blocks.map((block) => ({ blockId: block.id, text: `<script>literal ${block.id}</script>` })) } });
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelectorAll('[data-hyperpage-ui="translation"]')).toHaveLength(2);
    expect(reading.read().blocks.map((block) => block.text)).toEqual(page.blocks.map((block) => block.text));
    translation.execute({ type: "translation-mode", mode: "translated" });
    expect(text?.parentElement?.style.display).toBe("none");
    translation.execute({ type: "translation-mode", mode: "original" });
    expect(document.querySelector<HTMLElement>('[data-hyperpage-ui="translation"]')?.style.display).toBe("none");
    translation.restore();
    expect(document.body.innerHTML).toBe(markup);
    expect(bold?.firstChild).toBe(text);
    bold?.click();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("validates every original before modifying any paragraph and preserves later website changes on restore", () => {
    document.body.innerHTML = "<p>First</p><p>Second</p>";
    const reading = new PageReading();
    const translation = new PageTranslation(reading);
    const page = reading.read();
    const result = { snapshotId: page.id, translations: page.blocks.map((block) => ({ blockId: block.id, text: "Translated" })) };
    const second = document.querySelectorAll("p")[1];
    second?.append(" changed");
    expect(() => translation.execute({ type: "apply-translation", result })).toThrow("citationUnavailable");
    expect(document.querySelector("span")).toBeNull();
    const current = reading.read();
    translation.execute({ type: "apply-translation", result: { snapshotId: current.id, translations: current.blocks.map((block) => ({ blockId: block.id, text: "Translated" })) } });
    const first = document.querySelector("p span");
    if (!first) throw new Error("Missing original wrapper");
    first.textContent = "Website edit";
    expect(() => translation.execute({ type: "translation-mode", mode: "translated" })).toThrow("translationPageChanged");
    translation.restore();
    expect(document.querySelector("p")?.textContent).toBe("Website edit");
    expect(document.querySelector("span")).toBeNull();
  });

  it("translates only provided blocks with terminology and rejects missing or duplicated model IDs", async () => {
    const page = { id: "source", title: "Page", url: "https://example.com", blocks: [{ id: "1.1", text: "First", heading: "", headingLevel: null }, { id: "1.2", text: "Second", heading: "", headingLevel: null }] };
    const args = { page, language: "Chinese", terms: [{ source: "First", target: "One" }], signal: new AbortController().signal };
    const generate = vi.fn().mockResolvedValue(JSON.stringify([{ id: "1", text: "Two" }, { id: "0", text: "One" }]));
    await expect(translateReading({ ...args, generate })).resolves.toEqual({ snapshotId: "source", translations: [{ blockId: "1.1", text: "One" }, { blockId: "1.2", text: "Two" }] });
    expect(JSON.parse(generate.mock.calls[0]?.[1])).toEqual({ terms: args.terms, blocks: [{ id: "0", text: "First" }, { id: "1", text: "Second" }] });
    for (const output of ["not JSON", '[]', '[{"id":"0","text":"One"},{"id":"0","text":"Two"}]', '[{"id":"0","text":"One"},{"id":"unknown","text":"Two"}]']) {
      generate.mockResolvedValue(output);
      await expect(translateReading({ ...args, generate })).rejects.toThrow("translationResponseInvalid");
    }
  });

  it("sends a long paragraph intact in one translation request", async () => {
    const text = "a".repeat(20_000);
    const page = { id: "source", title: "Page", url: "https://example.com", blocks: [{ id: "3.7", text, heading: "", headingLevel: null }] };
    const generate = vi.fn().mockResolvedValue('[{"id":"0","text":"Translated"}]');
    await expect(translateReading({ page, language: "Chinese", terms: [], signal: new AbortController().signal, generate })).resolves.toEqual({ snapshotId: "source", translations: [{ blockId: "3.7", text: "Translated" }] });
    expect(generate).toHaveBeenCalledOnce();
    expect(JSON.parse(generate.mock.calls[0]?.[1]).blocks).toEqual([{ id: "0", text }]);
  });

  it("does not persist terminology until saved, and includes it in local data inspection and deletion", async () => {
    storage.get.mockResolvedValue({});
    expect(await loadTranslationTerms()).toEqual([]);
    expect(storage.set).not.toHaveBeenCalled();
    const terms = [{ source: "Cache", target: "Storage" }];
    await saveTranslationTerms(terms);
    expect(storage.set).toHaveBeenCalledWith({ "hyperpage.translationTerms": { version: 1, terms } });
    await expect(saveTranslationTerms([...terms, ...terms])).rejects.toThrow("translationTermsInvalid");
    storage.get.mockResolvedValue({ "hyperpage.translationTerms": { version: 1, terms } });
    storage.getBytesInUse.mockImplementation(async (keys: string[]) => keys.length ? 100 : 0);
    expect((await loadLocalData()).groups.terms).toEqual({ count: 1, bytes: 100, data: { version: 1, terms } });
    await clearLocalData("terms");
    expect(storage.remove).toHaveBeenCalledWith(["hyperpage.translationTerms"]);
  });
});

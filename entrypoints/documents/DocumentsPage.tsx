import { message as notify, Toaster } from "@/components/ui/toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, FolderOpen, Settings, X } from "lucide-react";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { loadPdfFile, type LoadedPdf } from "../../lib/pdf-reading";
import { readTextFile } from "../../shared/files";
import { normalizeImageBlob } from "../../shared/image";
import { decodeResourceFile, type PageResource, type ResourceCatalog, type ResourceSource } from "../../shared/page-resources";
import type { BackgroundRequest, CommandResult, Locale, PageCitation, StoredSettings } from "../../shared/messages";
import { getTaskProvider, loadSettings, SETTINGS_STORAGE_KEY } from "../../shared/settings";
import { TextExport } from "../sidepanel/TextExport";
import { IconTooltip } from "../sidepanel/ui";
import { formatError, t } from "../sidepanel/translations";
import { SourceConversation } from "../sidepanel/SourceConversation";
import { SourceTextView, type SourceTextViewHandle } from "../sidepanel/SourceTextView";
import { TranscriptView } from "../sidepanel/TranscriptView";
import { PageResourceList } from "./PageResourceList";
import { requestPageResource } from "./resource-client";

GlobalWorkerOptions.workerSrc = workerUrl;

async function request<T>(message: BackgroundRequest): Promise<T> {
  const result = await browser.runtime.sendMessage(message) as CommandResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function DocumentsPage({ embedded = false }: { embedded?: boolean }) {
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const locale: Locale = settings?.locale ?? (browser.i18n.getUILanguage().toLowerCase().startsWith("zh") ? "zh_CN" : "en");
  const [source, setSource] = useState<ResourceSource | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [selectedResource, setSelectedResource] = useState<PageResource | null>(null);
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ completed: 0, total: 0 });
  const [chatBusy, setChatBusy] = useState(false);
  const [catalog, setCatalog] = useState<ResourceCatalog | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(embedded);
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<SourceTextViewHandle>(null);
  const loaded = useRef<LoadedPdf | null>(null);
  const live = useRef(true);
  const resourceAbort = useRef(new AbortController());
  useEffect(() => {
    const blocks = source?.type === "file" ? source.file.blocks : source?.type === "page" ? source.page.blocks : [];
    setSelectedBlockIds(blocks.map((block) => block.id));
  }, [source]);
  const conversationSource = useMemo(() => {
    const selected = new Set(selectedBlockIds);
    if (source?.type === "file") return { ...source, file: { ...source.file, blocks: source.file.blocks.filter((block) => selected.has(block.id)) } };
    if (source?.type === "page") return { ...source, page: { ...source.page, blocks: source.page.blocks.filter((block) => selected.has(block.id)) } };
    return source;
  }, [source, selectedBlockIds]);

  async function scan(): Promise<void> {
    const signal = resourceAbort.current.signal;
    setScanning(true);
    setScanError(null);
    try {
      const result = await requestPageResource({ type: "scan" }, signal);
      if (result.type !== "catalog") throw new Error("resourceResponseInvalid");
      if (!signal.aborted) setCatalog(result);
    } catch (error) {
      if (!signal.aborted) setScanError(formatError(locale, error));
    } finally {
      if (!signal.aborted) setScanning(false);
    }
  }

  useEffect(() => {
    live.current = true;
    resourceAbort.current = new AbortController();
    const refresh = () => {
      void loadSettings(browser.i18n.getUILanguage()).then(setSettings).catch((failure) => notify.error(formatError(locale, failure)));
    };
    refresh();
    if (embedded) void scan();
    const changed = (changes: Record<string, Browser.storage.StorageChange>, area: Browser.storage.AreaName) => {
      if (area === "local" && changes[SETTINGS_STORAGE_KEY]) refresh();
    };
    browser.storage.onChanged.addListener(changed);
    return () => {
      live.current = false;
      resourceAbort.current.abort();
      browser.storage.onChanged.removeListener(changed);
      if (loaded.current) void loaded.current.document.loadingTask.destroy().catch((failure: unknown) => console.error("Failed to release PDF resources", failure));
    };
  }, [embedded]);
  useEffect(() => {
    document.documentElement.lang = locale === "zh_CN" ? "zh-CN" : "en";
    document.title = `HyperPage AI - ${t(locale, "documents")}`;
  }, [locale]);

  async function releasePdf(): Promise<void> {
    const previous = loaded.current;
    loaded.current = null;
    setPdf(null);
    if (previous) await previous.document.loadingTask.destroy();
  }

  async function loadFile(file: File, filePassword = ""): Promise<void> {
    setInputFile(file);
    setSource(null);
    setPasswordRequired(false);
    setLoadProgress({ completed: 0, total: 0 });
    setBrowsing(false);
    await releasePdf();
    if (/\.pdf$/i.test(file.name)) {
      const base = browser.runtime.getURL("/documents.html");
      const result = await loadPdfFile(file, {
        password: filePassword,
        cMapUrl: new URL("pdfjs/cmaps/", base).href,
        standardFontDataUrl: new URL("pdfjs/standard_fonts/", base).href,
        wasmUrl: new URL("pdfjs/wasm/", base).href,
        iccUrl: new URL("pdfjs/iccs/", base).href,
      }, (completed, total) => { if (live.current) setLoadProgress({ completed, total }); });
      if (!live.current) { await result.document.loadingTask.destroy(); return; }
      loaded.current = result;
      setPdf(result);
      setSource({ type: "file", file: result.snapshot });
    } else if (file.type.startsWith("image/")) {
      const dataUrl = await normalizeImageBlob(file);
      if (live.current) setSource({ type: "image", image: { id: crypto.randomUUID(), name: file.name, dataUrl } });
    } else {
      const fileSource = await readTextFile(file);
      if (live.current) setSource({ type: "file", file: fileSource });
    }
    if (live.current) setPassword("");
  }

  function reportLoadError(error: unknown): void {
    if (!live.current) return;
    setPasswordRequired(error instanceof Error && error.message === "pdfPasswordRequired");
    notify.error(formatError(locale, error));
  }

  async function open(file: File, filePassword = ""): Promise<void> {
    setLoading(true);
    setSelectedResource(null);
    try { await loadFile(file, filePassword); }
    catch (error) { reportLoadError(error); }
    finally { if (live.current) setLoading(false); }
  }

  async function select(resource: PageResource): Promise<void> {
    setLoading(true);
    setLoadProgress({ completed: 0, total: 0 });
    try {
      const result = await requestPageResource({ type: "read", resourceId: resource.id }, resourceAbort.current.signal);
      if (!live.current) return;
      if (result.type === "bytes") {
        setSelectedResource(resource);
        await loadFile(decodeResourceFile(result));
      }
      else if (result.type === "file" || result.type === "page" || result.type === "image") {
        await releasePdf();
        setInputFile(null);
        setPasswordRequired(false);
        setPassword("");
        setSource(result);
        setBrowsing(false);
      } else throw new Error("resourceResponseInvalid");
      if (live.current) setSelectedResource(resource);
    } catch (error) { reportLoadError(error); }
    finally { if (live.current) setLoading(false); }
  }

  async function close(): Promise<void> {
    setLoading(true);
    setSource(null);
    setSelectedResource(null);
    setInputFile(null);
    setPassword("");
    setPasswordRequired(false);
    setBrowsing(embedded);
    try { await releasePdf(); }
    catch (error) { notify.error(formatError(locale, error)); }
    finally { if (live.current) setLoading(false); }
  }

  async function locate(citation: PageCitation): Promise<boolean> {
    if (selectedResource?.reader === "transcript" || selectedResource?.reader === "youtube") {
      try {
        const result = await requestPageResource({ type: "locate", snapshotId: citation.snapshotId, blockId: citation.blockId }, resourceAbort.current.signal);
        return result.type === "located" && result.found;
      } catch (error) { notify.error(formatError(locale, error)); return false; }
    }
    if (source?.type !== "file" || citation.documentId !== source.file.id || !source.file.blocks.some((block) => block.id === citation.blockId && block.text === citation.text)) return false;
    return sourceRef.current?.scrollToBlock(citation.blockId) === true;
  }

  const busy = loading || chatBusy;
  const blocks = source?.type === "file" ? source.file.blocks : source?.type === "page" ? source.page.blocks : [];
  const name = source?.type === "file" ? source.file.name : source?.type === "image" ? source.image.name : source?.type === "page" ? source.page.title : null;
  const sourceId = source?.type === "file" ? source.file.id : source?.type === "image" ? source.image.id : source?.type === "page" ? source.page.id : "empty";
  const resourceList = <PageResourceList locale={locale} catalog={catalog} scanning={scanning} disabled={busy} error={scanError} onRefresh={() => void scan()} onSelect={(resource) => void select(resource)} onReveal={(resource) => {
    void requestPageResource({ type: "reveal", resourceId: resource.id }, resourceAbort.current.signal).catch((error) => notify.error(formatError(locale, error)));
  }} />;
  return <main className="mx-auto flex h-dvh max-w-[1800px] flex-col gap-3 overflow-hidden p-3">
    <Toaster closeLabel={t(locale, "close")} />
    {!embedded && <header className="flex shrink-0 items-center gap-3 border-b pb-3">
      <img src={browser.runtime.getURL("/icon/32.png")} alt="" width={28} height={28} />
      <h1 className="text-base font-semibold">HyperPage AI</h1>
      <span className="text-sm text-muted-foreground">{t(locale, "documents")}</span>
      <IconTooltip label={t(locale, "settings")}><Button className="ml-auto" size="icon-sm" variant="ghost" aria-label={t(locale, "settings")} onClick={() => { void request({ target: "background", type: "open-settings" }).catch((error) => notify.error(formatError(locale, error))); }}><Settings /></Button></IconTooltip>
    </header>}
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <input ref={fileInput} type="file" accept=".pdf,.txt,.md,.markdown,image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" aria-label={t(locale, "openLocalResource")} disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void open(file);
      }} />
      <IconTooltip label={t(locale, "openLocalResource")}><Button size="icon-sm" variant="outline" aria-label={t(locale, "openLocalResource")} disabled={busy} onClick={() => fileInput.current?.click()}><FileUp /></Button></IconTooltip>
      {embedded && <IconTooltip label={t(locale, "pageResources")}><Button size="icon-sm" variant="ghost" aria-label={t(locale, "pageResources")} aria-expanded={browsing} disabled={busy} onClick={() => { setBrowsing(!browsing); if (!browsing) void scan(); }}><FolderOpen /></Button></IconTooltip>}
      {source && <>
        <span className="min-w-0 flex-1 break-words text-sm">{name}</span>
        {blocks.length > 0 && <TextExport locale={locale} content={() => blocks.map((block) => block.text).join("\n\n")} filename={name || "hyperpage-source"} />}
        <IconTooltip label={t(locale, "closeResource")}><Button size="icon-sm" variant="ghost" aria-label={t(locale, "closeResource")} disabled={busy} onClick={() => void close()}><X /></Button></IconTooltip>
      </>}
    </div>
    {passwordRequired && inputFile && <form className="flex shrink-0 items-end gap-2" onSubmit={(event) => { event.preventDefault(); void open(inputFile, password); }}>
      <Field><FieldLabel htmlFor="pdf-password">{t(locale, "pdfPassword")}</FieldLabel><Input id="pdf-password" type="password" value={password} disabled={busy} autoComplete="off" onChange={(event) => setPassword(event.target.value)} /></Field>
      <Button type="submit" disabled={busy || !password}>{t(locale, "openPdf")}</Button>
    </form>}
    {loading && <div role="status" className="flex shrink-0 items-center gap-2 text-sm"><Spinner />{loadProgress.total > 0 ? `${t(locale, "pdfReadingProgress")} ${loadProgress.completed} / ${loadProgress.total}` : t(locale, "readingResource")}</div>}
    <SourceConversation key={sourceId} webSearchCapability={settings ? getTaskProvider(settings, "chat")?.capabilities.webSearch : undefined} locale={locale} source={conversationSource} disabled={loading || !settings?.enabled} onLocate={locate} onError={notify.error} onBusy={setChatBusy} browsing={browsing} onBrowseChange={setBrowsing} resources={resourceList}>
      <section className="flex h-full min-h-0 min-w-0 flex-col gap-2" aria-label={t(locale, "documentSource")}>
        {source?.type === "image" ? <img src={source.image.dataUrl} alt={source.image.name} className="mx-auto max-h-full max-w-full object-contain" /> : source ? <>
          {pdf && pdf.outline.length > 0 && <nav aria-label={t(locale, "pdfOutline")} className="flex max-h-32 shrink-0 flex-col items-start gap-2 overflow-y-auto border-b pb-3">
            {pdf.outline.map((entry, index) => <button key={index} className="break-words text-left text-xs hover:underline disabled:opacity-50" style={{ paddingLeft: entry.depth * 12 }} disabled={entry.pageNumber === null} onClick={() => {
              if (entry.pageNumber !== null) sourceRef.current?.scrollToPage(entry.pageNumber);
            }}>{entry.title}</button>)}
          </nav>}
          <Field orientation="horizontal" className="shrink-0">
            <Checkbox id="source-select-all" checked={selectedBlockIds.length === blocks.length} indeterminate={selectedBlockIds.length > 0 && selectedBlockIds.length < blocks.length} disabled={busy} onCheckedChange={(checked) => setSelectedBlockIds(checked ? blocks.map((block) => block.id) : [])} />
            <FieldLabel htmlFor="source-select-all">{t(locale, "selectAllBlocks")}</FieldLabel>
          </Field>
          {selectedResource?.reader === "transcript" || selectedResource?.reader === "youtube"
            ? <TranscriptView key={sourceId} locale={locale} blocks={blocks} selectedIds={selectedBlockIds} onSelect={setSelectedBlockIds} disabled={busy} className="flex-1" />
            : <SourceTextView key={sourceId} ref={sourceRef} locale={locale} blocks={blocks} pageCount={pdf?.snapshot.pageCount} selectedIds={selectedBlockIds} onSelect={setSelectedBlockIds} disabled={busy} className="flex-1" />}
        </> : <p role="status" className="py-6 text-sm text-muted-foreground">{t(locale, "noResourceSelected")}</p>}
      </section>
    </SourceConversation>
  </main>;
}

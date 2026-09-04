import {
  ArrowLeft,
  Check,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Copy,
  EyeOff,
  FileText,
  Image,
  Languages,
  ListCollapse,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  MousePointer2,
  PanelRight,
  RefreshCw,
  RotateCcw,
  ScanText,
  Send,
  Settings,
  Sparkles,
  WandSparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { browser } from "wxt/browser";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type {
  AiExecutionResult,
  AiAction,
  BackgroundRequest,
  CommandResult,
  PageCommand,
  PageState,
  PanelEvent,
  RunAiRequest,
  StoredSettings,
} from "../../shared/messages";
import { PANEL_VISIBILITY_STORAGE_KEY } from "../../shared/panel";
import { isVisualSelection } from "../../shared/prompts";
import { loadSettings, SETTINGS_STORAGE_KEY } from "../../shared/settings";
import { SettingsView } from "./SettingsView";
import { formatError, type MessageKey, t } from "./translations";
import { IconTooltip } from "./ui";

interface AiResult {
  action: AiAction;
  content: string;
}

interface AppProps {
  initialOpen: boolean;
}

interface ActionButtonProps {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}

interface FloatingPosition {
  left: number;
  top: number;
}

interface DragSession {
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
  moved: boolean;
}

const VIEWPORT_EDGE_GAP = 8;
const DRAG_START_DISTANCE = 4;

const EMPTY_PAGE_STATE: PageState = {
  selection: null,
  selectionRevision: 0,
  canUndoHide: false,
  canUndoReplace: false,
  canRemoveInsertion: false,
  selecting: false,
};

// Keeps a dragged surface visible while preserving an edge gap when space allows.
function constrainToViewport(
  left: number,
  top: number,
  width: number,
  height: number,
): FloatingPosition {
  const availableLeft = Math.max(0, window.innerWidth - width);
  const availableTop = Math.max(0, window.innerHeight - height);
  const minimumLeft = Math.min(VIEWPORT_EDGE_GAP, availableLeft);
  const minimumTop = Math.min(VIEWPORT_EDGE_GAP, availableTop);
  const maximumLeft = Math.max(minimumLeft, availableLeft - VIEWPORT_EDGE_GAP);
  const maximumTop = Math.max(minimumTop, availableTop - VIEWPORT_EDGE_GAP);

  return {
    left: Math.min(Math.max(left, minimumLeft), maximumLeft),
    top: Math.min(Math.max(top, minimumTop), maximumTop),
  };
}

// Sends a typed command to the background worker and exposes its explicit error.
async function sendBackgroundRequest<T>(
  request: BackgroundRequest,
): Promise<T> {
  const result = (await browser.runtime.sendMessage(
    request,
  )) as CommandResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

// Resolves the localized command label used for progress and result headings.
function getActionLabelKey(action: AiAction): MessageKey {
  switch (action) {
    case "translate":
      return "translate";
    case "explain":
      return "explain";
    case "summarize":
      return "summarize";
    case "ocr":
      return "ocr";
    case "image-prompt":
      return "imagePrompt";
    case "polish":
      return "polish";
    case "custom":
      return "custom";
  }
}

// Renders one AI command with the shared compact button treatment.
function AiActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: ActionButtonProps) {
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-9 min-w-0 justify-start"
    >
      <Icon data-icon="inline-start" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

// Implements the floating selection, action, result, and settings panel.
export function App({ initialOpen }: AppProps) {
  const [panelOpen, setPanelOpen] = useState(initialOpen);
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const [initializationError, setInitializationError] = useState<string>();
  const [view, setView] = useState<"main" | "settings">("main");
  const [pageState, setPageState] = useState<PageState>(EMPTY_PAGE_STATE);
  const [pageError, setPageError] = useState<string>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [result, setResult] = useState<AiResult>();
  const [pending, setPending] = useState<{
    requestId: string;
    action: AiAction;
  }>();
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [launcherPosition, setLauncherPosition] = useState<FloatingPosition>();
  const [panelPosition, setPanelPosition] = useState<FloatingPosition>();
  const [launcherDragging, setLauncherDragging] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  const selectionRevision = useRef(0);
  const toastTimer = useRef<number | undefined>(undefined);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherDragSession = useRef<DragSession | undefined>(undefined);
  const panelDragSession = useRef<DragSession | undefined>(undefined);
  const suppressLauncherClick = useRef(false);

  const locale = settings?.locale ?? "en";
  const selection = pageState.selection;
  const provider = settings?.provider ?? null;

  // Shows one short operation status without accumulating stale notifications.
  const showToast = useCallback((message: string): void => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 2200);
  }, []);

  // Applies page state and invalidates results only when the actual selection changes.
  const applyPageState = useCallback((nextState: PageState): void => {
    if (selectionRevision.current !== nextState.selectionRevision) {
      selectionRevision.current = nextState.selectionRevision;
      setResult(undefined);
      setSelectionExpanded(false);
    }
    setPageState(nextState);
  }, []);

  // Obtains fresh state from the controller in this content script's own tab.
  const refreshPageState = useCallback(async (): Promise<void> => {
    try {
      const nextState = await sendBackgroundRequest<PageState>({
        target: "background",
        type: "page-command",
        command: { type: "get-page-state" },
      });
      setPageError(undefined);
      applyPageState(nextState);
    } catch (refreshError) {
      applyPageState(EMPTY_PAGE_STATE);
      setPageError(formatError(locale, refreshError));
    }
  }, [applyPageState, locale]);

  // Loads local settings once and opens setup immediately for an unconfigured install.
  useEffect(() => {
    void loadSettings(browser.i18n.getUILanguage())
      .then((loaded) => {
        setSettings(loaded);
        if (!loaded.provider) setView("settings");
      })
      .catch((loadError: unknown) => {
        setInitializationError(formatError("en", loadError));
      });
  }, []);

  // Synchronizes state events emitted by this page's controller.
  useEffect(() => {
    if (!settings) return undefined;
    void refreshPageState();

    const handlePanelEvent = (message: PanelEvent): void => {
      if (message.target === "panel" && message.type === "page-state-changed") {
        applyPageState(message.state);
      }
    };

    browser.runtime.onMessage.addListener(handlePanelEvent);
    return () => {
      browser.runtime.onMessage.removeListener(handlePanelEvent);
    };
  }, [applyPageState, refreshPageState, settings]);

  // Synchronizes settings and toolbar-driven visibility across open tabs.
  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: Browser.storage.AreaName,
    ): void => {
      if (areaName === "session") {
        const change = changes[PANEL_VISIBILITY_STORAGE_KEY];
        if (!change) return;
        if (typeof change.newValue !== "boolean") {
          setError(t(locale, "panelStateInvalid"));
          return;
        }
        setPanelOpen(change.newValue);
        return;
      }
      if (areaName === "local" && changes[SETTINGS_STORAGE_KEY]) {
        void loadSettings(browser.i18n.getUILanguage()).then(setSettings);
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [locale]);

  // Clears the outstanding notification timer when the panel is destroyed.
  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  // Repositions dragged surfaces after a viewport resize so they remain reachable.
  useEffect(() => {
    const handleResize = (): void => {
      setLauncherPosition((current) => {
        if (!current || !launcherRef.current) return current;
        const rect = launcherRef.current.getBoundingClientRect();
        return constrainToViewport(
          current.left,
          current.top,
          rect.width,
          rect.height,
        );
      });
      setPanelPosition((current) => {
        if (!current || !panelRef.current) return current;
        const rect = panelRef.current.getBoundingClientRect();
        return constrainToViewport(
          current.left,
          current.top,
          rect.width,
          rect.height,
        );
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Starts launcher dragging from its rendered viewport position.
  function handleLauncherPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    launcherDragSession.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    suppressLauncherClick.current = false;
    setLauncherDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  // Moves the launcher after the pointer clears the click-intent threshold.
  function handleLauncherPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const drag = launcherDragSession.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offsetX = event.clientX - drag.startPointerX;
    const offsetY = event.clientY - drag.startPointerY;
    if (!drag.moved && Math.hypot(offsetX, offsetY) < DRAG_START_DISTANCE) {
      return;
    }

    drag.moved = true;
    setLauncherPosition(
      constrainToViewport(
        drag.startLeft + offsetX,
        drag.startTop + offsetY,
        drag.width,
        drag.height,
      ),
    );
    event.preventDefault();
  }

  // Ends launcher dragging and prevents its pointer-up click from toggling the panel.
  function handleLauncherPointerEnd(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const drag = launcherDragSession.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressLauncherClick.current = event.type === "pointerup" && drag.moved;
    launcherDragSession.current = undefined;
    setLauncherDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Starts panel dragging only from non-interactive parts of its header.
  function handlePanelPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target as Element).closest("button")
    ) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panelDragSession.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setPanelDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  // Moves the panel while keeping its complete frame inside the viewport.
  function handlePanelPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    const drag = panelDragSession.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const offsetX = event.clientX - drag.startPointerX;
    const offsetY = event.clientY - drag.startPointerY;
    if (!drag.moved && Math.hypot(offsetX, offsetY) < DRAG_START_DISTANCE) {
      return;
    }

    drag.moved = true;
    setPanelPosition(
      constrainToViewport(
        drag.startLeft + offsetX,
        drag.startTop + offsetY,
        drag.width,
        drag.height,
      ),
    );
    event.preventDefault();
  }

  // Releases panel pointer capture after a completed or canceled drag.
  function handlePanelPointerEnd(event: ReactPointerEvent<HTMLElement>): void {
    const drag = panelDragSession.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelDragSession.current = undefined;
    setPanelDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Runs one reversible page command and refreshes the local state from its response.
  async function runPageCommand(
    command: PageCommand,
    successKey?: MessageKey,
  ): Promise<PageState | undefined> {
    setError(undefined);
    try {
      const nextState = await sendBackgroundRequest<PageState>({
        target: "background",
        type: "page-command",
        command,
      });
      setPageError(undefined);
      applyPageState(nextState);
      if (successKey) showToast(t(locale, successKey));
      return nextState;
    } catch (commandError) {
      setError(formatError(locale, commandError));
      return undefined;
    }
  }

  // Copies fresh rendered text rather than relying on an earlier selection preview.
  async function handleCopyText(): Promise<void> {
    setError(undefined);
    try {
      const state = await runPageCommand({ type: "get-page-state" });
      if (!state) return;
      const content = state.selection
        ? state.selection.text || state.selection.accessibleName
        : "";
      if (!content) {
        setError(t(locale, "selectionTextRequired"));
        return;
      }
      await navigator.clipboard.writeText(content);
      showToast(t(locale, "copied"));
    } catch (clipboardError) {
      setError(formatError(locale, clipboardError));
    }
  }

  // Captures and writes the selected visible bitmap region to the system clipboard.
  async function handleCopyScreenshot(): Promise<void> {
    setError(undefined);
    try {
      const dataUrl = await sendBackgroundRequest<string>({
        target: "background",
        type: "capture-selection",
      });
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      showToast(t(locale, "screenshotCopied"));
    } catch (screenshotError) {
      setError(formatError(locale, screenshotError));
    }
  }

  // Sends one selected-element task to the configured model and records its result.
  async function runAi(request: RunAiRequest): Promise<void> {
    const requestId = crypto.randomUUID();
    setError(undefined);
    setResult(undefined);
    setPending({ requestId, action: request.action });
    try {
      const execution = await sendBackgroundRequest<AiExecutionResult>({
        target: "background",
        type: "run-ai",
        requestId,
        request,
      });
      if (execution.selectionRevision !== selectionRevision.current) {
        throw new Error("requestContextChanged");
      }
      setResult({ action: request.action, content: execution.content });
    } catch (aiError) {
      setError(formatError(locale, aiError));
    } finally {
      setPending(undefined);
    }
  }

  // Aborts the exact in-flight model request represented by the progress row.
  async function handleCancelRequest(): Promise<void> {
    if (!pending) return;
    try {
      await sendBackgroundRequest<null>({
        target: "background",
        type: "cancel-ai",
        requestId: pending.requestId,
      });
    } catch (cancelError) {
      setError(formatError(locale, cancelError));
    }
  }

  // Sends the custom prompt only when it contains an explicit user question.
  function handleCustomSubmit(): void {
    if (!customPrompt.trim()) {
      setError(t(locale, "customPromptRequired"));
      return;
    }
    void runAi({ action: "custom", prompt: customPrompt.trim() });
  }

  // Copies the current model result as plain Markdown source text.
  async function handleCopyResult(): Promise<void> {
    if (!result) return;
    setError(undefined);
    try {
      await navigator.clipboard.writeText(result.content);
      showToast(t(locale, "copied"));
    } catch (clipboardError) {
      setError(formatError(locale, clipboardError));
    }
  }

  // Accepts newly persisted settings and returns to the main action surface.
  function handleSettingsSaved(nextSettings: StoredSettings): void {
    setSettings(nextSettings);
    setView("main");
    showToast(t(nextSettings.locale, "settingsSaved"));
  }

  // Persists the launcher's expanded state so the toolbar and every tab agree.
  async function handlePanelOpenChange(open: boolean): Promise<void> {
    setError(undefined);
    try {
      await sendBackgroundRequest<null>({
        target: "background",
        type: "set-panel-visibility",
        visible: open,
      });
      setPanelOpen(open);
    } catch (visibilityError) {
      setError(formatError(locale, visibilityError));
    }
  }

  // Cancels element picking from the persistent launcher or toggles the panel.
  function handleLauncherClick(): void {
    if (suppressLauncherClick.current) {
      suppressLauncherClick.current = false;
      return;
    }
    if (pageState.selecting) {
      void runPageCommand({ type: "cancel-selection" });
      return;
    }
    void handlePanelOpenChange(!panelOpen);
  }

  const panelVisible = panelOpen && !pageState.selecting;
  const launcherLabel = t(
    locale,
    pageState.selecting
      ? "cancelSelection"
      : panelVisible
        ? "closePanel"
        : "openPanel",
  );
  const launcher = (
    <IconTooltip label={launcherLabel}>
      <Button
        type="button"
        variant="ghost"
        aria-label={launcherLabel}
        aria-controls="hyperpage-tool-panel"
        aria-expanded={panelVisible}
        data-dragging={launcherDragging || undefined}
        ref={launcherRef}
        style={
          launcherPosition
            ? {
                left: launcherPosition.left,
                top: launcherPosition.top,
                right: "auto",
                bottom: "auto",
              }
            : undefined
        }
        className="hp-launcher pointer-events-auto fixed right-4 bottom-4 size-[58px] rounded-2xl bg-white p-0 shadow-xl hover:bg-white aria-expanded:bg-white dark:bg-white dark:hover:bg-white dark:aria-expanded:bg-white"
        onClick={handleLauncherClick}
        onPointerDown={handleLauncherPointerDown}
        onPointerMove={handleLauncherPointerMove}
        onPointerUp={handleLauncherPointerEnd}
        onPointerCancel={handleLauncherPointerEnd}
      >
        <img
          src={browser.runtime.getURL("/icon/48.png")}
          alt=""
          className="size-10"
        />
      </Button>
    </IconTooltip>
  );

  if (!settings) {
    return (
      <>
        {panelVisible && (
          <div
            id="hyperpage-tool-panel"
            ref={panelRef}
            data-dragging={panelDragging || undefined}
            style={
              panelPosition
                ? {
                    left: panelPosition.left,
                    top: panelPosition.top,
                    right: "auto",
                    bottom: "auto",
                  }
                : undefined
            }
            className="hp-panel hp-panel-drag-handle pointer-events-auto fixed right-4 bottom-[86px] flex min-h-24 w-[min(380px,calc(100vw-32px))] items-center justify-center rounded-md border bg-background p-3 text-muted-foreground shadow-xl"
            onPointerDown={handlePanelPointerDown}
            onPointerMove={handlePanelPointerMove}
            onPointerUp={handlePanelPointerEnd}
            onPointerCancel={handlePanelPointerEnd}
          >
            {initializationError ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{initializationError}</AlertDescription>
              </Alert>
            ) : (
              <Spinner className="size-5" />
            )}
          </div>
        )}
        {launcher}
      </>
    );
  }

  const hasText = Boolean(selection?.text);
  const visual = selection ? isVisualSelection(selection) : false;
  const canUseTextAi = Boolean(
    selection && (hasText || (visual && provider?.supportsVision)),
  );
  const canUseVision = Boolean(selection && provider?.supportsVision);
  const canAnalyzeImage = Boolean(
    selection?.kind === "image" && provider?.supportsVision,
  );
  const selectionContent = selection
    ? selection.text || selection.accessibleName
    : "";
  const pageReady = !pageError;
  const actionsDisabled = Boolean(pending || !provider || !pageReady);

  return (
    <>
      {panelVisible && (
        <div
          id="hyperpage-tool-panel"
          ref={panelRef}
          data-dragging={panelDragging || undefined}
          style={
            panelPosition
              ? {
                  left: panelPosition.left,
                  top: panelPosition.top,
                  right: "auto",
                  bottom: "auto",
                }
              : undefined
          }
          className="hp-panel pointer-events-auto fixed right-4 bottom-[86px] flex h-[min(720px,calc(100vh-110px))] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background text-foreground shadow-xl"
        >
          <header
            className="hp-panel-drag-handle shrink-0 border-b bg-background"
            data-dragging={panelDragging || undefined}
            onPointerDown={handlePanelPointerDown}
            onPointerMove={handlePanelPointerMove}
            onPointerUp={handlePanelPointerEnd}
            onPointerCancel={handlePanelPointerEnd}
          >
            <div className="flex h-12 items-center gap-2 px-3">
              {view === "settings" ? (
                <>
                  <IconTooltip label={t(locale, "back")}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t(locale, "back")}
                      onClick={() => setView("main")}
                    >
                      <ArrowLeft />
                    </Button>
                  </IconTooltip>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {t(locale, "settings")}
                  </span>
                </>
              ) : (
                <>
                  <img
                    src={browser.runtime.getURL("/icon/32.png")}
                    alt=""
                    className="size-7"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    HyperPage AI
                  </span>
                </>
              )}

              <Badge variant={provider ? "secondary" : "outline"}>
                {t(locale, provider ? "configured" : "setupRequired")}
              </Badge>

              {view === "main" && (
                <IconTooltip label={t(locale, "settings")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t(locale, "settings")}
                    onClick={() => setView("settings")}
                  >
                    <Settings />
                  </Button>
                </IconTooltip>
              )}

              <IconTooltip label={t(locale, "closePanel")}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t(locale, "closePanel")}
                  onClick={() => void handlePanelOpenChange(false)}
                >
                  <X />
                </Button>
              </IconTooltip>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
            {view === "settings" ? (
              <div className="hp-view-enter">
                <SettingsView
                  settings={settings}
                  onSaved={handleSettingsSaved}
                />
              </div>
            ) : (
              <main className="hp-view-enter flex flex-col gap-3 p-3 pb-6">
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>{t(locale, "selectedElement")}</CardTitle>
                    <CardAction className="flex items-center gap-1">
                      <Badge variant="outline">
                        {selection ? selection.kind : t(locale, "noSelection")}
                      </Badge>
                      {selectionContent && (
                        <>
                          <IconTooltip label={t(locale, "copyText")}>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t(locale, "copyText")}
                              onClick={() => void handleCopyText()}
                            >
                              <Copy />
                            </Button>
                          </IconTooltip>
                          <IconTooltip
                            label={t(
                              locale,
                              selectionExpanded
                                ? "collapseSelection"
                                : "expandSelection",
                            )}
                          >
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t(
                                locale,
                                selectionExpanded
                                  ? "collapseSelection"
                                  : "expandSelection",
                              )}
                              aria-controls="hyperpage-selection-content"
                              aria-expanded={selectionExpanded}
                              onClick={() =>
                                setSelectionExpanded((expanded) => !expanded)
                              }
                            >
                              {selectionExpanded ? (
                                <Minimize2 />
                              ) : (
                                <Maximize2 />
                              )}
                            </Button>
                          </IconTooltip>
                        </>
                      )}
                    </CardAction>
                  </CardHeader>

                  <CardContent>
                    {selection ? (
                      <div className="flex min-w-0 flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">{selection.tagName}</Badge>
                          {selection.editable && (
                            <Badge variant="outline">
                              {t(locale, "editable")}
                            </Badge>
                          )}
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {selection.text.length} {t(locale, "characters")}
                          </span>
                        </div>
                        {selectionContent && (
                          <p
                            id="hyperpage-selection-content"
                            data-expanded={selectionExpanded}
                            className={cn(
                              "hp-selection-content break-words whitespace-pre-wrap text-sm leading-5 text-muted-foreground",
                              selectionExpanded
                                ? "max-h-64 overflow-y-auto pr-1"
                                : "line-clamp-3",
                            )}
                          >
                            {selectionContent}
                          </p>
                        )}
                      </div>
                    ) : (
                      <Empty className="min-h-20 p-2">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <MousePointer2 />
                          </EmptyMedia>
                          <EmptyTitle>{t(locale, "noSelection")}</EmptyTitle>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>

                  <CardFooter className="gap-2">
                    <Button
                      className="min-w-0 flex-1"
                      disabled={
                        !pageReady || pageState.selecting || Boolean(pending)
                      }
                      onClick={() =>
                        void runPageCommand({ type: "start-selection" })
                      }
                    >
                      {pageState.selecting ? (
                        <Spinner data-icon="inline-start" />
                      ) : selection ? (
                        <RefreshCw data-icon="inline-start" />
                      ) : (
                        <MousePointer2 data-icon="inline-start" />
                      )}
                      {t(
                        locale,
                        pageState.selecting
                          ? "selecting"
                          : selection
                            ? "reselect"
                            : "selectElement",
                      )}
                    </Button>
                    <ButtonGroup aria-label={t(locale, "selectedElement")}>
                      <IconTooltip label={t(locale, "selectParent")}>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={t(locale, "selectParent")}
                          disabled={
                            !pageReady ||
                            !selection ||
                            pageState.selecting ||
                            Boolean(pending)
                          }
                          onClick={() =>
                            void runPageCommand({ type: "select-parent" })
                          }
                        >
                          <ChevronUp />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label={t(locale, "cancelSelection")}>
                        <Button
                          size="icon"
                          variant="outline"
                          aria-label={t(locale, "cancelSelection")}
                          disabled={
                            !pageReady ||
                            Boolean(pending) ||
                            (!selection && !pageState.selecting)
                          }
                          onClick={() =>
                            void runPageCommand({ type: "cancel-selection" })
                          }
                        >
                          <X />
                        </Button>
                      </IconTooltip>
                    </ButtonGroup>
                  </CardFooter>
                </Card>

                {pageError && (
                  <Alert className="hp-feedback" variant="destructive">
                    <CircleAlert />
                    <AlertDescription>{pageError}</AlertDescription>
                  </Alert>
                )}

                <Tabs defaultValue="ai" className="gap-3">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="ai">
                      <Sparkles data-icon="inline-start" />
                      {t(locale, "aiTools")}
                    </TabsTrigger>
                    <TabsTrigger value="page">
                      <Wrench data-icon="inline-start" />
                      {t(locale, "pageTools")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="ai" className="flex flex-col gap-3">
                    <section
                      className="flex flex-col gap-2"
                      aria-labelledby="text-tools-heading"
                    >
                      <h2
                        id="text-tools-heading"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t(locale, "textTools")}
                      </h2>
                      <div className="grid grid-cols-2 gap-2">
                        <AiActionButton
                          icon={Languages}
                          label={t(locale, "translate")}
                          disabled={actionsDisabled || !canUseTextAi}
                          onClick={() => void runAi({ action: "translate" })}
                        />
                        <AiActionButton
                          icon={MessageCircleQuestion}
                          label={t(locale, "explain")}
                          disabled={actionsDisabled || !canUseTextAi}
                          onClick={() => void runAi({ action: "explain" })}
                        />
                        <AiActionButton
                          icon={ListCollapse}
                          label={t(locale, "summarize")}
                          disabled={actionsDisabled || !canUseTextAi}
                          onClick={() => void runAi({ action: "summarize" })}
                        />
                        <AiActionButton
                          icon={WandSparkles}
                          label={t(locale, "polish")}
                          disabled={actionsDisabled || !hasText}
                          onClick={() => void runAi({ action: "polish" })}
                        />
                      </div>
                    </section>

                    <section
                      className="flex flex-col gap-2"
                      aria-labelledby="visual-tools-heading"
                    >
                      <h2
                        id="visual-tools-heading"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t(locale, "visualTools")}
                      </h2>
                      <div className="grid grid-cols-2 gap-2">
                        <AiActionButton
                          icon={ScanText}
                          label={t(locale, "ocr")}
                          disabled={actionsDisabled || !canUseVision || !visual}
                          onClick={() => void runAi({ action: "ocr" })}
                        />
                        <AiActionButton
                          icon={Image}
                          label={t(locale, "imagePrompt")}
                          disabled={actionsDisabled || !canAnalyzeImage}
                          onClick={() => void runAi({ action: "image-prompt" })}
                        />
                      </div>
                    </section>

                    <section
                      className="flex flex-col gap-2"
                      aria-labelledby="custom-task-heading"
                    >
                      <h2
                        id="custom-task-heading"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t(locale, "customTask")}
                      </h2>
                      <Field data-disabled={actionsDisabled || !canUseTextAi}>
                        <FieldLabel htmlFor="custom-prompt" className="sr-only">
                          {t(locale, "custom")}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupTextarea
                            id="custom-prompt"
                            className="min-h-20"
                            value={customPrompt}
                            disabled={actionsDisabled || !canUseTextAi}
                            placeholder={t(locale, "customPrompt")}
                            onChange={(event) =>
                              setCustomPrompt(event.target.value)
                            }
                          />
                          <InputGroupAddon align="block-end">
                            <InputGroupButton
                              variant="default"
                              size="sm"
                              className="ml-auto"
                              disabled={actionsDisabled || !canUseTextAi}
                              onClick={handleCustomSubmit}
                            >
                              <Send data-icon="inline-start" />
                              {t(locale, "run")}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                    </section>
                  </TabsContent>

                  <TabsContent value="page" className="flex flex-col gap-3">
                    <section
                      className="flex flex-col gap-2"
                      aria-labelledby="element-actions-heading"
                    >
                      <h2
                        id="element-actions-heading"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t(locale, "elementActions")}
                      </h2>
                      <ButtonGroup
                        orientation="vertical"
                        className="w-full"
                        aria-label={t(locale, "elementActions")}
                      >
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          disabled={!pageReady || !hasText || Boolean(pending)}
                          onClick={() => void handleCopyText()}
                        >
                          <Copy data-icon="inline-start" />
                          {t(locale, "copyText")}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          disabled={
                            !pageReady || !selection || Boolean(pending)
                          }
                          onClick={() => void handleCopyScreenshot()}
                        >
                          <Image data-icon="inline-start" />
                          {t(locale, "copyScreenshot")}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          disabled={
                            !pageReady || !selection || Boolean(pending)
                          }
                          onClick={() =>
                            void runPageCommand(
                              { type: "hide-selection" },
                              "hidden",
                            )
                          }
                        >
                          <EyeOff data-icon="inline-start" />
                          {t(locale, "hideElement")}
                        </Button>
                      </ButtonGroup>
                    </section>

                    <section
                      className="flex flex-col gap-2"
                      aria-labelledby="restore-actions-heading"
                    >
                      <h2
                        id="restore-actions-heading"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t(locale, "restoreActions")}
                      </h2>
                      <ButtonGroup
                        orientation="vertical"
                        className="w-full"
                        aria-label={t(locale, "restoreActions")}
                      >
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          disabled={
                            !pageReady ||
                            !pageState.canUndoHide ||
                            Boolean(pending)
                          }
                          onClick={() =>
                            void runPageCommand(
                              { type: "undo-hide" },
                              "restored",
                            )
                          }
                        >
                          <RotateCcw data-icon="inline-start" />
                          {t(locale, "undoHide")}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          disabled={
                            !pageReady ||
                            !pageState.canUndoReplace ||
                            Boolean(pending)
                          }
                          onClick={() =>
                            void runPageCommand(
                              { type: "undo-replace" },
                              "restored",
                            )
                          }
                        >
                          <FileText data-icon="inline-start" />
                          {t(locale, "undoReplace")}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          disabled={
                            !pageReady ||
                            !pageState.canRemoveInsertion ||
                            Boolean(pending)
                          }
                          onClick={() =>
                            void runPageCommand(
                              { type: "remove-insertion" },
                              "removed",
                            )
                          }
                        >
                          <PanelRight data-icon="inline-start" />
                          {t(locale, "removeInsertion")}
                        </Button>
                      </ButtonGroup>
                    </section>
                  </TabsContent>
                </Tabs>

                {(pending || result) && (
                  <Card
                    className="hp-feedback"
                    size="sm"
                    aria-labelledby="result-heading"
                  >
                    <CardHeader>
                      <CardTitle id="result-heading">
                        {pending
                          ? t(locale, getActionLabelKey(pending.action))
                          : t(locale, "result")}
                      </CardTitle>
                      {result && !pending && (
                        <CardAction>
                          <IconTooltip label={t(locale, "copyResult")}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t(locale, "copyResult")}
                              onClick={() => void handleCopyResult()}
                            >
                              <Clipboard />
                            </Button>
                          </IconTooltip>
                        </CardAction>
                      )}
                    </CardHeader>

                    <CardContent>
                      {pending ? (
                        <div className="flex min-h-16 items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                            <Spinner />
                            {t(locale, "processing")}
                          </span>
                          <Button
                            variant="ghost"
                            onClick={() => void handleCancelRequest()}
                          >
                            <X data-icon="inline-start" />
                            {t(locale, "cancelRequest")}
                          </Button>
                        </div>
                      ) : result ? (
                        <div className="hp-markdown text-sm leading-6">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ children, ...props }) => (
                                <a {...props} target="_blank" rel="noreferrer">
                                  {children}
                                </a>
                              ),
                              img: () => null,
                            }}
                          >
                            {result.content}
                          </ReactMarkdown>
                        </div>
                      ) : null}
                    </CardContent>

                    {result &&
                      ((result.action === "translate" && selection) ||
                        (result.action === "polish" &&
                          selection?.editable)) && (
                        <CardFooter className="flex-wrap gap-2">
                          {result.action === "translate" && selection && (
                            <Button
                              variant="outline"
                              onClick={() =>
                                void runPageCommand(
                                  {
                                    type: "insert-result",
                                    text: result.content,
                                  },
                                  "inserted",
                                )
                              }
                            >
                              <PanelRight data-icon="inline-start" />
                              {t(locale, "insertBelow")}
                            </Button>
                          )}
                          {result.action === "polish" &&
                            selection?.editable && (
                              <Button
                                variant="outline"
                                onClick={() =>
                                  void runPageCommand(
                                    {
                                      type: "replace-editable",
                                      text: result.content,
                                    },
                                    "replaced",
                                  )
                                }
                              >
                                <Check data-icon="inline-start" />
                                {t(locale, "replaceField")}
                              </Button>
                            )}
                        </CardFooter>
                      )}
                  </Card>
                )}

                {error && (
                  <Alert className="hp-feedback" variant="destructive">
                    <CircleAlert />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {toast && (
                  <Alert className="hp-feedback" role="status">
                    <CircleCheck />
                    <AlertDescription>{toast}</AlertDescription>
                  </Alert>
                )}
              </main>
            )}
          </div>
        </div>
      )}
      {launcher}
    </>
  );
}

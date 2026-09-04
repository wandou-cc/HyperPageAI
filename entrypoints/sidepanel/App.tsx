import {
  ArrowLeft,
  BookmarkPlus,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Copy,
  FileText,
  Image,
  Info,
  History as HistoryIcon,
  Languages,
  ListCollapse,
  LocateFixed,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  MousePointer2,
  PanelRight,
  Pencil,
  Play,
  RefreshCw,
  ScanText,
  Send,
  Settings,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type {
  AiExecutionResult,
  AiAction,
  BackgroundRequest,
  CommandResult,
  PageAgentAction,
  PageAgentExecutionRecord,
  PageAgentExecutionStatus,
  PageAgentExecutionResult,
  PageAgentProgress,
  PageState,
  PageStateCommand,
  PanelEvent,
  RunAiRequest,
  SavedPageWorkflow,
  StoredSettings,
} from "../../shared/messages";
import { PANEL_VISIBILITY_STORAGE_KEY } from "../../shared/panel";
import { isVisualSelection } from "../../shared/prompts";
import {
  addPageAgentExecutionRecord,
  loadPageAgentHistory,
  loadPageWorkflows,
  loadSettings,
  PAGE_AGENT_HISTORY_STORAGE_KEY,
  PAGE_WORKFLOWS_STORAGE_KEY,
  savePageAgentHistory,
  savePageWorkflows,
  SETTINGS_STORAGE_KEY,
} from "../../shared/settings";
import { SettingsView } from "./SettingsView";
import { formatError, type MessageKey, t } from "./translations";
import { IconTooltip } from "./ui";

type AiResult =
  | {
      action: AiAction;
      content: string;
      selectionRevision: number | null;
    }
  | {
      action: "operate-page";
      content: string;
      status: PageAgentExecutionStatus;
    };

type CompletedPageAgentStep = Extract<
  PageAgentProgress,
  { phase: "action-complete" }
>;

interface PageAgentRunState {
  current: PageAgentProgress;
  completedSteps: CompletedPageAgentStep[];
}

type WorkflowEditor =
  | { mode: "create"; name: string }
  | { mode: "edit"; id: string; name: string };

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

interface PanelResizeSession {
  pointerId: number;
  startPointerX: number;
  startWidth: number;
  right: number;
  top: number;
}

interface PanelHeightResizeSession {
  pointerId: number;
  startPointerY: number;
  startHeight: number;
  left: number;
  bottom: number;
}

const VIEWPORT_EDGE_GAP = 8;
const DRAG_START_DISTANCE = 4;
const PANEL_MIN_WIDTH = 320;
const PANEL_DEFAULT_WIDTH = 380;
const PANEL_MIN_HEIGHT = 280;

const EMPTY_PAGE_STATE: PageState = {
  selection: null,
  selectionRevision: 0,
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
function getActionLabelKey(action: AiAction | "operate-page"): MessageKey {
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
    case "operate-page":
      return "operatePage";
  }
}

// Formats the exact browser action without exposing model internals or page DOM.
function describePageAgentAction(
  locale: StoredSettings["locale"],
  action: PageAgentAction,
): string {
  switch (action.type) {
    case "click":
      return `${t(locale, "clickPageElement")} #${action.index}`;
    case "input":
      return `${t(locale, "inputPageElement")} #${action.index}: "${action.text}"`;
    case "select":
      return `${t(locale, "selectPageOption")} #${action.index}: "${action.option}"`;
    case "modify-element": {
      const changes = action.changes.map((change) => {
        switch (change.type) {
          case "set-style":
            return `style ${change.name}=${JSON.stringify(change.value)}`;
          case "remove-style":
            return `remove style ${change.name}`;
          case "set-attribute":
            return `attribute ${change.name}=${JSON.stringify(change.value)}`;
          case "remove-attribute":
            return `remove attribute ${change.name}`;
          case "set-text":
            return `text=${JSON.stringify(change.text)}`;
        }
      });
      return `${t(locale, "modifyPageElement")} #${action.index}: ${changes.join("; ")}`;
    }
    case "remove-element":
      return `${t(locale, "removePageElement")} #${action.index}`;
    case "ask-user":
      return `${t(locale, "askUser")}: ${action.question}`;
    case "open-tab":
      return `${t(locale, "openPageTab")}: ${action.url}`;
    case "switch-tab":
      return `${t(locale, "switchPageTab")} #${action.tabId}`;
    case "close-tab":
      return `${t(locale, "closePageTab")} #${action.tabId}`;
    case "scroll": {
      const target =
        action.index === undefined
          ? t(locale, "currentPage")
          : `${t(locale, "pageElement")} #${action.index}`;
      const distance =
        action.pixels === undefined
          ? `${action.pages} ${t(locale, "pageUnits")}`
          : `${action.pixels} px`;
      const separator = locale === "zh_CN" ? "" : " ";
      return `${t(
        locale,
        action.direction === "down" ? "scrollDown" : "scrollUp",
      )}${separator}${target} (${distance})`;
    }
    case "scroll-horizontal": {
      const target =
        action.index === undefined
          ? t(locale, "currentPage")
          : `${t(locale, "pageElement")} #${action.index}`;
      const separator = locale === "zh_CN" ? "" : " ";
      return `${t(
        locale,
        action.direction === "right" ? "scrollRight" : "scrollLeft",
      )}${separator}${target} (${action.pixels} px)`;
    }
    case "wait":
      return `${t(locale, "waitForPage")} ${action.seconds} ${t(locale, "seconds")}`;
    case "complete":
      return t(locale, "completePageTask");
  }
}

// Formats the current observable execution phase for the live status row.
function describePageAgentProgress(
  locale: StoredSettings["locale"],
  progress: PageAgentProgress,
): string {
  switch (progress.phase) {
    case "reading":
      return t(locale, "readingPage");
    case "planning":
      return t(locale, "planningPageAction");
    case "awaiting-user":
      return t(locale, "waitingForAnswer");
    case "executing":
      return describePageAgentAction(locale, progress.action);
    case "action-complete":
      return describePageAgentAction(locale, progress.action);
    case "retrying":
      return `${t(locale, "retryingModel")} ${progress.attempt}/${progress.maxAttempts}`;
    case "failed":
      return progress.message;
  }
}

// Maps persisted terminal states to their localized status labels.
function getPageAgentStatusLabelKey(
  status: PageAgentExecutionStatus,
): MessageKey {
  switch (status) {
    case "completed":
      return "taskCompleted";
    case "incomplete":
      return "taskIncomplete";
    case "failed":
      return "taskFailed";
    case "cancelled":
      return "taskCancelled";
  }
}

// Formats action and run timings compactly for live and historical details.
function formatDuration(
  locale: StoredSettings["locale"],
  durationMs: number,
): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} ${t(locale, "seconds")}`;
}

// Creates the task reference that corresponds to the controller's selected marker.
function createPageTaskElementReference(
  locale: StoredSettings["locale"],
  selection: NonNullable<PageState["selection"]>,
): string {
  const label = (selection.accessibleName || selection.text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const role = selection.role.trim().slice(0, 160);
  return `[${t(locale, "pageElement")} <${selection.tagName}>${role ? ` role=${JSON.stringify(role)}` : ""}${label ? ` ${JSON.stringify(label)}` : ""}]`;
}

interface PageAgentProgressViewProps {
  active: boolean;
  locale: StoredSettings["locale"];
  run: PageAgentRunState;
  onAnswer: (answer: string) => Promise<boolean>;
}

// Shows the live phase and the durable list of actions completed in this run.
function PageAgentProgressView({
  active,
  locale,
  run,
  onAnswer,
}: PageAgentProgressViewProps) {
  const question =
    run.current.phase === "awaiting-user" ? run.current.question : undefined;
  const [answer, setAnswer] = useState("");
  const [answerPending, setAnswerPending] = useState(false);

  useEffect(() => {
    setAnswer("");
    setAnswerPending(false);
  }, [question]);

  async function submitAnswer(): Promise<void> {
    const normalizedAnswer = answer.trim();
    if (!normalizedAnswer || answerPending) return;
    setAnswerPending(true);
    const accepted = await onAnswer(normalizedAnswer);
    if (!accepted) setAnswerPending(false);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {active && (
        <div
          className="flex min-w-0 items-start gap-2 rounded-md bg-muted/60 p-2.5"
          role="status"
          aria-live="polite"
        >
          <div className="flex min-w-0 items-start gap-2">
            {run.current.phase === "failed" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : run.current.phase === "awaiting-user" ? (
              <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : run.current.phase === "action-complete" ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Spinner className="mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {t(locale, "pageTaskStep")} {run.current.stepIndex + 1}
              </p>
              <p className="break-words whitespace-pre-wrap">
                {describePageAgentProgress(locale, run.current)}
              </p>
            </div>
          </div>
        </div>
      )}

      {active && question && (
        <Field data-disabled={answerPending}>
          <FieldLabel htmlFor="page-agent-answer">
            {t(locale, "pageAgentAnswer")}
          </FieldLabel>
          <p className="break-words whitespace-pre-wrap text-sm">{question}</p>
          <InputGroup>
            <InputGroupTextarea
              id="page-agent-answer"
              className="min-h-16"
              value={answer}
              autoFocus
              disabled={answerPending}
              placeholder={t(locale, "pageAgentAnswerPlaceholder")}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submitAnswer();
                }
              }}
            />
            <InputGroupAddon align="block-end">
              <InputGroupButton
                variant="default"
                size="sm"
                className="ml-auto"
                disabled={answerPending || !answer.trim()}
                onClick={() => void submitAnswer()}
              >
                {answerPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Send data-icon="inline-start" />
                )}
                {t(locale, "sendAnswer")}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      )}

      {active &&
        run.current.phase !== "awaiting-user" &&
        run.completedSteps.length === 0 && (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        )}

      {run.completedSteps.length > 0 && (
        <section
          className="flex min-w-0 flex-col gap-2"
          aria-labelledby="page-agent-details-heading"
        >
          <h3
            id="page-agent-details-heading"
            className="text-xs font-medium text-muted-foreground"
          >
            {t(locale, "executionDetails")}
          </h3>
          <ol className="flex min-w-0 flex-col gap-2">
            {run.completedSteps.map((step) => (
              <li
                key={step.stepIndex}
                className="flex min-w-0 items-start gap-2 border-l-2 border-border pl-2"
              >
                <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="break-words whitespace-pre-wrap">
                    <span className="text-xs text-muted-foreground">
                      {t(locale, "pageTaskStep")} {step.stepIndex + 1}:{" "}
                    </span>
                    {describePageAgentAction(locale, step.action)}
                  </p>
                  {step.output && (
                    <p className="break-words whitespace-pre-wrap text-xs text-muted-foreground">
                      {step.output} ({formatDuration(locale, step.durationMs)})
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
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
    action: AiAction | "operate-page";
  }>();
  const [customPrompt, setCustomPrompt] = useState("");
  const [pageTask, setPageTask] = useState("");
  const [mainTab, setMainTab] = useState("ai");
  const [operateTab, setOperateTab] = useState("task");
  const [pageAgentRun, setPageAgentRun] = useState<PageAgentRunState>();
  const [workflows, setWorkflows] = useState<SavedPageWorkflow[]>([]);
  const [executionHistory, setExecutionHistory] = useState<
    PageAgentExecutionRecord[]
  >([]);
  const [workflowEditor, setWorkflowEditor] = useState<WorkflowEditor>();
  const [workflowMutationPending, setWorkflowMutationPending] = useState(false);
  const [historyMutationPending, setHistoryMutationPending] = useState(false);
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() =>
    Math.min(PANEL_DEFAULT_WIDTH, window.innerWidth - 32),
  );
  const [panelHeight, setPanelHeight] = useState(() =>
    Math.min(720, window.innerHeight - 110),
  );
  const [launcherPosition, setLauncherPosition] = useState<FloatingPosition>();
  const [panelPosition, setPanelPosition] = useState<FloatingPosition>();
  const [launcherDragging, setLauncherDragging] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  const [panelResizing, setPanelResizing] = useState(false);
  const [panelHeightResizing, setPanelHeightResizing] = useState(false);
  const selectionRevision = useRef(0);
  const activePageAgentRequestId = useRef<string | undefined>(undefined);
  const completedPageAgentSteps = useRef<CompletedPageAgentStep[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pageTaskInputRef = useRef<HTMLTextAreaElement>(null);
  const pageTaskHighlightRef = useRef<HTMLDivElement>(null);
  const pageTaskSelectionInsertion = useRef<
    | {
        start: number;
        end: number;
        revision: number;
        locale: StoredSettings["locale"];
      }
    | undefined
  >(undefined);
  const pageTaskCaret = useRef<number | undefined>(undefined);
  const launcherDragSession = useRef<DragSession | undefined>(undefined);
  const panelDragSession = useRef<DragSession | undefined>(undefined);
  const panelResizeSession = useRef<PanelResizeSession | undefined>(undefined);
  const panelHeightResizeSession = useRef<PanelHeightResizeSession | undefined>(
    undefined,
  );
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

  // Applies page state and invalidates only results that depend on the old selection.
  const applyPageState = useCallback((nextState: PageState): void => {
    const taskInsertion = pageTaskSelectionInsertion.current;
    if (taskInsertion && !nextState.selecting) {
      pageTaskSelectionInsertion.current = undefined;
      if (
        nextState.selection &&
        nextState.selectionRevision !== taskInsertion.revision
      ) {
        const reference = createPageTaskElementReference(
          taskInsertion.locale,
          nextState.selection,
        );
        setPageTask((currentTask) => {
          const before = currentTask.slice(0, taskInsertion.start);
          const after = currentTask.slice(taskInsertion.end);
          const leadingSpace = before && !/\s$/.test(before) ? " " : "";
          const trailingSpace = !after || !/^\s/.test(after) ? " " : "";
          const inserted = `${leadingSpace}${reference}${trailingSpace}`;
          pageTaskCaret.current = before.length + inserted.length;
          return `${before}${inserted}${after}`;
        });
      }
    }
    if (selectionRevision.current !== nextState.selectionRevision) {
      selectionRevision.current = nextState.selectionRevision;
      setResult((currentResult) => {
        if (!currentResult || currentResult.action === "operate-page") {
          return currentResult;
        }
        return currentResult.selectionRevision === null
          ? currentResult
          : undefined;
      });
      setSelectionExpanded(false);
    }
    setPageState(nextState);
  }, []);

  // Replaces the live phase and records each completed browser action once.
  const applyPageAgentProgress = useCallback(
    (progress: PageAgentProgress): void => {
      if (progress.phase === "action-complete") {
        completedPageAgentSteps.current = [
          ...completedPageAgentSteps.current,
          progress,
        ];
      }
      setPageAgentRun({
        current: progress,
        completedSteps: completedPageAgentSteps.current,
      });
    },
    [],
  );

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

  // Loads local settings, workflows, and page-task history before rendering.
  useEffect(() => {
    const uiLanguage = browser.i18n.getUILanguage();
    const initialLocale = uiLanguage.toLowerCase().startsWith("zh")
      ? "zh_CN"
      : "en";
    void Promise.all([
      loadSettings(uiLanguage),
      loadPageWorkflows(),
      loadPageAgentHistory(),
    ])
      .then(([loadedSettings, loadedWorkflows, loadedHistory]) => {
        setSettings(loadedSettings);
        setWorkflows(loadedWorkflows);
        setExecutionHistory(loadedHistory);
        if (!loadedSettings.enabled || !loadedSettings.provider) {
          setView("settings");
        }
      })
      .catch((loadError: unknown) => {
        setInitializationError(formatError(initialLocale, loadError));
      });
  }, []);

  // Synchronizes state events emitted by this page's controller.
  useEffect(() => {
    if (!settings) return undefined;
    if (!settings.enabled) {
      applyPageState(EMPTY_PAGE_STATE);
      setPageError(undefined);
      return undefined;
    }
    void refreshPageState();

    const handlePanelEvent = (message: PanelEvent): void => {
      if (message.target !== "panel") return;
      if (message.type === "page-state-changed") {
        applyPageState(message.state);
        return;
      }
      if (message.requestId === activePageAgentRequestId.current) {
        applyPageAgentProgress(message.progress);
      }
    };

    browser.runtime.onMessage.addListener(handlePanelEvent);
    return () => {
      browser.runtime.onMessage.removeListener(handlePanelEvent);
    };
  }, [applyPageAgentProgress, applyPageState, refreshPageState, settings]);

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
        void loadSettings(browser.i18n.getUILanguage()).then((nextSettings) => {
          setSettings(nextSettings);
          if (!nextSettings.enabled) {
            setView("settings");
            applyPageState(EMPTY_PAGE_STATE);
            setPageError(undefined);
          }
        });
      }
      if (areaName === "local" && changes[PAGE_WORKFLOWS_STORAGE_KEY]) {
        void loadPageWorkflows()
          .then(setWorkflows)
          .catch((workflowError: unknown) => {
            setError(formatError(locale, workflowError));
          });
      }
      if (areaName === "local" && changes[PAGE_AGENT_HISTORY_STORAGE_KEY]) {
        void loadPageAgentHistory()
          .then(setExecutionHistory)
          .catch((historyError: unknown) => {
            setError(formatError(locale, historyError));
          });
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [applyPageState, locale]);

  // Clears the outstanding notification timer when the panel is destroyed.
  useEffect(() => {
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  // Returns keyboard focus to the task immediately after inserting an element reference.
  useEffect(() => {
    const caret = pageTaskCaret.current;
    if (caret === undefined || !pageTaskInputRef.current) return;
    pageTaskInputRef.current.focus();
    pageTaskInputRef.current.setSelectionRange(caret, caret);
    pageTaskCaret.current = undefined;
  }, [pageTask]);

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
      const panel = panelRef.current;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        const nextWidth = Math.min(
          rect.width,
          window.innerWidth - VIEWPORT_EDGE_GAP * 2,
        );
        const nextHeight = Math.min(
          rect.height,
          window.innerHeight - VIEWPORT_EDGE_GAP * 2,
        );
        if (nextWidth !== rect.width) setPanelWidth(nextWidth);
        if (nextHeight !== rect.height) setPanelHeight(nextHeight);
        setPanelPosition((current) => {
          if (
            !current &&
            nextWidth === rect.width &&
            nextHeight === rect.height
          ) {
            return current;
          }
          return constrainToViewport(
            current?.left ?? rect.left,
            current?.top ?? rect.top,
            nextWidth,
            nextHeight,
          );
        });
      }
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

  // Starts horizontal resizing from the panel's rendered left edge.
  function handlePanelResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (event.button !== 0 || !event.isPrimary || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    panelResizeSession.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startWidth: rect.width,
      right: rect.right,
      top: rect.top,
    };
    setPanelResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  // Resizes leftward or rightward while preserving the panel's right edge.
  function handlePanelResizePointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const resize = panelResizeSession.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const maximumWidth = resize.right - VIEWPORT_EDGE_GAP;
    const minimumWidth = Math.min(PANEL_MIN_WIDTH, resize.startWidth);
    const nextWidth = Math.min(
      Math.max(
        resize.startWidth - (event.clientX - resize.startPointerX),
        minimumWidth,
      ),
      maximumWidth,
    );
    setPanelWidth(nextWidth);
    setPanelPosition({ left: resize.right - nextWidth, top: resize.top });
    event.preventDefault();
    event.stopPropagation();
  }

  // Ends one pointer-driven panel resize session.
  function handlePanelResizePointerEnd(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const resize = panelResizeSession.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    panelResizeSession.current = undefined;
    setPanelResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  }

  // Gives the resize separator the same horizontal control from the keyboard.
  function handlePanelResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    if (
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
      !panelRef.current
    ) {
      return;
    }
    const rect = panelRef.current.getBoundingClientRect();
    const maximumWidth = rect.right - VIEWPORT_EDGE_GAP;
    const minimumWidth = Math.min(PANEL_MIN_WIDTH, rect.width);
    const nextWidth = Math.min(
      Math.max(
        rect.width + (event.key === "ArrowLeft" ? 24 : -24),
        minimumWidth,
      ),
      maximumWidth,
    );
    setPanelWidth(nextWidth);
    setPanelPosition({ left: rect.right - nextWidth, top: rect.top });
    event.preventDefault();
  }

  // Starts vertical resizing from the panel's rendered top edge.
  function handlePanelHeightResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (event.button !== 0 || !event.isPrimary || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    panelHeightResizeSession.current = {
      pointerId: event.pointerId,
      startPointerY: event.clientY,
      startHeight: rect.height,
      left: rect.left,
      bottom: rect.bottom,
    };
    setPanelHeightResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  // Changes panel height while preserving its bottom edge and viewport bounds.
  function handlePanelHeightResizePointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const resize = panelHeightResizeSession.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const minimumHeight = Math.min(PANEL_MIN_HEIGHT, resize.startHeight);
    const maximumHeight = resize.bottom - VIEWPORT_EDGE_GAP;
    const nextHeight = Math.min(
      Math.max(
        resize.startHeight - (event.clientY - resize.startPointerY),
        minimumHeight,
      ),
      maximumHeight,
    );
    setPanelHeight(nextHeight);
    setPanelPosition({ left: resize.left, top: resize.bottom - nextHeight });
    event.preventDefault();
    event.stopPropagation();
  }

  // Ends one pointer-driven panel height resize session.
  function handlePanelHeightResizePointerEnd(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    const resize = panelHeightResizeSession.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    panelHeightResizeSession.current = undefined;
    setPanelHeightResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  }

  // Gives the top separator equivalent height control from the keyboard.
  function handlePanelHeightResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    if (
      (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
      !panelRef.current
    ) {
      return;
    }
    const rect = panelRef.current.getBoundingClientRect();
    const minimumHeight = Math.min(PANEL_MIN_HEIGHT, rect.height);
    const maximumHeight = rect.bottom - VIEWPORT_EDGE_GAP;
    const nextHeight = Math.min(
      Math.max(
        rect.height + (event.key === "ArrowUp" ? 24 : -24),
        minimumHeight,
      ),
      maximumHeight,
    );
    setPanelHeight(nextHeight);
    setPanelPosition({ left: rect.left, top: rect.bottom - nextHeight });
    event.preventDefault();
  }

  // Runs one reversible page command and refreshes the local state from its response.
  async function runPageCommand(
    command: PageStateCommand,
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

  // Remembers the task caret and starts an element pick that will insert there.
  async function handlePageTaskElementSelection(): Promise<void> {
    const input = pageTaskInputRef.current;
    if (!input) return;
    pageTaskSelectionInsertion.current = {
      start: input.selectionStart,
      end: input.selectionEnd,
      revision: selectionRevision.current,
      locale,
    };
    const nextState = await runPageCommand({
      type: "start-page-task-selection",
    });
    if (!nextState) pageTaskSelectionInsertion.current = undefined;
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

  // Sends one general or selection-scoped request to the configured model.
  async function runAi(request: RunAiRequest): Promise<void> {
    const requestId = crypto.randomUUID();
    setError(undefined);
    setResult(undefined);
    setPageAgentRun(undefined);
    setPending({ requestId, action: request.action });
    try {
      const execution = await sendBackgroundRequest<AiExecutionResult>({
        target: "background",
        type: "run-ai",
        requestId,
        request,
      });
      if (
        execution.selectionRevision !== null &&
        execution.selectionRevision !== selectionRevision.current
      ) {
        throw new Error("requestContextChanged");
      }
      setResult({
        action: request.action,
        content: execution.content,
        selectionRevision: execution.selectionRevision,
      });
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

  // Returns one reply to the exact page task currently waiting for the user.
  async function handlePageAgentAnswer(answer: string): Promise<boolean> {
    const requestId = activePageAgentRequestId.current;
    if (!requestId) {
      setError(t(locale, "requestUnavailable"));
      return false;
    }
    setError(undefined);
    try {
      await sendBackgroundRequest<null>({
        target: "background",
        type: "answer-page-agent",
        requestId,
        answer,
      });
      return true;
    } catch (answerError) {
      setError(formatError(locale, answerError));
      return false;
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

  // Opens the page-task view and executes the exact custom input there.
  async function handleCustomPageTask(): Promise<void> {
    const prompt = customPrompt.trim();
    if (!prompt) {
      setError(t(locale, "pageTaskRequired"));
      return;
    }
    let task = prompt;
    if (selection) {
      const nextState = await runPageCommand({
        type: "add-selection-to-page-task",
      });
      if (!nextState?.selection) return;
      task = `${createPageTaskElementReference(locale, nextState.selection)} ${prompt}`;
    }
    setPageTask(task);
    setMainTab("operate");
    setOperateTab("task");
    await runPageAgent(task);
  }

  // Opens the name field for a reusable copy of the current page task.
  function handleCreateWorkflow(): void {
    if (!pageTask.trim()) {
      setError(t(locale, "pageTaskRequired"));
      return;
    }
    setError(undefined);
    setWorkflowEditor({ mode: "create", name: "" });
  }

  // Loads a saved workflow into the same editor used for page-task execution.
  function handleEditWorkflow(workflow: SavedPageWorkflow): void {
    setError(undefined);
    setPageTask(workflow.task);
    setWorkflowEditor({
      mode: "edit",
      id: workflow.id,
      name: workflow.name,
    });
  }

  // Creates or updates one normalized workflow in local extension storage.
  async function handleSaveWorkflow(): Promise<void> {
    if (!workflowEditor) return;
    const name = workflowEditor.name.trim();
    const task = pageTask.trim();
    if (!name) {
      setError(t(locale, "workflowNameRequired"));
      return;
    }
    if (!task) {
      setError(t(locale, "pageTaskRequired"));
      return;
    }

    let nextWorkflows: SavedPageWorkflow[];
    let toastKey: MessageKey;
    if (workflowEditor.mode === "create") {
      nextWorkflows = [{ id: crypto.randomUUID(), name, task }, ...workflows];
      toastKey = "workflowSaved";
    } else {
      if (!workflows.some((workflow) => workflow.id === workflowEditor.id)) {
        setError(t(locale, "workflowUnavailable"));
        return;
      }
      nextWorkflows = workflows.map((workflow) =>
        workflow.id === workflowEditor.id
          ? { ...workflow, name, task }
          : workflow,
      );
      toastKey = "workflowUpdated";
    }

    setError(undefined);
    setWorkflowMutationPending(true);
    try {
      await savePageWorkflows(nextWorkflows);
      setWorkflows(nextWorkflows);
      setWorkflowEditor(undefined);
      showToast(t(locale, toastKey));
    } catch (workflowError) {
      setError(formatError(locale, workflowError));
    } finally {
      setWorkflowMutationPending(false);
    }
  }

  // Removes one explicitly confirmed workflow from local extension storage.
  async function handleDeleteWorkflow(
    workflow: SavedPageWorkflow,
  ): Promise<void> {
    if (!window.confirm(t(locale, "confirmDeleteWorkflow"))) return;

    const nextWorkflows = workflows.filter((item) => item.id !== workflow.id);
    if (nextWorkflows.length === workflows.length) {
      setError(t(locale, "workflowUnavailable"));
      return;
    }

    setError(undefined);
    setWorkflowMutationPending(true);
    try {
      await savePageWorkflows(nextWorkflows);
      setWorkflows(nextWorkflows);
      if (
        workflowEditor?.mode === "edit" &&
        workflowEditor.id === workflow.id
      ) {
        setWorkflowEditor(undefined);
      }
      showToast(t(locale, "workflowDeleted"));
    } catch (workflowError) {
      setError(formatError(locale, workflowError));
    } finally {
      setWorkflowMutationPending(false);
    }
  }

  // Runs one natural-language task against the current page's indexed DOM.
  async function runPageAgent(taskInput: string): Promise<void> {
    const task = taskInput.trim();
    if (!task) {
      setError(t(locale, "pageTaskRequired"));
      return;
    }

    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let executionRecord: PageAgentExecutionRecord | undefined;
    setError(undefined);
    setResult(undefined);
    completedPageAgentSteps.current = [];
    setPageAgentRun({
      current: { phase: "reading", stepIndex: 0 },
      completedSteps: [],
    });
    activePageAgentRequestId.current = requestId;
    setPending({ requestId, action: "operate-page" });
    try {
      const execution = await sendBackgroundRequest<PageAgentExecutionResult>({
        target: "background",
        type: "run-page-agent",
        requestId,
        task,
      });
      setResult({
        action: "operate-page",
        content: execution.content,
        status: execution.success ? "completed" : "incomplete",
      });
      executionRecord = {
        id: crypto.randomUUID(),
        task,
        startedAt,
        finishedAt: Date.now(),
        status: execution.success ? "completed" : "incomplete",
        result: execution.content,
        steps: completedPageAgentSteps.current.map((step) => ({
          action: describePageAgentAction(locale, step.action),
          output:
            step.action.type === "complete" || step.action.type === "ask-user"
              ? ""
              : step.output,
          durationMs: step.durationMs,
        })),
      };
    } catch (agentError) {
      const message = formatError(locale, agentError);
      const status =
        agentError instanceof Error && agentError.message === "requestCancelled"
          ? "cancelled"
          : "failed";
      setPageAgentRun((currentRun) => ({
        current: {
          phase: "failed",
          stepIndex: currentRun?.current.stepIndex ?? 0,
          message,
        },
        completedSteps: currentRun?.completedSteps ?? [],
      }));
      setResult({ action: "operate-page", content: message, status });
      executionRecord = {
        id: crypto.randomUUID(),
        task,
        startedAt,
        finishedAt: Date.now(),
        status,
        result: message,
        steps: completedPageAgentSteps.current.map((step) => ({
          action: describePageAgentAction(locale, step.action),
          output:
            step.action.type === "complete" || step.action.type === "ask-user"
              ? ""
              : step.output,
          durationMs: step.durationMs,
        })),
      };
    } finally {
      activePageAgentRequestId.current = undefined;
      setPending(undefined);
      if (executionRecord) {
        setHistoryMutationPending(true);
        try {
          setExecutionHistory(
            await addPageAgentExecutionRecord(executionRecord),
          );
        } catch (historyError) {
          setError(formatError(locale, historyError));
        } finally {
          setHistoryMutationPending(false);
        }
      }
    }
  }

  // Runs a saved task in one click while making its description visible.
  function handleRunWorkflow(workflow: SavedPageWorkflow): void {
    setWorkflowEditor(undefined);
    setPageTask(workflow.task);
    void runPageAgent(workflow.task);
  }

  // Removes one confirmed page-task record from local extension storage.
  async function handleDeleteExecutionRecord(
    record: PageAgentExecutionRecord,
  ): Promise<void> {
    if (!window.confirm(t(locale, "confirmDeleteExecutionRecord"))) return;
    const nextHistory = executionHistory.filter(
      (item) => item.id !== record.id,
    );

    setError(undefined);
    setHistoryMutationPending(true);
    try {
      await savePageAgentHistory(nextHistory);
      setExecutionHistory(nextHistory);
      showToast(t(locale, "executionRecordDeleted"));
    } catch (historyError) {
      setError(formatError(locale, historyError));
    } finally {
      setHistoryMutationPending(false);
    }
  }

  // Clears all page-task records after one explicit confirmation.
  async function handleClearExecutionHistory(): Promise<void> {
    if (!window.confirm(t(locale, "confirmClearExecutionHistory"))) return;

    setError(undefined);
    setHistoryMutationPending(true);
    try {
      await savePageAgentHistory([]);
      setExecutionHistory([]);
      showToast(t(locale, "executionHistoryCleared"));
    } catch (historyError) {
      setError(formatError(locale, historyError));
    } finally {
      setHistoryMutationPending(false);
    }
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
    setView(nextSettings.enabled ? "main" : "settings");
    showToast(t(nextSettings.locale, "settingsSaved"));
  }

  // Persists the launcher's expanded state so the toolbar and every tab agree.
  async function handlePanelOpenChange(open: boolean): Promise<void> {
    if (!open && pending) return;
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
    if (panelOpen && pending) return;
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
        disabled={Boolean(pending)}
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
            className="hp-panel hp-panel-drag-handle pointer-events-auto fixed right-4 bottom-[86px] flex min-h-24 w-[min(380px,calc(100vw-32px))] items-center justify-center rounded-md border bg-background p-3 text-muted-foreground"
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
  const pageReady = settings.enabled && !pageError;
  const actionsDisabled = Boolean(
    pending ||
      historyMutationPending ||
      !provider ||
      !pageReady,
  );
  const historyDateFormatter = new Intl.DateTimeFormat(
    locale === "zh_CN" ? "zh-CN" : "en",
    { dateStyle: "short", timeStyle: "short" },
  );
  // The textarea remains the editable source; this mirror only identifies
  // references generated by the picker.
  const pageTaskHighlightSegments = pageTask.split(
    /(\[(?:element|元素) <[^>\s]+>(?: role="(?:\\.|[^"\\])*")?(?: "(?:\\.|[^"\\])*")?\])/g,
  );
  return (
    <>
      {panelVisible && (
        <div
          id="hyperpage-tool-panel"
          ref={panelRef}
          data-dragging={panelDragging || undefined}
          data-resizing={panelResizing || panelHeightResizing || undefined}
          style={
            panelPosition
              ? {
                  left: panelPosition.left,
                  top: panelPosition.top,
                  right: "auto",
                  bottom: "auto",
                  width: panelWidth,
                  height: panelHeight,
                }
              : { width: panelWidth, height: panelHeight }
          }
          className="hp-panel pointer-events-auto fixed right-4 bottom-[86px] flex flex-col overflow-hidden rounded-md border bg-background text-foreground"
        >
          <div
            className="group absolute top-2 bottom-2 left-0 z-10 w-2 cursor-ew-resize touch-none outline-none"
            role="separator"
            aria-label={t(locale, "resizePanel")}
            aria-orientation="vertical"
            aria-valuemin={Math.min(PANEL_MIN_WIDTH, panelWidth)}
            aria-valuemax={Math.max(
              panelWidth,
              window.innerWidth - VIEWPORT_EDGE_GAP * 2,
            )}
            aria-valuenow={Math.round(panelWidth)}
            tabIndex={0}
            onKeyDown={handlePanelResizeKeyDown}
            onPointerDown={handlePanelResizePointerDown}
            onPointerMove={handlePanelResizePointerMove}
            onPointerUp={handlePanelResizePointerEnd}
            onPointerCancel={handlePanelResizePointerEnd}
          >
            <span className="pointer-events-none absolute top-1/2 left-0.5 h-10 w-1 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50 group-focus-visible:bg-ring" />
          </div>

          <div
            className="group absolute top-0 right-2 left-2 z-10 h-2 cursor-ns-resize touch-none outline-none"
            role="separator"
            aria-label={t(locale, "resizePanelHeight")}
            aria-orientation="horizontal"
            aria-valuemin={Math.min(PANEL_MIN_HEIGHT, panelHeight)}
            aria-valuemax={Math.max(
              panelHeight,
              window.innerHeight - VIEWPORT_EDGE_GAP * 2,
            )}
            aria-valuenow={Math.round(panelHeight)}
            tabIndex={0}
            onKeyDown={handlePanelHeightResizeKeyDown}
            onPointerDown={handlePanelHeightResizePointerDown}
            onPointerMove={handlePanelHeightResizePointerMove}
            onPointerUp={handlePanelHeightResizePointerEnd}
            onPointerCancel={handlePanelHeightResizePointerEnd}
          >
            <span className="pointer-events-none absolute top-0.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50 group-focus-visible:bg-ring" />
          </div>

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
                      disabled={!settings.enabled}
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

              <Badge
                variant={settings.enabled && provider ? "secondary" : "outline"}
              >
                {t(
                  locale,
                  !settings.enabled
                    ? "extensionOff"
                    : provider
                      ? "configured"
                      : "setupRequired",
                )}
              </Badge>

              {view === "main" && (
                <IconTooltip label={t(locale, "settings")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t(locale, "settings")}
                    disabled={Boolean(pending)}
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
                  disabled={Boolean(pending)}
                  onClick={() => void handlePanelOpenChange(false)}
                >
                  <X />
                </Button>
              </IconTooltip>
            </div>
          </header>

          {view === "settings" ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
              <div className="hp-view-enter">
                <SettingsView
                  settings={settings}
                  onSaved={handleSettingsSaved}
                />
              </div>
            </div>
          ) : (
            <main className="hp-view-enter flex min-h-0 flex-1 flex-col bg-muted/30">
              <Tabs
                value={mainTab}
                onValueChange={setMainTab}
                className="min-h-0 flex-1 gap-0 overflow-hidden"
              >
                <div
                  className="shrink-0 border-b bg-background p-2"
                  data-main-navigation
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="ai">
                      <Sparkles data-icon="inline-start" />
                      {t(locale, "aiTools")}
                    </TabsTrigger>
                    <TabsTrigger value="operate">
                      <Bot data-icon="inline-start" />
                      {t(locale, "operatePage")}
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div
                  className="grid min-h-0 flex-1 auto-rows-max content-start gap-3 overflow-y-auto p-3 pb-6"
                  data-panel-scroll-region
                >
                  {mainTab !== "operate" && (
                      <Card size="sm" data-selected-element-summary>
                        <CardHeader>
                          <CardTitle>{t(locale, "selectedElement")}</CardTitle>
                          <CardAction className="flex items-center gap-1">
                            <Badge variant="outline">
                              {selection
                                ? selection.kind
                                : t(locale, "noSelection")}
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
                                      setSelectionExpanded(
                                        (expanded) => !expanded,
                                      )
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
                                <Badge variant="secondary">
                                  {selection.tagName}
                                </Badge>
                                {selection.editable && (
                                  <Badge variant="outline">
                                    {t(locale, "editable")}
                                  </Badge>
                                )}
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {selection.text.length}{" "}
                                  {t(locale, "characters")}
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
                                <EmptyTitle>
                                  {t(locale, "noSelection")}
                                </EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          )}
                        </CardContent>

                        <CardFooter className="gap-2">
                          <Button
                            className="min-w-0 flex-1"
                            disabled={
                              !pageReady ||
                              pageState.selecting ||
                              Boolean(pending)
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
                          <ButtonGroup
                            aria-label={t(locale, "selectedElement")}
                          >
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
                                  void runPageCommand({
                                    type: "cancel-selection",
                                  })
                                }
                              >
                                <X />
                              </Button>
                            </IconTooltip>
                          </ButtonGroup>
                        </CardFooter>
                      </Card>
                    )}

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
                      <div className="flex items-center justify-between gap-2">
                        <h2
                          id="custom-task-heading"
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {t(locale, "customTask")}
                        </h2>
                        {selection && (
                          <Badge variant="outline">
                            {t(locale, "selectedElementContext")}
                          </Badge>
                        )}
                      </div>
                      <Field data-disabled={actionsDisabled}>
                        <FieldLabel htmlFor="custom-prompt" className="sr-only">
                          {t(locale, "custom")}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupTextarea
                            id="custom-prompt"
                            className="min-h-20"
                            value={customPrompt}
                            disabled={actionsDisabled}
                            placeholder={t(
                              locale,
                              selection
                                ? "customSelectionPrompt"
                                : "customGeneralPrompt",
                            )}
                            onChange={(event) =>
                              setCustomPrompt(event.target.value)
                            }
                          />
                          <InputGroupAddon align="block-end">
                            <InputGroupButton
                              variant="ghost"
                              size="sm"
                              disabled={actionsDisabled || !customPrompt.trim()}
                              onClick={handleCustomPageTask}
                            >
                              <Play data-icon="inline-start" />
                              {t(locale, "runPageTask")}
                            </InputGroupButton>
                            <InputGroupButton
                              variant="default"
                              size="sm"
                              className="ml-auto"
                              disabled={
                                actionsDisabled ||
                                Boolean(selection && !canUseTextAi) ||
                                !customPrompt.trim()
                              }
                              onClick={handleCustomSubmit}
                            >
                              <Send data-icon="inline-start" />
                              {t(locale, "custom")}
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                    </section>
                  </TabsContent>

                  <TabsContent value="operate">
                    <Tabs
                      value={operateTab}
                      onValueChange={setOperateTab}
                      className="gap-3"
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="task">
                          <Play data-icon="inline-start" />
                          {t(locale, "pageTask")}
                        </TabsTrigger>
                        <TabsTrigger value="history">
                          <HistoryIcon data-icon="inline-start" />
                          {t(locale, "executionHistory")}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="task" className="flex flex-col gap-3">
                        <Alert>
                          <Info />
                          <AlertDescription>
                            {t(locale, "pageAgentNotice")}
                          </AlertDescription>
                        </Alert>

                        <Field data-disabled={actionsDisabled}>
                          <div className="flex items-center justify-between gap-2">
                            <FieldLabel htmlFor="page-task">
                              {t(locale, "pageTask")}
                            </FieldLabel>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={actionsDisabled || pageState.selecting}
                              onClick={() =>
                                void handlePageTaskElementSelection()
                              }
                            >
                              <MousePointer2 data-icon="inline-start" />
                              {t(locale, "insertPageTaskElement")}
                            </Button>
                          </div>
                          <InputGroup>
                            <div className="relative w-full">
                              <div
                                ref={pageTaskHighlightRef}
                                className="pointer-events-none absolute inset-0 min-h-28 overflow-hidden px-2.5 py-2 text-base leading-5 whitespace-pre-wrap text-transparent break-words select-none md:text-sm"
                                aria-hidden="true"
                                data-page-task-highlight
                              >
                                {pageTaskHighlightSegments.map(
                                  (segment, index) =>
                                    index % 2 === 1 ? (
                                      <mark
                                        key={index}
                                        className="box-decoration-clone rounded-[3px] bg-ring/25 text-transparent ring-1 ring-ring/40"
                                        data-page-task-reference
                                      >
                                        {segment}
                                      </mark>
                                    ) : (
                                      segment
                                    ),
                                )}
                              </div>
                              <InputGroupTextarea
                                id="page-task"
                                ref={pageTaskInputRef}
                                className="relative min-h-28 w-full"
                                value={pageTask}
                                disabled={actionsDisabled}
                                placeholder={t(locale, "pageTaskPlaceholder")}
                                onChange={(event) =>
                                  setPageTask(event.target.value)
                                }
                                onScroll={(event) => {
                                  const highlight =
                                    pageTaskHighlightRef.current;
                                  if (!highlight) return;
                                  highlight.scrollTop =
                                    event.currentTarget.scrollTop;
                                  highlight.scrollLeft =
                                    event.currentTarget.scrollLeft;
                                }}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" &&
                                    !event.shiftKey &&
                                    !event.nativeEvent.isComposing
                                  ) {
                                    event.preventDefault();
                                    void runPageAgent(pageTask);
                                  }
                                }}
                              />
                            </div>
                            <InputGroupAddon align="block-end">
                              {!workflowEditor && (
                                <InputGroupButton
                                  variant="ghost"
                                  size="sm"
                                  disabled={
                                    Boolean(pending) ||
                                    workflowMutationPending ||
                                    !pageTask.trim()
                                  }
                                  onClick={handleCreateWorkflow}
                                >
                                  <BookmarkPlus data-icon="inline-start" />
                                  {t(locale, "saveWorkflow")}
                                </InputGroupButton>
                              )}
                              <InputGroupButton
                                variant="default"
                                size="sm"
                                className="ml-auto"
                                disabled={actionsDisabled || !pageTask.trim()}
                                onClick={() => void runPageAgent(pageTask)}
                              >
                                <Play data-icon="inline-start" />
                                {t(locale, "startPageTask")}
                              </InputGroupButton>
                            </InputGroupAddon>
                          </InputGroup>
                        </Field>

                        {workflowEditor && (
                          <Field data-disabled={workflowMutationPending}>
                            <FieldLabel htmlFor="workflow-name">
                              {t(locale, "workflowName")}
                            </FieldLabel>
                            <InputGroup>
                              <InputGroupInput
                                id="workflow-name"
                                autoFocus
                                value={workflowEditor.name}
                                disabled={workflowMutationPending}
                                placeholder={t(
                                  locale,
                                  "workflowNamePlaceholder",
                                )}
                                onChange={(event) =>
                                  setWorkflowEditor({
                                    ...workflowEditor,
                                    name: event.target.value,
                                  })
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    setWorkflowEditor(undefined);
                                  } else if (
                                    event.key === "Enter" &&
                                    !event.nativeEvent.isComposing
                                  ) {
                                    event.preventDefault();
                                    void handleSaveWorkflow();
                                  }
                                }}
                              />
                              <InputGroupAddon align="inline-end">
                                <IconTooltip
                                  label={t(locale, "cancelWorkflowEdit")}
                                >
                                  <InputGroupButton
                                    size="icon-xs"
                                    aria-label={t(locale, "cancelWorkflowEdit")}
                                    disabled={workflowMutationPending}
                                    onClick={() => setWorkflowEditor(undefined)}
                                  >
                                    <X />
                                  </InputGroupButton>
                                </IconTooltip>
                                <IconTooltip
                                  label={
                                    workflowEditor.mode === "create"
                                      ? t(locale, "saveWorkflow")
                                      : t(locale, "saveWorkflowChanges")
                                  }
                                >
                                  <InputGroupButton
                                    size="icon-xs"
                                    aria-label={
                                      workflowEditor.mode === "create"
                                        ? t(locale, "saveWorkflow")
                                        : t(locale, "saveWorkflowChanges")
                                    }
                                    disabled={
                                      workflowMutationPending ||
                                      !workflowEditor.name.trim() ||
                                      !pageTask.trim()
                                    }
                                    onClick={() => void handleSaveWorkflow()}
                                  >
                                    {workflowMutationPending ? (
                                      <Spinner />
                                    ) : (
                                      <Check />
                                    )}
                                  </InputGroupButton>
                                </IconTooltip>
                              </InputGroupAddon>
                            </InputGroup>
                          </Field>
                        )}

                        <section
                          className="flex min-w-0 flex-col gap-2"
                          aria-labelledby="saved-workflows-heading"
                        >
                          <h2
                            id="saved-workflows-heading"
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {t(locale, "savedWorkflows")}
                          </h2>
                          {workflows.length === 0 ? (
                            <Empty className="min-h-16 rounded-md border p-3">
                              <EmptyHeader>
                                <EmptyMedia variant="icon">
                                  <BookmarkPlus />
                                </EmptyMedia>
                                <EmptyTitle>
                                  {t(locale, "noSavedWorkflows")}
                                </EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <div className="divide-y overflow-hidden rounded-md border">
                              {workflows.map((workflow) => (
                                <div
                                  key={workflow.id}
                                  className="flex min-w-0 items-start gap-2 p-2.5"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-medium">
                                      {workflow.name}
                                    </p>
                                    <p
                                      className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground"
                                      title={workflow.task}
                                    >
                                      {workflow.task}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <IconTooltip
                                      label={`${t(locale, "runWorkflow")}: ${workflow.name}`}
                                    >
                                      <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={`${t(locale, "runWorkflow")}: ${workflow.name}`}
                                        disabled={actionsDisabled}
                                        onClick={() =>
                                          handleRunWorkflow(workflow)
                                        }
                                      >
                                        <Play />
                                      </Button>
                                    </IconTooltip>
                                    <IconTooltip
                                      label={`${t(locale, "editWorkflow")}: ${workflow.name}`}
                                    >
                                      <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={`${t(locale, "editWorkflow")}: ${workflow.name}`}
                                        disabled={
                                          Boolean(pending) ||
                                          workflowMutationPending
                                        }
                                        onClick={() =>
                                          handleEditWorkflow(workflow)
                                        }
                                      >
                                        <Pencil />
                                      </Button>
                                    </IconTooltip>
                                    <IconTooltip
                                      label={`${t(locale, "deleteWorkflow")}: ${workflow.name}`}
                                    >
                                      <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        aria-label={`${t(locale, "deleteWorkflow")}: ${workflow.name}`}
                                        disabled={
                                          Boolean(pending) ||
                                          workflowMutationPending
                                        }
                                        onClick={() =>
                                          void handleDeleteWorkflow(workflow)
                                        }
                                      >
                                        <Trash2 />
                                      </Button>
                                    </IconTooltip>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </TabsContent>

                      <TabsContent
                        value="history"
                        className="flex flex-col gap-3"
                      >
                        <section
                          className="flex min-w-0 flex-col gap-2"
                          aria-labelledby="execution-history-heading"
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <h2
                                id="execution-history-heading"
                                className="text-sm font-medium"
                              >
                                {t(locale, "executionHistory")}
                              </h2>
                              <Badge variant="outline">
                                {executionHistory.length}
                              </Badge>
                            </div>
                            {executionHistory.length > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  Boolean(pending) || historyMutationPending
                                }
                                onClick={() =>
                                  void handleClearExecutionHistory()
                                }
                              >
                                {historyMutationPending ? (
                                  <Spinner data-icon="inline-start" />
                                ) : (
                                  <Trash2 data-icon="inline-start" />
                                )}
                                {t(locale, "clearExecutionHistory")}
                              </Button>
                            )}
                          </div>

                          {executionHistory.length === 0 ? (
                            <Empty className="min-h-28 rounded-md border p-3">
                              <EmptyHeader>
                                <EmptyMedia variant="icon">
                                  <HistoryIcon />
                                </EmptyMedia>
                                <EmptyTitle>
                                  {t(locale, "noExecutionHistory")}
                                </EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <div className="divide-y overflow-hidden rounded-md border bg-background">
                              {executionHistory.map((record) => (
                                <Collapsible key={record.id}>
                                  <div className="flex min-w-0 items-stretch">
                                    <CollapsibleTrigger
                                      aria-label={`${t(
                                        locale,
                                        getPageAgentStatusLabelKey(
                                          record.status,
                                        ),
                                      )}: ${record.task}`}
                                      render={
                                        <Button
                                          variant="ghost"
                                          className="h-auto min-w-0 flex-1 shrink justify-start rounded-none px-3 py-2.5 text-left whitespace-normal"
                                        />
                                      }
                                    >
                                      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                                        <div className="flex min-w-0 max-w-full items-center gap-2">
                                          <Badge
                                            variant={
                                              record.status === "failed"
                                                ? "destructive"
                                                : record.status === "completed"
                                                  ? "secondary"
                                                  : "outline"
                                            }
                                          >
                                            {t(
                                              locale,
                                              getPageAgentStatusLabelKey(
                                                record.status,
                                              ),
                                            )}
                                          </Badge>
                                          <span className="truncate font-medium">
                                            {record.task}
                                          </span>
                                        </div>
                                        <p className="text-xs font-normal text-muted-foreground">
                                          <time
                                            dateTime={new Date(
                                              record.startedAt,
                                            ).toISOString()}
                                          >
                                            {historyDateFormatter.format(
                                              record.startedAt,
                                            )}
                                          </time>
                                          {" / "}
                                          {formatDuration(
                                            locale,
                                            record.finishedAt -
                                              record.startedAt,
                                          )}
                                        </p>
                                      </div>
                                      <ChevronDown className="transition-transform group-data-panel-open/button:rotate-180" />
                                    </CollapsibleTrigger>
                                    <IconTooltip
                                      label={`${t(locale, "deleteExecutionRecord")}: ${record.task}`}
                                    >
                                      <Button
                                        className="my-2 mr-2"
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={`${t(locale, "deleteExecutionRecord")}: ${record.task}`}
                                        disabled={
                                          Boolean(pending) ||
                                          historyMutationPending
                                        }
                                        onClick={() =>
                                          void handleDeleteExecutionRecord(
                                            record,
                                          )
                                        }
                                      >
                                        <Trash2 />
                                      </Button>
                                    </IconTooltip>
                                  </div>

                                  <CollapsibleContent className="flex flex-col gap-3 border-t bg-muted/30 px-3 py-3">
                                    <section className="flex min-w-0 flex-col gap-1.5">
                                      <h3 className="text-xs font-medium text-muted-foreground">
                                        {t(locale, "result")}
                                      </h3>
                                      <div className="hp-markdown text-sm leading-6">
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                          components={{
                                            a: ({ children, ...props }) => (
                                              <a
                                                {...props}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                {children}
                                              </a>
                                            ),
                                            img: () => null,
                                          }}
                                        >
                                          {record.result}
                                        </ReactMarkdown>
                                      </div>
                                    </section>

                                    <Separator />

                                    <section className="flex min-w-0 flex-col gap-2">
                                      <h3 className="text-xs font-medium text-muted-foreground">
                                        {t(locale, "executionDetails")}
                                      </h3>
                                      {record.steps.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                          {t(locale, "noExecutedSteps")}
                                        </p>
                                      ) : (
                                        <ol className="flex min-w-0 flex-col gap-2">
                                          {record.steps.map((step, index) => (
                                            <li
                                              key={`${record.id}-${index}`}
                                              className="flex min-w-0 items-start gap-2 border-l-2 border-border pl-2"
                                            >
                                              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                              <div className="min-w-0">
                                                <p className="break-words whitespace-pre-wrap">
                                                  <span className="text-xs text-muted-foreground">
                                                    {t(locale, "pageTaskStep")}{" "}
                                                    {index + 1}:{" "}
                                                  </span>
                                                  {step.action}
                                                </p>
                                                {step.output && (
                                                  <p className="break-words whitespace-pre-wrap text-xs text-muted-foreground">
                                                    {step.output} (
                                                    {formatDuration(
                                                      locale,
                                                      step.durationMs,
                                                    )}
                                                    )
                                                  </p>
                                                )}
                                              </div>
                                            </li>
                                          ))}
                                        </ol>
                                      )}
                                    </section>
                                  </CollapsibleContent>
                                </Collapsible>
                              ))}
                            </div>
                          )}
                        </section>
                      </TabsContent>
                    </Tabs>
                  </TabsContent>

                  {(pageError ||
                    pending ||
                    result ||
                    pageAgentRun ||
                    error ||
                    toast) && (
                    <section
                      className="flex flex-col gap-2"
                      data-execution-feedback
                      aria-label={t(locale, "result")}
                    >
                      {pageError && (
                        <Alert className="hp-feedback" variant="destructive">
                      <CircleAlert />
                      <AlertDescription>{pageError}</AlertDescription>
                    </Alert>
                  )}

                  {(pending || result || pageAgentRun) && (
                    <Card
                      className="hp-feedback"
                      size="sm"
                      aria-labelledby="result-heading"
                    >
                      <CardHeader className="border-b">
                        <CardTitle
                          id="result-heading"
                          className="flex min-w-0 items-center gap-2"
                        >
                          {pending ? (
                            pending.action === "operate-page" ? (
                              <Bot className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <Spinner className="shrink-0" />
                            )
                          ) : result?.action === "operate-page" &&
                            result.status !== "completed" ? (
                            <CircleAlert
                              className={cn(
                                "size-4 shrink-0",
                                result.status === "failed"
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                              )}
                            />
                          ) : (
                            <CircleCheck className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">
                            {pending
                              ? t(locale, getActionLabelKey(pending.action))
                              : result
                                ? t(locale, "result")
                                : t(locale, "operatePage")}
                          </span>
                        </CardTitle>
                        <CardAction className="flex items-center gap-1">
                          {pending ? (
                            <IconTooltip label={t(locale, "cancelRequest")}>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t(locale, "cancelRequest")}
                                onClick={() => void handleCancelRequest()}
                              >
                                <X />
                              </Button>
                            </IconTooltip>
                          ) : (
                            result && (
                              <>
                                <Badge
                                  variant={
                                    result.action !== "operate-page"
                                      ? "outline"
                                      : result.status === "failed"
                                        ? "destructive"
                                        : result.status === "completed"
                                          ? "secondary"
                                          : "outline"
                                  }
                                >
                                  {result.action === "operate-page"
                                    ? t(
                                        locale,
                                        getPageAgentStatusLabelKey(
                                          result.status,
                                        ),
                                      )
                                    : t(
                                        locale,
                                        getActionLabelKey(result.action),
                                      )}
                                </Badge>
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
                                <IconTooltip label={t(locale, "closeResult")}>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t(locale, "closeResult")}
                                    onClick={() => {
                                      setResult(undefined);
                                      setPageAgentRun(undefined);
                                    }}
                                  >
                                    <X />
                                  </Button>
                                </IconTooltip>
                              </>
                            )
                          )}
                        </CardAction>
                      </CardHeader>

                      <CardContent>
                        {pending && pending.action !== "operate-page" ? (
                          <div
                            className="flex min-h-20 flex-col gap-3"
                            role="status"
                            aria-live="polite"
                          >
                            <p className="text-sm text-muted-foreground">
                              {t(locale, "processing")}
                            </p>
                            <div
                              className="flex flex-col gap-2"
                              aria-hidden="true"
                            >
                              <Skeleton className="h-3 w-full" />
                              <Skeleton className="h-3 w-11/12" />
                              <Skeleton className="h-3 w-3/5" />
                            </div>
                          </div>
                        ) : (
                          <>
                            {result && (
                              <div className="hp-markdown text-sm leading-6">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    a: ({ children, ...props }) => (
                                      <a
                                        {...props}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {children}
                                      </a>
                                    ),
                                    img: () => null,
                                  }}
                                >
                                  {result.content}
                                </ReactMarkdown>
                              </div>
                            )}
                            {result && pageAgentRun && (
                              <Separator className="my-3" />
                            )}
                            {pageAgentRun && (
                              <PageAgentProgressView
                                active={pending?.action === "operate-page"}
                                locale={locale}
                                run={pageAgentRun}
                                onAnswer={handlePageAgentAnswer}
                              />
                            )}
                          </>
                        )}
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
                    </section>
                  )}
                </div>
              </Tabs>
            </main>
          )}
        </div>
      )}
      {launcher}
    </>
  );
}

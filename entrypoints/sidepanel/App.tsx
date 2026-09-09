import { message as notify, Toaster } from "@/components/ui/toast";
import {
  ArrowLeft,
  BookmarkPlus,
  BookOpen,
  Captions,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  Clipboard,
  Copy,
  Download,
  FileText,
  MessageSquareText,
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
  Paperclip,
  Pencil,
  Plus,
  Play,
  RefreshCw,
  ScanText,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "../../shared/clipboard";
import { browser } from "wxt/browser";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle } from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type {
  AiExecutionResult,
  AiAction,
  BackgroundRequest,
  ChatContextMode,
  ChatExecutionResult,
  ChatContextSnapshot,
  CommandResult,
  PageAgentAction,
  PageAgentExecutionRecord,
  PageAgentExecutionStatus,
  PageAgentExecutionResult,
  PageAgentProgress,
  PageState,
  PageStateCommand,
  PageReadingSnapshot,
  FileReadingSnapshot,
  PageCitation,
  PanelEvent,
  RunAiRequest,
  SavedPageWorkflow,
  StoredSettings,
} from "../../shared/messages";
import { isVisualSelection } from "../../shared/prompts";
import { getConversationHistory, getTurnCitations, type ConversationTurn, type SavedConversation } from "../../shared/conversations";
import { readTextFile } from "../../shared/files";
import { answerToMarkdown, conversationToMarkdown, downloadText } from "../../shared/export";
import { assertSiteAllowed, getTemplateVariables, parseSiteInput } from "../../shared/task-templates";
import {
  addPageAgentExecutionRecord,
  exportPageWorkflows,
  importPageWorkflows,
  loadPageAgentHistory,
  loadPageWorkflows,
  loadSettings,
  getTaskProvider,
  PAGE_AGENT_HISTORY_STORAGE_KEY,
  PAGE_WORKFLOWS_STORAGE_KEY,
  savePageAgentHistory,
  savePageWorkflows,
  SETTINGS_STORAGE_KEY,
} from "../../shared/settings";
import { ReadingContext } from "./ReadingContext";
import { SnapshotPreview } from "./SnapshotPreview";
import { ElementsContext } from "./ElementsContext";
import { ReadingAnswer } from "./ReadingAnswer";
import { ConversationLibrary } from "./ConversationLibrary";
import { TextExport } from "./TextExport";
import { TemplateParameters } from "./TemplateParameters";
import { PromptTemplates } from "./PromptTemplates";
import { ResultActions } from "./ResultActions";
import { WritingTools } from "./WritingTools";
import { AiComposer } from "./AiComposer";
import { PageTranslationTools, type TranslationPreview } from "./PageTranslationTools";
import type { PageTranslationCommand, PageTranslationResult, TranslationDisplayMode, TranslationTerm } from "../../shared/page-translation";
import { formatError, type MessageKey, t } from "./translations";
import { IconTooltip } from "./ui";
import { WebSearchToggle } from "./WebSearchToggle";

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

type ChatDisplayStatus = "streaming" | "complete" | "cancelled" | "failed";

interface ChatDisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: ChatContextSnapshot["type"];
  status?: ChatDisplayStatus;
  citations?: PageCitation[];
  turnIndex: number;
}

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
const PANEL_DEFAULT_WIDTH = 420;
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
function getActionLabelKey(
  action: AiAction | "chat" | "operate-page" | "translate-page",
): MessageKey {
  switch (action) {
    case "translate":
      return "translate";
    case "translate-page":
      return "pageTranslation";
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
    case "write":
      return "writingAssistant";
    case "custom":
    case "chat":
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
          <AiComposer
              id="page-agent-answer"
              locale={locale}
              value={answer}
              autoFocus
              disabled={answerPending}
              running={answerPending}
              canSubmit={Boolean(answer.trim())}
              submitLabel={t(locale, "sendAnswer")}
              onSubmit={() => void submitAnswer()}
              placeholder={t(locale, "pageAgentAnswerPlaceholder")}
              onChange={(event) => setAnswer(event.target.value)}
            />
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
  const [pageState, setPageState] = useState<PageState>(EMPTY_PAGE_STATE);
  const [pageError, setPageError] = useState<string>();
  const [result, setResult] = useState<AiResult>();
  const [pending, setPending] = useState<{
    requestId: string;
    action: AiAction | "chat" | "operate-page" | "translate-page";
  }>();
  const [customPrompt, setCustomPrompt] = useState("");
  const [toolPrompt, setToolPrompt] = useState("");
  const [chatContext, setChatContext] = useState<Exclude<ChatContextMode, "selection">>("none");
  const [chatTurns, setChatTurns] = useState<ConversationTurn[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [editingTurnIndex, setEditingTurnIndex] = useState<number | null>(null);
  const [conversationLibraryOpen, setConversationLibraryOpen] = useState(false);
  const [attachmentExpanded, setAttachmentExpanded] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [savedConversation, setSavedConversation] = useState<SavedConversation | null>(null);
  const [readingSnapshot, setReadingSnapshot] = useState<PageReadingSnapshot | null>(null);
  const [videoSnapshot, setVideoSnapshot] = useState<PageReadingSnapshot | null>(null);
  const [videoBlockIds, setVideoBlockIds] = useState<string[]>([]);
  const [readingBlockIds, setReadingBlockIds] = useState<string[]>([]);
  const [readingLoading, setReadingLoading] = useState(false);
  const [contextElements, setContextElements] = useState<PageReadingSnapshot[]>([]);
  const [fileSnapshot, setFileSnapshot] = useState<FileReadingSnapshot | null>(null);
  const [fileBlockIds, setFileBlockIds] = useState<string[]>([]);
  const selectedReadingSnapshot = useMemo(() => {
    if (!readingSnapshot) return null;
    const selected = new Set(readingBlockIds);
    return { ...readingSnapshot, blocks: readingSnapshot.blocks.filter((block) => selected.has(block.id)) };
  }, [readingSnapshot, readingBlockIds]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextSelectionRevision = useRef<number | null>(null);
  const [translationPreview, setTranslationPreview] = useState<TranslationPreview | null>(null);
  const [translationMode, setTranslationMode] = useState<TranslationDisplayMode | null>(null);
  const [pageTask, setPageTask] = useState("");
  const [taskSites, setTaskSites] = useState("");
  const [workflows, setWorkflows] = useState<SavedPageWorkflow[]>([]);
  const [workflowEditor, setWorkflowEditor] = useState<WorkflowEditor>();
  const [workflowMutationPending, setWorkflowMutationPending] = useState(false);
  const workflowImportRef = useRef<HTMLInputElement>(null);
  const [parameterTask, setParameterTask] = useState<{ template: string; allowedOrigins: string[] } | null>(null);
  const [mainTab, setMainTab] = useState("chat");
  const [documentsOpened, setDocumentsOpened] = useState(false);
  const [operateTab, setOperateTab] = useState("task");
  const [pageAgentRun, setPageAgentRun] = useState<PageAgentRunState>();
  const [executionHistory, setExecutionHistory] = useState<
    PageAgentExecutionRecord[]
  >([]);
  const [historyMutationPending, setHistoryMutationPending] = useState(false);
  const [selectionExpanded, setSelectionExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() =>
    Math.min(PANEL_DEFAULT_WIDTH, window.innerWidth - 32),
  );
  const [panelHeight, setPanelHeight] = useState(() =>
    Math.min(720, window.innerHeight - 32),
  );
  const [panelPosition, setPanelPosition] = useState<FloatingPosition>();
  const [panelDragging, setPanelDragging] = useState(false);
  const [panelResizing, setPanelResizing] = useState(false);
  const [panelHeightResizing, setPanelHeightResizing] = useState(false);
  const pageSelecting = useRef(false);
  const selectionRevision = useRef(0);
  const activePageAgentRequestId = useRef<string | undefined>(undefined);
  const activeChatRequestId = useRef<string | undefined>(undefined);
  const pendingRequest = useRef(pending);
  const completedPageAgentSteps = useRef<CompletedPageAgentStep[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const pageTaskInputRef = useRef<HTMLTextAreaElement>(null);
  const customPromptInputRef = useRef<HTMLTextAreaElement>(null);
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
  const panelDragSession = useRef<DragSession | undefined>(undefined);
  const panelResizeSession = useRef<PanelResizeSession | undefined>(undefined);
  const panelHeightResizeSession = useRef<PanelHeightResizeSession | undefined>(
    undefined,
  );
  pendingRequest.current = pending;

  const locale = settings?.locale ?? (browser.i18n.getUILanguage().toLowerCase().startsWith("zh") ? "zh_CN" : "en");
  const selection = pageState.selection;
  const hasProvider = Boolean(settings?.providers.length);
  const supportsVision = settings ? getTaskProvider(settings, "vision")?.capabilities.vision.status === "supported" : false;
  const webSearchCapability = settings ? getTaskProvider(settings, "chat")?.capabilities.webSearch : undefined;
  useEffect(() => { setWebSearch(false); }, [webSearchCapability]);
  useEffect(() => {
    const revision = contextSelectionRevision.current;
    if (revision === null || pageState.selecting) return;
    contextSelectionRevision.current = null;
    if (pageState.selection && pageState.selectionRevision !== revision) void handleAddContextElement();
  }, [pageState]);
  const chatMessages: ChatDisplayMessage[] = chatTurns.flatMap((turn, turnIndex) => [
    { id: `user-${turn.id}`, role: "user", content: turn.prompt, context: turn.snapshot.type, turnIndex },
    { id: `assistant-${turn.id}`, role: "assistant", content: turn.answer, status: turn.status, citations: getTurnCitations(chatTurns, turnIndex), turnIndex },
  ]);

  // Applies page state and invalidates only results that depend on the old selection.
  const applyPageState = useCallback((nextState: PageState): void => {
    pageSelecting.current = nextState.selecting;
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

  // Appends a streamed delta only to the assistant turn that requested it.
  const applyChatDelta = useCallback(
    (requestId: string, delta: string): void => {
      if (requestId !== activeChatRequestId.current) return;
      setChatTurns((turns) =>
        turns.map((turn) =>
          turn.id === requestId && turn.status === "streaming"
            ? { ...turn, answer: turn.answer + delta }
            : turn,
        ),
      );
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
      const error = formatError(locale, refreshError);
      setPageError(error);
      notify.error(error);
    }
  }, [applyPageState, locale]);

  const initializePanel = useCallback(async (): Promise<void> => {
    const uiLanguage = browser.i18n.getUILanguage();
    const initialLocale = uiLanguage.toLowerCase().startsWith("zh")
      ? "zh_CN"
      : "en";
    try {
      const [loadedSettings, loadedHistory, loadedWorkflows] = await Promise.all([
        loadSettings(uiLanguage), loadPageAgentHistory(), loadPageWorkflows(),
      ]);
      setSettings(loadedSettings);
      setExecutionHistory(loadedHistory);
      setWorkflows(loadedWorkflows);
      setInitializationError(undefined);
    } catch (loadError) {
      const error = formatError(initialLocale, loadError);
      setInitializationError(error);
      notify.error(error);
    }
  }, []);

  useEffect(() => { void initializePanel(); }, [initializePanel]);

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
      if (message.type === "toggle-panel") {
        if (pageSelecting.current) {
          setPanelOpen(true);
          void runPageCommand({ type: "cancel-selection" });
          return;
        }
        setPanelOpen((open) => (open && pendingRequest.current ? open : !open));
        return;
      }
      if (message.type === "page-state-changed") {
        applyPageState(message.state);
        return;
      }
      if (message.type === "chat-delta") {
        applyChatDelta(message.requestId, message.delta);
        return;
      }
      if (message.type === "chat-context" && message.requestId === activeChatRequestId.current) {
        setChatTurns((turns) => turns.map((turn) => turn.id === message.requestId ? { ...turn, snapshot: message.snapshot } : turn));
        return;
      }
      if (
        message.type === "page-agent-progress" &&
        message.requestId === activePageAgentRequestId.current
      ) {
        applyPageAgentProgress(message.progress);
      }
    };

    browser.runtime.onMessage.addListener(handlePanelEvent);
    return () => {
      browser.runtime.onMessage.removeListener(handlePanelEvent);
    };
  }, [
    applyChatDelta,
    applyPageAgentProgress,
    applyPageState,
    refreshPageState,
    settings,
  ]);

  // Synchronizes persisted settings, workflows, and history for this panel.
  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: Browser.storage.AreaName,
    ): void => {
      if (areaName === "local" && changes[SETTINGS_STORAGE_KEY]) {
        void loadSettings(browser.i18n.getUILanguage()).then((nextSettings) => {
          setSettings(nextSettings);
          if (!nextSettings.enabled) {
            applyPageState(EMPTY_PAGE_STATE);
            setPageError(undefined);
          }
        }).catch((settingsError: unknown) => notify.error(formatError(locale, settingsError)));
      }
      if (areaName === "local" && changes[PAGE_AGENT_HISTORY_STORAGE_KEY]) {
        void loadPageAgentHistory()
          .then(setExecutionHistory)
          .catch((historyError: unknown) => {
            notify.error(formatError(locale, historyError));
          });
      }
      if (areaName === "local" && changes[PAGE_WORKFLOWS_STORAGE_KEY]) {
        void loadPageWorkflows()
          .then(setWorkflows)
          .catch((workflowError: unknown) => {
            notify.error(formatError(locale, workflowError));
          });
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, [applyPageState, locale]);


  // Returns keyboard focus to the task immediately after inserting an element reference.
  useEffect(() => {
    const caret = pageTaskCaret.current;
    if (caret === undefined || !pageTaskInputRef.current) return;
    pageTaskInputRef.current.focus();
    pageTaskInputRef.current.setSelectionRange(caret, caret);
    pageTaskCaret.current = undefined;
  }, [pageTask]);

  // Keeps the dragged or resized panel reachable after a viewport resize.
  useEffect(() => {
    const handleResize = (): void => {
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

  // Starts panel dragging only from non-interactive parts of its header.
  function handlePanelPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target as Element).closest("button, input, textarea, select, summary, a, pre")
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

    try {
      const nextState = await sendBackgroundRequest<PageState>({
        target: "background",
        type: "page-command",
        command,
      });
      setPageError(undefined);
      applyPageState(nextState);
      if (successKey) notify.success(t(locale, successKey));
      return nextState;
    } catch (commandError) {
      notify.error(formatError(locale, commandError));
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

    try {
      const state = await runPageCommand({ type: "get-page-state" });
      if (!state) return;
      const content = state.selection
        ? state.selection.text || state.selection.accessibleName
        : "";
      if (!content) {
        notify.error(t(locale, "selectionTextRequired"));
        return;
      }
      await copyText(content);
      notify.success(t(locale, "copied"));
    } catch (clipboardError) {
      notify.error(formatError(locale, clipboardError));
    }
  }

  // Sends one general or selection-scoped request to the configured model.
  async function runAi(request: RunAiRequest): Promise<void> {
    const requestId = crypto.randomUUID();

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
      notify.error(formatError(locale, aiError));
    } finally {
      setPending(undefined);
    }
  }

  function handleToolPromptSubmit(): void {
    const prompt = toolPrompt.trim();
    if (toolPromptDisabled || !prompt) return;
    void runAi({ action: "custom", prompt });
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
      notify.error(formatError(locale, cancelError));
    }
  }

  // Returns one reply to the exact page task currently waiting for the user.
  async function handlePageAgentAnswer(answer: string): Promise<boolean> {
    const requestId = activePageAgentRequestId.current;
    if (!requestId) {
      notify.error(t(locale, "requestUnavailable"));
      return false;
    }

    try {
      await sendBackgroundRequest<null>({
        target: "background",
        type: "answer-page-agent",
        requestId,
        answer,
      });
      return true;
    } catch (answerError) {
      notify.error(formatError(locale, answerError));
      return false;
    }
  }

  async function handleReadPage(): Promise<void> {
    setReadingLoading(true);

    setReadingSnapshot(null);
    setReadingBlockIds([]);
    try {
      const snapshot = await sendBackgroundRequest<PageReadingSnapshot>({ target: "background", type: "reading-command", command: { type: "read-page" } });
      setReadingSnapshot(snapshot);
      setReadingBlockIds(snapshot.blocks.map((block) => block.id));
    } catch (readError) {
      notify.error(formatError(locale, readError));
    } finally {
      setReadingLoading(false);
    }
  }

  async function handleLocateCitation(citation: PageCitation): Promise<boolean> {
    if (citation.documentId) return true;
    try {
      await sendBackgroundRequest<null>({ target: "background", type: "reading-command", command: { type: citation.timeSeconds === undefined ? "locate-citation" : "locate-video-citation", snapshotId: citation.snapshotId, blockId: citation.blockId } });
      return true;
    } catch (locateError) {
      notify.error(formatError(locale, locateError));
      return false;
    }
  }

  async function handleReadVideo(): Promise<void> {
    setReadingLoading(true);

    setVideoSnapshot(null);
    setVideoBlockIds([]);
    try {
      const snapshot = await sendBackgroundRequest<PageReadingSnapshot>({ target: "background", type: "reading-command", command: { type: "read-video" } });
      setVideoSnapshot(snapshot);
      setVideoBlockIds(snapshot.blocks.map((block) => block.id));
      setAttachmentExpanded(true);
    } catch (failure) { notify.error(formatError(locale, failure)); }
    finally { setReadingLoading(false); }
  }

  async function handleAddContextElement(): Promise<void> {
    setReadingLoading(true);

    try {
      const page = await sendBackgroundRequest<PageReadingSnapshot>({ target: "background", type: "reading-command", command: { type: "read-selected-element" } });
      setContextElements((pages) => [...pages, page]);
      setChatContext("elements");
      setAttachmentExpanded(true);
    } catch (readError) {
      notify.error(formatError(locale, readError));
    } finally {
      setReadingLoading(false);
    }
  }

  async function handleSelectContextElement(): Promise<void> {
    if (chatContext !== "elements") setContextElements([]);
    contextSelectionRevision.current = pageState.selectionRevision;
    const state = await runPageCommand({ type: "start-selection" });
    if (!state) contextSelectionRevision.current = null;
  }

  async function handleTextFile(file: File): Promise<void> {
    setReadingLoading(true);

    setFileSnapshot(null);
    setFileBlockIds([]);
    try {
      const snapshot = await readTextFile(file);
      setFileSnapshot(snapshot);
      setFileBlockIds(snapshot.blocks.map((block) => block.id));
      setChatContext("file");
      setAttachmentExpanded(true);
    } catch (failure) { notify.error(formatError(locale, failure)); }
    finally { setReadingLoading(false); }
  }

  async function handleTranslatePage(language: string, terms: TranslationTerm[]): Promise<void> {
    if (pending || readingLoading || !selectedReadingSnapshot) return;
    const source = selectedReadingSnapshot;
    const requestId = crypto.randomUUID();
    setPending({ requestId, action: "translate-page" });
    setTranslationPreview(null);

    try {
      const result = await sendBackgroundRequest<PageTranslationResult>({ target: "background", type: "translate-page", requestId, request: {
        selection: { snapshotId: source.id, blockIds: source.blocks.map((block) => block.id) },
        language, terms,
      } });
      setTranslationPreview({ source, result });
    } catch (failure) { notify.error(formatError(locale, failure)); }
    finally { setPending(undefined); }
  }

  async function handleTranslationCommand(command: PageTranslationCommand): Promise<void> {
    setReadingLoading(true);

    try {
      await sendBackgroundRequest<null>({ target: "background", type: "translation-command", command });
      if (command.type === "restore-translation") { setTranslationMode(null); setTranslationPreview(null); }
      else setTranslationMode(command.type === "apply-translation" ? "bilingual" : command.mode);
    } catch (failure) { notify.error(formatError(locale, failure)); }
    finally { setReadingLoading(false); }
  }

  // Sends one chat turn with the explicitly selected page-context mode.
  async function handleChatSubmit(pagePrompt?: string): Promise<void> {
    if (pending || readingLoading) return;
    const prompt = (pagePrompt ?? customPrompt).trim();
    if (!prompt) {
      notify.error(t(locale, "customPromptRequired"));
      return;
    }
    if (editingTurnIndex !== null) {
      const turn = chatTurns[editingTurnIndex];
      if (turn) await sendConversationTurn(prompt, turn.snapshot, turn.webSearch === true, editingTurnIndex, true);
      return;
    }
    const source = chatContext === "video" ? videoSnapshot : readingSnapshot;
    const selectedBlocks = new Set(chatContext === "video" ? videoBlockIds : readingBlockIds);
    const selectedFileBlocks = new Set(fileBlockIds);
    const reading = source && { ...source, blocks: source.blocks.filter((block) => selectedBlocks.has(block.id)) };
    const file = fileSnapshot && { ...fileSnapshot, blocks: fileSnapshot.blocks.filter((block) => selectedFileBlocks.has(block.id)) };
    if (chatContext === "file" && (!file || !file.blocks.length)) {
      notify.error(t(locale, "fileContextRequired"));
      return;
    }
    if ((chatContext === "page" || chatContext === "video") && (!reading || !reading.blocks.length)) {
      notify.error(t(locale, "pageReadingSelectionInvalid"));
      return;
    }
    if (chatContext === "elements") {
      if (!contextElements.length) {
        notify.error(t(locale, "contextElementsRequired"));
        return;
      }
    }
    const snapshot: ChatContextSnapshot = (chatContext === "page" || chatContext === "video") && reading
      ? { type: "page", page: reading }
      : chatContext === "elements" ? { type: "elements", pages: contextElements }
      : chatContext === "file" && file ? { type: "file", file }
      : { type: "none" };
    await sendConversationTurn(prompt, snapshot, webSearch, chatTurns.length, false);
  }

  async function sendConversationTurn(prompt: string, snapshot: ChatContextSnapshot, search: boolean, index: number, replay: boolean): Promise<void> {
    if (pending || readingLoading) return;
    const requestId = crypto.randomUUID();
    const precedingTurns = chatTurns.slice(0, index);
    search = search && snapshot.type !== "image" && !precedingTurns.some((turn) => turn.status === "complete" && turn.snapshot.type === "image");
    const common = { prompt, includeHistory: true, webSearch: search, history: getConversationHistory(precedingTurns) };
    const chatRequest: BackgroundRequest = replay || snapshot.type === "image"
      ? { target: "background", type: "replay-chat", requestId, request: { ...common, snapshot } }
      : { target: "background", type: "run-chat", requestId, request: { ...common, context: snapshot.type === "page" && snapshot.page.videoId ? "video" : snapshot.type,
      ...(snapshot.type === "page" ? { pageSelection: { snapshotId: snapshot.page.id, blockIds: snapshot.page.blocks.map((block) => block.id) } } : {}),
      ...(snapshot.type === "selection" ? { selectionRevision: selectionRevision.current } : {}),
      ...(snapshot.type === "elements" ? { elementSelections: snapshot.pages.map((page) => ({ snapshotId: page.id, blockIds: page.blocks.map((block) => block.id) })) } : {}),
      ...(snapshot.type === "file" ? { file: snapshot.file } : {}),
    } };
    activeChatRequestId.current = requestId;

    setResult(undefined);
    setPageAgentRun(undefined);
    setCustomPrompt("");
    setEditingTurnIndex(null);
    setChatContext("none");
    setConversationLibraryOpen(false);
    setAttachmentExpanded(false);
    setChatTurns([...precedingTurns, { id: requestId, prompt, snapshot, includeHistory: true, webSearch: search, answer: "", status: "streaming" }]);
    setContextElements([]);
    setPending({ requestId, action: "chat" });

    try {
      const execution = await sendBackgroundRequest<ChatExecutionResult>(chatRequest);
      if (
        execution.selectionRevision !== null &&
        execution.selectionRevision !== selectionRevision.current
      ) {
        throw new Error("requestContextChanged");
      }
      setChatTurns((turns) =>
        turns.map((turn) =>
          turn.id === requestId
            ? {
                ...turn,
                answer: execution.content,
                status: "complete",
              }
            : turn,
        ),
      );
    } catch (chatError) {
      const cancelled =
        chatError instanceof Error && chatError.message === "requestCancelled";
      setChatTurns((turns) =>
        turns.map((turn) =>
          turn.id === requestId
            ? {
                ...turn,
                status: cancelled ? "cancelled" : "failed",
              }
            : turn,
        ),
      );
      setCustomPrompt(prompt);
      notify.error(formatError(locale, chatError));
    } finally {
      if (activeChatRequestId.current === requestId) {
        activeChatRequestId.current = undefined;
      }
      setPending(undefined);
    }
  }

  // Removes only the in-memory conversation from the current page session.
  async function handleClearChat(): Promise<void> {
    if (pending || readingLoading) return;
    try {
      if (translationMode) await sendBackgroundRequest<null>({ target: "background", type: "translation-command", command: { type: "restore-translation" } });
      await sendBackgroundRequest<null>({ target: "background", type: "reading-command", command: { type: "clear-reading" } });
    } catch (clearError) {
      notify.error(formatError(locale, clearError));
      return;
    }
    setChatTurns([]);
    setSavedConversation(null);
    setEditingTurnIndex(null);
    setCustomPrompt("");
    setChatContext("none");
    setConversationLibraryOpen(false);
    setAttachmentExpanded(false);
    setReadingSnapshot(null);
    setReadingBlockIds([]);
    setContextElements([]);
    setVideoSnapshot(null);
    setVideoBlockIds([]);
    setFileSnapshot(null);
    setFileBlockIds([]);
    setTranslationMode(null);
    setTranslationPreview(null);

  }

  function handleLoadConversation(record: SavedConversation): void {
    if (pending || readingLoading) return;
    setChatTurns(record.turns);
    setSavedConversation(record);
    setEditingTurnIndex(null);
    setCustomPrompt("");
    setChatContext("none");
    setConversationLibraryOpen(false);

  }

  function handleEditTurn(index: number): void {
    const turn = chatTurns[index];
    if (!turn || pending) return;
    setEditingTurnIndex(index);
    setCustomPrompt(turn.prompt);
  }

  // Copies one completed or interrupted assistant message.
  async function handleCopyChatMessage(content: string): Promise<void> {

    try {
      await copyText(content);
      notify.success(t(locale, "copied"));
    } catch (clipboardError) {
      notify.error(formatError(locale, clipboardError));
    }
  }

  function handleEditWorkflow(workflow: SavedPageWorkflow): void {
    setPageTask(workflow.task);
    setTaskSites(workflow.allowedOrigins.join("\n"));
    setParameterTask(null);
    setWorkflowEditor({ mode: "edit", id: workflow.id, name: workflow.name });
  }

  async function handleSaveWorkflow(): Promise<void> {
    if (!workflowEditor || workflowMutationPending || pending) return;
    const name = workflowEditor.name.trim();
    const task = pageTask.trim();
    if (!name || !task) {
      notify.error(t(locale, !name ? "workflowNameRequired" : "pageTaskRequired"));
      return;
    }
    setWorkflowMutationPending(true);
    try {
      const allowedOrigins = parseSiteInput(taskSites);
      const current = await loadPageWorkflows();
      if (workflowEditor.mode === "edit" && !current.some((item) => item.id === workflowEditor.id)) {
        throw new Error("workflowUnavailable");
      }
      const next = workflowEditor.mode === "create"
        ? [{ id: crypto.randomUUID(), name, task, allowedOrigins }, ...current]
        : current.map((item) => item.id === workflowEditor.id ? { ...item, name, task, allowedOrigins } : item);
      await savePageWorkflows(next);
      setWorkflows(next);
      setWorkflowEditor(undefined);
      notify.success(t(locale, workflowEditor.mode === "create" ? "workflowSaved" : "workflowUpdated"));
    } catch (workflowError) {
      notify.error(formatError(locale, workflowError));
    } finally {
      setWorkflowMutationPending(false);
    }
  }

  async function handleDeleteWorkflow(workflow: SavedPageWorkflow): Promise<void> {
    if (workflowMutationPending || pending || !window.confirm(t(locale, "confirmDeleteWorkflow"))) return;
    setWorkflowMutationPending(true);
    try {
      const current = await loadPageWorkflows();
      const next = current.filter((item) => item.id !== workflow.id);
      if (next.length === current.length) throw new Error("workflowUnavailable");
      await savePageWorkflows(next);
      setWorkflows(next);
      if (workflowEditor?.mode === "edit" && workflowEditor.id === workflow.id) {
        setWorkflowEditor(undefined);
      }
      notify.success(t(locale, "workflowDeleted"));
    } catch (workflowError) {
      notify.error(formatError(locale, workflowError));
    } finally {
      setWorkflowMutationPending(false);
    }
  }

  async function handleImportWorkflows(file: File): Promise<void> {
    if (workflowMutationPending || pending) return;
    setWorkflowMutationPending(true);
    try {
      if (file.size > 2_000_000) throw new Error("workflowImportTooLarge");
      const imported = importPageWorkflows(await file.text());
      const next = [...imported, ...await loadPageWorkflows()];
      await savePageWorkflows(next);
      setWorkflows(next);
      notify.success(t(locale, "workflowSaved"));
    } catch (workflowError) {
      notify.error(formatError(locale, workflowError));
    } finally {
      setWorkflowMutationPending(false);
    }
  }

  function handleExportWorkflows(): void {
    try {
      downloadText(exportPageWorkflows(workflows), "hyperpage-workflows.json", "application/json");
    } catch (workflowError) {
      notify.error(formatError(locale, workflowError));
    }
  }

  function handleRunWorkflow(workflow: SavedPageWorkflow): void {
    setWorkflowEditor(undefined);
    setPageTask(workflow.task);
    const sites = workflow.allowedOrigins.join("\n");
    setTaskSites(sites);
    setParameterTask(null);
    void preparePageTask(workflow.task, sites);
  }

  async function preparePageTask(taskInput: string, sitesInput: string): Promise<void> {

    try {
      const allowedOrigins = parseSiteInput(sitesInput);
      assertSiteAllowed(window.location.href, allowedOrigins);
      if (getTemplateVariables(taskInput).length) {
        setParameterTask({ template: taskInput, allowedOrigins });
        return;
      }
      setParameterTask(null);
      await runPageAgent(taskInput, allowedOrigins);
    } catch (failure) { notify.error(formatError(locale, failure)); }
  }

  // Runs one natural-language task against the current page's indexed DOM.
  async function runPageAgent(taskInput: string, allowedOrigins: string[]): Promise<void> {
    const task = taskInput.trim();
    if (!task) {
      notify.error(t(locale, "pageTaskRequired"));
      return;
    }

    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let executionRecord: PageAgentExecutionRecord | undefined;

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
        ...(allowedOrigins.length ? { allowedOrigins } : {}),
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
      setPageAgentRun(undefined);
      notify.error(message);
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
          notify.error(formatError(locale, historyError));
        } finally {
          setHistoryMutationPending(false);
        }
      }
    }
  }

  // Removes one confirmed page-task record from local extension storage.
  async function handleDeleteExecutionRecord(
    record: PageAgentExecutionRecord,
  ): Promise<void> {
    if (!window.confirm(t(locale, "confirmDeleteExecutionRecord"))) return;
    const nextHistory = executionHistory.filter(
      (item) => item.id !== record.id,
    );

    setHistoryMutationPending(true);
    try {
      await savePageAgentHistory(nextHistory);
      setExecutionHistory(nextHistory);
      notify.success(t(locale, "executionRecordDeleted"));
    } catch (historyError) {
      notify.error(formatError(locale, historyError));
    } finally {
      setHistoryMutationPending(false);
    }
  }

  // Clears all page-task records after one explicit confirmation.
  async function handleClearExecutionHistory(): Promise<void> {
    if (!window.confirm(t(locale, "confirmClearExecutionHistory"))) return;

    setHistoryMutationPending(true);
    try {
      await savePageAgentHistory([]);
      setExecutionHistory([]);
      notify.success(t(locale, "executionHistoryCleared"));
    } catch (historyError) {
      notify.error(formatError(locale, historyError));
    } finally {
      setHistoryMutationPending(false);
    }
  }

  // Copies the current model result as plain Markdown source text.
  async function handleCopyResult(): Promise<void> {
    if (!result) return;

    try {
      await copyText(result.content);
      notify.success(t(locale, "copied"));
    } catch (clipboardError) {
      notify.error(formatError(locale, clipboardError));
    }
  }

  function continueResult(): void {
    if (!result || pending) return;
    setChatTurns((turns) => [...turns, { id: crypto.randomUUID(), prompt: t(locale, getActionLabelKey(result.action)), answer: result.content, snapshot: { type: "none" }, includeHistory: false, status: "complete" }]);
    setChatContext("none");
    setEditingTurnIndex(null);
    setCustomPrompt("");
    setMainTab("chat");
    customPromptInputRef.current?.focus();
  }

  async function openSettings(): Promise<void> {
    try {
      await sendBackgroundRequest<null>({ target: "background", type: "open-settings" });
    } catch (failure) {
      const error = formatError(locale, failure);
      if (!settings) setInitializationError(error);
      notify.error(error);
    }
  }

  // Changes only this page's panel state after the page has been activated.
  function handlePanelOpenChange(open: boolean): void {
    if (!open && pending) return;
    setPanelOpen(open);
  }

  const panelVisible = panelOpen && !pageState.selecting;

  if (!settings) {
    return (
      <>
        <Toaster closeLabel={t(locale, "close")} />
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
            className="hp-panel hp-panel-drag-handle pointer-events-auto fixed right-4 bottom-4 flex min-h-24 max-h-[calc(100dvh-32px)] w-[min(420px,calc(100vw-32px))] items-center justify-center rounded-md border bg-background p-3 text-muted-foreground"
            onPointerDown={handlePanelPointerDown}
            onPointerMove={handlePanelPointerMove}
            onPointerUp={handlePanelPointerEnd}
            onPointerCancel={handlePanelPointerEnd}
          >
            {initializationError ? (
              <div className="flex w-full flex-col gap-3 overflow-y-auto">
                <Button onClick={openSettings}>
                  <Settings data-icon="inline-start" />
                  {t(locale, "openSettings")}
                </Button>
              </div>
            ) : (
              <Spinner className="size-5" />
            )}
          </div>
        )}
      </>
    );
  }

  const hasText = Boolean(selection?.text);
  const visual = selection ? isVisualSelection(selection) : false;
  const canUseTextAi = Boolean(
    selection && (hasText || (visual && supportsVision)),
  );
  const canUseVision = Boolean(selection && supportsVision);
  const canAnalyzeImage = Boolean(
    selection?.kind === "image" && supportsVision,
  );
  const selectionContent = selection
    ? selection.text || selection.accessibleName
    : "";
  const pageReady = settings.enabled && !pageError;
  const actionsDisabled = Boolean(
    pending ||
      workflowMutationPending ||
      historyMutationPending ||
      !hasProvider ||
      !pageReady,
  );
  const toolPromptDisabled = actionsDisabled || Boolean(selection && !canUseTextAi);
  const resultPending = pending?.action === "chat" || pending?.action === "translate-page" ? undefined : pending;
  const feedbackAction = resultPending?.action ?? result?.action;
  const feedbackTab = feedbackAction === "write"
    ? "writing"
    : feedbackAction === "operate-page" || pageAgentRun
      ? "operate"
      : "tools";
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
        <Toaster closeLabel={t(locale, "close")} />
        <div
          id="hyperpage-tool-panel"
          ref={panelRef}
          hidden={!panelVisible}
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
          className={cn("hp-panel pointer-events-auto fixed right-4 bottom-4 flex flex-col overflow-hidden rounded-md border bg-background text-foreground", !panelVisible && "hidden")}
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
              <img src={browser.runtime.getURL("/icon/32.png")} alt="" className="size-7" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">HyperPage AI</span>

              <IconTooltip label={t(locale, "settings")}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t(locale, "settings")}
                    disabled={Boolean(pending)}
                    onClick={openSettings}
                  >
                    <Settings />
                  </Button>
              </IconTooltip>

              <IconTooltip label={t(locale, "closePanel")}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t(locale, "closePanel")}
                  disabled={Boolean(pending)}
                  onClick={() => handlePanelOpenChange(false)}
                >
                  <X />
                </Button>
              </IconTooltip>
            </div>
          </header>

          {!settings.enabled || !hasProvider ? (
            <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Settings /></EmptyMedia>
                  <EmptyTitle>{t(locale, settings.enabled ? "setupRequired" : "extensionOff")}</EmptyTitle>
                </EmptyHeader>
                <Button onClick={openSettings}>
                  <Settings data-icon="inline-start" />
                  {t(locale, "openSettings")}
                </Button>
              </Empty>
            </main>
          ) : (
            <main className="hp-view-enter flex min-h-0 flex-1 flex-col">
              <Tabs
                value={mainTab}
                onValueChange={(value) => {
                  setMainTab(value);
                  if (value === "documents") setDocumentsOpened(true);
                }}
                className="min-h-0 flex-1 gap-0 overflow-hidden"
              >
                <div
                  className="shrink-0 border-b bg-background p-2"
                  data-main-navigation
                >
                  <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="chat">{t(locale, "navChat")}</TabsTrigger>
                    <TabsTrigger value="documents">{t(locale, "navDocuments")}</TabsTrigger>
                    <TabsTrigger value="writing">{t(locale, "navWriting")}</TabsTrigger>
                    <TabsTrigger value="tools">{t(locale, "navTools")}</TabsTrigger>
                    <TabsTrigger value="operate">{t(locale, "navTasks")}</TabsTrigger>
                  </TabsList>
                </div>

                  <TabsContent value="documents" keepMounted className="min-h-0 data-[hidden]:hidden">
                    {documentsOpened && <iframe
                      title={t(locale, "documents")}
                      src={browser.runtime.getURL("/documents.html")}
                      className="h-full w-full border-0"
                      allow="clipboard-write"
                    />}
                  </TabsContent>

                <div
                  className={cn("min-h-0 flex-1", mainTab === "chat" ? "flex flex-col overflow-hidden" : "grid auto-rows-max content-start gap-3 overflow-y-auto p-3 pb-6", mainTab === "documents" && "hidden")}
                  data-panel-scroll-region
                >
                  {(mainTab === "tools" || mainTab === "writing") && (
                    <section className="flex flex-col gap-3 border-b pb-3" data-selected-element-summary>
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-medium">{t(locale, "selectedElement")}</h2>
                        <div className="flex items-center gap-1">
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
                        </div>
                      </div>

                      <div>
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
                      </div>

                      <div className="flex gap-2">
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
                                void runPageCommand({
                                  type: "cancel-selection",
                                })
                              }
                            >
                              <X />
                            </Button>
                          </IconTooltip>
                        </ButtonGroup>
                      </div>
                    </section>
                  )}

                  <TabsContent value="writing" keepMounted className="min-w-0 data-[hidden]:hidden">
                    <WritingTools locale={locale} disabled={actionsDisabled} hasSource={hasText} running={pending?.action === "write"} onStop={() => void handleCancelRequest()} onRun={(options) => void runAi({ action: "write", options })} />
                  </TabsContent>
                  <TabsContent value="tools" keepMounted className="flex flex-col gap-4 data-[hidden]:hidden">
                    <FieldGroup>
                      <Field data-disabled={actionsDisabled}>
                        <FieldLabel htmlFor="tool-prompt">{t(locale, "custom")}</FieldLabel>
                          <AiComposer
                            id="tool-prompt"
                            locale={locale}
                            value={toolPrompt}
                            disabled={actionsDisabled}
                            running={pending?.action === "custom"}
                            onStop={() => void handleCancelRequest()}
                            canSubmit={!toolPromptDisabled && Boolean(toolPrompt.trim())}
                            onSubmit={handleToolPromptSubmit}
                            placeholder={t(locale, selection ? "customPrompt" : "customGeneralPrompt")}
                            onChange={(event) => setToolPrompt(event.target.value)}
                          />
                      </Field>
                    </FieldGroup>
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

                    <section className="flex flex-col gap-2" aria-labelledby="visual-tools-heading">
                      <h2 id="visual-tools-heading" className="text-xs font-medium text-muted-foreground">{t(locale, "visualTools")}</h2>
                      <div className="grid grid-cols-2 gap-2">
                        <AiActionButton icon={ScanText} label={t(locale, "ocr")} disabled={actionsDisabled || !canUseVision || !visual} onClick={() => void runAi({ action: "ocr" })} />
                        <AiActionButton icon={Image} label={t(locale, "imagePrompt")} disabled={actionsDisabled || !canAnalyzeImage} onClick={() => void runAi({ action: "image-prompt" })} />
                      </div>
                    </section>
                    <Collapsible className="flex flex-col gap-2 border-t pt-3">
                      <CollapsibleTrigger render={<Button variant="ghost" className="justify-start" />}><Languages data-icon="inline-start" />{t(locale, "translationWorkspace")}<ChevronDown data-icon="inline-end" className="ml-auto" /></CollapsibleTrigger>
                      <CollapsibleContent className="flex flex-col gap-3">
                        <ReadingContext locale={locale} snapshot={readingSnapshot} selectedIds={readingBlockIds} loading={readingLoading} disabled={Boolean(pending)} onRead={() => void handleReadPage()} onSelect={setReadingBlockIds} onPrompt={(prompt) => { setChatContext("page"); setCustomPrompt(prompt); setMainTab("chat"); setAttachmentExpanded(true); }} />
                        <PageTranslationTools locale={locale} source={selectedReadingSnapshot} targetLanguage={getTaskProvider(settings, "text")?.targetLanguage ?? ""} preview={translationPreview} mode={translationMode} disabled={Boolean(pending) || readingLoading} running={pending?.action === "translate-page"} onRun={(language, terms) => void handleTranslatePage(language, terms)} onCommand={(command) => void handleTranslationCommand(command)} onCancel={() => void handleCancelRequest()} onError={notify.error} />
                      </CollapsibleContent>
                    </Collapsible>
                  </TabsContent>
                  <TabsContent value="chat" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
                    <section
                      className="flex min-h-0 flex-1 flex-col"
                      aria-labelledby="custom-task-heading"
                    >
                      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
                        <h2
                          id="custom-task-heading"
                          className="min-w-0 flex-1 truncate text-sm font-medium"
                        >
                          {conversationLibraryOpen ? t(locale, "savedConversations") : savedConversation?.name ?? t(locale, "navChat")}
                        </h2>
                        <div className="ml-auto flex flex-wrap items-center gap-1">
                          {chatTurns.length > 0 && <TextExport locale={locale} filename="hyperpage-conversation" disabled={Boolean(pending)} content={() => conversationToMarkdown(chatTurns, { user: t(locale, "userMessage"), assistant: t(locale, "assistant"), incomplete: t(locale, "generationIncomplete") })} />}
                          <Button size="sm" variant="ghost" aria-expanded={conversationLibraryOpen} disabled={Boolean(pending)} onClick={() => setConversationLibraryOpen((open) => !open)}>{conversationLibraryOpen ? <ArrowLeft data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" />}{t(locale, conversationLibraryOpen ? "backToConversation" : "conversationHistory")}</Button>
                          <IconTooltip label={t(locale, "newConversation")}>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={t(locale, "newConversation")}
                              disabled={Boolean(pending) || readingLoading}
                              onClick={handleClearChat}
                            >
                              <Plus />
                            </Button>
                          </IconTooltip>
                        </div>
                      </div>

                      {conversationLibraryOpen ? <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><ConversationLibrary locale={locale} turns={chatTurns} current={savedConversation} disabled={Boolean(pending) || readingLoading} onLoad={handleLoadConversation} onSaved={setSavedConversation} /></div> : <>

                      {chatMessages.length > 0 ? (
                        <MessageScrollerProvider autoScroll>
                          <MessageScroller className="min-h-0 flex-1">
                            <MessageScrollerViewport
                              aria-label={t(locale, "conversation")}
                            >
                              <MessageScrollerContent className="gap-3 p-3">
                                {chatMessages.map((message) => (
                                  <MessageScrollerItem
                                    key={message.id}
                                    messageId={message.id}
                                    scrollAnchor={
                                      message.role === "assistant" &&
                                      message.status === "streaming"
                                    }
                                  >
                                    <Message
                                      align={
                                        message.role === "user"
                                          ? "end"
                                          : "start"
                                      }
                                    >
                                      <MessageContent>
                                        <MessageHeader>
                                          {t(locale, message.role === "user" ? "userMessage" : "assistant")}
                                          {message.role === "user" && message.context !== "none" && <Badge variant="outline">{t(locale, message.context === "image" ? "resourceKind_image" : message.context === "file" ? "fileContext" : message.context === "elements" ? "multipleElementsContext" : message.context === "page" ? "currentPageContext" : "selectedElementContext")}</Badge>}
                                        </MessageHeader>
                                        <Bubble
                                          align={
                                            message.role === "user"
                                              ? "end"
                                              : "start"
                                          }
                                          variant={
                                            message.role === "user"
                                              ? "secondary"
                                              : "ghost"
                                          }
                                        >
                                          <BubbleContent
                                            aria-live={
                                              message.status === "streaming"
                                                ? "polite"
                                                : undefined
                                            }
                                            className={cn(
                                              message.role === "user" &&
                                                "whitespace-pre-wrap",
                                              message.role === "assistant" &&
                                                "hp-markdown",
                                            )}
                                          >
                                            {message.role === "assistant" ? (
                                              message.content ? (
                                                <ReadingAnswer content={message.content} citations={message.citations ?? []} locale={locale} onLocate={handleLocateCitation} onCopy={(text) => void handleCopyChatMessage(text)} />
                                              ) : message.status ===
                                                "streaming" ? (
                                                <Spinner
                                                  aria-label={t(
                                                    locale,
                                                    "processing",
                                                  )}
                                                />
                                              ) : (
                                                t(
                                                  locale,
                                                  message.status === "cancelled"
                                                    ? "generationStopped"
                                                    : "generationFailed",
                                                )
                                              )
                                            ) : (
                                              message.content
                                            )}
                                          </BubbleContent>
                                        </Bubble>
                                        {message.role === "user" && <MessageFooter>
                                          <IconTooltip label={t(locale, "editMessage")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "editMessage")} disabled={Boolean(pending) || readingLoading} onClick={() => handleEditTurn(message.turnIndex)}><Pencil /></Button></IconTooltip>
                                        </MessageFooter>}
                                        {message.role === "assistant" &&
                                          message.status !== "streaming" && (
                                            <MessageFooter className="flex-wrap gap-1">
                                              <IconTooltip label={t(locale, "regenerateResponse")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "regenerateResponse")} disabled={Boolean(pending) || readingLoading} onClick={() => {
                                                const turn = chatTurns[message.turnIndex];
                                                if (turn) void sendConversationTurn(turn.prompt, turn.snapshot, turn.webSearch === true, message.turnIndex, true);
                                              }}><RefreshCw /></Button></IconTooltip>
                                              {message.content && <TextExport content={() => answerToMarkdown(message.content, message.citations ?? [])} filename="hyperpage-answer" locale={locale} disabled={Boolean(pending)} />}
                                              {message.content && <ResultActions text={message.content} locale={locale} state={pageState} disabled={Boolean(pending)} onState={applyPageState} onError={notify.error} />}
                                              {message.status !== "complete" &&
                                                message.content && (
                                                  <span>
                                                    {t(
                                                      locale,
                                                      message.status ===
                                                        "cancelled"
                                                        ? "generationStopped"
                                                        : "generationFailed",
                                                    )}
                                                  </span>
                                                )}
                                              {message.content && (
                                                <IconTooltip
                                                  label={t(
                                                    locale,
                                                    "copyResponse",
                                                  )}
                                                >
                                                  <Button
                                                    size="icon-xs"
                                                    variant="ghost"
                                                    aria-label={t(
                                                      locale,
                                                      "copyResponse",
                                                    )}
                                                    onClick={() =>
                                                      void handleCopyChatMessage(
                                                        answerToMarkdown(message.content, message.citations ?? []),
                                                      )
                                                    }
                                                  >
                                                    <Copy />
                                                  </Button>
                                                </IconTooltip>
                                              )}
                                            </MessageFooter>
                                          )}
                                      </MessageContent>
                                    </Message>
                                  </MessageScrollerItem>
                                ))}
                              </MessageScrollerContent>
                            </MessageScrollerViewport>
                            <MessageScrollerButton
                              aria-label={t(locale, "scrollToLatest")}
                            />
                          </MessageScroller>
                        </MessageScrollerProvider>
                      ) : <Empty className="min-h-0 flex-1"><EmptyHeader><EmptyMedia variant="icon"><MessageSquareText /></EmptyMedia><EmptyTitle>{t(locale, "newConversation")}</EmptyTitle></EmptyHeader></Empty>}

                      <div className="flex max-h-[60%] shrink-0 flex-col gap-2 overflow-y-auto border-t bg-background p-3" data-chat-composer>
                      <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="hidden" aria-label={t(locale, "chooseTextFile")} disabled={Boolean(pending) || readingLoading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleTextFile(file); }} />

                      {editingTurnIndex !== null ? (
                        <div className="flex min-w-0 flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{t(locale, "editingMessage")}</span>
                            <IconTooltip label={t(locale, "cancelEditingMessage")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "cancelEditingMessage")} onClick={() => { setEditingTurnIndex(null); setCustomPrompt(""); }}><X /></Button></IconTooltip>
                          </div>
                          {chatTurns[editingTurnIndex]?.snapshot.type === "page" && <div className="text-xs text-muted-foreground">{t(locale, "currentPageContext")}</div>}
                          <details className="text-xs break-words"><summary>{t(locale, "originalContext")}</summary>{(() => {
                            const snapshot = chatTurns[editingTurnIndex]?.snapshot;
                            return snapshot && <SnapshotPreview key={editingTurnIndex} snapshot={snapshot} locale={locale} />;
                          })()}</details>
                        </div>
                      ) : chatContext !== "none" && <Collapsible open={attachmentExpanded} onOpenChange={setAttachmentExpanded} className="flex flex-col gap-2">
                        <Attachment>
                          <AttachmentMedia>{readingLoading ? <Spinner /> : chatContext === "video" ? <Captions /> : chatContext === "elements" ? <MousePointer2 /> : <FileText />}</AttachmentMedia>
                          <AttachmentContent><AttachmentTitle>{chatContext === "file" ? fileSnapshot?.name ?? t(locale, "fileContext") : chatContext === "page" ? readingSnapshot?.title ?? t(locale, "currentPageContext") : chatContext === "video" ? videoSnapshot?.title ?? t(locale, "videoContext") : `${t(locale, "attachedPageContent")} (${contextElements.length})`}</AttachmentTitle></AttachmentContent>
                          <IconTooltip label={t(locale, "previewAttachment")}><CollapsibleTrigger render={<Button size="icon-xs" variant="ghost" aria-label={t(locale, "previewAttachment")} />}><ChevronDown /></CollapsibleTrigger></IconTooltip>
                          <IconTooltip label={t(locale, "removeAttachment")}><Button size="icon-xs" variant="ghost" aria-label={t(locale, "removeAttachment")} disabled={Boolean(pending) || readingLoading} onClick={() => setChatContext("none")}><X /></Button></IconTooltip>
                        </Attachment>
                        <CollapsibleContent className="flex max-h-56 flex-col gap-3 overflow-y-auto">
                        {chatContext === "page" && <ReadingContext locale={locale} snapshot={readingSnapshot} selectedIds={readingBlockIds} loading={readingLoading} disabled={Boolean(pending)} onRead={() => void handleReadPage()} onSelect={setReadingBlockIds} onPrompt={(prompt) => void handleChatSubmit(prompt)} />}
                        {chatContext === "video" && <ReadingContext locale={locale} sourceType="video" snapshot={videoSnapshot} selectedIds={videoBlockIds} loading={readingLoading} disabled={Boolean(pending)} onRead={() => void handleReadVideo()} onSelect={setVideoBlockIds} />}
                        {chatContext === "elements" && <ElementsContext locale={locale} pages={contextElements} disabled={Boolean(pending)} loading={readingLoading} onAdd={() => void handleSelectContextElement()} onRemove={(id) => { const remaining = contextElements.filter((page) => page.id !== id); setContextElements(remaining); if (!remaining.length) setChatContext("none"); }} onClear={() => { setContextElements([]); setChatContext("none"); }} />}
                        {chatContext === "file" && <>
                          <ReadingContext locale={locale} sourceType="file" snapshot={fileSnapshot} selectedIds={fileBlockIds} loading={readingLoading} disabled={Boolean(pending)} onRead={() => fileInputRef.current?.click()} onSelect={setFileBlockIds} onPrompt={(prompt) => void handleChatSubmit(prompt)} onClear={() => { setFileSnapshot(null); setFileBlockIds([]); }} />
                        </>}
                        </CollapsibleContent>
                      </Collapsible>}

                      {templatesOpen && <div className="max-h-56 overflow-y-auto"><PromptTemplates locale={locale} disabled={actionsDisabled || readingLoading} onUse={(prompt) => { setCustomPrompt(prompt); setTemplatesOpen(false); customPromptInputRef.current?.focus(); }} /></div>}
                      <Field data-disabled={actionsDisabled}>
                        <FieldLabel htmlFor="custom-prompt" className="sr-only">
                          {t(locale, "custom")}
                        </FieldLabel>
                          <AiComposer
                            id="custom-prompt"
                            locale={locale}
                            ref={customPromptInputRef}
                            value={customPrompt}
                            disabled={actionsDisabled}
                            running={pending?.action === "chat"}
                            onStop={() => void handleCancelRequest()}
                            canSubmit={!(
                              readingLoading ||
                              (editingTurnIndex === null && chatContext === "page" && (!readingSnapshot || !readingBlockIds.length)) ||
                              (editingTurnIndex === null && chatContext === "video" && (!videoSnapshot || !videoBlockIds.length)) ||
                              (editingTurnIndex === null && chatContext === "elements" && !contextElements.length) ||
                              (editingTurnIndex === null && chatContext === "file" && (!fileSnapshot || !fileBlockIds.length)) ||
                              !customPrompt.trim()
                            )}
                            onSubmit={() => void handleChatSubmit()}
                            placeholder={t(locale, "customGeneralPrompt")}
                            onChange={(event) =>
                              setCustomPrompt(event.target.value)
                            }
                            toolbar={<>
                            <DropdownMenu>
                              <IconTooltip label={t(locale, "addAttachment")}><DropdownMenuTrigger render={<InputGroupButton size="icon-sm" aria-label={t(locale, "addAttachment")} disabled={actionsDisabled || readingLoading || editingTurnIndex !== null} />}><Paperclip /></DropdownMenuTrigger></IconTooltip>
                              <DropdownMenuContent side="top">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem onClick={() => { setChatContext("page"); setAttachmentExpanded(true); void handleReadPage(); }}><FileText />{t(locale, "currentPageContext")}</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => void handleSelectContextElement()}><MousePointer2 />{t(locale, "selectPageContent")}</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}><Upload />{t(locale, "fileContext")}</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setChatContext("video"); setAttachmentExpanded(true); void handleReadVideo(); }}><Captions />{t(locale, "videoContext")}</DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <IconTooltip label={t(locale, "promptTemplates")}><InputGroupButton size="icon-sm" aria-label={t(locale, "promptTemplates")} aria-expanded={templatesOpen} disabled={actionsDisabled} onClick={() => setTemplatesOpen(!templatesOpen)}><Sparkles /></InputGroupButton></IconTooltip>
                            {!chatTurns.some((turn) => turn.snapshot.type === "image") && <WebSearchToggle locale={locale} capability={webSearchCapability} checked={editingTurnIndex === null ? webSearch : chatTurns[editingTurnIndex]?.webSearch === true} disabled={actionsDisabled || editingTurnIndex !== null} onChange={setWebSearch} />}
                            </>}
                          />
                      </Field>
                      </div>
                      </>}
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
                          <FieldLabel htmlFor="page-task">{t(locale, "pageTask")}</FieldLabel>
                          <AiComposer
                            id="page-task"
                            locale={locale}
                            ref={pageTaskInputRef}
                            className="leading-5"
                            value={pageTask}
                            disabled={actionsDisabled}
                            running={pending?.action === "operate-page"}
                            onStop={() => void handleCancelRequest()}
                            stopLabel={t(locale, "stopPageTask")}
                            canSubmit={Boolean(pageTask.trim()) && parameterTask === null}
                            submitLabel={t(locale, "startPageTask")}
                            submitIcon={Play}
                            onSubmit={() => void preparePageTask(pageTask, taskSites)}
                            placeholder={t(locale, "pageTaskPlaceholder")}
                            onChange={(event) => {
                              setPageTask(event.target.value);
                              setParameterTask(null);
                            }}
                            onScroll={(event) => {
                              const highlight = pageTaskHighlightRef.current;
                              if (!highlight) return;
                              highlight.scrollTop = event.currentTarget.scrollTop;
                              highlight.scrollLeft = event.currentTarget.scrollLeft;
                            }}
                            toolbar={<>
                              <IconTooltip label={t(locale, "insertPageTaskElement")}>
                                <InputGroupButton size="icon-sm" aria-label={t(locale, "insertPageTaskElement")} disabled={actionsDisabled || pageState.selecting} onClick={() => void handlePageTaskElementSelection()}>
                                  <MousePointer2 />
                                </InputGroupButton>
                              </IconTooltip>
                              {!workflowEditor && (
                                <IconTooltip label={t(locale, "saveWorkflow")}>
                                  <InputGroupButton
                                    size="icon-sm"
                                    aria-label={t(locale, "saveWorkflow")}
                                    disabled={Boolean(pending) || workflowMutationPending || !pageTask.trim()}
                                    onClick={() => setWorkflowEditor({ mode: "create", name: "" })}
                                  >
                                    <BookmarkPlus />
                                  </InputGroupButton>
                                </IconTooltip>
                              )}
                            </>}
                            overlay={<div
                                ref={pageTaskHighlightRef}
                                className="pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-2 text-base leading-5 whitespace-pre-wrap text-transparent break-words select-none md:text-sm"
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
                              </div>}
                          />
                        </Field>

                        {workflowEditor && (
                          <FieldGroup>
                            <Field data-disabled={Boolean(pending) || workflowMutationPending}>
                              <FieldLabel htmlFor="workflow-name">{t(locale, "workflowName")}</FieldLabel>
                              <InputGroup>
                                <InputGroupInput
                                  id="workflow-name"
                                  autoFocus
                                  value={workflowEditor.name}
                                  disabled={Boolean(pending) || workflowMutationPending}
                                  placeholder={t(locale, "workflowNamePlaceholder")}
                                  onChange={(event) => setWorkflowEditor({ ...workflowEditor, name: event.target.value })}
                                  onKeyDown={(event) => {
                                    if (event.nativeEvent.isComposing) return;
                                    if (event.key === "Escape") setWorkflowEditor(undefined);
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void handleSaveWorkflow();
                                    }
                                  }}
                                />
                                <InputGroupAddon align="inline-end">
                                  <IconTooltip label={t(locale, "cancelWorkflowEdit")}>
                                    <InputGroupButton
                                      size="icon-xs"
                                      aria-label={t(locale, "cancelWorkflowEdit")}
                                      disabled={Boolean(pending) || workflowMutationPending}
                                      onClick={() => setWorkflowEditor(undefined)}
                                    >
                                      <X />
                                    </InputGroupButton>
                                  </IconTooltip>
                                  <IconTooltip label={t(locale, workflowEditor.mode === "create" ? "saveWorkflow" : "saveWorkflowChanges")}>
                                    <InputGroupButton
                                      size="icon-xs"
                                      aria-label={t(locale, workflowEditor.mode === "create" ? "saveWorkflow" : "saveWorkflowChanges")}
                                      disabled={Boolean(pending) || workflowMutationPending || !workflowEditor.name.trim() || !pageTask.trim()}
                                      onClick={() => void handleSaveWorkflow()}
                                    >
                                      {workflowMutationPending ? <Spinner /> : <Check />}
                                    </InputGroupButton>
                                  </IconTooltip>
                                </InputGroupAddon>
                              </InputGroup>
                            </Field>
                          </FieldGroup>
                        )}

                        <Collapsible className="flex flex-col gap-2">
                          <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="justify-start" />}>
                            {t(locale, "allowedSites")}
                            <ChevronDown data-icon="inline-end" className="ml-auto" />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <Field data-disabled={actionsDisabled}>
                              <FieldLabel htmlFor="task-sites" className="sr-only">{t(locale, "allowedSites")}</FieldLabel>
                              <InputGroup>
                                <InputGroupTextarea id="task-sites" value={taskSites} disabled={actionsDisabled} placeholder={t(locale, "allSites")} onChange={(event) => { setTaskSites(event.target.value); setParameterTask(null); }} />
                              </InputGroup>
                            </Field>
                          </CollapsibleContent>
                        </Collapsible>
                        {parameterTask && <TemplateParameters action="run" key={parameterTask.template} template={parameterTask.template} locale={locale} onCancel={() => setParameterTask(null)} onRun={(task) => {
                          const origins = parameterTask.allowedOrigins;
                          setParameterTask(null);
                          setPageTask(task);
                          void runPageAgent(task, origins);
                        }} />}

                        <section className="flex min-w-0 flex-col gap-2" aria-labelledby="saved-workflows-heading">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <h2 id="saved-workflows-heading" className="text-sm font-medium">{t(locale, "savedWorkflows")}</h2>
                              <Badge variant="outline">{workflows.length}</Badge>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <input
                                ref={workflowImportRef}
                                type="file"
                                accept=".json,application/json"
                                className="hidden"
                                aria-label={t(locale, "importWorkflows")}
                                disabled={Boolean(pending) || workflowMutationPending}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = "";
                                  if (file) void handleImportWorkflows(file);
                                }}
                              />
                              <IconTooltip label={t(locale, "importWorkflows")}>
                                <Button size="icon-xs" variant="ghost" aria-label={t(locale, "importWorkflows")} disabled={Boolean(pending) || workflowMutationPending} onClick={() => workflowImportRef.current?.click()}>
                                  <Upload />
                                </Button>
                              </IconTooltip>
                              <IconTooltip label={t(locale, "exportWorkflows")}>
                                <Button size="icon-xs" variant="ghost" aria-label={t(locale, "exportWorkflows")} disabled={workflowMutationPending || !workflows.length} onClick={handleExportWorkflows}>
                                  <Download />
                                </Button>
                              </IconTooltip>
                            </div>
                          </div>
                          {workflows.length === 0 ? (
                            <Empty className="min-h-16 p-3">
                              <EmptyHeader>
                                <EmptyMedia variant="icon"><BookmarkPlus /></EmptyMedia>
                                <EmptyTitle>{t(locale, "noSavedWorkflows")}</EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <div className="flex min-w-0 flex-col divide-y">
                              {workflows.map((workflow) => (
                                <div key={workflow.id} className="flex min-w-0 items-start gap-2 py-2.5">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium wrap-anywhere">{workflow.name}</p>
                                    <p className="line-clamp-2 text-xs leading-5 text-muted-foreground wrap-anywhere" title={workflow.task}>{workflow.task}</p>
                                    {workflow.allowedOrigins.length > 0 && (
                                      <p className="text-xs text-muted-foreground wrap-anywhere">{workflow.allowedOrigins.join(", ")}</p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-0.5">
                                    <IconTooltip label={`${t(locale, "runWorkflow")}: ${workflow.name}`}>
                                      <Button size="icon-xs" variant="ghost" aria-label={`${t(locale, "runWorkflow")}: ${workflow.name}`} disabled={actionsDisabled} onClick={() => handleRunWorkflow(workflow)}>
                                        <Play />
                                      </Button>
                                    </IconTooltip>
                                    <IconTooltip label={`${t(locale, "editWorkflow")}: ${workflow.name}`}>
                                      <Button size="icon-xs" variant="ghost" aria-label={`${t(locale, "editWorkflow")}: ${workflow.name}`} disabled={Boolean(pending) || workflowMutationPending} onClick={() => handleEditWorkflow(workflow)}>
                                        <Pencil />
                                      </Button>
                                    </IconTooltip>
                                    <IconTooltip label={`${t(locale, "deleteWorkflow")}: ${workflow.name}`}>
                                      <Button size="icon-xs" variant="ghost" aria-label={`${t(locale, "deleteWorkflow")}: ${workflow.name}`} disabled={Boolean(pending) || workflowMutationPending} onClick={() => void handleDeleteWorkflow(workflow)}>
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

                  {mainTab === feedbackTab && (resultPending ||
                    result ||
                    pageAgentRun) && (
                    <section
                      className="flex flex-col gap-2"
                      data-execution-feedback
                      aria-label={t(locale, "result")}
                    >
                      {(resultPending || result || pageAgentRun) && (
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
                              {resultPending ? (
                                resultPending.action === "operate-page" ? (
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
                                {resultPending
                                  ? t(
                                      locale,
                                      getActionLabelKey(resultPending.action),
                                    )
                                  : result
                                    ? t(locale, "result")
                                    : t(locale, "operatePage")}
                              </span>
                            </CardTitle>
                            <CardAction className="flex items-center gap-1">
                              {resultPending ? (
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
                                    <IconTooltip
                                      label={t(locale, "copyResult")}
                                    >
                                      <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        aria-label={t(locale, "copyResult")}
                                        onClick={() => void handleCopyResult()}
                                      >
                                        <Clipboard />
                                      </Button>
                                    </IconTooltip>
                                    <IconTooltip
                                      label={t(locale, "closeResult")}
                                    >
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
                            {result && <div className="mb-2 flex justify-end"><TextExport content={result.content} filename="hyperpage-result" locale={locale} disabled={Boolean(pending)} /></div>}
                            {resultPending &&
                            resultPending.action !== "operate-page" ? (
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

                          {result && <CardFooter className="flex-col items-stretch gap-2"><ResultActions text={result.content} locale={locale} state={pageState} disabled={Boolean(pending)} onState={applyPageState} onError={notify.error} /><Button variant="outline" size="sm" disabled={Boolean(pending)} onClick={continueResult}><MessageCircleQuestion data-icon="inline-start" />{t(locale, "continueResult")}</Button></CardFooter>}
                        </Card>
                      )}

                    </section>
                  )}
                </div>
              </Tabs>
            </main>
          )}
        </div>
    </>
  );
}

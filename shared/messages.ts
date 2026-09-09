import type { WritingOptions } from "./writing";

export type Locale = "zh_CN" | "en";

export type ResultDisplayMode = "floating" | "inline";

export type ElementKind =
  | "text"
  | "image"
  | "video"
  | "canvas"
  | "editable"
  | "element";

export type AiAction =
  | "translate"
  | "explain"
  | "summarize"
  | "ocr"
  | "image-prompt"
  | "polish"
  | "write"
  | "custom";

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionSnapshot {
  kind: ElementKind;
  tagName: string;
  text: string;
  accessibleName: string;
  role: string;
  editable: boolean;
  rect: ViewportRect;
  viewport: {
    width: number;
    height: number;
  };
}

export interface PageState {
  selection: SelectionSnapshot | null;
  selectionRevision: number;
  canUndoReplace: boolean;
  canRemoveInsertion: boolean;
  selecting: boolean;
}

export type PageStateCommand =
  | { type: "start-selection" }
  | { type: "start-page-task-selection" }
  | { type: "add-selection-to-page-task" }
  | { type: "select-parent" }
  | { type: "cancel-selection" }
  | { type: "get-page-state" }
  | { type: "undo-replace" }
  | { type: "insert-result"; text: string }
  | { type: "remove-insertion" }
  | { type: "suspend-overlay" }
  | { type: "restore-overlay" }
  | { type: "check-capture-area"; rect: ViewportRect; viewport: { width: number; height: number } };

export type PageCommand = PageStateCommand;

export type PageCommandResult = PageState;

export interface EditablePreview {
  id: string;
  mode: "replace" | "insert";
  before: string;
  after: string;
}

export type PageEditingCommand =
  | { type: "prepare-edit"; mode: "replace" | "insert"; text: string; selectionRevision: number }
  | { type: "apply-edit"; previewId: string }
  | { type: "cancel-edit"; previewId: string };

export interface PageEditingResults {
  "prepare-edit": EditablePreview;
  "apply-edit": PageState;
  "cancel-edit": null;
}

export interface EditingContentRequest {
  target: "editing-content";
  command: PageEditingCommand;
}

export type ProviderProtocol = "chat-completions" | "responses" | "anthropic" | "gemini";

export interface ProviderCredentials {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
}

export interface ProviderConfig extends ProviderCredentials {
  model: string;
  capabilities: ModelCapabilities;
  targetLanguage: string;
}

export type ModelCapability = "text" | "streaming" | "vision" | "tools" | "webSearch";

export type CapabilityResult =
  | { status: "unknown" }
  | { status: "supported"; checkedAt: number | null }
  | { status: "failed"; checkedAt: number; error: string };

export type ModelCapabilities = Record<ModelCapability, CapabilityResult>;
export type ModelTask = "chat" | "text" | "vision" | "automation";

export interface ProviderProfile {
  id: string;
  name: string;
  config: ProviderConfig;
}

export interface StoredSettings {
  version: 8;
  enabled: boolean;
  locale: Locale;
  providers: ProviderProfile[];
  taskModels: Record<ModelTask, string | null>;
  resultDisplayMode: ResultDisplayMode;
  allowMultiTab: boolean;
}

export interface HostAccessState {
  origins: string[];
  providers: Array<{ origin: string; granted: boolean }>;
}

export type RunAiRequest =
  | { action: Exclude<AiAction, "custom" | "write"> }
  | { action: "write"; options: WritingOptions }
  | { action: "custom"; prompt: string };


export type InlineAiRequest =
  | { action: "translate" | "explain" | "ocr" | "image-prompt" }
  | { action: "custom"; prompt: string };

export interface AiExecutionResult {
  content: string;
  selectionRevision: number | null;
}

export type ChatContextMode = "none" | "selection" | "page" | "elements" | "file" | "video";

export interface PageContentBlock {
  id: string;
  text: string;
  heading: string;
  headingLevel: number | null;
  timeSeconds?: number;
}

export interface FileContentBlock extends PageContentBlock {
  pageNumber: number;
}

export interface FileReadingSnapshot {
  id: string;
  name: string;
  format: "text" | "pdf";
  pageCount: number;
  blocks: FileContentBlock[];
}

export interface PageReadingSnapshot {
  id: string;
  title: string;
  url: string;
  videoId?: string;
  sourceKind?: "search" | "article";
  blocks: PageContentBlock[];
}

export interface PageReadingSelection {
  snapshotId: string;
  blockIds: string[];
}

export interface PageCitation extends PageContentBlock {
  blockId: string;
  snapshotId: string;
  title: string;
  url: string;
  documentId?: string;
  pageNumber?: number;
}

export type PageReadingCommand =
  | { type: "read-page" }
  | { type: "read-video" }
  | { type: "get-video-selection"; selection: PageReadingSelection }
  | { type: "locate-video-citation"; snapshotId: string; blockId: string }
  | { type: "read-selected-element" }
  | { type: "get-reading-selection"; selection: PageReadingSelection }
  | { type: "locate-citation"; snapshotId: string; blockId: string }
  | { type: "clear-reading" };

export interface PageReadingResults {
  "read-video": PageReadingSnapshot;
  "get-video-selection": PageReadingSnapshot;
  "locate-video-citation": null;
  "read-page": PageReadingSnapshot;
  "read-selected-element": PageReadingSnapshot;
  "get-reading-selection": PageReadingSnapshot;
  "locate-citation": null;
  "clear-reading": null;
}

export interface ReadingContentRequest {
  target: "reading-content";
  command: PageReadingCommand;
}

export type ReadingContentResponse = CommandResult<PageReadingSnapshot | null>;

export interface ChatModelMessage {
  role: "user" | "assistant";
  content: string;
  imageDataUrl?: string;
}

export type ChatContextSnapshot =
  | { type: "none" }
  | { type: "image"; image: { id: string; name: string; dataUrl: string } }
  | { type: "selection"; selection: SelectionSnapshot }
  | { type: "page"; page: PageReadingSnapshot }
  | { type: "elements"; pages: PageReadingSnapshot[] }
  | { type: "file"; file: FileReadingSnapshot };

export interface RunChatRequest {
  history: ChatModelMessage[];
  prompt: string;
  context: ChatContextMode;
  includeHistory: boolean;
  webSearch?: boolean;
  pageSelection?: PageReadingSelection;
  elementSelections?: PageReadingSelection[];
  file?: FileReadingSnapshot;
  selectionRevision?: number;
}

export interface ReplayChatRequest {
  prompt: string;
  snapshot: ChatContextSnapshot;
  includeHistory: boolean;
  webSearch?: boolean;
  history: ChatModelMessage[];
}

export interface ChatExecutionResult {
  content: string;
  userContent: string;
  selectionRevision: number | null;
  citations: PageCitation[];
}

export interface PageAgentExecutionResult {
  content: string;
  success: boolean;
}

export interface SavedPageWorkflow {
  id: string;
  name: string;
  task: string;
  allowedOrigins: string[];
}

export interface StoredPageWorkflows {
  version: 2;
  workflows: SavedPageWorkflow[];
}

export type PageAgentExecutionStatus =
  | "completed"
  | "incomplete"
  | "failed"
  | "cancelled";

export interface PageAgentExecutionStep {
  action: string;
  output: string;
  durationMs: number;
}

export interface PageAgentExecutionRecord {
  id: string;
  task: string;
  startedAt: number;
  finishedAt: number;
  status: PageAgentExecutionStatus;
  result: string;
  steps: PageAgentExecutionStep[];
}

export interface StoredPageAgentHistory {
  version: 1;
  records: PageAgentExecutionRecord[];
}

export type AgentElementMutation =
  | { type: "set-style"; name: string; value: string }
  | { type: "remove-style"; name: string }
  | { type: "set-attribute"; name: string; value: string }
  | { type: "remove-attribute"; name: string }
  | { type: "set-text"; text: string };

export const ALLOWED_ELEMENT_ATTRIBUTES = [
  "title", "alt", "aria-label", "aria-description", "aria-expanded",
  "aria-checked", "aria-hidden", "placeholder",
] as const;

export const ALLOWED_STYLE_PROPERTIES = [
  "color", "background-color", "display", "visibility", "opacity",
  "font-size", "font-weight", "font-family", "font-style", "line-height",
  "text-align", "text-decoration", "white-space", "word-break", "overflow-wrap",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-width", "border-color", "border-style", "border-radius",
  "outline", "outline-width", "outline-color", "outline-style", "outline-offset",
  "box-shadow", "text-shadow", "transform", "transform-origin", "overflow",
  "gap", "row-gap", "column-gap", "align-items", "justify-content", "flex-direction",
] as const;

export type PageAgentAction =
  | { type: "click"; index: number }
  | { type: "input"; index: number; text: string }
  | { type: "select"; index: number; option: string }
  | { type: "modify-element"; index: number; changes: AgentElementMutation[] }
  | { type: "remove-element"; index: number }
  | { type: "ask-user"; question: string }
  | { type: "open-tab"; url: string }
  | { type: "switch-tab"; tabId: number }
  | { type: "close-tab"; tabId: number }
  | {
      type: "scroll";
      direction: "up" | "down";
      pages: number;
      pixels?: number;
      index?: number;
    }
  | {
      type: "scroll-horizontal";
      direction: "left" | "right";
      pixels: number;
      index?: number;
    }
  | { type: "wait"; seconds: number }
  | { type: "complete"; success: boolean; text: string };

export type PageAgentProgress =
  | { phase: "reading"; stepIndex: number }
  | { phase: "planning"; stepIndex: number }
  | {
      phase: "awaiting-user";
      stepIndex: number;
      question: string;
    }
  | {
      phase: "executing";
      stepIndex: number;
      action: PageAgentAction;
    }
  | {
      phase: "action-complete";
      stepIndex: number;
      action: PageAgentAction;
      output: string;
      durationMs: number;
    }
  | {
      phase: "retrying";
      stepIndex: number;
      attempt: number;
      maxAttempts: number;
    }
  | { phase: "failed"; stepIndex: number; message: string };

export interface AgentBrowserState {
  url: string;
  title: string;
  header: string;
  content: string;
  footer: string;
}

export interface AgentActionResult {
  success: boolean;
  message: string;
}

export type AgentPageCommand =
  | { type: "get-browser-state" }
  | { type: "get-last-update-time" }
  | { type: "update-tree" }
  | { type: "clean-up-highlights" }
  | { type: "show-mask" }
  | { type: "hide-mask" }
  | { type: "dispose" }
  | { type: "click-element"; index: number }
  | { type: "input-text"; index: number; text: string }
  | { type: "select-option"; index: number; text: string }
  | { type: "modify-element"; index: number; changes: AgentElementMutation[] }
  | { type: "remove-element"; index: number }
  | {
      type: "scroll";
      options: {
        down: boolean;
        numPages: number;
        pixels?: number;
        index?: number;
      };
    }
  | {
      type: "scroll-horizontally";
      options: { right: boolean; pixels: number; index?: number };
    };

export type AgentPageCommandResult =
  | AgentBrowserState
  | AgentActionResult
  | number
  | string
  | null;

export type BackgroundRequest =
  | { target: "background"; type: "open-settings" }
  | { target: "background"; type: "open-documents" }
  | { target: "background"; type: "get-host-access" }
  | { target: "background"; type: "revoke-host-access"; origin: string }
  | { target: "background"; type: "page-command"; command: PageCommand }
  | { target: "background"; type: "reading-command"; command: PageReadingCommand }
  | { target: "background"; type: "read-youtube-captions"; videoId: string }
  | { target: "background"; type: "editing-command"; command: PageEditingCommand }
  | { target: "background"; type: "capture-selection" }
  | {
      target: "background";
      type: "run-ai";
      requestId: string;
      request: RunAiRequest;
    }
  | {
      target: "background";
      type: "run-chat";
      requestId: string;
      request: RunChatRequest;
    }
  | { target: "background"; type: "replay-chat"; requestId: string; request: ReplayChatRequest }
  | {
      target: "background";
      type: "run-inline-ai";
      requestId: string;
      request: InlineAiRequest;
      selection: SelectionSnapshot;
    }
  | {
      target: "background";
      type: "run-page-agent";
      requestId: string;
      task: string;
      allowedOrigins?: string[];
    }
  | {
      target: "background";
      type: "answer-page-agent";
      requestId: string;
      answer: string;
    }
  | { target: "background"; type: "cancel-ai"; requestId: string }
  | {
      target: "background";
      type: "list-models";
      credentials: ProviderCredentials;
    };

export type ContentRequest = {
  target: "content";
  command: PageCommand;
};

export type ContentResponse = CommandResult<PageCommandResult>;

export type AgentContentRequest = {
  target: "page-agent-content";
  command: AgentPageCommand;
  allowedOrigins: string[];
};

export type AgentContentResponse = CommandResult<AgentPageCommandResult>;

export type ContentEvent = {
  target: "background";
  type: "page-state-changed";
  state: PageState;
};

export type PanelEvent =
  | { target: "panel"; type: "toggle-panel" }
  | {
      target: "panel";
      type: "page-state-changed";
      state: PageState;
    }
  | {
      target: "panel";
      type: "page-agent-progress";
      requestId: string;
      progress: PageAgentProgress;
    }
  | {
      target: "panel";
      type: "chat-delta";
      requestId: string;
      delta: string;
    }
  | {
      target: "panel";
      type: "chat-context";
      requestId: string;
      snapshot: ChatContextSnapshot;
    };

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

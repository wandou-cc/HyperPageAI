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
  | { type: "replace-editable"; text: string }
  | { type: "undo-replace" }
  | { type: "insert-result"; text: string }
  | { type: "remove-insertion" }
  | { type: "suspend-overlay" }
  | { type: "restore-overlay" };

export type PageCommand = PageStateCommand;

export type PageCommandResult = PageState;

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
}

export interface ProviderConfig extends ProviderCredentials {
  model: string;
  supportsVision: boolean;
  targetLanguage: string;
}

export interface StoredSettings {
  version: 4;
  enabled: boolean;
  locale: Locale;
  provider: ProviderConfig | null;
  resultDisplayMode: ResultDisplayMode;
  allowMultiTab: boolean;
}

export type RunAiRequest =
  | { action: Exclude<AiAction, "custom"> }
  | { action: "custom"; prompt: string };

export type InlineAiRequest =
  | { action: "translate" | "explain" | "ocr" | "image-prompt" }
  | { action: "custom"; prompt: string };

export interface AiExecutionResult {
  content: string;
  selectionRevision: number | null;
}

export interface PageAgentExecutionResult {
  content: string;
  success: boolean;
}

export interface SavedPageWorkflow {
  id: string;
  name: string;
  task: string;
}

export interface StoredPageWorkflows {
  version: 1;
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
  | { target: "background"; type: "get-panel-visibility" }
  | {
      target: "background";
      type: "set-panel-visibility";
      visible: boolean;
    }
  | { target: "background"; type: "page-command"; command: PageCommand }
  | { target: "background"; type: "capture-selection" }
  | {
      target: "background";
      type: "run-ai";
      requestId: string;
      request: RunAiRequest;
    }
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
    }
  | {
      target: "background";
      type: "test-connection";
      provider: ProviderConfig;
    };

export type ContentRequest = {
  target: "content";
  command: PageCommand;
};

export type ContentResponse = CommandResult<PageCommandResult>;

export type AgentContentRequest = {
  target: "page-agent-content";
  command: AgentPageCommand;
};

export type AgentContentResponse = CommandResult<AgentPageCommandResult>;

export type ContentEvent = {
  target: "background";
  type: "page-state-changed";
  state: PageState;
};

export type PanelEvent =
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
    };

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

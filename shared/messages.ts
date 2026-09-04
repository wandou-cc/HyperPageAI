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
  canUndoHide: boolean;
  canUndoReplace: boolean;
  canRemoveInsertion: boolean;
  selecting: boolean;
}

export type PageCommand =
  | { type: "start-selection" }
  | { type: "select-parent" }
  | { type: "cancel-selection" }
  | { type: "get-page-state" }
  | { type: "hide-selection" }
  | { type: "undo-hide" }
  | { type: "replace-editable"; text: string }
  | { type: "undo-replace" }
  | { type: "insert-result"; text: string }
  | { type: "remove-insertion" }
  | { type: "suspend-overlay" }
  | { type: "restore-overlay" };

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
  version: 2;
  locale: Locale;
  provider: ProviderConfig | null;
  resultDisplayMode: ResultDisplayMode;
}

export type RunAiRequest =
  | { action: Exclude<AiAction, "custom"> }
  | { action: "custom"; prompt: string };

export type InlineAiRequest =
  | { action: "translate" | "explain" | "ocr" | "image-prompt" }
  | { action: "custom"; prompt: string };

export interface AiExecutionResult {
  content: string;
  selectionRevision: number;
}

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

export type ContentResponse = CommandResult<PageState>;

export type ContentEvent = {
  target: "background";
  type: "page-state-changed";
  state: PageState;
};

export type PanelEvent = {
  target: "panel";
  type: "page-state-changed";
  state: PageState;
};

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

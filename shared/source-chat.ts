import type {
  ChatExecutionResult,
  CommandResult,
  PanelEvent,
  ReplayChatRequest,
} from "./messages";

export const SOURCE_CHAT_PORT = "hyperpage.source-chat";
export type SourceChatCommand =
  | { type: "run"; requestId: string; request: ReplayChatRequest }
  | { type: "cancel"; requestId: string };
export type SourceChatEvent =
  | { type: "event"; event: PanelEvent }
  | {
      type: "result";
      requestId: string;
      result: CommandResult<ChatExecutionResult>;
    };

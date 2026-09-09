import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  Copy,
  History,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";
import { message as notify } from "@/components/ui/toast";
import { Field, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
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
import type {
  ChatContextSnapshot,
  Locale,
  PageCitation,
} from "../../shared/messages";
import {
  SOURCE_CHAT_PORT,
  type SourceChatCommand,
  type SourceChatEvent,
} from "../../shared/source-chat";
import { copyText } from "../../shared/clipboard";
import {
  getConversationHistory,
  getTurnCitations,
  parseContextSnapshot,
  type ConversationTurn,
  type SavedConversation,
} from "../../shared/conversations";
import { answerToMarkdown, conversationToMarkdown } from "../../shared/export";
import { ReadingAnswer } from "../sidepanel/ReadingAnswer";
import { ConversationLibrary } from "../sidepanel/ConversationLibrary";
import { TextExport } from "../sidepanel/TextExport";
import { IconTooltip } from "../sidepanel/ui";
import { WebSearchToggle } from "./WebSearchToggle";
import { AiComposer } from "./AiComposer";
import type { ResourceSource } from "../../shared/page-resources";
import type { CapabilityResult } from "../../shared/messages";
import { formatError, t } from "../sidepanel/translations";

export function SourceConversation({
  locale,
  source,
  disabled,
  onLocate,
  onError,
  onBusy,
  webSearchCapability,
  children,
  resources,
  browsing = false,
  onBrowseChange,
}: {
  locale: Locale;
  source: ResourceSource | null;
  disabled: boolean;
  onLocate: (citation: PageCitation) => Promise<boolean>;
  onError: (error: string) => void;
  onBusy: (busy: boolean) => void;
  webSearchCapability?: CapabilityResult;
  children: ReactNode;
  resources?: ReactNode;
  browsing?: boolean;
  onBrowseChange?: (browsing: boolean) => void;
}) {
  const file = source?.type === "file" ? source.file : null;
  const title = file?.name ?? (source?.type === "image" ? source.image.name : source?.type === "page" ? source.page.title : t(locale, "documents"));
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  useEffect(() => { setWebSearch(false); }, [webSearchCapability]);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [library, setLibrary] = useState(false);
  const [view, setView] = useState("source");
  useEffect(() => { if (browsing) setView("source"); }, [browsing]);
  const [saved, setSaved] = useState<SavedConversation | null>(null);
  const hasImages = source?.type === "image" || turns.some((turn) => turn.snapshot.type === "image");
  const port = useRef<Browser.runtime.Port | null>(null);
  const active = useRef<{ id: string; prompt: string } | null>(null);
  const callbacks = useRef({ locale, onBusy, onError });
  callbacks.current = { locale, onBusy, onError };
  useEffect(() => () => {
    active.current = null;
    port.current?.disconnect();
    port.current = null;
  }, []);

  function connect(): Browser.runtime.Port {
    const channel = browser.runtime.connect({ name: SOURCE_CHAT_PORT });
    port.current = channel;
    const disconnect = () => {
      const request = active.current;
      port.current = null;
      if (!request) return;
      setTurns((values) =>
        values.map((turn) =>
          turn.id === request.id ? { ...turn, status: "failed" } : turn,
        ),
      );
      setDraft(request.prompt);
      active.current = null;
      setPending(false);
      callbacks.current.onBusy(false);
      callbacks.current.onError(
        t(callbacks.current.locale, "documentConnectionClosed"),
      );
    };
    const receive = (message: SourceChatEvent) => {
      if (!active.current) return;
      const requestId = active.current.id;
      if (message.type === "event") {
        const event = message.event;
        if (!("requestId" in event) || event.requestId !== requestId) return;
        if (event.type === "chat-delta")
          setTurns((values) =>
            values.map((turn) =>
              turn.id === requestId
                ? { ...turn, answer: turn.answer + event.delta }
                : turn,
            ),
          );
        if (event.type === "chat-context")
          setTurns((values) =>
            values.map((turn) =>
              turn.id === requestId
                ? { ...turn, snapshot: event.snapshot }
                : turn,
            ),
          );
      } else if (message.requestId === requestId) {
        const result = message.result;
        setTurns((values) =>
          values.map((turn) =>
            turn.id !== requestId
              ? turn
              : result.ok
                ? { ...turn, status: "complete", answer: result.data.content }
                : {
                    ...turn,
                    status:
                      result.error === "requestCancelled"
                        ? "cancelled"
                        : "failed",
                  },
          ),
        );
        if (!result.ok) {
          setDraft(active.current.prompt);
          callbacks.current.onError(
            formatError(callbacks.current.locale, new Error(result.error)),
          );
        }
        active.current = null;
        setPending(false);
        callbacks.current.onBusy(false);
        channel.onMessage.removeListener(receive);
        channel.onDisconnect.removeListener(disconnect);
        channel.disconnect();
        port.current = null;
      }
    };
    channel.onMessage.addListener(receive);
    channel.onDisconnect.addListener(disconnect);
    return channel;
  }

  function send(prompt: string, replayIndex?: number): void {
    if (active.current || disabled || browsing || !contextReady) return;

    try {
      const index = replayIndex ?? editing ?? turns.length;
      const previous = turns[index];
      const replay = replayIndex !== undefined || editing !== null;
      const preceding = turns.slice(0, index);
      const imageInHistory = source?.type === "image" && preceding.some((turn) =>
        turn.status === "complete" && turn.snapshot.type === "image" && turn.snapshot.image.id === source.image.id);
      const snapshot: ChatContextSnapshot =
        replay && previous
          ? previous.snapshot
          : source && !imageInHistory
            ? parseContextSnapshot(source)
            : { type: "none" };
      if (!prompt.trim()) throw new Error("customPromptRequired");
      const search = !hasImages && (replay && previous ? previous.webSearch === true : webSearch);
      const requestId = crypto.randomUUID();
      const channel = connect();
      channel.postMessage({
        type: "run",
        requestId,
        request: {
          prompt: prompt.trim(),
          snapshot,
          includeHistory: true,
          webSearch: search,
          history: getConversationHistory(preceding),
        },
      } satisfies SourceChatCommand);
      active.current = { id: requestId, prompt };
      setTurns([
        ...preceding,
        {
          id: requestId,
          prompt: prompt.trim(),
          snapshot,
          includeHistory: true,
          webSearch: search,
          status: "streaming",
          answer: "",
        },
      ]);
      setPending(true);
      setView("answer");
      onBrowseChange?.(false);
      setLibrary(false);
      onBusy(true);
      setDraft("");
      setEditing(null);
    } catch (failure) {
      port.current?.disconnect();
      port.current = null;
      onError(formatError(locale, failure));
    }
  }
  function stop(): void {
    if (active.current)
      port.current?.postMessage({
        type: "cancel",
        requestId: active.current.id,
      } satisfies SourceChatCommand);
  }

  async function copyAnswer(text: string): Promise<void> {
    try {
      await copyText(text);
      notify.success(t(locale, "copied"));
    } catch (failure) {
      onError(formatError(locale, failure));
    }
  }
  const blocked = disabled || pending;
  const contextReady = source?.type === "image" || (!source && turns.length > 0) ||
    (source?.type === "file" && source.file.blocks.length > 0) ||
    (source?.type === "page" && source.page.blocks.length > 0);
  return (
    <Tabs
      value={view}
      onValueChange={setView}
      className="min-h-0 min-w-0 flex-1 gap-3"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {library ? <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t(locale, "savedConversations")}</h2> : (
          <TabsList variant="line" hidden={!turns.length || browsing}>
            <TabsTrigger value="source">{t(locale, "documentSource")}</TabsTrigger>
            <TabsTrigger value="answer">{t(locale, "documentAnswers")}</TabsTrigger>
          </TabsList>
        )}
        <div className="ml-auto flex items-center gap-1">
          {turns.length > 0 && <TextExport locale={locale} filename="hyperpage-document-conversation" disabled={blocked} content={() => conversationToMarkdown(turns, { user: t(locale, "userMessage"), assistant: t(locale, "assistant"), incomplete: t(locale, "generationIncomplete") })} />}
        <IconTooltip label={t(locale, library ? "backToConversation" : "conversationHistory")}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t(locale, library ? "backToConversation" : "conversationHistory")}
            aria-expanded={library}
            disabled={blocked}
            onClick={() => setLibrary(!library)}
          >
            {library ? <ArrowLeft /> : <History />}
          </Button>
        </IconTooltip>
        <IconTooltip label={t(locale, "newConversation")}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t(locale, "newConversation")}
            disabled={blocked || !turns.length}
            onClick={() => {
              setTurns([]);
              setSaved(null);
              setEditing(null);
              setDraft("");
              setLibrary(false);
              setView("source");
            }}
          >
            <Plus />
          </Button>
        </IconTooltip>
        </div>
      </div>
      {library ? <div className="min-h-0 flex-1 overflow-y-auto">
        <ConversationLibrary
          locale={locale}
          turns={turns}
          current={saved}
          disabled={blocked}
          sourceOnly
          source={{
            title,
            url: location.href,
          }}
          onLoad={(record) => {
            setTurns(record.turns);
            setSaved(record);
            setWebSearch(false);
            setEditing(null);
            setDraft("");
            setLibrary(false);
            setView("answer");
            onBrowseChange?.(false);
          }}
          onSaved={setSaved}
        />
      </div> : <div className="flex min-h-0 flex-1 flex-col">
      <TabsContent value="source" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
        {browsing ? resources : children}
      </TabsContent>
      <TabsContent value="answer" keepMounted className="flex min-h-0 flex-col data-[hidden]:hidden">
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={t(locale, "conversation")}>
            <MessageScrollerContent className="gap-3 p-3">
              {turns.map((turn, index) => (
                <MessageScrollerItem
                  key={turn.id}
                  scrollAnchor={turn.status === "streaming"}
                >
                  <Message align="end">
                    <MessageContent>
                      <MessageHeader>{t(locale, "userMessage")}</MessageHeader>
                      <Bubble>
                        <BubbleContent className="whitespace-pre-wrap break-words">
                          {turn.prompt}
                        </BubbleContent>
                      </Bubble>
                      <MessageFooter>
                        <IconTooltip label={t(locale, "editMessage")}>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t(locale, "editMessage")}
                            disabled={blocked}
                            onClick={() => {
                              setEditing(index);
                              setDraft(turn.prompt);
                            }}
                          >
                            <Pencil />
                          </Button>
                        </IconTooltip>
                      </MessageFooter>
                    </MessageContent>
                  </Message>
                  <Message>
                    <MessageContent>
                      <MessageHeader>{t(locale, "assistant")}</MessageHeader>
                      <Bubble>
                        <BubbleContent className="break-words">
                          <ReadingAnswer
                            content={turn.answer}
                            citations={getTurnCitations(turns, index)}
                            locale={locale}
                            onLocate={async (citation) => {
                              // Reveal the source before its page is scrolled into view.
                              flushSync(() => setView("source"));
                              const located = await onLocate(citation);
                              if (!located) setView("answer");
                              return located;
                            }}
                            onCopy={(text) => void copyAnswer(text)}
                          />
                        </BubbleContent>
                      </Bubble>
                      {turn.status !== "complete" && (
                        <div
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          {t(
                            locale,
                            turn.status === "streaming"
                              ? "processing"
                              : "generationIncomplete",
                          )}
                        </div>
                      )}
                      <MessageFooter>
                        <IconTooltip label={t(locale, "regenerateResponse")}>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t(locale, "regenerateResponse")}
                            disabled={blocked}
                            onClick={() => send(turn.prompt, index)}
                          >
                            <RefreshCw />
                          </Button>
                        </IconTooltip>
                        <IconTooltip label={t(locale, "copyResponse")}>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={t(locale, "copyResponse")}
                            disabled={!turn.answer}
                            onClick={() => {
                              void copyAnswer(
                                answerToMarkdown(
                                  turn.answer,
                                  getTurnCitations(turns, index),
                                ),
                              );
                            }}
                          >
                            <Copy />
                          </Button>
                        </IconTooltip>
                      </MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label={t(locale, "scrollToLatest")} />
        </MessageScroller>
      </MessageScrollerProvider>
      </TabsContent>
      </div>}
      <div className="flex max-h-[60%] shrink-0 flex-col gap-2 overflow-y-auto border-t pt-3">
      {editing !== null && (
        <div className="flex items-center justify-between text-xs">
          <span>{t(locale, "editingMessage")}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={t(locale, "cancelEditingMessage")}
            disabled={blocked}
            onClick={() => {
              setEditing(null);
              setDraft("");
            }}
          >
            <X />
          </Button>
        </div>
      )}
      <Field data-disabled={blocked || library || browsing}>
        <FieldLabel htmlFor="document-prompt" className="sr-only">{t(locale, "custom")}</FieldLabel>
        <AiComposer
          id="document-prompt"
          locale={locale}
          placeholder={t(locale, "documentPrompt")}
          value={draft}
          disabled={blocked || library || browsing}
          running={pending}
          onStop={stop}
          canSubmit={contextReady && Boolean(draft.trim())}
          onSubmit={() => send(draft)}
          onChange={(event) => setDraft(event.target.value)}
          toolbar={!hasImages && <WebSearchToggle locale={locale} capability={webSearchCapability} checked={editing === null ? webSearch : turns[editing]?.webSearch === true} disabled={blocked || library || browsing || editing !== null} onChange={setWebSearch} />}
        />
      </Field>
      </div>
    </Tabs>
  );
}

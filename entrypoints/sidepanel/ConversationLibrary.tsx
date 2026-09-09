import { message as notify } from "@/components/ui/toast";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  Pencil,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { Locale } from "../../shared/messages";
import {
  CONVERSATION_STORAGE_PREFIX,
  deleteConversation,
  exportConversations,
  importConversations,
  loadConversations,
  saveConversation,
  type ConversationTurn,
  type SavedConversation,
} from "../../shared/conversations";
import { downloadText } from "../../shared/export";
import { formatError, t } from "./translations";
import { IconTooltip } from "./ui";

interface ConversationLibraryProps {
  locale: Locale;
  turns: ConversationTurn[];
  current: SavedConversation | null;
  disabled: boolean;
  onLoad: (record: SavedConversation) => void;
  onSaved: (record: SavedConversation | null) => void;
  source?: { title: string; url: string };
  sourceOnly?: boolean;
}

export function ConversationLibrary({
  locale,
  turns,
  current,
  disabled,
  onLoad,
  onSaved,
  source,
  sourceOnly = false,
}: ConversationLibraryProps) {
  const [records, setRecords] = useState<SavedConversation[]>([]);
  const [name, setName] = useState(current?.name ?? "");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setName(current?.name ?? "");
  }, [current?.id, current?.name]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadConversations()
        .then((values) => {
          if (active) {
            setRecords(values.filter((record) => !sourceOnly || record.turns.every((turn) => ["file", "none", "image", "page"].includes(turn.snapshot.type))));

          }
        })
        .catch((cause: unknown) => {
          if (active) notify.error(formatError(locale, cause));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    refresh();
    const listener = (
      changes: Record<string, Browser.storage.StorageChange>,
      area: Browser.storage.AreaName,
    ) => {
      if (
        area === "local" &&
        Object.keys(changes).some((key) =>
          key.startsWith(CONVERSATION_STORAGE_PREFIX),
        )
      )
        refresh();
    };
    browser.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(listener);
    };
  }, [locale, sourceOnly]);

  async function mutate(action: () => Promise<void>): Promise<void> {
    if (busy || disabled) return;
    setBusy(true);

    try {
      await action();
      setRecords((await loadConversations()).filter((record) => !sourceOnly || record.turns.every((turn) => ["file", "none", "image", "page"].includes(turn.snapshot.type))));
    } catch (cause) {
      notify.error(formatError(locale, cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent(): Promise<void> {
    if (
      !name.trim() ||
      !turns.length ||
      turns.some((turn) => turn.status === "streaming")
    )
      return;
    await mutate(async () => {
      const now = Date.now();
      const record = await saveConversation({
        version: 1,
        id: current?.id ?? crypto.randomUUID(),
        name: name.trim(),
        url: current?.url ?? source?.url ?? location.href,
        title: current?.title ?? source?.title ?? document.title,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        turns,
      });
      onSaved(record);
      notify.success(t(locale, "conversationSaved"));
    });
  }

  const urls = [...new Set(records.map((record) => record.url))];
  const pageItems = [
    { value: "", label: t(locale, "allPages") },
    ...urls.map((url) => ({ value: url, label: url })),
  ];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = records.filter(
    (record) =>
      (!page || record.url === page) &&
      (!needle ||
        [
          record.name,
          record.title,
          record.url,
          ...record.turns.flatMap((turn) => [turn.prompt, turn.answer]),
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(needle)),
  );
  const groups = [...new Set(filtered.map((record) => record.url))];
  const blocked = disabled || busy;

  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={t(locale, "savedConversations")}
    >
      {turns.length > 0 && <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveCurrent();
        }}
      >
        <FieldGroup>
          <Field data-disabled={blocked}>
            <FieldLabel htmlFor="conversation-name">
              {t(locale, "conversationName")}
            </FieldLabel>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                id="conversation-name"
                maxLength={200}
                value={name}
                disabled={blocked}
                onChange={(event) => setName(event.target.value)}
              />
              <IconTooltip label={t(locale, "saveConversation")}>
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label={t(locale, "saveConversation")}
                  disabled={
                    blocked ||
                    !name.trim() ||
                    !turns.length ||
                    turns.some((turn) => turn.status === "streaming")
                  }
                >
                  <Save />
                </Button>
              </IconTooltip>
            </div>
          </Field>
        </FieldGroup>
      </form>}
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t(locale, "searchConversations")}
            placeholder={t(locale, "searchConversations")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label={t(locale, "importConversations")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void mutate(async () => {
              if (file.size > 10 * 1024 * 1024)
                throw new Error("conversationImportTooLarge");
              await importConversations(await file.text());
              notify.success(t(locale, "conversationsImported"));
            });
          }}
        />
        <IconTooltip label={t(locale, "importConversations")}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t(locale, "importConversations")}
            disabled={blocked}
            onClick={() => fileRef.current?.click()}
          >
            <Upload />
          </Button>
        </IconTooltip>
        <IconTooltip label={t(locale, "exportConversations")}>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t(locale, "exportConversations")}
            disabled={blocked || !records.length}
            onClick={() =>
              downloadText(
                exportConversations(records),
                "hyperpage-conversations.json",
                "application/json",
              )
            }
          >
            <Download />
          </Button>
        </IconTooltip>
      </div>
      <Select
        items={pageItems}
        value={page}
        onValueChange={(value) => { if (value !== null) setPage(value); }}
      >
        <SelectTrigger className="w-full" aria-label={t(locale, "conversationPage")}><SelectValue /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {pageItems.map((item) => (
              <SelectItem key={item.value} value={item.value}><span className="break-all">{item.label}</span></SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {loading ? (
        <Spinner aria-label={t(locale, "processing")} />
      ) : !filtered.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t(locale, "noSavedConversations")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {groups.map((url) => (
            <section key={url} className="min-w-0" aria-label={url}>
              <div className="mb-1 text-xs text-muted-foreground break-all">
                {url}
              </div>
              {filtered
                .filter((record) => record.url === url)
                .map((record) => (
                  <div
                    key={record.id}
                    className="flex min-w-0 flex-col gap-1 border-b border-border py-2"
                  >
                    {renaming?.id === record.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void mutate(async () => {
                            const updated = await saveConversation({
                              ...record,
                              name: renaming.name.trim(),
                              updatedAt: Date.now(),
                            });
                            if (current?.id === record.id) onSaved(updated);
                            setRenaming(null);
                          });
                        }}
                      >
                        <Input
                          aria-label={t(locale, "conversationName")}
                          value={renaming.name}
                          maxLength={200}
                          disabled={blocked}
                          onChange={(event) =>
                            setRenaming({
                              id: record.id,
                              name: event.target.value,
                            })
                          }
                        />
                        <Button
                          type="submit"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t(locale, "save")}
                          disabled={blocked || !renaming.name.trim()}
                        >
                          <Save />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t(locale, "cancelEditingMessage")}
                          onClick={() => setRenaming(null)}
                        >
                          <X />
                        </Button>
                      </form>
                    ) : (
                      <Button variant="ghost" className="h-auto justify-start whitespace-normal break-words" disabled={blocked} onClick={() => onLoad(record)}>
                        {record.name}
                      </Button>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat(
                        locale === "zh_CN" ? "zh-CN" : "en",
                        { dateStyle: "short", timeStyle: "short" },
                      ).format(record.updatedAt)}
                    </div>
                    <div className="flex gap-1">
                      <IconTooltip label={t(locale, "renameConversation")}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={blocked}
                          aria-label={t(locale, "renameConversation")}
                          onClick={() =>
                            setRenaming({ id: record.id, name: record.name })
                          }
                        >
                          <Pencil />
                        </Button>
                      </IconTooltip>
                      <IconTooltip label={t(locale, "deleteConversation")}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={blocked}
                          aria-label={t(locale, "deleteConversation")}
                          onClick={() =>
                            void mutate(async () => {
                              await deleteConversation(record.id);
                              if (current?.id === record.id) onSaved(null);
                            })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </IconTooltip>
                    </div>
                  </div>
                ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

import { browser } from "wxt/browser";
import { parseTranslationTerms, TRANSLATION_TERMS_STORAGE_KEY } from "./page-translation";
import {
  PROMPT_TEMPLATES_STORAGE_KEY,
  parsePromptTemplates,
} from "./prompt-templates";
import {
  CONVERSATION_STORAGE_PREFIX,
  parseSavedConversation,
} from "./conversations";
import {
  PAGE_AGENT_HISTORY_STORAGE_KEY,
  PAGE_WORKFLOWS_STORAGE_KEY,
  PAGE_WORKFLOWS_VERSION,
  SETTINGS_STORAGE_KEY,
  parseStoredPageAgentHistory,
  parseStoredPageWorkflows,
  parseStoredSettings,
} from "./settings";

export const LOCAL_DATA_CATEGORIES = [
  "settings",
  "workflows",
  "templates",
  "terms",
  "history",
  "conversations",
] as const;
export type LocalDataCategory = (typeof LOCAL_DATA_CATEGORIES)[number];
export type LocalDataScope = LocalDataCategory | "all";

interface LocalDataGroup {
  count: number;
  bytes: number;
  data: unknown;
}

export interface LocalDataSummary {
  totalBytes: number;
  groups: Record<LocalDataCategory, LocalDataGroup>;
}

function dataKeys(
  values: Record<string, unknown>,
): Record<LocalDataCategory, string[]> {
  return {
    settings: SETTINGS_STORAGE_KEY in values ? [SETTINGS_STORAGE_KEY] : [],
    workflows:
      PAGE_WORKFLOWS_STORAGE_KEY in values ? [PAGE_WORKFLOWS_STORAGE_KEY] : [],
    templates:
      PROMPT_TEMPLATES_STORAGE_KEY in values
        ? [PROMPT_TEMPLATES_STORAGE_KEY]
        : [],
    terms: TRANSLATION_TERMS_STORAGE_KEY in values ? [TRANSLATION_TERMS_STORAGE_KEY] : [],
    history:
      PAGE_AGENT_HISTORY_STORAGE_KEY in values
        ? [PAGE_AGENT_HISTORY_STORAGE_KEY]
        : [],
    conversations: Object.keys(values).filter((key) =>
      key.startsWith(CONVERSATION_STORAGE_PREFIX),
    ),
  };
}

export async function loadLocalData(): Promise<LocalDataSummary> {
  const values: Record<string, unknown> = await browser.storage.local.get(null);
  const keys = dataKeys(values);
  const settings =
    values[SETTINGS_STORAGE_KEY] === undefined
      ? null
      : parseStoredSettings(values[SETTINGS_STORAGE_KEY]);
  const settingsData = settings && {
    ...settings,
    providers: settings.providers.map(({ id, name, config }) => ({
      id,
      name,
      config: {
        protocol: config.protocol,
        baseUrl: config.baseUrl,
        model: config.model,
        targetLanguage: config.targetLanguage,
        capabilities: config.capabilities,
      },
    })),
  };
  const workflows =
    values[PAGE_WORKFLOWS_STORAGE_KEY] === undefined
      ? []
      : parseStoredPageWorkflows(values[PAGE_WORKFLOWS_STORAGE_KEY]).workflows;
  const history =
    values[PAGE_AGENT_HISTORY_STORAGE_KEY] === undefined
      ? []
      : parseStoredPageAgentHistory(values[PAGE_AGENT_HISTORY_STORAGE_KEY])
          .records;
  const templates =
    values[PROMPT_TEMPLATES_STORAGE_KEY] === undefined
      ? null
      : parsePromptTemplates(values[PROMPT_TEMPLATES_STORAGE_KEY]);
  const conversations = keys.conversations.map((key) => {
    const record = parseSavedConversation(values[key]);
    if (key !== `${CONVERSATION_STORAGE_PREFIX}${record.id}`)
      throw new Error("conversationsInvalid");
    return record;
  });
  const terms = values[TRANSLATION_TERMS_STORAGE_KEY] === undefined ? null : parseTranslationTerms(values[TRANSLATION_TERMS_STORAGE_KEY]);
  const groups: LocalDataSummary["groups"] = {
    settings: { count: settings ? 1 : 0, bytes: 0, data: settingsData },
    workflows: { count: workflows.length, bytes: 0, data: workflows },
    templates: {
      count: templates?.length ?? 0,
      bytes: 0,
      data: templates === null ? null : { version: 1, templates },
    },
    terms: { count: terms?.length ?? 0, bytes: 0, data: terms === null ? null : { version: 1, terms } },
    history: { count: history.length, bytes: 0, data: history },
    conversations: {
      count: conversations.length,
      bytes: 0,
      data: conversations,
    },
  };
  await Promise.all(
    LOCAL_DATA_CATEGORIES.map(async (category) => {
      groups[category].bytes = await browser.storage.local.getBytesInUse(
        keys[category],
      );
    }),
  );
  return {
    totalBytes: Object.values(groups).reduce(
      (sum, group) => sum + group.bytes,
      0,
    ),
    groups,
  };
}

export function exportLocalData(
  summary: LocalDataSummary,
  scope: LocalDataScope,
): string {
  if (scope === "workflows") {
    return JSON.stringify(
      {
        version: PAGE_WORKFLOWS_VERSION,
        workflows: summary.groups.workflows.data,
      },
      null,
      2,
    );
  }
  if (scope === "conversations") {
    return JSON.stringify(
      {
        kind: "hyperpage.conversations",
        version: 1,
        conversations: summary.groups.conversations.data,
      },
      null,
      2,
    );
  }
  const categories = scope === "all" ? LOCAL_DATA_CATEGORIES : [scope];
  return JSON.stringify(
    {
      kind: "hyperpage.local-data",
      version: 1,
      data: Object.fromEntries(
        categories.map((category) => [category, summary.groups[category].data]),
      ),
    },
    null,
    2,
  );
}

export async function clearLocalData(scope: LocalDataScope): Promise<void> {
  const values: Record<string, unknown> = await browser.storage.local.get(null);
  const keys = dataKeys(values);
  await browser.storage.local.remove(
    scope === "all" ? Object.values(keys).flat() : keys[scope],
  );
}

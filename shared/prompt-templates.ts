import { browser } from "wxt/browser";
import { z } from "zod";
import type { Locale } from "./messages";
import { getTemplateVariables } from "./task-templates";

export const PROMPT_TEMPLATES_STORAGE_KEY = "hyperpage.promptTemplates";
export const TEMPLATE_CATEGORIES = [
  "reading",
  "writing",
  "translation",
  "other",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

const templateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(12_000),
    category: z.enum(TEMPLATE_CATEGORIES),
    favorite: z.boolean(),
  })
  .strict();
export type PromptTemplate = z.infer<typeof templateSchema>;

export function createDefaultPromptTemplates(locale: Locale): PromptTemplate[] {
  const chinese = locale === "zh_CN";
  return [
    {
      id: "summary",
      name: chinese ? "内容摘要" : "Summarize",
      prompt: chinese
        ? "总结附带内容的核心观点、依据和结论。区分原文事实与推断，引用可用的来源。"
        : "Summarize the key claims, evidence and conclusions in the attached content. Distinguish facts from inferences and cite available sources.",
      category: "reading",
      favorite: true,
    },
    {
      id: "reply",
      name: chinese ? "撰写回复" : "Draft a reply",
      prompt: chinese
        ? "为附带的内容撰写回复，表达以下观点：{{观点}}。语气：{{语气}}。仅输出回复正文。"
        : "Draft a reply to the attached content expressing: {{points}}. Tone: {{tone}}. Return only the reply.",
      category: "writing",
      favorite: true,
    },
    {
      id: "polish",
      name: chinese ? "纠错润色" : "Correct and polish",
      prompt: chinese
        ? "纠正附带内容中的拼写、语法和表达问题，保留原意及语言，仅输出修改后的正文。"
        : "Correct spelling, grammar and clarity in the attached text. Preserve its meaning and language. Return only the revised text.",
      category: "writing",
      favorite: false,
    },
    {
      id: "translate",
      name: chinese ? "指定语言翻译" : "Translate",
      prompt: chinese
        ? "将附带内容翻译为{{语言}}，保持原文结构、专有名词与含义，仅输出译文。"
        : "Translate the attached content into {{language}}. Preserve its structure, names and meaning. Return only the translation.",
      category: "translation",
      favorite: false,
    },
    {
      id: "extract",
      name: chinese ? "提取信息" : "Extract information",
      prompt: chinese
        ? "从附带内容中提取以下字段：{{字段}}。按表格整理，缺失的信息标为未提供，并引用可用的来源。"
        : "Extract these fields from the attached content: {{fields}}. Organize them as a table, mark missing information as unavailable and cite available sources.",
      category: "reading",
      favorite: false,
    },
  ];
}

export function parsePromptTemplates(value: unknown): PromptTemplate[] {
  const parsed = z
    .object({
      version: z.literal(1),
      templates: z.array(templateSchema).max(100),
    })
    .strict()
    .safeParse(value);
  if (
    !parsed.success ||
    new Set(parsed.data.templates.map((item) => item.id)).size !==
      parsed.data.templates.length
  )
    throw new Error("promptTemplatesInvalid");
  for (const template of parsed.data.templates)
    getTemplateVariables(template.prompt);
  return parsed.data.templates;
}

export async function loadPromptTemplates(
  locale: Locale,
): Promise<PromptTemplate[]> {
  const stored = await browser.storage.local.get(PROMPT_TEMPLATES_STORAGE_KEY);
  const value: unknown = stored[PROMPT_TEMPLATES_STORAGE_KEY];
  return value === undefined
    ? createDefaultPromptTemplates(locale)
    : parsePromptTemplates(value);
}

export async function savePromptTemplates(
  templates: PromptTemplate[],
): Promise<PromptTemplate[]> {
  const parsed = parsePromptTemplates({ version: 1, templates });
  await browser.storage.local.set({
    [PROMPT_TEMPLATES_STORAGE_KEY]: { version: 1, templates: parsed },
  });
  return parsed;
}

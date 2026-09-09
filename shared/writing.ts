import { z } from "zod";

export const WRITING_MODES = [
  "reply",
  "continue",
  "expand",
  "shorten",
  "rewrite",
  "correct",
  "email",
  "comment",
] as const;
const writingSchema = z
  .object({
    mode: z.enum(WRITING_MODES),
    tone: z.string().trim().max(100),
    targetLength: z.number().int().min(20).max(3000).nullable(),
    instruction: z.string().trim().max(4000),
  })
  .strict();
export type WritingOptions = z.infer<typeof writingSchema>;

export function parseWritingOptions(value: unknown): WritingOptions {
  const result = writingSchema.safeParse(value);
  if (!result.success) throw new Error("writingOptionsInvalid");
  return result.data;
}

export function writingNeedsSource(mode: WritingOptions["mode"]): boolean {
  return mode !== "email" && mode !== "comment";
}

export function buildWritingInstruction(
  options: WritingOptions,
  language: string,
): string {
  const actions: Record<WritingOptions["mode"], string> = {
    reply: "Write a reply to the selected text.",
    continue:
      "Continue the selected text. Return only the continuation without repeating the original.",
    expand:
      "Expand the selected text with useful detail. Do not invent facts or change its meaning.",
    shorten: "Shorten the selected text while preserving its key information.",
    rewrite:
      "Rewrite the selected text for clarity and flow while preserving its meaning.",
    correct:
      "Correct spelling, grammar and punctuation in the selected text. Preserve its meaning and style.",
    email:
      "Write an email using the supplied requirements and selected text, if present. Include a subject and body.",
    comment:
      "Write a comment using the supplied requirements and selected text, if present.",
  };
  return [
    actions[options.mode],
    writingNeedsSource(options.mode)
      ? "Keep the original language unless the user explicitly requests another language."
      : `Write in ${language} unless the user explicitly requests another language.`,
    options.tone
      ? `Tone: ${options.tone}.`
      : "Preserve the source tone when source text is present.",
    options.targetLength === null
      ? "Use a length appropriate to the task."
      : `Aim for about ${options.targetLength} words, or ${options.targetLength} characters for Chinese, Japanese or Korean.`,
    options.instruction ? `User requirements: ${options.instruction}` : "",
    "Return only the requested writing, without explanations, quotation marks or code fences.",
  ]
    .filter(Boolean)
    .join("\n");
}

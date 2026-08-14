import { generateGeminiText } from "@/lib/gemini/client";
import { parseGeminiJson } from "@/lib/gemini/json";
import { condensePrompt, normalizeCondensed, type CondenseInput } from "./condense";

const MODEL = "gemini-3.5-flash";

/** 그날 내보낼 공고를 한 번에 묶어 한 줄 요약으로 줄입니다. */
export async function condenseProgramSummaries(programs: CondenseInput[]) {
  if (!programs.length) return [];
  const { text } = await generateGeminiText({
    model: MODEL,
    parts: [{ text: condensePrompt(programs) }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2400 },
    timeoutMs: 90_000,
  });
  return normalizeCondensed(parseGeminiJson<unknown>(text), programs.map((program) => program.id));
}

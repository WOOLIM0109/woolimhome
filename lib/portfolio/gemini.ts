import { generateGeminiText, type GeminiPart } from "@/lib/gemini/client";

function stripFence(value: string) {
  return value.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
}

function firstJsonObject(value: string) {
  const cleaned = stripFence(value);
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("No JSON object was found in the AI response.");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  throw new Error("The JSON object in the AI response was incomplete.");
}

export async function generateGeminiJson<T>(
  parts: GeminiPart[],
  options: {
    maxOutputTokens?: number;
    timeoutMs?: number;
    attempts?: number;
    jsonAttempts?: number;
  } = {},
) {
  let lastError: unknown;
  const jsonAttempts = Math.max(1, Math.min(options.jsonAttempts || 2, 2));
  for (let attempt = 0; attempt < jsonAttempts; attempt += 1) {
    const { text } = await generateGeminiText({
      parts: attempt
        ? [...parts, { text: "The previous response was invalid JSON. Return only one valid JSON object." }]
        : parts,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: options.maxOutputTokens || 8192,
        temperature: attempt ? 0 : 0.2,
      },
      timeoutMs: options.timeoutMs,
      attempts: options.attempts,
    });
    try {
      return JSON.parse(firstJsonObject(text)) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI JSON parsing failed.");
}

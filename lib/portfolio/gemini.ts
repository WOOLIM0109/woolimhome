type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

function apiKey() {
  const value = process.env.GEMINI_API_KEY;
  if (!value) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  return value;
}

function stripFence(value: string) {
  return value.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
}

function firstJsonObject(value: string) {
  const cleaned = stripFence(value);
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("AI 응답에서 JSON 객체를 찾지 못했습니다.");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  throw new Error("AI 응답의 JSON 객체가 닫히지 않았습니다.");
}

export async function generateGeminiJson<T>(
  parts: GeminiPart[],
  options: { maxOutputTokens?: number; timeoutMs?: number } = {},
) {
  let lastError: unknown;
  let retryJson = false;
  const attemptLimit = 4;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: retryJson
              ? [...parts, { text: "직전 응답은 JSON 문법이 깨졌습니다. 설명이나 코드펜스 없이 유효한 JSON 객체만 다시 반환하세요." }]
              : parts,
          }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: options.maxOutputTokens || 8192,
            temperature: attempt ? 0 : 0.2,
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs || 120_000),
      },
    );
    if (!response.ok) {
      lastError = new Error(`AI 판정 요청 실패: ${response.status} ${await response.text()}`);
      retryJson = false;
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable) break;
      if (attempt < attemptLimit - 1) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3_000));
      }
      continue;
    }
    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
    if (!raw) {
      lastError = new Error("AI 판정 결과가 비어 있습니다.");
      continue;
    }
    try {
      return JSON.parse(firstJsonObject(raw)) as T;
    } catch (error) {
      lastError = error;
      retryJson = true;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI JSON 판정에 실패했습니다.");
}

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

export async function generateGeminiJson<T>(
  parts: GeminiPart[],
  options: { maxOutputTokens?: number; timeoutMs?: number } = {},
) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: options.maxOutputTokens || 8192,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs || 120_000),
    },
  );
  if (!response.ok) {
    throw new Error(`AI 판정 요청 실패: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || "").join("")?.trim();
  if (!raw) throw new Error("AI 판정 결과가 비어 있습니다.");
  return JSON.parse(stripFence(raw)) as T;
}

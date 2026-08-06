function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export function escapeJsonStringControlCharacters(value: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const character of value) {
    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }

    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }

    const code = character.charCodeAt(0);
    if (code < 0x20) {
      const escapedCharacter = character === "\n" ? "\\n"
        : character === "\r" ? "\\r"
          : character === "\t" ? "\\t"
            : character === "\b" ? "\\b"
              : character === "\f" ? "\\f"
                : `\\u${code.toString(16).padStart(4, "0")}`;
      result += escapedCharacter;
      continue;
    }
    result += character;
  }
  return result;
}

export function parseGeminiJson<T>(value: string): T {
  const cleaned = stripJsonFence(value);
  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    if (!(error instanceof SyntaxError) || !/[Cc]ontrol character/.test(error.message)) throw error;
    return JSON.parse(escapeJsonStringControlCharacters(cleaned)) as T;
  }
}

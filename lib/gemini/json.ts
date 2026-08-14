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

/**
 * 앞에서부터 짝이 맞는 JSON 한 덩어리만 잘라 냅니다.
 *
 * 모델이 JSON 뒤에 설명 문장이나 두 번째 객체를 덧붙이는 일이 있습니다.
 * 그러면 "Unexpected non-whitespace character after JSON" 으로 통째로 실패하고,
 * 다 써 놓은 원고가 버려졌습니다. 실제로 칼럼 한 편이 그렇게 사라졌습니다.
 *
 * 잘려서 짝이 맞지 않는 응답은 일부러 돌려주지 않습니다.
 * 반쪽짜리 글을 성공으로 넘기면 더 나쁩니다.
 */
export function extractFirstJsonValue(value: string) {
  const start = value.search(/[{[]/);
  if (start < 0) return null;
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function tryParse<T>(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) as T };
  } catch (error) {
    try {
      return { ok: true as const, value: JSON.parse(escapeJsonStringControlCharacters(text)) as T };
    } catch {
      return { ok: false as const, error };
    }
  }
}

export function parseGeminiJson<T>(value: string): T {
  const cleaned = stripJsonFence(value);
  const direct = tryParse<T>(cleaned);
  if (direct.ok) return direct.value;
  // 뒤에 군더더기가 붙은 경우입니다. 앞의 한 덩어리만 다시 읽어 봅니다.
  const extracted = extractFirstJsonValue(cleaned);
  if (extracted && extracted !== cleaned) {
    const retry = tryParse<T>(extracted);
    if (retry.ok) return retry.value;
  }
  throw direct.error;
}

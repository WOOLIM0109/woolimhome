import assert from "node:assert/strict";
import test from "node:test";
import { redactGeminiTextParts, redactPersonalData } from "./privacy.ts";

test("personal contact and registration values are redacted locally", () => {
  const result = redactPersonalData("\uB2F4\uB2F9\uC790 \uC774\uB984: \uD64D\uAE38\uB3D9, 010-1234-5678, hong@example.com, \uC0AC\uC5C5\uC790 123-45-67890");
  assert.equal(result.text.includes("\uD64D\uAE38\uB3D9"), false);
  assert.equal(result.text.includes("010-1234-5678"), false);
  assert.equal(result.text.includes("hong@example.com"), false);
  assert.equal(result.text.includes("123-45-67890"), false);
  assert.ok(result.total >= 4);
});

test("configured sensitive terms are replaced without returning a raw mapping", () => {
  const result = redactPersonalData("\uACE0\uAC1D\uC0AC \uC54C\uD30C\uCEF4\uD37C\uB2C8\uC758 \uC774\uC804 \uC804\uB7B5", { sensitiveTerms: ["\uC54C\uD30C\uCEF4\uD37C\uB2C8"] });
  assert.equal(result.text, "\uACE0\uAC1D\uC0AC [SENSITIVE]\uC758 \uC774\uC804 \uC804\uB7B5");
  assert.equal("mapping" in result, false);
});

test("Gemini text parts are redacted while binary parts remain untouched", () => {
  const binary = { inlineData: { mimeType: "image/png", data: "AAAA" } };
  const result = redactGeminiTextParts([{ text: "\uBA54\uC77C a@b.co" }, binary]);
  assert.equal(result.parts[0].text, "\uBA54\uC77C [EMAIL]");
  assert.deepEqual(result.parts[1], binary);
});

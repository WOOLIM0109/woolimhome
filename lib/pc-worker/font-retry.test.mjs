import assert from "node:assert/strict";
import test from "node:test";
import { missingFontsFromMessage } from "./font-error.ts";

test("missing font worker errors become a normalized font list", () => {
  assert.deepEqual(
    missingFontsFromMessage("MISSING_FONTS: PowerPoint cannot find these source fonts: A Font, B Font, A Font."),
    ["A Font", "B Font"],
  );
  assert.deepEqual(missingFontsFromMessage("UNSUPPORTED_DOCUMENT: test"), []);
});

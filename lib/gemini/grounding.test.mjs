import assert from "node:assert/strict";
import test from "node:test";
import { extractGeminiGrounding } from "./grounding.ts";

test("Gemini 검색 근거의 출처와 검색어를 중복 없이 추출한다", () => {
  const result = extractGeminiGrounding({
    candidates: [{
      groundingMetadata: {
        webSearchQueries: ["지원사업 공식 공고", "지원사업 공식 공고"],
        groundingChunks: [
          { web: { title: "기업마당", uri: "https://www.bizinfo.go.kr/example" } },
          { web: { title: "중복", uri: "https://www.bizinfo.go.kr/example" } },
          { web: { title: "K-Startup", uri: "https://www.k-startup.go.kr/example" } },
        ],
      },
    }],
  });
  assert.deepEqual(result.searchQueries, ["지원사업 공식 공고"]);
  assert.deepEqual(result.groundingSources, [
    { title: "기업마당", url: "https://www.bizinfo.go.kr/example" },
    { title: "K-Startup", url: "https://www.k-startup.go.kr/example" },
  ]);
});

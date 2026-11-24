import assert from "node:assert/strict";
import test from "node:test";
import { CITATION_BOT_NAMES, isCitationBot } from "./citation-bots.ts";
import { BOT_PATTERNS, detectBot } from "./bot-detection.ts";

/**
 * 이 파일이 지키는 것은 세 가지입니다.
 *
 *  1. 인용 목록의 이름이 `bot-detection.ts` 가 실제로 붙이는 이름과 **글자까지 같은지**.
 *     한 글자라도 다르면 그 봇은 영원히 0건으로 집계되고, 아무도 눈치채지 못합니다.
 *     로닛에서 `OAI-SearchBot` 이 목록에 없어 2026-09부터 인용 집계가 통째로 샌 적이 있습니다.
 *  2. 학습 크롤러가 인용으로 섞여 들어가지 않는지.
 *  3. 로닛이 검토해서 뺀 것들이 다시 들어오지 않았는지.
 */
test("인용 목록의 이름이 실제로 붙는 봇 이름과 같다", () => {
  const detectable = new Set(BOT_PATTERNS.map((entry) => entry.name));
  for (const name of CITATION_BOT_NAMES) {
    assert.ok(detectable.has(name), `${name} 은 bot-detection.ts 가 붙이는 이름이 아니다`);
  }
});

test("실물 user-agent 가 인용으로 잡힌다", () => {
  const agents = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +claude-user@anthropic.com)",
    "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  ];
  for (const agent of agents) {
    assert.ok(isCitationBot(detectBot(agent).name), agent);
  }
});

test("학습 크롤러는 인용이 아니다", () => {
  const trainers = [
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "CCBot/2.0 (https://commoncrawl.org/faq/)",
    "Mozilla/5.0 (compatible; Google-Extended)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  ];
  for (const agent of trainers) {
    assert.equal(isCitationBot(detectBot(agent).name), false, agent);
  }
});

/**
 * 아래는 로닛이 2026-10 ~ 2026-11-23 사이에 재 보고 **뺀** 것들입니다.
 * 이름이 그럴듯해서 다시 넣고 싶어지는 것들이라 못을 박아 둡니다.
 */
test("로닛이 검토해서 뺀 것들은 인용에 들어오지 않는다", () => {
  const excluded = [
    ["meta-webindexer", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))"],
    ["Claude-SearchBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +claudebot@anthropic.com)"],
    ["Reflectionbot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Reflectionbot/1.0; +https://reflection.ai/bot) Chrome/151.0.0.0 Safari/537.36"],
    ["ExaSearchBot", "Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)"],
  ];
  for (const [label, agent] of excluded) {
    assert.equal(isCitationBot(detectBot(agent).name), false, label);
  }
});

test("빈 값과 모르는 이름은 인용이 아니다", () => {
  assert.equal(isCitationBot(null), false);
  assert.equal(isCitationBot(""), false);
  assert.equal(isCitationBot("unknown-bot"), false);
  assert.equal(isCitationBot("Automated tool"), false);
});

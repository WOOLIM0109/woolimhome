import assert from "node:assert/strict";
import test from "node:test";
import { detectBot } from "./bot-detection.ts";

/**
 * 아래 user-agent 는 모두 **운영 기록에서 그대로 복사한 실물**입니다
 * (2026-11-24, 30일 4,410건 전수 읽기). 지어낸 문자열이 아닙니다.
 *
 * 이 파일이 지키는 것은 두 가지입니다.
 *  - 이름을 붙인 봇이 다시 `unknown-bot` 한 덩어리로 돌아가지 않는 것
 *  - 용도를 확인하지 못한 봇을 `ai` 로 올리지 않는 것. 그러면 「AI가 우리를
 *    읽었다」는 숫자가 부풀어 판단을 망친다
 */
const REAL_AGENTS = [
  ["Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)", "ExaSearchBot", "ai"],
  ["Mozilla/5.0 (compatible; ExaUser/1.0; +https://exauser.crawler.exa.ai)", "ExaUser", "ai"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Reflectionbot/1.0; +https://reflection.ai/bot) Chrome/151.0.0.0 Safari/537.36", "Reflectionbot", "ai"],
  ["Mozilla/5.0 (compatible; SERankingBacklinksBot/1.0; +https://seranking.com/backlinks-crawler)", "SERankingBacklinksBot", "seo"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))", "meta-webindexer", "search"],
  ["Mozilla/5.0 (Linux; Android 7.0;) AppleWebKit/537.36 (HTML, like Gecko) Mobile Safari/537.36 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)", "PetalBot", "search"],
  ["Mozilla/5.0 (compatible; KakaoBot/1.0; +https://cs.kakao.com/helps_html/1073213012)", "KakaoBot", "search"],
  ["RecordedFuture Global Inventory Crawler", "RecordedFuture Crawler", "monitoring"],
  ["AgentTrustBot/1.0 (id=f9388109293d; +https://agenttru.st/crawler; purpose=AI agent directory; contact=admin@agenttru.st)", "AgentTrustBot", "tool"],
  ["domains-crawler/0.1 (+ads.txt survey; one request per domain)", "domains-crawler", "tool"],
  ["OpenX-BusinessContactFinder/1.0 (+local-user-operated; respects-robots)", "OpenX-BusinessContactFinder", "tool"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ShapBot/0.1.0", "ShapBot", "unknown"],
  ["Mozilla/5.0 (compatible; webXtrendBot/1.1; +https://webxtrend.com/crawler)", "webXtrendBot", "unknown"],
  ["Mozilla/5.0 (compatible; wpbot/1.4; +https://forms.gle/ajBaxygz9jSR8p8G9)", "wpbot", "unknown"],
];

test("이름 붙인 봇 14종이 각자 제 이름과 분류로 잡힌다", () => {
  for (const [agent, name, category] of REAL_AGENTS) {
    const hit = detectBot(agent);
    assert.ok(hit, agent);
    assert.equal(hit.name, name, agent);
    assert.equal(hit.category, category, agent);
  }
});

test("그중 하나도 unknown-bot 덩어리로 돌아가지 않는다", () => {
  for (const [agent] of REAL_AGENTS) {
    assert.notEqual(detectBot(agent).name, "unknown-bot", agent);
  }
});

test("용도를 확인하지 못한 셋은 ai 로 올라가지 않는다", () => {
  for (const name of ["ShapBot", "webXtrendBot", "wpbot"]) {
    const entry = REAL_AGENTS.find(([, botName]) => botName === name);
    assert.equal(detectBot(entry[0]).category, "unknown", name);
  }
});

/**
 * 새 패턴을 기존 봇 앞에 끼워 넣었으므로, 먼저 잡혀야 하는 것들이 가려지지
 * 않았는지 확인합니다. 특히 meta-webindexer 와 meta-externalagent 는 다른 봇입니다.
 */
test("기존 봇이 새 패턴에 가려지지 않는다", () => {
  const unchanged = [
    ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", "Meta AI", "ai"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot", "OAI-SearchBot", "ai"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Yeti/1.1; +https://naver.me/spd) Chrome/153.0.0.0 Safari/537.36", "Yeti", "search"],
    ["facebookexternalhit/1.1; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984", "kakaotalk-scrap", "social"],
    ["Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)", "SemrushBot", "seo"],
  ];
  for (const [agent, name, category] of unchanged) {
    const hit = detectBot(agent);
    assert.equal(hit.name, name, agent);
    assert.equal(hit.category, category, agent);
  }
});

/**
 * 가장 큰 덩어리인 HeadlessChrome 2,988건은 **아직 누구인지 모릅니다.**
 * 배포가 많은 날과 겹치지만 어긋나는 날도 있어 배포 때문이라고 말할 수 없고,
 * 이 저장소에는 headless 브라우저를 쓰는 코드가 없습니다. 그래서 이름을 지어
 * 붙이지 않고 「자동화 도구」에 그대로 둡니다. 여기서 확인하는 것은 누군가
 * 추측으로 이것을 자사나 ai 로 옮기지 않았는지입니다.
 */
test("정체 모르는 HeadlessChrome 은 자동화 도구에 그대로 둔다", () => {
  const hit = detectBot("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.0 Safari/537.36");
  assert.equal(hit.category, "tool");
  assert.equal(hit.name, "Automated tool");
});

test("봇이 아닌 보통 브라우저는 잡지 않는다", () => {
  assert.equal(detectBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"), null);
  assert.equal(detectBot(""), null);
  assert.equal(detectBot(null), null);
});

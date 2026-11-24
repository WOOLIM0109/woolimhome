/**
 * citation-bots.ts — 「인용」 집계 기준
 *
 * **인용 봇** = 사용자가 물었을 때 그 답을 만들려고 **실시간으로** 페이지를 가져가는 봇.
 * 학습용으로 긁어 모으는 크롤러(`GPTBot`·`CCBot`·`Google-Extended` 등)와 구분합니다.
 *
 * 왜 나눠야 하는가 — 둘을 합치면 숫자가 뜻을 잃습니다. 2026-11-24 기준 울림의 30일
 * AI 분류는 603건인데, 그 안에 학습 크롤러와 `ExaSearchBot` 전수 훑기가 섞여 있어
 * 「AI가 우리를 답에 썼나」를 보려 해도 보이지 않습니다. 실시간 인출만 세면 274건입니다.
 *
 * **이 숫자의 뜻을 넘겨 읽지 말 것.** 「실시간으로 가져갔다」까지가 사실이고,
 * 「AI 답에 실렸다」는 아닙니다. 로닛에서 2026-11-23에 이 둘을 섞어 말한 것을
 * 정정했습니다 — 로그는 **수집량**입니다. 실제 인용은 ChatGPT 에 직접 물어서만 셉니다.
 *
 * 목록은 로닛 `frontend/lib/citation-bots.ts` 와 **일부러 똑같이** 맞췄습니다.
 * 두 회사 숫자를 나란히 놓고 볼 일이 생기는데, 기준이 다르면 비교가 안 됩니다.
 * 로닛 쪽을 고치면 이 파일도 같이 고쳐야 합니다.
 *
 * 로닛이 검토해서 **뺀** 것들 (2026-10 ~ 2026-11-23):
 *  - `meta-webindexer` — 경로당 반복이 많아 인용으로 봤다가 정정. 한 번에 몰아 훑어도
 *    같은 값이 올라간다. 울림에서도 37건이 2026-11-21 한 시각에 몰려 있다.
 *  - `Claude-SearchBot` — 인용 대상 페이지 0건
 *  - `xAI-SearchBot`·`Reflectionbot` 등 — 경로당 1~2회, 전수 훑기 형태
 *
 * 울림에서 아직 판정하지 않은 것: `ExaUser` 26건. 이름 모양은 `ChatGPT-User` 와 같은
 * 「사용자 질의」 계열이지만, 경로당 반복을 재 보지 않았습니다. 재 보고 넣을지 정합니다.
 */

/** 인용 봇 이름. `lib/bot-detection.ts` 가 붙이는 `name` 과 같아야 합니다. */
export const CITATION_BOT_NAMES = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
] as const;

/** 판정용 Set. */
export const CITATION_BOTS: ReadonlySet<string> = new Set(CITATION_BOT_NAMES);

export function isCitationBot(botName: string | null | undefined): boolean {
  return !!botName && CITATION_BOTS.has(botName);
}

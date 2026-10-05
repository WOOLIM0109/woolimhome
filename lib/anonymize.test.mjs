import assert from "node:assert/strict";
import test from "node:test";
import "./testing/server-only.mjs";
const { clients, getClient } = await import("../data/clients.ts");
const { clientDisplayName, findClientDisplayCollisions } = await import("./anonymize.ts");
const { portfolioProjects } = await import("../data/content.ts");
const { getSuccessLedger } = await import("../data/success-ledger.ts");
const { getPublicPortfolioProjects, getPublicDesignProjects, getPublicLogoClients } = await import("../data/public-content.ts");
const { getConsultingCases, getPptCases } = await import("../data/success-content.ts");

test("서로 다른 고객사 키는 같은 화면 표기를 공유하지 않는다", () => {
  assert.equal(new Set(clients.map((item) => item.key)).size, clients.length);
  assert.deepEqual(findClientDisplayCollisions(clients), []);
  assert.deepEqual(findClientDisplayCollisions([clients[0], { ...clients[0] }]), []);
  assert.equal(findClientDisplayCollisions([clients[0], { ...clients[0], key: "different-client" }]).length, 1);
  for (const item of clients) {
    assert.ok(item.industry);
    assert.match(item.initial, /^[A-Z]?$/);
    assert.ok(["initial", "public"].includes(item.disclosure));
  }
});

test("원장·포트폴리오의 모든 키가 등록되어 있고 동일 키는 같은 표기를 사용한다", async () => {
  const ledger = await getSuccessLedger();
  assert.equal(portfolioProjects.length, 50);
  for (const item of [...portfolioProjects, ...ledger]) assert.ok(getClient(item.clientKey));
  const cases = [...await getConsultingCases(), ...(await getPptCases()).flatMap((group) => group.items)];
  const displays = [
    ...getPublicPortfolioProjects().map((item) => ({ key: item.clientKey, label: item.company })),
    ...getPublicDesignProjects().map((item) => ({ key: item.clientKey, label: item.client })),
    ...getPublicLogoClients().map((item) => ({ key: item.clientKey, label: item.name })),
    ...cases.map((item) => ({ key: item.clientKey, label: item.company })),
  ];
  for (const item of displays) assert.equal(item.label, clientDisplayName(getClient(item.key)));
  const mirae = getClient("mirae");
  assert.deepEqual([mirae.realName, ...mirae.aliases], ["미래아이앤택", "미래아이엔텍"]);
  assert.deepEqual(portfolioProjects.filter((item) => item.clientKey === "mirae").map((item) => item.id), ["mirae-int", "mirae-service"]);
  assert.equal(ledger.find((item) => item.id === "cj-si").clientKey, "mirae");
  assert.equal(portfolioProjects.filter((item) => item.clientKey === "pamity").length, 3);
});

test("공개 지정 네 기관과 발주처·입점처는 유지하고 공개 데이터에 내부 실명·별칭을 싣지 않는다", async () => {
  const portfolio = getPublicPortfolioProjects();
  assert.deepEqual(portfolio.filter((item) => getClient(item.clientKey).disclosure === "public").map((item) => item.company).sort(), ["한국수자원공사", "광주소방서", "청곡종합사회복지관", "한국건설직업전문학교"].sort());
  const publicData = JSON.stringify([portfolio, getPublicDesignProjects(), getPublicLogoClients(), await getConsultingCases(), await getPptCases()]);
  for (const name of ["온누리스토어", "킵유", "더블유포지션", "파미티", "삼성화재", "SK케미칼", "롯데웰푸드", "미래아이앤택", "미래아이엔텍", "판토모나"]) assert.ok(!publicData.includes(name), name);
  assert.ok(!publicData.includes('"realName"'));
  assert.ok(!publicData.includes('"aliases"'));
  const cases = JSON.stringify(await getPptCases());
  for (const name of ["CJ올리브네트웍스", "부산 금정구", "광양", "다이소", "홈플러스", "CJ온스타일", "무신사", "현대캐피탈", "카카오톡 선물하기", "더현대", "부평소방서", "롯데케미칼"]) assert.ok(cases.includes(name), name);
  for (const item of getPublicDesignProjects()) for (const image of item.images) assert.ok(image.alt.startsWith(item.client));
});

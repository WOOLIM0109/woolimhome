import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeGeneratedHtml } from "../security/html.ts";
import { countDiagrams, diagramIssues, diagramsEnabled, stripDiagrams } from "./diagram.ts";

const GOOD = `<svg viewBox="0 0 400 120" role="img" aria-label="1라운드에서 파이널까지">
<title>모두의 창업 단계별 지원금</title>
<desc>1라운드 300만 원에서 파이널 5억 원까지 네 단계로 이어집니다.</desc>
<defs><marker id="tip-1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
<path d="M0 0 L10 5 L0 10 z" fill="#7a716b"/></marker></defs>
<rect x="0" y="20" width="180" height="80" rx="12" fill="#fff3ea" stroke="#ef762f" stroke-width="2"/>
<text x="90" y="66" text-anchor="middle" font-size="18" fill="#241a15" font-weight="700">1라운드 300만 원</text>
<line x1="190" y1="60" x2="215" y2="60" stroke="#7a716b" stroke-width="2" marker-end="url(#tip-1)"/>
</svg>`;

test("정상 도식은 손실 없이 통과한다", () => {
  const out = sanitizeGeneratedHtml(GOOD);
  for (const tag of ["svg", "title", "desc", "defs", "marker", "path", "rect", "text", "line"]) {
    assert.match(out, new RegExp(`<${tag}[\\s>]`), `${tag} 태그가 사라졌습니다.`);
  }
  assert.match(out, /viewbox=/i, "viewBox 가 사라졌습니다. 폰에서 잘립니다.");
  assert.match(out, /모두의 창업 단계별 지원금/, "제목이 사라졌습니다.");
  assert.match(out, /1라운드 300만 원/, "도식 안 한글이 사라졌습니다.");
  assert.match(out, /marker-end="url\(#tip-1\)"/, "화살촉 연결이 끊겼습니다.");
  assert.match(out, /stroke="#ef762f"/, "선 색이 사라졌습니다.");
  assert.match(out, /fill="#fff3ea"/, "채움 색이 사라졌습니다.");
  assert.deepEqual(diagramIssues(GOOD, out), []);
});

test("그림 속에 심은 코드는 전부 걸러낸다", () => {
  const attacks = [
    ['<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>', /script/i],
    ['<svg viewBox="0 0 1 1" onload="alert(1)"><rect/></svg>', /onload/i],
    ['<svg viewBox="0 0 1 1"><rect onclick="alert(1)"/></svg>', /onclick/i],
    ['<svg viewBox="0 0 1 1"><foreignObject><iframe src="//x"></iframe></foreignObject></svg>', /foreignobject|iframe/i],
    ['<svg viewBox="0 0 1 1"><use href="//evil/x.svg#a"/></svg>', /<use/i],
    ['<svg viewBox="0 0 1 1"><image href="//evil/x.png"/></svg>', /<image/i],
    ['<svg viewBox="0 0 1 1"><animate attributeName="href" to="javascript:alert(1)"/></svg>', /animate/i],
    ['<svg viewBox="0 0 1 1"><set attributeName="href" to="javascript:alert(1)"/></svg>', /<set/i],
    ['<svg viewBox="0 0 1 1"><style>*{x:y}</style></svg>', /<style/i],
    ['<svg viewBox="0 0 1 1"><rect style="behavior:url(#x)"/></svg>', /style=/i],
  ];
  for (const [input, forbidden] of attacks) {
    const out = sanitizeGeneratedHtml(input);
    assert.doesNotMatch(out, forbidden, `걸러지지 않았습니다: ${input}`);
    assert.doesNotMatch(out, /alert\(1\)/, `실행 코드가 남았습니다: ${input}`);
  }
});

test("FAQ 칸에는 도식이 들어가지 못한다", async () => {
  const { sanitizeInlineHtml } = await import("../security/html.ts");
  const out = sanitizeInlineHtml('<svg viewBox="0 0 1 1"><text>숨은글자</text></svg>');
  // 태그도 안의 글자도 남으면 안 됩니다. 여기는 도식이 들어갈 자리가 아닙니다.
  assert.doesNotMatch(out, /<svg/i);
  assert.doesNotMatch(out, /숨은글자/);
});

test("도식은 본문 글자 수에서 빠진다", () => {
  const body = `<p>본문입니다.</p>${GOOD}<p>이어집니다.</p>`;
  const prose = stripDiagrams(body);
  assert.doesNotMatch(prose, /1라운드 300만 원/, "도식 라벨이 본문으로 세어집니다.");
  assert.match(prose, /본문입니다/);
  assert.match(prose, /이어집니다/);
  assert.equal(countDiagrams(body), 1);
});

test("잘린 도식을 잡아낸다", () => {
  // 허용 목록 밖 태그만 쓴 도식은 정리기가 통째로 지웁니다.
  const raw = '<svg viewBox="0 0 1 1"><foreignObject><p>글</p></foreignObject></svg>';
  const issues = diagramIssues(raw, sanitizeGeneratedHtml(raw));
  assert.ok(issues.length, "잘렸는데 아무 말도 하지 않습니다.");
});

test("검색 노출에 필요한 것이 빠지면 잡아낸다", () => {
  const noTitle = '<svg viewBox="0 0 1 1"><desc>설명</desc><text>글자</text></svg>';
  assert.match(diagramIssues(noTitle, noTitle).join(" "), /제목\(title\)이 없습니다/);

  const noDesc = '<svg viewBox="0 0 1 1"><title>제목</title><text>글자</text></svg>';
  assert.match(diagramIssues(noDesc, noDesc).join(" "), /설명\(desc\)이 없습니다/);

  const noViewBox = '<svg><title>제목</title><desc>설명</desc><text>글자</text></svg>';
  assert.match(diagramIssues(noViewBox, noViewBox).join(" "), /viewBox 가 없습니다/);

  const noText = '<svg viewBox="0 0 1 1"><title>제목</title><desc>설명</desc><rect/></svg>';
  assert.match(diagramIssues(noText, noText).join(" "), /글자가 하나도 없습니다/);
});

test("한 편에 여러 개면 잡아낸다", () => {
  const two = GOOD + GOOD;
  assert.match(diagramIssues(two, two).join(" "), /2개입니다/);
});

test("도식이 없으면 아무 말도 하지 않는다", () => {
  const body = "<p>표만 있는 글입니다.</p><table><tr><td>가</td></tr></table>";
  assert.deepEqual(diagramIssues(body, body), []);
});

test("스위치는 기본이 꺼짐이다", () => {
  // 켜 두고 배포했다가 도식이 깨지면 그 회차 칼럼이 그대로 영향을 받습니다.
  assert.equal(diagramsEnabled({}), false);
  assert.equal(diagramsEnabled({ COLUMN_DIAGRAMS: "false" }), false);
  assert.equal(diagramsEnabled({ COLUMN_DIAGRAMS: "1" }), false);
  assert.equal(diagramsEnabled({ COLUMN_DIAGRAMS: "true" }), true);
});

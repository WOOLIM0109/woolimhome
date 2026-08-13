import assert from "node:assert/strict";
import test from "node:test";

import { swapPortfolioBodyImages } from "./body-layout.ts";

function 본문(그림수) {
  let html = "<p>머리말입니다.</p>";
  for (let index = 1; index <= 그림수; index += 1) {
    html += `<h2>소제목 ${index}</h2><p>설명 ${index}</p>`
      + `<figure><img src="/old/${index}.jpg" alt="예전 그림 ${index}">`
      + `<figcaption>예전 설명 ${index}</figcaption></figure>`;
  }
  return html;
}

function 그림주소(html) {
  return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi)].map((match) => match[1]);
}

test("그림 수가 같으면 순서대로 갈아 끼운다", () => {
  const result = swapPortfolioBodyImages(본문(3), ["/new/a.jpg", "/new/b.jpg", "/new/c.jpg"]);
  assert.deepEqual(그림주소(result.bodyHtml), ["/new/a.jpg", "/new/b.jpg", "/new/c.jpg"]);
  assert.equal(result.replaced, 3);
});

test("새 그림이 모자라면 남는 자리는 설명까지 뺀다", () => {
  // 실제로 보고된 현상: 원본을 다시 변환해 목업 장수가 줄면
  // 예전 방식은 통째로 실패해 '이미지만 다시 만들기'가 영영 막혔습니다.
  const result = swapPortfolioBodyImages(본문(5), ["/new/a.jpg", "/new/b.jpg", "/new/c.jpg"]);
  assert.deepEqual(그림주소(result.bodyHtml), ["/new/a.jpg", "/new/b.jpg", "/new/c.jpg"]);
  assert.ok(!result.bodyHtml.includes("예전 설명 4"));
  assert.ok(!result.bodyHtml.includes("예전 설명 5"));
  // 글은 그대로 남습니다.
  assert.ok(result.bodyHtml.includes("소제목 5"));
});

test("새 그림이 더 많으면 있는 자리까지만 채운다", () => {
  const result = swapPortfolioBodyImages(본문(2), ["/new/a.jpg", "/new/b.jpg", "/new/c.jpg"]);
  assert.deepEqual(그림주소(result.bodyHtml), ["/new/a.jpg", "/new/b.jpg"]);
  assert.equal(result.replaced, 2);
});

test("예전 주소와 달라도 자리 순서로 갈아 끼운다", () => {
  // 저장해 둔 목록과 본문이 어긋나 실패하던 경우입니다.
  const html = '<p>글</p><figure><img src="/전혀/다른/주소.png"></figure>';
  const result = swapPortfolioBodyImages(html, ["/new/a.jpg"]);
  assert.deepEqual(그림주소(result.bodyHtml), ["/new/a.jpg"]);
});

test("figure 로 감싸지 않은 예전 본문도 바꾼다", () => {
  const html = '<p>글</p><img src="/old/1.jpg"><p>다음 글</p><img src="/old/2.jpg">';
  const result = swapPortfolioBodyImages(html, ["/new/a.jpg", "/new/b.jpg"]);
  assert.deepEqual(그림주소(result.bodyHtml), ["/new/a.jpg", "/new/b.jpg"]);
});

test("바꿀 그림이 없으면 만들지 않는다", () => {
  assert.equal(swapPortfolioBodyImages("<p>그림 없는 글</p>", ["/new/a.jpg"]), null);
  assert.equal(swapPortfolioBodyImages(본문(2), []), null);
  assert.equal(swapPortfolioBodyImages("", ["/new/a.jpg"]), null);
});

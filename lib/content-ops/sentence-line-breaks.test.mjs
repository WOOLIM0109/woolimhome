import assert from "node:assert/strict";
import test from "node:test";
import htmlParser from "next/dist/compiled/node-html-parser/index.js";
import { formatSentenceLineBreaks } from "./sentence-line-breaks.ts";

const {
  HTMLElement,
  Node: HtmlNode,
  TextNode,
  parse,
} = htmlParser;

function installDomShim() {
  if (!Object.getOwnPropertyDescriptor(HtmlNode.prototype, "nextSibling")) {
    Object.defineProperty(HtmlNode.prototype, "nextSibling", {
      configurable: true,
      get() {
        const siblings = this.parentNode?.childNodes || [];
        const index = siblings.indexOf(this);
        return index >= 0 ? siblings[index + 1] || null : null;
      },
    });
  }
  if (!Object.getOwnPropertyDescriptor(TextNode.prototype, "nodeValue")) {
    Object.defineProperty(TextNode.prototype, "nodeValue", {
      configurable: true,
      get() {
        return this.rawText;
      },
    });
  }
  if (!TextNode.prototype.replaceWith) {
    TextNode.prototype.replaceWith = function replaceWith(fragment) {
      const parent = this.parentNode;
      if (!parent) return;
      const index = parent.childNodes.indexOf(this);
      if (index < 0) return;
      const replacements = Array.isArray(fragment?.childNodes)
        ? fragment.childNodes
        : [fragment];
      replacements.forEach((node) => {
        node.parentNode = parent;
      });
      parent.childNodes.splice(index, 1, ...replacements);
      this.parentNode = null;
    };
  }

  globalThis.Element = HTMLElement;
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.DOMParser = class DOMParser {
    parseFromString(html) {
      const body = parse(html);
      return {
        body,
        createTreeWalker(container) {
          const textNodes = [];
          const visit = (node) => {
            for (const child of node.childNodes || []) {
              if (child.nodeType === 3) textNodes.push(child);
              visit(child);
            }
          };
          visit(container);
          let index = -1;
          return {
            currentNode: container,
            nextNode() {
              index += 1;
              if (index >= textNodes.length) return null;
              this.currentNode = textNodes[index];
              return this.currentNode;
            },
          };
        },
        createDocumentFragment() {
          return {
            childNodes: [],
            append(node) {
              this.childNodes.push(node);
            },
          };
        },
        createTextNode(value) {
          return new TextNode(value);
        },
        createElement(tagName) {
          return new HTMLElement(tagName, {}, "", null);
        },
      };
    }
  };
}

installDomShim();

test("문장 종결 기호 뒤에 빈 한 줄을 만든다", () => {
  assert.equal(
    formatSentenceLineBreaks("<p>첫 문장입니다. 다음 문장인가요? 맞습니다!</p>"),
    "<p>첫 문장입니다.<br><br>다음 문장인가요?<br><br>맞습니다!<br><br></p>",
  );
});

test("이미 적용된 문장 줄바꿈은 다시 늘어나지 않는다", () => {
  const once = formatSentenceLineBreaks("<p>첫 문장입니다. 다음 문장입니다.</p>");
  const twice = formatSentenceLineBreaks(once);

  assert.equal(twice, once);
  assert.doesNotMatch(twice, /(?:<br>){3,}/);
});

test("기존에 중복된 문장 줄바꿈은 두 개로 정규화한다", () => {
  assert.equal(
    formatSentenceLineBreaks("<p>첫 문장입니다.<br><br><br><br>다음 문장입니다.</p>"),
    "<p>첫 문장입니다.<br><br>다음 문장입니다.<br><br></p>",
  );
});

test("Q.와 A. 접두어 뒤에는 줄바꿈을 만들지 않는다", () => {
  assert.equal(
    formatSentenceLineBreaks("<p>Q. 준비할 자료가 있나요?</p><p>A. 사업계획서를 준비하세요.</p>"),
    "<p>Q. 준비할 자료가 있나요?<br><br></p><p>A. 사업계획서를 준비하세요.<br><br></p>",
  );
});

test("figure 안의 캡션은 원문을 유지한다", () => {
  assert.equal(
    formatSentenceLineBreaks("<p>본문입니다.</p><figure><figcaption>이미지 설명입니다.</figcaption></figure>"),
    "<p>본문입니다.<br><br></p><figure><figcaption>이미지 설명입니다.</figcaption></figure>",
  );
});

/**
 * 문장마다 줄을 바꿔 저장하기
 *
 * "한 줄에 정보 하나"가 원고 규칙입니다.
 * 그런데 줄바꿈을 넣는 일은 화면에서 그릴 때만 하고 있었습니다.
 * 그러다 보니 화면마다 다르게 보였고, 본문 미리보기에는 아예 적용되지 않아
 * 규칙이 안 지켜진 것처럼 보였습니다. 실제로 그런 문의가 들어왔습니다.
 *
 * 그래서 만들 때 아예 줄바꿈을 넣어 저장합니다.
 * 화면, 외주 작업실, 복사한 게시문이 모두 같은 모습이 됩니다.
 *
 * 서버에서도 돌아야 하므로 브라우저 DOM 을 쓰지 않습니다.
 * 태그와 글자를 나눠 훑고, 글자 부분만 손댑니다.
 */

/** 문장이 끝났다고 보는 자리. 닫는 따옴표와 괄호까지 한 덩어리로 봅니다. */
const SENTENCE_END = /([.!?。？！]["'”’」』)\]]*)(\s+)/g;

/**
 * 줄바꿈을 넣지 않는 구역.
 *
 * 그림 설명은 짧아서 끊으면 오히려 어색합니다.
 *
 * 표와 도식은 다른 이유입니다. 표 칸 안에 빈 줄이 들어가면 칸이 세로로 늘어나
 * 표가 망가지고, 도식 안의 <text> 에 <br> 이 들어가면 그림이 통째로 깨집니다.
 * 지금까지 이 문제가 드러나지 않은 것은 이 기능을 블로그에만 썼고 블로그는
 * 표를 쓸 수 없기 때문입니다. 칼럼은 표와 도식을 둘 다 씁니다.
 */
const SKIP_TAGS = [
  "figure", "figcaption", "h2", "h3", "h4",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup",
  "svg",
];

const BREAK = "<br><br>";

/**
 * 앞 조각이 문장으로 끝났는지 봅니다.
 *
 * 굵은 글씨나 링크로 문장이 끝나면 마침표와 뒤따르는 공백이
 * 서로 다른 조각으로 갈라집니다. 그때도 줄을 바꿔야 합니다.
 * 문단·목록처럼 덩어리를 닫는 태그는 제외합니다. 이미 줄이 나뉘어 있습니다.
 */
const INLINE_SENTENCE_TAIL = /[.!?。？！]["'”’」』)\]]*(?:<\/(?:strong|em|b|i|a|span)>)+\s*$/i;

function isOpeningTag(tag: string, name: string) {
  return new RegExp(`^<${name}(\\s|>|/)`, "i").test(tag);
}

function isClosingTag(tag: string, name: string) {
  return new RegExp(`^</${name}\\s*>`, "i").test(tag);
}

export function insertSentenceBreaks(html: string) {
  if (typeof html !== "string" || !html.includes("<")) return html;
  const pieces = html.split(/(<[^>]*>)/g);
  const openSkips: string[] = [];
  let result = "";

  for (const piece of pieces) {
    if (!piece) continue;
    if (piece.startsWith("<")) {
      for (const name of SKIP_TAGS) {
        if (isOpeningTag(piece, name) && !piece.endsWith("/>")) openSkips.push(name);
        else if (isClosingTag(piece, name)) {
          const at = openSkips.lastIndexOf(name);
          if (at >= 0) openSkips.splice(at, 1);
        }
      }
      result += piece;
      continue;
    }
    if (openSkips.length) {
      result += piece;
      continue;
    }
    // 문장이 굵은 글씨나 링크에서 끝난 경우, 이어지는 공백 자리에 줄을 바꿉니다.
    if (/^\s/.test(piece) && piece.trim() && INLINE_SENTENCE_TAIL.test(result)) {
      result += BREAK + piece.replace(/^\s+/, "");
      continue;
    }
    // 문장 사이에만 넣습니다. 마지막 문장 뒤에는 빈 줄을 남기지 않습니다.
    SENTENCE_END.lastIndex = 0;
    result += piece.replace(SENTENCE_END, (match, ending: string, spacing: string) => {
      void spacing;
      return `${ending}${BREAK}`;
    });
  }

  // 이미 줄바꿈이 있던 원고에 또 넣지 않도록 세 개 이상은 두 개로 줄입니다.
  return result.replace(/(?:<br\s*\/?>\s*){3,}/gi, BREAK);
}

/**
 * 원고 묶음에서 본문만 줄바꿈을 넣어 돌려줍니다.
 *
 * 줄바꿈은 규칙이 정해져 있어 사람 손도 인공지능도 필요하지 않습니다.
 * 그래서 말투를 다듬는 인공지능 호출과 떼어 놓습니다.
 * 인공지능이 실패해도 줄바꿈은 그대로 적용되게 하려는 목적입니다.
 *
 * 바뀐 것이 없으면 원래 객체를 그대로 돌려줍니다.
 */
export function bodyWithSentenceBreaks<T extends { bodyHtml: string }>(generated: T): T {
  if (!generated || typeof generated.bodyHtml !== "string") return generated;
  const bodyHtml = insertSentenceBreaks(generated.bodyHtml);
  return bodyHtml === generated.bodyHtml ? generated : { ...generated, bodyHtml };
}

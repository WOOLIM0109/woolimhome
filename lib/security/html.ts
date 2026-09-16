import sanitizeHtml from "sanitize-html";

const BLOCK_TAGS = ["script", "style", "iframe", "object", "embed", "form", "input", "button", "svg", "math"];

/**
 * 본문에서만 svg 를 살립니다.
 *
 * nonTextTags 에 이름이 있으면 태그뿐 아니라 안에 든 글자까지 통째로 버립니다.
 * 표는 허용 목록에 없었을 뿐이지만 도식은 여기에도 올라 있어서, 넣어도 흔적조차
 * 남지 않았습니다. 본문은 아래 허용 목록으로 안전하게 거르므로 여기서 뺍니다.
 * FAQ(sanitizeInlineHtml)는 도식이 들어갈 자리가 아니라 그대로 둡니다.
 */
const GENERATED_BLOCK_TAGS = BLOCK_TAGS.filter((tag) => tag !== "svg");

/**
 * 도식에 쓸 수 있는 태그. 도형을 그리는 데 필요한 것만 있습니다.
 *
 * 여기 없는 것은 저장할 때 사라집니다. 특히 아래 넷은 일부러 뺐습니다.
 * - foreignObject: 그림 안에 아무 HTML 이나 넣을 수 있습니다.
 * - use, image: 바깥 문서나 파일을 끌어옵니다.
 * - animate, set: 시간이 지나면 속성을 바꿔치기할 수 있습니다.
 *
 * 태그 이름은 소문자로 적습니다. 정리기가 비교하기 전에 소문자로 낮추기 때문입니다.
 * 브라우저는 인라인 도식을 읽을 때 lineargradient 를 linearGradient 로 되돌립니다.
 */
const SVG_TAGS = [
  "svg", "g", "defs", "marker", "path", "rect", "circle", "ellipse",
  "line", "polyline", "polygon", "text", "tspan", "title", "desc",
  "lineargradient", "stop",
];

/** 색과 선처럼 어느 도형에나 붙는 속성. */
const SVG_COMMON_ATTRS = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-opacity", "opacity", "transform", "id",
];

/** 화살촉처럼 같은 문서 안의 정의를 가리키는 속성. */
const SVG_MARKER_ATTRS = ["marker-start", "marker-mid", "marker-end"];

/**
 * 도식 태그별 허용 속성.
 *
 * 목록에 없는 속성은 전부 사라집니다. onclick 같은 이벤트 속성과 style 이
 * 여기 없는 것이 중요합니다. 색은 style 대신 fill·stroke 로 지정합니다.
 *
 * 속성 이름도 소문자입니다. viewBox 는 viewbox 로 들어오고, 브라우저가 화면에
 * 그릴 때 다시 viewBox 로 되돌립니다. 실제로 띄워서 확인했습니다.
 */
const SVG_ATTRIBUTES: Record<string, string[]> = {
  // width·height 는 일부러 뺐습니다. 크기를 고정하면 좁은 화면에서 잘립니다.
  svg: ["viewbox", "role", "aria-label", "aria-labelledby", "preserveaspectratio", ...SVG_COMMON_ATTRS],
  g: [...SVG_COMMON_ATTRS, ...SVG_MARKER_ATTRS],
  defs: SVG_COMMON_ATTRS,
  marker: ["viewbox", "refx", "refy", "markerwidth", "markerheight", "markerunits", "orient", ...SVG_COMMON_ATTRS],
  path: ["d", ...SVG_COMMON_ATTRS, ...SVG_MARKER_ATTRS],
  rect: ["x", "y", "width", "height", "rx", "ry", ...SVG_COMMON_ATTRS],
  circle: ["cx", "cy", "r", ...SVG_COMMON_ATTRS],
  ellipse: ["cx", "cy", "rx", "ry", ...SVG_COMMON_ATTRS],
  line: ["x1", "y1", "x2", "y2", ...SVG_COMMON_ATTRS, ...SVG_MARKER_ATTRS],
  polyline: ["points", ...SVG_COMMON_ATTRS, ...SVG_MARKER_ATTRS],
  polygon: ["points", ...SVG_COMMON_ATTRS, ...SVG_MARKER_ATTRS],
  text: ["x", "y", "dx", "dy", "text-anchor", "dominant-baseline", "font-size",
    "font-weight", "font-family", "letter-spacing", ...SVG_COMMON_ATTRS],
  tspan: ["x", "y", "dx", "dy", "text-anchor", "font-size", "font-weight", ...SVG_COMMON_ATTRS],
  lineargradient: ["x1", "y1", "x2", "y2", "gradientunits", ...SVG_COMMON_ATTRS],
  stop: ["offset", "stop-color", "stop-opacity", ...SVG_COMMON_ATTRS],
};

const generatedOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "blockquote",
    "a", "br", "figure", "figcaption", "img", "span", "section",
    // 비교 표는 글로 풀어 쓰기 어려운 내용을 한눈에 보여 줍니다. 예전에는
    // 이 태그들이 허용 목록에 없어서, 표를 넣어도 칸이 사라지고 글자만
    // 줄줄이 남았습니다. 표에는 스크립트가 붙을 자리가 없어 그대로 둡니다.
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "colgroup", "col",
    // 단계와 흐름은 글이나 표로 풀면 오히려 안 보입니다. 도식은 그런 자리에만 씁니다.
    ...SVG_TAGS,
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading"],
    figure: ["class"],
    figcaption: ["class"],
    section: ["class"],
    p: ["class"],
    span: ["class"],
    table: ["class"],
    // 칸 합치기와 머리글 방향은 표의 뜻을 이루는 정보라 살립니다.
    th: ["class", "colspan", "rowspan", "scope"],
    td: ["class", "colspan", "rowspan"],
    col: ["span"],
    colgroup: ["span"],
    ...SVG_ATTRIBUTES,
  },
  allowedClasses: {
    figure: ["*"],
    figcaption: ["*"],
    section: ["column-faq", "column-sources"],
    p: ["*"],
    span: ["*"],
    table: ["*"],
    th: ["*"],
    td: ["*"],
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: GENERATED_BLOCK_TAGS,
  enforceHtmlBoundary: true,
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: "a",
      attribs: {
        ...attribs,
        ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}),
      },
    }),
    img: (_tagName, attribs) => ({
      tagName: "img",
      attribs: { ...attribs, loading: attribs.loading || "lazy" },
    }),
  },
};

export function sanitizeGeneratedHtml(html: string) {
  return sanitizeHtml(String(html || ""), generatedOptions);
}

export function sanitizeInlineHtml(html: string) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: ["strong", "em", "br"],
    allowedAttributes: {},
    nonTextTags: BLOCK_TAGS,
    enforceHtmlBoundary: true,
  });
}

export function sanitizeWorkItemMetadata<T>(metadata: T): T {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const record = metadata as Record<string, unknown>;
  const generated = record.generated;
  if (!generated || typeof generated !== "object" || Array.isArray(generated)) return metadata;
  const generatedRecord = generated as Record<string, unknown>;
  const faq = Array.isArray(generatedRecord.faq)
    ? generatedRecord.faq.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const item = entry as Record<string, unknown>;
      return {
        ...item,
        question: typeof item.question === "string" ? sanitizeInlineHtml(item.question) : item.question,
        answer: typeof item.answer === "string" ? sanitizeInlineHtml(item.answer) : item.answer,
      };
    })
    : generatedRecord.faq;
  return {
    ...record,
    generated: {
      ...generatedRecord,
      bodyHtml: typeof generatedRecord.bodyHtml === "string"
        ? sanitizeGeneratedHtml(generatedRecord.bodyHtml)
        : generatedRecord.bodyHtml,
      faq,
    },
  } as T;
}

import sanitizeHtml from "sanitize-html";

const BLOCK_TAGS = ["script", "style", "iframe", "object", "embed", "form", "input", "button", "svg", "math"];

const generatedOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "blockquote",
    "a", "br", "figure", "figcaption", "img", "span", "section",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading"],
    figure: ["class"],
    figcaption: ["class"],
    section: ["class"],
    p: ["class"],
    span: ["class"],
  },
  allowedClasses: {
    figure: ["*"],
    figcaption: ["*"],
    section: ["column-faq", "column-sources"],
    p: ["*"],
    span: ["*"],
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: BLOCK_TAGS,
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

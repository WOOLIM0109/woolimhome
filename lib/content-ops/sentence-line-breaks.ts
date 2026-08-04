const SENTENCE_END = /([.!?。？！](?:["'”’」』)\]]*)?)(?:[ \t\r\n]+|$)/g;

function addBreaksToTextNodes(parsedDocument: Document, container: Element) {
  const walker = parsedDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue || "";
    SENTENCE_END.lastIndex = 0;
    if (!SENTENCE_END.test(value)) return;

    SENTENCE_END.lastIndex = 0;
    const fragment = parsedDocument.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = SENTENCE_END.exec(value))) {
      const isShortLabel = match[1].startsWith(".")
        && match.index === 1
        && /^[A-Z0-9]$/i.test(value[0]);
      if (isShortLabel) continue;
      fragment.append(parsedDocument.createTextNode(value.slice(cursor, match.index) + match[1]));
      fragment.append(parsedDocument.createElement("br"));
      cursor = match.index + match[0].length;
    }
    fragment.append(parsedDocument.createTextNode(value.slice(cursor)));
    textNode.replaceWith(fragment);
  });
}

export function formatSentenceLineBreaks(html: string) {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  const containers = [...parsedDocument.body.querySelectorAll("p, li, blockquote")]
    .filter((container) => !container.closest("figure"))
    .filter((container) => !container.querySelector("p, li, blockquote"));

  if (containers.length) {
    containers.forEach((container) => addBreaksToTextNodes(parsedDocument, container));
  } else {
    addBreaksToTextNodes(parsedDocument, parsedDocument.body);
  }

  return parsedDocument.body.innerHTML;
}

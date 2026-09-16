type Lock = {
  marker: string;
  value: string;
  block: boolean;
  ordered: boolean;
  sourceOrder: number;
};

export function markerLetters(value: number) {
  let result = "";
  let current = value;
  do {
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return result;
}

const NUMERIC_FACT_PATTERN = /\d[\d,.]*(?:\s?(?:%|억원|만원|원|년|개월|월|일|회|건|개|명|시간|분|점))?/g;

export function numericFacts(source: string) {
  return (String(source || "").match(NUMERIC_FACT_PATTERN) || []).toSorted();
}

export function assertSameNumericFacts(source: string, revised: string) {
  const before = numericFacts(source);
  const after = numericFacts(revised);
  if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
    const difference = (left: string[], right: string[]) => {
      const remaining = [...right];
      return left.filter((value) => {
        const index = remaining.indexOf(value);
        if (index < 0) return true;
        remaining.splice(index, 1);
        return false;
      });
    };
    const missing = difference(before, after);
    const added = difference(after, before);
    throw new Error(
      `원문의 수치가 누락·추가·변경되었습니다. 빠진 수치: ${missing.join(", ") || "없음"}; 추가·변경된 수치: ${added.join(", ") || "없음"}`,
    );
  }
}

export function lockValue(source: string, prefix: string, html = false, lockNumbers = true) {
  const locks: Lock[] = [];
  const add = (value: string, block = false, ordered = false) => {
    const marker = `WOOLIMLOCK${prefix}${markerLetters(locks.length)}END`;
    locks.push({ marker, value, block, ordered, sourceOrder: -1 });
    return marker;
  };
  let value = String(source || "");
  if (html) {
    value = value.replace(/<figure\b[\s\S]*?<\/figure>/gi, (match) => add(match, true, true));
    /*
     * figure 로 감싸지 않고 홀로 놓인 그림도 잠급니다.
     *
     * 잠그지 않으면 정리기가 <img> 를 허용 목록 밖 태그로 보고 걷어냅니다.
     * 주소만 잠긴 경우에도 주소는 태그 속성 안에 있어서 태그와 함께 사라집니다.
     * 그림이 빠진 본문은 승인 단계에서 "본문 이미지 URL이 목업 자산과 일치하지
     * 않습니다" 로 막히는데, 그때는 어디서 없어졌는지 알 수가 없습니다.
     */
    value = value.replace(/<img\b[^>]*>/gi, (match) => add(match, false, true));
    value = value.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (match) => add(match, false, true));
    value = value.replace(/https?:\/\/[^\s<>"']+/gi, (match) => add(match, false, true));
  }
  if (lockNumbers) {
    /*
     * 태그 안쪽의 숫자는 잠그지 않습니다.
     *
     * <h2> 의 2 까지 마커로 바꾸면 태그 이름이 <hWOOLIMLOCKBODYAEND> 가 됩니다.
     * 정리기는 그런 태그를 모르니 통째로 버리고, 그러면 되돌릴 때 마커가 없어
     * 그 구간을 전부 잃습니다. 소제목으로 시작하는 구간은 전부 여기서 죽었습니다.
     *
     * 지켜야 할 것은 사람이 읽는 수치이지 태그 이름의 숫자가 아닙니다.
     */
    value = html
      ? value
        .split(/(<[^>]*>)/g)
        .map((piece) => (
          piece.startsWith("<") && piece.endsWith(">")
            ? piece
            : piece.replace(NUMERIC_FACT_PATTERN, (match) => add(match))
        ))
        .join("")
      : value.replace(NUMERIC_FACT_PATTERN, (match) => add(match));
  }
  const sourceMarkers = value.match(/WOOLIMLOCK[A-Z]+?END/g) || [];
  const sourcePositions = new Map(sourceMarkers.map((marker, index) => [marker, index]));
  for (const lock of locks) lock.sourceOrder = sourcePositions.get(lock.marker) ?? -1;
  return { value, locks };
}

export function restoreLocked(source: string, locks: Lock[]) {
  let value = String(source || "");
  const actual = value.match(/WOOLIMLOCK[A-Z]+?END/g) || [];
  const expected = locks.map((lock) => lock.marker);
  const actualCounts = new Map<string, number>();
  for (const marker of actual) actualCounts.set(marker, (actualCounts.get(marker) || 0) + 1);
  if (actual.length !== expected.length || expected.some((marker) => actualCounts.get(marker) !== 1)) {
    throw new Error("보호한 수치·링크·이미지가 누락되거나 중복되었습니다.");
  }
  const orderedLocks = locks.filter((lock) => lock.ordered);
  const orderedMarkers = new Set(orderedLocks.map((lock) => lock.marker));
  const expectedOrdered = orderedLocks
    .toSorted((left, right) => left.sourceOrder - right.sourceOrder)
    .map((lock) => lock.marker);
  const actualOrdered = actual.filter((marker) => orderedMarkers.has(marker));
  if (actualOrdered.some((marker, index) => marker !== expectedOrdered[index])) {
    throw new Error("보호한 링크·이미지의 순서가 달라졌습니다.");
  }
  for (const lock of locks) {
    if (lock.block) {
      value = value.replace(new RegExp(`<p>\\s*${lock.marker}\\s*</p>`, "g"), lock.marker);
    }
    value = value.replaceAll(lock.marker, lock.value);
  }
  return value;
}

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

export function lockValue(source: string, prefix: string, html = false) {
  const locks: Lock[] = [];
  const add = (value: string, block = false, ordered = false) => {
    const marker = `WOOLIMLOCK${prefix}${markerLetters(locks.length)}END`;
    locks.push({ marker, value, block, ordered, sourceOrder: -1 });
    return marker;
  };
  let value = String(source || "");
  if (html) {
    value = value.replace(/<figure\b[\s\S]*?<\/figure>/gi, (match) => add(match, true, true));
    value = value.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (match) => add(match, false, true));
  }
  value = value.replace(
    /\d[\d,.]*(?:\s?(?:%|억원|만원|원|년|개월|월|일|회|건|개|명|시간|분|점))?/g,
    (match) => add(match),
  );
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

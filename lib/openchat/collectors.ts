import { normalizeText } from "./utils";
import type { CollectedProgram, OpenchatSource } from "./types";

const USER_AGENT = "Mozilla/5.0 (compatible; WoolimSupportCollector/1.0; +https://www.woolimcompany.kr/)";
const PROGRAM_KEYWORDS = /(지원사업|모집|공고|창업|사업화|R&D|연구개발|소상공인|기업지원|정책자금|바우처|시제품|판로|수출)/i;

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchFormJson<T>(url: string, values: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(values),
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function decodeAttribute(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function unique(programs: CollectedProgram[]) {
  const seen = new Set<string>();
  return programs.filter((program) => {
    const key = program.externalId || program.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectBizinfo(source: OpenchatSource) {
  const html = await fetchText(source.listing_url);
  const rows: CollectedProgram[] = [];
  const pattern = /<a\b([^>]*href\s*=\s*["']([^"']*selectSIIA200Detail\.do\?[^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] || "";
    const href = decodeAttribute(match[2]);
    const titleMatch = attributes.match(/title=["']([^"']+)["']/i);
    const title = normalizeText(titleMatch?.[1]?.replace(/\s*페이지 이동\s*$/, "") || match[3]);
    if (!title || !PROGRAM_KEYWORDS.test(title)) continue;
    const url = new URL(href, source.base_url).toString();
    const externalId = new URL(url).searchParams.get("pblancId");
    rows.push({ sourceKey: source.source_key, externalId, title, url });
  }
  return unique(rows);
}

async function collectKStartup(source: OpenchatSource) {
  const html = await fetchText(source.listing_url);
  const rows: CollectedProgram[] = [];
  const pattern = /<a\s+href=['"]javascript:go_view\((\d+)\);['"][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const externalId = match[1];
    const titleBlock = match[2];
    const title = normalizeText(titleBlock.match(/<p\s+class=["']tit["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || titleBlock);
    if (!title || !PROGRAM_KEYWORDS.test(title)) continue;
    const url = `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?pbancClssCd=PBC010&schM=view&pbancSn=${externalId}`;
    rows.push({ sourceKey: source.source_key, externalId, title, url });
  }
  return unique(rows);
}

type BusanStartupRow = {
  busi_code?: string;
  busi_title?: string;
  busi_comp?: string;
  busi_gubun?: string;
  appl_type?: string;
  appl_sdate?: string;
  appl_edate?: string;
  appl_stime?: string;
  appl_etime?: string;
  outbusi_url?: string;
  which_busi_nm?: string;
};

async function collectBusanStartup(source: OpenchatSource) {
  const payload = JSON.parse(await fetchText(source.listing_url)) as { list?: BusanStartupRow[] };
  return unique((payload.list || []).flatMap((row) => {
    if (!row.busi_code || !row.busi_title || !PROGRAM_KEYWORDS.test(row.busi_title)) return [];
    const detailUrl = `https://www.busanstartup.kr/biz_sup/${row.busi_code}?mcode=biz02&deadline=N`;
    const startsAt = row.appl_sdate && row.appl_sdate !== "9999-12-31"
      ? `${row.appl_sdate}T${row.appl_stime || "00:00:00"}+09:00`
      : null;
    const deadlineAt = row.appl_edate && row.appl_edate !== "9999-12-31"
      ? `${row.appl_edate}T${row.appl_etime || "23:59:59"}+09:00`
      : null;
    return [{
      sourceKey: source.source_key,
      externalId: row.busi_code,
      title: row.busi_title,
      url: detailUrl,
      startsAt,
      deadlineAt,
      applicationMethod: row.which_busi_nm || "온라인 접수",
      sourcePayload: {
        organization: row.busi_comp,
        category: row.busi_gubun,
        applicantType: row.appl_type,
        applicationUrl: row.outbusi_url,
      },
    }];
  }));
}

type FanfandaeroRow = {
  sprtBizCd?: string | number;
  sprtBizNm?: string;
  sprtBizTrgtCd?: string;
  sprtBizTrgtNm?: string;
  sprtBizTyNm?: string;
  sprtBizCtpvNm?: string;
  rcritBgngYmd?: string;
  rcritBgngTime?: string;
  rcritEndYmd?: string;
  rcritEndTime?: string;
  rcritEndChk?: string;
  txtDc?: string;
  aplyPsblYn?: string;
};

function fanfandaeroDate(value?: string, time?: string, fallback = "00:00:00") {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const digits = time?.replace(/\D/g, "") || "";
  const normalizedTime = digits.length >= 4
    ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6) || "00"}`
    : fallback;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${normalizedTime}+09:00`;
}

async function collectFanfandaero(source: OpenchatSource) {
  const payload = await fetchFormJson<{
    sprtBizApplList?: FanfandaeroRow[];
  }>("https://fanfandaero.kr/portal/v2/selectSprtBizPbancList.do", {
    brno: "",
    pageIndex: "1",
    pageUnit: "40",
    searchTypeStr: "",
    searchTargetStr: "",
    searchAreaStr: "",
    searchText: "",
    noSearchSprt: "",
    searchOrder: "1",
    sortOrder: "",
    testLoginId: "",
    notSearchSprtBizCd: "",
  });
  return unique((payload.sprtBizApplList || []).flatMap((row) => {
    const externalId = String(row.sprtBizCd || "");
    const title = normalizeText(row.sprtBizNm || "");
    if (!externalId || !title) return [];
    const smallBusinessOnly = row.sprtBizTrgtCd === "10003211";
    const detailUrl = new URL("/portal/v2/preSprtBizPbancDetail.do", source.base_url);
    detailUrl.searchParams.set("sprtBizCd", externalId);
    detailUrl.searchParams.set("sprtBizTrgtYn", smallBusinessOnly ? "Y" : "N");
    detailUrl.searchParams.set("groupNo", "");
    const startsAt = fanfandaeroDate(row.rcritBgngYmd, row.rcritBgngTime);
    const deadlineAt = row.rcritEndChk === "Y"
      ? null
      : fanfandaeroDate(row.rcritEndYmd, row.rcritEndTime, "23:59:59");
    return [{
      sourceKey: source.source_key,
      externalId,
      title,
      url: detailUrl.toString(),
      startsAt,
      deadlineAt,
      applicationMethod: "판판대로 온라인 접수",
      rawText: normalizeText([
        title,
        `지원대상 ${row.sprtBizTrgtNm || ""}`,
        `지원유형 ${row.sprtBizTyNm || ""}`,
        `지원지역 ${row.sprtBizCtpvNm || "전국"}`,
        `목적 ${row.txtDc || ""}`,
        row.rcritEndChk === "Y" ? "예산 소진 시까지" : "",
      ].join(" ")),
      sourcePayload: row as Record<string, unknown>,
    }];
  }));
}

async function collectGeneric(source: OpenchatSource) {
  const html = await fetchText(source.listing_url);
  const rows: CollectedProgram[] = [];
  const pattern = /<a\b([^>]*href\s*=\s*["']([^"'#]+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const attributes = match[1] || "";
    const titleAttribute = attributes.match(/title=["']([^"']+)["']/i)?.[1];
    const title = normalizeText(titleAttribute || match[3]);
    if (title.length < 8 || title.length > 220 || !PROGRAM_KEYWORDS.test(title)) continue;
    const rawHref = decodeAttribute(match[2]);
    if (/^(javascript:|mailto:|tel:)/i.test(rawHref)) continue;
    let url: string;
    try {
      url = new URL(rawHref, source.listing_url).toString();
    } catch {
      continue;
    }
    rows.push({ sourceKey: source.source_key, title, url });
  }
  return unique(rows).slice(0, 60);
}

async function hydrateCandidate(program: CollectedProgram) {
  if (program.rawText) return program;
  try {
    const html = await fetchText(program.url);
    return { ...program, rawText: normalizeText(html).slice(0, 12_000) };
  } catch (error) {
    return {
      ...program,
      rawText: program.title,
      sourcePayload: {
        ...(program.sourcePayload || {}),
        detailFetchError: error instanceof Error ? error.message : "상세 페이지 확인 실패",
      },
    };
  }
}

export async function collectSource(source: OpenchatSource) {
  if (source.collection_method === "manual") return [];
  let programs: CollectedProgram[];
  if (source.source_key === "bizinfo") programs = await collectBizinfo(source);
  else if (source.source_key === "kstartup") programs = await collectKStartup(source);
  else if (source.source_key === "busanstartup") programs = await collectBusanStartup(source);
  else if (source.source_key === "fanfandaero") programs = await collectFanfandaero(source);
  else programs = await collectGeneric(source);
  return programs;
}

export async function hydratePrograms(programs: CollectedProgram[], limit = 30) {
  const selected = programs.slice(0, limit);
  const hydrated: CollectedProgram[] = [];
  for (let index = 0; index < selected.length; index += 5) {
    hydrated.push(...await Promise.all(selected.slice(index, index + 5).map(hydrateCandidate)));
  }
  return hydrated;
}

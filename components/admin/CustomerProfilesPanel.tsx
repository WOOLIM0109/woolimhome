"use client";

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import {
  Badge,
  Notice,
  button,
  date,
  display,
  panel,
  readJson,
  useResource,
} from "./ProgramReviewOperations";

/**
 * 고객사 요건 화면.
 *
 * 고객 원본은 **울림웍스**입니다. 여기서는 지원사업 판정에만 필요한 칸을 덧붙입니다.
 * 울림웍스에 업종·매출·직원수·인증 칸이 없어서, 적어 두지 않으면 판정 축 7개 중
 * 5개가 비어 있고 모든 고객사가 '확인 필요' 로 남습니다.
 *
 * 판정 단위는 **사업자**입니다. 한 고객사에 사업자가 여럿일 수 있습니다.
 */

const API = "/api/admin/program-review";

type CustomerEntity = {
  id: string; entity_key: string; entity_name: string; business_number: string | null;
  profile: Record<string, unknown>; active: boolean; version: number;
  updated_by: string | null; updated_at: string; missing: string[];
};
type CustomerRow = {
  id: string; name: string; region: string | null; founded_on: string | null;
  display_status: string | null; contract_status: string | null; support_projects: number;
  consulting: boolean; entities: CustomerEntity[];
};
type CustomerList = {
  as_of: string; consulting_count: number; customers: CustomerRow[];
  orphans: (CustomerEntity & { customer_id: string })[];
};

const 빈칸이름: Record<string, string> = {
  region: "지역", founded_on: "설립일", business_type: "기업형태",
  industries: "업종", employees: "직원수", revenue_krw: "매출", certifications: "인증",
};

const 칸: readonly (readonly [string, string, string])[] = [
  ["entity_name", "사업자 이름", "주식회사 울림컴퍼니"],
  ["business_number", "사업자등록번호", "123-45-67890"],
  ["region", "지역", "부산 북구"],
  ["founded_on", "설립일", "2021-03-02"],
  ["business_type", "기업형태", "소상공인 / 중소기업"],
  ["industries", "업종 (쉼표로 구분)", "경영컨설팅업, 광고 대행업"],
  ["employees", "직원수", "3"],
  ["revenue_krw", "매출 (원)", "120000000"],
  ["certifications", "보유 인증 (쉼표로 구분)", "여성기업, 벤처기업"],
];

/** 쉼표로 적은 글을 목록으로. 비우면 '모른다' 로 남깁니다. */
function 목록으로(value: string) {
  const items = value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  return items.length ? items : null;
}
/** 비우면 null, 숫자가 아니면 NaN (화면에서 걸러 알려 줍니다). */
function 숫자로(value: string) {
  const trimmed = value.replace(/,/g, "").trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) && number >= 0 ? number : NaN;
}
function 글자로(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export default function CustomerProfilesPanel() {
  const [scope, setScope] = useState<"consulting" | "all">("consulting");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ customer: string; key: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  // 인증은 '적어 둔 것이 전부' 라고 확인해야 판정에 쓰입니다.
  // 확인 없이 '인증 없음' 으로 판정하면 받을 수 있는 공고를 놓칩니다.
  const [certificationsComplete, setCertificationsComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const list = useResource<CustomerList>(`${API}/customers`, revision);

  function 열기(customer: CustomerRow, entity?: CustomerEntity) {
    setMessage(""); setError("");
    setEditing({ customer: customer.id, key: entity?.entity_key ?? "" });
    setActive(entity?.active ?? true);
    setCertificationsComplete(entity?.profile.certifications_complete === true);
    setForm({
      entity_key: entity?.entity_key ?? "",
      entity_name: entity?.entity_name ?? customer.name,
      business_number: entity?.business_number ?? "",
      // 울림웍스에 적힌 값이 있으면 첫 값으로 깔아 둡니다. 고쳐 쓰셔도 됩니다.
      region: 글자로(entity?.profile.region ?? customer.region),
      founded_on: 글자로(entity?.profile.founded_on ?? customer.founded_on),
      business_type: 글자로(entity?.profile.business_type),
      industries: 글자로(entity?.profile.industries),
      employees: 글자로(entity?.profile.employees),
      revenue_krw: 글자로(entity?.profile.revenue_krw),
      certifications: 글자로(entity?.profile.certifications),
      notes: 글자로(entity?.profile.notes),
    });
  }

  async function 저장(customerId: string) {
    const employees = 숫자로(form.employees ?? "");
    const revenue = 숫자로(form.revenue_krw ?? "");
    if (Number.isNaN(employees)) { setError("직원수는 0 이상의 숫자로 적어 주세요."); return; }
    if (Number.isNaN(revenue)) { setError("매출은 0 이상의 숫자로 적어 주세요 (원 단위)."); return; }
    const founded = (form.founded_on ?? "").trim();
    if (founded && !/^\d{4}-\d{2}-\d{2}$/.test(founded)) {
      setError("설립일은 2021-03-02 처럼 적어 주세요."); return;
    }
    if (!(form.entity_name ?? "").trim()) { setError("사업자 이름을 적어 주세요."); return; }
    setBusy(true); setMessage(""); setError("");
    try {
      await readJson(`${API}/customers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          customer_id: customerId,
          entity_key: (form.entity_key ?? "").trim() || "main",
          entity_name: (form.entity_name ?? "").trim(),
          business_number: (form.business_number ?? "").trim() || null,
          active,
          profile: {
            region: (form.region ?? "").trim() || null,
            founded_on: founded || null,
            business_type: (form.business_type ?? "").trim() || null,
            industries: 목록으로(form.industries ?? ""),
            employees,
            revenue_krw: revenue,
            // 확인에 체크했으면 비워도 '없음을 확인했다' 는 뜻이라 빈 목록으로 보냅니다.
            certifications: 목록으로(form.certifications ?? "")
              ?? (certificationsComplete ? [] : null),
            certifications_complete: certificationsComplete,
            notes: (form.notes ?? "").trim() || null,
          },
        }),
      });
      setMessage("고객사 요건을 저장했습니다. 다음 매칭부터 이 값으로 판정합니다.");
      setEditing(null);
      setRevision((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  const rows = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return (list.data?.customers ?? [])
      // 요건을 적어 둔 고객사는 범위와 상관없이 보여 줍니다 — 적은 것이 사라지면 안 됩니다.
      .filter((row) => scope === "all" || row.consulting || row.entities.length > 0)
      .filter((row) => !text || row.name.toLocaleLowerCase().includes(text))
      .slice(0, 200);
  }, [list.data, scope, query]);

  if (list.loading) return <Notice>고객사 목록을 불러오고 있습니다.</Notice>;
  if (list.error) return <Notice error>{list.error}</Notice>;

  return <div className="space-y-5">
    <div>
      <h2 className="text-lg font-bold">고객사 요건</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        고객 원본은 <strong>울림웍스</strong>입니다. 여기서는 <strong>지원사업 판정에만 필요한 칸</strong>을 덧붙입니다.
        울림웍스에 업종·매출·직원수·인증 칸이 없어서, 적어 두지 않으면 판정이 모두 &lsquo;확인 필요&rsquo;로 남습니다.
        판정 단위는 <strong>사업자</strong>라 한 고객사에 사업자를 여럿 둘 수 있습니다.
      </p>
    </div>

    <div className={`${panel} flex flex-wrap items-center gap-3 p-4`}>
      <div className="flex flex-wrap gap-2" aria-label="고객사 범위">
        {([["consulting", `컨설팅 고객사 ${list.data?.consulting_count ?? 0}곳`], ["all", "전체 보기"]] as const)
          .map(([key, text]) => <button type="button" key={key} aria-pressed={scope === key}
            className={`${button} ${scope === key ? "border-stone-800 bg-stone-800 text-white hover:bg-stone-700" : ""}`}
            onClick={() => setScope(key)}>{text}</button>)}
      </div>
      <label className="ml-auto text-xs font-semibold text-stone-600">고객사 검색
        <div className="mt-1 flex min-w-56 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3">
          <Search size={16} aria-hidden="true" />
          <input type="search" className="min-h-10 w-full min-w-0 bg-transparent text-sm outline-none"
            placeholder="이름으로 좁히기" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </label>
    </div>

    {message ? <Notice>{message}</Notice> : null}
    {error ? <Notice error>{error}</Notice> : null}

    {!rows.length ? <Notice>표시할 고객사가 없습니다. 범위를 넓히거나 검색어를 지워 보세요.</Notice>
      : <div className="space-y-4">{rows.map((customer) => <article key={customer.id} className={`${panel} p-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold">{customer.name}</h3>
          {customer.display_status === "active" ? <Badge tone="green">진행 중</Badge> : null}
          {customer.contract_status === "contracted" ? <Badge tone="green">계약함</Badge> : null}
          {customer.support_projects > 0 ? <Badge>지원사업 {customer.support_projects}건</Badge> : null}
          {!customer.entities.length ? <Badge tone="amber">요건 미입력</Badge> : null}
        </div>
        <p className="mt-1 text-xs text-stone-500">
          울림웍스: 지역 {customer.region ?? "미확인"} · 설립일 {customer.founded_on ?? "미확인"}
        </p>

        <ul className="mt-4 divide-y divide-stone-100 rounded-xl border border-stone-200">
          {customer.entities.map((entity) => <li key={entity.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{entity.entity_name}</p>
              {entity.business_number ? <span className="text-xs text-stone-500">{entity.business_number}</span> : null}
              {!entity.active ? <Badge tone="amber">매칭에서 제외</Badge> : null}
              <button type="button" className={`${button} ml-auto`} onClick={() => 열기(customer, entity)}>고치기</button>
            </div>
            <p className="mt-2 text-xs leading-6 text-stone-600">
              지역 {display(entity.profile.region)} · 설립일 {display(entity.profile.founded_on)}
              {" · "}업종 {display(entity.profile.industries)} · 직원수 {display(entity.profile.employees)}
              {" · "}매출 {display(entity.profile.revenue_krw)}
            </p>
            {entity.missing.length
              ? <p className="mt-1 text-xs text-amber-800">
                아직 비어 있음: {entity.missing.map((key) => 빈칸이름[key] ?? key).join(", ")}</p>
              : <p className="mt-1 text-xs text-emerald-800">판정에 필요한 칸이 모두 찼습니다.</p>}
            <p className="mt-1 text-xs text-stone-400">{date(entity.updated_at)} · {entity.updated_by ?? "작성자 미상"}</p>
          </li>)}
          {!customer.entities.length
            ? <li className="p-4 text-sm text-stone-500">적어 둔 사업자가 없습니다.</li> : null}
        </ul>

        <button type="button" className={`${button} mt-3`} onClick={() => 열기(customer)}>사업자 추가</button>

        {editing?.customer === customer.id ? <form
          className="mt-4 space-y-3 rounded-xl border border-orange-200 bg-orange-50/40 p-4"
          onSubmit={(event) => { event.preventDefault(); void 저장(customer.id); }}>
          <p className="text-sm font-bold">{editing.key ? "사업자 요건 고치기" : "사업자 추가"}</p>
          <p className="text-xs leading-6 text-stone-600">
            모르는 칸은 <strong>비워 두세요.</strong> 비우면 &lsquo;모른다&rsquo;로 남습니다 — 0 으로 적으면 판정이 틀립니다.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {칸.map(([key, text, hint]) => <label key={key} className="text-xs font-semibold text-stone-600">{text}
              <input type="text" className="mt-1 min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm"
                placeholder={hint} value={form[key] ?? ""}
                onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))} />
            </label>)}
          </div>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={certificationsComplete}
              onChange={(event) => setCertificationsComplete(event.target.checked)} />
            위 인증이 <strong>전부</strong>입니다
            <span className="text-xs text-stone-500">
              (체크해야 &lsquo;필수 인증&rsquo; 공고를 판정합니다. 안 하면 계속 &lsquo;확인 필요&rsquo;로 남습니다)
            </span>
          </label>
          <label className="block text-xs font-semibold text-stone-600">메모
            <textarea className="mt-1 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm" rows={2}
              value={form.notes ?? ""}
              onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))} />
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
            매칭 대상에 넣기
            <span className="text-xs text-stone-500">(끄면 지우지 않고 판정에서만 뺍니다)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={`${button} border-orange-300 bg-white`} disabled={busy}>
              <Check size={15} aria-hidden="true" />{busy ? "저장 중" : "저장"}</button>
            <button type="button" className={button} onClick={() => setEditing(null)} disabled={busy}>
              <X size={15} aria-hidden="true" />취소</button>
          </div>
        </form> : null}
      </article>)}</div>}

    {list.data?.orphans.length ? <section className={`${panel} p-5`}>
      <h3 className="font-bold">울림웍스 목록에 없는 요건 {list.data.orphans.length}건</h3>
      <p className="mt-2 text-xs leading-6 text-stone-600">
        적어 둔 요건인데 울림웍스에서 그 고객을 찾지 못했습니다. 고객이 지워졌거나 식별자가 바뀐 것입니다.
        매칭에는 쓰이지 않습니다.
      </p>
      <ul className="mt-3 space-y-1 text-sm">{list.data.orphans.map((row) =>
        <li key={row.id}>{row.entity_name} <span className="text-xs text-stone-500">({row.customer_id})</span></li>)}</ul>
    </section> : null}
  </div>;
}

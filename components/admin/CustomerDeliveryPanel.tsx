"use client";

import { useRef, useState } from "react";
import { Check, Clipboard, RefreshCw, Undo2 } from "lucide-react";
import { DELIVERY_SEND_LIMIT, deliveryMessage } from "@/lib/program-review/customer-delivery";
import { Badge, Notice, button, date, panel, useResource } from "./ProgramReviewOperations";

/**
 * 고객사 전달 화면 (2026-11-26).
 *
 * 그날 판정에서 고객사마다 '후보' 로 나온 공고를 늘어놓고, 분야·업종이 맞은 것은
 * 미리 골라 문구를 만들어 둡니다. 지역만 맞은 공고는 직원이 골라야 문구에 들어갑니다.
 * 직원이 읽고, 필요하면 고친 뒤 복사해서 고객사 카톡방에 붙입니다.
 * 붙인 뒤 '보냈어요' 를 누르면 기록이 남고, 그 공고는 다음부터 그 고객사 문구에서 빠집니다.
 * **자동으로 보내지 않습니다.**
 */

const API = "/api/admin/program-review/deliveries";

type Item = { program_id: string; title: string; source_url: string | null; deadline_at: string | null;
  entities: string[]; reasons: string[]; conditional: boolean; support: string; documents: string[]; more_documents: number;
  score: number; strong: boolean; region_confirmed: boolean; ready: boolean };
type Customer = { customer_id: string; customer_name: string; items: Item[]; omitted: number; suggested: string[]; message: string };
type Sent = { id: string; customer_id: string; customer_name: string; program_id: string; title: string;
  delivered_by: string; delivered_at: string };
type Deliveries = { as_of: string; today: string; review_date: string | null; customers: Customer[]; sent_today: Sent[];
  stale_programs: number; pending_judging: number };

export default function CustomerDeliveryPanel() {
  const [revision, setRevision] = useState(0);
  const result = useResource<Deliveries>(API, revision);
  const [chosen, setChosen] = useState<string | null>(null);
  // 직원이 고친 문구와 고른 공고. 고객사별로 들고 있다가, 새로 불러오면 버린다.
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<"" | "sent" | "undo">("");
  const area = useRef<HTMLTextAreaElement>(null);

  const data = result.data;
  const customers = data?.customers ?? [];
  // 고른 고객사가 목록에서 사라지면(다 보냄) 다른 고객사로 몰래 넘어가지 않는다.
  const current = chosen === null ? customers[0] ?? null : customers.find(customer => customer.customer_id === chosen) ?? null;
  // 다시 불러온 사이 (다른 직원이 보내서) 목록에서 빠진 공고는 고른 것에서도 뺀다.
  const listed = new Set(current?.items.map(item => item.program_id) ?? []);
  const rawPick = current ? picked[current.customer_id] : undefined;
  const chosenIds = current ? (rawPick ?? current.suggested).filter(id => listed.has(id)) : [];
  const chosenItems = current ? current.items.filter(item => chosenIds.includes(item.program_id)) : [];
  // 고친 문구에 빠진 공고가 남아 있을 수 있으면 고친 것을 쓰지 않는다.
  const editUsable = !rawPick || rawPick.every(id => listed.has(id));
  const text = current ? (editUsable ? edited[current.customer_id] : undefined) ?? deliveryMessage(current.customer_name, chosenItems) : "";

  /** 다시 불러온다. 고른 것·고친 것은 `customerId` 고객사 것만 버린다 (다른 고객사에서 하던 일은 남긴다). */
  function reload(customerId?: string) {
    const drop = <T,>(value: Record<string, T>) => {
      if (customerId === undefined) return {};
      const rest = { ...value }; delete rest[customerId]; return rest;
    };
    setEdited(drop); setPicked(drop); setRevision(value => value + 1);
  }
  function toggle(customer: Customer, programId: string) {
    const inList = new Set(customer.items.map(item => item.program_id));
    const now = (picked[customer.customer_id] ?? customer.suggested).filter(id => inList.has(id));
    const next = now.includes(programId) ? now.filter(id => id !== programId) : [...now, programId];
    if (next.length > DELIVERY_SEND_LIMIT) {
      setNotice({ text: `한 번에 ${DELIVERY_SEND_LIMIT}건까지 고를 수 있습니다.`, error: true }); return;
    }
    setNotice(null);
    setPicked(value => ({ ...value, [customer.customer_id]: next }));
    // 고른 공고가 바뀌면 문구를 새로 만든다. 손으로 고친 것은 버리고 알린다.
    if (edited[customer.customer_id] !== undefined) setNotice({ text: "고른 공고가 바뀌어 문구를 새로 만들었습니다. 손으로 고친 부분은 다시 고쳐 주세요." });
    setEdited(value => { const rest = { ...value }; delete rest[customer.customer_id]; return rest; });
  }

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ text: `${current.customer_name} 문구를 복사했습니다. 고객사 카톡방에 붙인 뒤 '보냈어요' 를 눌러 주세요.` });
    } catch {
      area.current?.focus(); area.current?.select();
      setNotice({ text: "복사하지 못했습니다. 문구를 선택해 두었으니 Ctrl+C 로 복사해 주세요.", error: true });
    }
  }

  async function post(kind: "sent" | "undo", body: Record<string, unknown>, customerId: string,
    done: (result: Record<string, unknown>) => string) {
    setBusy(kind); setNotice(null);
    try {
      const response = await fetch(API, { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, ...body }) });
      if (!response.ok) {
        setNotice({ error: true, text: response.status === 401 ? "관리자 로그인을 다시 확인해 주세요."
          : response.status === 409 ? "그사이 판정이 바뀌어 후보가 아닌 공고가 섞였습니다. 새로고침한 뒤 다시 골라 주세요."
          : response.status === 404 ? "그 기록을 찾지 못했습니다. 이미 되돌렸을 수 있습니다. 새로고침해 주세요."
          : "적지 못했습니다. 잠시 뒤 다시 눌러 주세요. 카톡으로 보낸 것은 그대로입니다." });
        return;
      }
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      // 보낸 뒤에도 그 고객사를 계속 보여 준다 (목록 순서가 바뀌어도 다른 고객사로 넘어가지 않게)
      setChosen(customerId);
      setNotice({ text: done(result) }); reload(customerId);
    } catch {
      setNotice({ text: "연결이 끊겨 적지 못했습니다. 잠시 뒤 다시 눌러 주세요.", error: true });
    } finally { setBusy(""); }
  }

  if (result.loading) return <Notice>고객사별 문구를 만들고 있습니다.</Notice>;
  if (result.error) return <Notice error>{result.error}</Notice>;
  if (!data) return null;

  return <div className="space-y-6">
    <section className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold">고객사 전달</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">판정에서 고객사마다 &lsquo;후보&rsquo;로 나온 공고를 모아 보낼 문구를 만들었습니다.
          자동으로 보내지 않습니다. 읽어 보고 필요하면 고친 뒤 복사해서 고객사 카톡방에 붙이고, &lsquo;보냈어요&rsquo;를 눌러 주세요.
          보낸 공고는 다음부터 그 고객사 문구에서 빠집니다.</p>
        <p className="mt-2 text-xs text-stone-500">
          {data.review_date === null ? "아직 판정이 없습니다." : data.review_date === data.today
            ? `오늘(${data.today}) 판정 기준입니다.` : `오늘 판정은 아직 없습니다. 가장 최근 판정(${data.review_date}) 기준입니다. 평일 오전 10시쯤 오늘 판정이 끝납니다.`}
        </p>
      </div>
      <button type="button" className={button} onClick={() => reload()}><RefreshCw size={16} aria-hidden="true" />새로고침</button>
    </section>

    {data.pending_judging ? <Notice error>오늘 아직 판정하지 않은 공고가 {data.pending_judging}건 있습니다. 그 공고들은 이 목록에 없습니다. 판정이 끝난 뒤(평일 오전) 새로고침해 주세요.</Notice> : null}
    {data.stale_programs ? <Notice error>고객사나 자사 정보가 바뀐 뒤 아직 다시 판정되지 않은 공고가 목록에 {data.stale_programs}건 있습니다. 맞는 이유가 예전 정보일 수 있으니 공고를 한 번 더 확인해 주세요.</Notice> : null}
    {notice ? <Notice error={notice.error}>{notice.text}</Notice> : null}

    {!customers.length ? <Notice>보낼 공고가 있는 고객사가 없습니다. 후보로 나온 공고가 없거나, 이미 모두 보냈습니다.</Notice> :
      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="고객사" className={`${panel} h-fit max-h-64 overflow-auto p-2 lg:max-h-none`}>
          <ul className="space-y-1">{customers.map(customer => {
            const active = customer.customer_id === current?.customer_id;
            return <li key={customer.customer_id}><button type="button" aria-pressed={active}
              onClick={() => { setChosen(customer.customer_id); setNotice(null); }}
              className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${active ? "bg-orange-50 font-semibold text-orange-900" : "hover:bg-stone-50"}`}>
              <span className="min-w-0 truncate">{customer.customer_name}</span>
              <span className="shrink-0 text-xs text-stone-500">{customer.suggested.length ? `추천 ${customer.suggested.length} · ` : ""}{customer.items.length + customer.omitted}건</span>
            </button></li>;
          })}</ul>
        </nav>

        {current ? <section className={`${panel} min-w-0 space-y-5 p-5 sm:p-7`} aria-label={`${current.customer_name} 문구`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{current.customer_name}</h3>
            <Badge tone="green">고른 공고 {chosenItems.length}건</Badge>
            <Badge>후보 {current.items.length + current.omitted}건</Badge>
          </div>
          <p className="text-sm leading-6 text-stone-600">분야·업종·필수 인증이 맞고 지역까지 확인된 공고는 근거가 센 순으로 5건까지 미리 골라 두었습니다. 지역이나 사업자 유형만 맞은 공고는
            이 회사 일과 상관없을 수 있고, 지역을 모르는 공고는 다른 지역 공고일 수 있어 고르지 않았습니다. 보낼 공고에 체크하면 아래 문구가 바뀝니다.
            &lsquo;보냈어요&rsquo;는 체크한 공고를 적습니다. 문구에서 손으로 지운 공고는 체크도 풀어 주세요.
            {current.omitted ? ` 목록에는 근거가 센 순으로 ${current.items.length}건만 보입니다.` : ""}</p>

          <ul className="max-h-[28rem] divide-y divide-stone-100 overflow-auto rounded-xl border border-stone-200">{current.items.map(item => {
            const id = `delivery-${item.program_id}`;
            return <li key={item.program_id} className="flex items-start gap-3 p-3 text-sm">
              <input id={id} type="checkbox" className="mt-1 size-4 shrink-0 accent-orange-600" checked={chosenIds.includes(item.program_id)}
                onChange={() => toggle(current, item.program_id)} />
              <div className="min-w-0 flex-1">
                <label htmlFor={id} className="block cursor-pointer break-keep font-medium">{item.title}</label>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  {item.strong ? <Badge tone="green">분야·업종 맞음</Badge> : <Badge>분야·업종 근거 없음</Badge>}
                  {item.strong && !item.ready ? <Badge tone="amber">지역 확인 필요</Badge> : null}
                  {item.conditional ? <Badge tone="amber">일부 요건 확인 필요</Badge> : null}
                  {item.entities.length ? <Badge>{item.entities.join(", ")}</Badge> : null}
                  <span className="text-xs text-stone-500">{item.reasons.join(", ") || "근거 없음"} · 마감 {item.deadline_at ? date(item.deadline_at) : "공고문 참조"}</span>
                  {item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer" className="text-xs text-orange-700 underline">공고 보기</a> : null}
                </span>
              </div>
            </li>;
          })}</ul>

          <div>
            <label htmlFor="delivery-message" className="mb-2 block text-sm font-semibold">보낼 문구 <span className="font-normal text-stone-500">(고쳐도 됩니다 · 고친 것은 복사에만 쓰입니다)</span></label>
            {!chosenItems.length ? <Notice>고른 공고가 없습니다. 위 목록에서 보낼 공고에 체크해 주세요.</Notice> : null}
            <textarea id="delivery-message" ref={area} value={text} rows={Math.min(30, text.split("\n").length + 2)}
              onChange={event => setEdited(value => ({ ...value, [current.customer_id]: event.target.value }))}
              className="w-full rounded-xl border border-stone-200 p-4 font-mono text-sm leading-6 focus-visible:outline-2 focus-visible:outline-orange-500" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${button} border-orange-300 text-orange-900`} disabled={!text} onClick={() => void copy()}>
              <Clipboard size={16} aria-hidden="true" />문구 복사</button>
            <button type="button" className={`${button} border-emerald-200 text-emerald-800 hover:bg-emerald-50`} disabled={Boolean(busy) || !data.review_date || !chosenItems.length}
              onClick={() => { const name = current.customer_name; void post("sent", { customer_id: current.customer_id, review_date: data.review_date,
                program_ids: chosenItems.map(item => item.program_id) }, current.customer_id, result => {
                  const already = Number(result.already) || 0, fresh = Number(result.delivered) || 0;
                  return already ? `${name}에 ${fresh}건을 보냈다고 적었습니다. ${already}건은 이미 보냈다고 적혀 있던 공고입니다. 같은 안내가 두 번 갔는지 확인해 주세요.`
                    : `${name}에 ${fresh}건을 보냈다고 적었습니다.`;
                }); }}>
              <Check size={16} aria-hidden="true" />{busy === "sent" ? "적는 중" : "보냈어요"}</button>
            {edited[current.customer_id] !== undefined ? <button type="button" className={`${button} text-stone-600`}
              onClick={() => setEdited(value => { const next = { ...value }; delete next[current.customer_id]; return next; })}>처음 문구로</button> : null}
          </div>
        </section> : <Notice>고르신 고객사는 보낼 공고가 더 없습니다. 왼쪽에서 다른 고객사를 골라 주세요.</Notice>}
      </div>}

    <section>
      <h3 className="mb-3 font-bold">오늘 보낸 기록 <span className="text-sm font-normal text-stone-500">{data.sent_today.length}건</span></h3>
      {!data.sent_today.length ? <Notice>오늘 보냈다고 적은 공고가 없습니다.</Notice> :
        <ul className={`${panel} divide-y divide-stone-100`}>{data.sent_today.map(row =>
          <li key={row.id} className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0"><span className="font-semibold">{row.customer_name}</span>
              <span className="mx-2 text-stone-300" aria-hidden="true">·</span>{row.title || "공고 정보 없음"}
              <span className="mt-1 block text-xs text-stone-500">{date(row.delivered_at)} · {row.delivered_by}</span></span>
            <button type="button" className={`${button} shrink-0 text-stone-600`} disabled={Boolean(busy)}
              onClick={() => void post("undo", { id: row.id }, row.customer_id, () => "보낸 기록 하나를 되돌렸습니다. 아직 후보이면 그 고객사 목록에 다시 나옵니다.")}>
              <Undo2 size={16} aria-hidden="true" />되돌리기</button>
          </li>)}</ul>}
    </section>
  </div>;
}

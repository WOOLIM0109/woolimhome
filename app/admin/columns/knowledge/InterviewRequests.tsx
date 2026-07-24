"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clipboard, FileText, Mic, Printer, RefreshCw } from "lucide-react";
import { EXPERTISE_AREAS } from "@/lib/columns/interview-requests";
import type { ExpertiseArea, InterviewRequest } from "@/lib/columns/types";

function requestText(item: InterviewRequest) {
  return [
    item.title,
    `권장 녹음 시간: ${item.recommended_minutes}분`,
    "",
    "답변 전 안내: 고객명, 개인정보, 비공개 계약 내용은 익명으로 말씀해 주세요.",
    "",
    ...item.questions.flatMap((question, index) => [
      `${index + 1}. ${question.question}`,
      ...question.followUps.map((followUp) => `   - ${followUp}`),
      "",
    ]),
  ].join("\n");
}

export default function InterviewRequests() {
  const [items, setItems] = useState<InterviewRequest[]>([]);
  const [area, setArea] = useState<ExpertiseArea>("planning");
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const autoChecked = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/columns/interview-requests", { cache: "no-store" });
    if (response.ok) setItems(await response.json());
  }, []);

  const generate = useCallback(async (force: boolean, expertiseArea?: ExpertiseArea) => {
    setGenerating(true);
    setNotice("");
    const response = await fetch("/api/admin/columns/interview-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force, expertiseArea }),
    });
    const result = await response.json();
    setGenerating(false);
    if (!response.ok) {
      setNotice(result.error || "인터뷰 요청서 생성에 실패했습니다.");
      return;
    }
    setNotice(result.created ? "새 인터뷰 요청서를 만들었습니다." : result.reason || "");
    await load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin/columns/interview-requests", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : [])
      .then((data: InterviewRequest[]) => setItems(data));
  }, []);

  useEffect(() => {
    if (autoChecked.current) return;
    autoChecked.current = true;
    void generate(false);
  }, [generate]);

  const pending = useMemo(() => items.filter((item) => item.status === "pending"), [items]);

  const complete = async (item: InterviewRequest) => {
    await fetch("/api/admin/columns/interview-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: "completed" }),
    });
    await load();
  };

  return (
    <section className="mt-8 rounded-sm border border-[var(--line)] bg-white p-6 print:border-0 print:p-0">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <Mic className="mt-0.5 shrink-0 text-[var(--primary)]" />
          <div>
            <h2 className="text-xl font-bold">맞춤 인터뷰 요청서</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              전체 또는 특정 전문 분야의 자료가 부족하면 자동으로 요청서를 만듭니다.
              질문을 보며 30~45분간 음성으로 답한 뒤 녹취록을 위 자료 가져오기에 올려주세요.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <select aria-label="인터뷰 전문 분야" className="input min-w-44" value={area} onChange={(event) => setArea(event.target.value as ExpertiseArea)}>
            {EXPERTISE_AREAS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button
            type="button"
            disabled={generating}
            onClick={() => void generate(true, area)}
            className="btn-gradient inline-flex items-center justify-center gap-2 rounded-sm px-4 py-3 font-bold text-white disabled:opacity-50"
          >
            <RefreshCw size={17} className={generating ? "animate-spin" : ""} />
            {generating ? "생성 중" : "요청서 만들기"}
          </button>
        </div>
      </div>
      {notice && <p className="mt-4 rounded-sm bg-[var(--surface-strong)] px-4 py-3 text-sm">{notice}</p>}

      <div className="mt-6 space-y-5">
        {pending.length === 0 && !generating && (
          <p className="rounded-sm border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]">
            대기 중인 인터뷰 요청서가 없습니다. 자료 부족이 감지되면 자동 생성됩니다.
          </p>
        )}
        {pending.map((item) => (
          <article key={item.id} className="interview-request rounded-sm border border-orange-200 bg-[#fffaf7] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold text-[var(--primary)]">
                  {EXPERTISE_AREAS.find((areaItem) => areaItem.value === item.expertise_area)?.label}
                  {" · "}{item.recommended_minutes}분 권장
                </p>
                <h3 className="mt-2 text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{item.rationale}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 print:hidden">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-sm border bg-white px-3 py-2 text-sm font-bold"
                  onClick={() => void navigator.clipboard.writeText(requestText(item)).then(() => setNotice("요청서를 복사했습니다."))}
                >
                  <Clipboard size={15} /> 복사
                </button>
                <button type="button" className="inline-flex items-center gap-1 rounded-sm border bg-white px-3 py-2 text-sm font-bold" onClick={() => window.print()}>
                  <Printer size={15} /> 인쇄
                </button>
              </div>
            </div>
            <div className="mt-5 rounded-sm border border-amber-200 bg-amber-50 p-4 text-sm leading-6">
              고객명, 개인정보, 공개하기 어려운 계약 조건은 익명으로 말씀해 주세요. 기억이 불확실한 숫자는 “확인 필요”라고 덧붙이면 됩니다.
            </div>
            <ol className="mt-6 space-y-5">
              {item.questions.map((question, index) => (
                <li key={`${item.id}-${index}`} className="leading-7">
                  <p className="font-bold">{index + 1}. {question.question}</p>
                  {question.followUps.length > 0 && (
                    <ul className="ml-5 mt-1 list-disc text-sm text-[var(--muted)]">
                      {question.followUps.map((followUp) => <li key={followUp}>{followUp}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-[var(--line)] pt-5 print:hidden">
              <a href="#upload-source" className="btn-gradient inline-flex items-center gap-2 rounded-sm px-4 py-2.5 font-bold text-white">
                <FileText size={17} /> 완성한 녹취록 올리기
              </a>
              <button type="button" onClick={() => void complete(item)} className="inline-flex items-center gap-2 rounded-sm border bg-white px-4 py-2.5 font-bold">
                <CheckCircle2 size={17} /> 인터뷰 완료 처리
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { Loader2, PenLine, Plus, Trash2 } from "lucide-react";

/**
 * 이미 써 둔 원고를 그대로 작업 큐에 넣습니다.
 *
 * 쓸 내용이 정해져 있는 글(공고 분석, 마감 안내처럼 시기가 있는 글)은
 * AI에게 주제부터 맡길 이유가 없습니다. 예전에는 그런 글도 "초안 만들기"로
 * 아무 주제나 하나 만든 뒤 본문을 통째로 갈아 끼워야 했습니다.
 * 여기서는 AI를 부르지 않아 요금이 들지 않고 기다릴 필요도 없습니다.
 */

type Format = { value: string; label: string };

const FORMATS: Record<string, Format[]> = {
  naver_consulting: [
    { value: "informational", label: "정보형" },
    { value: "authority", label: "울림 콘텐츠형" },
  ],
  naver_design: [
    { value: "design_insight", label: "기획·디자인 콘텐츠" },
  ],
};

type FaqEntry = { question: string; answer: string };

const EMPTY_FAQ: FaqEntry[] = [
  { question: "", answer: "" },
  { question: "", answer: "" },
  { question: "", answer: "" },
];

export default function ManualDraftButton({
  channel,
}: { channel: "naver_consulting" | "naver_design" }) {
  const formats = FORMATS[channel];
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState(formats[0].value);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [faq, setFaq] = useState<FaqEntry[]>(EMPTY_FAQ);
  const [tags, setTags] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);

  function updateFaq(index: number, patch: Partial<FaqEntry>) {
    setFaq((current) => current.map((entry, position) => (
      position === index ? { ...entry, ...patch } : entry
    )));
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setIssues([]);
    try {
      const response = await fetch("/api/admin/content/manual-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          format,
          title,
          summary,
          bodyHtml,
          faq: faq.filter((entry) => entry.question.trim() && entry.answer.trim()),
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          sourceUrls: sourceUrls.split(/[\n,]/).map((url) => url.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "원고를 저장하지 못했습니다.");
      if (data.issues?.length) {
        // 걸린 항목이 있어도 저장은 끝났습니다. 무엇이 걸렸는지 보여 주고
        // 판단은 사람에게 맡깁니다. 아래 작업 큐에서 그대로 승인할 수도 있습니다.
        setIssues(data.issues);
        setMessage("저장했습니다. 검수에서 걸린 항목이 있어 보류 상태로 넣었습니다.");
        return;
      }
      setMessage("저장했습니다. 아래 작업 큐의 검토 목록에서 확인해 주세요.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "원고를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-950"
      >
        <PenLine size={17} /> 직접 쓴 원고 넣기
      </button>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-emerald-300 bg-emerald-50/60 p-5 lg:w-[720px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-bold text-emerald-950">직접 쓴 원고 넣기</p>
          <p className="mt-1 text-sm text-emerald-900">
            AI를 부르지 않습니다. 요금이 들지 않고 기다릴 필요도 없습니다.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-bold underline">
          닫기
        </button>
      </div>

      <label className="mt-4 block text-xs font-bold text-emerald-950">글 형식</label>
      <div className="mt-1 flex flex-wrap gap-2">
        {formats.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFormat(option.value)}
            className={`rounded-xl px-4 py-2 text-sm font-bold ${
              format === option.value ? "bg-[#ef762f] text-white" : "border border-[var(--line)] bg-white"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-bold text-emerald-950">제목</label>
      <input className="input mt-1" value={title} onChange={(event) => setTitle(event.target.value)} />

      <label className="mt-4 block text-xs font-bold text-emerald-950">요약 (목록에 보이는 한 줄)</label>
      <input className="input mt-1" value={summary} onChange={(event) => setSummary(event.target.value)} />

      <label className="mt-4 block text-xs font-bold text-emerald-950">
        본문 (h2, h3, p, ul, ol, li, strong, blockquote, a, table 태그를 쓸 수 있습니다)
      </label>
      <textarea
        className="input mt-1 font-mono text-xs"
        rows={18}
        value={bodyHtml}
        onChange={(event) => setBodyHtml(event.target.value)}
      />

      <div className="mt-4 flex items-center justify-between">
        <label className="block text-xs font-bold text-emerald-950">FAQ (3~4개)</label>
        {faq.length < 4 && (
          <button
            type="button"
            onClick={() => setFaq((current) => [...current, { question: "", answer: "" }])}
            className="inline-flex items-center gap-1 text-xs font-bold text-emerald-900 underline"
          >
            <Plus size={13} /> 항목 추가
          </button>
        )}
      </div>
      <div className="mt-1 space-y-3">
        {faq.map((entry, index) => (
          <div key={index} className="rounded-xl border border-emerald-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <input
                className="input"
                placeholder="질문 (Q. 는 빼고 적어 주세요)"
                value={entry.question}
                onChange={(event) => updateFaq(index, { question: event.target.value })}
              />
              {faq.length > 3 && (
                <button
                  type="button"
                  onClick={() => setFaq((current) => current.filter((_, position) => position !== index))}
                  className="shrink-0 rounded-lg p-2 text-red-700"
                  aria-label="FAQ 항목 삭제"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <textarea
              className="input mt-2 text-sm"
              rows={2}
              placeholder="답변 (공백 제외 180자 이내)"
              value={entry.answer}
              onChange={(event) => updateFaq(index, { answer: event.target.value })}
            />
          </div>
        ))}
      </div>

      <label className="mt-4 block text-xs font-bold text-emerald-950">태그 (쉼표로 구분)</label>
      <input className="input mt-1" value={tags} onChange={(event) => setTags(event.target.value)} />

      <label className="mt-4 block text-xs font-bold text-emerald-950">
        출처 링크 (한 줄에 하나. 본문 아래 출처 목록으로 붙습니다)
      </label>
      <textarea
        className="input mt-1 text-sm"
        rows={4}
        value={sourceUrls}
        onChange={(event) => setSourceUrls(event.target.value)}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !title.trim() || !bodyHtml.trim()}
          className="btn-gradient inline-flex items-center gap-2 rounded-xl px-5 py-3 font-bold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 size={17} className="animate-spin" /> : <PenLine size={17} />}
          {saving ? "저장 중…" : "작업 큐에 넣기"}
        </button>
      </div>

      {message && <p className="mt-3 text-sm font-bold text-[var(--primary)]">{message}</p>}
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-amber-900">
          {issues.map((issue) => <li key={issue}>· {issue}</li>)}
        </ul>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAccess } from "@/hooks/useAccess";

type Result = {
  post?: { id: string; title: string };
  blocked?: boolean;
  issues?: string[];
  /** 저장은 했지만 다듬을 곳. 글을 버리지 않고 함께 알려 줍니다. */
  styleWarnings?: string[];
  expertQuestions?: string[];
  validation?: {
    charCount: number; h2Count: number; faqCount: number; sourceCount: number;
    diagramsRequested?: boolean; diagramCount?: number;
  };
  topicFamily?: string | null;
  error?: string;
};

export default function AiNewColumnPage() {
  const { user, loading: authLoading } = useAuth();
  const access = useAccess(user?.email);
  const loading = authLoading || (Boolean(user) && access.loading);
  const [topicHint, setTopicHint] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const generate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/columns/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicHint: topicHint.trim() || undefined,
          sourceUrls: sourceUrls.split("\n").map((value) => value.trim()).filter(Boolean),
        }),
      });
      setResult(await response.json());
    } catch {
      setResult({ error: "서버와 통신하지 못했습니다." });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <Page><p>로그인 상태를 확인하고 있습니다.</p></Page>;
  if (!user || !access.admin) {
    return <Page><p>{access.error || "관리자 계정으로 먼저 로그인해 주세요."}</p><Link href="/admin/columns" className="mt-5 inline-block underline">관리자 로그인으로 이동</Link></Page>;
  }

  return (
    <Page>
      <Link href="/admin/columns" className="text-sm text-[var(--muted)]">← 칼럼 관리</Link>
      <h1 className="mt-5 text-3xl font-bold">AI 칼럼 초안</h1>
      {/*
        화면 설명은 실제로 하는 일과 같아야 합니다.
        예전에는 중기부 공고에서 주제를 골랐고 그래서 늘 지원사업 이야기만
        나왔습니다. 지금은 주제군 15개를 돌려 가며 고릅니다. 설명을 그대로
        두면 대표님이 "고쳤다는데 화면은 그대로네" 하고 믿을 수 없게 됩니다.
      */}
      <p className="prose-muted mt-3">
        주제를 비워두면 경영전략·마케팅·재무·인증·수출 등 15개 분야를 돌려 가며,
        최근 칼럼에서 덜 다룬 쪽으로 주제를 고릅니다. 자료는 그 주제에 맞춰 찾습니다.
      </p>

      <div className="mt-8 flex gap-3 rounded-sm border border-orange-200 bg-orange-50 p-5 text-sm leading-6">
        <ShieldCheck className="mt-0.5 shrink-0 text-[var(--primary)]" size={20} />
        <p>모든 글은 비공개 초안으로만 저장됩니다. 정책자금·지원사업의 선정이나 대출을 보장하는 표현은 허용하지 않습니다.</p>
      </div>

      <div className="mt-6 space-y-6 rounded-sm border border-[var(--line)] bg-white p-6">
        <label className="block">
          <span className="font-bold">주제 힌트 <span className="font-normal text-[var(--muted)]">(선택)</span></span>
          <input value={topicHint} onChange={(event) => setTopicHint(event.target.value)} className="mt-2 w-full rounded-sm border border-[var(--line)] px-4 py-3" placeholder="예: 정책자금 상담 전에 기업이 먼저 점검해야 할 것" />
          <span className="mt-2 block text-xs text-[var(--muted)]">
            적으시면 그 주제로 씁니다. 비워 두면 아래 분야를 돌려 가며 알아서 고릅니다.
          </span>
        </label>
        <label className="block">
          <span className="font-bold">추가 공식자료 URL <span className="font-normal text-[var(--muted)]">(선택, 한 줄에 하나)</span></span>
          <textarea value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} rows={4} className="mt-2 w-full rounded-sm border border-[var(--line)] px-4 py-3" placeholder={"https://www.bizinfo.go.kr/...\nhttps://www.mss.go.kr/..."} />
          <span className="mt-2 block text-xs text-[var(--muted)]">
            직접 넣는 링크는 정부·공공기관·대학·주요 언론사 등 승인된 곳만 읽습니다.
            비워 두면 주제에 맞는 공식 자료를 알아서 찾습니다.
          </span>
        </label>
        <button onClick={() => void generate()} disabled={generating} className="btn-gradient inline-flex w-full items-center justify-center gap-2 rounded-sm px-6 py-3 font-bold text-white disabled:opacity-50">
          {generating ? <Loader2 className="animate-spin" size={18} /> : <Bot size={18} />}
          {generating ? "공식 출처 확인 및 초안 작성 중…" : "완전 자동으로 비공개 초안 만들기"}
        </button>
      </div>

      {result?.error && <ResultBox tone="error"><p className="font-bold">{result.error}</p></ResultBox>}
      {result?.blocked && (
        <ResultBox tone="error">
          <h2 className="font-bold">품질 기준을 통과하지 못해 저장하지 않았습니다.</h2>
          {result.issues?.map((issue) => <p key={issue} className="mt-2 text-sm">· {issue}</p>)}
          {result.expertQuestions?.length ? (
            <div className="mt-5"><p className="font-bold">대표님께 확인할 질문</p>{result.expertQuestions.map((question) => <p key={question} className="mt-2 text-sm">· {question}</p>)}</div>
          ) : null}
        </ResultBox>
      )}
      {result?.post && (
        <ResultBox tone="success">
          <h2 className="font-bold">
            {result.styleWarnings?.length ? "비공개 초안을 저장했습니다. 다듬을 곳이 있습니다." : "비공개 초안이 생성되었습니다."}
          </h2>
          <p className="mt-2">{result.post.title}</p>
          {result.topicFamily && <p className="mt-1 text-sm text-[var(--muted)]">주제 분야: {result.topicFamily}</p>}
          {result.validation && <p className="mt-3 text-sm">본문 {result.validation.charCount.toLocaleString("ko-KR")}자 · H2 {result.validation.h2Count}개 · FAQ {result.validation.faqCount}개 · 출처 {result.validation.sourceCount}개</p>}
          {/*
            도식이 없을 때 왜 없는지 화면에서 바로 알 수 있게 합니다.
            예전에는 기능이 꺼진 것인지 AI 가 안 그린 것인지 구분할 수 없어,
            도식이 안 나오는 이유를 찾는 데 한참 걸렸습니다.
          */}
          {result.validation && (
            <p className="mt-1 text-sm">
              도식:{" "}
              {!result.validation.diagramsRequested
                ? "꺼져 있음 (환경변수 COLUMN_DIAGRAMS 를 true 로 두면 켜집니다)"
                : result.validation.diagramCount
                  ? `${result.validation.diagramCount}개 들어감`
                  : "켜져 있으나 이번 글에는 넣지 않았습니다"}
            </p>
          )}
          {result.styleWarnings?.length ? (
            <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 p-4">
              <p className="font-bold">발행 전에 손볼 곳</p>
              {result.styleWarnings.map((warning) => <p key={warning} className="mt-2 text-sm">· {warning}</p>)}
            </div>
          ) : null}
          {result.expertQuestions?.length ? (
            <div className="mt-4"><p className="font-bold">대표님께 확인할 질문</p>{result.expertQuestions.map((question) => <p key={question} className="mt-2 text-sm">· {question}</p>)}</div>
          ) : null}
          <Link href={`/admin/columns/edit/${result.post.id}`} className="mt-5 inline-block rounded-sm bg-[#24523c] px-5 py-2.5 font-bold text-white">편집기에서 검토하기</Link>
        </ResultBox>
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <section className="min-h-[70vh] bg-[#fffaf7]"><div className="mx-auto max-w-3xl px-5 py-16 lg:px-8">{children}</div></section>;
}

function ResultBox({ children, tone }: { children: React.ReactNode; tone: "success" | "error" }) {
  return <div className={`mt-6 rounded-sm border p-6 ${tone === "success" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>{children}</div>;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Palette,
  RefreshCw,
  Tags,
} from "lucide-react";
import { faqAnswerHtml, faqQuestionHtml } from "@/lib/content-ops/editorial-style";
import { formatSentenceLineBreaks } from "@/lib/content-ops/sentence-line-breaks";

type PartnerChannel = "naver_consulting" | "naver_design";
type PartnerStatusView = "pending" | "published";

type PartnerItem = {
  id: string;
  channel: PartnerChannel;
  format: string;
  title: string;
  summary: string;
  status: "approved" | "naver_ready" | "scheduled" | "published";
  scheduledAt: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  publicationWarning: string | null;
  completedAt: string | null;
  previewHtml: string;
  copyHtml: string;
  faq: { question: string; answer: string }[];
  tags: string[];
  assets: {
    id: string;
    type: "thumbnail" | "body_image" | "article_preview";
    order: number;
    previewUrl: string;
    downloadUrl: string;
  }[];
};

type PartnerChannelConfig = {
  value: PartnerChannel;
  account: string | null;
  blogUrl: string | null;
};

const CHANNELS: {
  value: PartnerChannel;
  label: string;
  description: string;
  icon: typeof FileText;
}[] = [
  {
    value: "naver_consulting",
    label: "컨설팅 블로그",
    description: "경영컨설팅 정보·노하우 콘텐츠",
    icon: FileText,
  },
  {
    value: "naver_design",
    label: "디자인 블로그",
    description: "포트폴리오·기획·디자인 콘텐츠",
    icon: Palette,
  },
];

const STATUS_LABELS: Record<PartnerItem["status"], string> = {
  approved: "포스팅 대기",
  naver_ready: "포스팅 대기",
  scheduled: "예약 등록",
  published: "발행 완료",
};

function htmlToText(html: string) {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  parsedDocument.body.querySelectorAll("br").forEach((element) => element.replaceWith("\n"));
  parsedDocument.body
    .querySelectorAll("p, h1, h2, h3, h4, li, blockquote, section")
    .forEach((element) => element.append("\n\n"));

  return (parsedDocument.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFaqHtml(faq: PartnerItem["faq"]) {
  if (!faq.length) return "";
  return [
    "<h2>자주 묻는 질문</h2>",
    ...faq.map(
      (item) =>
        `<p>${faqQuestionHtml(item.question)}</p><p>${faqAnswerHtml(item.answer)}</p>`,
    ),
  ].join("");
}

function assetLabel(type: PartnerItem["assets"][number]["type"], order: number) {
  if (type === "thumbnail") return "대표 썸네일";
  if (type === "article_preview") return `전체 원고 미리보기 ${order}`;
  return `본문 이미지 ${order}`;
}

async function writeRichClipboard(html: string, formatSentences: boolean) {
  const clipboardHtml = formatSentences ? formatSentenceLineBreaks(html) : html;
  const text = htmlToText(clipboardHtml);
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([clipboardHtml], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function PartnerQueue({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [channel, setChannel] = useState<PartnerChannel>("naver_consulting");
  const [statusView, setStatusView] = useState<PartnerStatusView>("pending");
  const [items, setItems] = useState<PartnerItem[]>([]);
  const [channelConfigs, setChannelConfigs] = useState<PartnerChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [publishedUrls, setPublishedUrls] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");

  const selectedChannel = useMemo(
    () => CHANNELS.find((item) => item.value === channel) || CHANNELS[0],
    [channel],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/partner/content?channel=${channel}`, { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) {
        setError("이 계정에는 외주 작업실 접근 권한이 없습니다. 대표님께 등록된 이메일 주소를 확인해 주세요.");
        setItems([]);
        return;
      }
      if (!response.ok) throw new Error(data.error || "작업 목록을 불러오지 못했습니다.");
      const loadedItems = (Array.isArray(data) ? data : data.items) as PartnerItem[];
      const displayItems = loadedItems.map((item) => item.status === "published"
        ? item
        : { ...item, previewHtml: formatSentenceLineBreaks(item.previewHtml) });
      setItems(displayItems);
      setChannelConfigs(Array.isArray(data.channels) ? data.channels : []);
      setPublishedUrls(
        Object.fromEntries(
          displayItems.map((item) => [item.id, item.publishedUrl || ""]),
        ),
      );
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "작업 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [channel]);

  const selectedChannelConfig = useMemo(
    () => channelConfigs.find((item) => item.value === channel),
    [channel, channelConfigs],
  );

  const pendingItems = useMemo(
    () => items.filter((item) => item.status !== "published"),
    [items],
  );
  const publishedItems = useMemo(
    () => items.filter((item) => item.status === "published"),
    [items],
  );
  const visibleItems = statusView === "published" ? publishedItems : pendingItems;

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function copyValue(key: string, value: string, rich = false, formatSentences = false) {
    try {
      if (rich) await writeRichClipboard(value, formatSentences);
      else await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1800);
    } catch {
      setError("복사하지 못했습니다. 브라우저에서 클립보드 사용을 허용해 주세요.");
    }
  }

  function downloadAll(item: PartnerItem) {
    item.assets.forEach((asset, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = asset.downloadUrl;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 250);
    });
  }

  async function markPublished(item: PartnerItem) {
    const publishedUrl = publishedUrls[item.id]?.trim();
    if (!publishedUrl) {
      setError("발행한 네이버 블로그 글 주소를 먼저 입력해 주세요.");
      return;
    }

    setSavingId(item.id);
    setError("");
    try {
      const response = await fetch(`/api/partner/content/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishedUrl }),
      });
      const data = await response.json();
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(
          [data.error || "발행 완료 상태를 저장하지 못했습니다.", data.nextAction]
            .filter(Boolean)
            .join(" "),
        );
      }
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "발행 완료 상태를 저장하지 못했습니다.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="mt-6">
      <nav className="grid gap-3 sm:grid-cols-2" aria-label="블로그 선택">
        {CHANNELS.map((item) => {
          const Icon = item.icon;
          const active = item.value === channel;
          return (
            <button
              key={item.value}
              onClick={() => {
                setStatusView("pending");
                setItems([]);
                setChannel(item.value);
              }}
              className={`rounded-2xl border p-5 text-left transition ${
                active
                  ? "border-[var(--primary)] bg-orange-50 shadow-sm"
                  : "border-[var(--line)] bg-white hover:border-orange-200"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className={`rounded-xl p-2.5 ${active ? "bg-[var(--primary)] text-white" : "bg-stone-100 text-stone-600"}`}>
                  <Icon size={19} />
                </span>
                <span>
                  <strong className="block">{item.label}</strong>
                  <small className="mt-0.5 block text-[var(--muted)]">{item.description}</small>
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-[var(--line)] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">{selectedChannel.label} 작업 목록</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            승인된 원고만 표시됩니다. 홈페이지 칼럼과 내부 원천자료는 이 작업실에 제공되지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedChannelConfig?.blogUrl ? (
            <a
              href={selectedChannelConfig.blogUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-bold"
            >
              블로그 열기 ({selectedChannelConfig.account}) <ExternalLink size={15} />
            </a>
          ) : (
            <span className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">
              채널 계정 설정 오류
            </span>
          )}
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-bold"
          >
            <RefreshCw size={15} /> 새로고침
          </button>
        </div>
      </div>

      <nav
        className="mt-5 inline-flex w-full rounded-2xl border border-[var(--line)] bg-stone-100 p-1 sm:w-auto"
        aria-label="작업 상태 선택"
      >
        <button
          onClick={() => setStatusView("pending")}
          aria-pressed={statusView === "pending"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition sm:flex-none ${
            statusView === "pending"
              ? "bg-white text-blue-700 shadow-sm"
              : "text-stone-600 hover:text-stone-900"
          }`}
        >
          포스팅 대기
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{pendingItems.length}</span>
        </button>
        <button
          onClick={() => setStatusView("published")}
          aria-pressed={statusView === "published"}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition sm:flex-none ${
            statusView === "published"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-stone-600 hover:text-stone-900"
          }`}
        >
          발행 완료
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{publishedItems.length}</span>
        </button>
      </nav>

      {error && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-bold leading-6 text-red-700">
          {error}
          {error.includes("접근 권한") && (
            <button onClick={onUnauthorized} className="ml-3 underline underline-offset-4">다른 계정으로 로그인</button>
          )}
        </div>
      )}

      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-white p-12 text-sm text-[var(--muted)]">
          <LoaderCircle className="animate-spin" size={18} /> 승인된 작업을 불러오고 있습니다.
        </div>
      ) : !visibleItems.length && !error ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] bg-white p-12 text-center">
          <CheckCircle2 className="mx-auto text-emerald-600" size={30} />
          <p className="mt-3 font-bold">
            {statusView === "published" ? "발행 완료된 작업이 없습니다." : "현재 포스팅 대기 작업이 없습니다."}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {statusView === "published"
              ? "포스팅 완료 등록을 마친 글이 여기에 모입니다."
              : "대표님이 승인한 초안이 생기면 자동으로 여기에 표시됩니다."}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {visibleItems.map((item) => {
            const faqHtml = buildFaqHtml(item.faq);
            const fullHtml = `${item.copyHtml}${faqHtml}`;
            const tags = item.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
            const isPublished = item.status === "published";

            return (
              <article key={item.id} className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white shadow-sm">
                <div className="p-6 sm:p-8">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="rounded-full bg-orange-50 px-3 py-1.5 text-[var(--primary)]">{item.format}</span>
                        <span className={`rounded-full px-3 py-1.5 ${isPublished ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>
                          {STATUS_LABELS[item.status]}
                        </span>
                      </div>
                      <h3 className="mt-4 text-2xl font-bold leading-snug">{item.title}</h3>
                      {item.summary && <p className="mt-3 max-w-4xl text-sm leading-7 text-[var(--muted)]">{item.summary}</p>}
                      {item.scheduledAt && (
                        <p className="mt-3 text-xs text-[var(--muted)]">예정일: {formatDate(item.scheduledAt)}</p>
                      )}
                    </div>
                  </div>

                  <section className="mt-6 rounded-2xl bg-[#fff8f3] p-4 sm:p-5">
                    <h4 className="text-sm font-bold">1. 원고 옮기기</h4>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <CopyButton
                        label="제목 복사"
                        icon={<Clipboard size={15} />}
                        done={copied === `${item.id}-title`}
                        onClick={() => void copyValue(`${item.id}-title`, item.title)}
                      />
                      <CopyButton
                        label="본문 전체 복사"
                        icon={<FileText size={15} />}
                        done={copied === `${item.id}-body`}
                        onClick={() => void copyValue(`${item.id}-body`, fullHtml, true, !isPublished)}
                      />
                      {item.faq.length > 0 && (
                        <CopyButton
                          label="FAQ만 복사"
                          icon={<Clipboard size={15} />}
                          done={copied === `${item.id}-faq`}
                          onClick={() => void copyValue(`${item.id}-faq`, faqHtml, true, !isPublished)}
                        />
                      )}
                      {tags && (
                        <CopyButton
                          label="태그 복사"
                          icon={<Tags size={15} />}
                          done={copied === `${item.id}-tags`}
                          onClick={() => void copyValue(`${item.id}-tags`, tags)}
                        />
                      )}
                    </div>
                  </section>

                  {item.assets.length > 0 && (
                    <section className="mt-5 rounded-2xl border border-[var(--line)] p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold">2. 이미지 내려받기</h4>
                          <p className="mt-1 text-xs text-[var(--muted)]">표시 순서대로 네이버 글에 삽입해 주세요.</p>
                        </div>
                        <button
                          onClick={() => downloadAll(item)}
                          className="inline-flex items-center gap-2 rounded-xl bg-[#241a15] px-4 py-2.5 text-sm font-bold text-white"
                        >
                          <Download size={15} /> 이미지 전체 다운로드
                        </button>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {item.assets.map((asset) => (
                          <div key={asset.id} className="overflow-hidden rounded-2xl border border-[var(--line)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={asset.previewUrl}
                              alt={`${item.title} ${assetLabel(asset.type, asset.order)}`}
                              className="aspect-[4/3] w-full bg-stone-100 object-contain"
                            />
                            <div className="flex items-center justify-between gap-3 p-3">
                              <span className="text-xs font-bold">{assetLabel(asset.type, asset.order)}</span>
                              <a
                                href={asset.downloadUrl}
                                download
                                className="inline-flex items-center gap-1 text-xs font-bold text-[var(--primary)]"
                              >
                                <Download size={13} /> 저장
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <details className="mt-5 rounded-2xl border border-[var(--line)] p-4 sm:p-5">
                    <summary className="cursor-pointer text-sm font-bold">이미지가 배치된 전체 원고 미리보기</summary>
                    <div className="partner-copy-preview column-body mt-6" dangerouslySetInnerHTML={{ __html: item.previewHtml }} />
                    {item.faq.length > 0 && (
                      <section className="mt-8 border-t border-[var(--line)] pt-6">
                        <h4 className="text-xl font-bold">자주 묻는 질문</h4>
                        {item.faq.map((faq) => (
                          <div key={faq.question} className="mt-5 rounded-xl border border-[var(--line)] p-4">
                            <p className="font-bold" dangerouslySetInnerHTML={{ __html: faqQuestionHtml(faq.question) }} />
                            <p className="mt-2 text-sm leading-7 text-[var(--muted)]" dangerouslySetInnerHTML={{ __html: faqAnswerHtml(faq.answer) }} />
                          </div>
                        ))}
                      </section>
                    )}
                  </details>

                  <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
                    <h4 className="text-sm font-bold">3. 발행 완료 등록</h4>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      네이버에서 발행한 글 주소를 붙여 넣으면 대표님이 완료 여부를 바로 확인할 수 있습니다.
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <input
                        type="url"
                        value={publishedUrls[item.id] || ""}
                        onChange={(event) => setPublishedUrls((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="https://blog.naver.com/..."
                        disabled={isPublished}
                        className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-500 disabled:bg-stone-50"
                      />
                      {isPublished && item.publishedUrl ? (
                        <a
                          href={item.publishedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
                        >
                          발행 글 열기 <ExternalLink size={15} />
                        </a>
                      ) : isPublished ? (
                        <span className="inline-flex items-center justify-center rounded-xl bg-amber-100 px-5 py-3 text-sm font-bold text-amber-900">
                          관리자 확인 필요
                        </span>
                      ) : (
                        <button
                          onClick={() => void markPublished(item)}
                          disabled={savingId === item.id}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                        >
                          {savingId === item.id ? <LoaderCircle className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                          포스팅 완료
                        </button>
                      )}
                    </div>
                    {isPublished && item.publishedAt && (
                      <p className="mt-3 text-xs font-bold text-emerald-800">완료 등록: {formatDate(item.publishedAt)}</p>
                    )}
                    {item.publicationWarning && (
                      <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-950" role="alert">
                        {item.publicationWarning}
                      </p>
                    )}
                  </section>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CopyButton({
  label,
  icon,
  done,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-white px-4 py-2.5 text-sm font-bold text-stone-800 hover:border-[var(--primary)]"
    >
      {done ? <Check size={15} className="text-emerald-600" /> : icon}
      {done ? "복사됨" : label}
    </button>
  );
}

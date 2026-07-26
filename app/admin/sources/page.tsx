import { AlertTriangle, Database, Radar, RefreshCw } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import NaverWorksDrivePanel from "@/components/admin/NaverWorksDrivePanel";
import { CONSULTING_TOPIC_FAMILIES } from "@/lib/content-ops/config";

const SOURCES = [
  { name: "e나라 표준인증", area: "국내 표준·인증", cadence: "주 1회", state: "연결 준비" },
  { name: "기업마당", area: "지원사업·정책정보", cadence: "매일", state: "API 연계 준비" },
  { name: "K-Startup", area: "창업지원사업", cadence: "매일", state: "API 연계 준비" },
  { name: "기업부설연구소 신고관리시스템", area: "연구소·전담부서", cadence: "주 2회", state: "변경 감시 준비" },
  { name: "한국식품안전관리인증원", area: "HACCP·식품인증", cadence: "주 2회", state: "변경 감시 준비" },
  { name: "해외규격인증획득지원센터", area: "해외인증·수출규제", cadence: "주 2회", state: "변경 감시 준비" },
];

export default function SourcesPage() {
  return (
    <AdminPortal
      title="주제·자료 수집"
      description="공식 API와 공식기관 자료를 우선 수집해 종합 경영컨설팅 주제 지도를 계속 확장합니다."
    >
      <NaverWorksDrivePanel />
      <section className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <div className="flex items-center gap-3"><Database className="text-[var(--primary)]" /><h2 className="text-xl font-bold">공식 데이터원</h2></div>
          <div className="mt-5 space-y-3">
            {SOURCES.map((source) => (
              <article key={source.name} className="flex flex-col gap-3 rounded-xl border border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-bold">{source.name}</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">{source.area} · {source.cadence}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-800"><RefreshCw size={14} /> {source.state}</span>
              </article>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <article className="card p-6">
            <div className="flex items-center gap-3"><Radar className="text-[var(--primary)]" /><h2 className="text-xl font-bold">수집 범위</h2></div>
            <div className="mt-5 flex flex-wrap gap-2">
              {CONSULTING_TOPIC_FAMILIES.map((topic) => (
                <span key={topic} className="rounded-full bg-[#fff3e9] px-3 py-2 text-sm font-bold">{topic}</span>
              ))}
            </div>
          </article>
          <article className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <div className="flex gap-3">
              <AlertTriangle className="shrink-0 text-amber-800" />
              <div>
                <h2 className="font-bold text-amber-950">발견과 발행은 분리합니다</h2>
                <p className="mt-2 text-sm leading-7 text-amber-900">
                  새 제도는 먼저 후보함에 넣고 공식 원문과 중복을 확인합니다. 확인되지 않은 정보는 자동 발행하지 않습니다.
                </p>
              </div>
            </div>
          </article>
        </div>
      </section>
    </AdminPortal>
  );
}

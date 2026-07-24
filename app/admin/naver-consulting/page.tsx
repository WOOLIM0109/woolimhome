import Link from "next/link";
import { BookOpen, Bot, ExternalLink, Radar } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import StatusBadge from "@/components/admin/StatusBadge";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";
import { CONSULTING_TOPIC_FAMILIES } from "@/lib/content-ops/config";

const PIPELINE = [
  { title: "ISO 인증을 준비하는 기업이 먼저 확인할 것", type: "정보형", status: "researching" as const, source: "공식기관 자료 확인 중" },
  { title: "기업부설연구소 설립 전 인적·물적 요건 점검", type: "정보형", status: "topic_candidate" as const, source: "제도 변경 감시 대상" },
  { title: "좋은 사업계획서는 지원금을 받기 전에 사업을 바로잡는다", type: "울림 콘텐츠형", status: "creating" as const, source: "울림 노하우 결합" },
  { title: "대표가 컨설팅을 받아도 실행하지 못하는 세 가지 이유", type: "울림 콘텐츠형", status: "topic_candidate" as const, source: "인터뷰 원천자료 필요" },
];

export default function NaverConsultingAdminPage() {
  return (
    <AdminPortal
      title="컨설팅 블로그"
      description="단순 정보형 주 3회와 울림의 소개·성과·노하우·칼럼형 콘텐츠 주 2회를 별도로 관리합니다."
      actions={(
        <>
          <a href="https://blog.naver.com/ygamsjzys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold">
            블로그 열기 <ExternalLink size={17} />
          </a>
          <Link href="/admin/columns/knowledge" className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white">
            <BookOpen size={17} /> 노하우 자료실
          </Link>
        </>
      )}
    >
      <section className="mt-8 grid gap-5 md:grid-cols-3">
        {[
          ["정보형 목표", "주 3회", "검색 유입과 실무 해결"],
          ["콘텐츠형 목표", "주 2회", "울림의 전문성과 신뢰"],
          ["수집 범위", "종합 경영컨설팅", "공식자료 중심으로 계속 확장"],
        ].map(([label, value, note]) => (
          <article key={label} className="card p-5">
            <p className="text-sm text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-2xl font-bold">{value}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{note}</p>
          </article>
        ))}
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center gap-3">
          <Bot className="text-[var(--primary)]" />
          <div>
            <h2 className="text-2xl font-bold">콘텐츠 작업 대기열</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">수집된 후보는 출처와 중복을 확인한 뒤 초안으로 이동합니다.</p>
          </div>
        </div>
        <div className="space-y-3">
          {PIPELINE.map((item) => (
            <article key={item.title} className="card flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold text-[var(--primary)]">{item.type}</p>
                <h3 className="mt-1 font-bold">{item.title}</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">{item.source}</p>
              </div>
              <StatusBadge status={item.status} />
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center gap-3">
          <Radar className="text-[var(--primary)]" />
          <div>
            <h2 className="text-2xl font-bold">종합 경영컨설팅 주제 지도</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">인증·지원사업·정책자금에 한정하지 않고 계속 확장합니다.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {CONSULTING_TOPIC_FAMILIES.map((topic) => (
            <span key={topic} className="rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-sm font-bold">{topic}</span>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-2xl font-bold">향후 2주 일정</h2>
        <TwoWeekSchedule channel="naver_consulting" />
      </section>
    </AdminPortal>
  );
}

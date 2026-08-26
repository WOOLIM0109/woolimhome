import Link from "next/link";
import { BookOpen, ExternalLink, Radar } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import ManualDraftButton from "@/components/admin/ManualDraftButton";
import ManualGenerateButton from "@/components/admin/ManualGenerateButton";
import WorkQueue from "@/components/admin/WorkQueue";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";
import { CONSULTING_TOPIC_FAMILIES } from "@/lib/content-ops/config";

export default function NaverConsultingAdminPage() {
  return (
    <AdminPortal
      title="컨설팅 블로그"
      description="단순 정보형 주 3회와 울림의 소개·성과·노하우·칼럼형 콘텐츠 주 2회를 별도로 관리합니다."
      actions={(
        <>
          <ManualGenerateButton channel="naver_consulting" />
          <ManualDraftButton channel="naver_consulting" />
          <a href="https://blog.naver.com/ygamsjzys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold">
            블로그 열기 <ExternalLink size={17} />
          </a>
          <Link href="/admin/knowledge" className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white">
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
      <section className="mt-10">
        <h2 className="text-2xl font-bold">실제 자동화 작업 큐</h2>
        <WorkQueue channel="naver_consulting" />
      </section>
    </AdminPortal>
  );
}

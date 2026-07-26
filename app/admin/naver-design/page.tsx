import Link from "next/link";
import { ExternalLink, FileCheck2, ImageIcon, Lightbulb, ShieldCheck } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import ManualGenerateButton from "@/components/admin/ManualGenerateButton";
import WorkQueue from "@/components/admin/WorkQueue";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";

export default function NaverDesignAdminPage() {
  return (
    <AdminPortal
      title="디자인 블로그"
      description="포트폴리오 선정과 이미지 제작 과정은 내부에서 처리하고, 대표님에게는 완성된 JPG·PNG와 본문만 검토 요청합니다."
      actions={(
        <>
          <ManualGenerateButton />
          <a href="https://blog.naver.com/wl_0109" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold">
            블로그 열기 <ExternalLink size={17} />
          </a>
          <Link href="/admin/reviews" className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white">
            <FileCheck2 size={17} /> 완성본 검토
          </Link>
        </>
      )}
    >
      <section className="mt-8 grid gap-5 md:grid-cols-3">
        {[
          { icon: ImageIcon, label: "포트폴리오", value: "주 2회", note: "중복 없는 프로젝트 자동 선정" },
          { icon: Lightbulb, label: "기획·디자인 콘텐츠", value: "초기 주 1회", note: "대표님의 판단과 실제 사례 중심" },
          { icon: ShieldCheck, label: "기본 개인정보 보호", value: "자동 확인", note: "연락처·주소·등록번호·개인 이름" },
        ].map(({ icon: Icon, label, value, note }) => (
          <article key={label} className="card p-5">
            <Icon className="text-[var(--primary)]" />
            <p className="mt-4 text-sm text-[var(--muted)]">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{note}</p>
          </article>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-2xl font-bold">향후 2주 일정</h2>
        <TwoWeekSchedule channel="naver_design" />
      </section>
      <section className="mt-10">
        <h2 className="text-2xl font-bold">실제 자동화 작업 큐</h2>
        <WorkQueue channel="naver_design" />
      </section>
    </AdminPortal>
  );
}

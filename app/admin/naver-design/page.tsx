import Link from "next/link";
import { ExternalLink, FileCheck2, ImageIcon, Lightbulb, ShieldCheck } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import StatusBadge from "@/components/admin/StatusBadge";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";

export default function NaverDesignAdminPage() {
  return (
    <AdminPortal
      title="디자인 블로그"
      description="포트폴리오 선정과 이미지 제작 과정은 내부에서 처리하고, 대표님에게는 완성된 JPG·PNG와 본문만 검토 요청합니다."
      actions={(
        <>
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
        <div className="mb-4">
          <h2 className="text-2xl font-bold">포트폴리오 제작 대기열</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">원본 파일명, PSD 종류, 슬라이드 번호 같은 기술 정보는 표시하지 않습니다.</p>
        </div>
        <article className="card flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="rounded-2xl bg-[#fff0e5] p-4 text-[var(--primary)]"><ImageIcon size={26} /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--primary)]">첫 검토 후보</p>
              <h3 className="mt-2 text-lg font-bold">충청남도 국내·외 관광마케팅 전략 발표자료</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                기존 블로그와 중복을 다시 확인하고, 기본 개인정보 보호와 완성 이미지 제작을 마친 뒤 검토 요청으로 이동합니다.
              </p>
            </div>
          </div>
          <StatusBadge status="creating" />
        </article>
      </section>

      <section className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="font-bold text-emerald-950">대표님이 확인하는 화면</h2>
        <p className="mt-2 text-sm leading-7 text-emerald-900">
          완성된 대표 썸네일, 본문용 JPG·PNG, 글 전체 미리보기만 보여드립니다.
          추가로 가릴 내용은 완성본 검토 단계에서 수정 요청으로 전달할 수 있습니다.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-2xl font-bold">향후 2주 일정</h2>
        <TwoWeekSchedule channel="naver_design" />
      </section>
    </AdminPortal>
  );
}

import Link from "next/link";
import { Bell, Bot, CalendarDays, FileCheck2, MessageSquareText } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import ChannelCard from "@/components/admin/ChannelCard";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";
import CollapsibleSection from "@/components/admin/CollapsibleSection";

export default function AdminDashboardPage() {
  return (
    <AdminPortal
      title="전체 현황"
      description="홈페이지와 두 네이버 블로그의 초안, 검토 요청, 향후 발행 일정을 한곳에서 확인합니다."
      actions={(
        <>
          <Link href="/admin/reviews" className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 font-bold">
            <FileCheck2 size={18} /> 검토 요청
          </Link>
          <Link href="/admin/schedule" className="btn-gradient inline-flex items-center gap-2 rounded-xl px-4 py-3 font-bold text-white">
            <CalendarDays size={18} /> 전체 일정
          </Link>
        </>
      )}
    >
      <section className="mt-8 grid gap-5 xl:grid-cols-4">
        <ChannelCard
          href="/admin/openchat"
          eyebrow="Kakao Open Chat"
          title="오픈채팅 자동배포"
          description="지원사업과 매일 오후 콘텐츠를 수집·검토·승인"
          metrics={[{ label: "오전 공고", value: "평일 11시" }, { label: "오후 콘텐츠", value: "매일 6시" }]}
        />
        <ChannelCard
          href="/admin/columns"
          eyebrow="Website"
          title="홈페이지 칼럼"
          description="공식자료와 울림 노하우를 결합한 심층 칼럼"
          metrics={[{ label: "기본 분량", value: "3,500자" }, { label: "발행 흐름", value: "화·목·격주 토" }]}
        />
        <ChannelCard
          href="/admin/naver-consulting"
          eyebrow="Naver consulting"
          title="컨설팅 블로그"
          description="종합 경영컨설팅 정보와 울림의 관점을 분리해 운영"
          metrics={[{ label: "정보형", value: "주 3회" }, { label: "콘텐츠형", value: "주 2회" }]}
        />
        <ChannelCard
          href="/admin/naver-design"
          eyebrow="Naver design"
          title="디자인 블로그"
          description="포트폴리오와 기획·디자인 전문 콘텐츠 관리"
          metrics={[{ label: "포트폴리오", value: "주 2회" }, { label: "콘텐츠형", value: "초기 주 1회" }]}
        />
      </section>

      <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <Link href="/admin/openchat" className="card card-hover flex-row items-center gap-4 p-5">
          <span className="rounded-xl bg-orange-50 p-3 text-orange-800"><MessageSquareText /></span>
          <span><strong className="block">오픈채팅 자동배포</strong><small className="text-[var(--muted)]">공고·콘텐츠 검토와 게시문 복사</small></span>
        </Link>
        <Link href="/admin/reviews" className="card card-hover flex-row items-center gap-4 p-5">
          <span className="rounded-xl bg-amber-50 p-3 text-amber-800"><FileCheck2 /></span>
          <span><strong className="block">검토 요청</strong><small className="text-[var(--muted)]">완성된 글과 이미지만 확인</small></span>
        </Link>
        <Link href="/admin/sources" className="card card-hover flex-row items-center gap-4 p-5">
          <span className="rounded-xl bg-blue-50 p-3 text-blue-800"><Bell /></span>
          <span><strong className="block">주제·자료 수집</strong><small className="text-[var(--muted)]">새 주제와 변경사항 확인</small></span>
        </Link>
        <Link href="/admin/bot-traffic" className="card card-hover flex-row items-center gap-4 p-5">
          <span className="rounded-xl bg-violet-50 p-3 text-violet-800"><Bot /></span>
          <span><strong className="block">봇 트래픽</strong><small className="text-[var(--muted)]">AI·검색엔진 방문 확인</small></span>
        </Link>
        <Link href="/admin/schedule" className="card card-hover flex-row items-center gap-4 p-5">
          <span className="rounded-xl bg-emerald-50 p-3 text-emerald-800"><CalendarDays /></span>
          <span><strong className="block">향후 2주 일정</strong><small className="text-[var(--muted)]">세 채널 발행 계획 통합</small></span>
        </Link>
      </section>

      <CollapsibleSection
        storageKey="home-schedule"
        title="향후 2주 발행 계획"
        description="날짜가 지나면 다음 일정이 자동으로 이어집니다."
      >
        <TwoWeekSchedule />
      </CollapsibleSection>
    </AdminPortal>
  );
}

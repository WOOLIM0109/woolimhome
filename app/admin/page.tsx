import Link from "next/link";
import { ArrowUpRight, Bell, Bot, CalendarDays, FileCheck2, MessageSquareText } from "lucide-react";
import AdminPortal from "@/components/admin/AdminPortal";
import ChannelCard from "@/components/admin/ChannelCard";
import TwoWeekSchedule from "@/components/admin/TwoWeekSchedule";
import CollapsibleSection from "@/components/admin/CollapsibleSection";

const QUICK_LINKS = [
  { href: "/admin/openchat", icon: MessageSquareText, title: "오픈채팅 자동배포", description: "공고·콘텐츠 검토와 게시문 복사" },
  { href: "/admin/reviews", icon: FileCheck2, title: "검토 요청", description: "완성된 글과 이미지만 확인" },
  { href: "/admin/sources", icon: Bell, title: "주제·자료 수집", description: "새 주제와 변경사항 확인" },
  { href: "/admin/bot-traffic", icon: Bot, title: "봇 트래픽", description: "AI·검색엔진 방문 확인" },
  { href: "/admin/schedule", icon: CalendarDays, title: "향후 2주 일정", description: "세 채널 발행 계획 통합" },
];

export default function AdminDashboardPage() {
  return (
    <AdminPortal
      title="전체 현황"
      description="홈페이지와 두 네이버 블로그의 초안, 검토 요청, 향후 발행 일정을 한곳에서 확인합니다."
      actions={(
        <>
          <Link href="/admin/reviews" className="inline-flex h-12 items-center gap-2 border border-[var(--line)] bg-white px-5 font-bold transition-colors hover:border-[#eb6826] hover:text-[#eb6826]">
            <FileCheck2 size={18} /> 검토 요청
          </Link>
          <Link href="/admin/schedule" className="btn-gradient inline-flex h-12 items-center gap-2 px-5 font-bold text-white">
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

      {/*
        바로가기 다섯 개.

        카드 다섯 장을 한 줄에 늘어놓으니 제목과 설명이 제각각 접혀서
        지저분했습니다. 공개 사이트의 사업영역 목록처럼 1px 선으로 나눈
        가로 줄로 바꿉니다. 글이 접히지 않고, 제목이 세로로 줄을 맞춥니다.
      */}
      <nav className="mt-10 border-t border-[#262626]" aria-label="바로가기">
        {QUICK_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group flex items-center gap-4 border-b border-[var(--line)] px-1 py-5 transition-colors hover:bg-[#fafafa]"
            >
              <Icon size={19} strokeWidth={1.6} aria-hidden className="shrink-0 text-[#eb6826]" />
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-7">
                <strong className="block text-[17px] font-bold sm:w-[190px] sm:shrink-0">{item.title}</strong>
                <small className="mt-1 block text-[15px] leading-6 text-[var(--muted)] sm:mt-0">{item.description}</small>
              </span>
              <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-[#d4d4d4] transition-colors group-hover:border-[#eb6826] group-hover:bg-[#eb6826] group-hover:text-white">
                <ArrowUpRight size={16} aria-hidden />
              </span>
            </Link>
          );
        })}
      </nav>

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

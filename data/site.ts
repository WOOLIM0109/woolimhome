export const site = {
  name: "울림컴퍼니",
  englishName: "WOOLIM COMPANY",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://woolimcompany.kr",
  description:
    "울림컴퍼니는 기업의 성장 단계에 맞춰 경영컨설팅, 정부지원사업, 기업인증, 사업계획서, IR/PPT, 디자인 제작을 연결하는 비즈니스 성장 파트너입니다.",
  phone: "010-9522-0350",
  fax: "0504-431-6532",
  email: "woolim@woolimcompany.kr",
  alternateEmail: "wlc_0109@naver.com",
  kakaoUrl: "http://pf.kakao.com/_xjSKdG",
  address: "부산광역시 동구 중앙대로296번길 3-3, 극동빌딩 504호",
  addressShort: "부산 동구 중앙대로296번길 3-3, 504호",
  businessHours: "평일 09:00 ~ 18:00",
  closedDays: "주말, 법정공휴일",
  representative: "박미성",
  representativeTitle: "울림컴퍼니 대표 / (주)셀라벤토 대표이사",
  registrationNumber: "682-25-00824",
  award: "2026 올해의 고객만족브랜드대상 경영컨설팅 부문 1위",
  awardArticleUrl: "https://www.gokorea.kr/news/articleView.html?idxno=870002",
  // 오시는 길
  directions: {
    transit:
      "초량역 12번 출구로 나와 약 120m 직진 후, 시티호텔 사이 골목으로 들어와 우측으로 꺾어 50m 앞 건물 5층입니다.",
    parking:
      "건물 바로 앞 공영주차장(부산광역시 동구 중앙대로296번길 7-3)을 이용하실 수 있습니다. 30분당 1,500원이 부과되며 경차는 50% 할인됩니다.",
    note: "주차 공간이 다소 혼잡할 수 있어 대중교통 이용을 권장드립니다.",
  },
  keywords: [
    "울림컴퍼니",
    "경영컨설팅",
    "정부지원사업",
    "정책자금",
    "기업인증",
    "사업계획서",
    "IR 자료",
    "입찰제안서",
    "PPT 디자인",
    "부산 경영컨설팅",
  ],
};

export const navigation = [
  {
    label: "회사소개",
    href: "/about",
    children: [
      { label: "울림컴퍼니 소개", href: "/about" },
      { label: "대표 소개", href: "/about/ceo" },
      { label: "오시는 길", href: "/about/location" },
    ],
  },
  {
    label: "사업영역",
    href: "/services/consulting",
    children: [
      { label: "경영컨설팅", href: "/services/consulting" },
      { label: "비즈니스문서/PPT", href: "/services/business-docs" },
      { label: "디자인서비스", href: "/services/design" },
    ],
  },
  {
    label: "프로젝트",
    href: "/projects/business-docs",
    children: [
      { label: "비즈니스문서/PPT", href: "/projects/business-docs" },
      { label: "시각디자인", href: "/projects/design" },
    ],
  },
  {
    label: "주요사례",
    href: "/cases/consulting",
    children: [
      { label: "컨설팅/사업계획서", href: "/cases/consulting" },
      { label: "입찰/입점/PPT", href: "/cases/ppt" },
    ],
  },
  {
    label: "알림마당",
    href: "/news",
    children: [
      { label: "소식/언론보도", href: "/news" },
      { label: "칼럼", href: "/columns" },
    ],
  },
  {
    label: "상담신청",
    href: "/contact",
    children: [
      { label: "문의하기", href: "/contact" },
      // 비용안내 페이지는 잠시 비공개 상태입니다. 다시 열려면 아래 줄의 주석을 해제하고
      // app/contact/pricing/page.tsx 의 PRICING_OPEN 을 true 로 바꾸세요.
      // { label: "비용안내", href: "/contact/pricing" },
    ],
  },
];

export const stats = [
  { value: "1,000+", label: "실제 컨설팅 사례" },
  { value: "20억+", label: "지원사업 유치 (진입 2년)" },
  { value: "2026", label: "고객만족브랜드대상 1위" },
  { value: "33기", label: "국가공인 경영지도사" },
];

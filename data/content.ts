import {
  Award,
  BriefcaseBusiness,
  Building2,
  FileText,
  Gavel,
  Landmark,
  Layers,
  Lightbulb,
  Palette,
  PenTool,
  Presentation,
  ScrollText,
  ShieldCheck,
  Store,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* 사업영역 (3대 서비스)                                                */
/* ------------------------------------------------------------------ */
export const services = [
  {
    slug: "consulting",
    href: "/services/consulting",
    icon: BriefcaseBusiness,
    eyebrow: "Management Consulting",
    title: "경영컨설팅",
    summary:
      "예비창업자부터 성장기업까지, 자금조달·정부지원사업·기업인증 방향을 기업 상황에 맞춰 종합 설계합니다.",
    points: [
      "예비·초기기업(3년 이내) 사업화 전략",
      "3년 이상 성장기업 자금조달·확장 로드맵",
      "여성기업·벤처·연구소·이노비즈·메인비즈 인증",
      "정부지원사업·R&D·정책자금 신청 전략",
    ],
    faq: [
      {
        question: "울림컴퍼니 경영컨설팅은 어떤 기업에게 적합한가요?",
        answer:
          "예비창업자, 초기기업, 3년 이상 성장기업, 기술스타트업, 제조업, 소상공인 등 사업화와 자금조달 방향을 정리해야 하는 기업에게 적합합니다.",
      },
      {
        question: "기업인증 컨설팅도 함께 받을 수 있나요?",
        answer:
          "여성기업, 벤처기업, 기업부설연구소, 연구개발전담부서, 이노비즈, 메인비즈 등 기업 상황에 맞는 인증 가능성을 검토하고 준비 과정을 지원합니다.",
      },
    ],
  },
  {
    slug: "business-docs",
    href: "/services/business-docs",
    icon: FileText,
    eyebrow: "Business Documents",
    title: "비즈니스문서/PPT",
    summary:
      "단순 디자인이 아니라 문서의 목적·흐름·핵심 메시지를 먼저 설계하고, 기획형 디자인으로 완성합니다.",
    points: [
      "회사소개서, 제안서, 제품·상품소개서",
      "사업계획서, 정부지원사업 계획서, IR 자료",
      "입찰제안서, 발표자료, 보고서",
      "스토리라인 설계와 인포그래픽 시각화",
    ],
    faq: [
      {
        question: "기존 PPT 리디자인도 가능한가요?",
        answer:
          "가능합니다. 기존 자료의 구조, 메시지, 컬러, 레이아웃을 점검해 목적에 맞는 기획형 디자인으로 보완합니다.",
      },
      {
        question: "사업계획서 작성 대행과 컨설팅은 어떻게 다른가요?",
        answer:
          "작성 컨설팅은 방향과 구조를 함께 잡는 방식이고, 작성 대행은 제출 목적에 맞춰 문서 작성과 기획을 더 깊게 수행하는 방식입니다.",
      },
    ],
  },
  {
    slug: "design",
    href: "/services/design",
    icon: Palette,
    eyebrow: "Design Service",
    title: "디자인서비스",
    summary:
      "브랜드의 첫인상을 완성하는 로고·명함·카다로그·브로셔·리플렛·포스터 등 홍보·편집 디자인을 제공합니다.",
    points: [
      "로고, 명함, 브랜드 기본 디자인",
      "카다로그, 브로셔, 리플렛, 전단",
      "포스터, 현수막, 배너, 책자, 워크북",
      "출력 환경과 활용 목적을 고려한 편집 디자인",
    ],
    faq: [
      {
        question: "카다로그와 브로셔 제작도 가능한가요?",
        answer:
          "가능합니다. 제품, 서비스, 사업 내용을 체계적으로 소개할 수 있도록 콘텐츠 구성과 시각 디자인을 함께 설계합니다.",
      },
      {
        question: "디자인 원고가 정리되지 않아도 의뢰할 수 있나요?",
        answer:
          "가능합니다. 핵심 문구와 정보 흐름을 함께 정리해 보기 쉽고 이해하기 쉬운 구성으로 완성합니다.",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 신뢰 지표 / 대표 약력                                                */
/* ------------------------------------------------------------------ */
export const trustSignals = [
  "중기부 재기컨설팅 기초진로제시 기술사업성 분석 부문 공급기업",
  "중기부 비즈니스지원단 클리닉 위원",
  "부산가톨릭대학교 창업멘토",
  "국가공인 경영지도사 33기 (중소벤처기업부)",
];

export const ceo = {
  name: "박미성",
  title: "울림컴퍼니 대표 / (주)셀라벤토 대표이사",
  photo: "/images/ceo/ceo-main.jpg",
  photoSub: "/images/ceo/ceo-sub.jpg",
  greeting: [
    "울림컴퍼니는 기업의 성장이 곧 우리의 성장이라는 믿음으로, 기업과 함께 고민하고 함께 성장하는 비즈니스 성장 파트너입니다.",
    "많은 기업들이 좋은 아이템과 가능성을 가지고 있지만 정책자금, 정부지원사업, 기업인증, 투자유치, 사업계획서 작성 과정에서 어디서부터 어떻게 준비해야 할지 막막함을 느끼곤 합니다.",
    "울림컴퍼니는 이러한 기업의 상황을 함께 분석하고, 기업의 강점과 가능성이 제대로 전달될 수 있도록 전략과 실행을 연결하는 파트너가 되겠습니다.",
    "기업의 가능성이 더 큰 울림이 될 수 있도록, 울림컴퍼니가 함께하겠습니다.",
  ],
  credentials: [
    "국가공인 경영지도사 33기 (중소벤처기업부)",
    "중기부 재기컨설팅 기초진로제시 기술사업성 분석 부문 공급기업",
    "중기부 비즈니스지원단 클리닉 위원",
    "부산가톨릭대학교 창업멘토",
    "(주)셀라벤토 대표이사",
  ],
};

/* ------------------------------------------------------------------ */
/* 홈 - 주요사례 하이라이트                                             */
/* ------------------------------------------------------------------ */
export const caseHighlights = [
  {
    category: "정부지원사업",
    title: "TIPS R&D 기술창업지원 최종 선정",
    result: "8억 원",
    description: "AI 커뮤니티 플랫폼 개발 기업의 기술창업지원 사업 선정을 지원했습니다.",
    icon: TrendingUp,
  },
  {
    category: "공공조달 입찰",
    title: "서울 공공 서비스 용역 입찰 수주",
    result: "12억 원 낙찰",
    description: "입찰 서류와 발표자료의 구조·설득 흐름·디자인을 통합 제작했습니다.",
    icon: Gavel,
  },
  {
    category: "입점·제휴",
    title: "강남 더현대 · CJ온스타일 · 카카오 선물하기",
    result: "입점 확정",
    description: "대기업·플랫폼·백화점 입점 제안 서류와 PPT를 기획·디자인했습니다.",
    icon: Store,
  },
  {
    category: "브랜드 신뢰",
    title: "올해의 고객만족브랜드대상 수상",
    result: "경영컨설팅 1위",
    description: "전문성과 고객 중심 서비스 역량을 인정받았습니다.",
    icon: Trophy,
  },
];

/* ------------------------------------------------------------------ */
/* 대기업·공공기관 고객사 (실적)                                        */
/* ------------------------------------------------------------------ */
export const clients = [
  { name: "SK", logo: "/logos/sk.png" },
  { name: "삼성화재", logo: "/logos/samsung-fire.png" },
  { name: "CJ", logo: "/logos/cj.svg" },
  { name: "중소벤처기업부", logo: "/logos/mss.svg" },
  { name: "중소벤처기업진흥공단", logo: "/logos/kosmes.svg" },
  { name: "한국수자원공사", logo: "/logos/kwater.png" },
  { name: "애경산업", logo: "/logos/aekyung.png" },
  { name: "IBK투자증권", logo: "/logos/ibk-securities.png" },
  { name: "금호석유화학", logo: "/logos/kumho-petrochemical.png" },
  {
    name: "한국법교육센터",
    logo: "/logos/korea-law-education-black.png",
  },
  { name: "충북대학교", logo: "/logos/chungbuk-university.png" },
  { name: "광주소방서", logo: "/logos/gwangju-fire.png" },
  {
    name: "부평소방서",
    logo: "/logos/bupyeong-fire.png",
    supportingLabel: "부평소방서",
  },
  {
    name: "인천광역시 장애인체육회",
    logo: "/logos/incheon-para-sports.png",
  },
  { name: "초록우산", logo: "/logos/childfund-korea.png" },
  { name: "청곡종합사회복지관", logo: "/logos/cheonggok-welfare.png" },
];

/* ------------------------------------------------------------------ */
/* 컨설팅 / 사업계획서 주요사례 (정부지원사업 성과)                      */
/* ------------------------------------------------------------------ */
export const consultingCases = [
  {
    company: "D사",
    field: "AI 커뮤니티 플랫폼 개발 · 사업화",
    headline: "8억 원",
    image: "/images/proof/plan-3.png",
    wins: [
      "TIPS(기술창업지원) 최종 선정 — 8억 원",
      "초기창업패키지 최종 선정 — 7,000만 원",
      "데이터가공 지원사업 최종 선정 — 5,500만 원",
      "테크서비스 수출바우처 — 3,000만 원",
      "RISE 산학공동연구(R&D) 선정 — 3,000만 원",
    ],
  },
  {
    company: "T사",
    field: "반려동물용품 개발 · 사업화",
    headline: "1억 4천만 원",
    image: "/images/proof/plan-7.png",
    wins: [
      "예비창업패키지 최종 선정 — 7,000만 원",
      "청년창업사관학교 최종 선정 — 7,000만 원",
    ],
  },
  {
    company: "S사",
    field: "수면 APP 개발 · 사업화",
    headline: "2억 7천만 원",
    image: "/images/proof/plan-1.png",
    wins: [
      "초기창업패키지 최종 선정 — 7,000만 원",
      "창업성장기술개발 디딤돌 — 2억 원",
    ],
  },
  {
    company: "Y사",
    field: "공연 기획 · 연출 · 운영",
    headline: "6억 원",
    image: "/images/proof/plan-9.png",
    wins: ["문체부 ‘지역대표 예술단체 지원사업’ 선정 — 6억 원"],
  },
];

// 경영컨설팅 페이지용 빠른 성과 사례
export const quickWins = [
  { item: "반려동물용품 개발", program: "예비창업패키지", amount: "7,000만 원" },
  { item: "승마용품 제조", program: "스포츠산업 창업지원(예비창업)", amount: "4,000만 원" },
  { item: "차량관리 플랫폼", program: "예비창업패키지", amount: "6,000만 원" },
  { item: "AI 플랫폼 개발", program: "창업중심대학", amount: "7,000만 원" },
  { item: "AI 커뮤니티 플랫폼", program: "TIPS R&D", amount: "8억 원" },
  { item: "에듀테크 AI 플랫폼", program: "신용보증기금 NEST", amount: "1억 원" },
];

/* ------------------------------------------------------------------ */
/* 입찰 / 입점 / 대회 주요사례 (PPT·서류 기획/디자인)                    */
/* ------------------------------------------------------------------ */
export const pptCases = [
  {
    group: "공공조달 입찰",
    icon: Gavel,
    items: [
      { company: "D사", title: "서울 공공 서비스 용역 입찰제안", result: "12억 원 낙찰" },
      { company: "H사", title: "지역구 폐기물 수집·처리 용역 입찰제안", result: "10억 원 낙찰" },
      { company: "A사", title: "진로 교육 기획 수업 입찰제안", result: "3.5억 원 낙찰" },
      { company: "B사", title: "지자체 축제 개최 입찰제안", result: "1억 원 낙찰" },
      { company: "W사", title: "M아파트 방수·페인트 입찰제안", result: "1억 원 낙찰" },
    ],
  },
  {
    group: "입점 · 제휴",
    icon: Store,
    items: [
      { company: "B사", title: "강남 더현대 팝업스토어 입점", result: "입점 확정" },
      { company: "L사", title: "CJ온스타일 라이브커머스 협업제안", result: "협업 확정" },
      { company: "L사", title: "카카오톡 선물하기 기획상품 입점", result: "입점 확정" },
    ],
  },
  {
    group: "대회 · 수상",
    icon: Award,
    items: [
      { company: "L사", title: "품질분임조 경진대회 (발표코칭 포함)", result: "지역부문 최우수상" },
      { company: "B기관", title: "구급업무 연찬 발표대회", result: "2등 수상" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 타사 vs 울림컴퍼니 비교                                              */
/* ------------------------------------------------------------------ */
export const comparison = [
  {
    axis: "컨설팅",
    others: "단일 과제(자금·특허·인증 등) 해결 중심",
    woolim: "기업 성장 단계에 맞춘 종합 설계",
  },
  {
    axis: "자금조달",
    others: "자금(융자) 중심",
    woolim: "정책자금·지원사업·투자까지 연결",
  },
  {
    axis: "영업방식",
    others: "별도의 검토 없이 ‘무조건 된다’는 방식",
    woolim: "기업 기초 자료를 꼼꼼히 검토 후 맞춤 성장 로드맵 제공",
  },
  {
    axis: "기술 이해",
    others: "일반 소상공인 외 기술스타트업은 컨트롤하지 못함",
    woolim: "기술스타트업·제조업·소상공인 등 전 산업 컨트롤",
  },
  {
    axis: "서류·디자인",
    others: "외주 용역",
    woolim: "디자인팀·컨설팅팀·경영지원팀 상주, 올인원 진행",
  },
];

/* ------------------------------------------------------------------ */
/* 경영컨설팅 - 3개 트랙 / 기업인증                                     */
/* ------------------------------------------------------------------ */
export const consultingTracks = [
  {
    icon: Lightbulb,
    title: "예비 ~ 초기기업 (3년 이내)",
    desc: "좋은 아이디어를 가진 초기 기업이 사업 구조화, 시장 진입, 자금 확보의 어려움을 넘어 안정적으로 성장할 수 있도록 설계합니다.",
    points: [
      "사업 아이템 구체화 및 방향 설정",
      "개발·사업화 전략 및 비즈니스 모델 수립",
      "정부지원사업 검토 및 신청 전략",
      "정책자금·R&D 등 자금조달 방향 검토",
      "사업계획서 작성 방향 설계",
    ],
  },
  {
    icon: TrendingUp,
    title: "3년 이상 성장기업",
    desc: "자금 확보, 사업영역 확장, 재무 안정성, 기업 신뢰도가 중요해지는 시점에 맞춰 실행 전략을 제안합니다.",
    points: [
      "자금확보를 위한 기업 현황 진단",
      "기업 성장성·사업 확장 가능성 검토",
      "재무 안정성 및 운영 구조 점검",
      "기업인증 취득 방향 검토",
      "정책자금·지원사업 연계 및 자금조달 실행 지원",
    ],
  },
  {
    icon: ShieldCheck,
    title: "기업인증 컨설팅",
    desc: "기술력·경영역량·혁신성·연구개발 역량을 증명하는 인증을 기업 상황에 맞게 제안하고 취득을 지원합니다.",
    points: [
      "기업 현황 및 인증 가능성 사전 검토",
      "기업별 적합 인증 제안 및 요건 안내",
      "신청서류·증빙자료 준비 지원",
      "인증 진행 절차 관리",
      "인증 후 정책자금·지원사업·R&D 활용 방향 제안",
    ],
  },
];

export const certifications = [
  { name: "벤처기업", desc: "기술성·성장성·혁신성을 기반으로 한 기업 신뢰도 확보" },
  { name: "이노비즈", desc: "기술혁신성과 성장 가능성을 갖춘 기업을 위한 인증" },
  { name: "메인비즈", desc: "경영혁신 역량과 운영 체계를 갖춘 기업을 위한 인증" },
  { name: "기업부설연구소·연구개발전담부서", desc: "연구개발 역량을 체계화하고 R&D 기반을 구축하는 제도" },
  { name: "여성기업·사회적기업", desc: "공공구매 및 지원제도 활용 기반 마련" },
];

export const certBenefits = [
  { title: "금융·보증 우대", desc: "보증료율·보증비율 우대, 보증한도 확대, 보증보험 한도 증액" },
  { title: "정책자금 우대", desc: "정책자금 신청 시 우대, 자금지원 한도 우대, 자금조달 가능성 확대" },
  { title: "정부지원사업 가점", desc: "정부지원사업·R&D 과제·정책자금 심사 시 가점 및 우대" },
  { title: "세무·관세 우대", desc: "조건 충족 시 정기 세무조사 유예, 관세조사 유예 등" },
  { title: "공공입찰·판로 우대", desc: "조달청·나라장터·공공구매·공공입찰 평가 시 신인도 가점" },
  { title: "사업확장 기반", desc: "R&D·투자유치·입찰·신규 거래처 확보 등 사업영역 확장에 활용" },
];

/* ------------------------------------------------------------------ */
/* 비즈니스문서 - 제작 프로세스 / 제작 분야                             */
/* ------------------------------------------------------------------ */
export const docProcess = [
  {
    step: "01",
    title: "핵심 키워드 도출",
    desc: "복잡한 자료 속에서 꼭 전달해야 할 핵심 키워드를 도출하고 문서의 방향성을 명확하게 정리합니다.",
  },
  {
    step: "02",
    title: "스토리라인 설계",
    desc: "읽는 사람이 자연스럽게 이해할 수 있는 목차와 흐름을 설계합니다.",
  },
  {
    step: "03",
    title: "기획형 디자인",
    desc: "문서의 목적과 메시지가 잘 전달되도록 정보 구조와 디자인을 함께 설계합니다.",
  },
  {
    step: "04",
    title: "맞춤형 시각화",
    desc: "텍스트 중심의 내용을 도표·그래프·인포그래픽으로 전환해 가독성과 전달력을 높입니다.",
  },
];

export const docTypes = [
  { icon: Building2, name: "회사소개서", desc: "기업의 비전·사업영역·경쟁력·주요 실적을 정리한 기업 소개 문서" },
  { icon: Store, name: "제품·서비스 소개서", desc: "제품의 특징·장점·활용성·차별성을 시각적으로 전달하는 소개 자료" },
  { icon: PenTool, name: "사업제안서", desc: "협업·입점·납품·제휴 등을 위한 제안 목적의 비즈니스 문서" },
  { icon: Gavel, name: "입찰제안서", desc: "발주처 요구사항과 평가 기준에 맞춘 입찰·공모 대응 문서" },
  { icon: Target, name: "사업계획서", desc: "사업모델·시장성·실행계획·수익구조를 체계적으로 정리한 문서" },
  { icon: Landmark, name: "정부지원사업 계획서", desc: "지원사업 목적과 평가 기준에 맞춘 사업 내용·추진 전략 문서" },
  { icon: TrendingUp, name: "IR 자료", desc: "투자자 관점에서 사업성·성장성·수익모델을 설득하는 투자 제안 자료" },
  { icon: ScrollText, name: "보고서", desc: "성과·조사·운영 결과 등을 목적에 맞게 정리하고 시각화한 문서" },
  { icon: Presentation, name: "발표·강의안", desc: "발표 흐름과 청중 이해도를 고려한 강의 및 프레젠테이션 자료" },
  { icon: Layers, name: "포트폴리오", desc: "기업·브랜드·개인의 수행 경험과 결과물을 정리한 소개 자료" },
];

/* ------------------------------------------------------------------ */
/* 디자인 - 제작 분야 / 차별점                                          */
/* ------------------------------------------------------------------ */
export const designFields = [
  { name: "로고 디자인", desc: "브랜드의 정체성과 방향성을 시각적으로 표현하는 기본 디자인" },
  { name: "명함 디자인", desc: "기업과 개인의 첫인상을 전달하는 비즈니스 기본 홍보물" },
  { name: "카다로그 디자인", desc: "제품·서비스·사업 내용을 체계적으로 소개하는 책자형 홍보물" },
  { name: "브로셔 디자인", desc: "기업·브랜드·서비스의 핵심 정보를 압축적으로 전달하는 홍보물" },
  { name: "리플렛 디자인", desc: "행사·서비스·제품 정보를 간결하게 안내하는 접지형 홍보물" },
  { name: "전단 디자인", desc: "프로모션·이벤트·상품 안내 등 빠른 정보 전달을 위한 홍보물" },
  { name: "포스터 디자인", desc: "행사·캠페인·공지·홍보 메시지를 시각적으로 강조하는 디자인" },
  { name: "현수막·배너 디자인", desc: "행사장·매장·전시·홍보 공간에서 활용하는 대형 출력물" },
  { name: "책자·워크북 디자인", desc: "교육자료·안내서·보고서·프로그램북 등 페이지형 편집 디자인" },
];

export const designDifferentiators = [
  {
    title: "목적에 맞는 디자인",
    desc: "사용 목적과 상황을 파악한 뒤 홍보·안내·제안·행사·판매 등 활용 목적에 맞는 디자인 방향을 설정합니다.",
  },
  {
    title: "브랜드 톤을 반영한 맞춤 디자인",
    desc: "기업의 로고·컬러·업종·고객층을 고려해 브랜드 이미지와 어울리는 통일감 있는 디자인을 제작합니다.",
  },
  {
    title: "제작물 활용성까지 고려",
    desc: "실제 사용 목적과 출력 환경을 고려해 가독성·여백·규격·인쇄 활용성까지 반영합니다.",
  },
];

/* ------------------------------------------------------------------ */
/* 프로젝트 갤러리                                                      */
/* ------------------------------------------------------------------ */
export const projectDocCategories = [
  {
    key: "intro",
    label: "회사·제품 소개서",
    description: "기업·브랜드·제품의 강점을 목적과 독자에 맞춰 명확하게 전달한 소개서입니다.",
  },
  {
    key: "proposal",
    label: "제안서",
    description: "입찰·제휴·납품·영업 목적에 맞춘 설득형 제안서.",
  },
  {
    key: "ir",
    label: "사업계획서·IR",
    description: "사업모델·시장성·수익구조를 체계적으로 정리한 사업계획서·IR 자료.",
  },
  {
    key: "report",
    label: "발표 PT·보고서",
    description: "발표 흐름과 데이터를 읽기 쉬운 구조로 재편집한 발표자료·보고서.",
  },
];

export const portfolioProjects = [
  {
    id: "keepu",
    company: "㈜킵유",
    title: "유기농 블루베리즙 제품소개서",
    type: "제품소개서",
    industry: "유통·판매",
    category: "intro",
    cover: "/images/projects/keepu/cover.png",
    images: [
      "/images/projects/keepu/cover.png",
      "/images/projects/keepu/slide-01.webp",
      "/images/projects/keepu/slide-02.webp",
      "/images/projects/keepu/slide-03.webp",
    ],
  },
  {
    id: "lekaming",
    company: "르카밍",
    title: "스킨케어 제품소개서",
    type: "제품소개서",
    industry: "뷰티",
    category: "intro",
    cover: "/images/projects/lekaming/cover.webp",
    images: [
      "/images/projects/lekaming/cover.webp",
      "/images/projects/lekaming/slide-01.webp",
      "/images/projects/lekaming/slide-02.webp",
      "/images/projects/lekaming/slide-03.webp",
    ],
  },
  {
    id: "vaa",
    company: "VAA",
    title: "모델 에이전시 회사소개서",
    type: "회사소개서",
    industry: "모델 에이전시",
    category: "intro",
    cover: "/images/projects/vaa/cover.png",
    images: [
      "/images/projects/vaa/cover.png",
      "/images/projects/vaa/slide-01.webp",
      "/images/projects/vaa/slide-02.webp",
      "/images/projects/vaa/slide-03.webp",
    ],
  },
  {
    id: "dreamheart",
    company: "드림하트",
    title: "신발 깔창 제품소개서",
    type: "제품소개서",
    industry: "신발 깔창 판매",
    category: "intro",
    cover: "/images/projects/dreamheart/cover.webp",
    images: [
      "/images/projects/dreamheart/cover.webp",
      "/images/projects/dreamheart/slide-01.webp",
      "/images/projects/dreamheart/slide-02.webp",
      "/images/projects/dreamheart/slide-03.webp",
    ],
  },
];

// 시각디자인 포트폴리오 이미지는 준비 중 (별도 전달 예정)
export const projectDesignReady = false;

export const projects = [
  {
    title: "대기업·공공기관 제안서",
    type: "입찰제안서",
    industry: "공공조달",
    note: "평가 기준에 맞춘 문서 구조와 발표 흐름 설계",
    image: "/images/portfolio/p-37.png",
  },
  {
    title: "정부지원사업 사업계획서",
    type: "사업계획서/IR",
    industry: "스타트업",
    note: "시장성·사업화 전략·수익모델 중심 정리",
    image: "/images/proof/plan-3.png",
  },
  {
    title: "기업 소개 및 투자 자료",
    type: "회사소개서/IR",
    industry: "기술기업",
    note: "핵심 메시지 도출과 인포그래픽형 시각화",
    image: "/images/portfolio/p-33.png",
  },
  {
    title: "보고서·성과자료",
    type: "보고서/PPT",
    industry: "기관·기업",
    note: "성과와 데이터를 읽기 쉬운 구조로 재편집",
    image: "/images/portfolio/p-19.png",
  },
];

/* ------------------------------------------------------------------ */
/* 알림마당 / 칼럼                                                      */
/* ------------------------------------------------------------------ */
export const news = [
  {
    title: "울림컴퍼니, 2026 올해의 고객만족브랜드대상 경영컨설팅 부문 1위 수상",
    date: "2026-06-23",
    source: "공감신문",
    href: "https://www.gokorea.kr/news/articleView.html?idxno=870002",
    summary:
      "울림컴퍼니가 고객 만족도와 서비스 품질, 브랜드 경쟁력을 인정받아 경영컨설팅 부문 수상 브랜드로 이름을 올렸습니다.",
  },
];

export const columns = [
  {
    title: "정부지원사업 사업계획서, 처음 준비할 때 확인할 것",
    summary: "지원사업 목적, 평가 항목, 사업화 단계에 맞춰 핵심 메시지를 먼저 정리해야 합니다.",
  },
  {
    title: "IR 자료와 회사소개서는 왜 다르게 만들어야 할까",
    summary: "투자자 설득과 기업 소개는 독자가 보는 관점이 다르기 때문에 문서 구조도 달라져야 합니다.",
  },
  {
    title: "입찰제안서에서 평가자가 먼저 보는 요소",
    summary: "요구사항 대응, 수행체계, 차별성, 실적 근거가 명확히 보이도록 설계해야 합니다.",
  },
];

/* ------------------------------------------------------------------ */
/* 비용안내                                                             */
/* ------------------------------------------------------------------ */
export const pricingCore = [
  {
    icon: BriefcaseBusiness,
    title: "경영 컨설팅",
    price: "연 계약 330만 원~",
    note: "성과수수료 별도",
    detail: "자금·정부지원사업·투자 방향을 기업 상황에 맞춰 종합 검토하는 기업 맞춤형 성장 로드맵.",
  },
  {
    icon: ShieldCheck,
    title: "기업 인증",
    price: "88만 원~",
    note: "여성기업 외 기준",
    detail: "여성기업·연구소 설립·벤처·이노비즈·메인비즈 등 인증별 요건을 검토합니다.",
  },
  {
    icon: Target,
    title: "사업계획서",
    price: "컨설팅 33만 원 / 작성대행 110만 원~",
    note: "단건 기준",
    detail: "정부지원사업·투자유치 목적에 맞춰 문서 방향과 구조를 설계합니다.",
  },
];

export const pricingTables = [
  {
    title: "PPT 기획·디자인 (VAT 포함)",
    note: "장당 기준",
    columns: ["구분", "기본 디자인", "고급 디자인", "인포그래픽형"],
    rows: [
      ["표지", "88,000원", "165,000원", "문의"],
      ["내지", "38,500원", "88,000원", "문의"],
    ],
  },
  {
    title: "카다로그·브로셔 디자인 (장당)",
    note: "수정 2회 포함 · 맞춤기획은 기획 2회 + 디자인 2회",
    columns: ["기본 디자인", "일반 디자인", "고급 디자인", "맞춤기획·디자인"],
    rows: [["22,000원", "38,500원", "55,000원", "88,000~110,000원"]],
  },
  {
    title: "리플렛·팜플렛 디자인",
    note: "",
    columns: ["기본 디자인", "고급 디자인", "인포그래픽형"],
    rows: [["33만 원~", "66만 원~", "문의"]],
  },
  {
    title: "포스터 디자인",
    note: "",
    columns: ["기본 디자인", "고급 디자인", "인포그래픽형"],
    rows: [["165,000원~", "33만 원~", "문의"]],
  },
];

// 기존 페이지 호환용
export const pricing = [
  { title: "경영 컨설팅", price: "연 계약 330만 원부터", detail: "자금·정부지원사업·투자 방향을 종합 검토합니다. 성과수수료는 별도입니다." },
  { title: "기업 인증", price: "88만 원부터", detail: "여성기업·연구소·벤처·이노비즈·메인비즈 등 인증별 요건을 검토합니다." },
  { title: "사업계획서", price: "컨설팅 33만 원 / 작성 대행 110만 원부터", detail: "정부지원사업·투자유치 목적에 맞춰 문서 방향과 구조를 설계합니다." },
  { title: "PPT 디자인", price: "장당 22,000원부터", detail: "기본·일반·고급·맞춤기획 범위에 따라 비용이 달라집니다." },
];

/* ------------------------------------------------------------------ */
/* 공통 FAQ                                                             */
/* ------------------------------------------------------------------ */
export const commonFaqs = [
  {
    question: "상담 전 어떤 자료를 준비하면 좋나요?",
    answer:
      "회사소개서, 기존 사업계획서, 지원사업 공고문, 제품/서비스 설명자료, 기존 PPT 중 가능한 자료를 보내주시면 상담이 더 구체적으로 진행됩니다.",
  },
  {
    question: "카카오톡으로 문의할 수 있나요?",
    answer: "가능합니다. 홈페이지의 카카오톡 문의 버튼을 통해 상담 요청을 남길 수 있습니다.",
  },
  {
    question: "비용은 어떻게 산정되나요?",
    answer:
      "서비스 종류, 자료 준비 정도, 기획 범위, 디자인 난이도, 일정에 따라 달라집니다. 필요하신 서비스와 상황을 알려주시면 상담을 통해 정확한 금액을 안내드립니다.",
  },
  {
    question: "처음부터 계약을 해야 하나요?",
    answer:
      "아닙니다. 먼저 영업부터 하지 않습니다. 대표님 사업 상황을 먼저 듣고 성장 로드맵을 제안드린 뒤, 신중하게 결정하시면 됩니다.",
  },
];

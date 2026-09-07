export const designPortfolioCategories = [
  { key: "all", label: "전체" },
  { key: "editorial", label: "인쇄·편집" },
  { key: "branding", label: "로고·브랜딩" },
  { key: "infographic", label: "인포그래픽" },
  { key: "poster", label: "포스터" },
  { key: "spatial", label: "배너·공간 그래픽" },
] as const;

export type DesignPortfolioCategory = Exclude<
  (typeof designPortfolioCategories)[number]["key"],
  "all"
>;

export type DesignPortfolioProject = {
  id: string;
  category: DesignPortfolioCategory;
  client: string;
  title: string;
  summary: string;
  deliverables: string;
  preview: "spread" | "identity" | "mockup" | "square" | "poster" | "banner";
  featured?: boolean;
  images: ReadonlyArray<{
    src: string;
    alt: string;
  }>;
};

const portfolioAssetVersion = "20260907-final-2";

function projectImages(slug: string, count: number, alt: string) {
  return Array.from({ length: count }, (_, index) => ({
    src: `/images/design-portfolio/${slug}/${String(index + 1).padStart(2, "0")}.webp?v=${portfolioAssetVersion}`,
    alt: `${alt} ${index + 1}`,
  }));
}

export const designPortfolioProjects: ReadonlyArray<DesignPortfolioProject> = [
  {
    id: "yuwol-kitchen",
    category: "branding",
    client: "유월키친",
    title: "브랜드 로고 시스템",
    summary: "달과 별의 이미지를 따뜻한 색감으로 정리해 정적인 브랜드 인상을 구축한 로고 프로젝트입니다.",
    deliverables: "로고 · 컬러 시스템 · 브랜드 보드",
    preview: "identity",
    featured: true,
    images: projectImages("yuwol-kitchen", 2, "유월키친 브랜드 로고 시스템"),
  },
  {
    id: "yearon-dayhug",
    category: "branding",
    client: "이어온랩 · 데이허그",
    title: "확장형 브랜드 로고 시스템",
    summary: "기업 브랜드와 서비스 브랜드가 함께 쓰일 수 있도록 심볼과 가로형 로고를 설계했습니다.",
    deliverables: "심볼 · 국영문 로고 · 응용형",
    preview: "identity",
    images: projectImages("yearon-dayhug", 3, "이어온랩과 데이허그 로고 디자인"),
  },
  {
    id: "sinacell-logo",
    category: "branding",
    client: "시나셀",
    title: "기술 기업 로고 시스템",
    summary: "기술 기업의 전문성과 확장성을 푸른 그라데이션과 선명한 워드마크로 표현했습니다.",
    deliverables: "심볼 · 워드마크 · 로고 응용",
    preview: "identity",
    images: projectImages("sinacell-logo", 3, "시나셀 기술 기업 로고 디자인"),
  },
  {
    id: "onlyone-universe",
    category: "branding",
    client: "온리원유니버스",
    title: "로고 및 명함 디자인",
    summary: "강한 대비의 빨강과 검정을 활용해 브랜드 로고와 명함 응용 체계를 구성했습니다.",
    deliverables: "로고 · 로고 보드 · 명함",
    preview: "identity",
    images: projectImages("onlyone-universe", 5, "온리원유니버스 로고와 명함 디자인"),
  },
  {
    id: "allclean-card",
    category: "branding",
    client: "모두올클린",
    title: "서비스 브랜드 명함",
    summary: "청소 서비스의 신뢰감과 명료한 정보 전달을 중심으로 제작한 명함 디자인입니다.",
    deliverables: "명함 · 정보 편집 · 인쇄 디자인",
    preview: "mockup",
    images: projectImages("allclean-card", 2, "모두올클린 서비스 브랜드 명함"),
  },
  {
    id: "sinacell-stationery",
    category: "branding",
    client: "시나셀",
    title: "명함·대소봉투 디자인",
    summary: "로고의 그래픽 모티프를 명함과 대소봉투에 일관되게 적용한 기업 서식 디자인입니다.",
    deliverables: "명함 · 대봉투 · 소봉투",
    preview: "mockup",
    images: projectImages("sinacell-stationery", 4, "시나셀 명함과 봉투 디자인"),
  },
  {
    id: "s-company-infographic",
    category: "infographic",
    client: "S사",
    title: "연구개발계획서 인포그래픽",
    summary: "AI 기반 연구개발계획서의 기술 구조와 추진 내용을 문서용 도식으로 시각화했습니다.",
    deliverables: "정보 구조 · 도식화 · 인포그래픽",
    preview: "square",
    images: projectImages("s-company-infographic", 10, "S사 연구개발계획서 인포그래픽"),
  },
  {
    id: "wegofair-wall",
    category: "spatial",
    client: "위고페어",
    title: "브랜드 보호 서비스 벽면 그래픽",
    summary: "서비스의 핵심 기능과 브랜드 보호 메시지를 사무 공간의 대형 벽면에 맞춰 구성했습니다.",
    deliverables: "정보 설계 · 벽면 디자인 · 대형 출력",
    preview: "banner",
    images: projectImages("wegofair-wall", 3, "위고페어 브랜드 보호 서비스 벽면 그래픽"),
  },
  {
    id: "pamity-wall",
    category: "spatial",
    client: "파미티",
    title: "데이터 솔루션 벽면 디자인",
    summary: "데이터 연결과 기술 확장의 이미지를 밝은 파랑 계열의 대형 그래픽으로 표현했습니다.",
    deliverables: "키비주얼 · 벽면 디자인 · 대형 출력",
    preview: "banner",
    images: projectImages("pamity-wall", 1, "파미티 데이터 솔루션 벽면 디자인"),
  },
  {
    id: "career-concert",
    category: "spatial",
    client: "진로콘서트",
    title: "월별 행사 현수막 시리즈",
    summary: "월별 강연 주제와 연사 구성을 서로 다른 테마로 전개한 행사 현수막 시리즈입니다.",
    deliverables: "행사 키비주얼 · 현수막 · 시리즈 디자인",
    preview: "poster",
    images: projectImages("career-concert", 4, "진로콘서트 월별 행사 현수막"),
  },
  {
    id: "pamity-panel-ko",
    category: "spatial",
    client: "파미티",
    title: "공간 AI 솔루션 전시 패널",
    summary: "공간 데이터 솔루션의 구조와 기능을 전시 현장에서 빠르게 이해하도록 정리한 패널입니다.",
    deliverables: "정보 구조 · 전시 패널 · 대형 출력",
    preview: "spread",
    images: projectImages("pamity-panel-ko", 1, "파미티 공간 AI 솔루션 국문 전시 패널"),
  },
  {
    id: "pamity-panel-en",
    category: "spatial",
    client: "파미티",
    title: "영문 전시 패널",
    summary: "글로벌 전시 환경에서 기술과 서비스 흐름을 전달하도록 구성한 영문 패널입니다.",
    deliverables: "영문 편집 · 전시 패널 · 대형 출력",
    preview: "spread",
    images: projectImages("pamity-panel-en", 1, "파미티 공간 AI 솔루션 영문 전시 패널"),
  },
  {
    id: "k-rotary",
    category: "editorial",
    client: "K로터리팜",
    title: "벽면녹화 기술 리플렛",
    summary: "벽면녹화 기술의 차별점과 적용 효과를 한눈에 비교할 수 있도록 구성한 리플렛입니다.",
    deliverables: "정보 구조 · 편집 디자인 · 리플렛",
    preview: "spread",
    images: projectImages("k-rotary", 2, "K로터리팜 벽면녹화 기술 리플렛"),
  },
  {
    id: "w-company-leaflet",
    category: "editorial",
    client: "위ㅇㅇㅇ",
    title: "브랜드 보호 서비스 2단 리플렛",
    summary: "위조 상품 대응 서비스의 기능과 이용 흐름을 양면 리플렛 안에 명확히 정리했습니다.",
    deliverables: "정보 편집 · 2단 리플렛 · 인쇄 디자인",
    preview: "spread",
    images: projectImages("w-company-leaflet", 4, "브랜드 보호 서비스 2단 리플렛"),
  },
  {
    id: "just-drip",
    category: "editorial",
    client: "저스트드립",
    title: "카페 메뉴판·입간판·현수막",
    summary: "카페의 제품 정보와 특허·베스트 메뉴를 매장 안팎의 홍보물에 일관되게 적용했습니다.",
    deliverables: "메뉴판 · 입간판 · 가로 현수막",
    preview: "mockup",
    images: projectImages("just-drip", 3, "저스트드립 카페 메뉴판과 홍보물"),
  },
  {
    id: "sinacell-catalog",
    category: "editorial",
    client: "시나셀",
    title: "글로벌 제품 카탈로그",
    summary: "제품의 기술 정보와 적용 분야를 파랑 계열의 기업 이미지로 정리한 카탈로그입니다.",
    deliverables: "정보 설계 · 카탈로그 · 편집 디자인",
    preview: "spread",
    images: projectImages("sinacell-catalog", 8, "시나셀 글로벌 제품 카탈로그"),
  },
  {
    id: "clean-care-catalog",
    category: "editorial",
    client: "청정케어",
    title: "설비 케어 서비스 카탈로그",
    summary: "설비·청소·하수구 관리 서비스를 청결하고 신뢰감 있는 인상으로 정리한 카탈로그입니다.",
    deliverables: "서비스 구조 · 카탈로그 · 편집 디자인",
    preview: "spread",
    images: projectImages("clean-care-catalog", 7, "청정케어 설비 케어 서비스 카탈로그"),
  },
  {
    id: "catchcloud-forum",
    category: "editorial",
    client: "캐치클라우드",
    title: "2026 DIOPS 포럼 자료집",
    summary: "국제안경전 포럼의 전문성과 네트워크 이미지를 프리즘 모티프로 표현한 자료집입니다.",
    deliverables: "자료집 · 편집 디자인 · 후가공 설계",
    preview: "spread",
    images: projectImages("catchcloud-forum", 6, "2026 DIOPS 국제안경전 포럼 자료집"),
  },
  {
    id: "dream-attic",
    category: "editorial",
    client: "콘텐츠잇다",
    title: "꿈다락 프로그램 결과자료집",
    summary: "교육 프로그램의 흐름과 주요 결과를 다양한 편집 리듬으로 정리한 인쇄 자료집입니다.",
    deliverables: "콘텐츠 편집 · 결과자료집 · 인쇄 디자인",
    preview: "spread",
    images: projectImages("dream-attic", 10, "꿈다락 프로그램 결과자료집 편집 디자인"),
  },
  {
    id: "c-company-leaflet",
    category: "editorial",
    client: "C사",
    title: "AI 스마트케어 4단 리플렛",
    summary: "AI 기반 스마트케어 서비스의 구성과 작동 흐름을 4단 인쇄물에 체계적으로 배치했습니다.",
    deliverables: "서비스 구조 · 4단 리플렛 · 인쇄 디자인",
    preview: "spread",
    images: projectImages("c-company-leaflet", 2, "C사 AI 스마트케어 4단 리플렛"),
  },
  {
    id: "expo-flyers",
    category: "editorial",
    client: "M사 · H사",
    title: "박람회 홍보물",
    summary: "박람회 현장에서 서비스와 지원 내용을 빠르게 전달하도록 제작한 B5 전단지 시리즈입니다.",
    deliverables: "정보 편집 · B5 전단지 · 박람회 홍보물",
    preview: "spread",
    images: projectImages("expo-flyers", 4, "M사와 H사 박람회 홍보 전단지"),
  },
  {
    id: "ai-support-poster",
    category: "poster",
    client: "창업 교육 프로그램",
    title: "정부지원사업 AI 활용 포스터",
    summary: "정부지원사업과 AI 활용 강의의 핵심 메시지를 강한 대비로 전달한 행사 포스터입니다.",
    deliverables: "행사 키비주얼 · 정보 편집 · 포스터",
    preview: "poster",
    images: projectImages("ai-support-poster", 1, "정부지원사업 AI 활용 강의 포스터"),
  },
  {
    id: "startup-poster",
    category: "poster",
    client: "동의대학교 RISE사업단",
    title: "창업 아이디어 공모전 포스터",
    summary: "모집 개요와 후속 프로그램을 창업의 성장 단계에 맞춰 시각화한 공모전 포스터입니다.",
    deliverables: "콘셉트 · 정보 편집 · 포스터",
    preview: "poster",
    images: projectImages("startup-poster", 1, "동의대학교 창업 아이디어 공모전 포스터"),
  },
  {
    id: "buyer-response-poster",
    category: "poster",
    client: "해외 바이어 응대 강연",
    title: "행사 채널별 웹 포스터",
    summary: "해외 바이어 응대 강연의 내용을 각 행사 플랫폼 규격에 맞춰 전개한 웹 포스터입니다.",
    deliverables: "웹 포스터 · 썸네일 · 채널별 변형",
    preview: "poster",
    images: projectImages("buyer-response-poster", 2, "해외 바이어 응대 강연 웹 포스터"),
  },
  {
    id: "water-research-poster",
    category: "poster",
    client: "수자원 연구",
    title: "학회 논문 포스터",
    summary: "연구 배경과 결과를 물과 하늘의 시각 언어로 정리한 학회 발표용 논문 포스터입니다.",
    deliverables: "연구 정보 구조 · 학회 포스터 · 대형 출력",
    preview: "poster",
    images: projectImages("water-research-poster", 2, "수자원 연구 학회 논문 포스터"),
  },
  {
    id: "hpc-poster",
    category: "poster",
    client: "HPC컨설팅",
    title: "일터혁신 상생컨설팅 웹 포스터",
    summary: "지원 대상과 컨설팅 절차를 긴 호흡의 한 장 안에서 단계별로 안내한 웹 포스터입니다.",
    deliverables: "정보 설계 · 인포그래픽 · 웹 포스터",
    preview: "poster",
    images: projectImages("hpc-poster", 1, "HPC컨설팅 일터혁신 상생컨설팅 웹 포스터"),
  },
];

export function getDesignCategoryLabel(category: DesignPortfolioCategory) {
  return designPortfolioCategories.find((item) => item.key === category)?.label ?? category;
}

import { NextResponse } from "next/server";
import { authenticatedAdmin, contentAdmin } from "@/lib/content-ops/data";

const TITLE = "지역의 매력을 한눈에 전달하는 관광마케팅 전략 발표자료 디자인";
const SUMMARY =
  "충청남도의 관광자원과 국내외 마케팅 전략을 복잡한 정보 속에서도 빠르게 이해할 수 있도록 설계한 발표자료 포트폴리오입니다.";
const SCHEDULE_KEY = "restored-chungnam-tourism-portfolio";

const BODY_HTML = `<h2>지역의 매력을 설득력 있게 보여주는 발표자료는 무엇이 다를까요?</h2>
<p>관광마케팅 전략 발표자료에는 지역의 위치와 접근성, 관광자원, 시장 환경, 경쟁 지역, 실행 전략처럼 성격이 다른 정보가 한꺼번에 들어갑니다. 자료가 많다는 이유로 모든 내용을 비슷한 크기로 나열하면 청중은 핵심을 놓치기 쉽습니다. 울림컴퍼니는 이번 충청남도 국내·외 관광마케팅 전략 발표자료에서 정보를 단순히 꾸미는 데 그치지 않고, 발표의 흐름에 따라 이해할 수 있도록 구조를 정리하는 데 집중했습니다.</p>
<p>첫 화면에서는 충청남도의 자연 이미지를 유기적인 프레임 안에 배치하고, 보라색을 포인트 컬러로 사용했습니다. 공공기관 발표자료에 필요한 신뢰감은 유지하면서도 관광이라는 주제가 가진 기대감과 생동감을 함께 전달하기 위한 선택입니다.</p>
<figure><img src="https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/main-collage.png?v=be1fd5f" alt="충청남도 관광마케팅 전략 발표자료의 주요 슬라이드를 조합한 포트폴리오 목업"><figcaption>표지와 접근성·환경분석·해외시장 전략을 한눈에 보여주는 메인 포트폴리오 이미지</figcaption></figure>
<h2>먼저 ‘어디에 있고, 무엇이 있는가’를 빠르게 이해하게 했습니다</h2>
<p>관광 전략을 설명하려면 청중이 지역의 위치와 이동 환경을 먼저 이해해야 합니다. 그래서 초반부에는 충청남도의 지리적 위치와 주요 거점에서의 접근 시간을 지도와 함께 배치했습니다. 긴 문장으로 교통 여건을 설명하기보다, 지도와 시간 정보를 한 화면에서 비교할 수 있게 구성해 발표자가 핵심만 짚어도 내용이 전달되도록 했습니다.</p>
<p>관광자원 페이지는 충남의 다양한 명소를 한눈에 조망할 수 있는 지도를 중심으로 설계했습니다. 정보량이 많은 화면일수록 모든 요소를 강조하지 않고, 대표 메시지와 지도의 시선 순서를 분리해야 합니다. 이 방식은 청중이 ‘관광자원이 풍부하다’는 결론을 먼저 이해하고 세부 정보를 살펴보게 합니다.</p>
<figure><img src="https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/mockup-1.png?v=09f53cb" alt="충청남도 관광마케팅 발표자료의 위치와 관광자원 구성 목업"><figcaption>지역의 위치와 접근성, 관광자원을 한 흐름으로 정리한 발표자료 구성</figcaption></figure>
<h2>분석 자료는 보기 좋게가 아니라 판단하기 쉽게 정리했습니다</h2>
<p>대내외 환경분석과 SWOT처럼 텍스트가 많아지는 페이지에서는 정보의 위계를 분명히 했습니다. 외부환경, 내부환경, 이해관계자 동향을 색으로 구분하고, 각 영역 안에서는 핵심 문장과 근거 내용을 나눠 읽는 순서를 만들었습니다. SWOT 페이지도 강점·약점·기회·위협을 단순히 네 칸에 넣는 데서 끝내지 않고, 도출된 전략 방향과 연결되도록 구성했습니다.</p>
<p>이처럼 분석 페이지의 목적은 정보를 많이 보여주는 것이 아니라 다음 전략이 왜 필요한지 납득시키는 것입니다. 발표자료 기획 단계에서 분석과 실행 방향 사이의 연결고리를 먼저 정리하면, 디자인 역시 장식보다 논리를 강화하는 역할을 할 수 있습니다.</p>
<figure><img src="https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/mockup-2.png?v=09f53cb" alt="충청남도 관광마케팅 발표자료의 환경분석과 SWOT 구성 목업"><figcaption>환경분석과 SWOT을 전략 방향으로 연결한 정보 구조</figcaption></figure>
<h2>관광 이미지는 분위기와 전략을 함께 전달하도록 사용했습니다</h2>
<p>주요 전략 페이지에는 지역의 공간과 활동을 보여주는 이미지를 활용했습니다. 사진을 크게 배치하는 것만으로는 전략 자료가 되지 않기 때문에, 각 이미지가 어떤 관광 경험과 연결되는지 설명이 함께 읽히도록 구성했습니다. 보라색 라벨과 곡선형 그래픽은 표지부터 본문까지 반복해 전체 자료에 일관성을 주었습니다.</p>
<p>울림컴퍼니의 PPT 디자인은 원고를 예쁘게 옮기는 작업보다, 청중이 정보를 받아들이는 순서를 설계하는 일에 가깝습니다. 특히 공공기관과 지역 관광 발표자료처럼 조사 내용이 많은 문서는 핵심 메시지, 근거, 이미지의 역할을 먼저 구분해야 전달력이 높아집니다.</p>
<figure><img src="https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/mockup-3.png?v=d78979b" alt="충청남도 관광마케팅 발표자료의 주요 전략 구성 목업"><figcaption>주요 전략과 후속 실행 방향을 시각적으로 정리한 구성</figcaption></figure>
<h2>이번 포트폴리오에서 확인할 수 있는 기획 포인트</h2>
<ul>
<li><strong>정보 구조:</strong> 지역 이해 → 환경분석 → 전략 방향으로 이어지는 흐름을 만들었습니다.</li>
<li><strong>시각적 일관성:</strong> 보라색 계열과 유기적인 그래픽 요소를 반복해 하나의 자료처럼 보이게 했습니다.</li>
<li><strong>지도·사진 활용:</strong> 긴 설명을 줄이고 지역의 위치와 관광자원을 직관적으로 전달했습니다.</li>
<li><strong>발표 친화성:</strong> 한 화면에서 발표자가 강조해야 할 핵심이 먼저 보이도록 위계를 조정했습니다.</li>
</ul>
<p>관광마케팅, 지역 활성화, 공공기관 사업 발표자료는 내용의 전문성과 시각적 친근함을 동시에 갖춰야 합니다. 전달할 정보가 많아 정리가 어렵거나, 기존 원고의 논리를 발표 흐름에 맞게 재구성해야 한다면 기획 단계부터 디자인을 함께 설계하는 것이 좋습니다.</p>`;

const FAQ = [
  {
    question: "자료 내용이 정리되지 않은 상태에서도 PPT 제작을 의뢰할 수 있나요?",
    answer: "가능합니다. 다만 원고의 완성도와 자료량에 따라 정보 구조 정리, 핵심 메시지 도출, 슬라이드 구성 범위를 먼저 협의합니다.",
  },
  {
    question: "공공기관이나 지자체 발표자료도 친근하게 디자인할 수 있나요?",
    answer: "기관의 신뢰감을 해치지 않는 범위에서 사진, 지도, 색상과 그래픽을 활용해 주제를 쉽게 이해할 수 있도록 설계할 수 있습니다.",
  },
  {
    question: "기존 발표자료의 내용은 유지하고 디자인만 개선할 수도 있나요?",
    answer: "가능합니다. 기존 구조를 유지하는 단순 디자인 개선과, 발표 흐름까지 재구성하는 기획형 작업을 구분해 진행할 수 있습니다.",
  },
];

const ASSETS = [
  {
    asset_type: "thumbnail",
    public_url: "https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/thumbnail.png",
    sort_order: 0,
  },
  {
    asset_type: "body_image",
    public_url: "https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/main-collage.png?v=be1fd5f",
    sort_order: 1,
  },
  {
    asset_type: "body_image",
    public_url: "https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/mockup-1.png?v=09f53cb",
    sort_order: 2,
  },
  {
    asset_type: "body_image",
    public_url: "https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/mockup-2.png?v=09f53cb",
    sort_order: 3,
  },
  {
    asset_type: "body_image",
    public_url: "https://woolim-site.vercel.app/portfolio-drafts/chungnam-tourism-strategy/mockup-3.png?v=d78979b",
    sort_order: 4,
  },
] as const;

export async function POST() {
  const user = await authenticatedAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = contentAdmin();
  const tags = ["PPT디자인", "관광마케팅", "발표자료", "공공기관PPT", "포트폴리오"];
  const plainLength = BODY_HTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const { data: item, error: itemError } = await admin
    .from("content_work_items")
    .upsert({
      channel: "naver_design",
      format: "portfolio",
      title: TITLE,
      summary: SUMMARY,
      status: "approved",
      source_label: "울림컴퍼니 실제 프로젝트",
      source_reference: "충청남도 국내·외 관광마케팅 전략 발표자료",
      scheduled_at: "2026-07-28T02:00:00.000Z",
      schedule_key: SCHEDULE_KEY,
      review_note: "기존 검토·승인 포트폴리오 복구",
      created_by: user.email,
      metadata: {
        sourcePolicy: "approved-existing-work",
        restoredAt: new Date().toISOString(),
        generated: {
          title: TITLE,
          excerpt: SUMMARY,
          bodyHtml: BODY_HTML,
          faq: FAQ,
          tags,
        },
        portfolioReview: {
          suitable: true,
          confidence: 1,
          documentType: "관광마케팅 전략 발표자료",
          industry: "관광·공공기관",
          reasons: ["대표 검토를 거쳐 보존하는 울림컴퍼니 기존 포트폴리오"],
          rejectionReasons: [],
          sensitiveRegions: [],
        },
        validation: {
          plainLength,
          h2Count: 5,
          faqCount: FAQ.length,
          figureCount: 4,
          issues: [],
        },
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "schedule_key" })
    .select("id,title,status")
    .single();
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });

  const { error: deleteAssetsError } = await admin
    .from("content_review_assets")
    .delete()
    .eq("work_item_id", item.id);
  if (deleteAssetsError) {
    return NextResponse.json({ error: deleteAssetsError.message }, { status: 500 });
  }
  const { error: assetError } = await admin.from("content_review_assets").insert(
    ASSETS.map((asset) => ({
      ...asset,
      work_item_id: item.id,
      approved: true,
      review_note: "기존 승인 포트폴리오 복구 이미지",
    })),
  );
  if (assetError) return NextResponse.json({ error: assetError.message }, { status: 500 });

  return NextResponse.json({ restored: true, item });
}

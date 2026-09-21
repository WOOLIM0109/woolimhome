import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowDown, ArrowRight, ArrowUpRight, Files, Network, Search } from "lucide-react";
import ClientMarquee from "@/components/ClientMarquee";
import ComparisonTable from "@/components/ComparisonTable";
import ContactBand from "@/components/ContactBand";
import FaqList from "@/components/FaqList";
import JsonLd from "@/components/JsonLd";
import {
  caseHighlights,
  commonFaqs,
  portfolioProjects,
  projects,
  services,
  trustSignals,
} from "@/data/content";
import { designPortfolioProjects } from "@/data/design-portfolio";
import { homeTestimonials } from "@/data/home-testimonials";
import { site, stats } from "@/data/site";
import { buildCanonical } from "@/lib/site-config";
import {
  breadcrumbSchema,
  faqSchema,
  itemListSchema,
  newsArticleSchema,
} from "@/lib/schema";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "울림컴퍼니",
  description:
    "울림컴퍼니는 경영컨설팅, 정부지원사업, 기업인증, 사업계획서, IR/PPT, 디자인 제작을 연결하는 비즈니스 성장 파트너입니다. 진입 2년 만에 지원사업 20억 이상 유치, 1,000건 이상 컨설팅 사례 보유.",
  alternates: { canonical: buildCanonical("/") },
};

const selectedPresentations = portfolioProjects.filter((project) =>
  ["grang-factory", "wposition-data"].includes(project.id),
);
const selectedIdentity = designPortfolioProjects.find(
  (project) => project.id === "sinacell-stationery",
);

export default function HomePage() {
  return (
    <div className={styles.home}>
      <JsonLd
        data={[
          breadcrumbSchema([{ name: "홈", href: "/" }]),
          faqSchema(commonFaqs),
          itemListSchema(
            "울림컴퍼니 주요 프로젝트",
            projects.map((project) => ({
              title: project.title,
              description: project.note,
              href: "/portfolio",
            })),
          ),
          newsArticleSchema(),
        ]}
      />

      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroIntro}>
          <div>
            <p className={styles.kicker}>WOOLIM COMPANY</p>
            <h1 id="home-title" className={styles.heroTitle}>
              기업의 가능성에,<br />
              <span className={styles.titleLast}>
                더 큰 울림을<span className={styles.period}>.</span>
              </span>
            </h1>
          </div>
          <div className={styles.heroAside}>
            <p>
              사업의 방향을 찾는 순간부터<br />
              그 가치를 세상에 전하는 순간까지.<br />
              전략과 기획, 디자인으로 함께합니다.
            </p>
            <Link href="/about" className={styles.textLink}>
              울림컴퍼니 소개 <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <Image
            src="/images/brand/woolim-workspace-hero-v1.webp"
            alt="자연광 아래 제안서와 오렌지색 제본 책을 놓은 작업공간 브랜드 이미지"
            fill
            sizes="(max-width: 1500px) 100vw, 1440px"
            preload
            className={styles.heroImage}
          />
          <div className={styles.imageCaption}>
            <span>THOUGHTFUL STRATEGY. MEANINGFUL DESIGN.</span>
            <a href="#business" aria-label="사업영역으로 이동">
              <ArrowDown size={22} />
            </a>
          </div>
        </div>
        <div className={styles.heroFoot}>
          <p>
            경영컨설팅 <span>·</span> 비즈니스문서 / PPT <span>·</span> 디자인
          </p>
          <Link href="/contact">
            프로젝트 문의 <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section
        id="business"
        className={`${styles.section} ${styles.business}`}
        aria-labelledby="business-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>OUR BUSINESS</p>
            <h2 id="business-title">
              좋은 전략이<br />
              분명한 결과가 되도록.
            </h2>
          </div>
          <p className={styles.intro}>
            문서 하나, 디자인 하나를 만들기 전에<br />
            기업의 상황과 목적을 먼저 읽습니다.<br />
            성장에 필요한 일을 함께 설계하고 완성합니다.
          </p>
        </div>
        <div className={styles.serviceList}>
          {services.map((service, index) => (
            <Link
              key={service.href}
              href={service.href}
              className={styles.service}
            >
              <span className={styles.serviceNumber}>0{index + 1}</span>
              <div className={styles.serviceName}>
                <h3>{service.title}</h3>
                <p>{service.eyebrow}</p>
              </div>
              <p className={styles.serviceDescription}>{service.summary}</p>
              <span className={styles.circleArrow}>
                <ArrowUpRight size={22} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.approach} aria-labelledby="approach-title">
        <div className={styles.approachImage}>
          <Image
            src="/images/brand/woolim-editorial-detail-v1.webp"
            alt="인쇄물과 컬러 스와치로 표현한 울림의 기획·편집 디자인 브랜드 이미지"
            fill
            sizes="(max-width: 800px) 100vw, 50vw"
          />
        </div>
        <div className={styles.approachCopy}>
          <p className={styles.kicker}>THE WAY WE WORK</p>
          <h2 id="approach-title">
            생각을 정리하고,<br />
            가치를 보이게 합니다.
          </h2>
          <p className={styles.intro}>
            기업의 이야기를 이해하는 일에서 시작합니다.<br />
            복잡한 내용을 명확한 전략으로, 좋은 아이디어를
            <br className={styles.desktopBreak} /> 설득력 있는 문서와 디자인으로 완성합니다.
          </p>
          <Link href="/about" className={styles.textLink}>
            울림이 일하는 방식 <ArrowUpRight size={20} aria-hidden="true" />
          </Link>
        </div>
        <div className={styles.processWrap}>
          <div className={styles.processHeading}>
            <h3>진단에서 완성까지, 하나로 이어지는 과정</h3>
            <p>기업을 이해한 전략이 실제 결과물에 담기도록.</p>
          </div>
          <ol className={styles.process}>
            <li>
              <div className={styles.processPath}><span>01</span><ArrowRight aria-hidden="true" /></div>
              <div className={styles.processTitle}><Search size={28} aria-hidden="true" /><h4>진단</h4></div>
              <p>기업과 과제를 이해합니다.</p>
              <div className={styles.processDetails}>현황과 목표 확인 · 보유 자료 검토</div>
            </li>
            <li>
              <div className={styles.processPath}><span>02</span><ArrowRight aria-hidden="true" /></div>
              <div className={styles.processTitle}><Network size={28} aria-hidden="true" /><h4>기획</h4></div>
              <p>전략과 전달 흐름을 설계합니다.</p>
              <div className={styles.processDetails}>핵심 메시지 도출 · 문서 구조 설계</div>
            </li>
            <li>
              <div className={styles.processPath}><span>03</span><ArrowUpRight aria-hidden="true" /></div>
              <div className={styles.processTitle}><Files size={28} aria-hidden="true" /><h4>완성</h4></div>
              <p>문서와 디자인으로 구현합니다.</p>
              <div className={styles.processDetails}>내용과 디자인 연결 · 결과물 검토</div>
            </li>
          </ol>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="works-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>SELECTED WORKS</p>
            <h2 id="works-title">
              생각의 깊이를<br />
              결과물로 보여드립니다.
            </h2>
          </div>
          <Link href="/portfolio" className={styles.textLink}>
            포트폴리오 전체 보기 <ArrowUpRight size={19} aria-hidden="true" />
          </Link>
        </div>
        <div className={styles.works}>
          {selectedPresentations.map((project) => (
            <Link key={project.id} href="/portfolio/ppt" className={styles.work}>
              <div className={styles.workImage}>
                <Image
                  src={project.cover}
                  alt={project.title}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 33vw"
                />
              </div>
              <div className={styles.workMeta}>
                <span>{project.type}</span>
                <ArrowUpRight size={19} aria-hidden="true" />
              </div>
              <h3>{project.company}</h3>
              <p>{project.title}</p>
            </Link>
          ))}
          {selectedIdentity && (
            <Link href="/portfolio/design" className={styles.work}>
              <div className={`${styles.workImage} ${styles.identityImage}`}>
                <Image
                  src={selectedIdentity.images[0].src}
                  alt={selectedIdentity.images[0].alt}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 33vw"
                />
              </div>
              <div className={styles.workMeta}>
                <span>브랜딩 · 편집 디자인</span>
                <ArrowUpRight size={19} aria-hidden="true" />
              </div>
              <h3>{selectedIdentity.client}</h3>
              <p>{selectedIdentity.title}</p>
            </Link>
          )}
        </div>
        <div className={styles.portfolioLinks}>
          {projects.map((project) => (
            <Link
              key={project.title}
              href={
                project.type === "사업계획서/IR"
                  ? "/portfolio/business-ir"
                  : "/portfolio/ppt"
              }
            >
              <span>{project.title}</span>
              <span>{project.note}</span>
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.results} aria-labelledby="results-title">
        <div className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>OUR IMPACT</p>
              <h2 id="results-title">
                함께 만든 변화,<br />
                숫자로 남은 성과.
              </h2>
            </div>
            <Link href="/success" className={styles.textLink}>
              성공사례 보기 <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
          </div>
          <dl className={styles.stats}>
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.resultList}>
            {caseHighlights.map((item) => (
              <article key={item.title}>
                <p className={styles.category}>{item.category}</p>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <strong>{item.result}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className={styles.clientHeading}>
        <p className={styles.kicker}>OUR CLIENTS</p>
        <p>다양한 분야의 기업과 기관이 울림과 함께했습니다.</p>
      </div>
      <ClientMarquee />

      <section
        className={`${styles.section} ${styles.trust}`}
        aria-labelledby="trust-title"
      >
        <div>
          <p className={styles.kicker}>EXPERTISE & TRUST</p>
          <h2 id="trust-title">
            경험에 전문성을 더해,<br />
            기업의 다음을 봅니다.
          </h2>
          <p className={styles.intro}>
            국가공인 경영지도사인 대표의 전문성과<br />
            실제 프로젝트 경험을 바탕으로<br />
            기업의 성장 로드맵을 제안합니다.
          </p>
          <Link href="/about" className={styles.textLink}>
            회사소개 보기 <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <ul className={styles.credentials}>
          {trustSignals.map((signal, index) => (
            <li key={signal}>
              <span>0{index + 1}</span>
              {signal}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.voices} aria-labelledby="voices-title">
        <div className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.kicker}>CLIENT VOICES</p>
              <h2 id="voices-title">함께한 고객의 이야기.</h2>
            </div>
            <p className={styles.intro}>
              결과를 만든 대표님들이 전하는<br />
              울림컴퍼니와의 경험입니다.
            </p>
          </div>
          <div className={styles.quotes}>
            {homeTestimonials.map((item) => (
              <figure key={`${item.name}-${item.company}`}>
                <span className={styles.quoteMark} aria-hidden="true">“</span>
                <blockquote>{item.quote}</blockquote>
                <figcaption>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.badge} · {item.company}</span>
                  </div>
                  <em>{item.result}</em>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className={styles.privacyNote}>
            개인정보 보호를 위해 이름과 일부 표현은 익명 처리했습니다.
          </p>
          <section className={styles.comparison} aria-labelledby="difference-title">
            <div className={styles.comparisonIntro}>
              <div>
                <p className={styles.kicker}>WHY WOOLIM</p>
                <h2 id="difference-title">성장 전략부터 디자인까지,<br /><span>하나의 팀</span>으로.</h2>
              </div>
              <p className={styles.intro}>기업의 성장 단계에 맞춰 방향을 설계하고,<br />컨설팅·기획·디자인을 내부 팀이 함께 완성합니다.</p>
            </div>
            <ComparisonTable />
          </section>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.news}`}
        aria-labelledby="news-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>NEWS & INSIGHTS</p>
            <h2 id="news-title">울림의 새로운 소식.</h2>
          </div>
          <Link href="/news" className={styles.textLink}>
            전체 소식 보기 <ArrowUpRight size={19} aria-hidden="true" />
          </Link>
        </div>
        <a
          href={site.awardArticleUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.newsArticle}
        >
          <div>
            <span className={styles.category}>언론보도</span>
            <p>2026.06.23 · 공감신문</p>
          </div>
          <div>
            <h3>{site.award}</h3>
            <p>
              전문성과 고객 중심 서비스 역량을 인정받아 경영컨설팅 부문 수상 브랜드로 이름을 올렸습니다.
            </p>
          </div>
          <ArrowUpRight size={25} aria-hidden="true" />
        </a>
        <Link href="/columns" className={styles.columnLink}>
          <span>사업에 도움이 되는 실무 이야기</span>
          <strong>
            울림 인사이트 · 칼럼 <ArrowRight size={18} aria-hidden="true" />
          </strong>
        </Link>
      </section>
      <FaqList faqs={commonFaqs} />
      <ContactBand />
    </div>
  );
}

import { ArrowDown, Building2, ChartNoAxesCombined, FlaskConical, Landmark, Network, ShieldCheck, Sparkles, Target, TrendingUp, Users, Wallet } from "lucide-react";
import { certBenefits, certifications } from "@/data/content";
import styles from "./BusinessPages.module.css";

const certificationIcons = [Sparkles, FlaskConical, ChartNoAxesCombined, Building2, Users];
const benefitIcons = [Wallet, Landmark, Target, ShieldCheck, Network, TrendingUp];

export default function CertificationFlow() {
  return (
    <div className={styles.certificationFlow}>
      <div className={styles.flowHeading}>
        <span className={styles.flowStep}>01</span>
        <div><h3>기업에 맞는 인증으로, 역량을 증명합니다.</h3><p>다섯 가지 인증 분야 중 기업의 상황과 목적에 맞는 인증을 선택합니다.</p></div>
      </div>
      <div className={styles.certificationOptions}>
        {certifications.map((certification, index) => {
          const Icon = certificationIcons[index] ?? ShieldCheck;
          return (
            <article key={certification.name} className={styles.certificationOption}>
              <Icon size={30} strokeWidth={1.5} aria-hidden="true" />
              <h4>{certification.name}</h4><p>{certification.desc}</p>
            </article>
          );
        })}
      </div>

      <svg className={styles.flowMerge} viewBox="0 0 1000 64" preserveAspectRatio="none" aria-hidden="true">
        <path d="M100 0V30H900V0 M300 0V30 M500 0V64 M700 0V30" />
      </svg>
      <div className={styles.flowMobileArrow} aria-hidden="true"><ArrowDown size={28} /></div>

      <div className={styles.certificationReview}>
        <span className={styles.flowStep}>02</span>
        <div>
          <h3>우리 기업에 적용할 수 있는 혜택을 검토합니다.</h3>
          <p>인증 종류와 기업 요건, 시행기관 및 사업 공고를 함께 확인합니다.</p>
        </div>
        <ShieldCheck size={44} strokeWidth={1.25} aria-hidden="true" />
      </div>

      <div className={styles.flowDirection} aria-hidden="true"><span /><ArrowDown size={28} /></div>
      <div className={styles.flowHeading}>
        <span className={styles.flowStep}>03</span>
        <div><h3>기업인증 주요 혜택</h3><p>검토 결과에 따라 기업 성장에 필요한 지원과 기회를 연결합니다.</p></div>
      </div>
      <div className={styles.certificationBenefits}>
        {certBenefits.map((benefit, index) => {
          const Icon = benefitIcons[index] ?? TrendingUp;
          return (
            <article key={benefit.title} className={styles.certificationBenefit}>
              <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
              <div><h4>{benefit.title}</h4><p>{benefit.desc}</p></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

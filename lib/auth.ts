/**
 * 누가 관리자이고 누가 외주 작가인지 정하는 곳.
 *
 * 예전에는 환경변수가 비어 있으면 코드에 적어 둔 계정으로 조용히 넘어갔습니다.
 * 그러면 Vercel 에서 변수를 지우거나 이름을 잘못 적어도 아무 일 없는 것처럼
 * 보이고, 프리뷰 배포에도 그 계정이 그대로 열립니다. 권한이 조용히 어긋나는
 * 것은 가장 늦게 발견되는 사고라, 운영에서는 열지 않고 막는 쪽으로 바꿉니다.
 *
 * 대신 개발과 프리뷰에서는 기본값을 그대로 두어 로컬 작업이 막히지 않게 합니다.
 */

/**
 * 개발과 프리뷰에서만 쓰는 기본값입니다.
 *
 * 운영에서 누가 들어올 수 있는지는 이 목록이 아니라 Vercel 의 ADMIN_EMAILS
 * 가 정합니다. 여기에 적어 두는 것은 로컬에서 매번 환경변수를 챙기지 않아도
 * 되게 하려는 것뿐입니다.
 */
const DEVELOPMENT_ADMIN_EMAILS = [
  "miseong0928@gmail.com",
  "selavento.geo@gmail.com",
];

export type AuthEnvironment = {
  ADMIN_EMAILS?: string;
  PARTNER_EMAILS?: string;
  NODE_ENV?: string;
};

function currentEnvironment(): AuthEnvironment {
  return {
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    PARTNER_EMAILS: process.env.PARTNER_EMAILS,
    NODE_ENV: process.env.NODE_ENV,
  };
}

function parseEmails(value?: string) {
  return value
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// 같은 경고를 요청마다 찍지 않습니다. 로그가 묻히면 못 보게 됩니다.
let warnedAboutMissingAdmins = false;

export function getAdminEmails(environment: AuthEnvironment = currentEnvironment()) {
  const configured = parseEmails(environment.ADMIN_EMAILS);
  if (configured?.length) return configured;

  if (environment.NODE_ENV === "production") {
    if (!warnedAboutMissingAdmins) {
      warnedAboutMissingAdmins = true;
      console.error(
        "[권한] ADMIN_EMAILS 가 비어 있어 관리자 화면을 아무도 열 수 없습니다."
        + " Vercel 환경변수를 확인해 주세요.",
      );
    }
    return [];
  }
  return DEVELOPMENT_ADMIN_EMAILS;
}

export function getPartnerEmails(environment: AuthEnvironment = currentEnvironment()) {
  return parseEmails(environment.PARTNER_EMAILS) || [];
}

export function isAdmin(email?: string | null) {
  return Boolean(email && getAdminEmails().includes(email.toLowerCase()));
}

export function isPartner(email?: string | null) {
  return Boolean(email && getPartnerEmails().includes(email.toLowerCase()));
}

export function canUsePartnerPortal(email?: string | null) {
  return isAdmin(email) || isPartner(email);
}

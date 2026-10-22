import { getRegisteredApprovedMockupSuite } from "./approved-mockup-suites.ts";

/** Automatic rendering uses every registered standard-size suite. */
export function autoApprovedSuite(aspectPrimary: string | null) {
  return aspectPrimary === "16:9" || aspectPrimary === "a4_landscape" || aspectPrimary === "a4_portrait"
    ? getRegisteredApprovedMockupSuite(aspectPrimary) : null;
}

export function chooseMockupRoute(input: { aspectPrimary: string | null }) {
  return autoApprovedSuite(input.aspectPrimary) ? "approved" as const : "legacy" as const;
}

/** Only routes enabled by this rollout may recover through the old renderer. */
export function isNewlyOpenedApprovedCase(input: { mode: string; aspectPrimary: string | null }) {
  return (input.mode === "long" && input.aspectPrimary === "16:9")
    || input.aspectPrimary === "a4_portrait";
}

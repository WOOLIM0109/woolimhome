import type { ThumbnailTitleSpec } from "../../portfolio/thumbnail-title-overlay.ts";
import type { MockupImageRecord } from "./mockup-types.ts";

export const LOCAL_MOCKUP_TITLE_VERSION = "local-mockup-title-1" as const;
/** Local-only derived PNG. A binding is not permission to publish an image. */
export type MockupTitleImage = MockupImageRecord & {
  baseFingerprint: string;
  overlayFingerprint: string;
};
export type LocalMockupTitleState = {
  version: typeof LOCAL_MOCKUP_TITLE_VERSION;
  workId: string; buildId: string; sourceHash: string;
  revision: number; baseFingerprint: string; title: ThumbnailTitleSpec;
  draft: MockupTitleImage | null; final: MockupTitleImage | null;
  active: MockupTitleImage | null; activeTitle: ThumbnailTitleSpec | null;
};
export type LocalMockupTitleReview = {
  available: boolean; revision: number | null; baseFingerprint: string | null;
  legacyTitle: string; title: ThumbnailTitleSpec; stale: boolean; holds: string[];
  draft: MockupTitleImage | null; final: MockupTitleImage | null;
  active: MockupTitleImage | null; activeTitle: ThumbnailTitleSpec | null;
  legacyFinalAvailable: boolean; localOnly: true;
};

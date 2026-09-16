import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectPptx, PREPARATION_RULE_VERSION, sha256, type PptxInspection } from "./pptx-inspection.ts";
import { exportLocalPowerPointSlides, getLocalPowerPointRuntime, getLocalPowerPointConverterFingerprint,
  type LocalPowerPointRuntime, type LocalPowerPointExportInput, type LocalPowerPointExportOptions,
  type LocalPowerPointExportResult } from "./powerpoint-adapter.ts";
import { openPreparationWorkStore, type JsonValue, type PreparationBuildRecord } from "./work-store.ts";
import { previewCandidate, selectPreparedSlides, validatePreparedPng, type PreviewCheck, type PreparationSelection, type SlideArtworkReview } from "./slide-preparation.ts";
import { assertPrivateWorkRoot } from "./private-work-root.ts";
import { validateSourceFormatChoice, sourceFormatSelectionInspection, sourceFormatFingerprint, type SourceFormatChoice } from "./source-format-choice.ts";
import type { PreparationReviewBuild } from "./preparation-review-types.ts";

export type PreparationDependencies = {
  runtime?: () => Promise<LocalPowerPointRuntime>;
  converterFingerprint?: () => Promise<string>;
  exportSlides?: (input: LocalPowerPointExportInput, options: LocalPowerPointExportOptions) => Promise<LocalPowerPointExportResult>;
};
export type LocalPreparationResult = { workRoot: string; workId: string; buildId: string; resumed: boolean;
  status: "held" | "ready_for_local_review"; inspection: PptxInspection; selection: PreparationSelection;
  counts: {total: number; previews: number; explicitlyExcluded: number; highResolution: number};
};
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
async function atomicArtifact(destination: string, bytes: Buffer | string) {
  const temporary=destination+`.pending-${randomUUID()}`;
  await writeFile(temporary,bytes,{flag:"wx",mode:0o600});
  await rename(temporary,destination);
}
/** An opt-in local-only preparation path. It neither imports the live worker nor publishes/activates a set. */
export async function prepareLocalPptx(input: {
  sourcePath: string; workRoot: string; selectedSlideNumbers?: readonly number[]; targetCount?: number;
  sourceFormatChoice?: SourceFormatChoice;
  artworkReviews?: readonly SlideArtworkReview[];
  /** An optional compare-and-swap for an explicit local preparation decision.
   * This is not rollback: callers needing failure isolation use a new work root. */
  expectedCurrentBuild?: PreparationReviewBuild;
  onProgress?: (event: { stage: string; sourceSlideNumber?: number; reused?: boolean }) => void;
}, dependencies: PreparationDependencies={}): Promise<LocalPreparationResult> {
  if(path.extname(input.sourcePath).toLowerCase()!==".pptx") throw new Error("PPTX_REQUIRED: 이 준비 경로는 .pptx만 지원합니다. 원본을 덮어쓰지 말고 별도 .pptx 사본을 준비하세요.");
  const {sourcePath,workRoot}=await assertPrivateWorkRoot(input.sourcePath,input.workRoot);
  if(process.platform === "win32" && workRoot.length>100) throw new Error("WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\\WoolimWorker\\preparation\\작업이름");
  const sourceStat=await stat(sourcePath);
  if(!sourceStat.isFile() || sourceStat.size>256*1024*1024) throw new Error("INVALID_SOURCE_FILE");
  const bytes=await readFile(sourcePath), sourceHash=sha256(bytes);
  const runtime=await (dependencies.runtime || getLocalPowerPointRuntime)();
  const installedFonts=runtime.fontInventory.families.flatMap((f)=>[f.english,f.korean]).filter((v):v is string=>!!v);
  const inspection=await inspectPptx(bytes,{installedFonts});
  const sourceFormatChoice=validateSourceFormatChoice(inspection,input.sourceFormatChoice);
  const selectionInspection=sourceFormatSelectionInspection(inspection,sourceFormatChoice);
  const store=await openPreparationWorkStore({root:workRoot});
  try {
    const previous=await store.readWork();
    if (input.expectedCurrentBuild !== undefined) {
      const expected = input.expectedCurrentBuild;
      if (!expected || typeof expected !== "object" || Array.isArray(expected)
        || Object.keys(expected).sort().join(",") !== "buildId,revision,sourceHash"
        || typeof expected.buildId !== "string" || !Number.isSafeInteger(expected.revision) || expected.revision < 0
        || typeof expected.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(expected.sourceHash)
        || !previous || previous.currentBuildId !== expected.buildId || sourceHash !== expected.sourceHash) {
        throw new Error("PREPARATION_REVIEW_STALE");
      }
      const current = await store.readBuild(previous.currentBuildId);
      if (current.revision !== expected.revision || current.fingerprint.source.sha256 !== expected.sourceHash
        || sha256(await readFile(sourcePath)) !== expected.sourceHash) throw new Error("PREPARATION_REVIEW_STALE");
    }
    const converterFingerprint=await (dependencies.converterFingerprint || getLocalPowerPointConverterFingerprint)();
    const rulesHash=sha256(Buffer.concat(await Promise.all(["./pptx-inspection.ts","./slide-preparation.ts","./source-format-choice.ts"].map((file)=>readFile(new URL(file,import.meta.url))))));
    const settings=sha256(JSON.stringify({version:PREPARATION_RULE_VERSION,converterFingerprint,rulesHash,preview:800,highResolution:2400,powerPointVersion:runtime.powerPointVersion,sourceFormatFingerprint:sourceFormatFingerprint(sourceFormatChoice)}));
    const opened=await store.beginOrResumeBuild({expectedWorkRevision:previous?.revision ?? null,
      fingerprint:{source:{sha256:sourceHash,bytes:bytes.length},conversionSettingsFingerprint:settings,fontFingerprint:runtime.fontInventory.fingerprint}});
    let build:PreparationBuildRecord=opened.build;
    const buildId=build.buildId;
    const assertSource=async()=>{ if(sha256(await readFile(sourcePath))!==sourceHash)throw new Error("SOURCE_CHANGED_DURING_PREPARATION"); };
    const save=async(key:string,relativePath:string,data:Buffer|string,metadata?:unknown)=>{
      const destination=await store.prepareArtifactPath(buildId,relativePath);
      await atomicArtifact(destination,data);
      build=await store.recordArtifact({buildId,key,expectedRevision:build.revision,relativePath,data:json(metadata ?? null)});
    };
    if(!await store.getReusableStage(buildId,"source_inspection")) {
      await save("inspection","inspection.json",JSON.stringify(inspection),{version:PREPARATION_RULE_VERSION});
      if(sourceFormatChoice)await save("source-format-choice","source-format-choice.json",JSON.stringify(sourceFormatChoice));
      build=await store.completeStage({buildId,stage:"source_inspection",expectedRevision:build.revision,
        inputFingerprint:sha256(sourceHash+settings+runtime.fontInventory.fingerprint),artifactKeys:["inspection",...(sourceFormatChoice?["source-format-choice"]:[])],data:json(inspection)});
    }
    input.onProgress?.({stage:"source_inspection",reused:opened.resumed});
    const previewNumbers=inspection.slides.filter(previewCandidate).map((s)=>s.sourceSlideNumber);
    const checks=new Map<number,PreviewCheck>();
    async function render(numbers: readonly number[], kind:"preview"|"highres", longEdge:800|2400) {
      const pending:number[]=[];
      for(const n of numbers) {
        const cached=await store.getReusableArtifact(buildId,`${kind}:${n}`);
        if(cached) {
          const checked=await validatePreparedPng(await readFile(cached.absolutePath),{sourceSlideNumber:n,slideWidth:inspection.width,slideHeight:inspection.height,longEdge});
          if(kind==="preview")checks.set(n,checked);
          input.onProgress?.({stage:kind,sourceSlideNumber:n,reused:true});
        } else pending.push(n);
      }
      if(!pending.length)return;
      if(!runtime.available)throw new Error("POWERPOINT_NOT_AVAILABLE");
      await assertSource();
      // prepareArtifactPath validates every directory component, including Windows junctions.
      const marker=await store.prepareArtifactPath(buildId,"attempts/marker");
      const attemptRoot=path.dirname(marker);
      const requested=new Set(pending), received=new Set<number>();
      const output=await (dependencies.exportSlides || exportLocalPowerPointSlides)({sourcePath,sourceHash,
        outputDirectory:attemptRoot,slideNumbers:pending,longEdge,expectedSlideWidth:inspection.width,expectedSlideHeight:inspection.height},{onSlide:async(slide)=>{
          const n=slide.sourceSlideNumber;
          if(!requested.has(n)||received.has(n))throw new Error("UNEXPECTED_EXPORTED_SLIDE");
          const relative=path.relative(attemptRoot,path.resolve(slide.path));
          if(!relative||relative.startsWith("..")||path.isAbsolute(relative))throw new Error("UNSAFE_EXPORT_PATH");
          // Do not follow a renderer-created symbolic link into another work item.
          let cursor=attemptRoot;
          for(const segment of relative.split(path.sep)) { cursor=path.join(cursor,segment);if((await lstat(cursor)).isSymbolicLink())throw new Error("UNSAFE_EXPORT_LINK"); }
          const png=await readFile(slide.path);
          const checked=await validatePreparedPng(png,{sourceSlideNumber:n,slideWidth:inspection.width,slideHeight:inspection.height,longEdge});
          if(checked.width!==slide.width || checked.height!==slide.height)throw new Error("EXPORT_METADATA_MISMATCH");
          await assertSource();
          if(kind==="highres" && checked.blank)throw new Error(`HIGH_RESOLUTION_BLANK: slide ${n}`);
          await save(`${kind}:${n}`,`${kind}/slide-${String(n).padStart(4,"0")}.png`,png,checked);
          if(kind==="preview")checks.set(n,checked);
          received.add(n);
          input.onProgress?.({stage:kind,sourceSlideNumber:n,reused:false});
        }});
      if(received.size!==requested.size)throw new Error("INCOMPLETE_EXPORT_BATCH");
      if(Math.abs(output.slideWidth/inspection.width-1)>.001 || Math.abs(output.slideHeight/inspection.height-1)>.001)throw new Error("POWERPOINT_PAGE_SETUP_MISMATCH");
      await assertSource();
    }
    if(selectionInspection.issues.some((i)=>i.code==="NO_APPROVED_SUITE")) {
      build=await store.completeStage({buildId,stage:"preview_generation",expectedRevision:build.revision,
        inputFingerprint:sha256(sourceHash+settings+"unsupported"),artifactKeys:[],
        data:json({total:inspection.totalSlides,success:0,explicitlyExcluded:inspection.totalSlides,reason:"NO_APPROVED_SUITE"})});
      const selection=selectPreparedSlides(selectionInspection,[]);
      build=await store.recordSelection({buildId,expectedRevision:build.revision,expectedSelectionRevision:build.selectionRevision,selectionFingerprint:sha256(JSON.stringify(selection)),data:json(selection)});
      return {workRoot,workId:opened.work.workId,buildId,resumed:opened.resumed,status:"held",inspection,selection,
        counts:{total:inspection.totalSlides,previews:0,explicitlyExcluded:inspection.totalSlides,highResolution:0}};
    }
    await render(previewNumbers,"preview",800);
    const previewKeys=previewNumbers.map((n)=>`preview:${n}`);
    if(!await store.getReusableStage(buildId,"preview_generation")) {
      build=await store.completeStage({buildId,stage:"preview_generation",expectedRevision:build.revision,inputFingerprint:sha256(sourceHash+settings+"preview"),artifactKeys:previewKeys,
        data:json({total:inspection.totalSlides,success:checks.size,explicitlyExcluded:inspection.totalSlides-previewNumbers.length})});
    }
    const selection=selectPreparedSlides(selectionInspection,[...checks.values()],{selectedSlideNumbers:input.selectedSlideNumbers,targetCount:input.targetCount,artworkReviews:input.artworkReviews});
    if(input.artworkReviews)await save("artwork-reviews","artwork-reviews.json",JSON.stringify(selection.artworkReviews ?? []));
    build=await store.recordSelection({buildId,expectedRevision:build.revision,expectedSelectionRevision:build.selectionRevision,
      selectionFingerprint:sha256(JSON.stringify({selection,...(input.artworkReviews?{artworkReviews:input.artworkReviews}:{})})),data:json(selection)});
    input.onProgress?.({stage:"slide_selection"});
    const highNumbers=[...selection.selected,...selection.reserves];
    if(selection.status!=="held") {
      await render(highNumbers,"highres",2400);
      build=await store.completeStage({buildId,stage:"high_resolution_conversion",expectedRevision:build.revision,
        inputFingerprint:sha256(sourceHash+settings+build.selectionFingerprint),artifactKeys:highNumbers.map((n)=>`highres:${n}`),
        data:json({selected:selection.selected,reserves:selection.reserves,manualReviewRequired:true,redacted:false,uploaded:false})});
    }
    await assertSource();
    return {workRoot,workId:opened.work.workId,buildId,resumed:opened.resumed,status:selection.status,inspection,selection,
      counts:{total:inspection.totalSlides,previews:checks.size,explicitlyExcluded:inspection.totalSlides-previewNumbers.length,
        highResolution:selection.status==="held"?0:highNumbers.length}};
  } finally { await store.release(); }
}

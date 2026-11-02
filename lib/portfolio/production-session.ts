import {createHash} from 'node:crypto';
import {isCurrentPortfolioRedactionProof} from './redaction-proof.ts';

export const MOCKUP_BRIDGE_VERSION = 'mockup-bridge-1';
export const MOCKUP_BRIDGE_WORKER_VERSION = '2.10.0';
export const MOCKUP_SESSION_STATES = ['queued','preparing','review','uploading','staged','activated','failed','cancelled'] as const;
export type MockupSessionStatus = typeof MOCKUP_SESSION_STATES[number];
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function canonicalHash(value: unknown): string {
 const canonical = (input: unknown): string => Array.isArray(input) ? `[${input.map(canonical).join(',')}]` : input && typeof input === 'object' ? `{${Object.keys(input).sort().map(key=>`${JSON.stringify(key)}:${canonical((input as Record<string,unknown>)[key])}`).join(',')}}` : JSON.stringify(input);
 return createHash('sha256').update(canonical(value)).digest('hex');
}
export function plainObject(value: unknown): Record<string, unknown> {
 return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
export function requireKeys(value: unknown, allowed: readonly string[]) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) throw new Error('MOCKUP_REQUEST_INVALID');
 return value as Record<string, unknown>;
}
/** Image inputs stay bound while writing and queue state may change. */
export function mockupImageInputsHash(metadata: unknown) {
 const value=plainObject(metadata),inputs:Record<string,unknown>={};
 for(const key of ['portfolioSource','portfolioSourceUpload','portfolioSourceFingerprint','portfolioRuleVersion','portfolioGenerationId','portfolioConversionGenerationId','portfolioReview','portfolioMockup','manualMockupOverride','redactionMode','confidentialRegions','redactionProof']) inputs[key]=value[key]??null;
 inputs.assets=Array.isArray(value.portfolioAssets)?value.portfolioAssets.map(asset=>{const {caption,...image}=plainObject(asset);void caption;return image;}):null;
 return canonicalHash(inputs);
}
export function expectedMockupActiveSetId(binding: unknown): string|null {
 const value=plainObject(binding).expectedActiveSetId;
 if(value===undefined||value===null)return null;
 if(!isUuid(value))throw new Error('IMAGE_SET_ACTIVE_POINTER_INVALID');
 return value;
}
export function assertMockupImageInputs(metadata: unknown, binding: unknown) {
 const current=plainObject(metadata),expected=plainObject(binding);
 if(current.redactionProof!==undefined||current.portfolioSourceFingerprint!==undefined){
  const assets=Array.isArray(current.portfolioAssets)?current.portfolioAssets:[];
  const selected=[...new Set(assets.flatMap(asset=>{const indexes=plainObject(asset).slideIndexes;return Array.isArray(indexes)?indexes.filter((index):index is number=>typeof index==='number'&&Number.isInteger(index)&&index>=0):[];}))].sort((left,right)=>left-right);
  if(typeof current.portfolioSourceFingerprint!=='string'
   ||!isCurrentPortfolioRedactionProof(current.redactionProof,current.portfolioSourceFingerprint,selected))throw new Error('MOCKUP_REDACTION_PROOF_REQUIRED');
 }
 if(expected.imageInputsHash!==undefined){
  if(!isSha(expected.imageInputsHash))throw new Error('MOCKUP_IMAGE_INPUTS_UNVERIFIABLE');
  if(mockupImageInputsHash(current)!==expected.imageInputsHash)throw new Error('MOCKUP_IMAGE_INPUTS_CHANGED');
  return;
 }
 if(canonicalHash(current)===expected.expectedMetadataHash)return;
 // Older sessions retained only one manuscript hash. Without the old image
 // inputs a later change cannot be certified as a writing-only edit.
 throw new Error('MOCKUP_IMAGE_INPUTS_UNVERIFIABLE');
}
/** A server-created binding. No source URL or local path is accepted from a browser. */
export function createMockupSessionBinding(item: {id:string;format:string;updated_at:string;metadata:unknown}, candidateId:string, source:unknown) {
 if (!isUuid(item.id) || !isUuid(candidateId) || item.format !== 'portfolio') throw new Error('MOCKUP_WORK_ITEM_INVALID');
 const metadata = plainObject(item.metadata), original=plainObject(source);
 if (typeof original.originalFileName !== 'string' || !/\.pptx$/i.test(original.originalFileName)) throw new Error('MOCKUP_PPTX_SOURCE_REQUIRED');
 if (!Number.isFinite(Date.parse(item.updated_at))) throw new Error('MOCKUP_REVISION_REQUIRED');
 const activeSetId=plainObject(metadata.portfolioImageSet).activeSetId??null;
 if(activeSetId!==null&&!isUuid(activeSetId))throw new Error('IMAGE_SET_ACTIVE_POINTER_INVALID');
 return {workItemId:item.id,candidateId,expectedUpdatedAt:item.updated_at,expectedMetadataHash:canonicalHash(metadata),sourceBindingHash:canonicalHash(original),expectedActiveSetId:activeSetId,imageInputsHash:mockupImageInputsHash(metadata)};
}
/** This hashes every non-image field, so activation QA can compare it without logging manuscript contents. */
export function protectedManuscriptHash(item: Record<string,unknown>) {
 const value=structuredClone(item), metadata=plainObject(value.metadata);
 delete value.updated_at;
 for(const key of ['portfolioAssets','portfolioImageSet','portfolioThumbnailVersion','portfolioMockup','manualMockupOverride']) delete metadata[key];
 const generated=plainObject(metadata.generated);
 if(typeof generated.bodyHtml==='string') generated.bodyHtml=generated.bodyHtml.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])(.*?)\2/gi,'$1$2[image-source]$2');
 if(metadata.generated) metadata.generated=generated;
 const style=plainObject(metadata.styleRevision);delete style.fingerprint;if(metadata.styleRevision)metadata.styleRevision=style;
 value.metadata=metadata;
 return canonicalHash(value);
}
export function safeLocalReviewUrl(value: unknown): string {
 if(typeof value!=='string') throw new Error('MOCKUP_LOCAL_URL_INVALID');
 let url:URL;try{url=new URL(value);}catch{throw new Error('MOCKUP_LOCAL_URL_INVALID');}
 if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || Number(url.port)<1024 || url.username || url.password || url.search || url.hash || !/^\/launch\/[a-f0-9]{64}$/.test(url.pathname)) throw new Error('MOCKUP_LOCAL_URL_INVALID');
 return url.href;
}
export function transitionMockupSession(from:MockupSessionStatus,to:MockupSessionStatus) {
 const allowed: Record<MockupSessionStatus, readonly MockupSessionStatus[]>={queued:['preparing','cancelled'],preparing:['review','failed','cancelled'],review:['review','uploading','failed','cancelled'],uploading:['uploading','staged','failed','cancelled'],staged:['activated','cancelled'],activated:[],failed:[],cancelled:[]};
 if(!allowed[from]?.includes(to))throw new Error('MOCKUP_SESSION_STATE_CONFLICT');
 return to;
}

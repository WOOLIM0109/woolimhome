import {productionSnapshotHash,productionSnapshotCanonicalJson} from '../pc-worker/preparation/production-snapshot-hash.ts';
import {approvedMockupSuiteTemplates,getRegisteredApprovedMockupSuite} from './approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from './approved-16x9-templates.ts';
import {productionTemplateFingerprint as approvedTemplateFingerprint} from './production-template-fingerprint.ts';
import {normalizeThumbnailTitleSpec} from './production-title-schema.ts';
import {isSha,isUuid,requireKeys} from './production-session.ts';
import type {ProductionMockupDescriptor} from '../pc-worker/preparation/production-snapshot-types.ts';
import {portfolioImageSetAssetUrl,portfolioImageSetManifestHash,validatePortfolioImageSet,type VerifiedPortfolioImageSet} from './image-set.ts';

/** Authenticated, version-pinned office worker attestation; never exposed as browser JSON import. */
export function validateProductionDescriptor(value:unknown,expectedHash:unknown):ProductionMockupDescriptor {
 const d=requireKeys(value,['version','mode','localWorkId','buildId','sourceHash','aspectClass','suiteId','templateVersion','sourceFormatFingerprint','assignmentHash','localRevision','titleRevision','remoteApproval','localConfirmation','boards','thumbnail']);
 if(!isSha(expectedHash)||productionSnapshotHash(value)!==expectedHash
   || d.version!=='verified-production-mockup-snapshot-v1'||d.mode!=='full'||!isUuid(d.localWorkId)||!isUuid(d.buildId)||!isSha(d.sourceHash)||!isSha(d.assignmentHash)
   ||!Number.isSafeInteger(d.localRevision)||Number(d.localRevision)<0||!(d.titleRevision===null||Number.isSafeInteger(d.titleRevision))
   ||!(d.sourceFormatFingerprint===null||isSha(d.sourceFormatFingerprint))||d.remoteApproval!=='required'||d.localConfirmation!=='technical_candidate_only')throw new Error('MOCKUP_DESCRIPTOR_INVALID');
 const suite=getRegisteredApprovedMockupSuite(String(d.aspectClass));
 if(!suite||suite.suiteId!==d.suiteId||suite.version!==d.templateVersion)throw new Error('MOCKUP_TEMPLATE_UNAPPROVED');
 const templates=approvedMockupSuiteTemplates(suite);
 if(!Array.isArray(d.boards)||d.boards.length!==5)throw new Error('MOCKUP_SET_INCOMPLETE');
 for(const [i,value] of d.boards.entries()){
  const board=requireKeys(value,['templateId','templateVersion','kind','imageHash','width','height','slideAspectRatio','sourceSlideNumbers','geometryHash','rendererFingerprint','assignmentFingerprint','redactions']),template=templates[i],slots=resolveApprovedMockupSlots(template);
  if(board.templateId!==template.id||board.templateVersion!==template.version||board.kind!==(i===0?'thumbnail':'body_image')||board.width!==template.canvas.width||board.height!==template.canvas.height||board.slideAspectRatio!==template.slideAspectRatio
    ||board.geometryHash!==approvedTemplateFingerprint(template)||![board.imageHash,board.rendererFingerprint,board.assignmentFingerprint].every(isSha)
    ||!Array.isArray(board.sourceSlideNumbers)||board.sourceSlideNumbers.length!==slots.length||new Set(board.sourceSlideNumbers).size!==slots.length||board.sourceSlideNumbers.some(n=>!Number.isSafeInteger(n)||n<1||n>1000)
    ||!Array.isArray(board.redactions)||board.redactions.length!==slots.length)throw new Error('MOCKUP_BOARD_INVALID');
  for(const [j,value] of board.redactions.entries()){
   const receipt=requireKeys(value,['slotId','sourceSlideNumber','imageHash','redactionFingerprint','ruleVersion','approvedAt','sourceFit']);
   if(receipt.slotId!==slots[j].id||receipt.sourceSlideNumber!==board.sourceSlideNumbers[j]||!isSha(receipt.imageHash)||!isSha(receipt.redactionFingerprint)||typeof receipt.ruleVersion!=='string'||!receipt.ruleVersion||typeof receipt.approvedAt!=='string'||!Number.isFinite(Date.parse(receipt.approvedAt)))throw new Error('MOCKUP_REDACTION_PROOF_REQUIRED');
  }
 }
 const thumb=requireKeys(d.thumbnail,['templateId','baseImageHash','baseFingerprint','overlayFingerprint','titleSpec','titleImageHash','localConfirmed']);
 if(thumb.templateId!==templates[0].id||![thumb.baseImageHash,thumb.baseFingerprint,thumb.titleImageHash].every(isSha)||thumb.titleImageHash!==d.boards[0].imageHash||typeof thumb.localConfirmed!=='boolean')throw new Error('MOCKUP_THUMBNAIL_INVALID');
 if(thumb.titleSpec!==null){if(!thumb.localConfirmed||!isSha(thumb.overlayFingerprint)||productionSnapshotCanonicalJson(normalizeThumbnailTitleSpec(thumb.titleSpec))!==productionSnapshotCanonicalJson(thumb.titleSpec))throw new Error('MOCKUP_TITLE_UNCONFIRMED');}
 else if(thumb.overlayFingerprint!==null||thumb.localConfirmed)throw new Error('MOCKUP_THUMBNAIL_INVALID');
 return structuredClone(value) as ProductionMockupDescriptor;
}
export function productionSetManifest(descriptor:ProductionMockupDescriptor,workItemId:string,setId:string,actor:string,at:string):VerifiedPortfolioImageSet{
 const value={version:1 as const,setId,workItemId,localWorkId:descriptor.localWorkId,buildId:descriptor.buildId,sourceHash:descriptor.sourceHash,assignmentHash:descriptor.assignmentHash,suiteId:descriptor.suiteId,templateVersion:descriptor.templateVersion,aspectClass:descriptor.aspectClass,
  assets:descriptor.boards.map((board,i)=>{const path=`verified-local/${workItemId}/${setId}/${i}.png`;return{kind:board.kind,name:i===0?'thumbnail.png':`body-${i}.png`,bucket:'portfolio-rendered' as const,path,url:portfolioImageSetAssetUrl(path),sha256:board.imageHash,width:board.width,height:board.height,caption:'승인된 목업 이미지',slideIndexes:board.sourceSlideNumbers.map(n=>n-1),slideAspectRatio:board.slideAspectRatio,mockupMode:'short_psd' as const,aspectClass:descriptor.aspectClass,mockupTemplateId:board.templateId,mockupTemplateVersion:board.templateVersion};})};
 return validatePortfolioImageSet({...value,approval:{approvedBy:actor,approvedAt:at,outputInspected:true,manifestHash:portfolioImageSetManifestHash(value),visualReview:'not_performed'}});
}

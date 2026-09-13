import {createHash,randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {authenticatedAdmin,contentAdmin} from '@/lib/content-ops/data';
import {canonicalHash,isUuid,requireKeys} from '@/lib/portfolio/production-session';
import {sameOriginMutation,publicMockupError} from '@/lib/portfolio/production-session-server';
import {normalizeThumbnailTitleSpec,type ThumbnailTitleAspectClass} from '@/lib/portfolio/production-title-schema';
import {renderProductionThumbnail} from '@/lib/portfolio/production-title-renderer';
import {validateProductionDescriptor} from '@/lib/portfolio/production-descriptor';
import {verifiedProductionPng} from '@/lib/portfolio/production-storage';
import {activePortfolioImageSetId,portfolioImageSetAssetUrl} from '@/lib/portfolio/image-set';
import {createVerifiedPortfolioThumbnailVersion,preparePortfolioThumbnailCommit,portfolioThumbnailPointer} from '@/lib/portfolio/thumbnail-version';
export const runtime='nodejs';export const maxDuration=300;
const headers={'Cache-Control':'private, no-store',Vary:'Cookie'};
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await authenticatedAdmin();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401});
 const {id}=await context.params,db=contentAdmin();
 try{
  sameOriginMutation(request);if(!isUuid(id))throw new Error('MOCKUP_WORK_ITEM_INVALID');
  const body=await request.json();
  const {data:item,error}=await db.from('content_work_items').select('*').eq('id',id).eq('format','portfolio').maybeSingle();
  if(error||!item)throw new Error('MOCKUP_WORK_ITEM_NOT_FOUND');
  const activeSetId=activePortfolioImageSetId(item.metadata),pointer=portfolioThumbnailPointer(item.metadata);
  if(!activeSetId)throw new Error('THUMBNAIL_VERIFIED_BASE_REQUIRED');
  const {data:session,error:sessionError}=await db.from('portfolio_mockup_sessions').select('descriptor,descriptor_hash').eq('id',activeSetId).eq('work_item_id',id).eq('status','activated').maybeSingle();
  if(sessionError||!session)throw new Error('THUMBNAIL_VERIFIED_BASE_REQUIRED');
  const descriptor=validateProductionDescriptor(session.descriptor,session.descriptor_hash);
  if(body.action==='preview'){
   requireKeys(body,['action','title']);const title=normalizeThumbnailTitleSpec(body.title);
   const {count,error:limitError}=await db.from('portfolio_thumbnail_candidates').select('id',{count:'exact',head:true}).eq('work_item_id',id).eq('requested_by',actor.id).gte('created_at',new Date(Date.now()-600000).toISOString());
   if(limitError)throw new Error('THUMBNAIL_SCHEMA_NOT_READY');if((count||0)>=10)throw new Error('THUMBNAIL_PREVIEW_LIMIT');
   const basePng=await verifiedProductionPng({path:`verified-local/${id}/${activeSetId}/titleless.png`,hash:descriptor.thumbnail.baseImageHash,width:1080,height:1080});
   const rendered=await renderProductionThumbnail({basePng,title,aspectClass:descriptor.aspectClass as ThumbnailTitleAspectClass});
   const candidateId=randomUUID(),sha256=createHash('sha256').update(rendered.bytes).digest('hex'),path=`verified-thumbnail/${id}/${candidateId}.png`;
   const render={localWorkId:descriptor.localWorkId,buildId:descriptor.buildId,sourceHash:descriptor.sourceHash,baseFingerprint:descriptor.thumbnail.baseFingerprint,overlayFingerprint:rendered.overlayFingerprint,inputFingerprint:canonicalHash({base:descriptor.thumbnail.baseImageHash,title,overlay:rendered.overlayFingerprint}),titleSpec:title};
   const binding={expectedUpdatedAt:item.updated_at,expectedMetadataHash:canonicalHash(item.metadata),expectedActiveSetId:activeSetId,expectedActiveVersionId:pointer?.activeVersionId??null};
   const proof={render,sha256,path},approvalHash=canonicalHash({id:candidateId,workItemId:id,binding,proof});
   const {error:uploadError}=await db.storage.from('portfolio-rendered').upload(path,rendered.bytes,{contentType:'image/png',upsert:false});
   if(uploadError)throw new Error('THUMBNAIL_UPLOAD_FAILED');
   await verifiedProductionPng({path,hash:sha256,width:1080,height:1080});
   const {error:saveError}=await db.from('portfolio_thumbnail_candidates').insert({id:candidateId,work_item_id:id,requested_by:actor.id,binding,proof,approval_hash:approvalHash,status:'staged'});
   if(saveError)throw new Error('THUMBNAIL_CANDIDATE_SAVE_FAILED');
   return NextResponse.json({candidateId,expectedUpdatedAt:item.updated_at,manifestHash:approvalHash,url:portfolioImageSetAssetUrl(path)},{headers});
  }
  requireKeys(body,['action','candidateId','manifestHash','outputInspected']);
  if(body.action!=='activate'||!isUuid(body.candidateId)||body.outputInspected!==true)throw new Error('THUMBNAIL_EXPLICIT_REVIEW_REQUIRED');
  const {data:candidate,error:candidateError}=await db.from('portfolio_thumbnail_candidates').select('*').eq('id',body.candidateId).eq('work_item_id',id).eq('requested_by',actor.id).maybeSingle();
  if(candidateError||!candidate||candidate.approval_hash!==body.manifestHash)throw new Error('THUMBNAIL_REVIEW_STALE');
  if(candidate.status==='activated'){
   if(pointer?.activeVersionId!==candidate.id)throw new Error('THUMBNAIL_CANDIDATE_NO_LONGER_ACTIVE');
   return NextResponse.json({workItemId:id,activeVersionId:candidate.id,updatedAt:item.updated_at},{headers});
  }
  if(canonicalHash(item.metadata)!==candidate.binding.expectedMetadataHash)throw new Error('THUMBNAIL_REVISION_CONFLICT');
  const proof=candidate.proof,png=await verifiedProductionPng({path:proof.path,hash:proof.sha256,width:1080,height:1080}),at=new Date().toISOString();
  const version=await createVerifiedPortfolioThumbnailVersion(item,{versionId:candidate.id,render:proof.render,png,expectedImageHash:proof.sha256,actor:actor.id,approvedAt:at,outputInspected:true});
  const commit=preparePortfolioThumbnailCommit(item,{...candidate.binding,actor:actor.id,activatedAt:at,version,expectedProof:{render:proof.render,sha256:proof.sha256}});
  const {data:receipt,error:commitError}=await db.rpc('activate_portfolio_thumbnail_candidate',{p_candidate_id:candidate.id,p_approval_hash:body.manifestHash,p_work_item_id:id,p_expected_updated_at:commit.expectedUpdatedAt,p_expected_active_version_id:commit.expectedActiveVersionId,p_expected_active_set_id:commit.expectedActiveSetId,p_expected_metadata:commit.expectedMetadata,p_next_metadata:commit.nextMetadata,p_manifest:version,p_next_thumbnail:commit.nextThumbnail,p_baseline_id:commit.baselineId,p_base_fingerprint:commit.baseFingerprint,p_actor:actor.id,p_activated_at:at});
  if(commitError)throw new Error(commitError.message.match(/(?:MOCKUP|THUMBNAIL)_[A-Z_]+/)?.[0]||'THUMBNAIL_ACTIVATION_FAILED');
  if(receipt?.workItemId!==id||receipt?.activeVersionId!==candidate.id||typeof receipt.updatedAt!=='string')throw new Error('THUMBNAIL_ACTIVATION_RECEIPT_INVALID');
  return NextResponse.json(receipt,{headers});
 }catch(error){return NextResponse.json({error:publicMockupError(error)},{status:409,headers});}
}

import {NextResponse} from 'next/server';
import {authenticatedAdmin,contentAdmin} from '@/lib/content-ops/data';
import {canonicalHash,isUuid,plainObject,requireKeys} from '@/lib/portfolio/production-session';
import {requestProductionMockup,readMockupSource,sameOriginMutation,publicMockupError} from '@/lib/portfolio/production-session-server';
import {productionSetManifest,validateProductionDescriptor} from '@/lib/portfolio/production-descriptor';
import {verifyProductionObjects} from '@/lib/portfolio/production-storage';
import {activePortfolioImageSetId,preparePortfolioImageSetCommit,portfolioImageSetAssetUrl} from '@/lib/portfolio/image-set';
export const runtime='nodejs';export const maxDuration=300;
const headers={'Cache-Control':'private, no-store',Vary:'Cookie'};
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 if(!await authenticatedAdmin())return NextResponse.json({error:'Unauthorized'},{status:401});
 const {id}=await context.params;if(!isUuid(id))return NextResponse.json({error:'MOCKUP_WORK_ITEM_INVALID'},{status:400});
 const db=contentAdmin(),{data:rows,error}=await db.from('portfolio_mockup_sessions').select('id,status,created_at,local_review_url,error_code,descriptor_hash,descriptor').eq('work_item_id',id).order('created_at',{ascending:false}).limit(8);
 if(error)return NextResponse.json({error:'MOCKUP_SCHEMA_NOT_READY'},{status:503,headers});
 const {data:item,error:itemError}=await db.from('content_work_items').select('metadata,updated_at').eq('id',id).eq('format','portfolio').maybeSingle();
 if(itemError||!item)return NextResponse.json({error:'MOCKUP_WORK_ITEM_NOT_FOUND'},{status:404,headers});
 const metadata=plainObject(item.metadata),activeId=activePortfolioImageSetId(metadata);
 const {data:base}=activeId?await db.from('portfolio_mockup_sessions').select('descriptor').eq('id',activeId).eq('work_item_id',id).eq('status','activated').maybeSingle():{data:null};
 let current=plainObject(plainObject(base?.descriptor).thumbnail).titleSpec??null;
 const versionId=plainObject(metadata.portfolioThumbnailVersion).activeVersionId;
 if(isUuid(versionId)){
  const {data:version}=await db.from('portfolio_thumbnail_versions').select('manifest').eq('id',versionId).eq('work_item_id',id).maybeSingle();
  current=plainObject(plainObject(version?.manifest).render).titleSpec??null;
 }
 return NextResponse.json({sessions:(rows||[]).map(row=>({id:row.id,status:row.status,createdAt:row.created_at,localReviewUrl:row.local_review_url,errorCode:row.error_code,snapshotHash:row.descriptor_hash,
  images:['staged','activated'].includes(row.status)?[0,1,2,3,4].map(i=>({kind:i===0?'thumbnail':'body_image',url:portfolioImageSetAssetUrl(`verified-local/${id}/${row.id}/${i}.png`)})):[]})),title:{available:Boolean(base),current,revision:{activeSetId:activeId,updatedAt:item.updated_at},reason:base?null:'새 편집 경로로 목업을 확정하면 제목만 바로 수정할 수 있습니다.'}},{headers});
}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await authenticatedAdmin();if(!actor)return NextResponse.json({error:'Unauthorized'},{status:401});
 const {id}=await context.params,db=contentAdmin();
 try{
  sameOriginMutation(request);if(!isUuid(id))throw new Error('MOCKUP_WORK_ITEM_INVALID');
  const body=await request.json(),action=body.action;
  if(action==='create'){requireKeys(body,['action']);return NextResponse.json(await requestProductionMockup(id,actor.id),{headers});}
  requireKeys(body,['action','sessionId','snapshotHash','outputInspected']);
  if(!isUuid(body.sessionId))throw new Error('MOCKUP_SESSION_INVALID');
  const {data:session,error}=await db.from('portfolio_mockup_sessions').select('*').eq('id',body.sessionId).eq('work_item_id',id).maybeSingle();
  if(error||!session)throw new Error('MOCKUP_SESSION_NOT_FOUND');
  if(action==='reopen'){
   requireKeys(body,['action','sessionId']);
   const at=new Date().toISOString();
   const {data,error}=await db.from('portfolio_mockup_sessions').update({reopen_requested_at:at,local_review_url:null,updated_at:at}).eq('id',session.id).eq('updated_at',session.updated_at).in('status',['review','uploading']).select('id').maybeSingle();
   if(error||!data)throw new Error('MOCKUP_SESSION_REVISION_CONFLICT');
   return NextResponse.json({reopenRequested:true,sessionId:session.id},{headers});
  }
  if(action==='cancel'){
   const {data,error}=await db.from('portfolio_mockup_sessions').update({status:'cancelled',local_review_url:null,updated_at:new Date().toISOString()}).eq('id',session.id).eq('updated_at',session.updated_at).in('status',['queued','preparing','review','uploading','staged']).select('id').maybeSingle();
   if(error||!data)throw new Error('MOCKUP_SESSION_REVISION_CONFLICT');return NextResponse.json({cancelled:true,sessionId:session.id},{headers});
  }
  if(action!=='activate'||body.outputInspected!==true||body.snapshotHash!==session.descriptor_hash||!['staged','activated'].includes(session.status))throw new Error('MOCKUP_EXPLICIT_REVIEW_REQUIRED');
  const descriptor=validateProductionDescriptor(session.descriptor,body.snapshotHash);
  await verifyProductionObjects(id,session.id,descriptor);
  const {data:item,error:itemError}=await db.from('content_work_items').select('*').eq('id',id).maybeSingle();if(itemError||!item)throw new Error('MOCKUP_WORK_ITEM_NOT_FOUND');
  if(session.status==='activated'){
   if(activePortfolioImageSetId(item.metadata)!==session.id)throw new Error('MOCKUP_SESSION_NO_LONGER_ACTIVE');
   return NextResponse.json({workItemId:id,activeSetId:session.id,updatedAt:item.updated_at},{headers});
  }
  if(canonicalHash(item.metadata)!==session.binding.expectedMetadataHash)throw new Error('MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED');
  const {binding:currentSource}=await readMockupSource(id);
  if(currentSource.candidateId!==session.candidate_id||currentSource.sourceBindingHash!==session.binding.sourceBindingHash)throw new Error('MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED');
  const at=new Date().toISOString(),set=productionSetManifest(descriptor,id,session.id,actor.id,at);
  const commit=preparePortfolioImageSetCommit(item,{set,expectedUpdatedAt:session.binding.expectedUpdatedAt,expectedActiveSetId:activePortfolioImageSetId(item.metadata),actor:actor.id,activatedAt:at});
  const {data:receipt,error:commitError}=await db.rpc('activate_portfolio_mockup_session',{p_session_id:session.id,p_descriptor_hash:body.snapshotHash,p_work_item_id:id,p_expected_updated_at:commit.expectedUpdatedAt,p_expected_active_set_id:commit.expectedActiveSetId,p_expected_metadata:commit.expectedMetadata,p_next_metadata:commit.nextMetadata,p_manifest:set,p_actor:actor.id,p_activated_at:at});
  if(commitError)throw new Error(commitError.message.match(/(?:MOCKUP|IMAGE_SET)_[A-Z_]+/)?.[0]||'MOCKUP_ACTIVATION_FAILED');
  if(receipt?.workItemId!==id||receipt?.activeSetId!==session.id||typeof receipt.updatedAt!=='string')throw new Error('MOCKUP_ACTIVATION_RECEIPT_INVALID');
  return NextResponse.json(receipt,{headers});
 }catch(error){return NextResponse.json({error:publicMockupError(error)},{status:409,headers});}
}

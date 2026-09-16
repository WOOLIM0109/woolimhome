import {NextResponse} from 'next/server';
import {contentAdmin} from '@/lib/content-ops/data';
import {authenticateWorker} from '@/lib/pc-worker/auth';
import {isUuid,isSha,requireKeys,safeLocalReviewUrl,MOCKUP_BRIDGE_VERSION,MOCKUP_BRIDGE_WORKER_VERSION} from '@/lib/portfolio/production-session';
import {publicMockupError} from '@/lib/portfolio/production-session-server';
import {validateProductionDescriptor} from '@/lib/portfolio/production-descriptor';
import {productionObjectSpecs,verifyProductionObjects} from '@/lib/portfolio/production-storage';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;
 if(!isUuid(id))return NextResponse.json({error:'MOCKUP_SESSION_INVALID'},{status:400});
 const body=await request.json().catch(()=>null),auth=authenticateWorker(request,body);if(auth.response)return auth.response;
 if(body?.bridgeVersion!==MOCKUP_BRIDGE_VERSION||body?.workerVersion!==MOCKUP_BRIDGE_WORKER_VERSION)return NextResponse.json({error:'MOCKUP_WORKER_UPGRADE_REQUIRED'},{status:409});
 const db=contentAdmin(),{data:session,error}=await db.from('portfolio_mockup_sessions').select('*').eq('id',id).eq('worker_id',auth.worker.id).maybeSingle();
 if(error||!session)return NextResponse.json({error:'MOCKUP_SESSION_NOT_OWNED'},{status:404});
 const identityKeys=['workerId','workerName','displayName','workerVersion','bridgeVersion'];
 try{
  const action=body.action;
  if(action==='status'){
   requireKeys(body,[...identityKeys,'action']);
   return NextResponse.json({sessionId:id,status:session.status,reopenRequested:Boolean(session.reopen_requested_at)},{headers:{'Cache-Control':'no-store'}});
  }
  if(action==='progress'){
   requireKeys(body,[...identityKeys,'action','status','localReviewUrl','sourceHash','errorCode']);
   if(!['preparing','review','uploading'].includes(session.status)||!['preparing','review','failed'].includes(body.status))throw new Error('MOCKUP_SESSION_STATE_CONFLICT');
   if(session.status==='uploading'&&(body.status!=='review'||body.sourceHash!==session.source_hash||!body.localReviewUrl))throw new Error('MOCKUP_SESSION_STATE_CONFLICT');
   if(body.status==='preparing'&&session.status!=='preparing')throw new Error('MOCKUP_SESSION_STATE_CONFLICT');
   if(body.status==='review'&&(!isSha(body.sourceHash)||!body.localReviewUrl))throw new Error('MOCKUP_REVIEW_BINDING_REQUIRED');
   if(body.sourceHash!==undefined&&(!isSha(body.sourceHash)||(session.source_hash&&body.sourceHash!==session.source_hash)))throw new Error('MOCKUP_SOURCE_HASH_CHANGED');
   const update={status:session.status==='uploading'?'uploading':body.status,...(body.sourceHash?{source_hash:body.sourceHash}:{}),...(body.localReviewUrl?{local_review_url:safeLocalReviewUrl(body.localReviewUrl),reopen_requested_at:null}:{}),...(body.status==='failed'?{error_code:/^[A-Z][A-Z0-9_]{1,120}$/.test(body.errorCode||'')?body.errorCode:'MOCKUP_PREPARATION_FAILED'}:{}),updated_at:new Date().toISOString()};
   const {data,error}=await db.from('portfolio_mockup_sessions').update(update).eq('id',id).eq('updated_at',session.updated_at).eq('worker_id',auth.worker.id).select('id').maybeSingle();
   if(error||!data)throw new Error('MOCKUP_SESSION_REVISION_CONFLICT');return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }
  if(action==='prepare-upload'){
   requireKeys(body,[...identityKeys,'action','descriptor','snapshotHash']);
   if(!['review','uploading'].includes(session.status))throw new Error('MOCKUP_SESSION_STATE_CONFLICT');
   const descriptor=validateProductionDescriptor(body.descriptor,body.snapshotHash);
   if(descriptor.sourceHash!==session.source_hash)throw new Error('MOCKUP_SOURCE_HASH_CHANGED');
   if(session.descriptor_hash&&session.descriptor_hash!==body.snapshotHash)throw new Error('MOCKUP_DESCRIPTOR_CHANGED');
   if(session.status==='review'){
    const {data,error}=await db.from('portfolio_mockup_sessions').update({status:'uploading',descriptor,descriptor_hash:body.snapshotHash,updated_at:new Date().toISOString()}).eq('id',id).eq('status','review').eq('updated_at',session.updated_at).select('id').maybeSingle();
    if(error||!data)throw new Error('MOCKUP_SESSION_REVISION_CONFLICT');
   }
   const uploads=[];
   for(const spec of productionObjectSpecs(session.work_item_id,id,descriptor)){
    const {data,error}=await db.storage.from('portfolio-rendered').createSignedUploadUrl(spec.path,{upsert:false});
    if(error||!data?.signedUrl)throw new Error('MOCKUP_SIGNED_UPLOAD_FAILED');uploads.push({key:spec.key,path:spec.path,sha256:spec.hash,signedUrl:data.signedUrl});
   }
   return NextResponse.json({sessionId:id,snapshotHash:body.snapshotHash,uploads},{headers:{'Cache-Control':'no-store'}});
  }
  if(action==='stage'){
   requireKeys(body,[...identityKeys,'action','snapshotHash']);
   if(!['uploading','staged'].includes(session.status)||body.snapshotHash!==session.descriptor_hash)throw new Error('MOCKUP_SESSION_STATE_CONFLICT');
   const descriptor=validateProductionDescriptor(session.descriptor,body.snapshotHash);
   await verifyProductionObjects(session.work_item_id,id,descriptor);
   if(session.status==='uploading'){
    const {data,error}=await db.from('portfolio_mockup_sessions').update({status:'staged',local_review_url:null,updated_at:new Date().toISOString()}).eq('id',id).eq('status','uploading').eq('updated_at',session.updated_at).select('id').maybeSingle();
    if(error||!data)throw new Error('MOCKUP_SESSION_REVISION_CONFLICT');
   }
   return NextResponse.json({sessionId:id,staged:true},{headers:{'Cache-Control':'no-store'}});
  }
  throw new Error('MOCKUP_ACTION_INVALID');
 }catch(error){return NextResponse.json({error:publicMockupError(error)},{status:409,headers:{'Cache-Control':'no-store'}});}
}

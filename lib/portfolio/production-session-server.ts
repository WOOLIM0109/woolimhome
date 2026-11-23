import 'server-only';
import {randomUUID} from 'node:crypto';
import {contentAdmin} from '@/lib/content-ops/data';
import {sharedDriveDownloadAuthorization} from '@/lib/naver-works/client';
import {canonicalHash,createMockupSessionBinding,assertMockupImageInputs,expectedMockupActiveSetId,isUuid,plainObject,MOCKUP_BRIDGE_VERSION} from './production-session';

export async function readMockupSource(workItemId:string) {
 if(!isUuid(workItemId))throw new Error('MOCKUP_WORK_ITEM_INVALID');
 const db=contentAdmin();
 const {data:item,error}=await db.from('content_work_items').select('*').eq('id',workItemId).maybeSingle();
 if(error||!item||item.format!=='portfolio')throw new Error('MOCKUP_WORK_ITEM_NOT_FOUND');
 const metadataCandidateId=plainObject(item.metadata).candidateId;
 let candidateId:string;
 if(isUuid(metadataCandidateId))candidateId=metadataCandidateId;
 else{
  const {data:jobs,error:jobError}=await db.from('content_jobs').select('candidate_id').eq('work_item_id',workItemId);
  const candidateIds=new Set<string>();
  for(const job of jobs||[])if(isUuid(job.candidate_id))candidateIds.add(job.candidate_id);
  if(jobError||candidateIds.size!==1)throw new Error('MOCKUP_SOURCE_NOT_CONNECTED');
  candidateId=[...candidateIds][0];
 }
 const {data:downloads,error:downloadError}=await db.from('content_jobs').select('result').eq('candidate_id',candidateId).eq('job_type','download').eq('status','completed').order('created_at',{ascending:false}).limit(1);
 if(downloadError||!downloads?.[0])throw new Error('MOCKUP_SOURCE_NOT_CONNECTED');
 const source=plainObject(downloads[0].result), binding=createMockupSessionBinding(item,candidateId,source);
 return {item,source,binding};
}
export async function requestProductionMockup(workItemId:string,actor:string) {
 const resolved=await readMockupSource(workItemId),db=contentAdmin();
 let {item,binding}=resolved;
 const {source}=resolved;
 if(item.status==='published')throw new Error('MOCKUP_PUBLISHED_LOCKED');
 const {data:running,error:readError}=await db.from('portfolio_mockup_sessions').select('id,status').eq('work_item_id',workItemId).in('status',['queued','preparing','review','uploading','staged']).limit(1);
 if(readError)throw new Error('MOCKUP_SCHEMA_NOT_READY');
 if(!running?.[0]){
  const {data:jobs,error:jobError}=await db.from('content_jobs').select('id').eq('work_item_id',workItemId).in('status',['running','pc_running']).limit(1);
  if(jobError||jobs?.length)throw new Error('MOCKUP_EXISTING_JOB_RUNNING');
 }
 if(!isUuid(plainObject(item.metadata).candidateId)){
  const metadata={...plainObject(item.metadata),candidateId:binding.candidateId};
  const {data:updated,error:updateError}=await db.from('content_work_items').update({metadata,updated_at:new Date().toISOString()}).eq('id',workItemId).eq('updated_at',item.updated_at).select('*').maybeSingle();
  if(updateError||!updated)throw new Error('MOCKUP_WORK_ITEM_REVISION_CONFLICT');
  item=updated;binding=createMockupSessionBinding(item,binding.candidateId,source);
 }
 if(running?.[0])return {id:running[0].id,status:running[0].status,reused:true};
 // Only the source link is repaired above; generation uses a separate image-only queue.
 const id=randomUUID();
 const {error}=await db.from('portfolio_mockup_sessions').insert({id,work_item_id:workItemId,candidate_id:binding.candidateId,requested_by:actor,binding:{...binding,version:MOCKUP_BRIDGE_VERSION},status:'queued'});
 if(error)throw new Error(error.code==='23505'?'MOCKUP_SESSION_ALREADY_OPEN':'MOCKUP_SESSION_CREATE_FAILED');
 return {id,status:'queued',reused:false,expectedUpdatedAt:item.updated_at};
}
export async function authorizeSessionSource(session:Record<string,unknown>) {
 const {item,source,binding}=await readMockupSource(String(session.work_item_id)),expected=plainObject(session.binding);
 if(item.status==='published')throw new Error('MOCKUP_PUBLISHED_LOCKED');
 if(binding.candidateId!==session.candidate_id||binding.sourceBindingHash!==expected.sourceBindingHash)throw new Error('MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED');
 if(binding.expectedActiveSetId!==expectedMockupActiveSetId(expected))throw new Error('IMAGE_SET_REVISION_CONFLICT');
 assertMockupImageInputs(item.metadata,expected);
 const db=contentAdmin();let sourceUrl:string,sourceAuthorization:string|null=null;
 if(source.delivery==='pc_direct'){
  const {data:file,error}=await db.from('naver_works_drive_files').select('root_id,external_file_id').eq('id',String(source.driveFileId)).single();
  if(error||!file)throw new Error('MOCKUP_SOURCE_DOWNLOAD_FAILED');
  const {data:root,error:rootError}=await db.from('naver_works_drive_roots').select('drive_type,external_drive_id').eq('id',file.root_id).single();
  if(rootError||root?.drive_type!=='shared_drive'||!root.external_drive_id)throw new Error('MOCKUP_SOURCE_DOWNLOAD_FAILED');
  const download=await sharedDriveDownloadAuthorization(root.external_drive_id,file.external_file_id);sourceUrl=download.url;sourceAuthorization=download.authorization;
 }else{
  if(source.bucket!=='portfolio-sources'||typeof source.storagePath!=='string'||source.storagePath.includes('..'))throw new Error('MOCKUP_SOURCE_LOCATION_INVALID');
  const {data,error}=await db.storage.from('portfolio-sources').createSignedUrl(source.storagePath,1800);
  if(error||!data?.signedUrl)throw new Error('MOCKUP_SOURCE_DOWNLOAD_FAILED');sourceUrl=data.signedUrl;
 }
 return {id:session.id,workItemId:session.work_item_id,mode:'full' as const,sourceUrl,sourceAuthorization,fileName:source.originalFileName,sourceBindingHash:canonicalHash(source)};
}
export function sameOriginMutation(request:Request) {
 if(request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json'))throw new Error('MOCKUP_ORIGIN_INVALID');
}
export function publicMockupError(error:unknown) {
 const message=error instanceof Error?error.message:'';
 return /^(MOCKUP|IMAGE_SET|THUMBNAIL)_[A-Z0-9_]+$/.test(message)?message:'MOCKUP_OPERATION_FAILED';
}

import 'server-only';
import {randomUUID} from 'node:crypto';
import {contentAdmin} from '@/lib/content-ops/data';
import {sharedDriveDownloadAuthorization} from '@/lib/naver-works/client';
import {canonicalHash,createMockupSessionBinding,isUuid,plainObject,MOCKUP_BRIDGE_VERSION} from './production-session';

export async function readMockupSource(workItemId:string) {
 if(!isUuid(workItemId))throw new Error('MOCKUP_WORK_ITEM_INVALID');
 const db=contentAdmin();
 const {data:item,error}=await db.from('content_work_items').select('*').eq('id',workItemId).maybeSingle();
 if(error||!item||item.format!=='portfolio')throw new Error('MOCKUP_WORK_ITEM_NOT_FOUND');
 const candidateId=plainObject(item.metadata).candidateId;
 if(!isUuid(candidateId))throw new Error('MOCKUP_SOURCE_NOT_CONNECTED');
 const {data:downloads,error:downloadError}=await db.from('content_jobs').select('result').eq('candidate_id',candidateId).eq('job_type','download').eq('status','completed').order('created_at',{ascending:false}).limit(1);
 if(downloadError||!downloads?.[0])throw new Error('MOCKUP_SOURCE_NOT_CONNECTED');
 const source=plainObject(downloads[0].result), binding=createMockupSessionBinding(item,candidateId,source);
 return {item,source,binding};
}
export async function requestProductionMockup(workItemId:string,actor:string) {
 const {item,binding}=await readMockupSource(workItemId),db=contentAdmin();
 const {data:running,error:readError}=await db.from('portfolio_mockup_sessions').select('id,status').eq('work_item_id',workItemId).in('status',['queued','preparing','review','uploading','staged']).limit(1);
 if(readError)throw new Error('MOCKUP_SCHEMA_NOT_READY');
 if(running?.[0])return {id:running[0].id,status:running[0].status,reused:true};
 const {data:jobs,error:jobError}=await db.from('content_jobs').select('id').eq('work_item_id',workItemId).in('status',['running','pc_running']).limit(1);
 if(jobError||jobs?.length)throw new Error('MOCKUP_EXISTING_JOB_RUNNING');
 // No work-item/queue/status write. This is a separate image-only review request.
 const id=randomUUID();
 const {error}=await db.from('portfolio_mockup_sessions').insert({id,work_item_id:workItemId,candidate_id:binding.candidateId,requested_by:actor,binding:{...binding,version:MOCKUP_BRIDGE_VERSION},status:'queued'});
 if(error)throw new Error(error.code==='23505'?'MOCKUP_SESSION_ALREADY_OPEN':'MOCKUP_SESSION_CREATE_FAILED');
 return {id,status:'queued',reused:false,expectedUpdatedAt:item.updated_at};
}
export async function authorizeSessionSource(session:Record<string,unknown>) {
 const {source,binding}=await readMockupSource(String(session.work_item_id)),expected=plainObject(session.binding);
 if(binding.expectedUpdatedAt!==expected.expectedUpdatedAt||binding.expectedMetadataHash!==expected.expectedMetadataHash||binding.sourceBindingHash!==expected.sourceBindingHash)throw new Error('MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED');
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

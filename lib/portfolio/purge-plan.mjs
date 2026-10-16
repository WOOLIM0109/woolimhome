export const PURGE_TABLES = ['content_work_items','content_jobs','portfolio_candidates','naver_works_drive_files',
  'portfolio_mockup_sessions','portfolio_image_sets','portfolio_image_set_activations','portfolio_thumbnail_versions',
  'portfolio_thumbnail_version_activations','portfolio_thumbnail_candidates','content_review_assets','content_publication_events','content_workers'];
export function storageReferences(value, inheritedBucket, found = new Map()) {
  if(typeof value==='string') {
    for(const match of value.replaceAll('&amp;','&').matchAll(/\/api\/admin\/assets\?[^"'\s<>]+/g)) {
      try { const url=new URL(match[0],'https://local.invalid'),bucket=url.searchParams.get('bucket'),path=url.searchParams.get('path');
        if(bucket==='portfolio-rendered'&&path&&!path.includes('..'))found.set(`${bucket}/${path}`,{bucket,path}); } catch {}
    }
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) { value.forEach(item => storageReferences(item,inheritedBucket,found)); return found; }
  const bucket = value.bucket || inheritedBucket;
  const add = (bucket, path) => { if(bucket==='portfolio-rendered' && typeof path==='string' && path && !path.includes('..')) found.set(`${bucket}/${path}`,{bucket,path}); };
  add(bucket,value.path); add(bucket,value.storagePath);
  for(const path of value.slidePaths || []) add(bucket,path);
  for(const field of ['public_url','url']) if(typeof value[field]==='string') {
    try { const url=new URL(value[field],'https://local.invalid'); if(url.pathname==='/api/admin/assets') add(url.searchParams.get('bucket'),url.searchParams.get('path')); } catch {}
  }
  Object.values(value).forEach(child=>storageReferences(child,bucket,found));return found;
}
export function planPortfolioPurge(snapshot) {
  const work=(snapshot.content_work_items||[]).filter(row=>row.channel==='naver_design'&&row.status==='on_hold');
  if(work.some(row=>row.published_at||row.published_url||row.published_url_normalized)) throw new Error('보류 행에 발행 기록이 있어 자동 정리를 중단했습니다.');
  const ids=new Set(work.map(row=>row.id));
  const jobs=(snapshot.content_jobs||[]).filter(row=>ids.has(row.work_item_id));
  const jobIds=new Set(jobs.map(row=>row.id));
  const candidateIds=new Set([...work.map(row=>row.metadata?.candidateId),...jobs.map(row=>row.candidate_id)].filter(Boolean));
  const shared=(snapshot.content_work_items||[]).filter(row=>!ids.has(row.id)&&candidateIds.has(row.metadata?.candidateId));
  if(shared.length||(snapshot.content_jobs||[]).some(row=>candidateIds.has(row.candidate_id)&&!ids.has(row.work_item_id))) throw new Error('다른 작업과 후보/작업을 공유하고 있어 정리를 중단했습니다.');
  if(jobs.some(row=>['running','pc_running'].includes(row.status))) throw new Error('실행 중인 작업이 있어 정리를 중단했습니다.');
  if((snapshot.portfolio_mockup_sessions||[]).some(row=>ids.has(row.work_item_id)&&['preparing','uploading'].includes(row.status)))throw new Error('실행 중인 목업 세션이 있어 정리를 중단했습니다.');
  if((snapshot.content_workers||[]).some(row=>jobIds.has(row.current_job_id)))throw new Error('PC 작업자가 아직 대상 작업을 소유하고 있습니다.');
  const backup={};
  for(const table of PURGE_TABLES) backup[table]=(snapshot[table]||[]).filter(row=>table==='content_work_items'?ids.has(row.id):table==='portfolio_candidates'?candidateIds.has(row.id):table==='naver_works_drive_files'?
    (snapshot.portfolio_candidates||[]).some(candidate=>candidateIds.has(candidate.id)&&candidate.drive_file_id===row.id):ids.has(row.work_item_id));
  const survivors={};
  for(const table of PURGE_TABLES) survivors[table]=(snapshot[table]||[]).filter(row=>!backup[table].some(saved=>saved.id===row.id));
  const retainedSets=backup.portfolio_image_sets.filter(set=>Object.values(survivors).some(rows=>rows.some(row=>JSON.stringify(row).includes(set.id))));
  // Include immutable retained sets in the backup, but never remove their objects.
  const retainedPaths=storageReferences(survivors);
  retainedSets.forEach(set=>storageReferences(set,undefined,retainedPaths));
  const files=storageReferences(backup);
  const ownedIds=new Set([...ids,...candidateIds,...backup.portfolio_mockup_sessions.map(row=>row.id),...backup.portfolio_image_sets.map(row=>row.id)]);
  for(const object of snapshot.storage_objects||[]) {
    if(object.bucket_id==='portfolio-rendered' && object.name.split('/').some(segment=>ownedIds.has(segment))) files.set(`${object.bucket_id}/${object.name}`,{bucket:object.bucket_id,path:object.name});
  }
  const storageFiles=[...files].filter(([key])=>!retainedPaths.has(key)).map(([,value])=>value).sort((a,b)=>a.path.localeCompare(b.path));
  return {backup,workIds:[...ids],candidateIds:[...candidateIds],retainedSetIds:retainedSets.map(row=>row.id),storageFiles,
    summary:work.map(row=>({id:row.id,title:row.title,status:row.status,reason:row.review_note||row.summary,
      missing_fonts:(snapshot.portfolio_candidates||[]).find(candidate=>candidate.id===row.metadata?.candidateId)?.missing_fonts?.length
        ? snapshot.portfolio_candidates.find(candidate=>candidate.id===row.metadata?.candidateId).missing_fonts
        : (row.review_note||'').match(/MISSING_FONTS:.*?(?:fonts:|글꼴[:：])\s*(.+)/i)?.[1]?.replace(/\.\s*$/,'').split(/,\s*/)||[],
      last_errors:jobs.filter(job=>job.work_item_id===row.id).map(job=>({type:job.job_type,code:job.last_error_code,error:job.error_message})),
      storage_paths:storageFiles.filter(file=>file.path.includes(row.id)||file.path.includes(row.metadata?.candidateId||'___')).map(file=>file.path)}))};
}

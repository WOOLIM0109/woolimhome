import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {prepareLocalPptx} from '../lib/pc-worker/preparation/pipeline.ts';

// Intentionally no dotenv, database client, worker settings, fetch or automatic production fallback.
const args=process.argv.slice(2), options=new Map();
const usage='사용법: npm.cmd run prepare-local -- --source <PPTX 경로> --work-root <비공개 작업 폴더> [--select 1,2,3,...] [--artwork-reviews <로컬 검토 JSON>] [--source-format a4_portrait --source-hash <원본 SHA256> --reviewed-by <검토자> --format-reason <사유>] [--prepare-requests] [--redact] [--serve]';
for(let i=0;i<args.length;i++) {
  if(['--serve','--redact','--prepare-requests'].includes(args[i])){options.set(args[i].slice(2),true);continue;}
  if(!['--source','--work-root','--select','--artwork-reviews','--source-format','--source-hash','--reviewed-by','--format-reason'].includes(args[i]) || !args[i+1])throw new Error(usage);
  options.set(args[i].slice(2),args[++i]);
}
if(!options.has('source')||!options.has('work-root')) {
  console.log(usage);
  console.log('동일 작업은 같은 --work-root로 재실행하세요. 원본은 읽기 전용이며 서버 업로드·AI 호출은 하지 않습니다.');
  process.exitCode=2;
} else {
  try {
    const sourcePath=path.resolve(options.get('source')),workRoot=path.resolve(options.get('work-root'));
    const formatKeys=['source-format','source-hash','reviewed-by','format-reason'];
    const hasFormatChoice=formatKeys.some(key=>options.has(key));
    if(hasFormatChoice && (formatKeys.some(key=>!options.has(key)) || options.get('source-format')!=='a4_portrait'))throw new Error('사용자 지정 세로는 규격·원본 SHA256·검토자·사유를 모두 명시해야 합니다. '+usage);
    const sourceFormatChoice=hasFormatChoice?{kind:'custom_portrait_to_a4',aspectClass:'a4_portrait',sourceHash:options.get('source-hash'),reviewedBy:options.get('reviewed-by'),reason:options.get('format-reason')}:undefined;
    let artworkReviews;
    if(options.has('artwork-reviews')) {
      const bytes=await readFile(path.resolve(options.get('artwork-reviews')));
      if(bytes.length>256*1024)throw new Error('ARTWORK_REVIEW_FILE_TOO_LARGE');
      artworkReviews=JSON.parse(bytes.toString('utf8'));
      if(!Array.isArray(artworkReviews) || artworkReviews.length>500)throw new Error('ARTWORK_REVIEWS_INVALID');
    }
    if(options.has('prepare-requests')) {
      if(hasFormatChoice)throw new Error('--prepare-requests는 기존 작업의 원본 규격 선택을 보존합니다. 규격을 바꾸려면 새 준비 실행을 사용하세요.');
      if(options.has('select') || artworkReviews)throw new Error('--prepare-requests는 기존 선별 결과를 보존합니다. --select 또는 --artwork-reviews와 함께 사용할 수 없습니다.');
      const {openPreparationWorkStore}=await import('../lib/pc-worker/preparation/work-store.ts');
      const store=await openPreparationWorkStore({root:workRoot});let work;
      try{work=await store.readWork();}finally{await store.release();}
      if(!work)throw new Error('MOCKUP_REQUEST_WORK_NOT_FOUND');
      const {preparePendingLocalMockupRequests}=await import('../lib/pc-worker/preparation/mockup-request-preparation.ts');
      const requestResult=await preparePendingLocalMockupRequests({sourcePath,workRoot,buildId:work.currentBuildId,
        onProgress:({stage,sourceSlideNumber,reused})=>console.log(`요청 처리 · ${stage}${sourceSlideNumber?` · 원본 ${sourceSlideNumber}번`:''}${reused?' · 재사용':''}`)});
      console.log(JSON.stringify({status:requestResult.status,prepared:requestResult.prepared.map(({requestId,sourceSlideNumber,highResolution,redactionStatus})=>({requestId,sourceSlideNumber,highResolution,redactionStatus})),
        holds:requestResult.holds,notice:'가림 후보만 로컬에 준비했습니다. 확대 검토·저장·블러본 생성·승인은 사용자가 편집기에서 직접 해야 합니다.'},null,2));
      if(options.has('serve')) {
        const {startLocalReviewServer}=await import('../lib/pc-worker/preparation/local-review-server.ts');
        const server=await startLocalReviewServer({root:requestResult.workRoot,buildId:requestResult.buildId});
        console.log(`로컬 확인 화면: ${server.url} (종료: Ctrl+C)`);
        process.once('SIGINT',async()=>{await server.close();process.exit(0);});
        process.once('SIGTERM',async()=>{await server.close();process.exit(0);});
      } else if(requestResult.status==='held')process.exitCode=2;
    } else {
      const result=await prepareLocalPptx({sourcePath,workRoot,sourceFormatChoice,artworkReviews,
        selectedSlideNumbers:options.has('select')?options.get('select').split(',').map(Number):undefined,
        onProgress:({stage,sourceSlideNumber,reused})=>console.log(`${stage}${sourceSlideNumber?` · 원본 ${sourceSlideNumber}번`:''}${reused?' · 재사용':''}`)});
      console.log(JSON.stringify({workRoot:result.workRoot,workId:result.workId,buildId:result.buildId,status:result.status,
        counts:result.counts,selected:result.selection.selected,reserves:result.selection.reserves,holds:result.selection.holds,
        notice:'로컬 검수가 필요합니다. 서버 업로드·운영 반영은 하지 않습니다.'},null,2));
      if(options.has('redact') && result.status!=='held') {
        const {initializePptxRedactions}=await import('../lib/pc-worker/preparation/redaction-service.ts');
        const states=await initializePptxRedactions({root:result.workRoot,buildId:result.buildId,source:await readFile(sourcePath),slideNumbers:[...result.selection.selected,...result.selection.reserves]});
        console.log(`로컬 가림 후보 준비: ${states.length}장 · 편집기에서 원본 확대 확인 후 처리하세요. 업로드 없음.`);
      }
      if(options.has('serve')) {
        const {startLocalReviewServer}=await import('../lib/pc-worker/preparation/local-review-server.ts');
        const server=await startLocalReviewServer({root:result.workRoot,buildId:result.buildId});
        console.log(`로컬 확인 화면: ${server.url} (종료: Ctrl+C)`);
        process.once('SIGINT',async()=>{await server.close();process.exit(0);});
        process.once('SIGTERM',async()=>{await server.close();process.exit(0);});
      } else if(result.status==='held')process.exitCode=2;
    }
  } catch(error) {
    console.error(error instanceof Error?error.message:'LOCAL_PREPARATION_FAILED');process.exitCode=1;
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {createElement} from 'react';
import {jsx,jsxs} from 'react/jsx-runtime';

function load(file, dependencies={}, globals={}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(resolve(file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,require(name){if(!(name in dependencies))throw Error(`Unexpected import: ${name}`);return dependencies[name];},Date,Error,Response,Request,JSON,URL,DOMException,AbortController,setTimeout,clearTimeout,crypto:webcrypto,...globals});
  return exports;
}

const progressModule=()=>load('components/admin/portfolio-progress.ts');
const stateModule=()=>load('components/admin/portfolio-candidate-state.ts');

test('inspection continues with the same requestId until the existing review step',async()=>{
  const calls=[],messages=[],stages=['inspecting','inspecting','pc_waiting','review'];
  const result=await progressModule().continuePortfolioPreparation({requestId:'request-12345678',wait:async()=>{},onProgress:p=>messages.push(p.message),
    fetcher:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});const stage=stages.shift();return Response.json({stage,shouldContinue:stage!=='review',message:stage});}});
  assert.equal(result.stage,'review');assert.equal(calls.length,4);assert.ok(calls.every(call=>call.url==='/api/admin/naver-works/prepare'&&call.body.requestId==='request-12345678'));
  assert.deepEqual(messages,['inspecting','inspecting','pc_waiting','review']);
});

test('manual preparation makes at most fourteen requests and preserves a progress message',async()=>{
  let calls=0;const messages=[];
  await progressModule().continuePortfolioPreparation({requestId:'request-12345678',wait:async()=>{},onProgress:p=>messages.push(p.message),
    fetcher:async()=>{calls++;return Response.json({stage:'inspecting',shouldContinue:true,message:'후보 검사 진행 중'});}});
  assert.equal(calls,14);assert.match(messages.at(-1),/검사 결과를 저장/);assert.doesNotMatch(messages.at(-1),/작업 큐/);
});

test('candidate states distinguish uninspected files from missing previews and preserve all production blocks',()=>{
  const {candidateInspectionLabel:label,candidateProductionBlockReason:block}=stateModule();
  const context={connected:true,activePortfolioCount:0,preparing:false};
  assert.equal(label({metadata:{imageReviewReason:'오래된 해시 확인 불가 문구'}}),'검사 전');
  assert.equal(label({metadata:{inspectionState:'no_preview'}}),'검사 완료 · 파일 안에 미리보기 이미지가 없어 중복 확인 불가');
  assert.match(label({metadata:{inspectionState:'too_large'}}),/100MB 초과/);
  assert.equal(label({metadata:{inspectionState:'failed',sourceInspectionFailure:{reason:'원본 확인 필요: HTTP 404'}}}),'원본 확인 필요: HTTP 404');
  assert.equal(label({metadata:{inspectionState:'passed'}}),'');
  assert.equal(block({metadata:{inspectionState:'pending'}},context),'');
  assert.match(block({metadata:{inspectionState:'no_preview'}},context),/중복 확인/);
  assert.match(block({fileSize:100*1024*1024+1},context),/100MB/);
  assert.equal(block({fontExclusionReason:'유료 글꼴 미보유: Söhne'},context),'유료 글꼴 미보유: Söhne');
  assert.match(block({}, {...context,activePortfolioCount:1}),/진행 중/);
  assert.match(block({}, {...context,connected:false}),/연결/);
});

function prepareHarness(result,active=null,mockupResult=null,jobs=[],downloadResult=null) {
  const calls={prepare:[],mockup:0,download:0};
  class Clock extends Date {static now(){return 1_800_000_000_000;}}
  const route=load('app/api/admin/naver-works/prepare/route.ts',{
    'next/server':{NextResponse:Response},
    '@/lib/content-ops/data':{authenticatedAdmin:async()=>({email:'admin@example.test'}),contentAdmin:()=>({from(table){let jobType;const q={select(){return q;},eq(key,value){if(key==='job_type')jobType=value;return q;},in(){return q;},then(resolve){resolve({data:jobs,error:null});},async maybeSingle(){return {data:table==='content_work_items'?active:jobs.find(job=>job.job_type===jobType)||null,error:null};}};return q;}})},
    '@/lib/naver-works/portfolio-pipeline':{prepareNextPortfolioCandidate:async options=>{calls.prepare.push(options);return result;}},
    '@/lib/naver-works/job-runner':{restorePcEligibleOversizedCandidates:async()=>{},processNextPortfolioDownload:async()=>{calls.download++;return downloadResult;}},
    '@/lib/portfolio/job-runner':{processNextPortfolioMockup:async()=>{calls.mockup++;return mockupResult;}},
    '@/lib/content-ops/cancellation':{generationCancellationRequested:async()=>false,removeCancelledGeneration:async()=>{}},
  },{Date:Clock});
  return {calls,post:()=>route.POST(new Request('https://example.test/prepare',{method:'POST',body:JSON.stringify({requestId:'request-12345678'})}))};
}

test('prepare uses the request-start deadline and explicitly continues only unfinished inspection',async()=>{
  const inspection={total:189,inspected:12,remaining:177,deadlineReached:true};
  const h=prepareHarness({prepared:false,inspected:12,eligible:0,inspection,inspectionPending:true,reason:'후보 검사 진행 중: 12/189 완료, 합격 0'});
  const payload=await (await h.post()).json();
  assert.equal(h.calls.prepare[0].deadlineAt,1_800_000_200_000);assert.equal(payload.stage,'inspecting');assert.equal(payload.shouldContinue,true);assert.deepEqual(payload.inspection,inspection);
  const conflict=prepareHarness({prepared:false,inspected:12,eligible:1,inspection,reason:'다른 실행에서 먼저 선택했습니다.'});
  const blocked=await (await conflict.post()).json();assert.equal(blocked.stage,'empty');assert.equal(blocked.shouldContinue,false);
});

test('review-required or held existing work never automatically resumes or selects another candidate',async()=>{
  for(const status of ['on_hold','review_required']) {
    const h=prepareHarness(null,{title:'회사소개서_울림초안',status,metadata:{candidateId:'bad-layout'}});
    const payload=await (await h.post()).json();assert.equal(payload.shouldContinue,false);assert.match(payload.message,/자동으로 다시 처리하지 않습니다/);
    assert.equal(h.calls.prepare.length,0);assert.equal(h.calls.mockup,0);assert.equal(h.calls.download,0);
  }
});

test('a newly rejected visual check stops the same request and directs the operator to its held queue item',async()=>{
  const h=prepareHarness(null,{title:'회사소개서_울림초안',status:'creating',metadata:{candidateId:'bad-layout'}},{status:'rejected'});
  const payload=await (await h.post()).json();assert.equal(payload.stage,'rejected');assert.equal(payload.shouldContinue,false);
  assert.match(payload.message,/검수 필요·보류/);assert.doesNotMatch(payload.message,/다음 후보/);assert.equal(h.calls.prepare.length,0);
});

test('a mockup waiting for conversion continues the existing PC queue instead of reporting a terminal hold',async()=>{
  for(const status of ['pc_waiting','pc_running']) {
    const jobs=[{job_type:'download',status:'completed'},{job_type:'convert',status},{job_type:'mockup',status:'on_hold'}];
    const h=prepareHarness(null,{title:'지정 원본',status:'researching',metadata:{candidateId:'source'}},null,jobs);
    const payload=await (await h.post()).json();assert.equal(payload.stage,status);assert.equal(payload.shouldContinue,true);assert.equal(h.calls.prepare.length,0);
  }
});

test('same-request enqueue retry respects the existing five-attempt limit without retrying visual rejection',async()=>{
  const active={title:'지정 원본',status:'on_hold',metadata:{candidateId:'source'}};
  const jobs=[{job_type:'download',status:'failed',attempts:1},{job_type:'convert',status:'on_hold'},{job_type:'mockup',status:'on_hold'}];
  const h=prepareHarness(null,active,null,jobs,{status:'pc_waiting',originalFileName:'원본.pptx'});
  const payload=await (await h.post()).json();assert.equal(payload.stage,'pc_waiting');assert.equal(payload.shouldContinue,true);assert.equal(h.calls.download,1);assert.equal(h.calls.prepare.length,0);
  const exhausted=prepareHarness(null,active,null,jobs.map(job=>job.job_type==='download'?{...job,attempts:5}:job));
  const stopped=await (await exhausted.post()).json();assert.equal(stopped.stage,'on_hold');assert.equal(stopped.shouldContinue,false);assert.equal(exhausted.calls.download,0);
});

test('preview reports pending cached inventory even with a held portfolio and never requests source inspection',async()=>{
  const calls=[];
  const q={select(){return q;},eq(){return q;},then(resolve){resolve({count:1,error:null});}};
  const route=load('app/api/admin/naver-works/candidates/preview/route.ts',{
    'next/server':{NextResponse:Response},'@/lib/content-ops/data':{authenticatedAdmin:async()=>({email:'admin'}),contentAdmin:()=>({from:()=>q})},
    '@/lib/portfolio/dedupe-inventory':{readPortfolioDedupeInventory:async(_threshold,options)=>{calls.push(options);return {accepted:[],groups:[],decisions:[],sourceFailures:[],needsImageReview:[],needsFontReview:[],metrics:{remaining:189,downloaded:0,cached:0}};}},
    '@/lib/naver-works/portfolio-selection':{deterministicShortlist:()=>[],metadataEligible:()=>true},
  });
  const response=await route.GET(new Request('https://example.test/preview'));const payload=await response.json();
  assert.equal(response.status,200);assert.equal(payload.pendingCount,189);assert.equal(payload.onHoldCount,1);assert.equal(calls.length,1);assert.equal(calls[0].readOnly,true);assert.equal(payload.productionStarted,false);
});

function statusHarness(options={}) {
  const reads=[];
  const candidates=['pending','passed','no_preview','too_large'].map((state,index)=>({id:`candidate-${index}`,project_name:`project-${index}`,quality_score:90-index,status:'candidate',metadata:{inspectionState:state},naver_works_drive_files:{file_name:`project-${index}.pptx`,file_path:'PPT',file_size:100}}));
  candidates.push({...candidates[0],id:'excluded',status:'excluded'});
  const db={from(table){const q={select(){return q;},eq(){return q;},in(){return q;},async single(){return {data:table==='portfolio_automation_control'?{hash_threshold:options.threshold===undefined?3:options.threshold}:{status:'connected'},error:null};},then(resolve){resolve(table==='content_work_items'?{data:[{id:'held',title:'회사소개서_울림초안',status:'on_hold'}],error:null}:{count:1806,error:options.fileCountError||null});}};return q;}};
  const route=load('app/api/admin/naver-works/status/route.ts',{
    'next/server':{NextResponse:Response},'@/lib/content-ops/data':{authenticatedAdmin:async()=>({email:'admin'}),contentAdmin:()=>db},
    '@/lib/naver-works/client':{supportedPortfolioFile:()=>true},
    '@/lib/portfolio/dedupe-inventory':{readPortfolioDedupeInventory:async(threshold,options)=>{reads.push({threshold,options});return {candidates,accepted:[candidates[1]],metrics:{remaining:1,downloaded:0,peakRssMb:123}};}},
    '@/lib/portfolio/source-inspection':{sourceInspectionState:c=>c.metadata.inspectionState},
    '@/lib/portfolio/font-policy':{portfolioFontExclusion:()=>null},'@/lib/portfolio/project-name':{normalizePortfolioProjectName:()=> 'project'},
    '@/lib/naver-works/portfolio-selection':{driveFile:c=>c.naver_works_drive_files,metadataEligible:()=>true},
  },{process:{env:{}}});
  return {route,reads};
}

test('status reports actual cached dedupe counts and distinguishes held work from active production',async()=>{
  const {route,reads}=statusHarness();
  const response=await route.GET();const payload=await response.json();
  assert.equal(response.status,200);assert.equal(reads[0].threshold,3);assert.equal(reads[0].options.readOnly,true);
  assert.equal(payload.candidateCount,4);assert.equal(payload.trackedCount,5);assert.equal(payload.fileCount,1806);assert.equal(payload.inspectionSummary.producible,1);
  assert.equal(payload.inspectionSummary.pending,1);assert.equal(payload.inspectionSummary.noPreview,1);assert.equal(payload.inspectionSummary.tooLarge,1);
  assert.equal(payload.activePortfolioCount,0);assert.equal(payload.heldPortfolioItems[0].title,'회사소개서_울림초안');
  assert.equal(payload.inspectionMetrics.downloaded,0);assert.equal(payload.inspectionMetrics.peakRssMb,123);
});

test('status uses the default hash threshold for initial unapproved setup information',async()=>{
  const {route,reads}=statusHarness({threshold:null});const response=await route.GET();
  assert.equal(response.status,200);assert.equal(reads[0].threshold,4);assert.equal((await response.json()).connection.status,'connected');
});

test('status reports file-count read failure instead of claiming there are zero files',async()=>{
  const {route}=statusHarness({fileCountError:{message:'파일 수 조회 실패'}});const response=await route.GET();const payload=await response.json();
  assert.equal(response.status,500);assert.equal(payload.error,'파일 수 조회 실패');assert.equal('fileCount' in payload,false);
});

function findElements(node,predicate,found=[]) {
  if(!node||typeof node!=='object')return found;
  if(predicate(node))found.push(node);
  for(const child of [node.props?.children].flat(Infinity))findElements(child,predicate,found);
  return found;
}

test('candidate UI confirms the filename, normalized name and cost before using the same request for continuation',async()=>{
  const candidate={id:'alpha',project_name:'테스트',status:'candidate',quality_score:90,fileName:'테스트_최종.pptx',normalizedProjectName:'테스트',metadata:{inspectionState:'passed'},selection_reasons:[]};
  const data={configured:true,connection:{status:'connected'},fileCount:1806,candidateCount:189,candidates:[candidate],activePortfolioCount:0};
  const requests=[],continuations=[],confirmations=[];let hook=0;
  const component=load('components/admin/NaverWorksDrivePanel.tsx',{
    react:{useCallback:fn=>fn,useEffect(){},useState:initial=>{const index=hook++;return [index===0?data:index===1?false:initial,()=>{}];}},
    'react/jsx-runtime':{jsx,jsxs},'lucide-react':Object.fromEntries(['Cloud','FileSearch','Loader2','RefreshCw','ShieldCheck'].map(name=>[name,()=>createElement('span')])),
    './portfolio-progress':{continuePortfolioPreparation:async options=>continuations.push(options)},'./portfolio-candidate-state':stateModule(),
  },{window:{confirm:message=>{confirmations.push(message);return true;},setTimeout(){}},fetch:async(url,options)=>{requests.push({url,options});return Response.json(url.endsWith('/produce')?{shouldContinue:true,message:'등록됨'}:data);}}).default;
  const tree=component();const button=findElements(tree,node=>node.type==='button'&&node.props.children==='이 후보로 제작')[0];
  assert.equal(button.props.disabled,false);button.props.onClick();await new Promise(setImmediate);
  assert.match(confirmations[0],/파일명: 테스트_최종.pptx/);assert.match(confirmations[0],/정규화 이름: 테스트/);assert.match(confirmations[0],/AI 본문 비용/);
  const first=requests.find(call=>call.url.endsWith('/produce'));const body=JSON.parse(first.options.body);
  assert.ok(body.requestId);assert.equal(continuations[0].requestId,body.requestId);assert.equal('confirmNotPublished' in body,false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {portfolioTestDatabase,ledgerMigrations} from '../portfolio/sql-test-database.mjs';

// All SQL, reservations, six-stage creation and PC queue transitions run in
// memory. Only authentication and source inventory transport are replaced.
async function harness() {
  const db=await portfolioTestDatabase([...ledgerMigrations,'20261016191618_portfolio_candidate_dedupe_guard.sql']);
  const operational=readFileSync('supabase/migrations/202608040009_operational_hardening.sql','utf8');
  await db.exec(operational.slice(operational.indexOf('create table if not exists public.content_automation_runs'),operational.indexOf('comment on column public.content_work_items')));
  await db.exec(`
    alter table portfolio_candidates add column project_key text;
    create table naver_works_drive_roots(id uuid primary key default gen_random_uuid(),drive_type text,external_drive_id text);
    alter table naver_works_drive_files add column root_id uuid,add column file_name text,add column file_path text,
      add column file_size bigint,add column file_extension text,add column sync_status text,add column updated_at timestamptz;
    alter table content_work_items add column review_note text;
    alter table content_jobs add column attempts int default 0,add column created_at timestamptz default now(),
      add column updated_at timestamptz default now(),add column started_at timestamptz,add column completed_at timestamptz,
      add column error_message text,add column result jsonb default '{}';
    update portfolio_automation_control set first_run_approved=true,hash_threshold=4,calibration_evidence='fixture',approved_at=now();
  `);
  const rpcCalls=[],inventoryCalls=[],downloadCalls=[];
  const admin={from(table){let fields='*',patch;const filters=[],values=[];let limit;
    const identifier=name=>{assert.match(name,/^[a-z_]+$/);return `"${name}"`;};
    const q={select(columns='*'){fields=columns;return q;},update(value){patch=value;return q;},
      eq(key,value){values.push(value);filters.push(`${identifier(key)}=$${values.length}`);return q;},
      in(key,choices){values.push(choices);filters.push(`${identifier(key)}=any($${values.length})`);return q;},
      lt(key,value){values.push(value);filters.push(`${identifier(key)}<$${values.length}`);return q;},
      order(){return q;},limit(value){limit=value;return q;},
      async single(){const result=await execute();return {...result,data:result.data?.[0]??null};},async maybeSingle(){return q.single();},
      then(yes,no){return execute().then(yes,no);}};
    async function execute(){try {
      let sql;
      if(patch){const assignments=Object.entries(patch).map(([key,value])=>{values.push(value);return `${identifier(key)}=$${values.length}`;});sql=`update ${identifier(table)} set ${assignments.join(',')}`;}
      else sql=`select ${fields==='*'?'*':fields.split(',').map(identifier).join(',')} from ${identifier(table)}`;
      if(filters.length)sql+=` where ${filters.join(' and ')}`;
      if(patch)sql+=' returning *';else if(limit)sql+=` limit ${limit}`;
      const {rows}=await db.query(sql,values);return {data:rows,error:null};
    } catch(error){return {data:null,error:{message:error.message}};}}
    return q;
  },async rpc(name,args){rpcCalls.push({name,args});try {
    const values=Object.values(args),slots=values.map((_,index)=>`$${index+1}`).join(',');
    const {rows}=await db.query(`select ${name}(${slots}) result`,values);return {data:rows[0].result,error:null};
  }catch(error){return {data:null,error:{message:error.message}};}}};
  let authenticated=true,inventoryOverride;
  const cache=new Map();
  const load=file=>{const path=resolve(file);if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);
    const dependencies={
      'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
      '@/lib/content-ops/data':{contentAdmin:()=>admin,authenticatedAdmin:async()=>authenticated?{email:'fixture@example.com'}:null},
      '@/lib/portfolio/dedupe-inventory':{
        async readPortfolioDedupeInventory(threshold,options){inventoryCalls.push(options);if(inventoryOverride)return inventoryOverride();
          const {rows}=await db.query('select c.*,row_to_json(f) naver_works_drive_files from portfolio_candidates c join naver_works_drive_files f on f.id=c.drive_file_id');
          const {rows:ledger}=await db.query('select * from portfolio_publication_ledger');
          const references=ledger.map(row=>({id:row.id,title:row.title,normalizedName:row.normalized_project_name,url:row.blog_url,hashes:row.representative_hashes}));
          const inspection=load('lib/portfolio/project-dedupe.ts').inspectPortfolioDuplicates(rows,references,threshold);
          const metrics={total:rows.filter(row=>row.status==='candidate').length,inspected:rows.length,remaining:0,deadlineReached:false,
            downloaded:0,cached:rows.length,failed:0,skippedLarge:0,durationMs:1,peakRssMb:50,tableReadMs:0,imageHashMs:0,candidateDownloadMs:0};
          return {...inspection,metrics,sourceFailures:[],needsFontReview:[],needsImageReview:[],accepted:inspection.accepted.filter(row=>row.metadata.representativeHashes?.length)};
        },async assertPortfolioDedupePassed(candidateId){const {rows:[row]}=await db.query('select * from portfolio_candidates where id=$1',[candidateId]);assert.equal(row.metadata.dedupeVersion,'project-dedupe-v1');},
      },
    };
    const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    vm.runInNewContext(source,{exports,require(name){if(name in dependencies)return dependencies[name];const next=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(path),name);return load(next.endsWith('.ts')?next:`${next}.ts`);},Date,Error,console,Response});return exports;
  };
  const pipeline=load('lib/naver-works/portfolio-pipeline.ts');
  const runner=load('lib/naver-works/job-runner.ts'),originalDownload=runner.processNextPortfolioDownload;
  runner.processNextPortfolioDownload=async id=>{downloadCalls.push(id);return originalDownload(id);};
  const route=load('app/api/admin/naver-works/candidates/[id]/produce/route.ts');
  async function candidate(name='지정 회사소개서',hash='aaaaaaaaaaaaaaaa') {
    const {rows:[root]}=await db.query(`insert into naver_works_drive_roots(drive_type,external_drive_id) values('shared_drive','fixture-drive') returning *`);
    const {rows:[file]}=await db.query(`insert into naver_works_drive_files(root_id,file_name,file_path,file_size,file_extension) values($1,$2,$3,100,'pptx') returning *`,[root.id,`${name}.pptx`,`완성본_외부공유금지/PPT/${name}.pptx`]);
    const {rows:[row]}=await db.query(`insert into portfolio_candidates(project_name,project_key,drive_file_id,quality_score,metadata) values($1,$1,$2,80,$3) returning *`,[name,file.id,{representativeHashes:hash?[hash]:[],fontPolicyVersion:'unowned-fonts-v1',inspectionState:hash?'passed':'no_preview'}]);
    return row;
  }
  async function post(row,body={requestId:'request-12345678'}){return route.POST(new Request('http://localhost/api/produce',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:row.id})});}
  return {db,admin,load,pipeline,route,candidate,post,rpcCalls,inventoryCalls,downloadCalls,
    auth:value=>{authenticated=value;},inventory:value=>{inventoryOverride=value;}};
}

test('designated production authenticates, validates status/font/active/approval before source reads',async()=>{
  const h=await harness();try {
    const row=await h.candidate();h.auth(false);assert.equal((await h.post(row)).status,401);h.auth(true);
    assert.equal((await h.post(row,{})).status,400);
    await h.db.query(`update portfolio_candidates set status='excluded' where id=$1`,[row.id]);assert.equal((await h.post(row)).status,409);
    await h.db.query(`update portfolio_candidates set status='candidate',missing_fonts=array['Söhne'] where id=$1`,[row.id]);assert.match((await (await h.post(row)).json()).error,/유료 글꼴/);
    await h.db.query(`update portfolio_candidates set missing_fonts='{}' where id=$1`,[row.id]);
    for(const status of ['researching','creating','draft_waiting']){
      await h.db.query(`insert into content_work_items(channel,format,status,title) values('naver_design','portfolio',$1,'기존 프로젝트')`,[status]);
      assert.match((await (await h.post(row)).json()).error,/진행 중/);await h.db.exec('delete from content_work_items');
    }
    await h.db.exec('update portfolio_automation_control set first_run_approved=false');assert.match((await (await h.post(row)).json()).error,/첫 제작 승인/);
    assert.equal(h.inventoryCalls.length,0);assert.equal(h.rpcCalls.length,0);
  }finally{await h.db.close();}
});

test('ledger duplicates return the published link and no-preview stays blocked even with confirmation/note',async()=>{
  const h=await harness();try {
    const row=await h.candidate(),normal=h.load('lib/portfolio/project-name.ts').normalizePortfolioProjectName(row.project_name);
    await h.db.query(`insert into portfolio_publication_ledger(title,normalized_project_name,blog_url,representative_hashes,source) values($1,$2,'https://blog.naver.com/wl_0109/123',$3,'history')`,[row.project_name,normal,[]]);
    const response=await h.post(row),body=await response.json();assert.equal(response.status,409);assert.equal(body.duplicateMatch.url,'https://blog.naver.com/wl_0109/123');assert.match(body.error,/중복/);
    const empty=await h.candidate('미리보기 없는 다른 프로젝트',null);
    assert.match((await (await h.post(empty,{requestId:'request-no-preview',confirmNotPublished:true,note:'대표 확인'})).json()).error,/지문 없는 후보/);
    assert.equal(h.rpcCalls.length,0);assert.equal(h.downloadCalls.length,0);
  }finally{await h.db.close();}
});

test('hashed candidate reserves exactly six stages, moves to PC queue and replays idempotently',async()=>{
  const h=await harness();try {
    const row=await h.candidate(),alternative=await h.candidate('같은 프로젝트의 다른 원본','cccccccccccccccc');
    await h.db.query('update portfolio_candidates set project_key=$1,quality_score=99 where id=$2',[row.project_key,alternative.id]);
    const response=await h.post(row),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.stage,'selected');assert.equal(body.prepared.candidateId,row.id);
    const {rows:items}=await h.db.query('select * from content_work_items');assert.equal(items.length,1);assert.equal(items[0].schedule_key,'manual-portfolio-request-12345678');
    const {rows:jobs}=await h.db.query('select * from content_jobs');assert.equal(jobs.length,6);assert.equal(jobs.find(job=>job.job_type==='convert').status,'pc_waiting');assert.equal(jobs.find(job=>job.job_type==='download').status,'completed');
    assert.equal(h.downloadCalls[0],row.id);assert.equal(h.inventoryCalls[0].candidateId,row.id);
    const replay=await (await h.post(row)).json();assert.equal(replay.stage,'existing');assert.equal(replay.workItemId,items[0].id);assert.equal(h.inventoryCalls.length,1);assert.equal(h.downloadCalls.length,1);
    const other=await h.candidate('전혀 다른 프로젝트','cccccccccccccccc');assert.equal((await h.post(other)).status,409);
    assert.equal((await h.db.query('select * from content_work_items')).rows.length,1);
    const {rows:[lease]}=await h.db.query('select * from content_automation_runs');assert.equal(lease.status,'skipped');assert.equal(lease.cron_name,'portfolio-reservation');
  }finally{await h.db.close();}
});

test('PC enqueue failure preserves one reservation and the same request can continue the queued work',async()=>{
  const h=await harness();try {
    const row=await h.candidate();await h.db.exec(`update naver_works_drive_roots set drive_type='unsupported'`);
    assert.equal((await h.post(row)).status,500);
    assert.equal((await h.db.query('select * from content_work_items')).rows.length,1);
    assert.equal((await h.db.query('select * from content_jobs')).rows.length,6);
    assert.equal((await h.db.query('select status from content_work_items')).rows[0].status,'on_hold');
    const replay=await (await h.post(row)).json();assert.equal(replay.stage,'existing');assert.equal(replay.shouldContinue,true);
    assert.equal(h.inventoryCalls.length,1);await h.db.exec(`update naver_works_drive_roots set drive_type='shared_drive'`);
    const continued=await h.load('lib/naver-works/job-runner.ts').processNextPortfolioDownload(row.id);assert.equal(continued.status,'pc_waiting');
    assert.equal((await h.db.query('select * from content_work_items')).rows.length,1);
  }finally{await h.db.close();}
});

test('distinct simultaneous manual and automatic requests share one reservation lease and only one active portfolio',async()=>{
  const h=await harness();try {
    const first=await h.candidate('첫 번째 독립 프로젝트'),second=await h.candidate('두 번째 독립 프로젝트','cccccccccccccccc');
    await h.db.query('update portfolio_candidates set quality_score=99 where id=$1',[second.id]);
    const outcomes=await Promise.all([
      h.pipeline.prepareNextPortfolioCandidate({candidateId:first.id,scheduleKey:'manual-portfolio-concurrent'}),
      h.pipeline.prepareNextPortfolioCandidate({scheduleKey:'naver-design-tuesday-slot'}),
    ]);
    assert.equal(outcomes.filter(result=>result.prepared).length,1);assert.equal((await h.db.query('select * from content_work_items')).rows.length,1);
    assert.equal((await h.db.query('select * from content_jobs')).rows.length,6);
    assert.ok(h.rpcCalls.filter(call=>call.name==='claim_content_automation_run').every(call=>call.args.p_schedule_key==='single-active-portfolio'));
  }finally{await h.db.close();}
});

test('deadline partial inventory still selects accepted evidence; zero accepted returns explicit inspection continuation',async()=>{
  const h=await harness();try {
    const row=await h.candidate();
    const pending={...row,metadata:{inspectionState:'pending'}};
    const metrics={total:189,inspected:12,remaining:177,deadlineReached:true,downloaded:12,cached:0,failed:0,skippedLarge:0,durationMs:90001,peakRssMb:80};
    h.inventory(()=>({accepted:[],decisions:[{candidate:pending,normalizedName:'검사전',duplicateScore:0}],metrics,needsImageReview:[pending],needsFontReview:[pending],sourceFailures:[]}));
    const noAccepted=await h.pipeline.prepareNextPortfolioCandidate({deadlineAt:1234});assert.equal(noAccepted.inspectionPending,true);assert.match(noAccepted.reason,/12\/189 완료, 합격 0/);assert.equal(h.inventoryCalls[0].deadlineAt,1234);
    const {rows:[current]}=await h.db.query('select c.*,row_to_json(f) naver_works_drive_files from portfolio_candidates c join naver_works_drive_files f on f.id=c.drive_file_id where c.id=$1',[row.id]);
    current.metadata={representativeHashes:['aaaaaaaaaaaaaaaa'],fontPolicyVersion:'unowned-fonts-v1',inspectionState:'passed'};
    h.inventory(()=>({accepted:[current],decisions:[{candidate:current,normalizedName:'지정회사소개서',duplicateScore:0}],metrics,
      needsImageReview:[],needsFontReview:[],sourceFailures:[]}));
    const accepted=await h.pipeline.prepareNextPortfolioCandidate({deadlineAt:Date.now()-1});assert.equal(accepted.prepared,true);assert.equal(accepted.candidateId,row.id);assert.equal(accepted.inspection.remaining,177);
  }finally{await h.db.close();}
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

// Execute the real token client, inventory and preview handler; only DB/provider boundaries are stubbed.
function harness() {
  let now=Date.parse('2026-10-20T08:00:00+09:00');
  const state={status:'connected',access_token_encrypted:'enc:old',refresh_token_encrypted:'enc:refresh',token_expires_at:new Date(now-1).toISOString()};
  const requests=[],writes=[];
  let providerFailure=false,recordFailure=false;
  const candidate={id:'candidate',status:'candidate',metadata:{},naver_works_drive_files:{id:'file',file_name:'source.pptx',file_size:100,modified_at:'2026-10-01'}};
  const db={from(table){return {select(){return this;},order(){return this;},
    async range(){return {data:table==='portfolio_candidates'?[candidate]:[],error:null};},
    update(patch){return {async eq(){writes.push(patch);if(recordFailure)return {error:{message:'write unavailable'}};Object.assign(state,patch);return {error:null};}};},
    eq(){return this;},then(resolve){resolve({count:0,error:null});},
    async single(){return {data:table==='naver_works_connections'?{...state}:{external_file_id:'file',naver_works_drive_roots:{external_drive_id:'drive'}},error:null};}};}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  async function fetchStub(url,options={}) {
    requests.push({url,options});
    if(url==='https://auth.worksmobile.com/oauth2/v2.0/token'){
      assert.equal(options.body.get('grant_type'),'refresh_token');
      assert.equal(options.body.get('refresh_token'),'refresh');
      return providerFailure?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'fresh',expires_in:3600,token_type:'Bearer'});
    }
    if(url==='https://www.worksapis.com/v1.0/sharedrives/drive/files/file/download'){
      assert.equal(options.headers.Authorization,'Bearer fresh');
      return new Response(null,{status:302,headers:{location:'https://download.example.test/source'}});
    }
    if(url==='https://download.example.test/source')return new Response('fixture');
    throw new Error(`Unexpected network destination: ${url}`);
  }
  function load(relative,dependencies) {
    const output=ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const exports={};
    vm.runInNewContext(output,{exports,require(name){if(!(name in dependencies))throw Error(`Unexpected import: ${name}`);return dependencies[name];},
      Date:Clock,Error,URL,URLSearchParams,Response,Buffer,AbortSignal,fetch:fetchStub,
      process:{env:{NAVER_WORKS_CLIENT_ID:'test-client',NAVER_WORKS_CLIENT_SECRET:'test-secret'}}});
    return exports;
  }
  const client=load('./client.ts',{'node:crypto':crypto,'@/lib/supabase/admin':{createAdminClient:()=>db},'./source-file.ts':{},'./crypto':{decryptToken:v=>v.slice(4),encryptToken:v=>`enc:${v}`}});
  const inventory=load('../portfolio/dedupe-inventory.ts',{
    '@/lib/content-ops/data':{contentAdmin:()=>db},'./project-dedupe':{validProjectHashes:()=>[]},'./project-name':{},
    './image-fingerprint':{},jszip:{loadAsync:async()=>{throw Error('SOURCE_DOWNLOAD_REACHED');}},
    '../naver-works/portfolio-selection':{driveFile:c=>c.naver_works_drive_files},'../naver-works/client':client,
    './font-policy':{portfolioFontExclusion:()=>null,PORTFOLIO_FONT_POLICY_VERSION:'test'},'./source-fonts':{},
  });
  const preview=load('../../app/api/admin/naver-works/candidates/preview/route.ts',{
    'next/server':{NextResponse:Response},'@/lib/content-ops/data':{authenticatedAdmin:async()=>({email:'test'}),contentAdmin:()=>db},
    '@/lib/portfolio/dedupe-inventory':inventory,'@/lib/naver-works/portfolio-selection':{},
  });
  return {state,requests,writes,client,inventory,preview,setTime:value=>{now=Date.parse(value);},failProvider:()=>{providerFailure=true;},failRecord:()=>{recordFailure=true;}};
}

test('Tuesday 08 sync token expires at 09 selection: real production inventory refreshes before downloading',async()=>{
  const h=harness();
  assert.equal(await h.client.accessToken(),'fresh');
  assert.equal(h.state.token_expires_at,'2026-10-20T00:00:00.000Z');
  h.setTime('2026-10-20T09:00:01+09:00');
  await assert.rejects(h.inventory.readPortfolioDedupeInventory(4),/SOURCE_DOWNLOAD_REACHED/);
  assert.equal(h.requests.filter(r=>r.url.includes('/token')).length,2);
  assert.equal(h.requests.filter(r=>r.url.endsWith('/download')).length,1);
  assert.equal(h.state.status,'connected');assert.equal(h.state.last_error,null);
  assert.equal(h.state.token_expires_at,'2026-10-20T01:00:01.000Z');
  assert.equal(h.state.refresh_token_encrypted,'enc:refresh');
});

test('preview GET with expired token never refreshes, downloads, or writes',async()=>{
  const h=harness(),before=JSON.stringify(h.state);
  h.setTime('2026-10-20T09:00:01+09:00');
  const response=await h.preview.GET(new Request('https://example.test/preview?threshold=4'));
  assert.equal(response.status,500);assert.match((await response.json()).error,/중복 검수용 Drive 읽기 토큰이 만료/);
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(JSON.stringify(h.state),before);
});

test('production refresh rejection records provider cause and stops before download without retry',async()=>{
  const h=harness();h.failProvider();
  await assert.rejects(h.inventory.readPortfolioDedupeInventory(4),/중복 검수용 Drive 읽기 토큰이 만료.*갱신 실패: invalid_grant/);
  assert.equal(h.requests.length,1);assert.equal(h.writes.length,1);
  assert.equal(h.state.status,'expired');assert.equal(h.state.last_error,'invalid_grant');
});

test('fresh tokens do not refresh; production refreshes inside the five-minute expiry margin',async()=>{
  const h=harness();await h.client.accessToken();
  h.setTime('2026-10-20T08:54:59+09:00');await h.client.accessToken({readOnly:true});
  assert.equal(h.requests.length,1);
  h.setTime('2026-10-20T08:55:00+09:00');await h.client.accessToken();
  assert.equal(h.requests.length,2);
});

test('refresh failure reporting also exposes a failure to save its reason',async()=>{
  const h=harness();h.failProvider();h.failRecord();
  await assert.rejects(h.client.accessToken(),/invalid_grant.*실패 사유 저장 오류: write unavailable/);
  assert.equal(h.requests.length,1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

// Execute the real token client, inventory and preview handler; only DB/provider boundaries are stubbed.
function harness({env={}}={}) {
  let now=Date.parse('2026-10-20T08:00:00+09:00');
  const state={status:'connected',access_token_encrypted:'enc:old',refresh_token_encrypted:'enc:refresh',token_expires_at:new Date(now-1).toISOString()};
  const requests=[],writes=[],encryptedValues=[];
  let providerFailure=false,recordFailure=false,downloadStatus=200,urlStatus=302;
  let tokenResponse={access_token:'fresh',expires_in:3600,token_type:'Bearer'};
  const candidate={id:'candidate',status:'candidate',metadata:{},updated_at:'2026-10-01',naver_works_drive_files:{id:'file',file_name:'source.pptx',file_size:100,modified_at:'2026-10-01'}};
  const db={from(table){return {select(){return this;},order(){return this;},
    async range(){return {data:table==='portfolio_candidates'?[candidate]:[],error:null};},
    async upsert(patch){writes.push(patch);Object.assign(state,patch);return {error:null};},
    update(patch){const query={eq(){return query;},select(){return query;},async maybeSingle(){writes.push(patch);return {data:{id:'candidate'},error:null};},then(resolve){writes.push(patch);if(recordFailure)return resolve({error:{message:'write unavailable'}});Object.assign(state,patch);resolve({error:null});}};return query;},
    eq(){return this;},then(resolve){resolve({count:0,error:null});},
    async single(){return {data:table==='naver_works_connections'?{...state}:{external_file_id:'file',naver_works_drive_roots:{external_drive_id:'drive'}},error:null};}};}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  async function fetchStub(url,options={}) {
    requests.push({url,options});
    if(url==='https://auth.worksmobile.com/oauth2/v2.0/token'){
      if(options.body.get('grant_type')==='refresh_token')assert.equal(options.body.get('refresh_token'),'refresh');
      else {assert.equal(options.body.get('grant_type'),'authorization_code');assert.equal(options.body.get('code'),'test-code');}
      return providerFailure?Response.json({error:'invalid_grant'},{status:400}):Response.json(tokenResponse);
    }
    if(url==='https://www.worksapis.com/v1.0/sharedrives/drive/files/file/download'){
      assert.equal(options.headers.Authorization,'Bearer fresh');
      if(urlStatus!==302)return new Response('signed URL and provider secrets must not escape',{status:urlStatus});
      return new Response(null,{status:302,headers:{location:'https://download.example.test/source'}});
    }
    if(url==='https://download.example.test/source')return new Response('fixture',{status:downloadStatus});
    throw new Error(`Unexpected network destination: ${url}`);
  }
  function load(relative,dependencies) {
    const output=ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const exports={};
    vm.runInNewContext(output,{exports,require(name){if(!(name in dependencies))throw Error(`Unexpected import: ${name}`);return dependencies[name];},
      Date:Clock,Error,URL,URLSearchParams,Response,Buffer,AbortSignal,fetch:fetchStub,console:{info(){},warn(){}},
      process:{env:{NAVER_WORKS_CLIENT_ID:'test-client',NAVER_WORKS_CLIENT_SECRET:'test-secret',...env}}});
    return exports;
  }
  const client=load('./client.ts',{'node:crypto':crypto,'@/lib/supabase/admin':{createAdminClient:()=>db},'./source-file.ts':{},'./crypto':{decryptToken:v=>v.slice(4),encryptToken:v=>{encryptedValues.push(v);return `enc:${v}`;}}});
  const inventory=load('../portfolio/dedupe-inventory.ts',{
    '@/lib/content-ops/data':{contentAdmin:()=>db},'./project-dedupe':{validProjectHashes:()=>[],inspectPortfolioDuplicates:candidates=>({accepted:candidates,decisions:[],groups:[]})},'./project-name':{},
    './image-fingerprint':{},jszip:{loadAsync:async()=>({files:{}})},
    '../naver-works/portfolio-selection':{driveFile:c=>c.naver_works_drive_files,metadataEligible:()=>true,projectScore:()=>0,explorationScore:()=>0},'../naver-works/client':client,
    './font-policy':{portfolioFontExclusion:()=>null,PORTFOLIO_FONT_POLICY_VERSION:'test'},'./source-fonts':{readPptxSourceFonts:async()=>['Arial']},
    './comparison-waiver':load('../portfolio/comparison-waiver.ts',{}),
    './source-inspection':load('../portfolio/source-inspection.ts',{'./font-policy.ts':{PORTFOLIO_FONT_POLICY_VERSION:'test'},'./project-dedupe.ts':{validProjectHashes:hashes=>hashes}}),
  });
  const preview=load('../../app/api/admin/naver-works/candidates/preview/route.ts',{
    'next/server':{NextResponse:Response},'@/lib/content-ops/data':{authenticatedAdmin:async()=>({email:'test'}),contentAdmin:()=>db},
    '@/lib/portfolio/dedupe-inventory':inventory,'@/lib/naver-works/portfolio-selection':{deterministicShortlist:()=>[],metadataEligible:()=>true,driveFile:c=>c.naver_works_drive_files},
  });
  return {state,requests,writes,encryptedValues,client,inventory,preview,setTokenResponse:value=>{tokenResponse=value;},setTime:value=>{now=Date.parse(value);},failProvider:()=>{providerFailure=true;},failRecord:()=>{recordFailure=true;},setDownloadStatus:value=>{downloadStatus=value;},setUrlStatus:value=>{urlStatus=value;}};
}

const missingAccessTokenMessage='NAVER WORKS가 Access Token을 돌려주지 않았습니다. 다시 연결해 주세요.';
const invalidTokenResponses=[
  ['missing access token',{expires_in:3600,refresh_token:'renewed-refresh'}],
  ['empty access token',{access_token:'',expires_in:3600,refresh_token:'renewed-refresh'}],
  ['whitespace access token',{access_token:'  ',expires_in:3600,refresh_token:'renewed-refresh'}],
  ['null access token',{access_token:null,expires_in:3600,refresh_token:'renewed-refresh'}],
  ['non-string access token',{access_token:123,expires_in:3600,refresh_token:'renewed-refresh'}],
  ['null payload',null],
];

for(const [label,payload] of invalidTokenResponses){
  test(`HTTP 200 refresh with ${label} records a readable expired reason before encryption`,async()=>{
    const h=harness();h.setTokenResponse(payload);
    await assert.rejects(h.client.accessToken(),error=>{
      assert.ok(error.message.includes(missingAccessTokenMessage));
      assert.ok(!error.message.includes('The "data" argument'));
      return true;
    });
    assert.equal(h.requests.length,1);assert.equal(h.writes.length,1);
    assert.equal(h.state.status,'expired');assert.equal(h.state.last_error,missingAccessTokenMessage);
    assert.equal(h.state.access_token_encrypted,'enc:old');assert.equal(h.state.refresh_token_encrypted,'enc:refresh');
    assert.deepEqual(h.encryptedValues,[]);
  });

  test(`HTTP 200 authorization exchange with ${label} stops before encryption or writes`,async()=>{
    const h=harness();h.setTokenResponse(payload);
    await assert.rejects(h.client.exchangeAuthorizationCode('test-code','admin@example.test'),{message:missingAccessTokenMessage});
    assert.equal(h.requests.length,1);assert.equal(h.writes.length,0);assert.deepEqual(h.encryptedValues,[]);
  });
}

test('OAuth callbacks use only exact allowed request hosts and always use HTTPS',()=>{
  const fallback='https://fallback.example.test/callback';
  const h=harness({env:{NAVER_WORKS_REDIRECT_URI:fallback,NEXT_PUBLIC_SITE_URL:'https://site.example.test'}});
  for(const host of ['www.woolimcompany.kr','woolimcompany.kr','woolim-site.vercel.app']){
    for(const protocol of ['https:','http:']){
      assert.equal(h.client.oauthRedirectUri(new Request(`${protocol}//${host}/admin/sources?ignored=value`)),`https://${host}/api/admin/naver-works/callback`);
    }
  }
  for(const host of ['unknown.example.test','www.woolimcompany.kr.attacker.example','www.woolimcompany.kr:8443','woolim-site.vercel.app.attacker.example']){
    assert.equal(h.client.oauthRedirectUri(new Request(`https://${host}/admin/sources`)),fallback);
  }
  assert.equal(h.client.oauthRedirectUri(new Request('https://unknown.example.test/admin/sources',{headers:{host:'www.woolimcompany.kr','x-forwarded-host':'www.woolimcompany.kr'}})),fallback);
  assert.equal(h.client.oauthRedirectUri(),fallback);
});

test('OAuth callback fallback preserves redirect URI, site URL, and built-in priority',()=>{
  const request=new Request('https://unknown.example.test/admin/sources');
  const configured=harness({env:{NAVER_WORKS_REDIRECT_URI:'https://configured.example.test/callback',NEXT_PUBLIC_SITE_URL:'https://site.example.test'}});
  const siteOnly=harness({env:{NEXT_PUBLIC_SITE_URL:'https://site.example.test'}});
  const defaults=harness();
  for(const input of [request,undefined]){
    assert.equal(configured.client.oauthRedirectUri(input),'https://configured.example.test/callback');
    assert.equal(siteOnly.client.oauthRedirectUri(input),'https://site.example.test/api/admin/naver-works/callback');
    assert.equal(defaults.client.oauthRedirectUri(input),'https://woolim-site.vercel.app/api/admin/naver-works/callback');
  }
});

test('authorization and code exchange send exactly the same request-derived redirect URI',async()=>{
  const h=harness({env:{NAVER_WORKS_REDIRECT_URI:'https://fallback.example.test/callback'}});
  h.setTokenResponse({access_token:'fresh',refresh_token:'renewed-refresh',expires_in:3600,token_type:'Bearer'});
  for(const host of ['www.woolimcompany.kr','woolimcompany.kr','woolim-site.vercel.app','unknown.example.test',undefined]){
    const request=host?new Request(`https://${host}/api/admin/naver-works/callback`):undefined;
    const expected=h.client.oauthRedirectUri(request);
    const authorization=new URL(h.client.authorizationUrl('test-state',request));
    assert.equal(authorization.searchParams.get('redirect_uri'),expected);
    assert.equal(authorization.searchParams.get('state'),'test-state');
    await h.client.exchangeAuthorizationCode('test-code','admin@example.test',request);
    assert.equal(h.requests.at(-1).options.body.get('redirect_uri'),expected);
  }
  assert.equal(h.writes.length,5);assert.equal(h.state.status,'connected');assert.equal(h.state.connected_by,'admin@example.test');
});

test('authorization exchange still requires a refresh token after a valid access token',async()=>{
  const h=harness();
  await assert.rejects(h.client.exchangeAuthorizationCode('test-code','admin@example.test'),{message:'Refresh Token이 발급되지 않았습니다.'});
  assert.equal(h.requests.length,1);assert.equal(h.writes.length,0);assert.deepEqual(h.encryptedValues,[]);
});

test('Tuesday 08 sync token expires at 09 selection: real production inventory refreshes before downloading',async()=>{
  const h=harness();
  assert.equal(await h.client.accessToken(),'fresh');
  assert.equal(h.state.token_expires_at,'2026-10-20T00:00:00.000Z');
  h.setTime('2026-10-20T09:00:01+09:00');
  const inventory=await h.inventory.readPortfolioDedupeInventory(4);
  assert.equal(inventory.metrics.downloaded,1);
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
  assert.equal(response.status,200);assert.equal((await response.json()).inspection.remaining,1);
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

test('download failures carry HTTP status and stage without signed URLs or response bodies',async()=>{
  const h=harness();h.setDownloadStatus(404);
  await assert.rejects(h.client.downloadSharedDriveFile('drive','file'),error=>error instanceof h.client.DriveFileDownloadError && error.httpStatus===404 && error.stage==='download' && !error.message.includes('https:'));
  h.setUrlStatus(403);
  await assert.rejects(h.client.downloadSharedDriveFile('drive','file'),error=>error.httpStatus===403 && error.stage==='download_url' && !error.message.includes('secrets'));
});

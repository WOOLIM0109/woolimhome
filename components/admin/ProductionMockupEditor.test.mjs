import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source=fs.readFileSync(new URL('./ProductionMockupEditor.tsx',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const workId='11111111-1111-4111-8111-111111111111';
const sessionId='22222222-2222-4222-8222-222222222222';
const candidateId='33333333-3333-4333-8333-333333333333';
const differentId='44444444-4444-4444-8444-444444444444';
const sha='a'.repeat(64);
const now='2026-09-07T12:00:00.000Z';
const entered={main:'행사 대행 제안서',sub:'광양시민의 날',showSub:true,style:'bold'};
const imageUrl=index=>`/api/admin/assets?bucket=portfolio-rendered&path=verified-local%2F${workId}%2F${sessionId}%2F${index}.png`;
const session=(overrides={})=>({id:sessionId,status:'staged',createdAt:now,localReviewUrl:null,errorCode:null,snapshotHash:sha,images:Array.from({length:5},(_,i)=>({kind:i?'body_image':'thumbnail',url:imageUrl(i)})),...overrides});
const state=(overrides={})=>({sessions:[],title:{available:true,current:null},...overrides});
const candidate=()=>({candidateId,expectedUpdatedAt:now,manifestHash:sha,url:`/api/admin/assets?bucket=portfolio-rendered&path=verified-thumbnail%2F${workId}%2F${candidateId}.png`});

function all(root,predicate){
 const out=[];
 const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;if(predicate(node))out.push(node);walk(node.props?.children);};
 walk(root);return out;
}
function words(node){return Array.isArray(node)?node.map(words).join(''):node&&typeof node==='object'?words(node.props?.children):node==null||typeof node==='boolean'?'':String(node);}
function harness(overrides={}){
 const slots=[],requests=[],responses=[];
 let cursor=0,tree,activated=0;
 const hooks={useRef(initial){const index=cursor++;slots[index]??={current:initial};return slots[index];},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];}};
 const jsx=(type,props,key)=>({type,props:props??{},key});
 const exports={};
 const sandbox={exports,URL,console,fetch:async(url,options)=>{requests.push({url,...options,body:options.body?JSON.parse(options.body):null});const response=responses.shift();assert.ok(response,'Unexpected request: '+url);return {ok:response.status<400,status:response.status,json:async()=>response.body};},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};if(name==='@/lib/http/read-json')return {readJsonResponse:response=>response.json()};throw new Error('Unexpected client dependency: '+name);}};
 vm.runInNewContext(js,sandbox,{filename:'ProductionMockupEditor.js'});
 const props={workItemId:workId,title:'기존 게시글 제목',currentAssets:[{id:'legacy',asset_type:'thumbnail',public_url:'/existing-thumbnail.png'}],onActivated:async()=>{activated++;},...overrides};
 const render=()=>{cursor=0;tree=exports.default(props);for(const node of all(tree,n=>n.type==='dialog'&&n.props.ref)){node.props.ref.current??={showModal(){},close(){}};}return tree;};
 const button=text=>{const found=all(tree,n=>n.type==='button'&&words(n)===text);assert.equal(found.length,1,text);return found[0];};
 const input=label=>{const labels=all(tree,n=>n.type==='label'&&words(n).trim().startsWith(label));assert.equal(labels.length,1,label);return all(labels[0],n=>n.type==='input')[0];};
 const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));render();};
 render();
 return {exports,requests,responses,render,button,input,flush,get tree(){return tree;},get activated(){return activated;},respond(body,status=200){responses.push({body,status});},async click(text){const b=button(text);assert.equal(Boolean(b.props.disabled),false,text+' disabled');b.props.onClick();await flush();},change(label,value){const element=input(label);element.props.onChange({target:{value,checked:value}});render();},async open(data=state()){this.respond(data);await this.click('목업·썸네일 편집');},fullLoad(){const img=all(tree,n=>n.type==='img'&&typeof n.props.onLoad==='function');assert.equal(img.length,1);img[0].props.onLoad();render();},fullFail(){const img=all(tree,n=>n.type==='img'&&typeof n.props.onError==='function');assert.equal(img.length,1);img[0].props.onError();render();}};
}

test('client allows only same-origin candidate images and strict loopback launch links',()=>{
 const h=harness();
 assert.equal(h.exports.localMockupReviewLink('http://127.0.0.1:9030/'),'http://127.0.0.1:9030/');
 assert.equal(h.exports.localMockupReviewLink(`http://127.0.0.1:9030/launch/${sha}`),`http://127.0.0.1:9030/launch/${sha}`);
 for(const value of ['https://example.com/','http://localhost:9030/?token=secret','http://user:pass@127.0.0.1:9030/','http://127.0.0.1:9030/editor','http://127.0.0.1:9030/launch/not-a-token','javascript:alert(1)'])assert.equal(h.exports.localMockupReviewLink(value),null);
 assert.equal(h.exports.productionMockupImageUrl(imageUrl(0)),imageUrl(0));
 for(const value of ['//evil.test/a.png','https://evil.test/a.png','/api/admin/\\evil','/api/admin/ a.png','/private/ppt.png'])assert.equal(h.exports.productionMockupImageUrl(value),null);
 assert.throws(()=>h.exports.checkedMockupSessions(state({sessions:[session({images:[{kind:'thumbnail',url:'https://example.com/raw.png'}]})]})),/주소/);
});

test('closed editor does not fetch or load images; typing and local revert never fetch',async()=>{
 const h=harness();assert.equal(h.requests.length,0);assert.equal(all(h.tree,n=>n.type==='img'||n.type==='input').length,0);
 await h.open();assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'GET');
 assert.equal(h.input('메인 제목').props.value,'');assert.equal(h.input('보조 제목 ·').props.value,'');
 h.change('메인 제목',entered.main);h.change('보조 제목 ·',entered.sub);h.change('보조 제목 표시',true);
 assert.equal(h.requests.length,1);await h.click('입력만 되돌리기');assert.equal(h.requests.length,1);assert.equal(h.input('메인 제목').props.value,'');
 assert.doesNotMatch(source,/useEffect|setInterval|setTimeout|localStorage|sendBeacon/);
});

test('unchanged title is a no-op; validation failure keeps fields and does not retry',async()=>{
 const h=harness();await h.open(state({title:{available:true,current:entered}}));
 assert.equal(h.button('제목 미리보기 만들기').props.disabled,true);
 h.change('메인 제목','다른 행사 제안서');h.respond({error:'MOCKUP_TITLE_TOO_WIDE'},409);await h.click('제목 미리보기 만들기');
 assert.equal(h.requests.length,2);assert.equal(h.input('메인 제목').props.value,'다른 행사 제안서');assert.equal(h.input('보조 제목 ·').props.value,entered.sub);
 assert.match(words(h.tree),/문구를 줄이거나 보조 제목 표시를 꺼/);assert.equal(h.activated,0);
 h.respond(state({title:{available:true,current:{...entered,main:'다른 관리자의 제목'}}}));await h.click('상태 새로고침');
 assert.equal(h.input('메인 제목').props.value,'다른 행사 제안서');assert.equal(h.requests.length,3);
});

async function makeTitleCandidate(h,initial=state()){
 await h.open(initial);h.change('메인 제목',entered.main);h.change('보조 제목 ·',entered.sub);h.change('보조 제목 표시',true);
 h.respond(candidate());await h.click('제목 미리보기 만들기');
 assert.deepEqual(h.requests[1].body,{action:'preview',title:entered});
 assert.equal(h.button('제목 미리보기 만들기').props.disabled,true);
}
test('title confirmation binds exact viewed candidate and hash; stale/errors retain entered title',async()=>{
 const h=harness();await makeTitleCandidate(h);
 assert.equal(h.input('후보를 열어').props.disabled,true);
 await h.click('제목 후보 열어 확인');h.fullFail();assert.equal(h.input('후보를 열어').props.disabled,true);
 h.fullLoad();h.change('후보를 열어',true);assert.equal(h.button('확인한 썸네일만 교체').props.disabled,false);
 h.respond({error:'THUMBNAIL_REVISION_CONFLICT'},409);await h.click('확인한 썸네일만 교체');
 assert.deepEqual(h.requests[2].body,{action:'activate',candidateId,manifestHash:sha,outputInspected:true});
 assert.equal(h.input('메인 제목').props.value,entered.main);assert.equal(h.activated,0);assert.match(words(h.tree),/다른 편집으로 기준 상태/);
 h.change('메인 제목','후보와 다른 제목');assert.equal(h.button('확인한 썸네일만 교체').props.disabled,true);assert.equal(h.requests.length,3);
});

test('wrong activation receipt cannot claim completion; correct receipt refreshes after confirmed swap',async()=>{
 const h=harness();await makeTitleCandidate(h);await h.click('제목 후보 열어 확인');h.fullLoad();h.change('후보를 열어',true);
 h.respond({workItemId:workId,activeVersionId:differentId,updatedAt:now});await h.click('확인한 썸네일만 교체');assert.equal(h.activated,0);assert.match(words(h.tree),/완료 응답을 확인하지 못했습니다/);
 h.respond({workItemId:workId,activeVersionId:candidateId,updatedAt:now});h.respond(state({title:{available:true,current:entered}}));await h.click('확인한 썸네일만 교체');
 assert.equal(h.activated,1);assert.equal(h.input('메인 제목').props.value,entered.main);assert.match(words(h.tree),/내지·원고·FAQ·게시글 제목·발행 정보는 유지/);
 assert.equal(h.requests.filter(r=>r.method==='POST').length,3);
});

test('full-set activation requires all five full-size loads and an explicit inspection checkbox',async()=>{
 const h=harness();await h.open(state({sessions:[session()]}));
 assert.equal(h.input('새 후보 5장의').props.disabled,true);assert.equal(h.button('확인한 목업 5장으로 교체').props.disabled,true);
 for(let i=0;i<5;i++){
  const card=all(h.tree,n=>n.type==='button'&&all(n,c=>c.type==='img'&&c.props.src===imageUrl(i)).length===1)[0];assert.ok(card);card.props.onClick();h.render();h.fullLoad();
 }
 assert.equal(h.input('새 후보 5장의').props.disabled,false);assert.equal(h.button('확인한 목업 5장으로 교체').props.disabled,true);
 h.change('새 후보 5장의',true);h.respond({workItemId:workId,activeSetId:sessionId,updatedAt:now});h.respond(state({sessions:[session({status:'activated'})]}));await h.click('확인한 목업 5장으로 교체');
 assert.deepEqual(h.requests[1].body,{action:'activate',sessionId,snapshotHash:sha,outputInspected:true});assert.equal(h.activated,1);
});

test('refresh invalidates old snapshot inspections without overwriting unsaved title',async()=>{
 const h=harness();await h.open(state({sessions:[session()]}));h.change('메인 제목',entered.main);
 for(let i=0;i<5;i++){all(h.tree,n=>n.type==='button'&&all(n,c=>c.type==='img'&&c.props.src===imageUrl(i)).length===1)[0].props.onClick();h.render();h.fullLoad();}
 h.change('새 후보 5장의',true);h.respond(state({sessions:[session({snapshotHash:'b'.repeat(64)})]}));await h.click('상태 새로고침');
 assert.equal(h.input('새 후보 5장의').props.checked,false);assert.equal(h.input('새 후보 5장의').props.disabled,true);assert.equal(h.input('메인 제목').props.value,entered.main);assert.equal(h.activated,0);
});

test('current revision refresh invalidates only title candidate/proof and preserves both typed fields',async()=>{
 const h=harness(),revision={activeSetId:differentId,updatedAt:now};
 await makeTitleCandidate(h,state({title:{available:true,current:null,revision}}));
 await h.click('제목 후보 열어 확인');h.fullLoad();h.change('후보를 열어',true);
 h.respond(state({title:{available:true,current:null,revision}}));await h.click('상태 새로고침');
 assert.equal(h.button('확인한 썸네일만 교체').props.disabled,false,'same revision retains valid inspection');
 h.respond(state({title:{available:true,current:null,revision:{...revision,updatedAt:'2026-09-07T12:01:00.000Z'}}}));await h.click('상태 새로고침');
 assert.equal(all(h.tree,n=>n.type==='button'&&words(n)==='제목 후보 열어 확인').length,0);
 assert.equal(h.input('메인 제목').props.value,entered.main);assert.equal(h.input('보조 제목 ·').props.value,entered.sub);assert.equal(h.input('보조 제목 표시').props.checked,true);
 assert.equal(h.button('제목 미리보기 만들기').props.disabled,false);assert.match(words(h.tree),/기준 상태가 바뀌어 이전 제목 후보와 검수 확인을 해제/);assert.equal(h.activated,0);
});

test('active base set change invalidates old title candidate even when timestamp is unchanged',async()=>{
 const h=harness();await makeTitleCandidate(h,state({title:{available:true,current:null,revision:{activeSetId:differentId,updatedAt:now}}}));
 h.respond(state({title:{available:true,current:null,revision:{activeSetId:sessionId,updatedAt:now}}}));await h.click('상태 새로고침');
 assert.equal(all(h.tree,n=>n.type==='button'&&words(n)==='제목 후보 열어 확인').length,0);assert.equal(h.input('메인 제목').props.value,entered.main);
});

test('verified full-set receipt immediately clears prior title candidate even if read-back fails',async()=>{
 const h=harness();await makeTitleCandidate(h,state({sessions:[session()],title:{available:true,current:null,revision:{activeSetId:differentId,updatedAt:now}}}));
 await h.click('제목 후보 열어 확인');h.fullLoad();h.change('후보를 열어',true);
 for(let i=0;i<5;i++){all(h.tree,n=>n.type==='button'&&all(n,c=>c.type==='img'&&c.props.src===imageUrl(i)).length===1)[0].props.onClick();h.render();h.fullLoad();}
 h.change('새 후보 5장의',true);h.respond({workItemId:workId,activeSetId:sessionId,updatedAt:now});h.respond({error:'MOCKUP_OPERATION_FAILED'},503);await h.click('확인한 목업 5장으로 교체');
 assert.equal(h.activated,1);assert.equal(all(h.tree,n=>n.type==='button'&&words(n)==='제목 후보 열어 확인').length,0);
 assert.equal(h.input('메인 제목').props.value,entered.main);assert.equal(h.input('보조 제목 ·').props.value,entered.sub);assert.match(words(h.tree),/목업이 교체되어 이전 제목 후보와 검수 확인을 해제/);
});

test('create and cancellation are explicit and require read-back receipts, never auto-create on GET',async()=>{
 const h=harness();await h.open();assert.equal(h.requests.length,1);
 h.respond({id:sessionId,status:'queued'});h.respond(state({sessions:[session({status:'queued',snapshotHash:null,images:[]})]}));await h.click('PC에서 새 목업 준비');
 assert.deepEqual(h.requests[1].body,{action:'create'});assert.equal(h.button('PC에서 새 목업 준비').props.disabled,true);
 h.respond({cancelled:true,sessionId});h.respond(state({sessions:[session({status:'cancelled',snapshotHash:null,images:[]})]}));await h.click('이 준비 요청 취소');
 assert.deepEqual(h.requests[3].body,{action:'cancel',sessionId});assert.equal(h.activated,0);assert.equal(h.requests.length,5);assert.match(words(h.tree),/기존 완성본은 유지/);
});

test('WorkQueue adds one isolated portfolio editor and leaves the existing cover path intact',()=>{
 const queue=fs.readFileSync(path.resolve(import.meta.dirname,'WorkQueue.tsx'),'utf8');
 assert.equal((queue.match(/<ProductionMockupEditor\b/g)||[]).length,1);
 assert.match(queue,/item\.format === "portfolio"[\s\S]{0,140}<ProductionMockupEditor/);
 assert.match(queue,/currentAssets=\{item\.content_review_assets \|\| \[\]\} onActivated=\{load\}/);
 assert.match(queue,/set_cover_title/);
});

function describedReason(h,element){
 const id=element.props['aria-describedby'];assert.equal(typeof id,'string');
 const explanations=all(h.tree,node=>node.props?.id===id);assert.equal(explanations.length,1);
 return words(explanations[0]);
}

test('disabled editor and preparation buttons explain how they become available',async()=>{
 const locked=harness({disabled:true});assert.match(describedReason(locked,locked.button('목업·썸네일 편집')),/제작·업로드가 끝나면/);
 const h=harness();await h.open(state({sessions:[session({status:'queued',snapshotHash:null,images:[]})]}));
 assert.match(describedReason(h,h.button('PC에서 새 목업 준비')),/이 준비 요청 취소/);
 assert.match(describedReason(h,h.button('제목 미리보기 만들기')),/메인 제목을 입력/);
 h.change('메인 제목',entered.main);h.change('보조 제목 표시',true);
 assert.match(describedReason(h,h.button('제목 미리보기 만들기')),/보조 제목을 입력/);
 h.respond(state());h.button('상태 새로고침').props.onClick();h.render();
 for(const button of all(h.tree,node=>node.type==='button'&&node.props.disabled))assert.ok(describedReason(h,button).length>0);
 await h.flush();
});

test('five-image activation explains the remaining image count and then the inspection checkbox',async()=>{
 const h=harness();await h.open(state({sessions:[session()]}));
 assert.match(describedReason(h,h.button('확인한 목업 5장으로 교체')),/지금 0\/5 확인함/);
 for(let i=0;i<5;i++){
  all(h.tree,node=>node.type==='button'&&all(node,image=>image.type==='img'&&image.props.src===imageUrl(i)).length===1)[0].props.onClick();h.render();h.fullLoad();
  if(i===1)assert.match(describedReason(h,h.button('확인한 목업 5장으로 교체')),/지금 2\/5 확인함/);
 }
 assert.match(describedReason(h,h.button('확인한 목업 5장으로 교체')),/확인란을 선택해야/);
 h.change('새 후보 5장의',true);assert.equal(h.button('확인한 목업 5장으로 교체').props.disabled,false);
});

test('thumbnail activation explains candidate mismatch, full-size viewing and confirmation',async()=>{
 const h=harness();await makeTitleCandidate(h);
 assert.match(describedReason(h,h.button('제목 미리보기 만들기')),/같은 문구의 후보/);
 assert.match(describedReason(h,h.button('확인한 썸네일만 교체')),/제목 후보 열어 확인/);
 await h.click('제목 후보 열어 확인');h.fullLoad();
 assert.match(describedReason(h,h.button('확인한 썸네일만 교체')),/확인란을 선택해야/);
 h.change('메인 제목','다른 제목');assert.match(describedReason(h,h.button('확인한 썸네일만 교체')),/제목 미리보기 만들기/);
});

test('blocked swaps show a human reason and a next action; unusable candidates disclose no recovery',()=>{
 const h=harness();
 const cases=[
  ['IMAGE_SET_BODY_REQUIRED',/본문/,/상태 새로고침/],
  ['IMAGE_SET_BODY_MAPPING_REQUIRED',/그림 네 자리/,/같은 후보로 다시 교체/],
  ['IMAGE_SET_BODY_MAPPING_AMBIGUOUS',/교체 위치/,/주소를 각각 한 번씩/],
  ['IMAGE_SET_REVISION_CONFLICT',/저장하는 동안/,/상태 새로고침/],
  ['MOCKUP_SESSION_REVIEW_STALE',/검토 내용.*달라/,/5장을 다시 열어/],
  ['MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED',/원본 PPT·장표 선정/,/PC에서 새 목업 준비/],
  ['MOCKUP_IMAGE_INPUTS_CHANGED',/장표 선정이나 가림 설정.*수동으로 올린 이미지/,/PC에서 새 목업 준비/],
  ['MOCKUP_IMAGE_INPUTS_UNVERIFIABLE',/확인할 기록이 없습니다/,/PC에서 새 목업 준비/],
  ['MOCKUP_CURRENT_LAYOUT_PROOF_MISMATCH',/가림 확인 기록/,/가림을 다시 확인/],
  ['MOCKUP_PUBLISHED_LOCKED',/이미 발행된/,/담당자에게 요청/],
  ['IMAGE_SET_PUBLISHED_LOCKED',/이미 발행된/,/담당자에게 요청/],
  ['MOCKUP_SCHEMA_NOT_READY',/서버 준비/,/서버 준비를 요청/],
  ['MOCKUP_OPERATION_FAILED',/요청을 처리하지 못했습니다/,/상태 새로고침/],
 ];
 for(const [code,reason,action] of cases){const message=h.exports.productionMockupError(code);const lines=message.split('\n');assert.equal(lines.length,2,code);assert.match(lines[0],reason,code);assert.match(lines[1],action,code);assert.match(message,new RegExp(code));}
 for(const code of ['MOCKUP_SESSION_REVIEW_STALE','MOCKUP_SOURCE_OR_MANUSCRIPT_CHANGED','MOCKUP_IMAGE_INPUTS_CHANGED','MOCKUP_IMAGE_INPUTS_UNVERIFIABLE','MOCKUP_CURRENT_LAYOUT_PROOF_MISMATCH','MOCKUP_PUBLISHED_LOCKED','IMAGE_SET_PUBLISHED_LOCKED'])assert.match(h.exports.productionMockupError(code),/(되돌릴|복구할) 방법은? 없습니다/,code);
});

test('failed requests disclose that they cannot resume and direct staff to an available new-request button',async()=>{
 const h=harness();await h.open(state({sessions:[session({status:'failed',errorCode:'MOCKUP_IMAGE_INPUTS_CHANGED',images:[],snapshotHash:null})]}));
 assert.match(words(h.tree),/이 준비 요청을 다시 진행할 방법은 없습니다/);assert.doesNotMatch(words(h.tree),/‘이 준비 요청 취소’ 후/);
 assert.equal(h.button('PC에서 새 목업 준비').props.disabled,false);
});

test('activation rejection renders both reason and next action without replacing existing images',async()=>{
 const h=harness();await h.open(state({sessions:[session()]}));
 for(let i=0;i<5;i++){all(h.tree,node=>node.type==='button'&&all(node,image=>image.type==='img'&&image.props.src===imageUrl(i)).length===1)[0].props.onClick();h.render();h.fullLoad();}
 h.change('새 후보 5장의',true);h.respond({error:'IMAGE_SET_BODY_MAPPING_REQUIRED'},409);await h.click('확인한 목업 5장으로 교체');
 const alerts=all(h.tree,node=>node.props?.role==='alert');assert.equal(alerts.length,1);assert.match(words(alerts[0]),/그림 네 자리를 모두 찾지 못했습니다\.\n본문에/);assert.match(words(alerts[0]),/같은 후보로 다시 교체/);assert.match(alerts[0].props.className,/whitespace-pre-line/);assert.equal(h.activated,0);
 assert.equal(all(h.tree,node=>node.type==='img'&&node.props.src==='/existing-thumbnail.png').length,1);
});

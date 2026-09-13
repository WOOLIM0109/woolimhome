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
function harness(){
 const slots=[],requests=[],responses=[];
 let cursor=0,tree,activated=0;
 const hooks={useRef(initial){const index=cursor++;slots[index]??={current:initial};return slots[index];},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];}};
 const jsx=(type,props,key)=>({type,props:props??{},key});
 const exports={};
 const sandbox={exports,URL,console,fetch:async(url,options)=>{requests.push({url,...options,body:options.body?JSON.parse(options.body):null});const response=responses.shift();assert.ok(response,'Unexpected request: '+url);return {ok:response.status<400,status:response.status,json:async()=>response.body};},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};if(name==='@/lib/http/read-json')return {readJsonResponse:response=>response.json()};throw new Error('Unexpected client dependency: '+name);}};
 vm.runInNewContext(js,sandbox,{filename:'ProductionMockupEditor.js'});
 const props={workItemId:workId,title:'기존 게시글 제목',currentAssets:[{id:'legacy',asset_type:'thumbnail',public_url:'/existing-thumbnail.png'}],onActivated:async()=>{activated++;}};
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

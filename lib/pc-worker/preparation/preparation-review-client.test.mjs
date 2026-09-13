import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const script=(await readFile(new URL('./preparation-review-client.mjs',import.meta.url),'utf8')).replace('export function mountPreparationReview','function mountPreparationReview');
const buildId='11111111-1111-4111-8111-111111111111',workId='22222222-2222-4222-8222-222222222222';
const hash='a'.repeat(64),slideHash='b'.repeat(64),previewHash='c'.repeat(64),imageHash='d'.repeat(64);
const copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
class Node{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners=new Map();this.dataset={};this.style={};this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
 addEventListener(name,fn){const callbacks=this.listeners.get(name)??[];callbacks.push(fn);this.listeners.set(name,callbacks);}
 emit(name){for(const fn of this.listeners.get(name)??[])fn({preventDefault(){}});}
 showModal(){this.open=true;}close(){this.open=false;}
 querySelectorAll(selector){const match=n=>selector==='[data-preparation-control]'?n.dataset.preparationControl==='true':n.tagName===selector;return this.children.flatMap(child=>[...(match(child)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
async function fixture({evidence=true}={}){
 const ids=['preparation-status','preparation-source','preparation-source-choice','preparation-artwork','preparation-refresh','preparation-apply','preparation-next','preparation-image-dialog','preparation-image-scroll','preparation-image-label','preparation-image-close'];
 const nodes=new Map(ids.map(id=>[id,new Node()]));nodes.get('preparation-next').hidden=true;
 let view={version:1,workId,buildId,revision:4,sourceHash:hash,source:{width:612,height:859,aspect:'unknown',pageSizeVariant:'custom'},customPortrait:{allowed:true,reviewSlideNumber:1,currentChoice:false,reason:'흰색 여백만 허용'},slides:[1,2].map(n=>({sourceSlideNumber:n,slideContentHash:slideHash,previewHash,evidence:evidence?{imageHash,width:1710,height:2400}:null,artworkEligible:n===2,artworkReviewed:false,reasons:['PHOTO_DENSE']})),holds:['합성 보류'],localOnly:true};
 const calls=[];let error=null,pause=null;
 const context={URL,document:{querySelector:selector=>nodes.get(selector.slice(1)),querySelectorAll:selector=>[...nodes.values()].flatMap(node=>node.querySelectorAll(selector)),createElement:tag=>new Node(tag)},fetch:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,...options,body});if(pause)await pause;
  if(error&&options.method==='POST')return {ok:false,headers:{get:()=> 'application/json'},json:async()=>({error})};
  if(url.endsWith('/evidence')){view=copy(view);view.revision++;for(const n of body.slideNumbers)view.slides.find(s=>s.sourceSlideNumber===n).evidence={imageHash,width:1710,height:2400};}
  if(url.endsWith('/apply'))return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({applied:true,buildId:'33333333-3333-4333-8333-333333333333',launchUrl:'http://127.0.0.1:9001/launch/'+'e'.repeat(64)})};
  return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({csrfToken:'f'.repeat(64),review:copy(view)})};}};
 vm.runInNewContext(script,context);await settle();
 const section=kind=>nodes.get(kind==='source'?'preparation-source-choice':'preparation-artwork');
 return {calls,nodes,node:id=>nodes.get(id),section,update:change=>{view={...view,...change};},error:value=>{error=value;},pause:value=>{pause=value;},
  async click(id){nodes.get(id).emit('click');await settle();},async cardClick(kind){section(kind).querySelector('button').emit('click');await settle();},
  async reason(kind,text='실제 원본의 추상 그래픽과 비율을 확인함'){const input=section(kind).querySelector('textarea');input.value=text;input.emit('input');await settle();},
  async check(kind){const checkbox=section(kind).querySelector('input');checkbox.checked=true;checkbox.emit('change');await settle();},
  async load({bad=false,failed=false}={}){const image=nodes.get('preparation-image-scroll').querySelector('img');assert.ok(image);image.naturalWidth=bad?100:1710;image.naturalHeight=2400;image.emit(failed?'error':'load');await settle();}};
}

test('initial read and reason typing never generate evidence or approve anything',async()=>{
 const f=await fixture();assert.deepEqual(f.calls.map(c=>[c.url,c.method]),[['/api/preparation-review','GET']]);
 await f.reason('source');assert.equal(f.calls.length,1);assert.equal(f.node('preparation-apply').disabled,true);assert.equal(f.section('source').querySelector('input').disabled,true);
 assert.doesNotMatch(script,/setInterval|setTimeout|localStorage|sendBeacon|location\s*[.=]|window\.open/);
});
test('evidence is one explicit request, its new revision clears checks but preserves typed reasons',async()=>{
 const f=await fixture({evidence:false});await f.reason('source');let release;f.pause(new Promise(resolve=>{release=resolve;}));
 const pending=f.cardClick('source');await settle();assert.equal(f.calls.length,2);await f.cardClick('source');assert.equal(f.calls.length,2);release();await pending;
 assert.deepEqual(f.calls[1].body,{expectedCurrentBuild:{buildId,revision:4,sourceHash:hash},slideNumbers:[1]});assert.match(f.section('source').querySelector('textarea').value,/실제 원본/);assert.equal(f.section('source').querySelector('input').checked,false);
});
test('source-format confirmation binds actual image dimensions, hash, source and revision',async()=>{
 const f=await fixture();await f.reason('source');await f.cardClick('source');await f.load({bad:true});assert.equal(f.section('source').querySelector('input').disabled,true);
 await f.cardClick('source');await f.load();assert.equal(f.section('source').querySelector('input').disabled,false);await f.check('source');assert.equal(f.node('preparation-apply').disabled,false);
 await f.click('preparation-apply');const body=f.calls.at(-1).body;
 assert.deepEqual(body.expectedCurrentBuild,{buildId,revision:4,sourceHash:hash});assert.equal(body.sourceFormatChoice.kind,'custom_portrait_to_a4');assert.equal(body.sourceFormatChoice.previewHash,previewHash);assert.equal(body.sourceFormatChoice.imageHash,imageHash);assert.equal(body.sourceFormatChoice.inspectedAtActualSize,true);assert.deepEqual(body.artworkReviews,[]);
 assert.equal(f.node('preparation-next').hidden,false);assert.match(f.node('preparation-next').href,/^http:\/\/127\.0\.0\.1:9001\/launch\/[a-f0-9]{64}$/);assert.equal(f.node('preparation-apply').disabled,true);assert.doesNotMatch(JSON.stringify(body),/sourcePath|reviewedBy|actor|upload|stretch/);
});
test('artwork decisions are explicit per-slide and never approve source format implicitly',async()=>{
 const f=await fixture();await f.reason('art');await f.cardClick('art');await f.load();await f.check('art');await f.click('preparation-apply');
 const body=f.calls.at(-1).body;assert.equal(body.sourceFormatChoice,undefined);assert.equal(body.artworkReviews.length,1);assert.equal(body.artworkReviews[0].sourceSlideNumber,2);assert.equal(body.artworkReviews[0].classification,'abstract_graphic');
});
test('failed apply preserves local reason and does not retry; later revision change clears approval',async()=>{
 const f=await fixture();await f.reason('source');await f.cardClick('source');await f.load();await f.check('source');f.error('기준 상태가 바뀌었습니다.');await f.click('preparation-apply');
 assert.equal(f.calls.length,2);assert.match(f.section('source').querySelector('textarea').value,/실제 원본/);assert.equal(f.node('preparation-next').hidden,true);
 f.error(null);f.update({revision:5});await f.click('preparation-refresh');assert.equal(f.section('source').querySelector('input').checked,false);assert.equal(f.section('source').querySelector('input').disabled,true);assert.equal(f.node('preparation-apply').disabled,true);assert.match(f.section('source').querySelector('textarea').value,/실제 원본/);
});
test('editing the reason after inspection clears its checkbox without a network request',async()=>{
 const f=await fixture();await f.reason('source');await f.cardClick('source');await f.load();await f.check('source');assert.equal(f.node('preparation-apply').disabled,false);
 await f.reason('source','다시 정리한 원본 비율과 흰색 패딩 검토 사유');assert.equal(f.section('source').querySelector('input').checked,false);assert.equal(f.node('preparation-apply').disabled,true);assert.equal(f.calls.length,1);
});

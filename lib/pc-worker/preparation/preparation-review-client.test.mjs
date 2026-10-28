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
 set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.text='';this.children=items;}
 addEventListener(name,fn){const callbacks=this.listeners.get(name)??[];callbacks.push(fn);this.listeners.set(name,callbacks);}
 emit(name){for(const fn of this.listeners.get(name)??[])fn({preventDefault(){}});}
 showModal(){this.open=true;}close(){this.open=false;}
 querySelectorAll(selector){const match=n=>selector==='[data-preparation-control]'?n.dataset.preparationControl==='true':n.tagName===selector;return this.children.flatMap(child=>[...(match(child)?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}

async function fixture({evidence=true,count=2,artworkNumbers=[2],reviewedNumbers=[],preparedNumbers=[],sourceAllowed=true,sourceNumber=1,currentChoice=false}={}){
 const ids=['preparation-status','preparation-source','preparation-source-choice','preparation-artwork','preparation-refresh','preparation-evidence','preparation-apply','preparation-apply-summary','preparation-next','preparation-image-dialog','preparation-image-scroll','preparation-image-label','preparation-image-close'];
 const nodes=new Map(ids.map(id=>[id,new Node()]));nodes.get('preparation-next').hidden=true;
 let view={version:1,workId,buildId,revision:4,sourceHash:hash,source:{width:612,height:859,aspect:'unknown',pageSizeVariant:'custom'},customPortrait:{allowed:sourceAllowed,reviewSlideNumber:sourceNumber,currentChoice,reason:'흰색 여백만 허용'},slides:Array.from({length:count},(_,i)=>({sourceSlideNumber:i+1,slideContentHash:slideHash,previewHash,evidence:evidence||preparedNumbers.includes(i+1)?{imageHash,width:1710,height:2400}:null,artworkEligible:artworkNumbers.includes(i+1),artworkReviewed:reviewedNumbers.includes(i+1),reasons:['PHOTO_DENSE']})),holds:['합성 보류'],localOnly:true};
 const calls=[],revisionChanges=[];let error=null,pause=null;
 const context={URL,document:{querySelector:selector=>nodes.get(selector.slice(1)),querySelectorAll:selector=>[...nodes.values()].flatMap(node=>node.querySelectorAll(selector)),createElement:tag=>new Node(tag)},fetch:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,...options,body});if(pause)await pause;
  if(error&&options.method==='POST')return {ok:false,headers:{get:()=> 'application/json'},json:async()=>({error})};
  if(url.endsWith('/evidence')){
   assert.ok(body.slideNumbers.length<=8,'HTTP evidence limit is eight slides');
   assert.deepEqual(body.expectedCurrentBuild,{buildId:view.buildId,revision:view.revision,sourceHash:view.sourceHash});
   const before=view.revision;view=copy(view);
   for(const n of body.slideNumbers){const slide=view.slides.find(s=>s.sourceSlideNumber===n);if(!slide.evidence){slide.evidence={imageHash,width:1710,height:2400};view.revision+=2;}}
   // Artifact writes may increment the numeric counter more than once. The UI
   // observes the resulting revision only once, in this batch response.
   if(view.revision!==before)revisionChanges.push({before,after:view.revision});
  }
  if(url.endsWith('/apply'))return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({applied:true,buildId:'33333333-3333-4333-8333-333333333333',launchUrl:'http://127.0.0.1:9001/launch/'+'e'.repeat(64)})};
  return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({csrfToken:'f'.repeat(64),review:copy(view)})};}};
 vm.runInNewContext(script,context);await settle();
 const section=kind=>nodes.get(kind==='source'?'preparation-source-choice':'preparation-artwork');
 const card=(kind,number=2)=>section(kind).querySelectorAll('article').find(node=>kind==='source'||node.querySelector('h3').textContent===`${number}번 분류 확인`);
 const checkbox=(kind,number)=>card(kind,number).querySelector('input');
 return {calls,revisionChanges,nodes,node:id=>nodes.get(id),section,card,checkbox,view:()=>copy(view),update:change=>{view={...view,...change};},error:value=>{error=value;},pause:value=>{pause=value;},
  async click(id){nodes.get(id).emit('click');await settle();},async cardClick(kind,number){card(kind,number).querySelector('button').emit('click');await settle();},
  async reason(kind,text='실제 원본의 추상 그래픽과 비율을 확인함',number){const input=card(kind,number).querySelector('textarea');input.value=text;input.emit('input');await settle();},
  async check(kind,number){const input=checkbox(kind,number);assert.equal(input.disabled,false,'a user can only check an enabled checkbox');input.checked=true;input.emit('change');await settle();},
  image:()=>nodes.get('preparation-image-scroll').querySelector('img'),
  async load({bad=false,failed=false,image=nodes.get('preparation-image-scroll').querySelector('img')}={}){assert.ok(image);image.naturalWidth=bad?100:1710;image.naturalHeight=2400;image.emit(failed?'error':'load');await settle();}};
}

async function confirm(f,kind,number){await f.cardClick(kind,number);await f.load();await f.reason(kind,undefined,number);await f.check(kind,number);}
const threeSlides={count:3,artworkNumbers:[1,2,3],sourceAllowed:false};
const evidenceCalls=f=>f.calls.filter(call=>call.url.endsWith('/evidence'));

test('initial read and reason typing never generate evidence or approve anything',async()=>{
 const f=await fixture();assert.deepEqual(f.calls.map(c=>[c.url,c.method]),[['/api/preparation-review','GET']]);
 await f.reason('source');assert.equal(f.calls.length,1);assert.equal(f.node('preparation-apply').disabled,true);assert.equal(f.checkbox('source').disabled,true);
 assert.doesNotMatch(script,/setInterval|setTimeout|localStorage|sendBeacon|location\s*[.=]|window\.open/);
});

test('one explicit batch prepares three evidence images with one response revision change',async()=>{
 const f=await fixture({...threeSlides,evidence:false});await f.click('preparation-evidence');
 assert.equal(evidenceCalls(f).length,1);assert.deepEqual(evidenceCalls(f)[0].body,{expectedCurrentBuild:{buildId,revision:4,sourceHash:hash},slideNumbers:[1,2,3]});
 assert.equal(f.revisionChanges.length,1);assert.ok(f.view().slides.every(slide=>slide.evidence));assert.equal(f.node('preparation-evidence').disabled,true);
 await f.click('preparation-evidence');assert.equal(evidenceCalls(f).length,1);
});

test('all three checks survive successive actual-size inspections, reason edits and an unchanged refresh',async()=>{
 const f=await fixture({...threeSlides,evidence:false});await f.click('preparation-evidence');
 for(const number of [1,2,3]){await confirm(f,'art',number);for(let previous=1;previous<=number;previous++)assert.equal(f.checkbox('art',previous).checked,true);}
 await f.reason('art','더 자세하게 다시 기록한 직접 확인 근거입니다',1);
 await f.click('preparation-refresh');for(const number of [1,2,3])assert.equal(f.checkbox('art',number).checked,true);
 assert.equal(evidenceCalls(f).length,1);assert.equal(f.revisionChanges.length,1);assert.equal(f.node('preparation-apply').disabled,false);assert.match(f.node('preparation-apply-summary').textContent,/3장 적용/);
 await f.click('preparation-apply');const body=f.calls.at(-1).body;
 assert.deepEqual(body.artworkReviews.map(item=>item.sourceSlideNumber),[1,2,3]);assert.equal(body.expectedCurrentBuild.revision,f.view().revision);assert.equal(body.sourceFormatChoice,undefined);
});

test('batch includes custom portrait, deduplicates overlapping artwork and skips prepared or reviewed slides',async()=>{
 const f=await fixture({evidence:false,count:5,artworkNumbers:[1,2,3,4],reviewedNumbers:[3],preparedNumbers:[4]});
 await f.click('preparation-evidence');assert.deepEqual(evidenceCalls(f)[0].body.slideNumbers,[1,2]);assert.equal(f.revisionChanges.length,1);
 assert.equal(f.view().slides.find(slide=>slide.sourceSlideNumber===3).evidence,null);assert.equal(f.view().slides.find(slide=>slide.sourceSlideNumber===5).evidence,null);
 assert.ok(f.card('source').querySelector('button'));assert.ok(f.card('art',2).querySelector('button'));
 const separate=await fixture({evidence:false});await separate.click('preparation-evidence');
 assert.deepEqual([...evidenceCalls(separate)[0].body.slideNumbers].sort((a,b)=>a-b),[1,2]);
 assert.equal(evidenceCalls(separate)[0].method,'POST');assert.equal(evidenceCalls(separate)[0].credentials,'same-origin');assert.equal(evidenceCalls(separate)[0].headers['X-Woolim-CSRF'],'f'.repeat(64));
});

test('completed or excluded review targets show an empty-state explanation and make no evidence request',async()=>{
 const f=await fixture({evidence:false,currentChoice:true,reviewedNumbers:[2]});
 assert.equal(f.node('preparation-evidence').disabled,true);assert.equal(f.node('preparation-apply').disabled,true);assert.match(f.node('preparation-apply-summary').textContent,/현재 적용할 검수 대상 장표가 없습니다/);
 await f.click('preparation-evidence');assert.equal(evidenceCalls(f).length,0);
});

test('more than eight pending slides use sequential bounded batches and the latest returned build',async()=>{
 const f=await fixture({evidence:false,count:18,artworkNumbers:Array.from({length:18},(_,i)=>i+1),sourceAllowed:false});
 await f.click('preparation-evidence');const calls=evidenceCalls(f);
 assert.deepEqual(calls.map(call=>call.body.slideNumbers),[[1,2,3,4,5,6,7,8],[9,10,11,12,13,14,15,16],[17,18]]);
 assert.equal(f.revisionChanges.length,3);assert.equal(calls[0].body.expectedCurrentBuild.revision,4);
 assert.equal(calls[1].body.expectedCurrentBuild.revision,f.revisionChanges[0].after);assert.equal(calls[2].body.expectedCurrentBuild.revision,f.revisionChanges[1].after);
 assert.ok(f.view().slides.every(slide=>slide.evidence));
});

test('pending preparation blocks duplicate batch and individual actions without losing typed reasons',async()=>{
 const f=await fixture({...threeSlides,evidence:false});await f.reason('art',undefined,1);
 let release;f.pause(new Promise(resolve=>{release=resolve;}));const pending=f.click('preparation-evidence');await settle();
 assert.equal(f.node('preparation-evidence').disabled,true);await f.click('preparation-evidence');await f.cardClick('art',2);assert.equal(evidenceCalls(f).length,1);
 release();await pending;assert.match(f.card('art',1).querySelector('textarea').value,/실제 원본/);assert.equal(f.checkbox('art',1).checked,false);
});

test('individual evidence preparation remains explicit and keeps the current build contract',async()=>{
 const f=await fixture({evidence:false});await f.reason('source');await f.cardClick('source');
 assert.deepEqual(evidenceCalls(f)[0].body,{expectedCurrentBuild:{buildId,revision:4,sourceHash:hash},slideNumbers:[1]});assert.match(f.card('source').querySelector('textarea').value,/실제 원본/);assert.equal(f.checkbox('source').checked,false);
 await f.cardClick('source');await f.load();assert.equal(evidenceCalls(f).length,1);assert.equal(f.checkbox('source').disabled,false);
});

test('successful evidence preparation adopts the new revision and preserves every typed reason',async()=>{
 const f=await fixture({...threeSlides,evidence:false}),before=f.view().revision;
 for(const number of [1,2,3])await f.reason('art',`직접 확인할 근거를 미리 입력함 ${number}`,number);
 await f.click('preparation-evidence');assert.ok(f.view().revision>before);
 for(const number of [1,2,3]){
  assert.equal(f.card('art',number).querySelector('textarea').value,`직접 확인할 근거를 미리 입력함 ${number}`);
  assert.equal(f.checkbox('art',number).checked,false);
 }
});

test('evidence failure shows its sanitized internal code and retains reasons without retrying',async()=>{
 for(const code of ['POWERPOINT_PREPARATION_FAILED','POWERPOINT_BUSY','PREPARATION_ENVIRONMENT_CHANGED_NEW_BUILD_REQUIRED','PREPARATION_EVIDENCE_PATH_TOO_LONG']){
  const f=await fixture({evidence:false});await f.reason('source','입력한 검수 근거를 실패 후에도 유지함');
  f.error(`[${code}] 원본 증거를 준비하지 못했습니다.`);await f.click('preparation-evidence');
  assert.ok(f.node('preparation-status').textContent.includes(code));
  assert.doesNotMatch(f.node('preparation-status').textContent,/C:\\|\.pptx|source-copy|attempt-/i);
  assert.equal(f.card('source').querySelector('textarea').value,'입력한 검수 근거를 실패 후에도 유지함');
  assert.equal(evidenceCalls(f).length,1);
 }
});

test('checkbox requires ten trimmed characters and shows the current reason length',async()=>{
 const f=await fixture();await f.cardClick('source');await f.load();assert.equal(f.checkbox('source').disabled,true);
 await f.reason('source','1234');assert.equal(f.checkbox('source').disabled,true);assert.match(f.card('source').textContent,/근거 4자.*10자 이상 필요/);
 await f.reason('source',' 123456789 ');assert.equal(f.checkbox('source').disabled,true);
 await f.reason('source',' 1234567890 ');assert.equal(f.checkbox('source').disabled,false);assert.match(f.card('source').textContent,/근거 10자/);assert.equal(f.checkbox('source').checked,false);
});

test('editing a checked reason keeps it at ten characters and clears it only below ten',async()=>{
 const f=await fixture();await confirm(f,'source');await f.reason('source','1234567890');
 assert.equal(f.checkbox('source').checked,true);assert.equal(f.node('preparation-apply').disabled,false);
 await f.reason('source','123456789');assert.equal(f.checkbox('source').checked,false);assert.equal(f.checkbox('source').disabled,true);assert.equal(f.node('preparation-apply').disabled,true);
 await f.reason('source','1234567890');assert.equal(f.checkbox('source').disabled,false);assert.equal(f.checkbox('source').checked,false);assert.equal(f.calls.length,1);
});

test('image error revokes only its slide and leaves other checks and image inspections valid',async()=>{
 const f=await fixture(threeSlides);for(const n of [1,2,3])await confirm(f,'art',n);
 await f.cardClick('art',2);await f.load({failed:true});
 assert.equal(f.checkbox('art',1).checked,true);assert.equal(f.checkbox('art',3).checked,true);assert.equal(f.checkbox('art',2).checked,false);assert.equal(f.checkbox('art',2).disabled,true);
 assert.equal(f.checkbox('art',1).disabled,false);assert.equal(f.checkbox('art',3).disabled,false);assert.match(f.node('preparation-apply-summary').textContent,/2장 적용/);
 await f.click('preparation-apply');assert.deepEqual(f.calls.at(-1).body.artworkReviews.map(item=>item.sourceSlideNumber),[1,3]);
});

test('an image error clears both cards only when they refer to the same source slide',async()=>{
 const f=await fixture({artworkNumbers:[1,2]});await confirm(f,'source');await confirm(f,'art',1);await confirm(f,'art',2);
 await f.cardClick('art',1);await f.load({failed:true});
 assert.equal(f.checkbox('source').checked,false);assert.equal(f.checkbox('art',1).checked,false);assert.equal(f.checkbox('art',2).checked,true);
});

test('disabled apply explains missing original, reason and checkbox counts using current eligibility',async()=>{
 const f=await fixture(threeSlides);const summary=()=>f.node('preparation-apply-summary').textContent;
 assert.match(summary(),/확인 완료 0장/);assert.match(summary(),/원본 미확인 3장/);assert.match(summary(),/근거 부족 3장/);
 await f.cardClick('art',1);await f.load();await f.reason('art',undefined,1);
 assert.equal(f.node('preparation-apply').disabled,true);assert.match(summary(),/원본 미확인 2장/);assert.match(summary(),/근거 부족 2장/);assert.match(summary(),/체크 미완료 3장/);
 for(const n of [2,3]){await f.cardClick('art',n);await f.load();await f.reason('art',undefined,n);}
 assert.equal(f.node('preparation-apply').disabled,true);assert.match(summary(),/원본 미확인 0장/);assert.match(summary(),/근거 부족 0장/);assert.match(summary(),/체크 미완료 3장/);
 await f.check('art',1);assert.equal(f.node('preparation-apply').disabled,false);assert.match(summary(),/1장 적용/);
});

test('a shared source/artwork slide is counted once when both decisions are applicable',async()=>{
 const f=await fixture({artworkNumbers:[1]});await confirm(f,'source');await confirm(f,'art',1);
 assert.match(f.node('preparation-apply-summary').textContent,/1장 적용/);await f.click('preparation-apply');
 assert.ok(f.calls.at(-1).body.sourceFormatChoice);assert.equal(f.calls.at(-1).body.artworkReviews.length,1);
});

test('source-format confirmation still binds actual dimensions, hashes and current build',async()=>{
 const f=await fixture();await f.reason('source');await f.cardClick('source');await f.load({bad:true});assert.equal(f.checkbox('source').disabled,true);
 await f.cardClick('source');await f.load();assert.equal(f.checkbox('source').disabled,false);await f.check('source');await f.click('preparation-apply');const body=f.calls.at(-1).body;
 assert.deepEqual(body.expectedCurrentBuild,{buildId,revision:4,sourceHash:hash});assert.equal(body.sourceFormatChoice.kind,'custom_portrait_to_a4');assert.equal(body.sourceFormatChoice.previewHash,previewHash);assert.equal(body.sourceFormatChoice.imageHash,imageHash);assert.equal(body.sourceFormatChoice.inspectedAtActualSize,true);assert.deepEqual(body.artworkReviews,[]);
 assert.equal(f.node('preparation-next').hidden,false);assert.match(f.node('preparation-next').href,/^http:\/\/127\.0\.0\.1:9001\/launch\/[a-f0-9]{64}$/);assert.equal(f.node('preparation-apply').disabled,true);assert.doesNotMatch(JSON.stringify(body),/sourcePath|reviewedBy|actor|upload|stretch/);
});

test('a missing preview or evidence never becomes eligible despite a valid reason and checkbox event',async()=>{
 for(const missing of ['previewHash','evidence']){
  const f=await fixture();await f.reason('source');await f.cardClick('source');await f.load();
  const slides=f.view().slides;slides[0][missing]=null;f.update({slides});await f.click('preparation-refresh');
  const checkbox=f.checkbox('source');assert.equal(checkbox.disabled,true);checkbox.checked=true;checkbox.emit('change');await settle();
  assert.equal(f.node('preparation-apply').disabled,true);assert.match(f.node('preparation-apply-summary').textContent,/원본 미확인 2장/);
 }
});

test('failed apply keeps the local reason and does not retry or reveal a new review link',async()=>{
 const f=await fixture();await confirm(f,'source');f.error('기준 상태가 바뀌었습니다.');await f.click('preparation-apply');
 assert.equal(f.calls.length,2);assert.match(f.card('source').querySelector('textarea').value,/실제 원본/);assert.equal(f.node('preparation-next').hidden,true);assert.match(f.node('preparation-status').textContent,/기준 상태가 바뀌었습니다/);
});

test('a real revision change resets every check and inspection, closes the modal and ignores stale image events',async()=>{
 const f=await fixture(threeSlides);for(const n of [1,2,3])await confirm(f,'art',n);
 await f.cardClick('art',2);const staleImage=f.image();assert.equal(f.node('preparation-image-dialog').open,true);
 f.update({revision:f.view().revision+1});await f.click('preparation-refresh');
 for(const n of [1,2,3]){assert.equal(f.checkbox('art',n).checked,false);assert.equal(f.checkbox('art',n).disabled,true);assert.match(f.card('art',n).querySelector('textarea').value,/실제 원본/);}
 assert.equal(f.node('preparation-image-dialog').open,false);assert.equal(f.image(),null);assert.equal(f.node('preparation-apply').disabled,true);assert.match(f.node('preparation-apply-summary').textContent,/원본 미확인 3장/);
 await f.load({image:staleImage});await f.load({image:staleImage,failed:true});for(const n of [1,2,3])assert.equal(f.checkbox('art',n).disabled,true);
 await f.cardClick('art',1);await f.load();assert.equal(f.checkbox('art',1).disabled,false);assert.equal(f.checkbox('art',1).checked,false);assert.equal(f.checkbox('art',2).disabled,true);
});

test('source replacement resets every check even if its revision number stays the same',async()=>{
 const f=await fixture({count:3,artworkNumbers:[2,3]});await confirm(f,'source');for(const n of [2,3])await confirm(f,'art',n);
 f.update({sourceHash:'e'.repeat(64)});await f.click('preparation-refresh');
 assert.equal(f.checkbox('source').checked,false);assert.equal(f.checkbox('source').disabled,true);
 for(const n of [2,3]){assert.equal(f.checkbox('art',n).checked,false);assert.equal(f.checkbox('art',n).disabled,true);}
 assert.equal(f.node('preparation-apply').disabled,true);
});

test('a superseded image error cannot clear a different slide or re-enable an uninspected image',async()=>{
 const f=await fixture(threeSlides);await confirm(f,'art',1);await f.cardClick('art',1);const old=f.image();
 await f.cardClick('art',2);await f.load({image:old,failed:true});assert.equal(f.checkbox('art',1).checked,true);assert.equal(f.checkbox('art',2).disabled,true);
 await f.load();await f.reason('art',undefined,2);await f.check('art',2);assert.equal(f.checkbox('art',1).checked,true);assert.equal(f.checkbox('art',2).checked,true);
});

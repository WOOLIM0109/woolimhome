import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createMockupFixture} from './mockup-fixture.mjs';
import {openPreparationWorkStore} from './work-store.ts';
import {getLocalRedactionSlide,saveLocalRedactionSlide} from './redaction-service.ts';
import {getLocalMockupReview,initializeLocalMockups,saveLocalMockupAssignments,renderLocalMockups,readLocalMockupImage,requestLocalMockupSlide} from './mockup-service.ts';
import {redactionHash} from './redaction-renderer.ts';
const assignments=r=>r.boards.map(b=>({templateId:b.templateId,slots:b.slots.map(({slotId,sourceSlideNumber})=>({slotId,sourceSlideNumber}))}));
async function fixture(t,options) {const f=await createMockupFixture(options);t.after(f.cleanup);return f;}

test('GET is read-only; approved receipts initialize fixed slots and no unapproved/raw image is substituted',async t=>{
  const f=await fixture(t,{approveCount:7});const before=await readFile(path.join(f.root,'builds',f.buildId,'record.json'));
  let r=await getLocalMockupReview(f);assert.equal(r.state,null);assert.deepEqual(await readFile(path.join(f.root,'builds',f.buildId,'record.json')),before);
  r=await initializeLocalMockups({...f,title:'실제 사용자가 입력한 작업물명'});assert.equal(r.boards.length,5);assert.ok(r.boards.some(b=>b.holds.some(h=>h.startsWith('EMPTY_SLOT'))));
  assert.ok(r.boards.flatMap(b=>b.slots).every(s=>s.sourceSlideNumber===null||s.sourceSlideNumber<=7));
  assert.equal(r.candidates.find(c=>c.sourceSlideNumber===8).status,'needs_redaction');
  assert.equal(r.candidates.at(-1).status,'needs_preparation');
  await assert.rejects(renderLocalMockups({...f,expectedRevision:r.revision,scale:.5}),/ASSIGNMENT_HELD/);
  assert.equal(r.visualReview,'not_performed');assert.equal(r.activeSetUnchanged,true);
});
test('saved assignments reject wrong slots/work indexes, report duplicates and queue only explicit local preparation requests',async t=>{
  const f=await fixture(t);let r=await initializeLocalMockups({...f,title:'합성 목업'});const boards=assignments(r);
  await assert.rejects(saveLocalMockupAssignments({...f,expectedRevision:r.revision,title:r.title,boards:[{...boards[0],templateId:'arbitrary'},...boards.slice(1)]}),/INVALID_ASSIGNMENT/);
  const invalid=structuredClone(boards);invalid[0].slots[0].sourceSlideNumber=999;
  await assert.rejects(saveLocalMockupAssignments({...f,expectedRevision:r.revision,title:r.title,boards:invalid}),/INVALID_ASSIGNMENT/);
  boards[0].slots[1].sourceSlideNumber=boards[0].slots[0].sourceSlideNumber;
  r=await saveLocalMockupAssignments({...f,expectedRevision:r.revision,title:r.title,boards});assert.match(r.boards[0].holds.join(),/DUPLICATE/);
  await assert.rejects(renderLocalMockups({...f,expectedRevision:r.revision,scale:.5}),/ASSIGNMENT_HELD/);
  r=await requestLocalMockupSlide({...f,expectedRevision:r.revision,sourceSlideNumber:11,reason:'새 후보 준비 요청'});
  assert.equal(r.requests.length,1);assert.equal(r.requests[0].status,'pending');
  const same=await requestLocalMockupSlide({...f,expectedRevision:r.revision,sourceSlideNumber:11,reason:'새 후보 준비 요청'});assert.equal(same.revision,r.revision);
  const store=await openPreparationWorkStore({root:f.root});assert.equal((await store.readWork()).activeSetRef.setId,'existing-live-set-synthetic');await store.release();
});
test('draft/final use one receipt-bound assignment; changed board only rerenders; cached work survives restart',async t=>{
  const f=await fixture(t);const previousFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=previousFetch);
  let r=await initializeLocalMockups({...f,title:'합성 목업 검수'});
  await assert.rejects(renderLocalMockups({...f,expectedRevision:r.revision,scale:1}),/DRAFT_REQUIRED/);
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5});assert.ok(r.boards.every(b=>b.draft));
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:1});assert.ok(r.boards.every(b=>b.final));
  for(const b of r.boards) {assert.equal(b.final.width,b.draft.width*2);assert.equal(b.final.height,b.draft.height*2);assert.equal(b.final.inputFingerprint,b.draft.inputFingerprint);}
  const before=structuredClone(r),cached=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5});assert.equal(cached.revision,r.revision);
  assert.deepEqual((await getLocalMockupReview(f)).boards,r.boards);
  const boards=assignments(r),used=new Set(boards[3].slots.map(s=>s.sourceSlideNumber));
  boards[3].slots[0].sourceSlideNumber=r.candidates.find(c=>c.status==='approved'&&!used.has(c.sourceSlideNumber)).sourceSlideNumber;
  r=await saveLocalMockupAssignments({...f,expectedRevision:r.revision,title:r.title,boards});assert.equal(r.boards[3].draft,null);assert.equal(r.boards[3].final,null);
  assert.ok(r.boards.filter((_,i)=>i!==3).every((b)=>b.final));
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5});r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:1});
  assert.notEqual(r.boards[3].final.sha256,before.boards[3].final.sha256);
  r.boards.forEach((b,i)=>{if(i!==3)assert.deepEqual(b.final,before.boards[i].final);});
  assert.equal(redactionHash(await readLocalMockupImage({...f,templateId:r.boards[0].templateId,scale:1})),r.boards[0].final.sha256);
  assert.notEqual(redactionHash(await readLocalMockupImage({...f,templateId:r.boards[0].templateId,scale:1,debug:true})),r.boards[0].final.sha256);
  const oldRevision=r.revision; r=await saveLocalMockupAssignments({...f,expectedRevision:r.revision,title:'새 작업물명',boards:assignments(r)});
  assert.equal(r.boards[0].final,null);assert.ok(r.boards.slice(1).every(b=>b.final));
  await assert.rejects(saveLocalMockupAssignments({...f,expectedRevision:oldRevision,title:r.title,boards:assignments(r)}),/REVISION_CONFLICT/);
});
test('changing one redaction invalidates every dependent board and old downloads, but not unrelated boards',async t=>{
  const f=await fixture(t);let r=await initializeLocalMockups({...f,title:'합성 변경 검수'});
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5});const n=r.boards[3].slots[0].sourceSlideNumber;
  const affected=r.boards.filter(b=>b.slots.some(s=>s.sourceSlideNumber===n)).map(b=>b.templateId);
  const s=await getLocalRedactionSlide({...f,sourceSlideNumber:n});
  await saveLocalRedactionSlide({...f,sourceSlideNumber:n,expectedRevision:s.revision,regions:[...s.regions,{id:'new-mask',mode:'opaque',rect:{x:.1,y:.4,width:.1,height:.1}}],exceptions:s.exceptions,review:s.review});
  r=await getLocalMockupReview(f);
  for(const b of r.boards) {
    if(affected.includes(b.templateId)) {assert.equal(b.draft,null);assert.match(b.holds.join(),/NOT_APPROVED/);await assert.rejects(readLocalMockupImage({...f,templateId:b.templateId,scale:.5}),/ASSIGNMENT_STALE/);}
    else assert.ok(b.draft);
  }
});
test('corrupt rendered artifacts are unavailable and only explicit rerender repairs the derived file',async t=>{
  const f=await fixture(t);let r=await initializeLocalMockups({...f,title:'합성 캐시 검사'});
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5,templateIds:[r.boards[3].templateId]});
  const board=r.boards[3],store=await openPreparationWorkStore({root:f.root});const b=await store.readBuild(f.buildId);await store.release();
  await writeFile(path.join(f.root,'builds',f.buildId,'artifacts',b.artifacts[board.draft.artifactKey].relativePath),'CORRUPT');
  assert.equal((await getLocalMockupReview(f)).boards[3].draft,null);
  await assert.rejects(readLocalMockupImage({...f,templateId:board.templateId,scale:.5}),/IMAGE_NOT_CURRENT/);
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5,templateIds:[board.templateId]});assert.ok(r.boards[3].draft);
});
test('designated unapproved cover stays empty even when enough other approved slides exist',async t=>{
  const f=await fixture(t);const s=await getLocalRedactionSlide({...f,sourceSlideNumber:1});
  await saveLocalRedactionSlide({...f,sourceSlideNumber:1,expectedRevision:s.revision,regions:s.regions,exceptions:s.exceptions,review:{...s.review,originalInspected:false}});
  let r=await initializeLocalMockups({...f,title:'표지는 임의 대체 금지'});
  assert.equal(r.boards[0].slots[0].sourceSlideNumber,null);assert.match(r.boards[0].holds.join(),/EMPTY_SLOT/);
  const boards=assignments(r);const used=new Set(boards[0].slots.map(s=>s.sourceSlideNumber));
  boards[0].slots[0].sourceSlideNumber=r.candidates.find(c=>c.status==='approved'&&!used.has(c.sourceSlideNumber)).sourceSlideNumber;
  r=await saveLocalMockupAssignments({...f,expectedRevision:r.revision,title:r.title,boards});assert.equal(r.boards[0].holds.length,0);
});
test('mid-render failure checkpoints completed boards, releases lock, and explicit retry reuses them',async t=>{
  const f=await fixture(t);let r=await initializeLocalMockups({...f,title:'부분 실패 재개 검사'});
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5});
  const store=await openPreparationWorkStore({root:f.root}),build=await store.readBuild(f.buildId);await store.release();
  await writeFile(path.join(f.root,'builds',f.buildId,'artifacts',build.artifacts[r.boards[1].draft.artifactKey].relativePath),'CORRUPT');
  await assert.rejects(renderLocalMockups({...f,expectedRevision:r.revision,scale:1}),/DRAFT_REQUIRED/);
  r=await getLocalMockupReview(f);assert.ok(r.boards[0].final);assert.ok(r.boards.slice(1).every(b=>b.final===null));
  const completed=structuredClone(r.boards[0].final);
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:.5,templateIds:[r.boards[1].templateId]});
  r=await renderLocalMockups({...f,expectedRevision:r.revision,scale:1});assert.deepEqual(r.boards[0].final,completed);
  assert.ok(r.boards.every(b=>b.final));
});

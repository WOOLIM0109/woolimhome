import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createMockupFixture} from './mockup-fixture.mjs';
import {openPreparationWorkStore} from './work-store.ts';
import {redactionHash} from './redaction-renderer.ts';
import {getLocalRedactionSlide,saveLocalRedactionSlide} from './redaction-service.ts';
import {getLocalMockupReview,initializeLocalMockups,renderLocalMockups,saveLocalMockupAssignments,
  getLocalMockupTitleReview,saveLocalMockupTitle,renderLocalMockupTitle,confirmLocalMockupTitle,
  readLocalMockupTitleImage,withVerifiedLocalMockupSet} from './mockup-service.ts';

const title={main:'행사 대행 제안서',sub:'합성 작업물',showSub:true,style:'bold'};
const args=(f,r)=>({...f,expectedRevision:r.revision,expectedBaseFingerprint:r.baseFingerprint});
const assignments=r=>r.boards.map(b=>({templateId:b.templateId,slots:b.slots.map(({slotId,sourceSlideNumber})=>({slotId,sourceSlideNumber}))}));
async function fixture(t,options) {
  const f=await createMockupFixture(options);t.after(f.cleanup);
  const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=original);
  return f;
}
async function record(f) {return readFile(path.join(f.root,'builds',f.buildId,'record.json'));}
async function artifact(f,key) {
  const store=await openPreparationWorkStore({root:f.root});
  try {const a=await store.getReusableArtifact(f.buildId,key);assert.ok(a);return {...a,bytes:await readFile(a.absolutePath)};}
  finally {await store.release();}
}
async function baseline(f) {
  const r=await getLocalMockupReview(f),data=JSON.parse(await record(f));
  return {legacy:(await artifact(f,'mockup-state')).bytes,boards:r.boards,stages:data.stages,
    originals:Object.fromEntries(Object.entries(data.artifacts).filter(([key])=>!key.startsWith('mockup-title'))),
    work:await readFile(path.join(f.root,'work.json'))};
}
async function assertBaseline(f,before) {
  const now=await baseline(f);assert.deepEqual(now,before);
}
async function start(f) {
  await initializeLocalMockups({...f,title:'기존 원고와 별개인 레거시 목업 제목'});
  const r=await getLocalMockupTitleReview(f);
  return saveLocalMockupTitle({...args(f,r),title});
}
async function finish(f,r) {
  r=await renderLocalMockupTitle({...args(f,r),scale:.5});
  return renderLocalMockupTitle({...args(f,r),scale:1});
}
async function confirm(f,r) {
  return confirmLocalMockupTitle({...args(f,r),expectedFinalHash:r.final.sha256,visualConfirmed:true});
}

test('title GET leaves uninitialized legacy work and its record byte-identical',async t=>{
  const f=await fixture(t),before=await record(f),work=await readFile(path.join(f.root,'work.json'));
  const r=await getLocalMockupTitleReview(f);
  assert.equal(r.available,false);assert.equal(r.revision,null);assert.equal(r.baseFingerprint,null);
  assert.deepEqual(r.title,{main:'',sub:'',showSub:false,style:'bold'});
  assert.deepEqual(await record(f),before);assert.deepEqual(await readFile(path.join(f.root,'work.json')),work);
});

for(const aspect of ['16:9','a4_landscape','a4_portrait']) {
  test(`${aspect}: main/sub/hide edits preserve legacy state, BODY, redactions and active work pointer`,async t=>{
    const f=await fixture(t,{aspect,...(aspect==='a4_portrait'?{customPortrait:true}:{})});
    let legacy=await initializeLocalMockups({...f,title:'기존 목업 제목'});
    legacy=await renderLocalMockups({...f,expectedRevision:legacy.revision,scale:.5});
    await renderLocalMockups({...f,expectedRevision:legacy.revision,scale:1});
    const before=await baseline(f),untouchedRecord=await record(f);
    let r=await getLocalMockupTitleReview(f);
    assert.equal(r.available,true);assert.equal(r.revision,null);assert.equal(r.legacyFinalAvailable,true);
    assert.equal(r.legacyTitle,'기존 목업 제목');assert.equal(r.title.main,'');
    assert.deepEqual(await record(f),untouchedRecord);
    r=await saveLocalMockupTitle({...args(f,r),title});
    r=await finish(f,r);assert.equal(r.active,null);assert.ok(r.draft&&r.final);
    r=await confirm(f,r);const firstHash=r.active.sha256;
    assert.equal(redactionHash(await readLocalMockupTitleImage({...f,kind:'active',expectedHash:firstHash})),firstHash);
    await assertBaseline(f,before);
    for(const next of [{...title,main:'사업 제안서'},{...title,sub:'다른 합성 작업물'},{...title,showSub:false}]) {
      const oldActive=r.active;
      r=await saveLocalMockupTitle({...args(f,r),title:next});
      assert.equal(r.final,null);assert.equal(r.draft,null);assert.deepEqual(r.active,oldActive);
      r=await finish(f,r);assert.deepEqual(r.active,oldActive);r=await confirm(f,r);
      assert.deepEqual(r.activeTitle,next);await assertBaseline(f,before);
    }
    assert.equal(r.title.sub,title.sub);assert.equal(r.title.showSub,false);
    const rendered=JSON.parse((await artifact(f,r.final.manifestArtifactKey)).bytes);
    assert.equal(rendered.layout.sub,null);assert.equal(rendered.title.sub,title.sub);
    assert.notEqual(r.active.sha256,firstHash);assert.ok(r.localOnly);
  });
}

test('normalized identical saves, renders, confirms are no-ops across restart',async t=>{
  const f=await fixture(t);let r=await start(f);r=await finish(f,r);r=await confirm(f,r);
  const before=await record(f),revision=r.revision;
  r=await saveLocalMockupTitle({...args(f,r),title:{...title,main:' 행사  대행 제안서 '}});
  r=await renderLocalMockupTitle({...args(f,r),scale:.5});r=await renderLocalMockupTitle({...args(f,r),scale:1});
  r=await confirm(f,r);assert.equal(r.revision,revision);assert.deepEqual(await record(f),before);
  assert.deepEqual(await getLocalMockupTitleReview(f),r);
});

test('validation, stale revision, bad confirmation and missing-draft failure retain active image',async t=>{
  const f=await fixture(t);let r=await start(f);r=await finish(f,r);r=await confirm(f,r);
  const active=r.active,before=await record(f);
  await assert.rejects(saveLocalMockupTitle({...args(f,r),title:{...title,main:''}}),/MOCKUP_TITLE_REQUIRED/);
  await assert.rejects(saveLocalMockupTitle({...args(f,r),title:{...title,main:'가'.repeat(41)}}),/MOCKUP_TITLE_TOO_LONG/);
  await assert.rejects(saveLocalMockupTitle({...args(f,r),title:{...title,extra:'not allowed'}}),/MOCKUP_TITLE_INVALID/);
  await assert.rejects(saveLocalMockupTitle({...args(f,r),expectedRevision:r.revision-1,title}),/MOCKUP_TITLE_REVISION_CONFLICT/);
  await assert.rejects(confirmLocalMockupTitle({...args(f,r),expectedFinalHash:'a'.repeat(64),visualConfirmed:true}),/MOCKUP_TITLE_CONFIRMATION_REQUIRED/);
  await assert.rejects(confirmLocalMockupTitle({...args(f,r),expectedFinalHash:r.final.sha256,visualConfirmed:false}),/MOCKUP_TITLE_CONFIRMATION_REQUIRED/);
  assert.deepEqual(await record(f),before);
  r=await saveLocalMockupTitle({...args(f,r),title:{...title,main:'수정 중인 제안서'}});
  const pending=await record(f);
  await assert.rejects(renderLocalMockupTitle({...args(f,r),scale:1}),/MOCKUP_TITLE_DRAFT_REQUIRED/);
  assert.deepEqual(await record(f),pending);assert.deepEqual((await getLocalMockupTitleReview(f)).active,active);
  assert.equal(redactionHash(await readLocalMockupTitleImage({...f,kind:'active',expectedHash:active.sha256})),active.sha256);
  await assert.rejects(readLocalMockupTitleImage({...f,kind:'final',expectedHash:active.sha256}),/MOCKUP_TITLE_IMAGE_NOT_CURRENT/);
});

test('corrupt new candidate draft prevents final generation without losing last-good active',async t=>{
  const f=await fixture(t);let r=await start(f);r=await finish(f,r);r=await confirm(f,r);const active=r.active;
  r=await saveLocalMockupTitle({...args(f,r),title:{...title,main:'새 후보 제목'}});
  r=await renderLocalMockupTitle({...args(f,r),scale:.5});
  const a=await artifact(f,r.draft.artifactKey);await writeFile(a.absolutePath,'SYNTHETIC CORRUPT CANDIDATE');
  const before=await record(f);
  await assert.rejects(renderLocalMockupTitle({...args(f,r),scale:1}),/MOCKUP_TITLE_DRAFT_REQUIRED/);
  assert.deepEqual(await record(f),before);r=await getLocalMockupTitleReview(f);
  assert.equal(r.draft,null);assert.equal(r.final,null);assert.deepEqual(r.active,active);
  assert.equal(redactionHash(await readLocalMockupTitleImage({...f,kind:'active',expectedHash:active.sha256})),active.sha256);
});

test('title sidecar cannot enter legacy image-set handoff, including before candidate generation',async t=>{
  const f=await fixture(t);await start(f);let called=false;
  await assert.rejects(withVerifiedLocalMockupSet(f,async()=>{called=true;}),/MOCKUP_TITLE_EDIT_LOCAL_ONLY/);
  assert.equal(called,false);
});

test('changed thumbnail slots reject old base and hide stale active rather than serve old privacy bindings',async t=>{
  const f=await fixture(t);let r=await start(f);r=await finish(f,r);r=await confirm(f,r);const original=r;
  let legacy=await getLocalMockupReview(f);
  const bodyOnly=assignments(legacy),bodyUsed=new Set(bodyOnly[3].slots.map(s=>s.sourceSlideNumber));
  bodyOnly[3].slots[0].sourceSlideNumber=legacy.candidates.find(c=>c.status==='approved'&&!bodyUsed.has(c.sourceSlideNumber)).sourceSlideNumber;
  legacy=await saveLocalMockupAssignments({...f,expectedRevision:legacy.revision,title:legacy.title,boards:bodyOnly});
  assert.equal((await getLocalMockupTitleReview(f)).stale,false);
  assert.deepEqual((await getLocalMockupTitleReview(f)).active,original.active);
  const boards=assignments(legacy),used=new Set(boards[0].slots.map(s=>s.sourceSlideNumber));
  boards[0].slots[0].sourceSlideNumber=legacy.candidates.find(c=>c.status==='approved'&&!used.has(c.sourceSlideNumber)).sourceSlideNumber;
  await saveLocalMockupAssignments({...f,expectedRevision:legacy.revision,title:legacy.title,boards});
  r=await getLocalMockupTitleReview(f);assert.equal(r.stale,true);assert.equal(r.active,null);assert.equal(r.final,null);
  await assert.rejects(saveLocalMockupTitle({...args(f,original),title}),/MOCKUP_TITLE_BASE_CHANGED/);
  await assert.rejects(readLocalMockupTitleImage({...f,kind:'active',expectedHash:original.active.sha256}),/MOCKUP_TITLE_IMAGE_NOT_CURRENT/);
  r=await saveLocalMockupTitle({...args(f,r),title});assert.equal(r.stale,false);assert.equal(r.active,null);
  r=await finish(f,r);r=await confirm(f,r);assert.notEqual(r.active.sha256,original.active.sha256);
});

test('new redaction edit blocks sidecar active reads even while assignment hash remains unchanged',async t=>{
  const f=await fixture(t);let r=await start(f);r=await finish(f,r);r=await confirm(f,r);const original=r;
  const legacy=await getLocalMockupReview(f),n=legacy.boards[0].slots[0].sourceSlideNumber;
  const redaction=await getLocalRedactionSlide({...f,sourceSlideNumber:n});
  await saveLocalRedactionSlide({...f,sourceSlideNumber:n,expectedRevision:redaction.revision,regions:[...redaction.regions,
    {id:'new-synthetic-mask',mode:'opaque',rect:{x:.1,y:.1,width:.1,height:.1}}],exceptions:redaction.exceptions,review:redaction.review});
  r=await getLocalMockupTitleReview(f);assert.equal(r.stale,true);assert.equal(r.active,null);
  await assert.rejects(renderLocalMockupTitle({...args(f,original),scale:.5}),/MOCKUP_TITLE_BASE_CHANGED/);
  await assert.rejects(readLocalMockupTitleImage({...f,kind:'active',expectedHash:original.active.sha256}),/MOCKUP_TITLE_IMAGE_NOT_CURRENT/);
});

test('corrupt sidecar is fail-closed and never falls back to publish legacy title',async t=>{
  const f=await fixture(t);await start(f);const a=await artifact(f,'mockup-title-edit-state');
  await writeFile(a.absolutePath,'{}');
  await assert.rejects(getLocalMockupTitleReview(f),/MOCKUP_TITLE_STATE_CORRUPT/);
  await assert.rejects(withVerifiedLocalMockupSet(f,async()=>{}),/MOCKUP_TITLE_EDIT_LOCAL_ONLY/);
});

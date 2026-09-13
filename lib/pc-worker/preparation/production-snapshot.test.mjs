import test from 'node:test';
import {productionSnapshotHash} from './production-snapshot-hash.ts';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createMockupFixture} from './mockup-fixture.mjs';
import {openPreparationWorkStore} from './work-store.ts';
import {redactionHash,assertFlatRedactionPng} from './redaction-renderer.ts';
import {getLocalRedactionSlide,saveLocalRedactionSlide} from './redaction-service.ts';
import {initializeLocalMockups,renderLocalMockups,getLocalMockupReview,saveLocalMockupAssignments,
  getLocalMockupTitleReview,saveLocalMockupTitle,renderLocalMockupTitle,confirmLocalMockupTitle,
  getVerifiedProductionMockupDescriptor,withVerifiedProductionMockupSnapshot,withVerifiedLocalMockupSet} from './mockup-service.ts';

const title={main:'행사 대행 제안서',sub:'합성 작업물',showSub:true,style:'bold'};
const args=(f,r)=>({...f,expectedRevision:r.revision,expectedBaseFingerprint:r.baseFingerprint});
const titleMode={mode:'thumbnail'};
const fullMode={mode:'full'};
const record=f=>readFile(path.join(f.root,'builds',f.buildId,'record.json'));
async function fixture(t,options) {
  const f=await createMockupFixture(options);t.after(f.cleanup);
  const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=original);
  await initializeLocalMockups({...f,title:'기존 목업 제목'});
  return f;
}
async function finalSet(f) {
  let review=await getLocalMockupReview(f);
  review=await renderLocalMockups({...f,expectedRevision:review.revision,scale:.5});
  return renderLocalMockups({...f,expectedRevision:review.revision,scale:1});
}
async function confirmTitle(f,nextTitle=title) {
  let review=await getLocalMockupTitleReview(f);
  review=await saveLocalMockupTitle({...args(f,review),title:nextTitle});
  review=await renderLocalMockupTitle({...args(f,review),scale:.5});
  review=await renderLocalMockupTitle({...args(f,review),scale:1});
  return confirmLocalMockupTitle({...args(f,review),expectedFinalHash:review.final.sha256,visualConfirmed:true});
}
async function work(f) {return readFile(path.join(f.root,'work.json'));}
async function stateArtifact(f,key) {
  const store=await openPreparationWorkStore({root:f.root});
  try {const a=await store.getReusableArtifact(f.buildId,key);assert.ok(a);return a;}
  finally{await store.release();}
}
const bindings=review=>review.boards.map(b=>({templateId:b.templateId,
  slots:b.slots.map(({slotId,sourceSlideNumber})=>({slotId,sourceSlideNumber}))}));

test('full snapshot is explicit, immutable and privacy-whitelisted, including confirmed thumbnail',async t=>{
  const f=await fixture(t,{count:8});await finalSet(f);
  const legacyPreview=await getVerifiedProductionMockupDescriptor(f,fullMode);
  assert.equal(legacyPreview.descriptor.boards.length,5);
  assert.equal(legacyPreview.descriptor.thumbnail.titleSpec,null);
  assert.equal(legacyPreview.descriptor.thumbnail.localConfirmed,false);
  const original=await getLocalMockupReview(f);
  const titleReview=await confirmTitle(f),before=await record(f),beforeWork=await work(f);
  const preview=await getVerifiedProductionMockupDescriptor(f,fullMode);
  assert.equal(preview.descriptor.remoteApproval,'required');
  assert.equal(preview.descriptor.localConfirmation,'technical_candidate_only');
  assert.equal(preview.descriptor.thumbnail.titleImageHash,titleReview.active.sha256);
  assert.deepEqual(preview.descriptor.thumbnail.titleSpec,title);
  assert.equal(preview.descriptor.snapshotHash,undefined);
  assert.equal(productionSnapshotHash(preview.descriptor),preview.snapshotHash);
  assert.doesNotMatch(JSON.stringify(preview),/fake@example|absolutePath|sourcePath|exceptions|reviewer|debugArtifact|highres|preview-generation/);
  const beforeBody=original.boards.slice(1).map(b=>b.final.sha256);
  for(let retry=0;retry<2;retry++) {
    await withVerifiedProductionMockupSnapshot(f,{...fullMode,expectedSnapshotHash:preview.snapshotHash},async snapshot=>{
      assert.deepEqual(snapshot.descriptor,preview.descriptor);
      assert.deepEqual(Object.keys(snapshot).sort(),['boards','descriptor','snapshotHash','titlelessBasePng']);
      assert.equal(snapshot.boards.length,5);
      assert.deepEqual(snapshot.boards.slice(1).map(b=>b.imageHash),beforeBody);
      assertFlatRedactionPng(snapshot.titlelessBasePng);
      assert.equal(redactionHash(snapshot.titlelessBasePng),snapshot.descriptor.thumbnail.baseImageHash);
      for(const board of snapshot.boards) {
        assertFlatRedactionPng(board.png);assert.equal(redactionHash(board.png),board.imageHash);
        assert.ok(board.redactions.length>0);
        assert.deepEqual(board.sourceSlideNumbers,board.redactions.map(r=>r.sourceSlideNumber));
        for(const r of board.redactions)assert.match(r.redactionFingerprint,/^[a-f0-9]{64}$/);
      }
      assert.notEqual(snapshot.boards[0].imageHash,snapshot.descriptor.thumbnail.baseImageHash);
      await assert.rejects(openPreparationWorkStore({root:f.root}),{name:'PreparationWorkLockedError'});
    });
  }
  assert.deepEqual(await record(f),before);assert.deepEqual(await work(f),beforeWork);
  assert.deepEqual(await getLocalMockupReview(f),original);
  await assert.rejects(withVerifiedLocalMockupSet(f,async()=>{}),/MOCKUP_TITLE_EDIT_LOCAL_ONLY/);
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('cross-mode snapshot reached transport');
  }),/PRODUCTION_SNAPSHOT_STALE/);
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...fullMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    throw Error('INJECTED_CALLBACK_FAILURE');
  }),/INJECTED_CALLBACK_FAILURE/);
  assert.deepEqual(await record(f),before);assert.deepEqual(await work(f),beforeWork);
});

test('thumbnail-only snapshot requires no BODY render and carries only redacted titleless composite',async t=>{
  const f=await fixture(t,{aspect:'a4_portrait',customPortrait:true,count:8});
  await confirmTitle(f,{...title,main:'건물관리 제안서',sub:'',showSub:false});
  const before=await record(f),beforeWork=await work(f),legacy=await getLocalMockupReview(f);
  assert.ok(legacy.boards.every(board=>board.final===null&&board.draft===null));
  const preview=await getVerifiedProductionMockupDescriptor(f,titleMode);
  assert.equal(preview.descriptor.boards.length,1);
  assert.equal(preview.descriptor.boards[0].kind,'thumbnail');
  assert.ok(preview.descriptor.sourceFormatFingerprint);
  for(const receipt of preview.descriptor.boards[0].redactions) {
    assert.equal(receipt.sourceFit.crop,false);assert.equal(receipt.sourceFit.scale,1);
    assert.equal(receipt.sourceFit.sourceKind,'custom_preview');
  }
  await withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async snapshot=>{
    assert.equal(snapshot.boards.length,1);assertFlatRedactionPng(snapshot.boards[0].png);
    assertFlatRedactionPng(snapshot.titlelessBasePng);
  });
  await assert.rejects(getVerifiedProductionMockupDescriptor(f,fullMode),/PRODUCTION_SNAPSHOT_INCOMPLETE/);
  assert.deepEqual(await record(f),before);assert.deepEqual(await work(f),beforeWork);
  assert.deepEqual(await getLocalMockupReview(f),legacy);
});

test('missing, unconfirmed, pending and corrupt title sidecars never fall back to a legacy title',async t=>{
  const f=await fixture(t,{count:8});await finalSet(f);
  await assert.rejects(getVerifiedProductionMockupDescriptor(f,titleMode),/PRODUCTION_SNAPSHOT_TITLE_CONFIRMATION_REQUIRED/);
  let r=await getLocalMockupTitleReview(f);r=await saveLocalMockupTitle({...args(f,r),title});
  await assert.rejects(getVerifiedProductionMockupDescriptor(f,fullMode),/PRODUCTION_SNAPSHOT_TITLE_CONFIRMATION_REQUIRED/);
  r=await confirmTitle(f);const preview=await getVerifiedProductionMockupDescriptor(f,titleMode);
  r=await saveLocalMockupTitle({...args(f,r),title:{...title,main:'수정 중인 제목'}});
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('pending edit reached transport');
  }),/PRODUCTION_SNAPSHOT_TITLE_CONFIRMATION_REQUIRED/);
  const old=r.active;assert.ok(old);
  const file=await stateArtifact(f,'mockup-title-edit-state');await writeFile(file.absolutePath,'{}');
  await assert.rejects(getVerifiedProductionMockupDescriptor(f,fullMode),/MOCKUP_TITLE_STATE_CORRUPT/);
  await assert.rejects(withVerifiedLocalMockupSet(f,async()=>{}),/MOCKUP_TITLE_EDIT_LOCAL_ONLY/);
});

test('changed title, body assignment, thumbnail assignment and source cannot reuse a previous snapshot',async t=>{
  const f=await fixture(t,{count:10});await confirmTitle(f);
  let preview=await getVerifiedProductionMockupDescriptor(f,titleMode);
  await confirmTitle(f,{...title,main:'새 사업 제안서'});
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('old title reached transport');
  }),/PRODUCTION_SNAPSHOT_STALE/);
  preview=await getVerifiedProductionMockupDescriptor(f,titleMode);
  let legacy=await getLocalMockupReview(f);const next=bindings(legacy);
  const used=new Set(next[3].slots.map(s=>s.sourceSlideNumber));
  next[3].slots[0].sourceSlideNumber=legacy.candidates.find(c=>c.status==='approved'&&!used.has(c.sourceSlideNumber)).sourceSlideNumber;
  legacy=await saveLocalMockupAssignments({...f,expectedRevision:legacy.revision,title:legacy.title,boards:next});
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('old assignment reached transport');
  }),/PRODUCTION_SNAPSHOT_STALE/);
  preview=await getVerifiedProductionMockupDescriptor(f,titleMode);
  const changed=bindings(legacy),thumbUsed=new Set(changed[0].slots.map(s=>s.sourceSlideNumber));
  changed[0].slots[0].sourceSlideNumber=legacy.candidates.find(c=>c.status==='approved'&&!thumbUsed.has(c.sourceSlideNumber)).sourceSlideNumber;
  await saveLocalMockupAssignments({...f,expectedRevision:legacy.revision,title:legacy.title,boards:changed});
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('stale thumbnail reached transport');
  }),/PRODUCTION_SNAPSHOT_TITLE_STALE/);
  await assert.rejects(withVerifiedProductionMockupSnapshot({...f,buildId:'11111111-1111-4111-8111-111111111111'},
    {...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{}),/MOCKUP_BUILD_NOT_CURRENT/);
});

test('new redaction and corrupted confirmed output are rejected before callback',async t=>{
  const f=await fixture(t,{count:8});let r=await confirmTitle(f);
  const preview=await getVerifiedProductionMockupDescriptor(f,titleMode);
  const file=await stateArtifact(f,r.active.artifactKey),original=await readFile(file.absolutePath);
  await writeFile(file.absolutePath,'SYNTHETIC CORRUPTION');
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('corrupt PNG reached transport');
  }),/PRODUCTION_SNAPSHOT_TITLE_STALE/);
  await writeFile(file.absolutePath,original);
  const legacy=await getLocalMockupReview(f),n=legacy.boards[0].slots[0].sourceSlideNumber;
  const redaction=await getLocalRedactionSlide({...f,sourceSlideNumber:n});
  await saveLocalRedactionSlide({...f,sourceSlideNumber:n,expectedRevision:redaction.revision,
    regions:[...redaction.regions,{id:'new-proof-mask',mode:'opaque',rect:{x:.1,y:.1,width:.1,height:.1}}],
    exceptions:redaction.exceptions,review:redaction.review});
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{...titleMode,expectedSnapshotHash:preview.snapshotHash},async()=>{
    assert.fail('stale privacy approval reached transport');
  }),/PRODUCTION_SNAPSHOT_REDACTION_STALE/);
  r=await getLocalMockupTitleReview(f);assert.equal(r.active,null);
});

test('invalid mode and missing/fabricated snapshot expectation fail before transport',async t=>{
  const f=await fixture(t,{count:8});await confirmTitle(f);let called=false;
  const operation=async()=>{called=true;};
  await assert.rejects(getVerifiedProductionMockupDescriptor(f,{mode:'anything'}),/PRODUCTION_SNAPSHOT_MODE_INVALID/);
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{mode:'thumbnail'},operation),/PRODUCTION_SNAPSHOT_EXPECTATION_REQUIRED/);
  await assert.rejects(withVerifiedProductionMockupSnapshot(f,{mode:'thumbnail',expectedSnapshotHash:'a'.repeat(64)},operation),/PRODUCTION_SNAPSHOT_STALE/);
  assert.equal(called,false);
});

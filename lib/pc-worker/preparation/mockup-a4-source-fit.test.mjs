import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createMockupFixture} from './mockup-fixture.mjs';
import {openPreparationWorkStore} from './work-store.ts';
import {getLocalRedactionSlide} from './redaction-service.ts';
import {initializeLocalMockups,renderLocalMockups,getLocalMockupReview,readLocalMockupImage} from './mockup-service.ts';
import {compareApprovedBoardDraftAndFinal} from '../../portfolio/approved-assigned-board-renderer.ts';

test('PPT A4 fit is derived from approved redaction, bound to board receipts, and never activates a set',async t=>{
  const f=await createMockupFixture({aspect:'a4_landscape',powerpointA4:true,count:7});t.after(f.cleanup);
  const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN');};t.after(()=>globalThis.fetch=oldFetch);
  const before=await getLocalRedactionSlide({...f,sourceSlideNumber:1});
  let review=await initializeLocalMockups({...f,title:'합성 PPT A4 비율 검사'});
  assert.match(review.sourceFitNotice,/PowerPoint A4/);
  assert.ok(review.boards.every(b=>b.holds.length===0));
  const boardId=review.boards[3].templateId;
  review=await renderLocalMockups({...f,expectedRevision:review.revision,scale:.5,templateIds:[boardId]});
  review=await renderLocalMockups({...f,expectedRevision:review.revision,scale:1,templateIds:[boardId]});
  assert.deepEqual(await getLocalRedactionSlide({...f,sourceSlideNumber:1}),before);
  const board=review.boards[3];
  const store=await openPreparationWorkStore(f);
  let stateArtifact;
  try {
    assert.equal((await store.readWork()).activeSetRef.setId,'existing-live-set-synthetic');
    const draft=JSON.parse(await readFile((await store.getReusableArtifact(f.buildId,board.draft.manifestArtifactKey)).absolutePath,'utf8'));
    const final=JSON.parse(await readFile((await store.getReusableArtifact(f.buildId,board.final.manifestArtifactKey)).absolutePath,'utf8'));
    assert.ok(compareApprovedBoardDraftAndFinal(draft.render,final.render).passed);
    for(const [i,slot] of final.slots.entries()) {
      const fit=slot.receipt.sourceFit,renderSlot=final.render.slots[i];
      assert.equal(fit.sourceHash,slot.receipt.imageHash);
      assert.equal(fit.resultHash,renderSlot.renderInputHash);
      assert.equal(slot.receipt.imageHash,renderSlot.contentHash);
      assert.deepEqual(fit,renderSlot.sourceFit);
      assert.equal(fit.scale,1);assert.equal(fit.crop,false);
      assert.ok(fit.padding.top>0&&fit.padding.bottom>0);
    }
    stateArtifact=await store.getReusableArtifact(f.buildId,'mockup-state');
    const state=JSON.parse(await readFile(stateArtifact.absolutePath,'utf8'));
    state.boards[3].slots[0].receipt.sourceFit.padding.top++;
    await writeFile(stateArtifact.absolutePath,JSON.stringify(state));
    const build=await store.readBuild(f.buildId);
    await store.recordArtifact({buildId:f.buildId,key:'mockup-state',expectedRevision:build.revision,relativePath:stateArtifact.record.relativePath});
  } finally {await store.release();}
  review=await getLocalMockupReview(f);
  assert.equal(review.boards[3].final,null);
  assert.match(review.boards[3].holds.join(),/REDACTION_CHANGED/);
  await assert.rejects(readLocalMockupImage({...f,templateId:boardId,scale:1}),/ASSIGNMENT_STALE/);
});

test('PPT A4 fit cannot silently substitute unapproved source pixels',async t=>{
  const f=await createMockupFixture({aspect:'a4_landscape',powerpointA4:true,count:7,approveCount:0});t.after(f.cleanup);
  const review=await initializeLocalMockups({...f,title:'합성 미승인 A4 검사'});
  assert.ok(review.candidates.every(c=>c.status!=='approved'));
  await assert.rejects(renderLocalMockups({...f,expectedRevision:review.revision,scale:.5}),/ASSIGNMENT_HELD/);
});

test('explicit custom portrait uses unchanged approved pixels and source-bound padding in the normal local flow',async t=>{
  const f=await createMockupFixture({aspect:'a4_portrait',customPortrait:true,count:7});t.after(f.cleanup);
  const before=await getLocalRedactionSlide({...f,sourceSlideNumber:1});
  let review=await initializeLocalMockups({...f,title:'합성 사용자 지정 세로 검사'});
  assert.equal(review.aspectClass,'a4_portrait');assert.match(review.sourceFitNotice,/직접 선택한/);
  assert.ok(review.boards.every(b=>b.holds.length===0));
  const boardId=review.boards[4].templateId;
  review=await renderLocalMockups({...f,expectedRevision:review.revision,scale:.5,templateIds:[boardId]});
  review=await renderLocalMockups({...f,expectedRevision:review.revision,scale:1,templateIds:[boardId]});
  assert.deepEqual(await getLocalRedactionSlide({...f,sourceSlideNumber:1}),before);
  const store=await openPreparationWorkStore(f);
  try {
    const inspection=await store.getReusableStage(f.buildId,'source_inspection');
    assert.equal(inspection.data.aspect,'unknown');
    const state=JSON.parse(await readFile((await store.getReusableArtifact(f.buildId,'mockup-state')).absolutePath,'utf8'));
    assert.match(state.sourceFormatFingerprint,/^[a-f0-9]{64}$/);
    const board=review.boards[4];
    const draft=JSON.parse(await readFile((await store.getReusableArtifact(f.buildId,board.draft.manifestArtifactKey)).absolutePath,'utf8'));
    const final=JSON.parse(await readFile((await store.getReusableArtifact(f.buildId,board.final.manifestArtifactKey)).absolutePath,'utf8'));
    assert.ok(compareApprovedBoardDraftAndFinal(draft.render,final.render).passed);
    for(const [i,slot] of final.slots.entries()) {
      assert.equal(slot.receipt.sourceFit.sourceKind,'custom_preview');
      assert.equal(slot.receipt.sourceFit.sourceHash,slot.receipt.imageHash);
      assert.equal(slot.receipt.sourceFit.resultHash,final.render.slots[i].renderInputHash);
      assert.deepEqual(slot.receipt.sourceFit,final.render.slots[i].sourceFit);
      assert.equal(slot.receipt.sourceFit.crop,false);assert.equal(slot.receipt.sourceFit.scale,1);
    }
    assert.equal((await store.readWork()).activeSetRef.setId,'existing-live-set-synthetic');
    const receipt=await store.getReusableArtifact(f.buildId,'source-format-choice');
    await writeFile(receipt.absolutePath,'corrupted source format choice');
  } finally {await store.release();}
  await assert.rejects(getLocalMockupReview(f),/MOCKUP_PREPARATION_INCOMPLETE/);
});

test('custom portrait format selection never approves undisclosed images',async t=>{
  const f=await createMockupFixture({aspect:'a4_portrait',customPortrait:true,count:7,approveCount:0});t.after(f.cleanup);
  const review=await initializeLocalMockups({...f,title:'합성 미승인 세로 검사'});
  assert.ok(review.candidates.every(c=>c.status!=='approved'));
  await assert.rejects(renderLocalMockups({...f,expectedRevision:review.revision,scale:.5}),/ASSIGNMENT_HELD/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPptx} from './pptx-inspection.ts';
import {pptxFixture} from './fixtures.test-support.mjs';
import {validateSourceFormatChoice, sourceFormatSelectionInspection, sourceFormatFingerprint, sourceFormatA4Fit} from './source-format-choice.ts';

const inspect=async(ratio=[612.25,858.8750393700788])=>inspectPptx(await pptxFixture({ratio,count:8}),{installedFonts:['Arial']});
const choice=i=>({kind:'custom_portrait_to_a4',aspectClass:'a4_portrait',sourceHash:i.sourceHash,reviewedBy:'local-reviewer',reason:'A4 세로 템플릿에 원본 비율을 보존해 맞춤'});

test('custom source choice is explicit, source-bound, and preserves raw inspection',async()=>{
  const i=await inspect(),before=JSON.stringify(i);
  assert.equal(i.aspect,'unknown');assert.equal(i.pageSizeVariant,'custom');
  assert.equal(validateSourceFormatChoice(i),undefined);
  assert.equal(sourceFormatSelectionInspection(i).aspect,'unknown');
  const receipt=validateSourceFormatChoice(i,choice(i)),effective=sourceFormatSelectionInspection(i,receipt);
  assert.equal(effective.aspect,'a4_portrait');assert.equal(JSON.stringify(i),before);
  assert.ok(i.issues.some(issue=>issue.code==='NO_APPROVED_SUITE'));
  assert.ok(!effective.issues.some(issue=>issue.code==='NO_APPROVED_SUITE'));
  assert.equal(sourceFormatA4Fit(i,receipt).sourceKind,'custom_preview');
  assert.equal(sourceFormatA4Fit(i),undefined);
  assert.match(sourceFormatFingerprint(receipt),/^[0-9a-f]{64}$/);
  const changed=validateSourceFormatChoice(i,{...choice(i),reason:'별도 실제 원본 규격 검토'});
  assert.notEqual(sourceFormatFingerprint(receipt),sourceFormatFingerprint(changed));
});

test('wrong source, landscape, square, wide custom, missing review, and forged recipe remain blocked',async()=>{
  const i=await inspect();
  for(const override of [{sourceHash:'a'.repeat(64)},{kind:'automatic'},{aspectClass:'a4_landscape'}])
    assert.throws(()=>validateSourceFormatChoice(i,{...choice(i),...override}),/SOURCE_FORMAT_SOURCE_MISMATCH/);
  for(const override of [{reviewedBy:''},{reason:'ok'},{reason:'x\n'.repeat(5)}])
    assert.throws(()=>validateSourceFormatChoice(i,{...choice(i),...override}),/SOURCE_FORMAT_REVIEW_REQUIRED/);
  for(const ratio of [[858.875,612.25],[1,1],[4,5],[210,297]]) {
    const other=await inspect(ratio);
    assert.throws(()=>validateSourceFormatChoice(other,choice(other)),/SOURCE_FORMAT_NOT_COMPATIBLE/);
  }
  const receipt=validateSourceFormatChoice(i,choice(i));
  assert.throws(()=>sourceFormatSelectionInspection(i,{...receipt,sourceWidth:1}),/SOURCE_FORMAT_RECEIPT_MISMATCH/);
});

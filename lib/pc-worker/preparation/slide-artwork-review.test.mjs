import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPptx, sha256 } from './pptx-inspection.ts';
import { selectPreparedSlides } from './slide-preparation.ts';
import { pptxFixture } from './fixtures.test-support.mjs';

async function evidence() {
  const inspection=await inspectPptx(await pptxFixture({count:18,backgroundPictureKinds:{1:'photo'}}),{installedFonts:['Arial']});
  const previews=inspection.slides.map(s=>({sourceSlideNumber:s.sourceSlideNumber,width:800,height:450,sha256:sha256(`preview-${s.sourceSlideNumber}`),visualHash:sha256(`visual-${s.sourceSlideNumber}`),blank:false}));
  const review={sourceHash:inspection.sourceHash,slideContentHash:inspection.slides[0].contentHash,previewHash:previews[0].sha256,sourceSlideNumber:1,classification:'abstract_graphic',reviewedBy:'Synthetic local reviewer',reason:'Synthetic fixture demonstrating an explicit classification correction; not customer disclosure approval.',inspectedAtFullResolution:true};
  return {inspection,previews,review};
}

test('continuous-tone cover stays excluded without explicit visual evidence; reviewed artwork becomes cover',async()=>{
  const {inspection,previews,review}=await evidence();
  assert.ok(inspection.slides[0].issues.some(i=>i.code==='PHOTO_DENSE'));
  assert.notEqual(selectPreparedSlides(inspection,previews).cover,1);
  const selected=selectPreparedSlides(inspection,previews,{artworkReviews:[review]});
  assert.equal(selected.status,'ready_for_local_review');
  assert.equal(selected.cover,1);
  assert.equal(selected.manualReviewRequired,true);
  assert.deepEqual(selected.artworkReviews,[review]);
});

test('review is invalidated by source, slide, rendered image, reviewer or scope changes',async()=>{
  const {inspection,previews,review}=await evidence();
  for(const update of [{sourceHash:sha256('other')},{slideContentHash:sha256('other')},{previewHash:sha256('other')},{reviewedBy:''},{reason:''},{inspectedAtFullResolution:false},{classification:'photograph'},{sourceSlideNumber:99}]) {
    const result=selectPreparedSlides(inspection,previews,{artworkReviews:[{...review,...update}]});
    assert.equal(result.status,'held',JSON.stringify(update));
    assert.ok(result.holds.some(s=>s.startsWith('ARTWORK_REVIEW_INVALID')));
  }
  assert.equal(selectPreparedSlides(inspection,previews,{artworkReviews:[review,review]}).status,'held');
});

test('artwork review never bypasses font, table, external media or corrupted preview exclusions',async()=>{
  const {inspection,previews,review}=await evidence();
  for(const code of ['TABLE_DENSE','MEDIA_UNRESOLVED','MEDIA_CLASSIFICATION_REVIEW','INHERITED_OBJECT_REVIEW','FONT_UNRESOLVED']) {
    const copy=structuredClone(inspection);
    copy.slides[0].issues.push({code,detail:'Synthetic unresolved issue'});
    const result=selectPreparedSlides(copy,previews,{artworkReviews:[review]});
    assert.notEqual(result.cover,1,code);
    assert.equal(result.slides[0].disposition,'excluded');
  }
  const bad=structuredClone(previews);bad[0].blank=true;
  assert.equal(selectPreparedSlides(inspection,bad,{artworkReviews:[review]}).status,'held');
});

test('malformed JSON records and oversized review arrays hold clearly instead of throwing or approving',async()=>{
  const {inspection,previews,review}=await evidence();
  for(const artworkReviews of [null,42,true,'invalid',{},[null],[false],[1],['invalid'],[[]],[{}],Array(501).fill(review)]) {
    let result;
    assert.doesNotThrow(()=>{result=selectPreparedSlides(inspection,previews,{artworkReviews});});
    assert.equal(result.status,'held');
    assert.ok(result.holds.some(s=>s.startsWith('ARTWORK_REVIEW_INVALID')));
    assert.equal(result.artworkReviews,undefined);
    assert.notEqual(result.cover,1);
  }
  const mixed=selectPreparedSlides(inspection,previews,{artworkReviews:[review,null]});
  assert.equal(mixed.status,'held');
  assert.ok(mixed.holds.some(s=>s.includes('2번째')));
});

test('accepted artwork proof is a bounded field projection without modifying the input',async()=>{
  const {inspection,previews,review}=await evidence();
  const input={...review,reviewedBy:` ${review.reviewedBy} `,reason:` ${review.reason} `,
    sourcePath:'private source path',extractedText:'private source text',extra:{nested:'not review proof'}};
  const before=structuredClone(input),selected=selectPreparedSlides(inspection,previews,{artworkReviews:[input]});
  assert.equal(selected.status,'ready_for_local_review');
  assert.deepEqual(selected.artworkReviews,[review]);
  assert.deepEqual(input,before);
  assert.doesNotMatch(JSON.stringify(selected.artworkReviews),/sourcePath|extractedText|nested|private source/);
  for(const update of [{reviewedBy:'x'.repeat(101)},{reason:'x'.repeat(501)},{reason:'review\nwith newline'},
    {reviewedBy:'reviewer\u0000'},{sourceSlideNumber:1.5},{sourceSlideNumber:'1'},{sourceHash:null},{slideContentHash:0},{previewHash:[]}]) {
    const result=selectPreparedSlides(inspection,previews,{artworkReviews:[{...review,...update}]});
    assert.equal(result.status,'held');assert.equal(result.artworkReviews,undefined);
  }
});

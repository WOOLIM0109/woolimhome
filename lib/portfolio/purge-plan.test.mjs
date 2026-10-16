import assert from 'node:assert/strict';
import test from 'node:test';
import {planPortfolioPurge} from './purge-plan.mjs';
const fixture=()=>({content_work_items:[{id:'hold',channel:'naver_design',status:'on_hold',metadata:{candidateId:'c'}},
 {id:'published',channel:'naver_design',status:'published'},{id:'other',channel:'naver_consulting',status:'on_hold'}],
 content_jobs:[{id:'j',candidate_id:'c',work_item_id:'hold',status:'on_hold',job_type:'draft'}],portfolio_candidates:[{id:'c'}]});
test('only naver_design on_hold is targeted; candidate rows are preserved for reset',()=>{
 const result=planPortfolioPurge(fixture());assert.deepEqual(result.workIds,['hold']);assert.deepEqual(result.candidateIds,['c']);
 for(const status of ['approved','scheduled','review_required','naver_ready']){const f=fixture();f.content_work_items[0].status=status;assert.equal(planPortfolioPurge(f).workIds.length,0);}
});
test('shared image sets and their paths remain while private mockup paths are removed',()=>{
 const f=fixture();f.portfolio_image_sets=[{id:'set',work_item_id:'hold',manifest:{assets:[{bucket:'portfolio-rendered',path:'shared.png'}]}}];
 f.content_work_items[1].metadata={activeImageSetId:'set'};
 f.content_review_assets=[{id:'a',work_item_id:'hold',public_url:'/api/admin/assets?bucket=portfolio-rendered&path=private.png'}];
 const result=planPortfolioPurge(f);assert.deepEqual(result.retainedSetIds,['set']);assert.deepEqual(result.storageFiles,[{bucket:'portfolio-rendered',path:'private.png'}]);
});
test('active workers, shared candidates and published evidence stop the plan',()=>{
 for(const mutate of [f=>f.content_jobs[0].status='running',f=>f.content_work_items[1].metadata={candidateId:'c'},f=>f.content_work_items[0].published_url='https://example.com']){
  const f=fixture();mutate(f);assert.throws(()=>planPortfolioPurge(f));
 }
});

test('an image referenced only in another manuscript HTML is retained',()=>{
 const f=fixture();f.content_review_assets=[{id:'a',work_item_id:'hold',public_url:'/api/admin/assets?bucket=portfolio-rendered&path=shared.png'}];
 f.content_work_items[1].metadata={generated:{bodyHtml:'<img src="/api/admin/assets?bucket=portfolio-rendered&amp;path=shared.png" />'}};
 assert.equal(planPortfolioPurge(f).storageFiles.length,0);
});

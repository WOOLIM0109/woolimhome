import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {autoApprovedSuite,chooseMockupRoute,isNewlyOpenedApprovedCase} from './mockup-route.ts';
import {APPROVED_MOCKUP_SUITE_CONTRACTS,getApprovedMockupSuite} from './approved-mockup-suites.ts';
import {resolveApprovedMockupSlots} from './approved-16x9-templates.ts';

test('automatic approved routes depend only on a registered aspect, for both document lengths',()=>{
  for(const mode of ['short','long'])for(const aspectPrimary of ['16:9','a4_landscape','a4_portrait','4:3','unknown',null]){
    const approved=['16:9','a4_landscape','a4_portrait'].includes(aspectPrimary);
    assert.equal(chooseMockupRoute({aspectPrimary}),approved?'approved':'legacy',`${mode}/${aspectPrimary}`);
    assert.equal(Boolean(autoApprovedSuite(aspectPrimary)),approved);
    if(approved)assert.equal(autoApprovedSuite(aspectPrimary).aspectClass,aspectPrimary);
    assert.equal(isNewlyOpenedApprovedCase({mode,aspectPrimary}),aspectPrimary==='a4_portrait'||(mode==='long'&&aspectPrimary==='16:9'));
  }
  // The PC runtime registry and its earlier production gate remain byte-stable.
  assert.equal(getApprovedMockupSuite('a4_portrait'),null);
});

test('all approved suites retain their complete locked thumbnail and four-body slot capacities',()=>{
  const expected={'16:9':[7,7,7,4,8],a4_landscape:[7,7,7,4,6],a4_portrait:[2,7,3,4,2]};
  for(const contract of APPROVED_MOCKUP_SUITE_CONTRACTS){
    const suite=autoApprovedSuite(contract.aspectClass);
    const capacities=[suite.thumbnail,...suite.bodyTemplates].map(template=>resolveApprovedMockupSlots(template).length);
    // Resolve generated grid slots through the public contract instead of
    // depending on how individual coordinate definitions store their geometry.
    assert.equal(suite.bodyTemplates.length,4);
    assert.deepEqual(capacities,expected[contract.aspectClass]);
    assert.equal(expected[contract.aspectClass].slice(1).reduce((a,b)=>a+b,0),{'16:9':26,a4_landscape:24,a4_portrait:16}[contract.aspectClass]);
    assert.equal(capacities.length,5);
  }
});

test('legacy long body and thumbnail renderers remain available for recovery',()=>{
  const source=readFileSync('lib/portfolio/mockup.ts','utf8');
  assert.match(source,/async function multiPageBoard\(/);assert.match(source,/async function thumbnail\(/);
});

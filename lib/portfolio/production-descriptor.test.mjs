import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productionDescriptorFixture,jsonbOrder} from './production-descriptor.test-support.mjs';
import {validateProductionDescriptor,productionSetManifest} from './production-descriptor.ts';
import {productionSnapshotHash,productionSnapshotCanonicalJson} from '../pc-worker/preparation/production-snapshot-hash.ts';
import {preparePortfolioImageSetCommit} from './image-set.ts';
import {validateVerifiedProductionPublication} from './production-publication.ts';

test('the same descriptor and normalized title survive recursive JSONB key reordering in every approved format',()=>{
  for(const aspect of ['16:9','a4_landscape','a4_portrait']) {
    const f=productionDescriptorFixture(aspect),stored=jsonbOrder(f.descriptor);
    assert.notEqual(JSON.stringify(stored),JSON.stringify(f.descriptor));
    assert.equal(productionSnapshotHash(stored),f.session.descriptor_hash);
    assert.deepEqual(validateProductionDescriptor(stored,f.session.descriptor_hash),f.descriptor);
    assert.notDeepEqual(Object.keys(stored.thumbnail.titleSpec),Object.keys(f.descriptor.thumbnail.titleSpec));
    assert.deepEqual(stored.thumbnail.titleSpec,f.descriptor.thumbnail.titleSpec);
  }
});

test('JSONB stage to activation to publication keeps the same immutable snapshot and all nonimage fields',()=>{
  const f=productionDescriptorFixture(),snapshotHash=f.session.descriptor_hash;
  const uploading=jsonbOrder(f.session),descriptor=validateProductionDescriptor(uploading.descriptor,snapshotHash);
  const staged=jsonbOrder({...uploading,status:'staged'});
  assert.deepEqual(validateProductionDescriptor(staged.descriptor,snapshotHash),f.descriptor);
  const set=productionSetManifest(descriptor,f.id,f.sessionId,'authenticated-admin',f.now);
  const commit=preparePortfolioImageSetCommit(jsonbOrder(f.initial),{set,expectedUpdatedAt:f.now,expectedActiveSetId:null,actor:'authenticated-admin',activatedAt:f.now});
  const item=jsonbOrder({...f.initial,metadata:commit.nextMetadata,content_review_assets:set.assets.map((asset,index)=>({id:`asset-${index}`,work_item_id:f.id,asset_type:asset.kind,public_url:asset.url,sort_order:index}))});
  const activated=jsonbOrder({...staged,status:'activated',manifest:set});
  assert.deepEqual(validateVerifiedProductionPublication(item,{imageSets:[jsonbOrder(set)],thumbnailVersions:[]},{session:activated,currentSource:jsonbOrder(f.source)}),[]);
  for(const key of ['title','summary','status','published_url'])assert.equal(item[key],f.initial[key]);
  assert.deepEqual(item.metadata.generated.faq,f.initial.metadata.generated.faq);
  assert.equal(item.metadata.generated.title,f.initial.metadata.generated.title);
  assert.deepEqual(item.metadata.untouched,f.initial.metadata.untouched);
});

test('canonical snapshot hashes still bind array order, revisions, titles and every proof value',()=>{
  const f=productionDescriptorFixture();
  for(const mutate of [d=>d.boards.reverse(),d=>d.boards[0].redactions.reverse(),d=>d.boards[0].sourceSlideNumbers.reverse(),
    d=>d.localRevision++,d=>d.titleRevision++,d=>d.thumbnail.titleSpec.main='변경 제목',d=>d.sourceHash='a'.repeat(64),
    d=>d.boards[2].imageHash='b'.repeat(64),d=>d.boards[1].redactions[0].approvedAt='2026-09-07T12:01:00.000Z']) {
    const changed=structuredClone(f.descriptor);mutate(changed);
    assert.notEqual(productionSnapshotHash(changed),f.session.descriptor_hash);
    assert.throws(()=>validateProductionDescriptor(jsonbOrder(changed),f.session.descriptor_hash),/MOCKUP_DESCRIPTOR_INVALID/);
  }
  const invalidTitle=structuredClone(f.descriptor);invalidTitle.thumbnail.titleSpec.main=' '+invalidTitle.thumbnail.titleSpec.main;
  assert.throws(()=>validateProductionDescriptor(jsonbOrder(invalidTitle),productionSnapshotHash(invalidTitle)),/MOCKUP_TITLE_UNCONFIRMED/);
});

test('order-sensitive unpublished hashes are rejected; unsupported JSON and cycles cannot collide with valid JSON',()=>{
  const f=productionDescriptorFixture(),oldHash=createHash('sha256').update(JSON.stringify(f.descriptor)).digest('hex');
  assert.notEqual(oldHash,productionSnapshotHash(f.descriptor));
  assert.throws(()=>validateProductionDescriptor(f.descriptor,oldHash),/MOCKUP_DESCRIPTOR_INVALID/);
  for(const value of [undefined,NaN,Infinity,1n,()=>true,Symbol('x'),{missing:undefined},[undefined],Array(1)])assert.throws(()=>productionSnapshotHash(value),/MOCKUP_DESCRIPTOR_INVALID/);
  const cycle={};cycle.self=cycle;assert.throws(()=>productionSnapshotHash(cycle),/MOCKUP_DESCRIPTOR_INVALID/);
  assert.equal(productionSnapshotCanonicalJson({z:[{b:2,a:1}],a:true}),' {"a":true,"z":[{"a":1,"b":2}]}'.trim());
});

test('PC and server use the shared transport hash; frozen renderer/template/title manifests remain independent',async()=>{
  const pc=await readFile(new URL('../pc-worker/preparation/mockup-service.ts',import.meta.url),'utf8');
  const server=await readFile(new URL('./production-descriptor.ts',import.meta.url),'utf8');
  assert.match(pc,/snapshotHash: productionSnapshotHash\(descriptor\)/);
  assert.match(server,/productionSnapshotHash\(value\)!==expectedHash/);
  assert.doesNotMatch(server,/JSON\.stringify\(normalizeThumbnailTitleSpec/);
  for(const file of ['approved-mockup-runtime.ts','approved-16x9-renderer.ts','thumbnail-title-overlay.ts','production-template-fingerprint.ts']) {
    assert.doesNotMatch(await readFile(new URL(file,import.meta.url),'utf8'),/production-snapshot-hash/);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {canonicalHash,createMockupSessionBinding,protectedManuscriptHash,safeLocalReviewUrl,transitionMockupSession} from './production-session.ts';
import {normalizeThumbnailTitleSpec as serverNormalize} from './production-title-schema.ts';
import {normalizeThumbnailTitleSpec as localNormalize,renderThumbnailTitleOverlay,thumbnailTitleOverlayFingerprint} from './thumbnail-title-overlay.ts';
import {productionTemplateFingerprint} from './production-template-fingerprint.ts';
import {approvedTemplateFingerprint} from './approved-mockup-suite-renderer.ts';
import {getRegisteredApprovedMockupSuite,approvedMockupSuiteTemplates} from './approved-mockup-suites.ts';
import {renderProductionThumbnail} from './production-title-renderer.ts';
import {prepareLegacyPortfolioRestore} from './image-set-legacy-restore.ts';
const title={main:'행사 대행 제안서',sub:'브랜드',showSub:true,style:'bold'};
const aspects=['16:9','a4_landscape','a4_portrait'];

test('production schema exactly matches frozen local normalization and rejects the same invalid inputs',()=>{
 const values=[title,{...title,main:'  행사   제안서  '.normalize('NFD')},{...title,sub:'',showSub:false},null,[],{},new Date(),'title',
  {...title,showSub:'false'},{...title,extra:true},{...title,main:''},{...title,main:'가'.repeat(41)},
  ...['\n','\0','\u202E','\uFE0F','\uD800','\u00A0'].map(c=>({...title,main:`제안${c}서`}))];
 const result=(fn,v)=>{try{return{value:fn(v)}}catch(e){return{error:e.message.split(':')[0]}}};
 for(const value of values)assert.deepEqual(result(serverNormalize,value),result(localNormalize,value));
});
test('pure production geometry fingerprints equal every frozen template in all three approved suites',()=>{
 for(const aspect of aspects)for(const template of approvedMockupSuiteTemplates(getRegisteredApprovedMockupSuite(aspect)))
  assert.equal(productionTemplateFingerprint(template),approvedTemplateFingerprint(template));
});
test('session bindings are source/revision/content-specific and never accept non-PPT portfolio source',()=>{
 const item={id:randomUUID(),format:'portfolio',updated_at:'2026-09-07T12:00:00Z',metadata:{generated:{bodyHtml:'본문',faq:[]}}};
 const source={originalFileName:'sample.pptx',storagePath:'private/source.pptx'},id=randomUUID();
 const binding=createMockupSessionBinding(item,id,source);
 assert.deepEqual(createMockupSessionBinding(item,id,{storagePath:source.storagePath,originalFileName:source.originalFileName}),binding);
 assert.notEqual(createMockupSessionBinding({...item,metadata:{changed:true}},id,source).expectedMetadataHash,binding.expectedMetadataHash);
 assert.notEqual(createMockupSessionBinding(item,id,{...source,storagePath:'different.pptx'}).sourceBindingHash,binding.sourceBindingHash);
 for(const invalid of [{...source,originalFileName:'file.pdf'},{}])assert.throws(()=>createMockupSessionBinding(item,id,invalid),/MOCKUP_PPTX_SOURCE_REQUIRED/);
 assert.equal(JSON.stringify(binding).includes('private/source'),false);
});
test('only exact loopback one-use launch URLs are returned to administrators',()=>{
 const valid=`http://127.0.0.1:8123/launch/${'a'.repeat(64)}`;assert.equal(safeLocalReviewUrl(valid),valid);
 for(const url of [valid.replace('127.0.0.1','localhost'),valid.replace('8123','80'),valid+'?x=1',valid+'#x',valid.replace('http:','https:'),valid.replace('/launch/','/'),valid.replace('127.0.0.1','127.0.0.1.evil.invalid'),valid.replace('127.0.0.1','user@127.0.0.1')])assert.throws(()=>safeLocalReviewUrl(url),/MOCKUP_LOCAL_URL_INVALID/);
 assert.equal(transitionMockupSession('review','uploading'),'uploading');
 for(const from of ['failed','cancelled','activated'])assert.throws(()=>transitionMockupSession(from,'queued'),/STATE_CONFLICT/);
});
test('preservation fingerprint ignores only controlled image updates; text FAQ title and publication edits are detected',()=>{
 const item={id:randomUUID(),title:'게시글 제목',published_url:'https://example.invalid/post',status:'published',metadata:{generated:{title:'원고제목',bodyHtml:'<p>문장.</p><img src="old.png">',faq:[{q:'질문',a:'답변'}]},portfolioAssets:[],styleRevision:{fingerprint:'old',version:'x'}}};
 const changed=structuredClone(item);changed.metadata.generated.bodyHtml=changed.metadata.generated.bodyHtml.replace('old.png','new.png');changed.metadata.portfolioAssets=[{url:'new.png'}];changed.metadata.styleRevision.fingerprint='new';changed.updated_at='new';
 assert.equal(protectedManuscriptHash(changed),protectedManuscriptHash(item));
 for(const mutate of [v=>v.title='변경',v=>v.status='approved',v=>v.published_url='changed',v=>v.metadata.generated.faq[0].a='변경',v=>v.metadata.generated.bodyHtml+='<p>추가</p>']){const v=structuredClone(item);mutate(v);assert.notEqual(protectedManuscriptHash(v),protectedManuscriptHash(item));}
 assert.equal(canonicalHash({b:2,a:1}),canonicalHash({a:1,b:2}));
});
test('first legacy rollback restores only image bindings, keeping subsequent editorial and publication fields',()=>{
 const old=Array.from({length:4},(_,i)=>`/old-${i}.png`),fresh=Array.from({length:4},(_,i)=>`/new-${i}.png`);
 const item={id:randomUUID(),format:'portfolio',updated_at:'now',status:'published',title:'현재 제목',published_url:'recorded URL',metadata:{generated:{bodyHtml:'<p>나중에 수정한 원고.</p>'+fresh.map(u=>`<figure><img src="${u}"></figure>`).join(''),faq:['현재 FAQ']},portfolioAssets:fresh.map(url=>({kind:'body_image',url})),portfolioImageSet:{activeSetId:randomUUID()},portfolioThumbnailVersion:{activeVersionId:randomUUID()},other:'keep'}};
 const before=structuredClone(item),history={id:randomUUID(),work_item_id:item.id,previous_set_id:null,previous_metadata:{generated:{bodyHtml:'이전 내용'},portfolioAssets:old.map(url=>({kind:'body_image',url}))}};
 const restored=prepareLegacyPortfolioRestore(item,history,'now');
 assert.deepEqual(item,before);assert.ok(restored.nextMetadata.generated.bodyHtml.includes('나중에 수정한 원고.'));assert.deepEqual(restored.nextMetadata.generated.faq,['현재 FAQ']);
 assert.deepEqual(restored.nextMetadata.portfolioAssets,history.previous_metadata.portfolioAssets);assert.equal(restored.nextMetadata.other,'keep');assert.equal('portfolioImageSet' in restored.nextMetadata,false);
 assert.throws(()=>prepareLegacyPortfolioRestore(item,history,'old'),/REVISION_CONFLICT/);
});
test('secret-free production subprocess renders identical title pixels for all three formats',async()=>{
 const base=await sharp({create:{width:1080,height:1080,channels:4,background:'#edeae6'}}).png().toBuffer();
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};
 try{for(const aspectClass of aspects){
  const rendered=await renderProductionThumbnail({basePng:base,title,aspectClass});
  const local=await renderThumbnailTitleOverlay({basePng:base,title,aspectClass,scale:1});
  assert.equal(rendered.overlayFingerprint,await thumbnailTitleOverlayFingerprint());
  assert.deepEqual(await sharp(rendered.bytes).raw().toBuffer(),await sharp(local.bytes).raw().toBuffer());
 }}finally{globalThis.fetch=originalFetch;}
});

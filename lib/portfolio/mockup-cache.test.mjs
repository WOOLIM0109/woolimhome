import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {getApprovedMockupSuiteByVersion} from './approved-mockup-suites.ts';
import {swapPortfolioBodyImages} from './body-layout.ts';
import {sanitizeGeneratedHtml} from '../security/html.ts';

// Execute the production helpers without loading the DB/Gemini worker imports.
const source=readFileSync(new URL('./job-runner.ts',import.meta.url),'utf8');
const file=ts.createSourceFile('job-runner.ts',source,ts.ScriptTarget.Latest,true);
function find(predicate){let result;const visit=node=>{if(predicate(node))result=node;else ts.forEachChild(node,visit);};visit(file);assert.ok(result);return result;}
function helper(name){return find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(file);}
const mockupOnlyMetadata=find(node=>ts.isIfStatement(node)&&node.expression.getText(file)==='!mockupOnly').getText(file);
const compiled=ts.transpileModule([
  helper('sharedMockupTemplateVersion'),helper('portfolioMockupCacheCurrent'),helper('replaceGeneratedPortfolioBodyAssets'),
  `function applyMockupOnlyMetadata(workItemMetadata, refreshedGenerated, mockupOnly) {${mockupOnlyMetadata};return workItemMetadata;}`,
].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const {portfolioMockupCacheCurrent,replaceGeneratedPortfolioBodyAssets,applyMockupOnlyMetadata}=vm.runInNewContext(
  `${compiled}\n({portfolioMockupCacheCurrent,replaceGeneratedPortfolioBodyAssets,applyMockupOnlyMetadata})`,
  {getApprovedMockupSuiteByVersion,swapPortfolioBodyImages,sanitizeGeneratedHtml},
);
const assets=(mockupMode,aspectClass,version)=>Array.from({length:mockupMode==='six_grid'?6:5},(_,index)=>({
  kind:index?'body_image':'thumbnail',mockupMode,aspectClass,...(version?{mockupTemplateVersion:version}:{}),
  url:`/new/${index}.jpg`,slideIndexes:[index],
}));

test('legacy widescreen, portrait and mixed caches redraw, including an old fallback result',()=>{
  for(const aspect of ['16:9','a4_portrait','mixed']){
    assert.equal(portfolioMockupCacheCurrent(assets('six_grid',aspect),undefined),false,aspect);
    assert.equal(portfolioMockupCacheCurrent(assets('six_grid',aspect),'approved-16x9-v1'),false,`${aspect} fallback`);
  }
  const inconsistent=[...assets('six_grid','4:3')];inconsistent[3].aspectClass='mixed';
  assert.equal(portfolioMockupCacheCurrent(inconsistent,undefined),false);
  for(const [aspect,version] of [['16:9','approved-16x9-v1'],['a4_portrait','approved-a4-portrait-v1']]){
    const thumbnailOnly=assets('six_grid',aspect);thumbnailOnly[0]=assets('short_psd',aspect,version)[0];
    assert.equal(portfolioMockupCacheCurrent(thumbnailOnly,version),false,'approved thumbnail cannot preserve old body boards');
  }
});

test('4:3 and unknown legacy caches retain the existing reuse policy',()=>{
  for(const aspect of ['4:3','unknown',undefined])assert.equal(portfolioMockupCacheCurrent(assets('six_grid',aspect),undefined),true,String(aspect));
});

test('old short portrait and mixed-portrait caches redraw while 4:3 and unknown legacy caches remain reusable',()=>{
  const boardNames=['short-main.jpg','short-detail-1.jpg','short-detail-2.jpg','short-detail-3.jpg'];
  const oldPortrait=assets('short_psd','a4_portrait','approved-16x9-v1').map((asset,index)=>({
    ...asset,mockupTemplateId:index?`legacy-a4_portrait-${boardNames[index-1]}`:'legacy-thumbnail',
  }));
  assert.equal(portfolioMockupCacheCurrent(oldPortrait,'approved-16x9-v1'),false);
  assert.equal(portfolioMockupCacheCurrent(oldPortrait.map(asset=>({...asset,aspectClass:'mixed'})),'approved-16x9-v1'),false);
  assert.equal(portfolioMockupCacheCurrent(assets('short_psd','a4_portrait','approved-a4-portrait-v1'),'approved-a4-portrait-v1'),true);
  for(const aspectClass of ['4:3','unknown']){
    const oldLegacy=oldPortrait.map(asset=>({...asset,aspectClass,mockupTemplateId:asset.mockupTemplateId.replace('a4_portrait',aspectClass)}));
    assert.equal(portfolioMockupCacheCurrent(oldLegacy,'approved-16x9-v1'),true);
  }
});

test('approved caches require one registered version matching every asset and the saved checkpoint',()=>{
  for(const [aspect,version] of [['16:9','approved-16x9-v1'],['a4_landscape','approved-a4-landscape-v1'],['a4_portrait','approved-a4-portrait-v1']]){
    const current=assets('short_psd',aspect,version);
    assert.equal(portfolioMockupCacheCurrent(current,version),true,version);
    assert.equal(portfolioMockupCacheCurrent(current,'older-version'),false);
    assert.equal(portfolioMockupCacheCurrent(current,undefined),false);
    const incomplete=structuredClone(current);delete incomplete[2].mockupTemplateVersion;
    assert.equal(portfolioMockupCacheCurrent(incomplete,version),false);
    const mixed=structuredClone(current);mixed[3].mockupTemplateVersion='other-version';
    assert.equal(portfolioMockupCacheCurrent(mixed,version),false);
  }
  assert.equal(portfolioMockupCacheCurrent(assets('short_psd','16:9','unregistered-version'),'unregistered-version'),false);
});

test('mockup-only replacement updates the displayed figure count while preserving prose and validation results',()=>{
  const oldBody=Array.from({length:5},(_,index)=>`<h2>제목 ${index}</h2><p>원래 설명 ${index}는 그대로 둡니다.</p><figure><img src="/old/${index}.jpg"><figcaption>그림 ${index}</figcaption></figure>`).join('');
  const generated={bodyHtml:oldBody,faq:[{question:'기존 질문',answer:'기존 답변'}],tags:['기존 태그']};
  const refreshed=replaceGeneratedPortfolioBodyAssets(generated,assets('short_psd','16:9','approved-16x9-v1'));
  assert.ok(refreshed);assert.equal((refreshed.bodyHtml.match(/<figure\b/gi)||[]).length,4);
  const metadata={generated,validation:{plainLength:2709,figureCount:5,issues:['기존 검수 항목'],h2Count:5},portfolioStage:'draft_completed'};
  const result=applyMockupOnlyMetadata(metadata,refreshed,true);
  assert.equal(result.validation.figureCount,4);assert.equal(result.validation.plainLength,2709);assert.equal(result.validation.h2Count,5);
  assert.deepEqual(result.validation.issues,['기존 검수 항목']);assert.deepEqual(result.generated.faq,generated.faq);assert.deepEqual(result.generated.tags,generated.tags);
  for(let index=0;index<5;index++)assert.ok(result.generated.bodyHtml.includes(`원래 설명 ${index}는 그대로 둡니다.`));
  assert.equal(result.portfolioStage,'draft_completed');
  const fresh=applyMockupOnlyMetadata({generated,validation:{figureCount:5},generatedAt:'old',draftCompletedAt:'old'},null,false);
  for(const key of ['generated','validation','generatedAt','draftCompletedAt'])assert.equal(key in fresh,false);
});

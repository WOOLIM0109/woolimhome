import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizePortfolioProjectName } from './project-name.ts';
import { inspectPortfolioDuplicates, compareProjectSources,projectHashDistance } from './project-dedupe.ts';
const row=(id,name,extra={})=>({id,project_name:name,project_key:id,status:'candidate',quality_score:80,
  naver_works_drive_files:{id,file_name:name,file_path:'완성본_외부공유금지/PPT/'+name,file_extension:'pptx',file_size:1,root_id:'root'},...extra});
test('original, copy, revisions, dates, page counts, punctuation and versions normalize identically',()=>{
  for(const value of ['판스캠 입찰제안서 원본.pptx','판스캠_입찰제안서 사본 (30p) 231218 v2.1.pdf','판스캠-입찰제안서 최종본 수정 발표본 2023-12-18.pptx'])
    assert.equal(normalizePortfolioProjectName(value),'판스캠입찰제안서');
  assert.notEqual(normalizePortfolioProjectName('2024사업계획서'),normalizePortfolioProjectName('2025사업계획서'));
});

test('observed original/copy pairs match while sampled unrelated projects stay outside the conservative threshold',()=>{
  const {images}=JSON.parse(readFileSync(new URL('./fixtures/project-hashes.json',import.meta.url),'utf8'));
  const original=images.filter(x=>x.project.includes('판스캠')&&x.project.includes('원본'));
  const copy=images.filter(x=>x.project.includes('판스캠')&&x.project.includes('사본'));
  assert.equal(original.length,4);
  for(const image of original)assert.ok(copy.some(other=>projectHashDistance(image.hash,other.hash)===0));
  for(const image of images)for(const other of images){
    if(normalizePortfolioProjectName(image.project)===normalizePortfolioProjectName(other.project))continue;
    assert.ok(projectHashDistance(image.hash,other.hash)>=18);
  }
  assert.ok(images.some(x=>x.resizeJpegDistance>4),'compression false negatives remain documented');
});
test('same project selects PPTX before date and uses copy only as the final tie-break',()=>{
  const ppt=row('ppt','판스캠 원본.pptx'),pdf=row('pdf','판스캠 사본.pdf');
  const decision=inspectPortfolioDuplicates([pdf,ppt],[],0);
  assert.deepEqual(decision.accepted.map(x=>x.id),['ppt']);assert.equal(decision.decisions.find(x=>x.candidate.id==='pdf').duplicateScore,100);
  const newer=row('new','판스캠 사본.pptx');newer.naver_works_drive_files.modified_at='2026-10-17';
  assert.ok(compareProjectSources(newer,ppt)<0);
});
test('active projects and publication ledger block candidates before any conversion',()=>{
  const a=row('a','판스캠 원본.pptx',{status:'processed'}),b=row('b','판스캠 사본.pptx');
  assert.equal(inspectPortfolioDuplicates([a,b],[],0).accepted.length,0);
  const refs=[{id:'l',title:'이미 쓴 글',url:'https://blog.naver.com/wl_0109/123',normalizedName:'판스캠',hashes:[]}];
  assert.match(inspectPortfolioDuplicates([b],refs,0).decisions[0].reason,/이미 쓴 글.*https:/);
});
test('visual distance produces a real score and blank-slide hashes do not block unrelated work',()=>{
  const a=row('a','다른 이름.pptx',{metadata:{representativeHashes:['aaaaaaaaaaaaaaaa']}});
  const ref={id:'l',title:'기존',normalizedName:'기존',hashes:['aaaaaaaaaaaaaaab']};
  const result=inspectPortfolioDuplicates([a],[ref],1).decisions[0];
  assert.equal(result.distance,1);assert.equal(result.duplicateScore,98);
  assert.equal(inspectPortfolioDuplicates([a],[ref],0).accepted.length,1);
  assert.equal(inspectPortfolioDuplicates([row('b','새 프로젝트',{metadata:{representativeHashes:['0000000000000000']}})],
    [{...ref,hashes:['0000000000000000']}],0).accepted.length,1);
});

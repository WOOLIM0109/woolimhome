import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {RETENTION_RULES,retentionCutoff} from './policy.ts';
import {parseStoredAssetUrl} from '../partner-portal.ts';

const NOW=new Date('2026-09-07T12:00:00.000Z');
const OLD='2020-01-01T00:00:00.000Z';
const RELATED=['portfolio_source_files','portfolio_rendered_slides','published_review_assets','published_work_item_body','finished_content_jobs'];
const HISTORY=['portfolio_image_sets','portfolio_thumbnail_versions','portfolio_mockup_sessions'];
const purgeSource=await readFile(new URL('./purge.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(purgeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const clone=value=>structuredClone(value);

/** Actual purger execution, but every import capable of creating a database
 * client is replaced inside an isolated VM. Unknown imports are forbidden.
 * There is no process/env/fetch/filesystem API in the evaluated module. */
function loadPurger(admin,ruleKeys=RELATED) {
  const exports={};let clients=0;
  class FixedDate extends Date {
    constructor(...args){super(...(args.length?args:[NOW.getTime()]));}
    static now(){return NOW.getTime();}
  }
  const imports={
    '@/lib/supabase/admin':{createAdminClient(){clients++;return admin;}},
    '@/lib/partner-portal':{parseStoredAssetUrl},
    '@/lib/retention/policy':{RETENTION_RULES:RETENTION_RULES.filter(rule=>ruleKeys.includes(rule.key)),retentionCutoff},
  };
  const context=vm.createContext({exports,module:{exports},Date:FixedDate,require(specifier){if(!Object.hasOwn(imports,specifier))throw Error(`UNEXPECTED_IMPORT:${specifier}`);return imports[specifier];}});
  vm.runInContext(compiled,context,{timeout:1000,filename:'retention-purge-under-test.cjs'});
  return {async run(now=NOW){return JSON.parse(JSON.stringify(await exports.purgeRetention(now)));},clients:()=>clients};
}

function database(initial,{missingTables=[]}={}) {
  const tables=clone(initial),calls=[],writes=[],removed=[];
  const value=(row,column)=>{
    if(column.startsWith('content_work_items.'))return tables.content_work_items.find(item=>item.id===row.work_item_id)?.[column.split('.')[1]];
    const parts=column.split(/->>?/);let found=row;
    for(const key of parts)found=found?.[key];return found??null;
  };
  const admin={
    from(table){
      const call={table,action:'select',filters:[]};calls.push(call);let maximum=Infinity,ordering=null,single=false,patch=null;
      const filters=[];
      const query={
        select(columns){call.columns=columns;return query;},
        eq(column,expected){filters.push(row=>value(row,column)===expected);call.filters.push(['eq',column,expected]);return query;},
        neq(column,expected){filters.push(row=>value(row,column)!==expected);return query;},
        lt(column,expected){filters.push(row=>value(row,column)!==null&&value(row,column)<expected);return query;},
        in(column,expected){filters.push(row=>expected.includes(value(row,column)));call.filters.push(['in',column,clone(expected)]);return query;},
        is(column,expected){filters.push(row=>value(row,column)===expected);return query;},
        not(column,operator,expected){assert.equal(operator,'is');filters.push(row=>value(row,column)!==expected);return query;},
        order(column,{ascending=true}={}){ordering={column,ascending};return query;},
        limit(n){maximum=n;return query;},
        maybeSingle(){single=true;return query;},
        update(next){call.action='update';patch=clone(next);return query;},
        delete(){call.action='delete';return query;},
        then(resolve,reject){return Promise.resolve().then(()=>{
          if(missingTables.includes(table))return {data:null,error:{message:`missing table ${table}`}};
          const source=tables[table]??[];let matching=source.filter(row=>filters.every(filter=>filter(row)));
          if(ordering)matching.sort((a,b)=>String(value(a,ordering.column)).localeCompare(String(value(b,ordering.column)))*(ordering.ascending?1:-1));
          matching=matching.slice(0,maximum);
          if(call.action!=='select') {
            writes.push({table,action:call.action,ids:matching.map(row=>row.id),patch:clone(patch)});
            if(call.action==='delete')tables[table]=source.filter(row=>!matching.includes(row));
            else for(const row of matching)Object.assign(row,clone(patch));
          }
          return {data:clone(single?(matching[0]??null):matching),error:null};
        }).then(resolve,reject);},
      };
      return query;
    },
    storage:{from(bucket){return {async remove(paths){removed.push({bucket,paths:clone(paths)});return {error:null};}};}},
  };
  return {admin,tables,calls,writes,removed};
}

function dataset(specs) {
  const tables={content_work_items:[],content_jobs:[],content_review_assets:[],portfolio_image_sets:[],portfolio_thumbnail_versions:[],portfolio_mockup_sessions:[],bot_traffic_logs:[]};
  for(const [index,spec] of specs.entries()) {
    const id=spec.id??`work-${index}`,metadata={generated:{title:'합성 원고',bodyHtml:'<p>합성 테스트 본문</p>',faq:[{question:'Q',answer:'A'}]},...clone(spec.metadata??{})};
    tables.content_work_items.push({id,status:spec.status??'published',published_at:spec.publishedAt??OLD,updated_at:OLD,metadata,title:'유지할 제목',published_url:`https://example.invalid/${id}`});
    for(const jobType of ['download','convert','mockup','draft']) {
      const result=jobType==='download'?{bucket:'portfolio-sources',storagePath:`legacy/${id}/source.pptx`,originalFileName:'synthetic.pptx'}
        :jobType==='convert'?{bucket:'portfolio-rendered',slidePaths:[`legacy/${id}/slide-1.png`,`legacy/${id}/slide-2.png`]}
        :{checkpoint:'synthetic evidence'};
      tables.content_jobs.push({id:`${id}-${jobType}`,work_item_id:id,job_type:jobType,status:'completed',created_at:OLD,updated_at:OLD,result});
    }
    for(let i=0;i<5;i++)tables.content_review_assets.push({id:`${id}-asset-${i}`,work_item_id:id,created_at:OLD,
      public_url:`/api/admin/assets?bucket=portfolio-rendered&path=${encodeURIComponent(`legacy/${id}/board-${i}.png`)}`});
    if(spec.history)tables[spec.history].push({id:`${id}-history`,work_item_id:id,status:spec.sessionStatus??'activated'});
  }
  return tables;
}
const keptSnapshot=(tables,id)=>({item:tables.content_work_items.find(item=>item.id===id),jobs:tables.content_jobs.filter(job=>job.work_item_id===id),assets:tables.content_review_assets.filter(asset=>asset.work_item_id===id)});

test('active pointers, every in-flight session state, final history and legacy rollback history preserve manuscript, images, raw objects and download evidence',async()=>{
  const specs=[{id:'active-set',metadata:{portfolioImageSet:{activeSetId:'set'}}},{id:'active-title',metadata:{portfolioThumbnailVersion:{activeVersionId:'title'}}},
    ...['queued','preparing','review','uploading','staged','activated','failed','cancelled'].map(status=>({id:`session-${status}`,history:'portfolio_mockup_sessions',sessionStatus:status})),
    {id:'rolled-back-set',history:'portfolio_image_sets'},{id:'rolled-back-title',history:'portfolio_thumbnail_versions'}];
  const initial=dataset(specs),db=database(initial),purger=loadPurger(db.admin),report=await purger.run();
  assert.equal(purger.clients(),1);assert.equal(report.totals.failed,0);assert.equal(report.totals.rows,0);assert.equal(report.totals.files,0);
  assert.deepEqual(db.tables,initial);assert.deepEqual(db.writes,[]);assert.deepEqual(db.removed,[]);
  assert.ok(db.calls.some(call=>call.table==='portfolio_mockup_sessions'));
});

test('mixed pages retain protected history but still purge legacy published assets/jobs and clear body without deleting publication rows',async()=>{
  const initial=dataset([{id:'protected',history:'portfolio_image_sets'},{id:'legacy'},{id:'unpublished',status:'review_required'},{id:'recent',publishedAt:NOW.toISOString()}]);
  const db=database(initial),purger=loadPurger(db.admin),report=await purger.run();assert.equal(report.totals.failed,0);
  for(const id of ['protected','unpublished','recent'])assert.deepEqual(keptSnapshot(db.tables,id),keptSnapshot(initial,id));
  const legacy=keptSnapshot(db.tables,'legacy');assert.equal(legacy.assets.length,0);
  // Source/convert rows just received purge markers, so their updated_at is
  // fresh; the existing policy removes these marked rows on a later run.
  assert.deepEqual(legacy.jobs.map(job=>job.job_type).sort(),['convert','download']);
  assert.ok(legacy.jobs.find(job=>job.job_type==='download').result.purgedAt);
  assert.ok(legacy.jobs.find(job=>job.job_type==='convert').result.slidesPurgedAt);
  assert.equal(legacy.item.metadata.generated,undefined);assert.ok(legacy.item.metadata.bodyPurgedAt);
  assert.equal(legacy.item.title,'유지할 제목');assert.equal(legacy.item.published_url,'https://example.invalid/legacy');
  assert.equal(db.tables.content_work_items.length,4);
  assert.equal(report.entries.find(entry=>entry.key==='portfolio_source_files').files,1);
  assert.equal(report.entries.find(entry=>entry.key==='portfolio_rendered_slides').files,2);
  assert.equal(report.entries.find(entry=>entry.key==='published_review_assets').rows,5);
  assert.equal(report.entries.find(entry=>entry.key==='published_work_item_body').rows,1);
  assert.equal(report.entries.find(entry=>entry.key==='finished_content_jobs').rows,2);
  assert.ok(db.removed.flatMap(call=>call.paths).every(path=>path.startsWith('legacy/legacy/')));
  const later=await purger.run(new Date('2026-10-10T12:00:00.000Z'));
  assert.equal(later.totals.failed,0);assert.equal(keptSnapshot(db.tables,'legacy').jobs.length,0);
  assert.deepEqual(keptSnapshot(db.tables,'protected'),keptSnapshot(initial,'protected'));
});

test('each missing new history table blocks all related deletion before the first DB/storage mutation',async()=>{
  for(const table of HISTORY) {
    const initial=dataset([{id:'old-published'}]),db=database(initial,{missingTables:[table]}),report=await loadPurger(db.admin).run();
    assert.equal(report.totals.failed,RELATED.length,table);
    assert.ok(report.entries.every(entry=>entry.error==='MOCKUP_RETENTION_HISTORY_UNAVAILABLE'),table);
    assert.deepEqual(db.tables,initial,table);assert.deepEqual(db.writes,[],table);assert.deepEqual(db.removed,[],table);
  }
});

test('missing production history does not disable unrelated legacy log retention',async()=>{
  const initial=dataset([{id:'safe-retain'}]);initial.bot_traffic_logs=[{id:'old-log',accessed_at:OLD},{id:'new-log',accessed_at:NOW.toISOString()}];
  const db=database(initial,{missingTables:['portfolio_image_sets']}),report=await loadPurger(db.admin,[...RELATED,'bot_traffic_logs']).run();
  assert.equal(report.totals.failed,RELATED.length);assert.equal(report.entries.find(entry=>entry.key==='bot_traffic_logs').rows,1);
  assert.deepEqual(keptSnapshot(db.tables,'safe-retain'),keptSnapshot(initial,'safe-retain'));
  assert.deepEqual(db.tables.bot_traffic_logs,[{id:'new-log',accessed_at:NOW.toISOString()}]);assert.deepEqual(db.removed,[]);
});

test('malformed pointer presence is retained even before an immutable history row is available',async()=>{
  for(const key of ['portfolioImageSet','portfolioThumbnailVersion'])for(const pointer of [null,false,'']) {
    const initial=dataset([{id:'malformed',metadata:{[key]:pointer}}]),db=database(initial),report=await loadPurger(db.admin).run();
    assert.equal(report.totals.rows,0,`${key} ${String(pointer)}`);
    assert.equal(report.totals.files,0);assert.deepEqual(db.tables,initial);assert.deepEqual(db.removed,[]);
  }
});

test('verified storage prefixes are never passed to remove even for unbound legacy cleanup data',async()=>{
  const initial=dataset([{id:'legacy'}]);
  initial.content_review_assets[0].public_url='/api/admin/assets?bucket=portfolio-rendered&path=verified-local%2Fsynthetic%2F0.png';
  initial.content_review_assets[1].public_url='/api/admin/assets?bucket=portfolio-rendered&path=verified-thumbnail%2Fsynthetic.png';
  const db=database(initial),report=await loadPurger(db.admin,['published_review_assets']).run();
  assert.equal(report.totals.failed,0);assert.equal(report.totals.files,3);
  assert.ok(db.removed.flatMap(call=>call.paths).every(path=>!path.startsWith('verified-')));
});

test('history reads stay bounded to at most 100 IDs and protect later chunks too',async()=>{
  const specs=Array.from({length:105},(_,i)=>({id:`work-${i}`,history:i===104?'portfolio_image_sets':undefined}));
  const initial=dataset(specs),db=database(initial),report=await loadPurger(db.admin,['published_work_item_body']).run();
  assert.equal(report.totals.failed,0);assert.equal(report.totals.rows,104);
  assert.deepEqual(keptSnapshot(db.tables,'work-104'),keptSnapshot(initial,'work-104'));
  const historyReads=db.calls.filter(call=>HISTORY.includes(call.table));assert.equal(historyReads.length,6);
  for(const call of historyReads)assert.ok(call.filters.find(filter=>filter[0]==='in')[2].length<=100);
});

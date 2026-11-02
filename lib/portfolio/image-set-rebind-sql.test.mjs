import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { productionDescriptorFixture } from './production-descriptor.test-support.mjs';
import { productionSetManifest } from './production-descriptor.ts';
import { preparePortfolioImageSetCommit } from './image-set.ts';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table portfolio_candidates(id uuid primary key);
    create table content_work_items(id uuid primary key,format text,status text,title text,summary text,
      published_url text,published_url_normalized text,published_at timestamptz,metadata jsonb,updated_at timestamptz);
    create table content_review_assets(id uuid primary key default gen_random_uuid(),work_item_id uuid references content_work_items,
      asset_type text,public_url text,sort_order integer,approved boolean,review_note text,created_at timestamptz default now());
    grant usage on schema public to service_role,anon,authenticated;
    grant all on all tables in schema public to service_role;
  `);
  for (const name of ['202609070001_portfolio_image_sets.sql','202609070003_portfolio_mockup_sessions.sql',
    '202611020001_portfolio_mockup_manuscript_rebind.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
  }
  return db;
}

async function staged(db, { legacyBinding = false, activeSetId = null } = {}) {
  const f = productionDescriptorFixture();
  const current = structuredClone(f.initial);
  current.updated_at = '2026-09-07T13:00:00.000Z';
  current.metadata.generated.bodyHtml = current.metadata.generated.bodyHtml.replaceAll('기존 설명 문단입니다.','새로 쓴 설명입니다.');
  current.metadata.generated.faq = [{ question:'다시 쓴 질문',answer:'최신 답변' }];
  if (activeSetId) current.metadata.portfolioImageSet = { activeSetId };
  const set = productionSetManifest(f.descriptor,f.id,f.sessionId,'admin','2026-09-07T14:00:00.000Z');
  const commit = preparePortfolioImageSetCommit(current,{set,expectedUpdatedAt:current.updated_at,
    expectedActiveSetId:activeSetId,actor:'admin',activatedAt:'2026-09-07T14:00:00.000Z'});
  const binding = { ...f.session.binding,expectedActiveSetId:activeSetId };
  if (legacyBinding) delete binding.expectedActiveSetId;
  await db.query('insert into portfolio_candidates values($1)',[f.candidateId]);
  const initialMetadata = structuredClone(current.metadata);
  delete initialMetadata.portfolioImageSet;
  await db.query(`insert into content_work_items(id,format,status,title,summary,metadata,updated_at)
    values($1,'portfolio','review_required',$2,$3,$4,$5)`,[f.id,current.title,current.summary,initialMetadata,current.updated_at]);
  await db.query(`insert into content_review_assets(work_item_id,asset_type,public_url,sort_order)
    values($1,'article_preview','/keep-preview',10)`,[f.id]);
  if (activeSetId) await db.query('update content_work_items set metadata=$1 where id=$2',[current.metadata,f.id]);
  await db.query(`insert into portfolio_mockup_sessions(id,work_item_id,candidate_id,requested_by,binding,status,source_hash,descriptor_hash,descriptor)
    values($1,$2,$3,'admin',$4,'staged',$5,$6,$7)`,[f.sessionId,f.id,f.candidateId,binding,f.session.source_hash,f.session.descriptor_hash,f.descriptor]);
  const activate = (patch = {}) => {
    const c = { ...commit,...patch };
    return db.query('select activate_portfolio_mockup_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as receipt',
      [f.sessionId,f.session.descriptor_hash,f.id,c.expectedUpdatedAt,c.expectedActiveSetId,c.expectedMetadata,c.nextMetadata,c.set,c.activatedBy,c.activatedAt]);
  };
  const snapshot = async () => {
    const rows = {};
    for (const table of ['content_work_items','content_review_assets','portfolio_mockup_sessions','portfolio_image_sets','portfolio_image_set_activations']) {
      rows[table] = (await db.query(`select to_jsonb(t) as row from ${table} t where ${table==='content_work_items'?'id':'work_item_id'}=$1 order by id`,[f.id])).rows;
    }
    return rows;
  };
  return { ...f,current,set,commit,activate,snapshot };
}

test('SQL activation reuses reviewed sets after text edits while retaining write and review guards',async t=>{
  const db = await database();
  try {
    await t.test('both RPCs accept a new manuscript revision and preserve its four placements and text',async()=>{
      const f = await staged(db,{legacyBinding:true});
      assert.notEqual(f.session.binding.expectedUpdatedAt,f.current.updated_at);
      await db.exec('set role service_role');
      const { rows:[{ receipt }] } = await f.activate();
      await db.exec('reset role');
      assert.equal(receipt.activeSetId,f.sessionId);
      const { rows:[item] } = await db.query('select * from content_work_items where id=$1',[f.id]);
      assert.deepEqual(item.metadata.generated.faq,f.current.metadata.generated.faq);
      assert.ok(item.metadata.generated.bodyHtml.includes('새로 쓴 설명입니다.'));
      for (const asset of f.set.assets.slice(1)) assert.equal(item.metadata.generated.bodyHtml.split(asset.url.replaceAll('&','&amp;')).length-1,1);
      assert.equal(item.metadata.generated.bodyHtml.includes('/legacy-'),false);
      assert.equal((await db.query('select * from content_review_assets where work_item_id=$1',[f.id])).rows.length,6);
      assert.equal((await db.query('select * from portfolio_image_set_activations where work_item_id=$1',[f.id])).rows.length,1);
      await f.activate();
      assert.equal((await db.query('select * from portfolio_image_set_activations where work_item_id=$1',[f.id])).rows.length,1);
    });
    await t.test('metadata changed after reading still fails without any image or session writes',async()=>{
      const f = await staged(db);
      await db.query("update content_work_items set metadata=metadata || '{\"changedDuringCommit\":true}' where id=$1",[f.id]);
      const before = await f.snapshot();
      await assert.rejects(f.activate(),/IMAGE_SET_REVISION_CONFLICT/);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('a newer timestamp during the write still fails even with identical metadata',async()=>{
      const f = await staged(db);
      await db.query("update content_work_items set updated_at=updated_at+interval '1 second' where id=$1",[f.id]);
      const before = await f.snapshot();
      await assert.rejects(f.activate(),/IMAGE_SET_REVISION_CONFLICT/);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('another active set cannot replace the base recorded in the reviewed session',async()=>{
      const f = await staged(db,{activeSetId:randomUUID()}),before = await f.snapshot();
      await assert.rejects(f.activate({expectedActiveSetId:randomUUID()}),/MOCKUP_SESSION_REVIEW_STALE/);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('a legacy session missing its base cannot authorize a nonempty active set',async()=>{
      const f = await staged(db,{legacyBinding:true,activeSetId:randomUUID()}),before = await f.snapshot();
      await assert.rejects(f.activate(),/MOCKUP_SESSION_REVIEW_STALE/);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('changed descriptor or source attestation still fails before storing any images',async()=>{
      for (const change of ["descriptor_hash=repeat('0',64)","source_hash=repeat('0',64)"]) {
        const f = await staged(db);
        await db.query(`update portfolio_mockup_sessions set ${change} where id=$1`,[f.sessionId]);
        const before = await f.snapshot();
        await assert.rejects(f.activate(),/MOCKUP_SESSION_REVIEW_STALE/);
        assert.deepEqual(await f.snapshot(),before);
      }
    });
    await t.test('publication after the server read blocks a new activation under the row lock',async()=>{
      const f = await staged(db);
      await db.query("update content_work_items set status='published' where id=$1",[f.id]);
      const before = await f.snapshot();
      await assert.rejects(f.activate(),/IMAGE_SET_PUBLISHED_LOCKED/);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('anonymous and authenticated callers cannot execute either activation RPC',async()=>{
      for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          for (const signature of ['activate_portfolio_image_set(uuid,timestamptz,uuid,jsonb,jsonb,jsonb,text,text,timestamptz)',
            'activate_portfolio_mockup_session(uuid,text,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,text,timestamptz)']) {
            const {rows:[value]} = await db.query('select has_function_privilege(current_user,$1,\'execute\') as allowed',[signature]);
            assert.equal(value.allowed,false);
          }
        } finally { await db.exec('reset role'); }
      }
    });
  } finally { await db.close(); }
});

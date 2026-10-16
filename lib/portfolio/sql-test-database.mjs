import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Minimal relational fixture, with the production FK actions used by these migrations.
// All databases are in memory; no environment credentials or network calls are used.
export async function portfolioTestDatabase(migrations) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table naver_works_drive_files(id uuid primary key default gen_random_uuid());
    create table portfolio_candidates(id uuid primary key default gen_random_uuid(),drive_file_id uuid references naver_works_drive_files,
      project_name text,status text default 'candidate',duplicate_score numeric default 0,quality_score numeric default 0,
      font_status text default 'unchecked',missing_fonts text[] default '{}',selection_reasons text[] default '{}',
      exclusion_reasons text[] default '{}',metadata jsonb default '{}',updated_at timestamptz default now());
    create table content_work_items(id uuid primary key default gen_random_uuid(),channel text,format text,title text,
      status text,summary text,source_label text,source_reference text,scheduled_at timestamptz,schedule_key text unique,created_by text,
      published_url text,published_url_normalized text,published_at timestamptz,metadata jsonb default '{}',updated_at timestamptz default now());
    create table content_jobs(id uuid primary key default gen_random_uuid(),candidate_id uuid references portfolio_candidates,
      work_item_id uuid references content_work_items on delete cascade,job_type text,status text,payload jsonb default '{}');
    create table portfolio_image_sets(id uuid primary key default gen_random_uuid(),work_item_id uuid not null references content_work_items on delete cascade,manifest jsonb);
    create table portfolio_mockup_sessions(id uuid primary key default gen_random_uuid(),work_item_id uuid references content_work_items on delete cascade,status text);
    create table content_workers(id uuid primary key default gen_random_uuid(),current_job_id uuid references content_jobs on delete set null);
  `);
  for (const table of ['content_review_assets','portfolio_image_set_activations','portfolio_thumbnail_versions',
    'portfolio_thumbnail_version_activations','portfolio_thumbnail_candidates','content_publication_events']) {
    await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),work_item_id uuid references content_work_items on delete cascade,metadata jsonb default '{}');`);
  }
  await db.exec('grant usage on schema public to service_role,anon,authenticated; grant all on all tables in schema public to service_role;');
  for (const name of migrations) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
  return db;
}
export const ledgerMigrations = ['20261016190043_portfolio_publication_ledger.sql','20261016190241_portfolio_publication_registration.sql'];

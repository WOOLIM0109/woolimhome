-- Prepared only. Apply with owner approval before deploying the draft worker.
alter table public.content_work_items drop constraint content_work_items_status_check;
alter table public.content_work_items add constraint content_work_items_status_check
  check (status in ('topic_candidate','researching','creating','draft_waiting','review_required',
    'approved','naver_ready','scheduled','published','on_hold'));
alter table public.content_jobs drop constraint content_jobs_status_check;
alter table public.content_jobs add constraint content_jobs_status_check
  check (status in ('queued','running','completed','on_hold','failed','pc_waiting','pc_running','draft_waiting'));

import assert from 'node:assert/strict';
import test from 'node:test';
import {portfolioDisplayState} from './display-state.ts';
test('real hold reasons have distinct badges and visible missing fonts',()=>{
 assert.deepEqual(portfolioDisplayState({status:'on_hold',review_note:'MISSING_FONTS: PowerPoint cannot find these source fonts: Work Sans SemiBold, Söhne.'}),
   {label:'글꼴 대기',detail:'Work Sans SemiBold, Söhne'});
 assert.equal(portfolioDisplayState({status:'on_hold',review_note:'PC worker retry limit reached (3/3).'}).label,'변환 실패(재시도 한도)');
 assert.equal(portfolioDisplayState({status:'draft_waiting',review_note:'오늘 상한 도달'}).detail,'오늘 상한 도달');
 assert.equal(portfolioDisplayState({status:'published',metadata:{portfolioStage:'design_completed'}}),null);
});

test('a missing body and empty job queue ask for manual recovery instead of waiting', () => {
  const item = {
    status: 'creating',
    metadata: {
      portfolioStage: 'design_completed',
      portfolioAssets: Array.from({length: 5}, (_, index) => ({
        kind: index === 0 ? 'thumbnail' : 'body_image', url: `/mockup-${index}.png`,
      })),
    },
    portfolio_jobs: [],
  };
  assert.deepEqual(portfolioDisplayState(item), {
    label: '본문 다시 만들기 필요',
    detail: '본문을 작성할 작업이 없어 자동으로 이어지지 않습니다. ‘글만 다시 쓰기’ 또는 ‘이미지와 글 전부 다시 만들기’를 눌러 주세요.',
  });
  for (const generated of [{}, {bodyHtml: ''}, {bodyHtml: '   '}]) {
    assert.equal(portfolioDisplayState({...item, metadata: {...item.metadata, generated}}).label, '본문 다시 만들기 필요');
  }
  assert.equal(portfolioDisplayState({...item, status: 'published'}), null);
});

test('existing jobs, saved body, and unknown job data keep their current display', () => {
  const item = {status: 'creating', metadata: {portfolioStage: 'design_completed'}};
  for (const status of ['queued', 'running', 'failed', 'draft_waiting', 'completed']) {
    assert.deepEqual(portfolioDisplayState({...item, portfolio_jobs: [{job_type: 'draft', status}]}), {
      label: '본문 작성 대기', detail: '대기열에서 순서대로 작성합니다.',
    });
  }
  assert.equal(portfolioDisplayState(item).label, '본문 작성 대기');
  assert.equal(portfolioDisplayState({...item, portfolio_jobs: [], metadata: {
    ...item.metadata, generated: {bodyHtml: '<p>저장된 본문</p>'},
  }}).label, '본문 작성 대기');
  assert.equal(portfolioDisplayState({...item, portfolio_jobs: [], review_note: 'MISSING_FONTS: fonts: Work Sans.'}).label, '글꼴 대기');
});

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

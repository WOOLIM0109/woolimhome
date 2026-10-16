import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITORIAL_SLOTS } from './config.ts';
test('portfolio has exactly one Tuesday 09:00 slot and never creates a Friday slot',()=>{
 const slots=EDITORIAL_SLOTS.filter(slot=>slot.channel==='naver_design'&&slot.format==='portfolio');
 assert.deepEqual(slots.map(({key,weekday,hour})=>({key,weekday,hour})),[{key:'design-tue',weekday:2,hour:9}]);
 assert.ok(!EDITORIAL_SLOTS.some(slot=>slot.key==='design-fri'));
 assert.ok(EDITORIAL_SLOTS.some(slot=>slot.key==='design-thu'&&slot.weekday===4&&slot.hour===9&&slot.format==='design_insight'));
 for(let day=0;day<14;day++) if(day%7===5) assert.equal(slots.filter(slot=>slot.weekday===day%7).length,0);
});

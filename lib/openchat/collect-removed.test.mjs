// 홈페이지 자체 공고수집이 다시 돌 수 있는 길이 남아 있지 않은지 지킨다.
//
// 2026-11-07 에 크론에서 morning-collect 를 빼고 morning-queue 로 바꿨다.
// 그런데 **버튼과 주소가 그대로 남아 있었다**. 관리자 화면의 '전체 수집·복구'
// 를 한 번 누르면 홈페이지가 다시 21개 게시판을 훑어 공고를 넣는다.
//
// 그렇게 들어간 행은 수집기 자료를 막는다. 실측 2026-11-08: 판판대로
// '소담상회 with LOTTE ON' 이 홈페이지 행으로 남아 마감 2026-09-11 ·
// status excluded 였고, 수집기가 보낸 마감 2026-11-16 이 덮지 못해서
// 아직 20일 남은 공고가 화면에서 제외로 보였다.
//
// 공고 수집은 PC 수집기 하나로 모았다 — 해외 서버에서는 부산테크노파크 ·
// 부산경제진흥원 · IP지역지식재산센터에 연결조차 되지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const 읽기 = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** 그 파일의 TASKS 목록에 적힌 작업 이름들. */
function 돌릴수있는작업(path) {
  const 글 = 읽기(path);
  const m = 글.match(/const TASKS: OpenchatCronTask\[\] = \[([\s\S]*?)\];/);
  assert.ok(m, `${path} 에서 TASKS 목록을 찾지 못했다`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((하나) =>하나[1]);
}

const 막아야할것 = ["morning-collect", "morning-repair"];

test("관리자 화면에서 자체수집 작업을 돌릴 수 없다", () => {
  const 작업들 = 돌릴수있는작업("app/api/admin/openchat/run/route.ts");
  for (const 막을것 of 막아야할것) {
    assert.ok(!작업들.includes(막을것), `${막을것} 이 아직 돌 수 있다`);
  }
  assert.ok(작업들.includes("morning-queue"), "줄 세우기는 돌 수 있어야 한다");
});

test("크론 주소로도 자체수집을 돌릴 수 없다", () => {
  const 작업들 = 돌릴수있는작업("app/api/cron/openchat/[task]/route.ts");
  for (const 막을것 of 막아야할것) {
    assert.ok(!작업들.includes(막을것), `${막을것} 이 아직 돌 수 있다`);
  }
  assert.ok(작업들.includes("morning-queue"), "줄 세우기는 돌 수 있어야 한다");
});

test("관리자 화면에 자체수집 버튼이 없다", () => {
  const 화면 = 읽기("components/admin/OpenchatOperations.tsx");
  for (const 막을것 of 막아야할것) {
    assert.ok(!화면.includes(`run("${막을것}")`),
      `'${막을것}' 를 부르는 버튼이 아직 있다`);
  }
  assert.ok(화면.includes('run("morning-queue")'), "줄 세우기 버튼은 남아 있어야 한다");
});

test("크론 설정에도 자체수집이 없다", () => {
  const crons = JSON.parse(읽기("vercel.json")).crons ?? [];
  const 주소들 = crons.map((하나) => 하나.path);
  for (const 막을것 of 막아야할것) {
    assert.ok(!주소들.some((주소) => 주소.endsWith(`/${막을것}`)),
      `${막을것} 크론이 아직 걸려 있다`);
  }
  assert.ok(주소들.some((주소) => 주소.endsWith("/morning-queue")),
    "줄 세우기 크론은 걸려 있어야 한다");
});

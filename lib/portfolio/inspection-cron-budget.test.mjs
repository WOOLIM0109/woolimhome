import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

test('portfolio inspection cutoff leaves the existing first generation stage within the shared cron budget',()=>{
  const source=readFileSync('app/api/cron/content-operations/route.ts','utf8');
  const budget=source.match(/prepareNextPortfolioCandidate\(\{[^}]*deadlineAt:\s*runStartedAt\s*\+\s*([\d_]+)/)?.[1];
  assert.ok(budget,'only the portfolio preparation branch receives the inspection deadline');
  const inspectionBudget=Number(budget.replaceAll('_',''));
  assert.equal(inspectionBudget,90_000);
  const deadlineExports={};
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/content-ops/deadline.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:deadlineExports,Date,Error});
  const {GENERATION_BUDGET_MS,STAGE_BUDGET_MS,assertStageFits}=deadlineExports;
  assert.ok(inspectionBudget+STAGE_BUDGET_MS.topicPlan<GENERATION_BUDGET_MS);
  assert.doesNotThrow(()=>assertStageFits('topicPlan',GENERATION_BUDGET_MS,inspectionBudget));
  assert.match(source,/inspection:\s*prepared\.inspection/);
});

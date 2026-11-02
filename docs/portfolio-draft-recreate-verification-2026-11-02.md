# 포트폴리오 본문 작업 복구 검증 — 2026-11-02

대상 브랜치: `fix/portfolio-draft-recreate-20261102`

최신 `npm run verify`는 시험 1643개 중 1632개 통과, 6개 실패, 5개 건너뜀으로 실패 종료했다. TypeScript와 ESLint는 통과했다. 전체 검증의 실패 6개는 `production-bridge.test.mjs` 5개와 PowerPoint COM 시험 1개다. 이후 샌드박스 밖 별도 실행에서 bridge 파일은 20개 모두, 선택한 PowerPoint COM 시험은 1개 모두 통과했다. 전체 검증에서 실패한 6개는 이 별도 재시험에 모두 포함되며 추가 재시험에서 재현된 실패는 0개다. 전체 검증 자체가 통과한 것으로 계산하지 않으며, 전체 실행의 실패 6개와 건너뜀 5개 기록은 유지한다.

새 동작 시험은 서버 19개와 표시 3개, 총 22개가 모두 통과했다. 아래에는 세 번의 전체 실행에서 나온 실패 이름, 오류, 스택과 명령 원문을 각각 보존했다.

작업이 없는 포트폴리오의 본문 작업 생성, 기존 작업 재사용, 본문 없는 전체 다시 만들기, 관리자 안내를 시험했다. 발행 완료 차단, Gemini 사용 중단·예산 차단, 수동 이미지 확인 절차도 회귀 시험에 포함했다.

## 새 동작 시험

```text
node --test lib/portfolio/draft-recreate.test.mjs lib/portfolio/display-state.test.mjs
```

22개 모두 통과했다. 서버 동작 19개와 표시 동작 3개다.

## 최초 전체 검증

```text
npm run verify
```

원본 로그: 작업 폴더의 `verify-draft-recreate.log`. UTF-16LE BOM을 확인하고 전체 파일을 읽었다. 아래 원문은 Node 시험 실행기가 출력한 실패 요약을 그대로 옮겼다. PowerShell 오류의 깨진 문자, 명령 문자열, 스택, 줄바꿈을 임의로 고치지 않았다.

| 단계 | 전체 | 통과 | 실패 | 건너뜀 |
| --- | ---: | ---: | ---: | ---: |
| TypeScript (`tsc --noEmit`) | — | 통과 | 0 | 0 |
| ESLint (`eslint`) | — | 통과 | 0 | 0 |
| Parallel, 184개 파일 | 1584 | 1559 | 20 | 5 |
| PowerPoint serial, 3개 파일 | 57 | 56 | 1 | 0 |
| 시험 합계 | 1641 | 1615 | 21 | 5 |

Parallel의 실패 20개는 `production-bridge.test.mjs` 9개와 `runtime-package.test.mjs` 11개다. `runtime-package.test.mjs`에서 Windows 조건으로 건너뛴 5개도 공통 `before` hook 오류와 함께 실패 요약에 출력되므로 아래에 포함했다. 따라서 Parallel 원문에는 실패 20개와 건너뜀 5개, 총 25개 항목이 있다. PowerPoint serial 원문에는 실패 1개가 있다.

### Parallel 실패 요약 원문

```text
✖ failing tests:

test at lib\pc-worker\preparation\production-bridge.test.mjs:283:1
✖ explicit preparation review applies into a fresh generation and swaps editor only after verified success (1.6009ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:284:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:301:1
✖ manual preparation selection reaches only the fresh generation and empty selection keeps automatic defaults (1.8672ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:303:15)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:315:1
✖ failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts (1.0802ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:319:15)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:331:1
✖ restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory (1ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:332:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:346:1
✖ preparation actions serialize and uploading sessions cannot change selection or source format (0.95ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:348:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:359:1
✖ explicit reopen rotates only launch token with no preparation, source download or record mutation (0.9648ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:360:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:371:1
✖ missing local token-rotation feature fails safely without conversion or requeue (0.8019ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:372:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:380:1
✖ verified snapshot upload holds exclusive preparation lock through record commit (1.1011ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:384:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:401:1
✖ failed snapshot upload releases preparation lock and preserves review record (1.0233ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:232:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:403:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }

test at lib\pc-worker\preparation\runtime-package.test.mjs:39:1
﹣ dependency collection excludes npm bin links before recursion but includes locked nested semver (202.2216ms) # SKIP
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:50:1
﹣ dependency payload rejects internal external and broken symlinks (1.3213ms) # SKIP
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:62:1
﹣ dependency roots and excluded node_modules must be real directories (0.2386ms) # SKIP
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:79:1
✖ dependency payload still rejects hard links and environment files (0.1169ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:89:1
﹣ dependency payload rejects special files before reading them (0.0985ms) # SKIP
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:95:1
✖ finished package inspection never excludes unexpected node_modules entries (0.0813ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:103:1
﹣ finished package inspection rejects unexpected node_modules symlinks (0.0628ms) # SKIP
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:111:1
✖ fixed preparation payload includes local editor, title and PowerPoint adapter without secrets or app code (0.0764ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:126:1
✖ offline package is reproducible and does not overwrite nonempty destinations (0.1114ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:132:1
✖ immutable package verification requires an external trusted fingerprint and platform match (0.1358ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:138:1
✖ changed source, unexpected env file and altered manifest each fail closed (0.1712ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:153:1
✖ Node policy rejects pre-22.6 and malformed versions (0.0663ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:158:1
✖ launcher only forwards preparation CLI options and strips inherited credentials/preloads (0.058ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:171:1
✖ packaged --check loads private dependencies offline without starting preparation (0.0533ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:181:1
✖ complete packaged import graph resolves with only allowlisted runtime dependencies (0.0518ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)

test at lib\pc-worker\preparation\runtime-package.test.mjs:188:1
✖ versioned staging is idempotent, keeps previous versions and never activates a task or pointer (0.0881ms)
  Error: PREPARATION_DEPENDENCY_MISSING
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:68:32)
      at visit (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:157:44)
      at async dependencyRecords (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:165:41)
      at async packagePreparationRuntime (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/scripts/preparation-runtime-package.mjs:207:24)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/runtime-package.test.mjs:23:14)
      at async TestHook.run (node:internal/test_runner/test:1313:7)


```

### PowerPoint serial 실패 요약 원문

```text
✖ failing tests:

test at lib\pc-worker\preparation\powerpoint-cleanup.test.mjs:353:1
✖ injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process (1620.8212ms)
  Error: Command failed: powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\dev\woolimhome\.codex-tmp\draft-recreate\tools\woolim-pc-worker\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};
        $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\WoolimPowerPointPreparation');$owns=$false;
        try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};
          $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;
          $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);
          $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;
          foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};
          $presentation.SaveAs('C:\Users\becky\AppData\Local\Temp\ppt-cleanup-SY1A0Y\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;
        }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\Users\becky\AppData\Local\Temp\ppt-cleanup-SY1A0Y\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}
  "1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. 
  �̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006
  0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."
  ��ġ ��:4 ����:37
  + ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...
  +                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : COMException


      at genericNodeError (node:internal/errors:985:15)
      at wrappedFn (node:internal/errors:539:14)
      at ChildProcess.exithandler (node:child_process:417:12)
      at ChildProcess.emit (node:events:509:28)
      at maybeClose (node:internal/child_process:1124:16)
      at ChildProcess._handle.onexit (node:internal/child_process:306:5) {
    code: 1,
    killed: false,
    signal: null,
    cmd: "powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\tools\\woolim-pc-worker\\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};\n      $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\\WoolimPowerPointPreparation');$owns=$false;\n      try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};\n        $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;\n        $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);\n        $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;\n        foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};\n        $presentation.SaveAs('C:\\Users\\becky\\AppData\\Local\\Temp\\ppt-cleanup-SY1A0Y\\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;\n      }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\Users\\becky\\AppData\\Local\\Temp\\ppt-cleanup-SY1A0Y\\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}",
    stdout: '',
    stderr: '"1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. \r\n�̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006\r\n0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."\r\n��ġ ��:4 ����:37\r\n+ ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...\r\n+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\r\n    + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException\r\n    + FullyQualifiedErrorId : COMException\r\n \r\n'
  }

```

## 환경 확인과 보정

`PREPARATION_DEPENDENCY_MISSING`의 발생 지점은 `scripts/preparation-runtime-package.mjs:157`이다. 패키징 코드는 작업 폴더 안의 `node_modules/<패키지>/package.json`을 직접 읽는다. 일반 Node 모듈 탐색처럼 상위 폴더까지 찾지 않는다. 최초 실행 때 이 worktree에는 `node_modules`가 없었고, 일반 모듈 탐색은 `C:/dev/woolimhome/node_modules`를 사용하고 있었다. 이 차이 때문에 패키징의 공통 `before` hook이 실패했다.

상위 폴더에 있는 아래 6개 패키지의 실제 경로와 버전이 이 브랜치의 `package-lock.json`과 일치함을 확인한 뒤, worktree의 같은 상대 경로로 실제 복사했다. 링크나 junction은 사용하지 않았다. 패키징의 `safeFile`과 `safeRoot`가 링크 경로를 거절하므로 실제 디렉터리가 필요하다.

| 상대 경로 | 버전 |
| --- | --- |
| `node_modules/sharp` | `0.35.3` |
| `node_modules/@img/colour` | `1.1.0` |
| `node_modules/detect-libc` | `2.1.2` |
| `node_modules/sharp/node_modules/semver` | `7.8.5` |
| `node_modules/@img/sharp-win32-x64` | `0.35.3` |
| `node_modules/@xmldom/xmldom` | `0.8.13` |

`EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'`의 발생 지점은 `production-bridge.test.mjs:232`다. 이 fixture는 Windows에서 `os.tmpdir()`의 부모에 임시 폴더를 만든다. 최초 실행의 `TEMP`와 `TMP`는 `C:\Users\becky\AppData\Local\Temp`였으므로 실제 대상은 `C:\Users\becky\AppData\Local`이었다. 이 부모는 샌드박스가 쓰기를 허용한 Temp 안에 포함되지 않는다. 오류 경로가 그 부모를 정확히 가리키고 있어 실행 환경의 쓰기 제한에 걸린 것으로 판단했다.

두 번째 전체 검증에서는 프로세스의 `TEMP`와 `TMP`만 `C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\t`로 지정했다. 이때 fixture의 부모도 작업 폴더 안인 `.codex-tmp`가 되어 최초의 쓰기 위치 문제는 피했지만, 생성된 전체 작업 경로가 길어졌다. `pipeline.ts:41`, `production-bridge.ts:275,358` 등의 Windows 검사에는 작업 경로 100자 제한이 있어 `WORK_ROOT_TOO_LONG` 및 그 이후 기록 부재 오류가 발생했다. 이 실행의 실패 원문도 아래에 남겼다.

세 번째 전체 검증에서는 해당 프로세스의 `TEMP`와 `TMP`를 짧은 경로 `C:\Users\becky\AppData\Local\Temp\wr`로 지정했다. fixture가 사용하는 부모도 쓰기 허용된 `C:\Users\becky\AppData\Local\Temp` 안이다. 먼저 이 환경에서 `mockup-request-preparation.test.mjs`를 별도로 다시 실행하여 6개 모두 통과함을 확인했다. 로그는 `verify-draft-recreate-short-temp.log`다. 사용자 계정이나 시스템의 환경 변수는 바꾸지 않았다.

다만 bridge fixture의 새 세대 경로는 세 번째 설정에서도 100자를 넘는다. 실제 생성 규칙인 `<TEMP의 부모>/b-XXXXXX/WoolimWorker/p/<36자 세션 ID>/w<8자 ID>`로 계산하면 다음과 같다. 기본 TEMP에서는 99자이지만 부모가 쓰기 허용 영역 밖이고, `Temp/wr` 설정에서는 부모 쓰기가 허용되지만 104자다. 두 제한은 별개다. 이후 bridge 파일만 샌드박스 밖에서 기본 TEMP로 다시 실행하여 20개 모두 통과했다.

| 실행 설정 | fixture가 쓰는 부모 | 새 세대 경로 길이 |
| --- | --- | ---: |
| 기본 `C:/Users/becky/AppData/Local/Temp` | `C:/Users/becky/AppData/Local` | 99 |
| 작업 폴더의 `.codex-tmp/t` | `C:/dev/woolimhome/.codex-tmp/draft-recreate/.codex-tmp` | 125 |
| `C:/Users/becky/AppData/Local/Temp/wr` | `C:/Users/becky/AppData/Local/Temp` | 104 |

PowerPoint serial의 실패는 `powerpoint-cleanup.test.mjs:353`에서 발생했다. 원문은 PowerPoint COM의 `CreateInstance` 호출과 `HRESULT: 0x80070520`, `COMException`을 기록한다. 이후 같은 시험을 샌드박스 밖에서 별도로 실행했을 때 통과했다. 이 차이는 실행 환경의 영향이라는 해석과 일치하지만, 이 결과만으로 샌드박스가 유일한 원인이라고 확정할 수는 없다. PC에서의 최종 판정은 사용자에게 맡긴다.

환경 보정을 위해 `lib/pc-worker/preparation/*`, PowerPoint 변환기, 목업 렌더러, 지문 재료, 시험 원문은 변경하지 않았다. 복사한 `node_modules`와 실행용 `.codex-tmp`는 Git 추적 대상이 아니다.

## 두 번째 전체 검증 — 작업 폴더 안의 TEMP

명령은 `npm run verify`이며, 로그는 `verify-draft-recreate-final.log`다. TypeScript와 ESLint는 통과했다.

| 단계 | 전체 | 통과 | 실패 | 건너뜀 |
| --- | ---: | ---: | ---: | ---: |
| Parallel, 184개 파일 | 1586 | 1560 | 21 | 5 |
| PowerPoint serial, 3개 파일 | 57 | 56 | 1 | 0 |
| 시험 합계 | 1643 | 1616 | 22 | 5 |

Parallel 실패는 `mockup-request-preparation.test.mjs` 6개, `production-bridge.test.mjs` 14개, `redaction-pipeline.test.mjs` 1개다. PowerPoint serial에서는 최초 실행과 같은 COM 시험 1개가 실패했다. 두 번째 Parallel 실행에는 보완한 회귀 시험 2개가 더 포함되어 최초 실행보다 전체 수가 2개 많다.

### 두 번째 Parallel 실패 요약 원문

```text
✖ failing tests:

test at lib\pc-worker\preparation\mockup-request-preparation.test.mjs:77:1
✖ an explicit pending request adds only that candidate, creates highres and opens manual redaction without approval (160.4379ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async setup (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:46:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:78:11)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)

test at lib\pc-worker\preparation\mockup-request-preparation.test.mjs:100:1
✖ custom portrait follow-up preparation preserves the exact source format choice and never auto-approves (392.272ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async setup (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:46:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:101:11)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\mockup-request-preparation.test.mjs:115:1
✖ a conversion interruption leaves the prior selection and mockup usable, then restart reuses the completed page (34.4542ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async setup (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:46:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:116:11)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\mockup-request-preparation.test.mjs:133:1
✖ an excluded requested slide remains held without changing selection, artifacts, approvals or active output (97.9742ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async setup (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:46:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:134:11)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\mockup-request-preparation.test.mjs:146:1
✖ a request for an already converted slide initializes redaction only and does not rewrite the selection (33.751ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async setup (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:46:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:147:11)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\mockup-request-preparation.test.mjs:158:1
✖ changed font or converter context requires a separate build before any request output is written (48.9801ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async setup (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:46:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/mockup-request-preparation.test.mjs:159:11)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:110:1
✖ local preparation stops at manual review, stages only explicit callback, and resumes without reconversion (65.3642ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  0 !== 1

      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:128:12)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:146:1
✖ preparation failure produces one safe failure event and no automatic retry or stage (72.2898ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'WORK_ROOT_TOO_LONG'
  - 'POWERPOINT_BUSY'

      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:155:12)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'WORK_ROOT_TOO_LONG',
    expected: 'POWERPOINT_BUSY',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:162:1
✖ terminal remote sessions close live local editors, persist terminal state and free review capacity (97.3316ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  0 !== 1

      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:177:14)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:185:1
✖ resume checks cancellation before source access and never reopens a cancelled editor (80.9923ms)
  [Error: ENOENT: no such file or directory, lstat 'C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\t\b-KanOPd\WoolimWorker\p\e6137bd2-d3cd-4c4c-97ec-59edc0f6ccd7\s\source.pptx'] { errno: -4058, code: 'ENOENT', syscall: 'lstat', path: 'C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\t\\b-KanOPd\\WoolimWorker\\p\\e6137bd2-d3cd-4c4c-97ec-59edc0f6ccd7\\s\\source.pptx' }

test at lib\pc-worker\preparation\production-bridge.test.mjs:209:1
✖ unavailable or invalid status never closes live editor, marks failure or claims another session (92.0101ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + undefined
  - 'MOCKUP_BRIDGE_STATUS_INVALID'

      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:223:12)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 'MOCKUP_BRIDGE_STATUS_INVALID',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:283:1
✖ explicit preparation review applies into a fresh generation and swaps editor only after verified success (75.325ms)
  Error: ENOENT: no such file or directory, open 'C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\b-Y3GYmX\WoolimWorker\p\8c6c6dff-b226-4cec-b5de-e450d88de483\bridge-session.json'
      at async open (node:internal/fs/promises:640:25)
      at async readFile (node:internal/fs/promises:1287:14)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:286:39)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4058,
    code: 'ENOENT',
    syscall: 'open',
    path: 'C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\b-Y3GYmX\\WoolimWorker\\p\\8c6c6dff-b226-4cec-b5de-e450d88de483\\bridge-session.json'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:301:1
✖ manual preparation selection reaches only the fresh generation and empty selection keeps automatic defaults (76.9202ms)
  TypeError: Cannot read properties of undefined (reading 'preparationReview')
      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:305:31)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:315:1
✖ failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts (105.9277ms)
  Error: ENOENT: no such file or directory, open 'C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\b-iBcFKo\WoolimWorker\p\46506148-5631-49c5-b957-c1971bbe060a\bridge-session.json'
      at async open (node:internal/fs/promises:640:25)
      at async readFile (node:internal/fs/promises:1287:14)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:321:22)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4058,
    code: 'ENOENT',
    syscall: 'open',
    path: 'C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\b-iBcFKo\\WoolimWorker\\p\\46506148-5631-49c5-b957-c1971bbe060a\\bridge-session.json'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:331:1
✖ restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory (64.1502ms)
  TypeError: Cannot read properties of undefined (reading 'preparationReview')
      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:334:29)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:346:1
✖ preparation actions serialize and uploading sessions cannot change selection or source format (73.0016ms)
  TypeError: Cannot read properties of undefined (reading 'preparationReview')
      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:351:44)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:359:1
✖ explicit reopen rotates only launch token with no preparation, source download or record mutation (65.8624ms)
  Error: ENOENT: no such file or directory, open 'C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\b-qePoJ0\WoolimWorker\p\0f2474c9-69a3-4c38-b188-0a1786e2eb7e\bridge-session.json'
      at async open (node:internal/fs/promises:640:25)
      at async readFile (node:internal/fs/promises:1287:14)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:362:20)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4058,
    code: 'ENOENT',
    syscall: 'open',
    path: 'C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\b-qePoJ0\\WoolimWorker\\p\\0f2474c9-69a3-4c38-b188-0a1786e2eb7e\\bridge-session.json'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:371:1
✖ missing local token-rotation feature fails safely without conversion or requeue (49.5086ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + undefined
  - 'MOCKUP_BRIDGE_REOPEN_UNAVAILABLE'

      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:375:12)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 'MOCKUP_BRIDGE_REOPEN_UNAVAILABLE',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:380:1
✖ verified snapshot upload holds exclusive preparation lock through record commit (51.7306ms)
  TypeError: Cannot read properties of undefined (reading 'productionBridge')
      at TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:387:39)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:401:1
✖ failed snapshot upload releases preparation lock and preserves review record (35.5588ms)
  Error: ENOENT: no such file or directory, open 'C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\b-KDBNRi\WoolimWorker\p\3e75b466-a02e-4993-b6aa-6066d3193a20\bridge-session.json'
      at async open (node:internal/fs/promises:640:25)
      at async readFile (node:internal/fs/promises:1287:14)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:405:20)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4058,
    code: 'ENOENT',
    syscall: 'open',
    path: 'C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\b-KDBNRi\\WoolimWorker\\p\\3e75b466-a02e-4993-b6aa-6066d3193a20\\bridge-session.json'
  }

test at lib\pc-worker\preparation\redaction-pipeline.test.mjs:43:1
✖ synthetic PPTX stays source-bound through local preparation, redaction approval and stub upload (105.0255ms)
  Error: WORK_ROOT_TOO_LONG: PowerPoint 호환성을 위해 짧은 비공개 작업 경로를 사용하세요. 예: %LOCALAPPDATA%\WoolimWorker\preparation\작업이름
      at prepareLocalPptx (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/pipeline.ts:41:65)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/redaction-pipeline.test.mjs:59:18)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)


```

### 두 번째 PowerPoint serial 실패 요약 원문

```text
✖ failing tests:

test at lib\pc-worker\preparation\powerpoint-cleanup.test.mjs:353:1
✖ injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process (1729.3192ms)
  Error: Command failed: powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\dev\woolimhome\.codex-tmp\draft-recreate\tools\woolim-pc-worker\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};
        $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\WoolimPowerPointPreparation');$owns=$false;
        try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};
          $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;
          $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);
          $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;
          foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};
          $presentation.SaveAs('C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\t\ppt-cleanup-VP3Qlu\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;
        }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\dev\woolimhome\.codex-tmp\draft-recreate\.codex-tmp\t\ppt-cleanup-VP3Qlu\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}
  "1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. 
  �̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006
  0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."
  ��ġ ��:4 ����:37
  + ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...
  +                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : COMException


      at genericNodeError (node:internal/errors:985:15)
      at wrappedFn (node:internal/errors:539:14)
      at ChildProcess.exithandler (node:child_process:417:12)
      at ChildProcess.emit (node:events:509:28)
      at maybeClose (node:internal/child_process:1124:16)
      at ChildProcess._handle.onexit (node:internal/child_process:306:5) {
    code: 1,
    killed: false,
    signal: null,
    cmd: "powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\tools\\woolim-pc-worker\\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};\n      $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\\WoolimPowerPointPreparation');$owns=$false;\n      try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};\n        $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;\n        $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);\n        $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;\n        foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};\n        $presentation.SaveAs('C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\t\\ppt-cleanup-VP3Qlu\\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;\n      }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\.codex-tmp\\t\\ppt-cleanup-VP3Qlu\\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}",
    stdout: '',
    stderr: '"1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. \r\n�̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006\r\n0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."\r\n��ġ ��:4 ����:37\r\n+ ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...\r\n+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\r\n    + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException\r\n    + FullyQualifiedErrorId : COMException\r\n \r\n'
  }

```

## 세 번째 전체 검증 — 짧은 TEMP

명령은 `npm run verify`이며, 로그는 `verify-draft-recreate-short-final.log`다. TypeScript와 ESLint는 통과했으나 시험 실패로 전체 명령은 실패 종료했다.

| 단계 | 전체 | 통과 | 실패 | 건너뜀 |
| --- | ---: | ---: | ---: | ---: |
| Parallel, 184개 파일 | 1586 | 1576 | 5 | 5 |
| PowerPoint serial, 3개 파일 | 57 | 56 | 1 | 0 |
| 시험 합계 | 1643 | 1632 | 6 | 5 |

Parallel 실패 5개는 모두 `production-bridge.test.mjs`의 새 세대 생성 경로에서 발생했다. 오류는 `WORK_ROOT_TOO_LONG`이며, 한 시험은 기대한 `/POWERPOINT_BUSY/`보다 이 경로 오류가 먼저 발생해 assertion도 실패했다. serial 실패 1개는 PowerPoint COM 생성 오류다.

### 세 번째 Parallel 실패 요약 원문

```text
✖ failing tests:

test at lib\pc-worker\preparation\production-bridge.test.mjs:283:1
✖ explicit preparation review applies into a fresh generation and swaps editor only after verified success (45.6354ms)
  Error: WORK_ROOT_TOO_LONG
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:16:44)
      at file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:275:70
      at async exclusivePreparation (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:241:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:287:20)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:301:1
✖ manual preparation selection reaches only the fresh generation and empty selection keeps automatic defaults (48.6092ms)
  Error: WORK_ROOT_TOO_LONG
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:16:44)
      at file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:275:70
      at async exclusivePreparation (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:241:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:305:7)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:315:1
✖ failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts (100.8191ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /POWERPOINT_BUSY/. Input:

  'Error: WORK_ROOT_TOO_LONG'

      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:322:7)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: WORK_ROOT_TOO_LONG
        at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:16:44)
        at file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:275:70
        at async exclusivePreparation (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:241:18)
        at async waitForActual (node:assert:646:5)
        at async strict.rejects (node:assert:769:25)
        at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:322:7)
        at async Test.run (node:internal/test_runner/test:1313:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:897:7),
    expected: /POWERPOINT_BUSY/,
    operator: 'rejects',
    diff: 'simple'
  }

test at lib\pc-worker\preparation\production-bridge.test.mjs:331:1
✖ restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory (36.3431ms)
  Error: WORK_ROOT_TOO_LONG
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:16:44)
      at file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:275:70
      at async exclusivePreparation (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:241:18)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.test.mjs:334:5)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7)

test at lib\pc-worker\preparation\production-bridge.test.mjs:346:1
✖ preparation actions serialize and uploading sessions cannot change selection or source format (29.8969ms)
  Error: WORK_ROOT_TOO_LONG
      at fail (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:16:44)
      at file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:275:70
      at async exclusivePreparation (file:///C:/dev/woolimhome/.codex-tmp/draft-recreate/lib/pc-worker/preparation/production-bridge.ts:241:18)


```

### 세 번째 PowerPoint serial 실패 요약 원문

```text
✖ failing tests:

test at lib\pc-worker\preparation\powerpoint-cleanup.test.mjs:353:1
✖ injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process (1558.8528ms)
  Error: Command failed: powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\dev\woolimhome\.codex-tmp\draft-recreate\tools\woolim-pc-worker\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};
        $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\WoolimPowerPointPreparation');$owns=$false;
        try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};
          $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;
          $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);
          $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;
          foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};
          $presentation.SaveAs('C:\Users\becky\AppData\Local\Temp\wr\ppt-cleanup-zUHEU3\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;
        }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\Users\becky\AppData\Local\Temp\wr\ppt-cleanup-zUHEU3\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}
  "1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. 
  �̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006
  0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."
  ��ġ ��:4 ����:37
  + ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...
  +                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException
      + FullyQualifiedErrorId : COMException


      at genericNodeError (node:internal/errors:985:15)
      at wrappedFn (node:internal/errors:539:14)
      at ChildProcess.exithandler (node:child_process:417:12)
      at ChildProcess.emit (node:events:509:28)
      at maybeClose (node:internal/child_process:1124:16)
      at ChildProcess._handle.onexit (node:internal/child_process:306:5) {
    code: 1,
    killed: false,
    signal: null,
    cmd: "powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\\dev\\woolimhome\\.codex-tmp\\draft-recreate\\tools\\woolim-pc-worker\\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};\n      $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\\WoolimPowerPointPreparation');$owns=$false;\n      try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};\n        $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;\n        $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);\n        $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;\n        foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};\n        $presentation.SaveAs('C:\\Users\\becky\\AppData\\Local\\Temp\\wr\\ppt-cleanup-zUHEU3\\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;\n      }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\Users\\becky\\AppData\\Local\\Temp\\wr\\ppt-cleanup-zUHEU3\\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}",
    stdout: '',
    stderr: '"1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. \r\n�̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006\r\n0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."\r\n��ġ ��:4 ����:37\r\n+ ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...\r\n+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\r\n    + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException\r\n    + FullyQualifiedErrorId : COMException\r\n \r\n'
  }

```

## bridge 별도 재시험 — 기본 TEMP, 샌드박스 밖

실행 권한을 높여 샌드박스 밖에서 기본 `TEMP`와 `TMP`로 다음 파일만 다시 실행했다. 기본 TEMP를 사용하면 fixture의 새 세대 작업 경로는 99자로 100자 이내다. 최초의 부모 쓰기 제한과 세 번째 실행의 104자 문제를 함께 피했다.

```text
node --test lib/pc-worker/preparation/production-bridge.test.mjs
```

로그는 `verify-draft-recreate-bridge-unsandboxed.log`다. 20개 모두 통과했고, 실패와 건너뜀은 0개다. 세 번째 전체 검증에서 실패한 bridge 시험 5개도 이 파일에 포함된다. 이 별도 결과는 해당 파일의 환경 의존 실패를 확인한 것이며, 앞의 전체 검증 실패 6개를 지우거나 전체 통과로 바꾸지 않는다.

## PowerPoint 별도 재시험

샌드박스 밖에서 실행하도록 권한을 높여(`require_escalated`) 실패했던 COM 시험 하나를 선택했다. `TEMP`와 `TMP`를 바꾸지 않은 기본 환경을 사용했으며, 출력은 `verify-draft-recreate-powerpoint-unsandboxed.log`로 저장했다. 실제 시험 명령은 아래와 같다.

```text
node --test --test-name-pattern='injected export, Quit, timeout and checkpoint failures' lib/pc-worker/preparation/powerpoint-cleanup.test.mjs
```

로그는 `verify-draft-recreate-powerpoint-unsandboxed.log`다. 명령 종료 코드는 0이며, 선택한 시험 1개 통과, 실패 0개, 건너뜀 0개다. 결과 원문은 다음과 같다.

```text
✔ injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process (113443.5852ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 113572.5576
```

최신 전체 검증에서 실패한 6개는 bridge 파일의 별도 실행과 이 COM 시험의 별도 실행에서 모두 통과했다. 추가 재시험에서 재현된 실패는 0개지만, `npm run verify` 전체 명령의 실패 종료 기록을 통과로 바꾸지는 않는다.

# 포트폴리오 회차 누락 수정 보고

브랜치: `fix/portfolio-round-silent-failure-20261103`. 고칠 것 1·2·3을 모두 반영했다.

이미 사용한 후보는 저장된 대표 지문을 재사용한다. 지문이 없으면 변환 이미지나 같은 작업물의 이미지 세트에서 복구하고, 기존 후보 행에 id·status·updated_at 잠금 검사를 거쳐 저장한다. 읽기 전용 미리보기는 저장하지 않는다.

파일 없음만 건너뛰고 `PortfolioInspectionMetrics.missingImagePaths`에 경로를 남긴다. 권한·네트워크·잘못된 경로 오류는 실패로 유지한다. 발행본의 지문을 확인하지 못하면 새 후보를 통과시키지 않고 `imageReviewReason`을 준비 결과와 미리보기에 전달한다. 이름만 같은 다른 후보의 지문으로 대체하지 않는다.

지난 포트폴리오 회차에 작업물이 없으면 이유와 함께 `/admin/schedule` 알림을 보낸다. 기존 claim RPC에 `portfolio_stall_notice`와 `<KST 날짜>:slot:<회차 key>`를 사용한다. 성공은 completed, 전송 실패는 failed로 마감해 다음 시간에 다시 시도한다. 알림 실패는 본 자동화를 중단하지 않는다. 일정 화면은 지난 빈 회차를 빨간색 `빈손 · 이유`로 표시한다.

## 검증 결과

최종 명령: `npm run verify` (`cmd.exe`에서 실행). 종료 코드 1. 타입 검사와 ESLint는 통과했다.

시험 1804건: 통과 1789, 실패 10, 건너뜀 5, 취소 0.

첫 실행에서 완전한 증거를 비교하던 기존 시험의 발행 원장 지문이 비어 있어 실패했다. 해당 시험 데이터에 실제 비교 지문을 넣어 판정 동등성 검사를 유지했다. `cached inspection preserves the same name, publication, visual and font decisions as the complete evidence input`는 단독 재실행과 최종 전체 실행에서 통과했다.

## 남은 실패

1. explicit preparation review applies into a fresh generation and swaps editor only after verified success
2. manual preparation selection reaches only the fresh generation and empty selection keeps automatic defaults
3. failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts
4. restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory
5. preparation actions serialize and uploading sessions cannot change selection or source format
6. explicit reopen rotates only launch token with no preparation, source download or record mutation
7. missing local token-rotation feature fails safely without conversion or requeue
8. verified snapshot upload holds exclusive preparation lock through record commit
9. failed snapshot upload releases preparation lock and preserves review record
10. injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process

준비 작업 시험 9건은 `production-bridge.test.mjs`의 공통 시험 준비 단계에서 `C:\Users\becky\AppData\Local\b-XXXXXX` 생성이 EPERM으로 거부됐다. 이 경로는 허용된 저장소·임시 폴더의 바깥이며, 시험은 Windows에서 `path.dirname(os.tmpdir())`를 사용한다. 이 때문에 샌드박스 파일 쓰기 제한의 영향으로 보인다. 해당 파일은 이번 변경에 포함하지 않았다.

PowerPoint 시험 1건은 실제 PowerPoint COM 인스턴스 생성에서 `0x80070520`이 발생했다. 로그와 호출 지점은 COM·로그온 세션 제약 가능성을 가리키지만, 샌드박스만의 원인이라고 확정하지 않는다. 원문에 나타나는 한글 깨짐도 그대로 보존했다. 관련 시험·변환기 파일은 수정하지 않았다.

각 실패의 이름과 오류 출력 원문은 다음과 같다.

### 실패 1

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:288:1
✖ explicit preparation review applies into a fresh generation and swaps editor only after verified success (1.8649ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:289:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 2

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:309:1
✖ manual preparation selection reaches only the fresh generation and empty selection keeps automatic defaults (2.0811ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:311:15)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 3

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:323:1
✖ failed preparation, stale old evidence or failed review URL publication preserves original record/editor/artifacts (1.3514ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:327:15)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 4

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:339:1
✖ restarted daemon resumes the accepted generation without reconversion and rejects arbitrary work directory (1.327ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:340:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 5

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:354:1
✖ preparation actions serialize and uploading sessions cannot change selection or source format (1.6077ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:356:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 6

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:367:1
✖ explicit reopen rotates only launch token with no preparation, source download or record mutation (2.4202ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:368:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 7

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:379:1
✖ missing local token-rotation feature fails safely without conversion or requeue (1.4958ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:380:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 8

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:388:1
✖ verified snapshot upload holds exclusive preparation lock through record commit (3.054ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:392:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 9

```text
test at lib\pc-worker\preparation\production-bridge.test.mjs:409:1
✖ failed snapshot upload releases preparation lock and preserves review record (1.7562ms)
  Error: EPERM: operation not permitted, mkdtemp 'C:\Users\becky\AppData\Local\b-XXXXXX'
      at async mkdtemp (node:internal/fs/promises:1194:10)
      at async preparationBridgeFixture (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:237:21)
      at async TestContext.<anonymous> (file:///C:/dev/woolimhome/.codex-tmp/portfolio-round/lib/pc-worker/preparation/production-bridge.test.mjs:411:13)
      at async Test.run (node:internal/test_runner/test:1313:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:897:7) {
    errno: -4048,
    code: 'EPERM',
    syscall: 'mkdtemp',
    path: 'C:\\Users\\becky\\AppData\\Local\\b-XXXXXX'
  }
```

### 실패 10

```text
test at lib\pc-worker\preparation\powerpoint-cleanup.test.mjs:353:1
✖ injected export, Quit, timeout and checkpoint failures leave no converter-owned POWERPNT process (1617.881ms)
  Error: Command failed: powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\dev\woolimhome\.codex-tmp\portfolio-round\tools\woolim-pc-worker\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};
        $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\WoolimPowerPointPreparation');$owns=$false;
        try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};
          $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;
          $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);
          $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;
          foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};
          $presentation.SaveAs('C:\Users\becky\AppData\Local\Temp\ppt-cleanup-rKmUMI\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;
        }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\Users\becky\AppData\Local\Temp\ppt-cleanup-rKmUMI\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}
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
    cmd: "powershell.exe -NoProfile -NonInteractive -Command $ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile('C:\\dev\\woolimhome\\.codex-tmp\\portfolio-round\\tools\\woolim-pc-worker\\prepare-slides.ps1',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'CONVERTER_PARSE_ERROR'};foreach($function in $ast.FindAll({param($node)$node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)){. ([scriptblock]::Create($function.Extent.Text))};\n      $app=$null;$presentation=$null;$identity=$null;$mutex=New-Object System.Threading.Mutex($false,'Local\\WoolimPowerPointPreparation');$owns=$false;\n      try{$owns=$mutex.WaitOne(0);if(-not $owns -or @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count){throw 'POWERPOINT_BUSY'};\n        $started=[DateTime]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgID('PowerPoint.Application'));$identity=Get-OwnedPowerPointProcess -Application $app -StartedAfter $started;\n        $presentation=$app.Presentations.Add(0);$slide=$presentation.Slides.Add(1,12);\n        $shape=$slide.Shapes.AddTextbox(1,40,40,500,220);$frame=$shape.TextFrame;$range=$frame.TextRange;$range.Text='SYNTHETIC CLEANUP TEST 0123456789';$font=$range.Font;$font.Size=32;\n        foreach($reference in @($font,$range,$frame,$shape,$slide)){[Runtime.InteropServices.Marshal]::FinalReleaseComObject($reference)|Out-Null};\n        $presentation.SaveAs('C:\\Users\\becky\\AppData\\Local\\Temp\\ppt-cleanup-rKmUMI\\synthetic.pptx',24);$presentation.Close();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null;$presentation=$null;\n      }finally{if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)|Out-Null};if($app){Close-OwnedPowerPointProcess -Application $app -Identity $identity -CopyPath 'C:\\Users\\becky\\AppData\\Local\\Temp\\ppt-cleanup-rKmUMI\\synthetic.pptx';[Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)|Out-Null};[GC]::Collect();[GC]::WaitForPendingFinalizers();if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()}",
    stdout: '',
    stderr: '"1"���� �μ��� �ִ� "CreateInstance"��(��) ȣ���ϴ� ���� ���ܰ� �߻��߽��ϴ�. "80070520 ������ �α׿� ������ �����ϴ�. \r\n�̹� ����Ǿ��� ���� �ֽ��ϴ�. (���ܰ� �߻��� HRESULT: 0x80070520) ������ ���� CLSID�� {91493441-5A91-11CF-8700-00AA006\r\n0263B}�� ���� ����� COM Ŭ���� ���͸��� �˻����� ���߽��ϴ�."\r\n��ġ ��:4 ����:37\r\n+ ... me]::UtcNow;$app=[Activator]::CreateInstance([Type]::GetTypeFromProgI ...\r\n+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~\r\n    + CategoryInfo          : NotSpecified: (:) [], ParentContainsErrorRecordException\r\n    + FullyQualifiedErrorId : COMException\r\n \r\n'
  }
```

## 건너뛴 시험

최종 실행의 건너뜀 출력 원문이다. 5건 모두 기존 runtime-package.test.mjs의 `skip: process.platform === "win32"` 조건에 따른 것이다. 실패와 별도로 남긴다.

```text
﹣ dependency collection excludes npm bin links before recursion but includes locked nested semver (6790.4869ms) # SKIP
﹣ dependency payload rejects internal external and broken symlinks (0.4821ms) # SKIP
﹣ dependency roots and excluded node_modules must be real directories (1.2392ms) # SKIP
﹣ dependency payload rejects special files before reading them (0.3969ms) # SKIP
﹣ finished package inspection rejects unexpected node_modules symlinks (0.2462ms) # SKIP
```

## 변경 파일과 보존 항목

- `app/api/admin/naver-works/candidates/preview/route.ts`
- `app/api/cron/content-operations/route.ts`
- `app/api/schedule/route.ts`
- `components/admin/TwoWeekSchedule.tsx`
- `docs/portfolio-round-silent-failure-2026-11-03.md`
- `lib/content-ops/empty-portfolio-slot-cron.test.mjs`
- `lib/content-ops/portfolio-stall-notice.test.mjs`
- `lib/content-ops/portfolio-stall-notice.ts`
- `lib/content-ops/schedule-slot-state.test.mjs`
- `lib/content-ops/schedule-slot-state.ts`
- `lib/naver-works/portfolio-pipeline.ts`
- `lib/naver-works/source-inspection.test.mjs`
- `lib/portfolio/candidate-preview.test.mjs`
- `lib/portfolio/dedupe-inventory.test.mjs`
- `lib/portfolio/dedupe-inventory.ts`

`PREPARATION_RUNTIME_SOURCE_FILES`와 겹치는 변경 파일: 없음 (0개).

`lib/retention/policy.ts`, `lib/pc-worker/preparation/*`, 지문 재료 다섯 파일, 중복 기준과 버전, 비용 보호 및 RUN_BUDGET_MS는 변경하지 않았다. 새 표와 마이그레이션을 추가하지 않았다. 자동 발행·게시는 추가하거나 실행하지 않았다.

`git diff --check` 통과. 사용자가 처음 제공한 미추적 지시서 파일은 수정하거나 커밋하지 않는다.

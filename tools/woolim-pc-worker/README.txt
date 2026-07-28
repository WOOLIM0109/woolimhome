울림 사무실 PC 문서 자동 변환기

처리 방식
- 원본 크기와 관계없이 NAVER WORKS의 PPT·PDF를 회사 PC가 직접 내려받습니다.
- PPT·PPTX·PPTM은 설치된 PowerPoint와 원본 글꼴로 PNG를 만듭니다.
- PDF는 회사 PC의 PDF 렌더러로 페이지 PNG를 만듭니다.
- 원본이나 중간 PDF는 서버 저장소에 올리지 않고 완성된 페이지 PNG만 업로드합니다.

필수 사용자 환경변수
- WOOLIM_PC_WORKER_SECRET
- WOOLIM_WORKER_SERVER_URL (기본값: https://woolim-site.vercel.app)

실행
powershell.exe -NoProfile -File worker.ps1

시험 1회 실행
powershell.exe -NoProfile -File worker.ps1 -Once

로그
%LOCALAPPDATA%\WoolimWorker\worker.log

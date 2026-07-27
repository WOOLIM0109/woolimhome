울림 PowerPoint 자동 변환기

필수 사용자 환경변수
- WOOLIM_PC_WORKER_SECRET
- WOOLIM_WORKER_SERVER_URL (기본값: https://woolim-site.vercel.app)

실행
powershell.exe -NoProfile -File worker.ps1

시험 1회 실행
powershell.exe -NoProfile -File worker.ps1 -Once

로그
%LOCALAPPDATA%\WoolimWorker\worker.log

# 01 기관별 첨부 링크 실사

확인 시각: **2026-10-20 21:31 KST**. `202608040008_openchat_operations.sql`의 21개 기관을 기준으로 공개 목록·상세 페이지와 공개 다운로드 응답을 직접 확인했다. 운영 DB·수집 상태·크론·승인/발행 흐름은 이 감사에서 변경하지 않았다.

## 읽는 방법

- 아래 수량은 **실사한 표본 공고 1건에서 확인한 첨부 다운로드 후보 수**다. 운영 전체 공고 수, 저장 완료 수, 텍스트 추출 성공 수가 아니다.
- HTML 링크 확인, JSON에서의 첨부 확인, 파일 응답 확인을 구분했다. 파일 응답을 별도로 확인하지 않은 행의 수량을 다운로드·추출 성공으로 해석하면 안 된다.
- `미검증`은 0건 확보 또는 첨부 없음으로 확정한 결과가 아니다. 접근한 화면과 확인하지 못한 부분을 그대로 기록했다.
- 세션 식별자, 쿠키, 인증 정보, hidden context 값은 보고서에 기록하지 않았다. 아래 쿼리의 공고 번호는 공개 공고를 식별하는 번호다.

## 21개 기관 표본 확인 결과

| 기관 / source_key | 실제 공고 1건 확인 | 표본 공고 / 접근 경로 | 첨부 후보 | 확인 근거 / 예외 |
|---|---|---|---:|---|
| 기업마당 / `bizinfo` | 확인 | [홍성군 2026년 (예비)사회적기업 시설장비 지원사업](https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000127352) | 2 | 상세 HTTP 200. `/cmm/fms/fileDown.do` + `atchFileId`, `fileSn` 앵커. 파일명은 다운로드 버튼과 별도 요소에 있다. |
| 중소벤처기업부 / `mss` | 확인 | [2026년 소공인 클린제조환경조성사업 3차 모집 공고](https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1071870) | 2 | 상세 HTTP 200. `/common/board/Download.do` 앵커에 PDF/HWPX 파일명 파라미터가 있다. 목록의 숨김 `data-href`에도 다운로드 주소가 있다. |
| K-Startup / `kstartup` | 확인 | [2026년 스타트업 법률지원사업 울산광역시 법률상담회](https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?pbancClssCd=PBC010&schM=view&pbancSn=179572) | 3 | 상세 HTTP 200. `/afile/fileDownload/` 주소 3개. 상세 HTML에 과거 HWP 파일명을 가진 작업중 안내 템플릿도 있으므로 이를 실제 첨부로 세면 안 된다. |
| 소상공인24 / `sbiz24` | **미검증** | [등록 목록 주소](https://www.sbiz24.kr/) | 미확정 | HTTP 200이지만 약 6.5 KB 안내 HTML만 반환. 실제 목록은 `#/pbanc`, `#/lcgPbanc`, `#/extldPbanc`로 이동하는 SPA다. HTML 직접 요청으로 실제 공고 1건을 특정하지 못했다. 로그인 필요 여부는 확인하지 않았다. |
| 소상공인시장진흥공단 / `semas` | 확인 | [2027년도 전통시장 및 상점가 활성화 지원사업](https://www.semas.or.kr/web/board/webBoardView.kmdc?bCd=1&pNm=BOA0101&b_idx=57200) | 6 | 상세 HTTP 200. HWP 6개, `/common/download.kmdc` 앵커. 목록은 `fncGoDetail()`로 form을 제출하므로 기존 generic 앵커 탐색으로 상세 공고를 얻지 못한다. |
| 부산테크노파크 / `btp` | 확인 | [2026년 차세대 항공 기술지원 수혜기업 모집](https://www.btp.or.kr/kor/CMS/Board/Board.do?mCode=MN013&mgr_seq=16&mode=view&board_seq=9582551) | 2 | 상세 HTTP 200. HWP/HWPX 각 1개. `/kor/ajx_json/UploadMgr/downloadRun.do` 앵커이며 파일명과 용량이 앵커 텍스트에 있다. |
| 스마트공장관리시스템 / `smart_factory` | **미검증** | [등록 목록 주소](https://www.smart-factory.kr/) | 미확정 | HTTP 200, 약 1.1 KB HTML에 빈 `root`와 JavaScript bundle만 존재. 실제 공고·첨부는 HTML에 없다. 브라우저 렌더링 또는 공개 데이터 API 조사가 필요하며 실제 공고 1건은 확인하지 못했다. |
| 지역지식재산센터 / `ripc` | 확인 | [충북 제37기 IP창업존 특화과정](https://pms.ripc.org/pms/biz/applicant/board/viewBoardDetail.do?boardCategoryCode=BD10000&selectedBoardSeq=17294) | 2 | 상세 HTTP 200이지만 HTML의 첨부는 템플릿뿐이다. 상세 응답의 쿠키와 form context를 메모리에서 유지해 `getBoardAttachList.do`로 POST하면 JSON `useFlag=Y`, HWP 2개를 반환했다. 다운로드는 `downloadBoardAttachFile.do`에 `attachSeq`와 form context를 POST하는 구조다. |
| 판판대로 / `fanfandaero` | 확인 | [2026 디지털커머스 전문기관 소담스퀘어 울산](https://fanfandaero.kr/portal/v2/preSprtBizPbancDetail.do?sprtBizCd=202603011400&sprtBizTrgtYn=Y&groupNo=) | 1 문서 | 상세 HTML은 JS 템플릿이다. `selectSprtBizPbancDetailInfoList.do`에 공고 번호를 POST하면 `spinPb` 하위 `itemWonFileNm`, `fileStreCoursOrg`에서 HWP 1개와 이미지들을 확인할 수 있다. HWP 다운로드 HTTP 200 및 OLE 파일 시작 바이트를 확인했다. 이미지들은 문서 수량에서 제외했다. |
| 영도구청 / `yeongdo` | 확인 | [영도구체육회장선거 공정선거지원단 모집](https://www.yeongdo.go.kr/00000/00007/00008.web?gcode=1025&idx=334392&amode=view) | 2 | 상세 HTTP 200. `/board/download.do`의 `name`에 HWP 파일명이 있다. 파일명 링크와 다운로드 버튼이 중복되므로 URL별 중복 제거가 필요하다. 사업지원 공고 적합성은 이번 첨부 형식 감사 범위가 아니다. |
| 부산창업포털 / `busanstartup` | 확인 | [2027년 상반기 IBK창공 혁신창업기업 모집](https://www.busanstartup.kr/biz_sup/2320?mcode=biz02&deadline=N) | 1 문서 | `fileDownBtn`은 `href="#"`, `data-idx` 방식이다. 공개 `func.js`의 클릭 처리대로 `/download_total_idx.do?f_idx=8522&type=`를 요청해 HTTP 200과 PDF 시작 바이트를 확인했다. 같은 공고의 PPTX/JPG는 HWP/HWPX/PDF/ZIP 문서 수량에서 제외했다. |
| 스포츠산업지원 / `spobiz` | 확인 | [2026년 우수 스포츠용품 선정 모집](https://spobiz.kspo.or.kr/front/sportsHistory/sportsBissMng/sportsBissNoticeDetail.do?suppBusiInfoSeq=1696) | 2 | 상세 HTTP 200. PDF/HWP 각 1개. `fn_fileDown(원본명, 저장명, 경로)`를 `/front/sportsHistory/sportsBissMng/applBissFileDownload.do`의 `orgFileName`, `saveFileName`, `filePath` 쿼리로 바꾸는 코드가 상세 HTML에 있다. |
| 광주테크노파크 / `gjtp` | 확인 | [반도체 첨단패키징 실증센터 구축사업 3차 모집](https://www.gjtp.or.kr/home/business.cs?act=view&bsnssId=2266) | 2 | 상세 HTTP 200. PDF/HWP 각 1개. 상대 URL `?act=download&bsnssId=2266&fileSn=0 또는 1`, 앵커 텍스트가 파일명이다. |
| 소상공인 정책자금 / `ols_semas` | 확인 | [특별재난지역 직접대출 만기연장·상환유예](https://ols.semas.or.kr/ols/man/SMAN052M/page.do?bltwtrSeq=417&bbsTypeCd=01) | 2 | 상세 HTTP 200. PDF/HWPX 각 1개. `href=javascript:void(0)` + `onclick=fnDownFile(1 또는 2)`. 실제 UI 코드는 `/ols/man/SMAN052M/downloadFile.do`에 `bltwtrSeq`, `bbsTypeCd`, `bltwtrFlSeq`를 POST한다. |
| 투어라즈 / `touraz` | 확인 | [2026 울산 관광 인재 인턴십 지원사업](https://touraz.kr/announcementList/pssrpView?pssrpSeqEnc=a5klsQHmPpEKl7QS5NstRA==&curPage=1&tabMode=ktoip) | 2 | 상세 HTTP 200. PDF/HWP 각 1개. `/comm/getFile` 앵커에 `srvcId`, `upperNo`, `fileTy`, `fileNo`가 있다. 파일명은 같은 `dl`의 `dt`에 있다. 첫 번째로 확인한 서울 신규 입주기업 공고에서는 해당 첨부 앵커를 발견하지 못해 두 번째 실제 공고를 확인했다. |
| 부산 북구청 / `bsbukgu` | 확인 | [등록 목록](https://www.bsbukgu.go.kr/index.bsbukgu?menuCd=DOM_000000105001005000) → `eminwon.bsbukgu.go.kr` iframe → 공고 번호 `39330` | 1 | iframe의 `/emwp/gov/mogaha/ntis/web/ofr/action/OfrAction.do`에 목록 form을 POST한 뒤 `searchDetail`의 공고 번호로 상세 POST. 상세 HTTP 200, 「부산광역시 북구 금연구역 지정 고시문.hwpx」와 `goDownLoad()`를 확인했다. 구청 바깥 HTML만 읽으면 공고·첨부를 얻을 수 없다. |
| 부산경제진흥원 / `bepa` | 확인 | [달달 더 마켓 참여기업 모집](https://www.bepa.kr/kor/view.do?no=1502&idx=19599&view=view&pageIndex=1) | 2 | 상세 HTTP 200. HWP 2개, `onclick=downFile(20607 또는 20608)`. 기본 Node fetch에서는 인증서 체인 검증 실패. Windows 기본 HTTPS 요청과 Node `--use-system-ca`에서는 정상 응답했다. TLS 검증 해제는 사용하지 않았다. 운영 Node 환경의 인증서 체인은 별도 확인이 필요하다. |
| 부산 동구청 / `bsdonggu` | 확인 | [등록 목록](https://www.bsdonggu.go.kr/index.donggu?menuCd=DOM_000000103001002000) → `eminwon.bsdonggu.go.kr` iframe → 공고 번호 `33826` | 1 | 북구와 같은 Action POST 방식으로 목록→상세 확인. 상세 HTTP 200, 「도로명주소 건물번호 폐지 고시문.pdf」와 `goDownLoad()`를 확인했다. 목록 응답이 다른 기관보다 지연됐다. |
| 중소기업 혁신바우처 / `mssmiv` | **미검증** | [등록 목록](https://www.mssmiv.com/portal/Main), 메인 `goNotiDetail(908)`의 BoardView 경로 추적 | 미확정 | 쿠키 없는 fetch는 Main↔대기열 주소의 302 반복으로 실패했다. 쿠키를 메모리에서 유지하면 Main HTTP 200. 실제 UI 함수에 따라 `BoardView?bbsId=1`에 공고 번호를 GET/POST해도 공고문 대신 공통 안내·메뉴가 포함된 응답만 확인했다. 실제 공고 제목·첨부를 확정하지 못했으며 로그인 필요라고 단정하지 않는다. 공통 로그인 매뉴얼 PDF는 공고 첨부로 세지 않았다. |
| 기업지원관리시스템 / `rms` | 확인 | [2026-10-19 등록 표본 상세](https://www.smtech.go.kr/region/rms/biz/pblancManage/pblancManage/pblancDetailPop.do?sbjtId=S3474787&pblancId=20261019P00526) | 8 개별 링크 | 메인 `a[name=btn_detail]`의 `sbjtid`, `pblancid`를 공개 `index.js`의 URL 조합대로 전달하면 상세 HTTP 200. 개별 `/combiz/file/downloadFile.do` 8개와 ZIP 일괄 링크 1개. 개별 링크의 모든 확장자와 바이너리 내용은 미확인이다. 세션이 붙은 원문 URL은 보고서에서 제외했다. |
| 중소기업기술개발지원사업 / `smtech` | 확인 | [2026년 중소기업기술개발지원사업 모의평가 프로그램](https://www.smtech.go.kr/front/ifg/no/notice02_detail.do?buclYy=&ancmId=S02882&buclCd=S9I01&dtlAncmSn=1&schdSe=MO5005&aplySn=1&searchCondition=&searchKeyword=&pageIndex=1) | 2 | 상세 HTTP 200. HWP 2개, href 또는 onclick의 `cfn_AtchFileDownload(첨부ID,'/front','fileDownFrame')`로 다운로드한다. 파일 다운로드 함수의 최종 요청/바이너리는 이번 감사에서 확인하지 않았다. |

**확인 상태: 실제 공고 표본 확인 18/21개 기관. 미검증 3개 기관: `sbiz24`, `smart_factory`, `mssmiv`. 따라서 “21개 기관 모두 실제 공고 1건 이상 검증 완료”로 보고할 수 없다.**

## 오늘 운영 대상 공고 별도 확인

운영 대상이라는 판정과 대상 수량은 루트 작업자의 운영 조회 결과를 전달받았다. 이 감사자는 아래 공개 원문·첨부의 응답만 직접 검증했다.

| 공고 | 상세 확인 | 첨부 확인 | 파일 응답 | 추출 여부 |
|---|---|---|---|---|
| [2026년 워터라운드 제5기 협약파트너사 모집, K-Startup 179525](https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?pbancClssCd=PBC010&schM=view&pbancSn=179525) | HTTP 200 | [PDF 1개](https://www.k-startup.go.kr/afile/fileDownload/YT1Ln) | HTTP 200, `application/octet-stream`이지만 시작 바이트가 `%PDF-1.6` | 감사 범위에서 실행하지 않음 |

다운로드 응답의 `Content-Disposition` 파일명은 서버의 한국어 인코딩 때문에 Latin-1 문자열로 해석하면 깨진다. HTML 파일명 또는 적절한 원문 바이트 디코딩을 사용해야 한다. 이 공고의 확인된 문서명은 `2026년 워터라운드 제5기 협약파트너사 모집 공고.pdf`다.

## 구현·운영 판정에 필요한 구분

1. HTML의 정상 다운로드 앵커만으로 시작할 수 있는 기관과, JSON·form POST·iframe·쿠키 처리가 필요한 기관이 섞여 있다. 기존 수집→초안→승인→발행 경로를 바꾸지 않고 별도 첨부 트랙에서 처리해야 한다.
2. `href="#"` 자체를 다운로드 주소로 저장하면 안 된다. `busanstartup`은 `data-idx`, `ols_semas`는 onclick과 form 파라미터를 사용한다.
3. 파일명은 앵커 밖에 있을 수 있다. `bizinfo`, `kstartup`, `touraz`, `rms`의 주변 요소를 확인해야 한다.
4. 다운로드 후보를 실제 문서로 판정할 때 응답 Content-Type만 신뢰하면 안 된다. 직접 확인한 K-Startup PDF와 판판대로 HWP는 일반 바이너리 Content-Type을 사용했다.
5. 이 표만으로 운영 하루치 `extracted` 비율 80%를 판정할 수 없다. 그 기준은 운영 첨부 테이블과 같은 수집일의 분모·분자를 사용해 별도로 확인해야 한다. 이 표는 다음 날 수집→후보 전환 건수도 포함하지 않는다.

# 공공 공고문 추출 회귀 자료

2026-10-20에 공개 배포처에서 내려받았다. 작성된 신청서나 고객 자료를 사용하지 않는다. 테스트는 네트워크 없이 이 디렉터리의 파일을 읽는다.

| 파일 | 실제 자료 / 선정 이유 | 출처 |
| --- | --- | --- |
| `agro-industrial-2026.hwp` | 2026년 농공상융합형 중소기업 신규모집 공고문. 신청 자격·제출서류 및 압축된 HWP 5.0 레코드 검증. | [홍천군 원문 게시물](https://www.hongcheon.go.kr/www/selectBbsNttView.do?bbsNo=140&key=1709&nttNo=140529) / [공고문 다운로드](https://www.hongcheon.go.kr/www/downloadBbsFile.do?key=1709&bbsNo=140&atchmnflNo=97708) |
| `social-enterprise-2026.hwpx` | 2026년 (예비)사회적기업 도약 지원사업 참여기업 모집 공고문. HWPX 본문·표 셀 경계 검증. | [지역과소셜비즈 공개 게시물](https://www.sebiz.or.kr/sub/board.html?bid=k6pres&bno=432&mode=cont&snm=297) / [HWPX 다운로드](https://www.sebiz.or.kr/board/downFile.html?bid=k6pres&bno=432&Fidx=3882) |
| `social-enterprise-2026.pdf` | 같은 공고의 PDF 배포본. 한글 글자와 실제 11쪽 구분 검증. | 위 게시물 / [PDF 다운로드](https://www.sebiz.or.kr/board/downFile.html?bid=k6pres&bno=432&Fidx=3884) |
| `invention-procurement-2026.zip` | 2026년 상반기 우수발명품 우선구매 추천사업 신규지정 제출서류 배포 ZIP. 작성 전 HWP 양식 6개를 독립 첨부로 펼치는지 검증. | [기업마당 원문 게시물](https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000119911) / [ZIP 다운로드](https://www.bizinfo.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_000000000748285&fileSn=0) |

개인정보 검수 결과:

- HWP 공고의 본문은 공공 사업 안내이며 개인명·개인 전화·이메일·신청자 정보가 없다. 연락처는 기관 부서 대표번호 2개다. 원본 OLE 작성자 메타데이터에 개인명으로 의심되는 값이 있어 **`HwpSummaryInformation` 스트림을 제거한 사본**만 보관한다. 제거 전후 `BodyText` 추출 결과가 일치함을 확인했다. 본문은 수정하지 않았다.
- HWPX/PDF 본문에는 공고와 작성 전 빈 양식만 있고, 작성자 메타데이터는 일반 계정명 `user`다. 대표자·담당자·휴대전화·이메일 칸은 비어 있다.
- ZIP 안 HWP 6개의 본문은 작성 전 빈 양식이다. 개인명·실제 연락처·신청자 기재 정보가 없으며 OLE 작성자/수정자는 `user` 또는 기관명이다.
- 원본 HWP의 개인 메타데이터를 포함한 사본 및 개인 담당자 이름이 있는 다른 조사 자료는 이 디렉터리에 보관하지 않는다.

SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| HWP 다운로드 원본 — 보관하지 않음 | `7ca017e25a19a615fd259016ba2c3a18f8f48e4452d5d3037850e1c35c09ff3d` |
| `agro-industrial-2026.hwp` — 메타데이터 제거 사본 | `5f5318e73635ceba9e55ab3848c2da470732d669a5b110de08981e7f98f73306` |
| `social-enterprise-2026.hwpx` | `0d49eebb7c49563c9a8e6d4d7255a022510a3e7dea0f7f38ec72bafb9fc65703` |
| `social-enterprise-2026.pdf` | `34e97e55eea3095312030567a50d2c7d4816b28fa6fbd7ea53bd71b34ca9d6e6` |
| `invention-procurement-2026.zip` | `c4a4a06d96b8ec7bd90b3a8515b133e1c4f39cbeefb8b6147742e4d08d7b955f` |

합성 메모리 문서는 경계 조건(압축/비압축, 제어문자, 확장 레코드 크기, 배포용/암호화, PDF 49/50자, ZIP 개수·해제 크기·경로 이탈)만 검증한다. 실제 공고문 회귀 자료를 대체하지 않는다.

HWP 추출 구현은 [한글과컴퓨터 HWP 5.0 공개 명세 revision 1.3](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf)를 참고했다. 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

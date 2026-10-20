import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { attachmentFileName, attachmentStorageName, extractAttachments, isPrivateAddress } from './attachments.ts';

test('실제 SDK 전송의 저장 키가 한국어 원본명과 공백을 유지하며 Supabase ASCII·1024바이트 제한을 지킨다', async () => {
  // Official storage/src/storage/limits.ts VALID_OBJECT_KEY. Exercise the real SDK
  // transport, rather than mocking its .upload method, to catch percent decoding.
  const validKey = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/;
  let requests = 0;
  const client = createClient('https://example.supabase.co', 'fixture-service', {
    auth: {autoRefreshToken:false,persistSession:false},
    global:{fetch:async (input)=>{
      requests++;
      const path = decodeURIComponent(new URL(String(input)).pathname.split('/object/program-attachments/')[1]);
      assert.ok(validKey.test(path));
      assert.ok(Buffer.byteLength(path) <= 1024);
      return new Response(JSON.stringify({Id:'fixture-object',Key:`program-attachments/${path}`}), {status:200,headers:{'content-type':'application/json'}});
    }},
  });
  for (const name of ['2026년 공고문.pdf','기호 %_+ # 공고.hwpx','가'.repeat(200)+'.hwp','가'.repeat(2000)+'.hwp']) {
    const key = attachmentStorageName(name);
    if (key.startsWith('u8-')) assert.equal(Buffer.from(key.slice(3,key.lastIndexOf('.')),'base64url').toString('utf8'),name);
    const {error} = await client.storage.from('program-attachments').upload(`2026/10/program-id/${key}`,Buffer.from('fixture'),{contentType:'application/pdf'});
    assert.equal(error,null);
  }
  assert.equal(requests,4);
});

test('공공기관 eGov·K-Startup·MSS·BTP·GJTP 파일 링크와 파일명을 보존한다', () => {
  const html = `<ul>
    <li>모집 공고문.hwp <a href="/cmm/fms/fileDown.do?atchFileId=FILE_1&amp;fileSn=0">다운로드</a></li>
    <li><a href="/afile/fileDownload/Ns2Ln" title="모집안내.pdf">내려받기</a></li>
    <li><a data-href="/common/board/Download.do?bcIdx=12&amp;streFileNm=abc.hwpx">공고문.hwpx</a></li>
    <li><a href="/kor/ajx_json/UploadMgr/downloadRun.do?qcode=abc">추가모집.hwp (143KB)</a></li>
    <li><a href="?act=download&amp;fileSn=0">신청서.pdf</a></li>
    <li><a href="/archive/forms.zip">서식.zip</a></li>
    <li><a href="/notice/view">지원사업 목록</a></li>
    <li><a href="/archive/forms.zip">중복</a></li>
  </ul>`;
  const links = extractAttachments(html, 'https://www.example.go.kr/home/notice?id=1');
  assert.equal(links.length, 6);
  assert.equal(links[0].sourceUrl, 'https://www.example.go.kr/cmm/fms/fileDown.do?atchFileId=FILE_1&fileSn=0');
  assert.equal(links[0].fileExt, 'hwp');
  assert.equal(links[1].fileName, '모집안내.pdf');
  assert.equal(links[2].fileExt, 'hwpx');
  assert.equal(links[4].sourceUrl, 'https://www.example.go.kr/home/notice?act=download&fileSn=0');
});

test('표준 eGov onclick을 다운로드로 바꾸고 실행 코드와 자격증명 URL은 수집하지 않는다', () => {
  const links = extractAttachments(`<a href="#" onclick="fn_egov_downFile('FILE_0001','2')">신청서.hwp</a>
    <a href="javascript:alert('secret')">공고문.pdf</a>
    <a href="https://user:password@example.com/download.pdf">공고문.pdf</a>`, 'https://example.go.kr/view');
  assert.equal(links.length, 1);
  assert.match(links[0].sourceUrl, /atchFileId=FILE_0001&fileSn=2$/);
});

test('부산창업포털 data-idx와 스포츠산업 파일 함수를 다운로드 URL로 바꾼다', () => {
  const busan = extractAttachments('<a href="#" class="fileDownBtn" download="download" data-idx="8522">혁신기업 모집.pdf 225 kb</a>', 'https://www.busanstartup.kr/biz_sup/2320');
  assert.equal(busan[0].sourceUrl, 'https://www.busanstartup.kr/download_total_idx.do?f_idx=8522&type=');
  const sports = extractAttachments(`<a href="javascript:fn_fileDown('모집.pdf','saved.pdf','//sportsHistory/applyBissMng/undefined')">모집.pdf</a>`, 'https://spobiz.kspo.or.kr/front/sportsHistory/view.do');
  assert.equal(new URL(sports[0].sourceUrl).searchParams.get('orgFileName'), '모집.pdf');
});

test('다운로드 응답의 UTF-8 원본파일명 및 파일 시그니처를 확인한다', () => {
  assert.deepEqual(attachmentFileName(new Headers({ 'content-disposition': "attachment; filename*=UTF-8''%EA%B3%B5%EA%B3%A0%EB%AC%B8.pdf" }), '첨부', Buffer.from('%PDF-1.7')), {fileName:'공고문.pdf',fileExt:'pdf'});
  assert.equal(attachmentFileName(new Headers(), '첨부', Buffer.from('%PDF-1.7')).fileExt, 'pdf');
  assert.equal(attachmentFileName(new Headers(), '첨부', Buffer.from('<html>로그인</html>')).fileExt, 'unknown');
  assert.equal(attachmentFileName(new Headers({'content-disposition':`attachment; filename="${Buffer.from('공고문.pdf').toString('latin1')}"`}), '첨부', Buffer.from('%PDF')).fileName, '공고문.pdf');
  assert.equal(attachmentFileName(new Headers({'content-disposition':"attachment; filename*=euc-kr''%B0%F8%B0%ED%B9%AE.pdf"}), '첨부', Buffer.from('%PDF')).fileName, '공고문.pdf');
});

test('이웃한 첨부의 이름과 확장자가 섞이지 않으며 파일명 공백을 보존한다', () => {
  const links = extractAttachments(`<li>2026 annual announcement.hwp <a href='/download?id=1'>download</a></li><li>2026 qualification guide.pdf <a href='/download?id=2'>download</a></li>`, 'https://www.k-startup.go.kr/notice');
  assert.deepEqual(links.map(l=>[l.fileName,l.fileExt]), [['2026 annual announcement.hwp','hwp'],['2026 qualification guide.pdf','pdf']]);
});

test('K-Startup의 중첩 목록 다운로드에서 바깥 공고문 파일명을 찾는다', () => {
  const links = extractAttachments(`<ul><li><a href="#">2026년 협약파트너사 모집 공고.pdf</a><div><ul><li><a href="#">바로보기</a></li><li><a href="/afile/fileDownload/YT1Ln"><span>다운로드</span></a></li></ul></div></li></ul>`, 'https://www.k-startup.go.kr/notice');
  assert.equal(links[0].fileName, '2026년 협약파트너사 모집 공고.pdf');
  assert.equal(links[0].fileExt, 'pdf');
});

test('리다이렉트에서 차단해야 할 내부·메타데이터 IP를 판별한다', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','::1','fd00::1','fe80::1','::ffff:127.0.0.1','::ffff:7f00:1','::ffff:a9fe:a9fe']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

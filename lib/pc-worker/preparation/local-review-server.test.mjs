import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import test from "node:test";
import { startLocalReviewServer, LocalReviewServerError } from "./local-review-server.ts";
import { createMockupFixture } from "./mockup-fixture.mjs";
import { openPreparationWorkStore } from "./work-store.ts";
import { createHash } from "node:crypto";
import { REDACTION_RULE_VERSION } from "./redaction-types.ts";
import { redactionManualEditFingerprint, redactionUncertaintyFingerprint } from "./redaction-renderer.ts";

const PNG = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225"><rect width="400" height="225" fill="#fff"/><rect x="40" y="30" width="160" height="70" fill="#345"/><text x="50" y="75" font-size="20" fill="#fff">sample@example.test</text></svg>')).png().toBuffer();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function createFixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "woolim-local-review-"));
  const store = await openPreparationWorkStore({ root });
  const servers = [];
  t.after(async () => {
    for (const server of servers.reverse()) await server.close().catch(() => undefined);
    await store.release().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const started = await store.beginOrResumeBuild({
    expectedWorkRevision: null,
    fingerprint: {
      source: { sha256: sha256("source"), bytes: 6 },
      conversionSettingsFingerprint: "converter-v1",
      fontFingerprint: "fonts-v1",
    },
  });
  let build = await store.completeStage({
    buildId: started.build.buildId,
    stage: "source_inspection",
    expectedRevision: started.build.revision,
    inputFingerprint: "inspection-v1",
    data: {
      version: "local-preparation-1",
      sourceHash: sha256("source"),
      sourcePath: root,
      totalSlides: 3,
      width: 13.333,
      height: 7.5,
      aspect: "16:9",
      issues: [{ code: "CHECK", detail: "로컬 검사 알림" }],
      slides: [
        {
          sourceSlideNumber: 1,
          hidden: false,
          title: '</script><img src=x onerror="alert(1)"> & 첫 장표',
          contentHash: sha256("slide-1"),
          missingFonts: ["Example <Font>"],
          issues: [{ code: "PHOTO_DENSE", detail: "사진 비중 < 45% 확인" }],
        },
        { sourceSlideNumber: 2, hidden: false, title: "두 번째", contentHash: sha256("slide-2"), missingFonts: [], issues: [] },
        { sourceSlideNumber: 3, hidden: true, title: "세 번째", contentHash: sha256("slide-3"), missingFonts: [], issues: [] },
      ],
    },
  });

  const previewPath = await store.prepareArtifactPath(build.buildId, "previews/slide001.png");
  await writeFile(previewPath, PNG);
  build = await store.recordArtifact({
    buildId: build.buildId,
    key: "preview:1",
    expectedRevision: build.revision,
    relativePath: "previews/slide001.png",
  });
  build = await store.completeStage({
    buildId: build.buildId,
    stage: "preview_generation",
    expectedRevision: build.revision,
    inputFingerprint: "preview-v1",
    artifactKeys: ["preview:1"],
  });
  build = await store.recordSelection({
    buildId: build.buildId,
    expectedRevision: build.revision,
    expectedSelectionRevision: build.selectionRevision,
    selectionFingerprint: "selection-v1",
    data: {
      selected: [1],
      reserves: [2],
      holds: ["로컬 육안 확인 필요"],
      slides: [
        { sourceSlideNumber: 1, disposition: "selected", reasons: ["대표 장표 <선정>"] },
        { sourceSlideNumber: 2, disposition: "reserve", reason: "예비 장표" },
        { sourceSlideNumber: 3, disposition: "excluded", reasons: ["숨김 장표"] },
      ],
      environment: { secret: "must-not-be-shown" },
    },
  });
  const highresPath = await store.prepareArtifactPath(build.buildId, "highres/slide001.png");
  await writeFile(highresPath, PNG);
  build = await store.recordArtifact({
    buildId: build.buildId,
    key: "highres:1",
    expectedRevision: build.revision,
    relativePath: "highres/slide001.png",
  });
  build = await store.completeStage({
    buildId: build.buildId,
    stage: "high_resolution_conversion",
    expectedRevision: build.revision,
    inputFingerprint: "highres-v1",
    artifactKeys: ["highres:1"],
  });
  const redactionState = {
    version: 1,
    ruleVersion: REDACTION_RULE_VERSION,
    workId: started.work.workId,
    buildId: build.buildId,
    sourceSlideNumber: 1,
    sourceHash: sha256("source"),
    slideContentHash: sha256("slide-1"),
    imageHash: sha256(PNG),
    width: 400,
    height: 225,
    revision: 0,
    candidates: [{
      id: "email-1",
      rect: { x: 0.1, y: 0.12, width: 0.4, height: 0.32 },
      category: "email",
      required: true,
      reason: "EMAIL_PATTERN_REQUIRES_OPAQUE_REDACTION",
    }],
    warnings: options.warnings ?? ["REQUIRED_CANDIDATE_GEOMETRY_UNRESOLVED_MANUAL_RECT_REQUIRED"],
    regions: [{
      id: "auto-email-1",
      candidateId: "email-1",
      rect: { x: 0.1, y: 0.12, width: 0.4, height: 0.32 },
      mode: "opaque",
    }],
    exceptions: [],
    uncertainties: options.uncertainties ?? [],
    manualResolutions: [],
    review: { reviewer: "", originalInspected: false, layoutAcceptable: true },
    status: "editing",
    output: null,
  };
  const redactionStatePath = await store.prepareArtifactPath(build.buildId, "redaction/1/state.json");
  await writeFile(redactionStatePath, JSON.stringify(redactionState));
  build = await store.recordArtifact({
    buildId: build.buildId,
    key: "redaction-state:1",
    expectedRevision: build.revision,
    relativePath: "redaction/1/state.json",
  });
  return {
    root,
    store,
    build,
    previewPath,
    recordPath: path.join(root, "builds", build.buildId, "record.json"),
    workPath: path.join(root, "work.json"),
    redactionState,
    async start(extra = {}) {
      const server = await startLocalReviewServer({ root, buildId: build.buildId, ...extra });
      servers.push(server);
      return server;
    },
  };
}

function request(baseUrl, requestPath, options = {}) {
  const target = new URL(requestPath, baseUrl);
  const body = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
  const headers = { Connection: "close", ...(options.headers ?? {}) };
  if (body && headers["Content-Length"] === undefined && headers["content-length"] === undefined) {
    headers["Content-Length"] = String(body.length);
  }
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method ?? "GET",
      headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function directHeaders() {
  return { "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate" };
}

function authenticatedHeaders(cookie, extra = {}) {
  return { Cookie: cookie, "Sec-Fetch-Site": "same-origin", ...extra };
}

function mutationHeaders(server, cookie, csrfToken, extra = {}) {
  return authenticatedHeaders(cookie, {
    Origin: new URL(server.url).origin,
    "Content-Type": "application/json",
    "X-Woolim-CSRF": csrfToken,
    ...extra,
  });
}

function assertSecurityHeaders(response) {
  assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
  assert.match(response.headers["content-security-policy"], /default-src 'none'/);
  assert.doesNotMatch(response.headers["content-security-policy"], /unsafe-inline|unsafe-eval/);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
}

async function bootstrap(server) {
  const response = await request(server.url, "/", { headers: directHeaders() });
  assert.equal(response.status, 200);
  const setCookie = response.headers["set-cookie"]?.[0];
  assert.ok(setCookie);
  return { response, cookie: setCookie.split(";", 1)[0] };
}

async function preparationFixture(t){
  const fixture=await createFixture(t),calls=[];
  const view={version:1,workId:fixture.build.workId,buildId:fixture.build.buildId,revision:fixture.build.revision,sourceHash:sha256('source'),
    source:{width:612,height:859,aspect:'unknown',pageSizeVariant:'custom'},customPortrait:{allowed:true,reviewSlideNumber:1,currentChoice:false,reason:'고정 A4 세로 패딩만 허용'},
    slides:[{sourceSlideNumber:1,slideContentHash:sha256('slide-1'),previewHash:sha256('preview'),evidence:{imageHash:sha256(PNG),width:400,height:225},artworkEligible:true,artworkReviewed:false,reasons:['PHOTO_DENSE']}],holds:['합성 보류'],localOnly:true,sourcePath:'MUST_NOT_LEAK',extractedText:'MUST_NOT_LEAK'};
  const build=()=>({buildId:view.buildId,revision:view.revision,sourceHash:view.sourceHash});
  const assertExpected=input=>{assert.deepEqual(input.expectedCurrentBuild,build());};
  let evidenceDelay=null,readCorrupt=false,applyBad=false;
  const server=await fixture.start({preparationReview:{get:async()=>structuredClone(view),
    prepareEvidence:async input=>{calls.push(['evidence',input]);assertExpected(input);if(evidenceDelay)await evidenceDelay;return structuredClone(view);},
    readEvidence:async input=>{calls.push(['read',input]);assertExpected(input);assert.equal(input.imageHash,sha256(PNG));return readCorrupt?Buffer.from('not png'):PNG;},
    apply:async input=>{calls.push(['apply',input]);assertExpected(input);return {applied:true,buildId:'77777777-7777-4777-8777-777777777777',launchUrl:applyBad?'https://example.invalid/':'http://127.0.0.1:9031/launch/'+'a'.repeat(64)};}}});
  const {cookie}=await bootstrap(server),get=()=>request(server.url,'/api/preparation-review',{headers:authenticatedHeaders(cookie)});
  const initial=JSON.parse((await get()).body.toString('utf8'));
  const post=(action,body,headers=mutationHeaders(server,cookie,initial.csrfToken))=>request(server.url,`/api/preparation-review/${action}`,{method:'POST',headers,body:JSON.stringify(body)});
  const decision={sourceSlideNumber:1,slideContentHash:sha256('slide-1'),previewHash:sha256('preview'),imageHash:sha256(PNG),inspectedAtActualSize:true,reason:'원본 추상 그래픽을 직접 확대 확인함'};
  return {...fixture,server,cookie,get,post,initial,calls,view,build,decision,delay:value=>{evidenceDelay=value;},corrupt:()=>{readCorrupt=true;},badApply:()=>{applyBad=true;}};
}

test('preparation optional route has loopback auth, strict public DTO and no automatic preparation',async t=>{
  const f=await preparationFixture(t);assert.equal(f.calls.length,0);
  assert.equal((await request(f.server.url,'/api/preparation-review')).status,401);
  assert.equal((await request(f.server.url,'/api/preparation-review',{headers:authenticatedHeaders(f.cookie,{Origin:'https://example.invalid'})})).status,403);
  const read=await f.get();assert.equal(read.status,200);assertSecurityHeaders(read);assert.doesNotMatch(read.body.toString('utf8'),/MUST_NOT_LEAK|sourcePath|extractedText/);
  const home=await request(f.server.url,'/',{headers:authenticatedHeaders(f.cookie)});assert.match(home.body.toString('utf8'),/href="\/preparation"/);
  const page=await request(f.server.url,'/preparation',{headers:authenticatedHeaders(f.cookie)});assert.match(page.body.toString('utf8'),/원본 비율|자동 승인/);assertSecurityHeaders(page);
  const plain=await f.start();assert.equal((await request(plain.url,'/preparation',{headers:authenticatedHeaders((await bootstrap(plain)).cookie)})).status,404);
});

test('preparation mutations require CSRF and strictly bounded explicit evidence decisions',async t=>{
  const f=await preparationFixture(t),body={expectedCurrentBuild:f.build(),slideNumbers:[1]};
  assert.equal((await f.post('evidence',body,authenticatedHeaders(f.cookie,{'Content-Type':'application/json',Origin:new URL(f.server.url).origin}))).status,403);
  for(const invalid of [{...body,sourcePath:'C:/private.pptx'},{...body,slideNumbers:[1,1]},{...body,expectedCurrentBuild:{...f.build(),actor:'browser'}},{...body,slideNumbers:Array.from({length:9},(_,i)=>i+1)}])assert.equal((await f.post('evidence',invalid)).status,400);
  const apply={expectedCurrentBuild:f.build(),artworkReviews:[{...f.decision,classification:'abstract_graphic'}]};
  for(const invalid of [{...apply,upload:true},{...apply,artworkReviews:[{...apply.artworkReviews[0],inspectedAtActualSize:false}]},{...apply,artworkReviews:[{...apply.artworkReviews[0],classification:'photo'}]},{...apply,sourceFormatChoice:{...f.decision,kind:'stretch_to_a4'}},{...apply,artworkReviews:[]}])assert.equal((await f.post('apply',invalid)).status,400);
  assert.equal(f.calls.length,0);
  assert.equal((await f.post('evidence',body)).status,200);assert.deepEqual(f.calls[0],['evidence',body]);
});

test('preparation has one active mutation and immutable hash-bound evidence images',async t=>{
  const f=await preparationFixture(t);let release;f.delay(new Promise(resolve=>{release=resolve;}));
  const first=f.post('evidence',{expectedCurrentBuild:f.build(),slideNumbers:[1]});
  while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
  const second=await f.post('evidence',{expectedCurrentBuild:f.build(),slideNumbers:[1]});assert.equal(second.status,409);assert.equal(f.calls.length,1);release();assert.equal((await first).status,200);
  const url=f.initial.review.slides[0].evidence.url,image=await request(f.server.url,url,{headers:authenticatedHeaders(f.cookie)});
  assert.equal(image.status,200);assert.deepEqual(image.body,PNG);assertSecurityHeaders(image);
  f.corrupt();assert.equal((await request(f.server.url,url,{headers:authenticatedHeaders(f.cookie)})).status,409);
});

test('preparation apply exposes only safe new local launch receipt and cannot repeat',async t=>{
  const f=await preparationFixture(t),body={expectedCurrentBuild:f.build(),sourceFormatChoice:{...f.decision,kind:'custom_portrait_to_a4'},artworkReviews:[]};
  const result=await f.post('apply',body);assert.equal(result.status,200);assert.equal(JSON.parse(result.body.toString('utf8')).applied,true);assert.deepEqual(f.calls[0],['apply',body]);
  assert.equal((await f.post('apply',body)).status,409);assert.equal(f.calls.length,1);
  const g=await preparationFixture(t);g.badApply();assert.equal((await g.post('apply',{...body,expectedCurrentBuild:g.build()})).status,409);
});

test('bridge launch can be reissued once without rotating the existing editing session',async t=>{
  const f=await createFixture(t),plain=await f.start();assert.equal(plain.issueLaunchUrl,undefined);
  const server=await f.start({productionBridge:{sessionId:'11111111-1111-4111-8111-111111111111',workItemId:'22222222-2222-4222-8222-222222222222',stage:async()=>({sessionId:'11111111-1111-4111-8111-111111111111',staged:true})}});
  const {cookie}=await bootstrap(server),old=server.launchUrl,fresh=server.issueLaunchUrl();assert.notEqual(fresh,old);
  const navigation={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
  assert.equal((await request(server.url,new URL(old).pathname,{headers:navigation})).status,403);
  assert.equal((await request(server.url,new URL(fresh).pathname,{headers:navigation})).status,303);
  assert.equal((await request(server.url,new URL(fresh).pathname,{headers:navigation})).status,403);
  assert.equal((await request(server.url,'/api/review',{headers:authenticatedHeaders(cookie)})).status,200);
  assert.doesNotMatch((await request(server.url,'/',{headers:authenticatedHeaders(cookie)})).body.toString('utf8'),new RegExp(new URL(fresh).pathname));
});

test("binds only to 127.0.0.1 and renders an escaped Korean read-only gallery while the store lock is held", async (t) => {
  const fixture = await createFixture(t);
  const beforeWork = await readFile(fixture.workPath, "utf8");
  const beforeBuild = await readFile(fixture.recordPath, "utf8");
  const server = await fixture.start();
  const parsedUrl = new URL(server.url);
  assert.equal(parsedUrl.hostname, "127.0.0.1");
  assert.equal(parsedUrl.pathname, "/");
  assert.equal(parsedUrl.search, "");

  const { response, cookie } = await bootstrap(server);
  assertSecurityHeaders(response);
  const setCookie = response.headers["set-cookie"][0];
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  assert.doesNotMatch(server.url, /woolim_review_session|token|session/i);
  const html = response.body.toString("utf8");
  assert.match(html, /로컬 확인 전용 · 업로드 안 함/);
  assert.match(html, /href="\/editor\/1">가림 편집/);
  assert.doesNotMatch(html, /href="\/editor\/2">가림 편집/);
  assert.match(html, /선정 1/);
  assert.match(html, /예비 1/);
  assert.match(html, /제외·보류 1/);
  assert.match(html, /대표 장표 &lt;선정&gt;/);
  assert.match(html, /예비 장표/);
  assert.match(html, /&lt;\/script&gt;&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<script|<img src=x onerror/);
  assert.doesNotMatch(html, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(html, /must-not-be-shown/);
  assert.ok(!html.includes(cookie.split("=")[1]));

  const api = await request(server.url, "/api/review", { headers: authenticatedHeaders(cookie) });
  assert.equal(api.status, 200);
  assert.equal(api.headers["content-type"], "application/json; charset=utf-8");
  assertSecurityHeaders(api);
  const review = JSON.parse(api.body.toString("utf8"));
  assert.deepEqual(review.counts, { selected: 1, reserve: 1, excluded: 1, pending: 0 });
  assert.equal(review.slides[0].sourceSlideNumber, 1);
  assert.equal(review.slides[0].status, "selected");
  assert.ok(review.slides[0].reasons.includes("대표 장표 <선정>"));
  assert.equal(review.slides[1].status, "reserve");
  assert.equal(review.slides[2].status, "excluded");
  assert.ok(!api.body.toString("utf8").includes(fixture.root));
  assert.ok(!api.body.toString("utf8").includes("sourceHash"));
  assert.ok(!api.body.toString("utf8").includes("relativePath"));
  assert.ok(!api.body.toString("utf8").includes("must-not-be-shown"));

  const image = await request(server.url, "/artifact/preview%3A1", {
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.deepEqual(image.body, PNG);
  assertSecurityHeaders(image);

  const styles = await request(server.url, "/style.css", { headers: authenticatedHeaders(cookie) });
  assert.equal(styles.status, 200);
  assert.equal(styles.headers["content-type"], "text/css; charset=utf-8");
  assertSecurityHeaders(styles);
  assert.equal(await readFile(fixture.workPath, "utf8"), beforeWork);
  assert.equal(await readFile(fixture.recordPath, "utf8"), beforeBuild);
});

test("requires exact Host, direct-navigation bootstrap, the session cookie, and same-origin fetch metadata", async (t) => {
  const fixture = await createFixture(t);
  const server = await fixture.start();
  const { cookie } = await bootstrap(server);
  const port = new URL(server.url).port;

  const cases = [
    request(server.url, "/", { headers: { ...directHeaders(), Host: `localhost:${port}` } }),
    request(server.url, "/", { headers: { ...directHeaders(), Host: `127.0.0.1:${Number(port) + 1}` } }),
    request(server.url, "/", { headers: { ...directHeaders(), Host: `127.0.0.1.evil:${port}` } }),
    request(server.url, "/", { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" } }),
    request(server.url, "/api/review", { headers: { "Sec-Fetch-Site": "same-origin" } }),
    request(server.url, "/api/review", { headers: authenticatedHeaders(cookie, { "Sec-Fetch-Site": "cross-site" }) }),
    request(server.url, "/api/review", { headers: authenticatedHeaders(cookie, { "Sec-Fetch-Site": "same-site" }) }),
    request(server.url, "/api/review", { headers: { Cookie: cookie } }),
    request(server.url, "/api/review", { headers: authenticatedHeaders(cookie, { Origin: "https://attacker.example" }) }),
    request(server.url, "/api/review", { headers: authenticatedHeaders(cookie, { Origin: "null" }) }),
    request(server.url, "/api/review", { headers: authenticatedHeaders(`${cookie}; ${cookie}`) }),
  ];
  const responses = await Promise.all(cases);
  assert.deepEqual(
    responses.map((response) => response.status),
    [403, 403, 403, 401, 401, 403, 403, 403, 403, 403, 401],
  );
  for (const response of responses) assertSecurityHeaders(response);

  const origin = new URL(server.url).origin;
  const allowedOrigin = await request(server.url, "/api/review", {
    headers: authenticatedHeaders(cookie, { Origin: origin }),
  });
  assert.equal(allowedOrigin.status, 200);
  const post = await request(server.url, "/api/review", {
    method: "POST",
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET");
  const unknown = await request(server.url, "/not-a-route", { headers: authenticatedHeaders(cookie) });
  assert.equal(unknown.status, 404);
});

test("does not accept a cookie minted by another review-server instance", async (t) => {
  const fixture = await createFixture(t);
  const first = await fixture.start();
  const second = await fixture.start();
  const { cookie } = await bootstrap(first);
  const replay = await request(second.url, "/api/review", { headers: authenticatedHeaders(cookie) });
  assert.equal(replay.status, 401);
  assertSecurityHeaders(replay);
  const freshNavigation = await request(second.url, "/", {
    headers: { ...directHeaders(), Cookie: cookie },
  });
  assert.equal(freshNavigation.status, 200);
  assert.ok(freshNavigation.headers["set-cookie"]?.[0]);
  assert.notEqual(freshNavigation.headers["set-cookie"][0].split(";", 1)[0], cookie);
  const expiredCookieReopen = await request(first.url, "/", { headers: directHeaders() });
  assert.equal(expiredCookieReopen.status, 200);
  assert.ok(expiredCookieReopen.headers["set-cookie"]?.[0]);
});

test("serves the editor and CSRF token only after local authentication without mutating on GET", async (t) => {
  const fixture = await createFixture(t);
  const server = await fixture.start();
  const { response: home, cookie } = await bootstrap(server);
  await fixture.store.release();
  const before = await readFile(fixture.recordPath, "utf8");

  const editor = await request(server.url, "/editor/1", { headers: authenticatedHeaders(cookie) });
  assert.equal(editor.status, 200);
  assertSecurityHeaders(editor);
  const html = editor.body.toString("utf8");
  assert.match(html, /1번 장표 가림 편집/);
  assert.match(html, /id="fit-image"[^>]*>화면 맞춤/);
  assert.match(html, /id="zoom"[^>]*min="10"[^>]*max="400"[^>]*step="1"/);
  assert.match(html, /id="zoom-label"[^>]*>확대 100% · 실제크기/);
  assert.match(html, /사각형 영역 추가/);
  assert.match(html, /실행 취소/);
  assert.match(html, /적용 전후 비교|적용 전/);
  assert.match(html, /공개를 허용한 사람/);
  assert.match(html, /redaction-editor-client\.mjs/);
  assert.doesNotMatch(html, /sourceHash|workId|csrf|[A-Z]:\\/i);

  const client = await request(server.url, "/redaction-editor-client.mjs", { headers: authenticatedHeaders(cookie) });
  assert.equal(client.status, 200);
  assert.equal(client.headers["content-type"], "text/javascript; charset=utf-8");
  assertSecurityHeaders(client);
  const script = client.body.toString("utf8");
  assert.match(script, /pointerdown/);
  assert.match(script, /replaceChildren/);
  assert.match(script, /sourceWidth \* zoom \/ 100/);
  assert.match(script, /availableWidth \/ state\.width \* 100/);
  assert.match(script, /fitButton\.addEventListener\("click", fitImage\)/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|eval\(|new Function|https?:\/\//);

  const unauthorized = await request(server.url, "/api/redaction/1", {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  assert.equal(unauthorized.status, 401);
  assert.doesNotMatch(unauthorized.body.toString("utf8"), /csrf|sourceHash/i);

  const redaction = await request(server.url, "/api/redaction/1", { headers: authenticatedHeaders(cookie) });
  assert.equal(redaction.status, 200);
  assertSecurityHeaders(redaction);
  const payload = JSON.parse(redaction.body.toString("utf8"));
  assert.equal(payload.state.sourceSlideNumber, 1);
  assert.equal(payload.state.revision, 0);
  assert.equal(payload.state.candidates[0].category, "이메일");
  assert.match(payload.state.candidates[0].reason, /불투명하게 가려야/);
  assert.match(payload.state.warnings[0], /원본의 일부 내용을\/좌표를 확정하지 못했습니다/);
  assert.equal(payload.state.renderBlocked, true);
  assert.equal(typeof payload.csrfToken, "string");
  assert.ok(payload.csrfToken.length >= 32);
  for (const key of ['sourceHash','slideContentHash','imageHash']) assert.match(payload.state[key], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(redaction.body.toString("utf8"), /sourcePath|workId|buildId|artifactKey|relativePath/);
  assert.doesNotMatch(home.body.toString("utf8"), new RegExp(payload.csrfToken));

  const review = await request(server.url, "/api/review", { headers: authenticatedHeaders(cookie) });
  assert.doesNotMatch(review.body.toString("utf8"), /csrfToken/);
  assert.equal(await readFile(fixture.recordPath, "utf8"), before);
});

test("requires exact same-origin CSRF and a bounded strict JSON body before any edit", async (t) => {
  const fixture = await createFixture(t);
  const server = await fixture.start();
  const { cookie } = await bootstrap(server);
  await fixture.store.release();
  const stateResponse = await request(server.url, "/api/redaction/1", { headers: authenticatedHeaders(cookie) });
  const { csrfToken } = JSON.parse(stateResponse.body.toString("utf8"));
  const before = await readFile(fixture.recordPath, "utf8");
  const validBody = JSON.stringify({
    expectedRevision: 0,
    regions: fixture.redactionState.regions,
    exceptions: [],
    review: { reviewer: "검토자", originalInspected: true, layoutAcceptable: true },
  });

  const missingProof = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: authenticatedHeaders(cookie, { "Content-Type": "application/json" }),
    body: validBody,
  });
  assert.equal(missingProof.status, 403);
  const foreignOrigin = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: mutationHeaders(server, cookie, csrfToken, { Origin: "https://attacker.example" }),
    body: validBody,
  });
  assert.equal(foreignOrigin.status, 403);
  const wrongToken = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: mutationHeaders(server, cookie, "wrong-token"),
    body: validBody,
  });
  assert.equal(wrongToken.status, 403);
  const extraField = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: mutationHeaders(server, cookie, csrfToken),
    body: JSON.stringify({ ...JSON.parse(validBody), sourcePath: "C:\\secret.pptx" }),
  });
  assert.equal(extraField.status, 400);
  const oversized = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: mutationHeaders(server, cookie, csrfToken),
    body: Buffer.alloc(256 * 1024 + 1, 0x20),
  });
  assert.equal(oversized.status, 413);
  for (const response of [missingProof, foreignOrigin, wrongToken, extraField, oversized]) {
    assertSecurityHeaders(response);
    assert.doesNotMatch(response.body.toString("utf8"), /secret\.pptx|csrfToken|sourceHash|at /i);
  }
  assert.equal(await readFile(fixture.recordPath, "utf8"), before);
});

test("saves explicit edits, renders for comparison, approves separately, and holds a broken design", async (t) => {
  const fixture = await createFixture(t, { warnings: [] });
  const server = await fixture.start();
  const { cookie } = await bootstrap(server);
  await fixture.store.release();
  const initial = JSON.parse((await request(server.url, "/api/redaction/1", {
    headers: authenticatedHeaders(cookie),
  })).body.toString("utf8"));
  const manualOpaque = {
    id: "manual-unlocated-1",
    rect: { x: 0.68, y: 0.68, width: 0.18, height: 0.16 },
    mode: "opaque",
  };
  const saved = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: mutationHeaders(server, cookie, initial.csrfToken),
    body: JSON.stringify({
      expectedRevision: initial.state.revision,
      regions: [...initial.state.regions, manualOpaque],
      exceptions: [],
      review: { reviewer: "로컬 검토자", originalInspected: true, layoutAcceptable: true },
    }),
  });
  assert.equal(saved.status, 200);
  const savedState = JSON.parse(saved.body.toString("utf8")).state;
  assert.equal(savedState.revision, 1);
  assert.equal(savedState.output, null);

  const rendered = await request(server.url, "/api/redaction/1/render", {
    method: "POST",
    headers: mutationHeaders(server, cookie, initial.csrfToken),
    body: JSON.stringify({ expectedRevision: savedState.revision }),
  });
  assert.equal(rendered.status, 200);
  const renderedState = JSON.parse(rendered.body.toString("utf8")).state;
  assert.equal(renderedState.status, "rendered");
  assert.equal(renderedState.revision, 2);
  assert.match(renderedState.output.sha256, /^[0-9a-f]{64}$/);

  const after = await request(server.url, `/redacted/1/${renderedState.output.sha256}`, {
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(after.status, 200);
  assert.equal(after.headers["content-type"], "image/png");
  assert.notDeepEqual(after.body, PNG);
  assertSecurityHeaders(after);

  const approved = await request(server.url, "/api/redaction/1/approve", {
    method: "POST",
    headers: mutationHeaders(server, cookie, initial.csrfToken),
    body: JSON.stringify({
      expectedRevision: renderedState.revision,
      outputHash: renderedState.output.sha256,
      reviewer: "로컬 검토자",
      outputInspected: true,
    }),
  });
  assert.equal(approved.status, 200);
  const approvedState = JSON.parse(approved.body.toString("utf8")).state;
  assert.equal(approvedState.status, "verified");
  assert.equal(approvedState.revision, 3);
  assert.equal(approvedState.output.approvedBy, "로컬 검토자");

  const replacement = await request(server.url, "/api/redaction/1/save", {
    method: "POST",
    headers: mutationHeaders(server, cookie, initial.csrfToken),
    body: JSON.stringify({
      expectedRevision: approvedState.revision,
      regions: approvedState.regions,
      exceptions: approvedState.exceptions,
      review: { reviewer: "로컬 검토자", originalInspected: true, layoutAcceptable: false },
    }),
  });
  assert.equal(replacement.status, 200);
  const replacementState = JSON.parse(replacement.body.toString("utf8")).state;
  assert.equal(replacementState.status, "replacement_required");
  assert.equal(replacementState.output, null);
  const blockedRender = await request(server.url, "/api/redaction/1/render", {
    method: "POST",
    headers: mutationHeaders(server, cookie, initial.csrfToken),
    body: JSON.stringify({ expectedRevision: replacementState.revision }),
  });
  assert.equal(blockedRender.status, 409);
});

test("serves only registered preview:N and highres:N artifact IDs and rejects encoded path attempts", async (t) => {
  const fixture = await createFixture(t);
  const server = await fixture.start();
  const { cookie } = await bootstrap(server);
  const paths = [
    "/artifact/preview%3A999",
    "/artifact/source%3A1",
    "/artifact/%252e%252e%252fwork.json",
    "/artifact/preview%253A1",
    "/artifact/C%253Asecret",
    "/artifact/preview%3A1/extra",
  ];
  for (const pathname of paths) {
    const response = await request(server.url, pathname, { headers: authenticatedHeaders(cookie) });
    assert.equal(response.status, 404, pathname);
    assertSecurityHeaders(response);
    assert.doesNotMatch(response.body.toString("utf8"), /work\.json|record\.json|[A-Z]:\\/i);
  }
  const highres = await request(server.url, "/artifact/highres%3A1", {
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(highres.status, 200);
  assert.deepEqual(highres.body, PNG);
});

test("manual uncertainty review is authenticated, hash-bound, returned without paths, and stale edits are rejected", async (t) => {
  const uncertainty={id:'geometry-email-1',candidateId:'email-1',code:'TEXT_RENDER_BOUNDS_UNRESOLVED',rect:{x:.1,y:.12,width:.4,height:.32}};
  const fixture=await createFixture(t,{warnings:[],uncertainties:[uncertainty]}),server=await fixture.start();
  const {cookie}=await bootstrap(server);await fixture.store.release();
  const initial=JSON.parse((await request(server.url,'/api/redaction/1',{headers:authenticatedHeaders(cookie)})).body.toString('utf8'));
  assert.deepEqual(initial.state.uncertainties,[uncertainty]);assert.deepEqual(initial.state.manualResolutions,[]);
  assert.equal(initial.state.renderBlocked,false);
  const edits={regions:initial.state.regions,exceptions:[],review:{reviewer:'합성 수동 검토자',originalInspected:true,layoutAcceptable:true}};
  const resolution={uncertaintyId:uncertainty.id,decision:'opaque_confirmed',actor:'합성 수동 검토자',reason:'확대 원본에서 위치를 확인했고 불투명 영역으로 가렸음',
    inspectedAtActualSize:true,reviewedRevision:initial.state.revision,sourceHash:initial.state.sourceHash,slideContentHash:initial.state.slideContentHash,imageHash:initial.state.imageHash,
    uncertaintyHash:redactionUncertaintyFingerprint(uncertainty),editHash:redactionManualEditFingerprint(edits),regionId:'auto-email-1'};
  const post=(action,body)=>request(server.url,`/api/redaction/1/${action}`,{method:'POST',headers:mutationHeaders(server,cookie,initial.csrfToken),body:JSON.stringify(body)});
  const saved=await post('save',{expectedRevision:initial.state.revision,...edits,manualResolutions:[resolution]});
  assert.equal(saved.status,200);const state=JSON.parse(saved.body.toString('utf8')).state;
  assert.equal(state.manualResolutions[0].uncertaintyId,uncertainty.id);
  assert.doesNotMatch(saved.body.toString('utf8'),/sourcePath|artifactKey|relativePath|[A-Z]:\\/);
  const stale=await post('save',{expectedRevision:state.revision,...edits,regions:[{...edits.regions[0],rect:{x:.1,y:.12,width:.5,height:.4}}],manualResolutions:[resolution]});
  assert.equal(stale.status,409);assert.match(stale.body.toString('utf8'),/확대 검토 이후/);
  const rendered=await post('render',{expectedRevision:state.revision});assert.equal(rendered.status,200);
});

test("rejects a traversal path injected into the ledger before opening a listener", async (t) => {
  const fixture = await createFixture(t);
  const record = JSON.parse(await readFile(fixture.recordPath, "utf8"));
  record.artifacts["preview:1"].relativePath = "../../outside.png";
  await writeFile(fixture.recordPath, JSON.stringify(record));
  await assert.rejects(
    startLocalReviewServer({ root: fixture.root, buildId: fixture.build.buildId }),
    (error) => error instanceof LocalReviewServerError && error.code === "INVALID_LEDGER",
  );
});

test("fails closed when a registered image becomes corrupt and never exposes a filesystem path", async (t) => {
  const fixture = await createFixture(t);
  const server = await fixture.start();
  const { cookie } = await bootstrap(server);
  await writeFile(fixture.previewPath, Buffer.concat([PNG, Buffer.from("changed") ]));
  const response = await request(server.url, "/artifact/preview%3A1", {
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(response.status, 409);
  assertSecurityHeaders(response);
  const body = response.body.toString("utf8");
  assert.match(body, /안전하게 읽지 못했습니다/);
  assert.ok(!body.includes(fixture.root));
  assert.doesNotMatch(body, /LocalReviewServerError|STALE_ARTIFACT|at /);
});

test("rejects a symlinked artifact parent instead of reading the target", async (t) => {
  const fixture = await createFixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "woolim-local-review-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const previewDirectory = path.dirname(fixture.previewPath);
  await rm(previewDirectory, { recursive: true, force: true });
  try {
    await symlink(outside, previewDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      t.skip(`symlinks unavailable on this host: ${error.code}`);
      return;
    }
    throw error;
  }
  await writeFile(path.join(outside, "slide001.png"), PNG);
  const server = await fixture.start();
  const { cookie } = await bootstrap(server);
  const response = await request(server.url, "/artifact/preview%3A1", {
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(response.status, 409);
  assert.ok(!response.body.toString("utf8").includes(outside));
});

async function mockupBrowserFixture(t) {
  const fixture = await createMockupFixture({ count: 8, approveCount: 8 });
  const server = await startLocalReviewServer({ root: fixture.root, buildId: fixture.buildId });
  t.after(async () => {
    await server.close().catch(() => undefined);
    await fixture.cleanup();
  });
  const { cookie } = await bootstrap(server);
  return { ...fixture, server, cookie };
}

async function getMockupReview(fixture) {
  const response = await request(fixture.server.url, "/api/mockups", {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(response.status, 200);
  return JSON.parse(response.body.toString("utf8"));
}

test("serves a five-board local mockup UI and read API without creating an assignment", async (t) => {
  const fixture = await mockupBrowserFixture(t);
  const recordPath = path.join(fixture.root, "builds", fixture.buildId, "record.json");
  const before = await readFile(recordPath, "utf8");
  const page = await request(fixture.server.url, "/mockups", {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(page.status, 200);
  assertSecurityHeaders(page);
  const html = page.body.toString("utf8");
  assert.match(html, /목업 배정·미리보기/);
  assert.match(html, /배정 만들기/);
  assert.match(html, /초안 만들기 · 0\.5배/);
  assert.match(html, /최종본 만들기 · 1배/);
  assert.match(html, /업로드·활성화 안 함/);
  assert.match(html, /자동 처리와 연결되지 않았/);
  assert.match(html, /mockup-editor-client\.mjs/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);

  const client = await request(fixture.server.url, "/mockup-editor-client.mjs", {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(client.status, 200);
  assertSecurityHeaders(client);
  const script = client.body.toString("utf8");
  assert.match(script, /initializeButton\.addEventListener\("click"/);
  assert.match(script, /draftButton\.addEventListener\("click"/);
  assert.match(script, /finalButton\.addEventListener\("click"/);
  assert.match(script, /debugInput\.addEventListener\("change"/);
  assert.match(script, /titleInput\.disabled = busy/);
  assert.match(script, /완료된 로컬 체크포인트를 다시 불러왔습니다/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|eval\(|new Function|https?:\/\//);

  const payload = await getMockupReview(fixture);
  assert.equal(payload.review.state, null);
  assert.equal(payload.review.boards.length, 5);
  assert.equal(payload.review.candidates.filter((entry) => entry.status === "approved").length, 8);
  assert.equal(payload.review.candidates.at(-1).status, "needs_preparation");
  assert.equal(payload.review.activeSetUnchanged, true);
  assert.equal(payload.review.visualReview, "not_performed");
  assert.equal(typeof payload.csrfToken, "string");
  const json = JSON.stringify(payload.review);
  assert.doesNotMatch(json, /artifactKey|debugArtifactKey|debugHash|manifestArtifactKey|inputFingerprint|sourceHash|workId|buildId|relativePath/i);
  assert.equal(await readFile(recordPath, "utf8"), before);
});

test("requires CSRF and strict bodies, records preparation locally, and blocks duplicate board rendering", async (t) => {
  const fixture = await mockupBrowserFixture(t);
  const initial = await getMockupReview(fixture);
  const noCsrf = await request(fixture.server.url, "/api/mockups/initialize", {
    method: "POST",
    headers: authenticatedHeaders(fixture.cookie, {
      Origin: new URL(fixture.server.url).origin,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ title: "합성 목업 시험" }),
  });
  assert.equal(noCsrf.status, 403);
  const extraField = await request(fixture.server.url, "/api/mockups/initialize", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ title: "합성 목업 시험", activate: true }),
  });
  assert.equal(extraField.status, 400);

  const initialized = await request(fixture.server.url, "/api/mockups/initialize", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ title: "합성 목업 시험" }),
  });
  assert.equal(initialized.status, 200);
  const initializedReview = JSON.parse(initialized.body.toString("utf8")).review;
  assert.equal(initializedReview.state.initialized, true);
  assert.equal(initializedReview.boards.length, 5);
  assert.ok(initializedReview.boards.every((board) => board.slots.every((slot) => slot.sourceSlideNumber !== null)));

  const boards = structuredClone(initializedReview.boards.map((board) => ({
    templateId: board.templateId,
    slots: board.slots.map((slot) => ({ slotId: slot.slotId, sourceSlideNumber: slot.sourceSlideNumber })),
  })));
  boards[0].slots[1].sourceSlideNumber = boards[0].slots[0].sourceSlideNumber;
  const duplicate = await request(fixture.server.url, "/api/mockups/save", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ expectedRevision: initializedReview.revision, title: initializedReview.title, boards }),
  });
  assert.equal(duplicate.status, 200);
  const duplicateReview = JSON.parse(duplicate.body.toString("utf8")).review;
  assert.ok(duplicateReview.boards[0].holds.some((hold) => /중복/.test(hold)));
  const blocked = await request(fixture.server.url, "/api/mockups/render", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ expectedRevision: duplicateReview.revision, scale: 0.5 }),
  });
  assert.equal(blocked.status, 409);
  assert.doesNotMatch(blocked.body.toString("utf8"), /DUPLICATE|MOCKUP_|artifactKey|at /);

  const preparation = await request(fixture.server.url, "/api/mockups/request", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({
      expectedRevision: duplicateReview.revision,
      sourceSlideNumber: 9,
      reason: "가림 후 디자인을 유지할 대체 장표 준비",
    }),
  });
  assert.equal(preparation.status, 200);
  const requestedReview = JSON.parse(preparation.body.toString("utf8")).review;
  assert.deepEqual(requestedReview.requests.map((entry) => ({ sourceSlideNumber: entry.sourceSlideNumber, status: entry.status })), [
    { sourceSlideNumber: 9, status: "pending" },
  ]);
  assert.equal(requestedReview.activeSetUnchanged, true);
});

test("renders the same five assignments as draft and final and serves only current normal or debug PNGs", async (t) => {
  const fixture = await mockupBrowserFixture(t);
  const initial = await getMockupReview(fixture);
  const initializedResponse = await request(fixture.server.url, "/api/mockups/initialize", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ title: "합성 목업 렌더 시험" }),
  });
  const initialized = JSON.parse(initializedResponse.body.toString("utf8")).review;
  const draftResponse = await request(fixture.server.url, "/api/mockups/render", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ expectedRevision: initialized.revision, scale: 0.5 }),
  });
  assert.equal(draftResponse.status, 200);
  const draft = JSON.parse(draftResponse.body.toString("utf8")).review;
  assert.ok(draft.boards.every((board) => board.draft?.sha256));
  assert.ok(draft.boards.every((board) => board.final === null));

  const first = draft.boards[0];
  const normal = await request(fixture.server.url, `/mockup-image/${first.templateId}/draft/${first.draft.sha256}`, {
    headers: authenticatedHeaders(fixture.cookie),
  });
  const debug = await request(fixture.server.url, `/mockup-image/${first.templateId}/draft/${first.draft.sha256}/debug`, {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(normal.status, 200);
  assert.equal(debug.status, 200);
  assert.equal(normal.headers["content-type"], "image/png");
  assert.notDeepEqual(normal.body, debug.body);
  assertSecurityHeaders(normal);
  assertSecurityHeaders(debug);
  const wrongHash = await request(fixture.server.url, `/mockup-image/${first.templateId}/draft/${"0".repeat(64)}`, {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(wrongHash.status, 404);

  const finalResponse = await request(fixture.server.url, "/api/mockups/render", {
    method: "POST",
    headers: mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken),
    body: JSON.stringify({ expectedRevision: draft.revision, scale: 1 }),
  });
  assert.equal(finalResponse.status, 200);
  const final = JSON.parse(finalResponse.body.toString("utf8")).review;
  assert.ok(final.boards.every((board) => board.final?.sha256));
  const finalFirst = final.boards[0];
  const download = await request(fixture.server.url, `/mockup-image/${finalFirst.templateId}/final/${finalFirst.final.sha256}/download`, {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers["content-type"], "image/png");
  assert.match(download.headers["content-disposition"], /^attachment; filename="[a-z0-9-]+\.png"$/);

  const sourceImages = await Promise.all(final.candidates.filter((candidate) => candidate.status === "approved").map((source) => (
    request(fixture.server.url, `/mockup-source/${source.sourceSlideNumber}/${source.imageHash}`, {
      headers: authenticatedHeaders(fixture.cookie),
    })
  )));
  for (const sourceImage of sourceImages) {
    assert.equal(sourceImage.status, 200);
    assert.equal(sourceImage.headers["content-type"], "image/png");
    assertSecurityHeaders(sourceImage);
  }
  const unapprovedSource = await request(fixture.server.url, `/mockup-source/9/${"0".repeat(64)}`, {
    headers: authenticatedHeaders(fixture.cookie),
  });
  assert.equal(unapprovedSource.status, 404);
});

async function titleBrowserFixture(t) {
  const fixture = await mockupBrowserFixture(t);
  const initial = await getMockupReview(fixture);
  const headers = mutationHeaders(fixture.server, fixture.cookie, initial.csrfToken);
  const initialized = await request(fixture.server.url, "/api/mockups/initialize", {
    method: "POST", headers, body: JSON.stringify({ title: "기존 작업물명 유지" }),
  });
  assert.equal(initialized.status, 200);
  const getTitle = async () => {
    const response = await request(fixture.server.url, "/api/mockups/title", { headers: authenticatedHeaders(fixture.cookie) });
    assert.equal(response.status, 200);
    return JSON.parse(response.body.toString("utf8")).review;
  };
  const postTitle = (action, body, overrideHeaders = headers) => request(fixture.server.url, `/api/mockups/title/${action}`, {
    method: "POST", headers: overrideHeaders, body: JSON.stringify(body),
  });
  return { ...fixture, getTitle, postTitle };
}

test("title review is read-only, local-auth protected and public DTO excludes paths and artifacts", async (t) => {
  const fixture = await titleBrowserFixture(t);
  const recordPath = path.join(fixture.root, "builds", fixture.buildId, "record.json");
  const before = await readFile(recordPath, "utf8");
  const unauthenticated = await request(fixture.server.url, "/api/mockups/title");
  assert.equal(unauthenticated.status, 401);
  const crossOrigin = await request(fixture.server.url, "/api/mockups/title", {
    headers: authenticatedHeaders(fixture.cookie, { Origin: "https://example.invalid" }),
  });
  assert.equal(crossOrigin.status, 403);
  const review = await fixture.getTitle();
  assert.equal(review.available, true);
  assert.equal(review.revision, null);
  assert.deepEqual(review.title, { main: "", sub: "", showSub: false, style: "bold" });
  assert.equal(review.legacyTitle, "기존 작업물명 유지");
  assert.equal(review.localOnly, true);
  assert.equal(await readFile(recordPath, "utf8"), before);
  assert.doesNotMatch(JSON.stringify(review), /artifactKey|relativePath|sourceHash|sourcePath|workId|buildId|manifest|[A-Z]:\\/);
  const page = await request(fixture.server.url, "/mockups", { headers: authenticatedHeaders(fixture.cookie) });
  assert.match(page.body.toString("utf8"), /메인 제목 · 작업물 종류/);
  assert.match(page.body.toString("utf8"), /보조 제목 · 브랜드명\(선택\)/);
  assert.match(page.body.toString("utf8"), /이 제목으로 로컬 확정/);
});

test("title mutations require CSRF, exact allowed keys and checked final image hash", async (t) => {
  const fixture = await titleBrowserFixture(t);
  const review = await fixture.getTitle();
  const body = { expectedRevision: null, expectedBaseFingerprint: review.baseFingerprint, title: { main: "행사 제안서", sub: "", showSub: false, style: "bold" } };
  const noCsrf = await fixture.postTitle("save", body, authenticatedHeaders(fixture.cookie, {
    Origin: new URL(fixture.server.url).origin, "Content-Type": "application/json",
  }));
  assert.equal(noCsrf.status, 403);
  for (const malformed of [
    { ...body, publish: true },
    { ...body, title: { ...body.title, html: "<script>secret()</script>" } },
    { ...body, expectedBaseFingerprint: "invalid" },
    { ...body, expectedRevision: -1 },
  ]) {
    const response = await fixture.postTitle("save", malformed);
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.body.toString("utf8"), /script|secret|sourcePath|artifactKey|at /);
  }
  const saved = await fixture.postTitle("save", body);
  assert.equal(saved.status, 200);
  const current = JSON.parse(saved.body.toString("utf8")).review;
  const noConfirm = await fixture.postTitle("confirm", {
    expectedRevision: current.revision, expectedBaseFingerprint: current.baseFingerprint,
    expectedFinalHash: "a".repeat(64), visualConfirmed: false,
  });
  assert.equal(noConfirm.status, 400);
  const conflict = await fixture.postTitle("save", body);
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.toString("utf8"), /입력 문구는 유지/);
  const wide = await fixture.postTitle("save", { ...body, expectedRevision: current.revision, title: { ...body.title, main: "W".repeat(40) } });
  assert.equal(wide.status, 400);
  assert.match(wide.body.toString("utf8"), /짧게 줄여/);
  const emoji = await fixture.postTitle("save", { ...body, expectedRevision: current.revision, title: { ...body.title, main: "제안서😀" } });
  assert.equal(emoji.status, 400);
  assert.match(emoji.body.toString("utf8"), /특수문자/);
});

test("title-only HTTP flow preserves legacy assignments, confirms explicitly, and serves exact hash only", async (t) => {
  const fixture = await titleBrowserFixture(t);
  const beforeLegacy = (await getMockupReview(fixture)).review;
  let review = await fixture.getTitle();
  const advance = async (action, extra) => {
    const response = await fixture.postTitle(action, {
      expectedRevision: review.revision, expectedBaseFingerprint: review.baseFingerprint, ...extra,
    });
    assert.equal(response.status, 200, response.body.toString("utf8"));
    review = JSON.parse(response.body.toString("utf8")).review;
  };
  await advance("save", { title: { main: "행사 제안서", sub: "합성 브랜드", showSub: true, style: "bold" } });
  const premature = await fixture.postTitle("render", {
    expectedRevision: review.revision, expectedBaseFingerprint: review.baseFingerprint, scale: 1,
  });
  assert.equal(premature.status, 409);
  await advance("render", { scale: 0.5 });
  await advance("render", { scale: 1 });
  assert.equal(review.active, null);
  assert.ok(review.draft);
  assert.ok(review.final);
  const imagePath = `/mockup-title-image/final/${review.final.sha256}`;
  const bytes = await request(fixture.server.url, imagePath, { headers: authenticatedHeaders(fixture.cookie) });
  assert.equal(bytes.status, 200);
  assert.equal(bytes.headers["content-type"], "image/png");
  assertSecurityHeaders(bytes);
  assert.equal(createHash("sha256").update(bytes.body).digest("hex"), review.final.sha256);
  const wrongHash = await request(fixture.server.url, `/mockup-title-image/final/${"0".repeat(64)}`, { headers: authenticatedHeaders(fixture.cookie) });
  assert.notEqual(wrongHash.status, 200);
  const noCookieImage = await request(fixture.server.url, imagePath);
  assert.equal(noCookieImage.status, 401);
  await advance("confirm", { expectedFinalHash: review.final.sha256, visualConfirmed: true });
  assert.equal(review.active.sha256, review.final.sha256);
  const active = await request(fixture.server.url, `/mockup-title-image/active/${review.active.sha256}`, { headers: authenticatedHeaders(fixture.cookie) });
  assert.equal(active.status, 200);
  assert.deepEqual((await getMockupReview(fixture)).review, beforeLegacy);
  assert.doesNotMatch(JSON.stringify(review), /artifactKey|relativePath|sourcePath|sourceHash|workId|buildId|manifest/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { openPreparationWorkStore } from './work-store.ts';
import { initializeLocalRedactions, getLocalRedactionSlide, saveLocalRedactionSlide, renderLocalRedactionSlide, approveLocalRedactionSlide, readSafeRedactedSlide } from './redaction-service.ts';
import { redactionHash } from './redaction-renderer.ts';

const editorScript = await readFile(new URL('./redaction-editor-client.mjs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const settleEditor = async () => { for (let n = 0; n < 8; n++) await new Promise(resolve => setImmediate(resolve)); };
const manualRegion = (id = 'manual-1', mode = 'blur') => ({ id, mode, rect: { x: .12, y: .2, width: .3, height: .08 } });
const baseState = () => ({
  sourceSlideNumber: 2, revision: 0, width: 400, height: 225, candidates: [
    { id: 'optional-name', category: 'name', required: false, reason: 'OPTIONAL_NAME_REVIEW', rect: { x: .1, y: .1, width: .2, height: .1 } },
  ], regions: [], exceptions: [], manualResolutions: [], warnings: [], uncertainties: [],
  review: { reviewer: '', originalInspected: false, layoutAcceptable: true }, status: 'editing', output: null,
});

async function editorFixture(initial, { previousSavedSlide = null, service = null, post = null } = {}) {
  const allNodes = [];
  const focusState = { node: null };
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.listeners = new Map(); this.dataset = {}; this.style = {};
      this.value = ''; this._checked = false; this.disabled = false; this.hidden = false; this.className = ''; this._text = '';
      this.complete = true; this.naturalWidth = initial.width; this.clientWidth = initial.width; this.scrollLeft = 0; this.scrollTop = 0;
      allNodes.push(this);
    }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set textContent(value) { this._text = value; this.children = []; }
    get checked() { return this._checked; }
    set checked(value) { this._checked = value; if (value && this.radioGroup) for (const node of allNodes) if (node !== this && node.radioGroup === this.radioGroup) node._checked = false; }
    get childElementCount() { return this.children.length; }
    append(...children) { for (const node of children) { node.parentElement = this; this.children.push(node); if (this.tagName === 'select' && this.children.length === 1) this.value = node.value; } }
    replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(kind, callback) { const list = this.listeners.get(kind) ?? []; list.push(callback); this.listeners.set(kind, list); }
    emit(kind, details = {}) { return Promise.all((this.listeners.get(kind) ?? []).map(callback => callback({ target: this, currentTarget: this, relatedTarget: null, preventDefault() {}, ...details }))); }
    get classList() { return { contains: value => this.className.split(/\s+/).includes(value), toggle: (value, force) => { const values = new Set(this.className.split(/\s+/).filter(Boolean)); const add = force ?? !values.has(value); if (add) values.add(value); else values.delete(value); this.className = [...values].join(' '); return add; } }; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    emitBubbling(kind, details) { this.emit(kind, details); this.parentElement?.emitBubbling(kind, details); }
    focus() { const previous = focusState.node; if (previous === this) return; focusState.node = this; if (previous) previous.emitBubbling('focusout', { target: previous, relatedTarget: this }); this.emitBubbling('focusin', { target: this, relatedTarget: previous }); }
    blur() { if (focusState.node !== this) return; focusState.node = null; this.emitBubbling('focusout', { target: this }); }
    matches(selector) { return selector.startsWith('[data-') ? Boolean(this.dataset[selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]) : selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector; }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: initial.width, height: initial.height }; }
    scrollIntoView(options) { this.scrollIntoViewCalls ??= []; this.scrollIntoViewCalls.push(options); }
    setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
    releasePointerCapture() { this.capturedPointer = null; }
  }
  const nodes = new Map([...editorScript.matchAll(/document\.querySelector\("([#.][^"]+)"\)/g)].map(match => [match[1], new Node()]));
  const body = new Node('body'); body.dataset.sourceSlideNumber = String(initial.sourceSlideNumber);
  for (const [selector, node] of nodes) { if (selector.startsWith('#')) node.id = selector.slice(1); else node.className = selector.slice(1); body.append(node); }
  for (const name of ['#compare-before', '#compare-after']) nodes.get(name).radioGroup = 'comparison';
  nodes.get('#mask-mode').value = 'blur'; nodes.get('#zoom').value = '100';
  const decisions = ['keep', 'replace'].map(value => { const node = new Node('input'); node.value = value; node.radioGroup = 'layout'; return node; });
  const requests = []; let serverState = plain(initial);
  const context = vm.createContext({
    document: { body, querySelector: selector => selector.includes('layout-decision') ? decisions.find(node => node.checked) : nodes.get(selector) ?? body.querySelector(selector), querySelectorAll: selector => selector.includes('layout-decision') ? decisions : body.querySelectorAll(selector), createElement: tag => new Node(tag) },
    crypto: webcrypto, getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0' }), requestAnimationFrame: callback => callback(),
    fetch: async (url, options) => {
      const payload = options.body ? JSON.parse(options.body) : undefined; requests.push({ url, method: options.method, payload, headers: options.headers });
      if (options.method === 'POST') {
        const result = post ? await post({ url, payload }) : null;
        if (result?.error) return { ok: false, headers: { get: () => 'application/json' }, json: async () => ({ error: result.error }) };
        if (service) {
          if (url.endsWith('/save')) serverState = await saveLocalRedactionSlide({ ...service, ...payload });
          if (url.endsWith('/render')) serverState = await renderLocalRedactionSlide({ ...service, ...payload });
          if (url.endsWith('/approve')) serverState = await approveLocalRedactionSlide({ ...service, ...payload });
        } else if (url.endsWith('/save')) serverState = { ...serverState, ...payload, revision: serverState.revision + 1, output: null, status: payload.review.layoutAcceptable ? 'editing' : 'replacement_required' };
        else if (url.endsWith('/render')) serverState = { ...serverState, revision: serverState.revision + 1, status: 'rendered', output: { sha256: 'a'.repeat(64), approvedAt: null, approvedBy: null } };
        else if (url.endsWith('/approve')) serverState = { ...serverState, revision: serverState.revision + 1, status: 'verified', output: { ...serverState.output, approvedAt: '2026-10-30T00:00:00.000Z', approvedBy: payload.reviewer } };
      }
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ csrfToken: 'c'.repeat(64), state: plain(serverState), previousSavedSlide: plain(previousSavedSlide) }) };
    },
  });
  vm.runInContext(editorScript, context); await settleEditor();
  const run = expression => vm.runInContext(expression, context);
  const click = async node => { assert.ok(node, 'button is present'); await node.emit('click'); await settleEditor(); };
  return { nodes, body, run, requests, click, decisions, node: selector => nodes.get(selector), button: (label, root = body) => root.querySelectorAll('button').find(node => node.textContent === label), read: expression => plain(run(expression)), get state() { return serverState; } };
}

async function storedFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'woolim-redaction-editor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await openPreparationWorkStore({ root });
  const sourceHash = redactionHash('SYNTHETIC EDITOR ONLY');
  let { build } = await store.beginOrResumeBuild({ expectedWorkRevision: null, fingerprint: { source: { sha256: sourceHash, bytes: 21 }, conversionSettingsFingerprint: 'synthetic', fontFingerprint: 'synthetic' } });
  const buildId = build.buildId;
  const png = await sharp({ create: { width: 400, height: 225, channels: 3, background: '#8899aa' } }).png().toBuffer();
  build = await store.completeStage({ buildId, stage: 'source_inspection', expectedRevision: build.revision, inputFingerprint: 'inspection', data: { sourceHash, slides: [{ sourceSlideNumber: 2, contentHash: redactionHash('slide2') }] } });
  build = await store.completeStage({ buildId, stage: 'preview_generation', expectedRevision: build.revision, inputFingerprint: 'preview' });
  build = await store.recordSelection({ buildId, expectedRevision: build.revision, expectedSelectionRevision: 0, selectionFingerprint: 'selection', data: { selected: [2], reserves: [], status: 'ready_for_local_review' } });
  const relativePath = 'highres/2.png'; await writeFile(await store.prepareArtifactPath(buildId, relativePath), png);
  build = await store.recordArtifact({ buildId, key: 'highres:2', relativePath, expectedRevision: build.revision });
  await store.completeStage({ buildId, stage: 'high_resolution_conversion', expectedRevision: build.revision, inputFingerprint: 'highres', artifactKeys: ['highres:2'] });
  await store.release();
  const detection = { ...baseState(), sourceHash, slideContentHash: redactionHash('slide2'), warnings: [] };
  detection.uncertainties = [{ id: 'uncertain-name', candidateId: 'optional-name', rect: detection.candidates[0].rect, code: 'TEXT_RENDER_BOUNDS_UNRESOLVED' }];
  await initializeLocalRedactions({ root, buildId, detections: [detection] });
  return { root, buildId, sourceSlideNumber: 2 };
}

async function dragRegion(editor, { from, to, target = editor.node('#redaction-overlay'), pointerId = 1 }) {
  const overlay = editor.node('#redaction-overlay');
  await overlay.emit('pointerdown', { target, pointerId, clientX: from[0], clientY: from[1] });
  await overlay.emit('pointermove', { pointerId, clientX: to[0], clientY: to[1] });
  await overlay.emit('pointerup', { pointerId });
}

test('editor draws a rectangle, saves and renders in one action, then approves the exact stored output', async t => {
  const service = await storedFixture(t), initial = await getLocalRedactionSlide(service);
  const editor = await editorFixture(initial, { service, previousSavedSlide: { sourceSlideNumber: 1, reviewer: '합성 검토자', regions: [] } });
  assert.equal(editor.node('#reviewer').value, '합성 검토자');
  await editor.click(editor.node('#add-region'));
  await dragRegion(editor, { from: [40, 45], to: [160, 90] });
  assert.deepEqual(editor.read('regions[0].rect'), { x: .1, y: .2, width: .30000000000000004, height: .2 });
  await editor.click(editor.node('#save-redaction'));
  assert.deepEqual(editor.requests.filter(request => request.method === 'POST').map(request => request.url), ['/api/redaction/2/save', '/api/redaction/2/render']);
  assert.equal(editor.state.status, 'rendered');
  assert.equal(editor.state.review.originalInspected, false);
  assert.deepEqual(editor.state.manualResolutions, []);
  const saved = editor.requests.find(request => request.url.endsWith('/save'));
  assert.ok(!('manualResolutions' in saved.payload));
  assert.ok(!('originalInspected' in saved.payload.review));
  assert.equal(saved.headers['X-Woolim-CSRF'], 'c'.repeat(64));
  assert.equal(editor.node('#redaction-overlay').hidden, true);
  assert.equal(editor.node('#approve-redaction').textContent, '블러본을 확인했고 승인합니다');
  await editor.click(editor.node('#approve-redaction'));
  assert.equal(editor.state.status, 'verified');
  assert.equal(editor.state.output.approvedBy, '합성 검토자');
  assert.equal(editor.requests.at(-1).payload.outputHash, editor.state.output.sha256);
  assert.equal(editor.requests.at(-1).payload.outputInspected, true);
  assert.equal(redactionHash(await readSafeRedactedSlide(service)), editor.state.output.sha256);
});

test('editor omits candidate lists, candidate boxes, exception dialogs and actual-size inspection controls', async () => {
  const initial = baseState();
  initial.uncertainties = [{ id: 'uncertain-name', candidateId: 'optional-name', rect: initial.candidates[0].rect, code: 'TEXT_RENDER_BOUNDS_UNRESOLVED' }];
  const editor = await editorFixture(initial);
  assert.equal(editor.node('#candidate-list'), undefined);
  assert.equal(editor.node('#render-redaction'), undefined);
  assert.equal(editor.node('#original-inspected'), undefined);
  assert.equal(editor.node('#output-inspected'), undefined);
  assert.equal(editor.body.querySelectorAll('.candidate-box').length, 0);
  assert.equal(editor.body.querySelectorAll('dialog').length, 0);
  assert.doesNotMatch(editor.body.textContent, /자동 확인 후보|공개 예외|개별 확인|100% 확대|확대 확인 후|전부 가리기/);
});

test('editor keeps required automatic masks opaque and prevents deletion, movement and resizing', async () => {
  const initial = baseState(), required = { ...initial.candidates[0], id: 'required-email', required: true, category: 'email' };
  initial.candidates.push(required); initial.regions = [{ id: 'auto-email', candidateId: required.id, mode: 'opaque', rect: required.rect }];
  const editor = await editorFixture(initial), before = editor.read('regions');
  const row = editor.node('#region-list').querySelector('.region-row');
  assert.equal(row.querySelector('select').disabled, true);
  assert.equal(row.querySelector('select').value, 'opaque');
  assert.equal(editor.button('영역 삭제'), undefined);
  const box = editor.node('#redaction-overlay').querySelector('.region-box');
  assert.equal(box.querySelector('.resize-handle'), null);
  await dragRegion(editor, { target: box, from: [50, 50], to: [200, 160] });
  await editor.node('#redaction-overlay').emit('pointercancel', { pointerId: 1 });
  assert.deepEqual(editor.read('regions'), before);
  assert.equal(editor.run('undoStack.length'), 0);
});

test('editor copies only previous saved manual regions with fresh ids and preserves coordinates and modes', async () => {
  const copied = [manualRegion('old-blur'), manualRegion('old-opaque', 'opaque')];
  const previousSavedSlide = { sourceSlideNumber: 1, reviewer: '앞 검토자', regions: [...copied, { ...manualRegion('bound'), candidateId: 'optional-name' }] };
  const editor = await editorFixture(baseState(), { previousSavedSlide });
  assert.equal(editor.node('#copy-previous-regions').hidden, false);
  assert.equal(editor.node('#reviewer').value, '앞 검토자');
  await editor.click(editor.node('#copy-previous-regions'));
  const imported = editor.read('regions');
  assert.deepEqual(imported.map(({ rect, mode }) => ({ rect, mode })), copied.map(({ rect, mode }) => ({ rect, mode })));
  assert.ok(imported.every(region => !('candidateId' in region) && !previousSavedSlide.regions.some(old => old.id === region.id)));
  assert.notEqual(imported[0].id, imported[1].id);
  assert.equal(editor.run('undoStack.length'), 1);
  await editor.click(editor.node('#undo')); assert.deepEqual(editor.read('regions'), []);
  await editor.click(editor.node('#redo')); assert.deepEqual(editor.read('regions'), imported);
  const box = editor.node('#redaction-overlay').querySelector('.region-box');
  await dragRegion(editor, { target: box, from: [50, 50], to: [90, 70] });
  assert.notDeepEqual(editor.read('regions[0].rect'), imported[0].rect);
  const moved = editor.read('regions[0].rect'), handle = editor.node('#redaction-overlay').querySelector('.resize-handle');
  await dragRegion(editor, { target: handle, from: [90, 70], to: [130, 90] });
  assert.ok(editor.read('regions[0].rect').width > moved.width);
  await editor.click(editor.button('영역 삭제')); assert.equal(editor.run('regions.length'), 1);
  await editor.click(editor.node('#undo')); assert.equal(editor.run('regions.length'), 2);
  assert.deepEqual(previousSavedSlide.regions.slice(0, 2), copied);
});

test('editor hides copying without previous manual regions and prefers this slide reviewer', async () => {
  for (const previousSavedSlide of [null, { reviewer: '앞 검토자', regions: [] }, { reviewer: '앞 검토자', regions: [{ ...manualRegion(), candidateId: 'old-candidate' }] }]) {
    const initial = baseState(); initial.review.reviewer = '현재 검토자';
    const editor = await editorFixture(initial, { previousSavedSlide });
    assert.equal(editor.node('#copy-previous-regions').hidden, true);
    assert.equal(editor.node('#reviewer').value, '현재 검토자');
    await editor.click(editor.node('#copy-previous-regions'));
    assert.deepEqual(editor.read('regions'), []);
    assert.equal(editor.run('dirty'), false);
  }
});

test('editor loads legacy exceptions and inspection evidence without showing it or clearing approval', async () => {
  const initial = baseState();
  initial.review = { reviewer: '기존 검토자', originalInspected: true, layoutAcceptable: true };
  initial.exceptions = [{ candidateId: 'optional-name', actor: '과거 허용자', reason: '기존 공개 기록' }];
  initial.manualResolutions = [{ uncertaintyId: 'legacy-review', inspectedAtActualSize: true, actor: '과거 확인자' }];
  initial.status = 'verified'; initial.output = { sha256: 'b'.repeat(64), approvedAt: '2026-10-29T00:00:00.000Z', approvedBy: '기존 검토자' };
  const editor = await editorFixture(initial);
  assert.deepEqual(editor.read('state'), initial);
  assert.equal(editor.run('dirty'), false);
  assert.equal(editor.node('#approve-redaction').textContent, '이 장표는 승인됨');
  assert.equal(editor.node('#approve-redaction').disabled, true);
  assert.match(editor.node('#source-image').src, /\/redacted\/2\/b{64}$/);
  assert.doesNotMatch(editor.body.textContent, /과거 허용자|과거 확인자|기존 공개 기록|legacy-review/);
  assert.equal(editor.requests.filter(request => request.method === 'POST').length, 0);
});

test('editor refuses empty reviewer before save or rendering and does not claim original inspection', async () => {
  const editor = await editorFixture(baseState());
  for (const reviewer of ['', '   ']) {
    editor.node('#reviewer').value = reviewer;
    await editor.click(editor.node('#save-redaction'));
    assert.equal(editor.requests.filter(request => request.method === 'POST').length, 0);
    assert.equal(editor.node('#editor-status').textContent, '검토자 이름을 입력해 주세요.');
  }
  editor.node('#reviewer').value = '검토자';
  await editor.click(editor.node('#save-redaction'));
  assert.ok(!('originalInspected' in editor.requests.find(request => request.url.endsWith('/save')).payload.review));
  assert.ok(editor.requests.every(request => !request.payload || !('manualResolutions' in request.payload)));
});

test('editor saves replacement choice without rendering and serializes save plus render against repeated clicks', async () => {
  const initial = baseState(); initial.review.reviewer = '검토자';
  const editor = await editorFixture(initial);
  editor.decisions[1].checked = true; await editor.decisions[1].emit('change');
  await editor.click(editor.node('#save-redaction'));
  assert.equal(editor.state.status, 'replacement_required');
  assert.deepEqual(editor.requests.filter(request => request.method === 'POST').map(request => request.url), ['/api/redaction/2/save']);
  let finishSave;
  const delayed = await editorFixture(initial, { post: ({ url }) => url.endsWith('/save') ? new Promise(resolve => { finishSave = resolve; }) : undefined });
  const first = delayed.node('#save-redaction').emit('click'); await settleEditor();
  assert.equal(delayed.node('#save-redaction').disabled, true);
  await delayed.click(delayed.node('#save-redaction'));
  assert.equal(delayed.requests.filter(request => request.method === 'POST').length, 1);
  finishSave(); await first; await settleEditor();
  assert.deepEqual(delayed.requests.filter(request => request.method === 'POST').map(request => request.url), ['/api/redaction/2/save', '/api/redaction/2/render']);
  assert.equal(delayed.node('#save-redaction').disabled, false);
});

test('editor region hover, keyboard focus and navigation preserve the edit draft and zoom', async () => {
  const initial = baseState(); initial.regions = [manualRegion()];
  const editor = await editorFixture(initial), row = editor.node('#region-list').querySelector('.region-row'), box = editor.node('#redaction-overlay').querySelector('.region-box');
  await row.emit('pointerenter'); assert.equal(box.classList.contains('locator-active'), true);
  await row.emit('pointerleave'); assert.equal(box.classList.contains('locator-active'), false);
  row.querySelector('.locator-button').focus(); await row.emit('pointerenter'); await row.emit('pointerleave');
  assert.equal(box.classList.contains('locator-active'), true);
  editor.node('#zoom').value = '175'; await editor.node('#zoom').emit('input');
  const before = editor.read('({regions,dirty,undoStack,redoStack,zoom:zoomInput.value})');
  await editor.click(row.querySelector('.locator-button'));
  assert.deepEqual(editor.read('({regions,dirty,undoStack,redoStack,zoom:zoomInput.value})'), before);
  assert.equal(editor.node('.image-scroller').scrollIntoViewCalls.length, 1);
});

test('editor persists manual moves, resizing and undo/redo after drawing', async t => {
  const service = await storedFixture(t), editor = await editorFixture(await getLocalRedactionSlide(service), { service });
  editor.node('#reviewer').value = '검토자';
  await editor.click(editor.node('#add-region'));
  await dragRegion(editor, { from: [40, 45], to: [160, 90] });
  const drawn = editor.read('regions');
  await dragRegion(editor, { target: editor.node('#redaction-overlay').querySelector('.region-box'), from: [80, 60], to: [120, 105] });
  const moved = editor.read('regions');
  assert.notDeepEqual(moved, drawn);
  await dragRegion(editor, { target: editor.node('#redaction-overlay').querySelector('.resize-handle'), from: [120, 105], to: [180, 150] });
  const resized = editor.read('regions');
  assert.ok(resized[0].rect.width > moved[0].rect.width);
  assert.ok(resized[0].rect.height > moved[0].rect.height);
  await editor.click(editor.node('#undo')); assert.deepEqual(editor.read('regions'), moved);
  await editor.click(editor.node('#redo')); assert.deepEqual(editor.read('regions'), resized);
  await editor.click(editor.node('#save-redaction'));
  assert.equal(editor.state.status, 'rendered');
  assert.deepEqual((await getLocalRedactionSlide(service)).regions, resized);
});

test('editor keeps the saved draft when rendering fails and retries with the current stored revision', async t => {
  const service = await storedFixture(t);
  let renderAttempts = 0;
  const editor = await editorFixture(await getLocalRedactionSlide(service), {
    service, previousSavedSlide: { sourceSlideNumber: 1, reviewer: '앞 검토자', regions: [manualRegion()] },
    post: ({ url }) => url.endsWith('/render') && renderAttempts++ === 0 ? { error: 'SYNTHETIC_RENDER_FAILURE' } : null,
  });
  await editor.click(editor.node('#copy-previous-regions'));
  const draft = editor.read('regions');
  await editor.click(editor.node('#save-redaction'));
  assert.equal(editor.node('#editor-status').textContent, 'SYNTHETIC_RENDER_FAILURE');
  assert.equal(editor.node('#editor-status').dataset.kind, 'error');
  assert.equal(editor.node('#save-redaction').disabled, false);
  assert.equal(editor.node('#approve-redaction').disabled, true);
  assert.equal(editor.run('dirty'), false);
  const saved = await getLocalRedactionSlide(service);
  assert.deepEqual(saved.regions, draft);
  assert.equal(saved.output, null);
  assert.equal(editor.state.revision, saved.revision);
  await editor.click(editor.node('#save-redaction'));
  assert.equal(editor.state.status, 'rendered');
  assert.deepEqual(editor.state.regions, draft);
  assert.equal(editor.requests.filter(request => request.url.endsWith('/render')).length, 2);
});

test('editor can draw immediately after reopening rendered or approved output without changing approval on view alone', async () => {
  for (const status of ['rendered', 'verified']) {
    const initial = baseState();
    initial.status = status;
    initial.output = { sha256: 'b'.repeat(64), approvedAt: status === 'verified' ? '2026-10-30T00:00:00.000Z' : null, approvedBy: status === 'verified' ? '기존 검토자' : null };
    const editor = await editorFixture(initial);
    assert.equal(editor.node('#redaction-overlay').hidden, true);
    await editor.click(editor.node('#add-region'));
    assert.equal(editor.node('#redaction-overlay').hidden, false);
    assert.equal(editor.node('#compare-before').checked, true);
    assert.equal(editor.run('dirty'), false);
    assert.deepEqual(editor.read('state'), initial);
    assert.equal(editor.requests.filter(request => request.method === 'POST').length, 0);
    await dragRegion(editor, { from: [40, 45], to: [160, 90] });
    assert.equal(editor.run('regions.length'), 1);
    assert.equal(editor.run('dirty'), true);
    assert.equal(editor.node('#approve-redaction').disabled, true);
  }
});

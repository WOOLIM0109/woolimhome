// Private stdin/stdout subprocess; no HTTP, environment loading, storage or AI.
import { renderApprovedMockup } from '../lib/portfolio/approved-16x9-renderer.ts';
import { APPROVED_MOCKUP_SUITES, approvedMockupSuiteTemplates } from '../lib/portfolio/approved-mockup-suites.ts';

globalThis.fetch = () => { throw new Error('APPROVED_SERVER_NETWORK_FORBIDDEN'); };
let size = 0; const chunks = [];
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 96 * 1024 * 1024) throw new Error('APPROVED_SERVER_RENDER_INPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (Object.keys(input).sort().join(',') !== 'outputFormat,scale,slides,templateId,templateVersion,title') throw new Error('APPROVED_SERVER_RENDER_INPUT_INVALID');
  const template = APPROVED_MOCKUP_SUITES.flatMap(approvedMockupSuiteTemplates).find(t => t.id === input.templateId && t.version === input.templateVersion);
  if (!template || ![0.5, 1].includes(input.scale) || !['jpeg', 'png'].includes(input.outputFormat)
    || (input.title !== null && (typeof input.title !== 'string' || input.title.length > 1000))
    || !Array.isArray(input.slides) || !input.slides.length || input.slides.length > 40) throw new Error('APPROVED_SERVER_RENDER_INPUT_INVALID');
  const slides = input.slides.map(slide => {
    if (Object.keys(slide).sort().join(',') !== 'base64,index' || !Number.isSafeInteger(slide.index) || slide.index < 0
      || typeof slide.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(slide.base64)) throw new Error('APPROVED_SERVER_RENDER_INPUT_INVALID');
    const buffer = Buffer.from(slide.base64, 'base64');
    if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('APPROVED_SERVER_RENDER_INPUT_INVALID');
    return { index: slide.index, buffer };
  });
  const result = await renderApprovedMockup({ template, slides, title: input.title, scale: input.scale, outputFormat: input.outputFormat, runtimeRoot: process.cwd() });
  const { bytes, ...receipt } = result;
  process.stdout.write(JSON.stringify({ ...receipt, base64: bytes.toString('base64') }));
} catch {
  process.stderr.write('APPROVED_SERVER_RENDER_FAILED'); process.exitCode = 1;
}

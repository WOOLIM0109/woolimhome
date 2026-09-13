// Private stdin/stdout renderer. No HTTP listener, environment loading or AI.
import {renderThumbnailTitleOverlay,normalizeThumbnailTitleSpec,thumbnailTitleOverlayFingerprint} from '../lib/portfolio/thumbnail-title-overlay.ts';
globalThis.fetch=()=>{throw new Error('THUMBNAIL_NETWORK_FORBIDDEN');};
let input='';
try{
 for await(const chunk of process.stdin){input+=chunk;if(input.length>18*1024*1024)throw new Error('THUMBNAIL_INPUT_TOO_LARGE');}
 const request=JSON.parse(input);
 if(Object.keys(request).sort().join(',')!=='aspectClass,basePng,title'||typeof request.basePng!=='string')throw new Error('THUMBNAIL_INPUT_INVALID');
 const result=await renderThumbnailTitleOverlay({basePng:Buffer.from(request.basePng,'base64'),title:normalizeThumbnailTitleSpec(request.title),aspectClass:request.aspectClass,scale:1});
 process.stdout.write(JSON.stringify({png:result.bytes.toString('base64'),overlayFingerprint:await thumbnailTitleOverlayFingerprint()}));
}catch(error){process.stderr.write((error instanceof Error?error.message.match(/^[A-Z][A-Z0-9_]+/)?.[0]:null)||'THUMBNAIL_RENDER_FAILED');process.exitCode=1;}

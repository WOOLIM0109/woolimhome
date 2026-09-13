import {spawn} from 'node:child_process';
import path from 'node:path';
import type {ThumbnailTitleSpec,ThumbnailTitleAspectClass} from './thumbnail-title-overlay.ts';
import {isSha} from './production-session.ts';
/** Run native font layout from traced source files, unaffected by Next bundling
 * import.meta paths. Child receives no DB/worker/Gemini environment secrets. */
export function renderProductionThumbnail(input:{basePng:Buffer;title:ThumbnailTitleSpec;aspectClass:ThumbnailTitleAspectClass}):Promise<{bytes:Buffer;overlayFingerprint:string}>{
 return new Promise((resolve,reject)=>{
  const env:NodeJS.ProcessEnv={NODE_ENV:'production'};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LD_LIBRARY_PATH'])if(process.env[key])env[key]=process.env[key];
  const child=spawn(process.execPath,['--experimental-strip-types',path.resolve(process.cwd(),'scripts/render-production-thumbnail.mjs')],{cwd:process.cwd(),windowsHide:true,env,stdio:['pipe','pipe','pipe']});
  const chunks:Buffer[]=[];let size=0,failed=false,stderr='';
  const stop=(code:string)=>{if(failed)return;failed=true;child.kill();reject(new Error(code));};
  const timeout=setTimeout(()=>stop('THUMBNAIL_RENDER_TIMEOUT'),45000);
  child.on('error',()=>stop('THUMBNAIL_RENDER_UNAVAILABLE'));
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>18*1024*1024)stop('THUMBNAIL_OUTPUT_TOO_LARGE');else chunks.push(Buffer.from(chunk));});
  child.stderr.on('data',chunk=>{if(stderr.length<16384)stderr+=String(chunk);});
  child.stdin.on('error',()=>stop('THUMBNAIL_RENDER_INPUT_FAILED'));
  child.on('close',code=>{clearTimeout(timeout);if(failed)return;if(code!==0){reject(new Error(stderr.match(/\b(?:MOCKUP_TITLE|THUMBNAIL)_[A-Z_]+\b/)?.[0]||'THUMBNAIL_RENDER_FAILED'));return;}
   try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(typeof result.png!=='string'||!isSha(result.overlayFingerprint))throw new Error();const bytes=Buffer.from(result.png,'base64');if(!bytes.length||bytes.length>12*1024*1024)throw new Error();resolve({bytes,overlayFingerprint:result.overlayFingerprint});}catch{reject(new Error('THUMBNAIL_RENDER_RESULT_INVALID'));}
  });
  child.stdin.end(JSON.stringify({...input,basePng:input.basePng.toString('base64')}));
 });
}

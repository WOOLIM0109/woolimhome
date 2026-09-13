import type {ThumbnailTitleSpec} from './thumbnail-title-overlay.ts';
export type {ThumbnailTitleSpec,ThumbnailTitleAspectClass} from './thumbnail-title-overlay.ts';

/** Server-only pure mirror of the frozen local overlay schema. Equivalence tests
 * prevent drift, without importing filesystem/native rendering into Next bundles
 * or invalidating previously verified local overlay fingerprints. */
export function normalizeThumbnailTitleSpec(value:unknown):ThumbnailTitleSpec {
 const fail=(code:string):never=>{throw new Error(code);};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('MOCKUP_TITLE_INVALID');
 const input=value as Record<string,unknown>;
 if(JSON.stringify(Object.keys(input).sort())!==JSON.stringify(['main','showSub','style','sub'])||typeof input.showSub!=='boolean'||input.style!=='bold')fail('MOCKUP_TITLE_INVALID');
 const line=(value:unknown,field:'main'|'sub',max:number)=>{
  if(typeof value!=='string'||value.length>max*4) return fail('MOCKUP_TITLE_INVALID');
  if(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\uFE00-\uFE0F]/u.test(value)||/[^\S ]/u.test(value))fail('MOCKUP_TITLE_INVALID_CHARACTER');
  const normalized=value.normalize('NFC').trim().replace(/ {2,}/g,' ');
  if(Array.from(normalized).length>max)fail('MOCKUP_TITLE_TOO_LONG');
  if(field==='main'&&!normalized)fail('MOCKUP_TITLE_REQUIRED');
  return normalized;
 };
 return {main:line(input.main,'main',40),sub:line(input.sub,'sub',60),showSub:input.showSub as boolean,style:'bold'};
}

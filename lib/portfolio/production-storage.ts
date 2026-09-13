import 'server-only';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {contentAdmin} from '@/lib/content-ops/data';
import {assertFlatRedactionPng} from '@/lib/pc-worker/preparation/redaction-renderer';
import type {ProductionMockupDescriptor} from '@/lib/pc-worker/preparation/production-snapshot-types';
import {isUuid} from './production-session';
export function productionObjectSpecs(workItemId:string,sessionId:string,descriptor:ProductionMockupDescriptor){
 if(!isUuid(workItemId)||!isUuid(sessionId))throw new Error('MOCKUP_STORAGE_ID_INVALID');
 const prefix=`verified-local/${workItemId}/${sessionId}`;
 return [...descriptor.boards.map((b,i)=>({key:String(i),path:`${prefix}/${i}.png`,hash:b.imageHash,width:b.width,height:b.height})),{key:'base',path:`${prefix}/titleless.png`,hash:descriptor.thumbnail.baseImageHash,width:1080,height:1080}];
}
export async function verifiedProductionPng(spec:{path:string;hash:string;width:number;height:number}){
 const {data,error}=await contentAdmin().storage.from('portfolio-rendered').download(spec.path);
 if(error||!data||data.size>12*1024*1024)throw new Error('MOCKUP_STORED_IMAGE_MISSING');
 const bytes=Buffer.from(await data.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==spec.hash)throw new Error('MOCKUP_STORED_IMAGE_HASH_MISMATCH');
 assertFlatRedactionPng(bytes);
 const info=await sharp(bytes,{limitInputPixels:2_000_000}).metadata();
 if(info.format!=='png'||info.width!==spec.width||info.height!==spec.height)throw new Error('MOCKUP_STORED_IMAGE_INVALID');
 return bytes;
}
export async function verifyProductionObjects(workItemId:string,sessionId:string,descriptor:ProductionMockupDescriptor){
 for(const spec of productionObjectSpecs(workItemId,sessionId,descriptor))await verifiedProductionPng(spec);
}

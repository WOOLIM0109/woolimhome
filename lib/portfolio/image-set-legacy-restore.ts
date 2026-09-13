import {swapImageSetBodySources,type PortfolioImageSetSnapshot} from './image-set.ts';
import {plainObject,isUuid} from './production-session.ts';
import {FRIENDLY_STYLE_VERSION,styleRevisionFingerprint} from '../content-ops/style-revision-rules.ts';
export function prepareLegacyPortfolioRestore(current:PortfolioImageSetSnapshot,history:{id:string;work_item_id:string;previous_set_id:string|null;previous_metadata:Record<string,unknown>},expectedUpdatedAt:string){
 if(!isUuid(history.id)||history.work_item_id!==current.id||history.previous_set_id!==null||current.format!=='portfolio')throw new Error('IMAGE_SET_LEGACY_RESTORE_INVALID');
 if(current.updated_at!==expectedUpdatedAt)throw new Error('IMAGE_SET_REVISION_CONFLICT');
 const previous=history.previous_metadata,metadata=structuredClone(current.metadata),generated=plainObject(metadata.generated);
 const urls=(m:Record<string,unknown>)=>{if(!Array.isArray(m.portfolioAssets))throw new Error('IMAGE_SET_BODY_MAPPING_REQUIRED');return m.portfolioAssets.filter(a=>a?.kind==='body_image').map(a=>a.url);};
 if(typeof generated.bodyHtml!=='string')throw new Error('IMAGE_SET_BODY_REQUIRED');
 const bodyHtml=swapImageSetBodySources(generated.bodyHtml,urls(metadata),urls(previous));
 const nextGenerated={...generated,bodyHtml},style=plainObject(metadata.styleRevision);
 if(style.version===FRIENDLY_STYLE_VERSION&&style.fingerprint===styleRevisionFingerprint(generated))metadata.styleRevision={...style,fingerprint:styleRevisionFingerprint(nextGenerated)};
 metadata.generated=nextGenerated;
 for(const key of ['portfolioAssets','portfolioMockup','manualMockupOverride']){if(Object.hasOwn(previous,key))metadata[key]=structuredClone(previous[key]);else delete metadata[key];}
 delete metadata.portfolioImageSet;delete metadata.portfolioThumbnailVersion;
 return {workItemId:current.id,historyId:history.id,expectedUpdatedAt,expectedMetadata:structuredClone(current.metadata),nextMetadata:metadata};
}

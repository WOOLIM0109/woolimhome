import {createHash} from 'node:crypto';
import {APPROVED_16X9_BACKGROUNDS,type ApprovedMockupTemplateSpec} from './approved-16x9-templates.ts';
/** Pure server attestation, checked against the frozen PC renderer in tests. */
export function productionTemplateFingerprint(template:ApprovedMockupTemplateSpec<string,string,number>){
 return createHash('sha256').update(JSON.stringify({template,background:APPROVED_16X9_BACKGROUNDS[template.backgroundId]})).digest('hex');
}

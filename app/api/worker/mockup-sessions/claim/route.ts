import {NextResponse} from 'next/server';
import {contentAdmin} from '@/lib/content-ops/data';
import {authenticateWorker} from '@/lib/pc-worker/auth';
import {MOCKUP_BRIDGE_VERSION,MOCKUP_BRIDGE_WORKER_VERSION} from '@/lib/portfolio/production-session';
import {authorizeSessionSource,publicMockupError} from '@/lib/portfolio/production-session-server';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const body=await request.json().catch(()=>null),auth=authenticateWorker(request,body);
 if(auth.response)return auth.response;
 if(body?.bridgeVersion!==MOCKUP_BRIDGE_VERSION||body?.workerVersion!==MOCKUP_BRIDGE_WORKER_VERSION)return NextResponse.json({error:'MOCKUP_WORKER_UPGRADE_REQUIRED'},{status:409});
 const db=contentAdmin();
 const {data,error}=await db.rpc('claim_portfolio_mockup_session',{p_worker_id:auth.worker.id});
 if(error)return NextResponse.json({error:'MOCKUP_SESSION_CLAIM_FAILED'},{status:503});
 if(!data)return NextResponse.json({session:null},{headers:{'Cache-Control':'no-store'}});
 try{return NextResponse.json({session:await authorizeSessionSource(data)},{headers:{'Cache-Control':'no-store'}});}
 catch(error){const code=publicMockupError(error);await db.from('portfolio_mockup_sessions').update({status:'failed',error_code:code,updated_at:new Date().toISOString()}).eq('id',data.id).eq('worker_id',auth.worker.id).eq('status','preparing');return NextResponse.json({error:code},{status:409});}
}

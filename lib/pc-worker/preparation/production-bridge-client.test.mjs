import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const script=await readFile(new URL('./production-bridge-client.mjs',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function fixture() {
  class Node {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.disabled=false;this.checked=false;this.textContent='';}
    append(...nodes){this.children.push(...nodes);for(const node of nodes)node.parent=this;}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    addEventListener(kind,callback,options={}){const list=this.listeners.get(kind)??[];list.push({callback,once:options.once});this.listeners.set(kind,list);}
    emit(kind){const list=this.listeners.get(kind)??[];this.listeners.set(kind,list.filter(item=>!item.once));for(const item of list)item.callback({target:this});}
  }
  const nodes=new Map([...script.matchAll(/document\.querySelector\("(#[^"]+)"\)/g)].map(match=>[match[1],new Node()]));
  const card=nodes.get('#production-bridge');for(const [id,node]of nodes)if(id!=='#production-bridge')card.append(node);
  const created=[],requests=[],events=new Map();let fail=null,paused=null;
  const descriptor={mode:'full',remoteApproval:'required',thumbnail:{titleSpec:{main:'제안서'}},boards:Array.from({length:5},(_,i)=>({templateId:`sample-${i}`,kind:i===0?'thumbnail':'body_image',imageHash:String(i+1).repeat(64)}))};
  const context=vm.createContext({document:{querySelector:id=>nodes.get(id),createElement:tag=>{const node=new Node(tag);created.push(node);return node;},addEventListener:(kind,callback)=>events.set(kind,callback)},
    fetch:async(url,options)=>{requests.push({url,...options});if(paused)await paused;if(fail)return {ok:false,headers:{get:()=> 'application/json'},json:async()=>({error:fail})};
      return {ok:true,headers:{get:()=> 'application/json'},json:async()=>url.endsWith('/preview')?{descriptor,snapshotHash:'a'.repeat(64),csrfToken:'b'.repeat(64)}:{staged:true}};}});
  vm.runInContext(script,context);await settle();
  return {requests,nodes,created,descriptor,node:id=>nodes.get(id),setError:value=>{fail=value;},pause:value=>{paused=value;},
    async click(id){nodes.get(id).emit('click');await settle();},async loaded(){for(const n of created.filter(n=>n.tagName==='IMG'))n.emit('load');await settle();},
    async inspect(){nodes.get('#production-inspected').checked=true;nodes.get('#production-inspected').emit('change');await settle();},
    async externalEdit(){events.get('input')({target:new Node('input')});await settle();}};
}
test('bridge performs zero page-load requests and waits for all five images plus explicit checkbox',async()=>{
  const f=await fixture();assert.equal(f.requests.length,0);assert.equal(f.node('#production-stage').disabled,true);
  await f.click('#production-preview');assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'GET');
  assert.equal(f.node('#production-inspected').disabled,true);assert.equal(f.created.filter(n=>n.tagName==='IMG').length,5);
  await f.loaded();assert.equal(f.node('#production-inspected').disabled,false);assert.equal(f.node('#production-stage').disabled,true);
  await f.inspect();assert.equal(f.node('#production-stage').disabled,false);
});
test('one explicit send uses exact snapshot and CSRF; success needs remote approval and cannot auto-repeat',async()=>{
  const f=await fixture();await f.click('#production-preview');await f.loaded();await f.inspect();await f.click('#production-stage');
  assert.equal(f.requests.length,2);const sent=f.requests[1];assert.equal(sent.url,'/api/production/stage');
  assert.deepEqual(JSON.parse(sent.body),{expectedSnapshotHash:'a'.repeat(64),outputInspected:true});
  assert.equal(sent.headers['X-Woolim-CSRF'],'b'.repeat(64));assert.match(f.node('#production-status').textContent,/최종 검토 대기/);
  assert.match(f.node('#production-status').textContent,/아직 하지 않았습니다/);await f.click('#production-stage');assert.equal(f.requests.length,2);
});
test('external edits invalidate old confirmation without network or automatic regeneration',async()=>{
  const f=await fixture();await f.click('#production-preview');await f.loaded();await f.inspect();
  await f.externalEdit();assert.equal(f.requests.length,1);assert.equal(f.node('#production-stage').disabled,true);
  assert.equal(f.node('#production-inspected').checked,false);await f.click('#production-stage');assert.equal(f.requests.length,1);
});
test('image failure and explicit transfer failure clear confirmation without background retries',async()=>{
  const f=await fixture();await f.click('#production-preview');f.created.find(n=>n.tagName==='IMG').emit('error');await settle();
  assert.equal(f.node('#production-stage').disabled,true);assert.equal(f.requests.length,1);
  await f.click('#production-preview');await f.loaded();await f.inspect();f.setError('전송에 실패했습니다.');await f.click('#production-stage');
  assert.equal(f.requests.length,3);assert.equal(f.node('#production-stage').disabled,true);await settle();assert.equal(f.requests.length,3);
});
test('double click and old delayed preview cannot stage or overwrite a newer edit',async()=>{
  const f=await fixture();let release;f.pause(new Promise(resolve=>{release=resolve;}));
  await f.click('#production-preview');await f.click('#production-preview');assert.equal(f.requests.length,1);
  release();f.pause(null);await settle();await f.loaded();await f.inspect();
  let finish;f.pause(new Promise(resolve=>{finish=resolve;}));await f.click('#production-stage');await f.click('#production-stage');assert.equal(f.requests.length,2);
  finish();await settle();assert.equal(f.requests.length,2);
});
test('typing during a pending preview discards its old response without another request',async()=>{
  const f=await fixture();let release;f.pause(new Promise(resolve=>{release=resolve;}));
  await f.click('#production-preview');await f.externalEdit();release();f.pause(null);await settle();
  assert.equal(f.requests.length,1);assert.equal(f.created.filter(n=>n.tagName==='IMG').length,0);
  assert.equal(f.node('#production-stage').disabled,true);assert.equal(f.node('#production-inspected').checked,false);
});

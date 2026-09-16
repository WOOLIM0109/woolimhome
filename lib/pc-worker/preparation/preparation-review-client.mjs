const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** All writes require a separate explicit action. This form never classifies an
 * image itself, approves redaction, uploads bytes or redirects automatically. */
export function mountPreparationReview(document,request=fetch){
  const node=id=>document.querySelector(`#${id}`);
  const status=node('preparation-status'),source=node('preparation-source'),sourcePanel=node('preparation-source-choice');
  const artworkPanel=node('preparation-artwork'),refresh=node('preparation-refresh'),apply=node('preparation-apply'),nextLink=node('preparation-next');
  const dialog=node('preparation-image-dialog'),scroll=node('preparation-image-scroll'),imageLabel=node('preparation-image-label');
  let review=null,csrf='',busy=false,applied=false,imageGeneration=0;
  const drafts=new Map(),seen=new Set();
  const element=(tag,text,className='')=>{const e=document.createElement(tag);e.textContent=text;e.className=className;return e;};
  const setStatus=(text,error=false)=>{status.textContent=text;status.className=`editor-status ${error?'error':'pending'}`;};
  const currentBuild=()=>({buildId:review.buildId,revision:review.revision,sourceHash:review.sourceHash});
  const revisionKey=view=>`${view.buildId}:${view.revision}:${view.sourceHash}`;
  const proof=slide=>`${revisionKey(review)}:${slide.sourceSlideNumber}:${slide.slideContentHash}:${slide.previewHash}:${slide.evidence?.imageHash}`;
  const evidenceUrl=slide=>`/preparation-image/${review.revision}/${review.sourceHash}/${slide.sourceSlideNumber}/${slide.evidence.imageHash}`;
  const draftFor=key=>{if(!drafts.has(key))drafts.set(key,{reason:'',checked:false});return drafts.get(key);};
  const eligible=(key,slide)=>{const draft=draftFor(key);return Boolean(slide?.previewHash&&slide.evidence&&seen.has(proof(slide))&&draft.checked&&draft.reason.trim().length>=10);};
  function checkedView(value){
    if(!value||value.version!==1||value.localOnly!==true||!UUID.test(value.buildId)||!UUID.test(value.workId)||!SHA.test(value.sourceHash)
      ||!Number.isSafeInteger(value.revision)||value.revision<0||!value.source||!value.customPortrait||!Array.isArray(value.slides))throw new Error('준비 검수 상태 응답을 확인하지 못했습니다.');
    const numbers=new Set();
    for(const slide of value.slides){if(!Number.isSafeInteger(slide.sourceSlideNumber)||slide.sourceSlideNumber<1||numbers.has(slide.sourceSlideNumber)||!SHA.test(slide.slideContentHash)
      ||(slide.previewHash!==null&&!SHA.test(slide.previewHash))|| (slide.evidence&&(!SHA.test(slide.evidence.imageHash)||!Number.isSafeInteger(slide.evidence.width)||!Number.isSafeInteger(slide.evidence.height)||slide.evidence.width<1||slide.evidence.height<1)))throw new Error('원본 증거 기록이 올바르지 않습니다.');numbers.add(slide.sourceSlideNumber);}
    return value;
  }
  function updateView(value){
    const updated=checkedView(value);
    if(review&&revisionKey(updated)!==revisionKey(review)){
      seen.clear();for(const draft of drafts.values())draft.checked=false;
      imageGeneration++;dialog.close();scroll.replaceChildren();
    }
    review=updated;render();
  }
  async function json(url,body){
    const response=await request(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json','X-Woolim-CSRF':csrf},body:JSON.stringify(body)}:{})});
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('검수 서버 응답을 확인하지 못했습니다.');
    const value=await response.json();if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'준비 검수를 완료하지 못했습니다.');
    if(typeof value.csrfToken==='string')csrf=value.csrfToken;return value;
  }
  function controls(){
    refresh.disabled=busy||applied;
    const sourceSlide=review?.slides.find(s=>s.sourceSlideNumber===review.customPortrait.reviewSlideNumber);
    const sourceReady=review?.customPortrait.allowed&&!review.customPortrait.currentChoice&&eligible('source',sourceSlide);
    const artReady=review?.slides.some(s=>s.artworkEligible&&!s.artworkReviewed&&eligible(`art:${s.sourceSlideNumber}`,s));
    apply.disabled=busy||applied||!csrf||(!sourceReady&&!artReady);
    for(const e of document.querySelectorAll('[data-preparation-control]')){
      e.disabled=busy||applied||e.dataset.blocked==='true';
    }
  }
  async function guarded(operation){
    if(busy||applied)return;busy=true;controls();setStatus('명시적으로 요청한 작업을 처리하는 중입니다…');
    try{await operation();}catch(error){setStatus(`${error instanceof Error?error.message:'준비 검수를 완료하지 못했습니다.'} 입력 사유는 유지됩니다. 자동 재시도하지 않습니다.`,true);}
    finally{busy=false;controls();}
  }
  function action(label,callback,blocked=false){
    const button=element('button',label,'small-button');button.type='button';button.dataset.preparationControl='true';button.dataset.blocked=String(blocked);
    button.addEventListener('click',()=>{if(!button.disabled)callback();});return button;
  }
  function showEvidence(slide){
    if(!slide.evidence||busy||applied)return;
    const selectedProof=proof(slide),generation=++imageGeneration,image=element('img','');
    image.alt=`${slide.sourceSlideNumber}번 원본 실제 크기`;image.style.width=`${slide.evidence.width}px`;image.style.height=`${slide.evidence.height}px`;image.style.maxWidth='none';
    imageLabel.textContent=`${slide.sourceSlideNumber}번 · ${slide.evidence.width} × ${slide.evidence.height}px · 실제 크기 100%`;
    image.addEventListener('load',()=>{
      if(generation!==imageGeneration||selectedProof!==proof(slide))return;
      if(image.naturalWidth!==slide.evidence.width||image.naturalHeight!==slide.evidence.height){seen.delete(selectedProof);setStatus('원본 이미지 크기가 증거 기록과 다릅니다. 확인하지 않은 상태로 유지합니다.',true);render();return;}
      seen.add(selectedProof);render();
    });
    image.addEventListener('error',()=>{if(generation!==imageGeneration)return;seen.delete(selectedProof);for(const draft of drafts.values())draft.checked=false;setStatus('원본 이미지를 읽지 못했습니다. 확대 확인과 승인을 해제했습니다.',true);render();});
    image.src=evidenceUrl(slide);scroll.replaceChildren(image);dialog.showModal();
  }
  function reviewCard(key,slide,heading,explanation,confirmed){
    const card=element('article','','mockup-candidate');card.append(element('h3',heading),element('p',explanation,'section-help'));
    if(!slide){card.append(element('p','원본 증거로 확인할 수 있는 장표가 없습니다.'));return card;}
    const draft=draftFor(key);
    card.append(element('p',`원본 ${slide.sourceSlideNumber}번 · ${slide.evidence?'고해상도 증거 준비됨':'증거 미준비'}`));
    card.append(action(slide.evidence?'원본 실제 크기로 열기':'원본 크게 보기 준비',()=>{
      if(slide.evidence)showEvidence(slide);
      else void guarded(async()=>{const result=await json('/api/preparation-review/evidence',{expectedCurrentBuild:currentBuild(),slideNumbers:[slide.sourceSlideNumber]});updateView(result.review);setStatus('원본 증거만 준비했습니다. 실제 크기로 열어 확인해 주세요. 선택·가림 승인은 하지 않았습니다.');});
    }));
    if(confirmed){card.append(element('p','이 항목은 이전에 직접 확인한 기록이 있습니다. 자동으로 다른 장표에 적용하지 않습니다.'));return card;}
    const reason=element('textarea','');reason.rows=3;reason.maxLength=500;reason.value=draft.reason;reason.placeholder='직접 본 내용과 판단 근거를 한 줄로 적어 주세요. 민감한 원문은 쓰지 마세요. (10자 이상)';reason.dataset.preparationControl='true';
    const reasonLabel=element('label','','field');reasonLabel.append(element('span','직접 확인한 근거'),reason);card.append(reasonLabel);
    reason.addEventListener('input',()=>{draft.reason=reason.value;draft.checked=false;check.checked=false;controls();});
    const check=element('input','');check.type='checkbox';check.checked=draft.checked;check.dataset.preparationControl='true';check.dataset.blocked=String(!slide.evidence||!slide.previewHash||!seen.has(proof(slide)));
    const label=element('label','','check');label.append(check,element('span',key==='source'?'원본을 실제 크기로 직접 확인했고, 원본 비율을 유지한 흰색 패딩 A4 세로 연결에 동의함':'원본을 실제 크기로 직접 확인했고, 사진이 아닌 추상 그래픽임을 확인함'));card.append(label);
    check.addEventListener('change',()=>{draft.checked=check.checked;controls();});
    if(!seen.has(proof(slide)))card.append(element('p','위 버튼으로 원본을 연 뒤 확인 체크를 할 수 있습니다.','section-help'));
    return card;
  }
  function render(){
    if(!review)return;
    source.textContent=`원본 ${review.source.width} × ${review.source.height}pt · ${review.source.aspect} · ${review.source.pageSizeVariant}`;
    const format=review.customPortrait,sourceSlide=review.slides.find(s=>s.sourceSlideNumber===format.reviewSlideNumber);
    sourcePanel.replaceChildren(element('h2','사용자 지정 세로 → 고정 A4 세로'));
    if(format.allowed||format.currentChoice)sourcePanel.append(reviewCard('source',sourceSlide,'원본 규격 직접 확인','흰색 여백만 추가합니다. 늘이기·자르기·원본 크기 변경은 허용하지 않습니다.',format.currentChoice));
    else sourcePanel.append(element('p',format.reason||'이 원본은 사용자 지정 세로 연결 대상이 아닙니다. 다른 규격을 임의로 바꾸지 않습니다.'));
    artworkPanel.replaceChildren(element('h2','사진으로 분류된 추상 그래픽 직접 확인'),element('p','PHOTO_DENSE 장표만 검토할 수 있습니다. 손상·폰트·검사 불가능 개체 등의 제외 사유는 그대로 유지됩니다.','section-help'));
    const art=review.slides.filter(s=>s.artworkEligible||s.artworkReviewed);
    for(const slide of art)artworkPanel.append(reviewCard(`art:${slide.sourceSlideNumber}`,slide,`${slide.sourceSlideNumber}번 분류 확인`,'추상 그래픽 확인은 장표 선별용입니다. 블러/개인정보 검수나 공개 승인이 아닙니다.',slide.artworkReviewed));
    if(!art.length)artworkPanel.append(element('p','현재 직접 재분류할 PHOTO_DENSE 장표가 없습니다.'));
    if(review.holds?.length)artworkPanel.append(element('p',`남은 보류: ${review.holds.join(' / ')}`,'section-help'));
    controls();
  }
  function decision(key,slide){return {sourceSlideNumber:slide.sourceSlideNumber,slideContentHash:slide.slideContentHash,previewHash:slide.previewHash,imageHash:slide.evidence.imageHash,inspectedAtActualSize:true,reason:draftFor(key).reason.trim()};}
  refresh.addEventListener('click',()=>void guarded(async()=>{const result=await json('/api/preparation-review');updateView(result.review);setStatus('최신 상태를 확인했습니다. 기준이 바뀌면 확대 확인·체크만 해제하고 입력 사유는 유지합니다.');}));
  apply.addEventListener('click',()=>{
    if(apply.disabled)return;
    const body={expectedCurrentBuild:currentBuild(),artworkReviews:[]},format=review.customPortrait;
    const sourceSlide=review.slides.find(s=>s.sourceSlideNumber===format.reviewSlideNumber);
    if(format.allowed&&!format.currentChoice&&eligible('source',sourceSlide))body.sourceFormatChoice={...decision('source',sourceSlide),kind:'custom_portrait_to_a4'};
    for(const slide of review.slides)if(slide.artworkEligible&&!slide.artworkReviewed&&eligible(`art:${slide.sourceSlideNumber}`,slide))body.artworkReviews.push({...decision(`art:${slide.sourceSlideNumber}`,slide),classification:'abstract_graphic'});
    void guarded(async()=>{
      const result=await json('/api/preparation-review/apply',body);
      let url;try{url=new URL(result.launchUrl);}catch{throw new Error('새 로컬 검수 연결을 확인하지 못했습니다.');}
      if(result.applied!==true||!UUID.test(result.buildId)||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||!/^\/launch\/[a-f0-9]{64}$/.test(url.pathname))throw new Error('새 로컬 검수 연결을 확인하지 못했습니다.');
      applied=true;imageGeneration++;dialog.close();scroll.replaceChildren();seen.clear();nextLink.href=url.href;nextLink.hidden=false;
      setStatus('직접 확인한 기준으로 다시 준비했습니다. 아래 새 검토 화면을 직접 열어 남은 가림·장표·목업을 확인해 주세요. 공개/블러 승인은 하지 않았습니다.');
    });
  });
  node('preparation-image-close').addEventListener('click',()=>dialog.close());
  void guarded(async()=>{const result=await json('/api/preparation-review');updateView(result.review);setStatus('원본을 직접 보고 필요한 항목만 확인해 주세요. 자동 준비·승인은 하지 않았습니다.');});
}
if(typeof document!=='undefined'&&document.querySelector('#preparation-status'))mountPreparationReview(document);

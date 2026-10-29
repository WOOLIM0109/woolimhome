const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The local HTTP route accepts at most eight slides per evidence request.
const EVIDENCE_BATCH_SIZE=8;

/** All writes require a separate explicit action. This form never classifies an
 * image itself, approves redaction, uploads bytes or redirects automatically. */
export function mountPreparationReview(document,request=fetch){
  const node=id=>document.querySelector(`#${id}`);
  const status=node('preparation-status'),source=node('preparation-source'),sourcePanel=node('preparation-source-choice');
  const artworkPanel=node('preparation-artwork'),refresh=node('preparation-refresh'),apply=node('preparation-apply'),nextLink=node('preparation-next');
  const prepareEvidence=node('preparation-evidence'),applySummary=node('preparation-apply-summary');
  const selectionPanel=node('preparation-slide-selection');
  const dialog=node('preparation-image-dialog'),scroll=node('preparation-image-scroll'),imageLabel=node('preparation-image-label');
  let review=null,csrf='',busy=false,applied=false,imageGeneration=0,selectionSummary=null,unavailableMainSlides=[];
  const drafts=new Map(),seen=new Set(),selectedSlides=new Set();
  const element=(tag,text,className='')=>{const e=document.createElement(tag);e.textContent=text;e.className=className;return e;};
  const setStatus=(text,error=false)=>{status.textContent=text;status.className=`editor-status ${error?'error':'pending'}`;};
  const currentBuild=()=>({buildId:review.buildId,revision:review.revision,sourceHash:review.sourceHash});
  const revisionKey=view=>`${view.buildId}:${view.revision}:${view.sourceHash}`;
  const proof=slide=>`${revisionKey(review)}:${slide.sourceSlideNumber}:${slide.slideContentHash}:${slide.previewHash}:${slide.evidence?.imageHash}`;
  const evidenceUrl=slide=>`/preparation-image/${review.revision}/${review.sourceHash}/${slide.sourceSlideNumber}/${slide.evidence.imageHash}`;
  const draftFor=key=>{if(!drafts.has(key))drafts.set(key,{reason:'',checked:false});return drafts.get(key);};
  const eligible=(key,slide)=>{const draft=draftFor(key);return Boolean(slide?.previewHash&&slide.evidence&&seen.has(proof(slide))&&draft.checked&&draft.reason.trim().length>=10);};
  function reviewTargets(){
    if(!review)return [];
    const targets=review.slides.filter(s=>s.artworkEligible&&!s.artworkReviewed).map(slide=>({key:`art:${slide.sourceSlideNumber}`,slide}));
    const format=review.customPortrait,slide=review.slides.find(s=>s.sourceSlideNumber===format.reviewSlideNumber);
    if(format.allowed&&!format.currentChoice&&slide)targets.push({key:'source',slide});
    return targets;
  }
  const pendingEvidence=()=>[...new Set(reviewTargets().filter(({slide})=>!slide.evidence).map(({slide})=>slide.sourceSlideNumber))];
  const mainSlides=view=>new Set(view?.slideSelection?.slides.filter(slide=>slide.disposition==='selected').map(slide=>slide.sourceSlideNumber));
  const sameNumbers=(left,right)=>left.size===right.size&&[...left].every(number=>right.has(number));
  const selectableSlide=slide=>slide.disposition!=='excluded';
  const unavailableMain=(view,numbers)=>view.slideSelection?.slides.filter(slide=>numbers.has(slide.sourceSlideNumber)&&!selectableSlide(slide))??[];
  function restoreMainSelection(view=review){
    selectedSlides.clear();
    for(const number of mainSlides(view))selectedSlides.add(number);
    unavailableMainSlides=unavailableMain(view,selectedSlides);
  }
  function checkedView(value){
    if(!value||value.version!==1||value.localOnly!==true||!UUID.test(value.buildId)||!UUID.test(value.workId)||!SHA.test(value.sourceHash)
      ||!Number.isSafeInteger(value.revision)||value.revision<0||!value.source||!value.customPortrait||!Array.isArray(value.slides))throw new Error('준비 검수 상태 응답을 확인하지 못했습니다.');
    const numbers=new Set();
    for(const slide of value.slides){if(!Number.isSafeInteger(slide.sourceSlideNumber)||slide.sourceSlideNumber<1||numbers.has(slide.sourceSlideNumber)||!SHA.test(slide.slideContentHash)
      ||(slide.previewHash!==null&&!SHA.test(slide.previewHash))|| (slide.evidence&&(!SHA.test(slide.evidence.imageHash)||!Number.isSafeInteger(slide.evidence.width)||!Number.isSafeInteger(slide.evidence.height)||slide.evidence.width<1||slide.evidence.height<1)))throw new Error('원본 증거 기록이 올바르지 않습니다.');numbers.add(slide.sourceSlideNumber);}
    if(value.slideSelection){
      const selection=value.slideSelection,selectionNumbers=new Set();
      if(!Number.isSafeInteger(selection.minimum)||selection.minimum<0||!Array.isArray(selection.slides))throw new Error('본선 장표 선정 상태가 올바르지 않습니다.');
      for(const slide of selection.slides){
        if(!Number.isSafeInteger(slide.sourceSlideNumber)||slide.sourceSlideNumber<1||selectionNumbers.has(slide.sourceSlideNumber)
          ||!['selected','reserve','candidate','excluded'].includes(slide.disposition)||!Number.isFinite(slide.score)
          ||!Array.isArray(slide.reasons)||slide.reasons.some(reason=>typeof reason!=='string')
          ||(slide.previewHash!==null&&!SHA.test(slide.previewHash)))throw new Error('본선 장표 선정 상태가 올바르지 않습니다.');
        selectionNumbers.add(slide.sourceSlideNumber);
      }
    }
    return value;
  }
  function updateView(value){
    const updated=checkedView(value),previousMain=mainSlides(review),updatedMain=mainSlides(updated);
    if(!review||updated.buildId!==review.buildId||updated.sourceHash!==review.sourceHash
      ||!sameNumbers(updatedMain,previousMain))restoreMainSelection(updated);
    if(review&&revisionKey(updated)!==revisionKey(review)){
      seen.clear();for(const draft of drafts.values())draft.checked=false;
      imageGeneration++;dialog.close();scroll.replaceChildren();
    }
    // Keep an explanation if a main slide is removed by the eligibility filter.
    // A newly excluded previous main slide is also reported after a refresh.
    const sameSource=review&&updated.buildId===review.buildId&&updated.sourceHash===review.sourceHash;
    unavailableMainSlides=unavailableMain(updated,new Set([...updatedMain,...(sameSource?previousMain:[])]));
    const selectable=new Set(updated.slideSelection?.slides.filter(selectableSlide).map(slide=>slide.sourceSlideNumber));
    for(const number of selectedSlides)if(!selectable.has(number))selectedSlides.delete(number);
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
    prepareEvidence.disabled=busy||applied||!csrf||!pendingEvidence().length;
    const sourceSlide=review?.slides.find(s=>s.sourceSlideNumber===review.customPortrait.reviewSlideNumber);
    const sourceReady=review?.customPortrait.allowed&&!review.customPortrait.currentChoice&&eligible('source',sourceSlide);
    const artReady=review?.slides.some(s=>s.artworkEligible&&!s.artworkReviewed&&eligible(`art:${s.sourceSlideNumber}`,s));
    const currentSelection=mainSlides(review),sameSelection=sameNumbers(selectedSlides,currentSelection);
    const blockedSelection=unavailableMainSlides.some(slide=>currentSelection.has(slide.sourceSlideNumber));
    const selectionReady=selectedSlides.size>0?!sameSelection:review?.slideSelection?.manual===true;
    const unchangedAutomatic=sameSelection&&review?.slideSelection?.manual!==true;
    const missing=selectedSlides.size&&!unchangedAutomatic?Math.max(0,(review?.slideSelection?.minimum??0)-selectedSlides.size):0;
    apply.disabled=busy||applied||!csrf||blockedSelection||missing>0||(!sourceReady&&!artReady&&!selectionReady);
    for(const e of document.querySelectorAll('[data-preparation-control]')){
      e.disabled=busy||applied||e.dataset.blocked==='true';
    }
    const targets=reviewTargets(),count=predicate=>new Set(targets.filter(predicate).map(({slide})=>slide.sourceSlideNumber)).size;
    const ready=count(({key,slide})=>eligible(key,slide));
    const automaticSelectionMessage='이미 자동 선정 준비본입니다. 본선 장표를 골라야 다시 준비할 수 있습니다.';
    const unavailableMessage=unavailableMainSlides.map(slide=>`${slide.sourceSlideNumber}번 선택 불가: ${slide.reasons.join(' / ')||'제외 사유를 먼저 해결해야 합니다.'}`).join(' · ');
    if(selectionSummary){selectionSummary.textContent=selectedSlides.size
      ?`${sameSelection?'지금 본선':'직접 고른 본선'} ${selectedSlides.size}장 · 최소 ${review.slideSelection.minimum}장${missing?` · ${missing}장 더 골라야 저장할 수 있습니다.`:''}`
      :review?.slideSelection?.manual===true?'체크를 모두 지웠습니다. 기존 기준의 자동 선정으로 다시 준비합니다.':automaticSelectionMessage;
      if(unavailableMessage)selectionSummary.textContent+=` · ${unavailableMessage}`;
    }
    if(applied)applySummary.textContent='적용을 완료했습니다. 새로 준비된 장표 검토를 열어 주세요.';
    else if(busy)applySummary.textContent='요청한 작업을 처리하는 중입니다. 완료 후 적용할 수 있습니다.';
    else if(!csrf)applySummary.textContent='검수 상태를 불러오지 못했습니다. 상태 새로고침 후 다시 확인해 주세요.';
    else if(blockedSelection)applySummary.textContent=unavailableMessage;
    else if(missing)applySummary.textContent=`본선 최소 ${review.slideSelection.minimum}장 필요 · 현재 ${selectedSlides.size}장 · ${missing}장 더 골라야 저장할 수 있습니다.`;
    else if(!apply.disabled)applySummary.textContent=selectionReady?`본선 ${selectedSlides.size?`${selectedSlides.size}장 직접 선정`:'자동 선정'}${ready?` · 직접 검수 ${ready}장 적용`:''}`:`${ready}장 적용`;
    else if(review?.slideSelection&&!selectedSlides.size&&review.slideSelection.manual!==true)applySummary.textContent=automaticSelectionMessage;
    else if(review?.slideSelection&&sameSelection)applySummary.textContent='지금 준비본과 같은 선정입니다. 본선 구성을 바꾸면 다시 준비할 수 있습니다.';
    else if(!targets.length)applySummary.textContent='현재 적용할 검수 대상 장표가 없습니다.';
    else{
      const unseen=count(({slide})=>!slide.previewHash||!slide.evidence||!seen.has(proof(slide)));
      const shortReason=count(({key})=>draftFor(key).reason.trim().length<10);
      const unchecked=count(({key})=>!draftFor(key).checked);
      applySummary.textContent=`확인 완료 ${ready}장 · 원본 미확인 ${unseen}장 · 근거 부족 ${shortReason}장 · 체크 미완료 ${unchecked}장 → 1장 이상 모두 갖춰야 누를 수 있습니다.`;
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
    image.addEventListener('error',()=>{
      if(generation!==imageGeneration)return;
      seen.delete(selectedProof);
      const artDraft=drafts.get(`art:${slide.sourceSlideNumber}`),sourceDraft=review.customPortrait.reviewSlideNumber===slide.sourceSlideNumber?drafts.get('source'):null;
      if(artDraft)artDraft.checked=false;
      if(sourceDraft)sourceDraft.checked=false;
      setStatus(`${slide.sourceSlideNumber}번 원본 이미지를 읽지 못했습니다. 이 장표의 확대 확인과 체크를 해제했습니다.`,true);render();
    });
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
    const check=element('input','');check.type='checkbox';check.checked=draft.checked;check.dataset.preparationControl='true';
    const reasonCount=element('span','','section-help');
    const updateCheck=()=>{
      const length=draft.reason.trim().length;
      if(length<10)draft.checked=false;
      check.checked=draft.checked;check.dataset.blocked=String(!slide.evidence||!slide.previewHash||!seen.has(proof(slide))||length<10);
      reasonCount.textContent=`근거 ${length}자 · 10자 이상 ${length<10?'필요':'충족'}`;
    };
    updateCheck();
    reason.addEventListener('input',()=>{draft.reason=reason.value;updateCheck();controls();});
    const label=element('label','','check');label.append(check,element('span',key==='source'?'원본을 실제 크기로 직접 확인했고, 원본 비율을 유지한 흰색 패딩 A4 세로 연결에 동의함':'원본을 실제 크기로 직접 확인했고, 사진이 아닌 추상 그래픽임을 확인함'),reasonCount);card.append(label);
    check.addEventListener('change',()=>{draft.checked=check.checked;controls();});
    if(!seen.has(proof(slide)))card.append(element('p','위 버튼으로 원본을 연 뒤 확인 체크를 할 수 있습니다.','section-help'));
    return card;
  }
  function renderSlideSelection(){
    if(!selectionPanel)return;
    selectionPanel.replaceChildren(element('h2','본선 장표 직접 고르기'),element('p','지금 본선 장표를 미리 체크했습니다. 더하거나 뺄 장표만 바꾸면 체크한 장표로 본선을 다시 준비합니다. 체크를 모두 지우면 기존 기준의 자동 선정으로 돌아갑니다. 제외 사유는 직접 선택으로 해제되지 않습니다.','section-help'));
    selectionSummary=element('p','','section-help');selectionSummary.role='status';selectionSummary.ariaLive='polite';selectionPanel.append(selectionSummary);
    if(!review.slideSelection){selectionPanel.append(element('p','현재 본선 장표 선정 상태를 확인할 수 없습니다.'));return;}
    const reset=action('지금 본선으로 되돌리기',()=>{restoreMainSelection();render();});reset.dataset.selectionReset='true';selectionPanel.append(reset);
    const list=element('div','','mockup-candidates'),labels={selected:'본선',reserve:'예비',candidate:'후보',excluded:'제외'};
    for(const slide of review.slideSelection.slides){
      const number=slide.sourceSlideNumber,blocked=!selectableSlide(slide),card=element('article','','mockup-candidate');
      card.append(element('h3',`${number}번 · ${labels[slide.disposition]} · ${slide.score}점`));
      if(slide.previewHash){const image=element('img','');image.alt=`${number}번 장표 미리보기`;image.loading='lazy';image.src=`/artifact/${encodeURIComponent(`preview:${number}`)}`;card.append(image);}
      else card.append(element('p','미리보기 없음','candidate-placeholder'));
      const check=element('input','');check.type='checkbox';check.checked=selectedSlides.has(number);check.dataset.preparationControl='true';check.dataset.blocked=String(blocked);check.dataset.slideNumber=String(number);
      const label=element('label','','check');label.append(check,element('span',`${number}번을 본선으로 선택`));card.append(label);
      check.addEventListener('change',()=>{
        if(check.disabled||blocked)return;
        if(check.checked)selectedSlides.add(number);else selectedSlides.delete(number);
        controls();
      });
      if(blocked)card.append(element('p',`선택 불가: ${slide.reasons.join(' / ')||'제외 사유를 먼저 해결해야 합니다.'}`,'candidate-note'));
      else if(slide.disposition==='candidate')card.append(element('p',slide.reasons.join(' / ')||'구성·대표성·배치 다양성 등의 자동 선정 기준에 따라 현재 본선 밖의 후보입니다.','candidate-note'));
      list.append(card);
    }
    if(!review.slideSelection.slides.length)selectionPanel.append(element('p','현재 준비된 장표가 없습니다.'));
    selectionPanel.append(list);
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
    renderSlideSelection();
    controls();
  }
  function decision(key,slide){return {sourceSlideNumber:slide.sourceSlideNumber,slideContentHash:slide.slideContentHash,previewHash:slide.previewHash,imageHash:slide.evidence.imageHash,inspectedAtActualSize:true,reason:draftFor(key).reason.trim()};}
  prepareEvidence.addEventListener('click',()=>{
    if(prepareEvidence.disabled)return;
    void guarded(async()=>{
      const numbers=pendingEvidence();
      for(let offset=0;offset<numbers.length;offset+=EVIDENCE_BATCH_SIZE){
        const result=await json('/api/preparation-review/evidence',{expectedCurrentBuild:currentBuild(),slideNumbers:numbers.slice(offset,offset+EVIDENCE_BATCH_SIZE)});
        updateView(result.review);
      }
      setStatus(`확인에 필요한 원본 ${numbers.length}장을 준비했습니다. 실제 크기로 열어 근거를 입력하고 체크해 주세요.`);
    });
  });
  refresh.addEventListener('click',()=>void guarded(async()=>{const result=await json('/api/preparation-review');updateView(result.review);setStatus('최신 상태를 확인했습니다. 기준이 바뀌면 확대 확인·체크만 해제하고 입력 사유는 유지합니다.');}));
  apply.addEventListener('click',()=>{
    if(apply.disabled)return;
    const body={expectedCurrentBuild:currentBuild(),artworkReviews:[]},format=review.customPortrait;
    // Visual review alone must keep the automatic path free to select newly
    // eligible slides, including when the current automatic set is too small.
    if(review.slideSelection)body.selectedSlideNumbers=sameNumbers(selectedSlides,mainSlides(review))&&review.slideSelection.manual!==true
      ?[]:[...selectedSlides].sort((a,b)=>a-b);
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealCtx } from "./RealApp";
import { ApiError } from "./api";
import { Icon } from "./ui";
import { blobToBase64, startRecording, toPcmWav, type Recorder } from "./voice";
import { carebridgeApi, categoryLabels, roleLabels, statusLabels, type BridgeDraft, type BridgeNote, type CareRole, type Category, type NoteSummary, type Preview, type RolePolicy, type SegmentEdit } from "./carebridge-api";
import "./carebridge.css";

type Tab = "compose" | "notes" | "family" | "roles";
const languages = [["auto","자동 감지"],["ko","한국어"],["en","English"],["vi","Tiếng Việt"],["id","Bahasa Indonesia"],["th","ไทย"],["tl","Filipino"],["zh","中文"],["ja","日本語"],["ne","नेपाली"],["uz","Oʻzbek"],["ru","Русский"]];
const actionNames: Record<string,string> = {create:"초안 생성",edit:"초안 수정",approve:"담당자 승인",hold:"보류",check:"QA 재검사"};
const date = (value: string) => new Intl.DateTimeFormat("ko-KR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
const editValues = (draft: BridgeDraft): SegmentEdit[] => draft.observations.map(o=>({segmentId:o.evidence.segment_id,text:o.text,category:o.category,needsConfirmation:draft.additional_checks.some(c=>c.evidence.segment_id===o.evidence.segment_id)}));
const errorMessage = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) return "로그인이 만료됐습니다. 다시 로그인해 주세요.";
  if (e instanceof ApiError && e.status === 409) return e.message + " 아래 ‘최신 버전 불러오기’로 다시 확인해 주세요.";
  return e instanceof Error ? e.message : "처리하지 못했습니다. 입력 내용을 보존했으니 다시 시도해 주세요.";
};

export function CarebridgePage({ctx}: {ctx: RealCtx}) {
  const api = useMemo(()=>carebridgeApi(ctx.token,ctx.groupId),[ctx.token,ctx.groupId]);
  const [policy,setPolicy]=useState<RolePolicy|null>(null);
  const [tab,setTab]=useState<Tab>("notes");
  const [items,setItems]=useState<NoteSummary[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [note,setNote]=useState<BridgeNote|null>(null);
  const [historical,setHistorical]=useState<{version:number;draft:BridgeDraft;reason:string}|null>(null);
  const [edits,setEdits]=useState<SegmentEdit[]>([]);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [memo,setMemo]=useState("");
  const [language,setLanguage]=useState("auto");
  const [inputKind,setInputKind]=useState<"text"|"transcript">("text");
  const [dataUse,setDataUse]=useState(false);
  const [transcriptConfirmed,setTranscriptConfirmed]=useState(false);
  const [reason,setReason]=useState("");
  const [confirmSource,setConfirmSource]=useState(false);
  const [confirmChecks,setConfirmChecks]=useState(false);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [recording,setRecording]=useState(false);
  const recorder=useRef<Recorder|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const requestId=useRef<string|null>(null);
  const selected=useRef("");
  const alive=useRef(true);
  const startEpoch=useRef(0);

  const showNote = useCallback((value:BridgeNote)=>{
    setNote(value);setHistorical(null);setEdits(editValues(value.draft));setPreview(null);
    setReason("");setConfirmSource(false);setConfirmChecks(false);
    selected.current=value.id;
  },[]);
  const reloadList=useCallback(async(family:boolean, next?:string)=>{
    const result=await api.list(family,next);
    if (!alive.current) return;
    setItems(previous=>next?[...previous,...result.items]:result.items);
    setCursor(result.nextCursor);
  },[api]);
  const cancelCurrentRecording = useCallback(()=>{
    startEpoch.current++;
    if(timer.current)clearTimeout(timer.current);
    recorder.current?.cancel();recorder.current=null;
  },[]);
  useEffect(()=>{
    alive.current=true;
    let active=true;
    void api.roles().then(async value=>{
      if (!active) return;
      setPolicy(value);
      setTab(value.myRole==="family"?"family":value.myRole==="author"?"compose":"notes");
      await reloadList(value.myRole==="family");
    }).catch(e=>active&&setError(errorMessage(e)));
    return ()=>{
      active=false;alive.current=false;cancelCurrentRecording();
    };
  },[api,reloadList,cancelCurrentRecording]);

  async function run(label:string, action:()=>Promise<void>) {
    if(busy||recording)return;
    setBusy(label);setError("");
    try {await action();} catch(e){if(alive.current)setError(errorMessage(e));}
    finally {if(alive.current)setBusy("");}
  }
  function switchTab(next:Tab) {
    if(busy||recording)return;
    setTab(next);setPreview(null);setError("");selected.current="";
    if(next==="notes"||next==="family")void run("목록을 확인하고 있습니다…",()=>reloadList(next==="family"));
  }
  async function loadNote(id:string) {
    selected.current=id;
    await run("메모를 불러오고 있습니다…",async()=>{
      const value=await api.get(id);
      if(alive.current&&selected.current===id)showNote(value);
    });
  }
  function updateMemo(value:string) {setMemo(value);requestId.current=null;}
  async function create() {
    if(!dataUse||!memo.trim()||(inputKind==="transcript"&&!transcriptConfirmed))return;
    await run("한국어 초안과 근거를 정리하고 있습니다…",async()=>{
      requestId.current??=crypto.randomUUID();
      const value=await api.create(memo,language,requestId.current,inputKind);
      if(!alive.current)return;
      showNote(value);setMemo("");requestId.current=null;setInputKind("text");setTranscriptConfirmed(false);
      setTab("notes");await reloadList(false);
      ctx.notify("검토 전 초안을 저장했습니다. 아직 가족에게 보이지 않습니다.");
    });
  }
  async function transcribe(blob:Blob) {
    if(blob.size>960044)throw new Error("음성은 30초 이내로 입력해 주세요.");
    const result=await api.transcribe(await blobToBase64(blob),language);
    if(!alive.current)return;
    setMemo(result.text);requestId.current=null;setInputKind("transcript");setTranscriptConfirmed(false);
    ctx.notify("전사문을 확인·수정한 뒤 초안을 생성해 주세요.");
  }
  async function finishRecording() {
    if(timer.current)clearTimeout(timer.current);
    const current=recorder.current;recorder.current=null;setRecording(false);
    if(!current)return;
    setBusy("음성을 글로 옮기고 있습니다…");setError("");
    try{const result=await current.stop();await transcribe(result.blob);}
    catch(e){if(alive.current)setError(errorMessage(e));}
    finally{if(alive.current)setBusy("");}
  }
  async function record() {
    if(recording){await finishRecording();return;}
    if(busy||!dataUse)return;
    setBusy("마이크를 준비하고 있습니다…");setError("");
    const epoch=++startEpoch.current;
    try{
      const current=await startRecording();
      if(!alive.current||epoch!==startEpoch.current){current.cancel();return;}
      recorder.current=current;setRecording(true);
      timer.current=setTimeout(()=>void finishRecording(),28000);
    }catch(e){if(alive.current)setError(errorMessage(e));}
    finally{if(alive.current)setBusy("");}
  }
  async function saveEdit() {
    if(!note)return;
    await run("수정한 초안을 다시 검사하고 있습니다…",async()=>{
      const value=await api.edit(note.id,note.version,reason,edits);showNote(value);
      await reloadList(false);ctx.notify("수정본을 저장했습니다. 가족 미리보기에는 재승인이 필요합니다.");
    });
  }
  async function decide(decision:"approve"|"hold") {
    if(!note)return;
    await run(decision==="approve"?"원문과 검사를 다시 확인하고 있습니다…":"메모를 보류하고 있습니다…",async()=>{
      const value=await api.decide(note.id,note.version,decision,reason,confirmSource,confirmChecks);
      showNote(value);await reloadList(false);
      ctx.notify(decision==="approve"?"이 버전의 가족 미리보기를 열 수 있습니다. 자동 공유하지 않습니다.":"메모를 보류했습니다. 가족 미리보기가 차단됐습니다.");
    });
  }
  async function openPreview(id:string) {
    setPreview(null);
    await run("승인된 현재 버전을 확인하고 있습니다…",async()=>setPreview(await api.preview(id)));
  }
  const canWrite=policy?.myRole==="author"||policy?.myRole==="reviewer";
  const shown=historical?.draft??note?.draft;
  const dirty=Boolean(note)&&JSON.stringify(edits)!==JSON.stringify(editValues(note!.draft));
  const hasHold=note?.qa.checks.some(c=>!c.passed)||note?.qa.issues.some(i=>i.severity==="hold");
  const self=note?.createdBy===ctx.session.user.userId;
  const memberName=(id:string)=>policy?.roles.find(r=>r.userId===id)?.name??"이전 구성원";
  return <div className="cb">
    <header className="cb-heading">
      <div><span className="eyebrow">CAREBRIDGE</span><h1>케어브릿지</h1><p>서로 다른 언어의 작은 관찰을, 근거가 보이는 기록으로.</p></div>
      {policy&&<span className="cb-role"><Icon name="users" size={17}/>{roleLabels[policy.myRole]}</span>}
    </header>
    <div className="cb-education"><Icon name="heart" size={18}/><span><b>교육용 가상·비식별 메모만 사용해 주세요.</b> 실제 이름·연락처를 입력하지 않으며, AI는 진단이나 처방을 하지 않습니다.</span></div>
    <ol className="cb-flow" aria-label="검토 흐름">{["메모 입력","한국어 초안","담당자 검토","승인 확인","가족 미리보기"].map((s,i)=><li key={s}><span>{i+1}</span>{s}</li>)}</ol>
    {policy&&<nav className="cb-tabs" aria-label="케어브릿지 메뉴">
      {canWrite&&<><button aria-current={tab==="compose"?"page":undefined} disabled={!!busy||recording} onClick={()=>switchTab("compose")}>메모 작성</button><button aria-current={tab==="notes"?"page":undefined} disabled={!!busy||recording} onClick={()=>switchTab("notes")}>{policy.myRole==="reviewer"?"검토함":"내 메모"}</button></>}
      <button aria-current={tab==="family"?"page":undefined} disabled={!!busy||recording} onClick={()=>switchTab("family")}>가족 미리보기</button>
      {policy.canManage&&<button aria-current={tab==="roles"?"page":undefined} disabled={!!busy||recording} onClick={()=>switchTab("roles")}>역할 설정</button>}
    </nav>}
    {error&&<div role="alert" className="cb-alert error">{error}{note&&<button className="text-button" disabled={!!busy} onClick={()=>void loadNote(note.id)}>최신 버전 불러오기</button>}</div>}
    {busy&&<p role="status" className="cb-progress">{busy}</p>}
    {!policy&&!error&&<p role="status">접근 권한을 확인하고 있습니다…</p>}
    {policy&&!policy.aiEnabled&&canWrite&&<p className="cb-alert">AI 서버 연결이 아직 설정되지 않았습니다. 기존 메모를 조회하거나 보류할 수 있으며, 새 초안 생성·검사·승인은 연결 후 사용할 수 있습니다.</p>}

    {tab==="compose"&&canWrite&&<section className="card cb-compose">
      <h2>관찰 메모 남기기</h2><p className="cb-muted">한 줄에 하나의 관찰을 적으면 원문과 초안을 비교하기 쉬워요.</p>
      <label className="cb-check"><input type="checkbox" checked={dataUse} disabled={!!busy||recording} onChange={e=>setDataUse(e.target.checked)}/>교육용 가상·비식별 메모임을 확인합니다.</label>
      <div className="cb-input-bar">
        <label className="field">입력 언어<select aria-label="입력 언어" value={language} disabled={!!busy||recording} onChange={e=>{setLanguage(e.target.value);requestId.current=null;}}>{languages.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label>
        <button className={recording?"danger":"secondary"} type="button" disabled={!!busy||!dataUse||!policy.aiEnabled} onClick={()=>void record()}><Icon name="mic" size={17}/>{recording?"녹음 중지·전사":"음성 메모"}</button>
        <label className="cb-file">음성 파일 선택<input type="file" accept="audio/*,.wav,.webm,.ogg,.mp3,.m4a" disabled={!!busy||recording||!dataUse||!policy.aiEnabled} onChange={e=>{
          const file=e.target.files?.[0];e.target.value="";if(!file)return;
          void run("음성 파일을 확인하고 있습니다…",async()=>{if(file.size>10*1024*1024)throw new Error("음성 파일은 10MB 이하로 선택해 주세요.");await transcribe(await toPcmWav(file));});
        }}/></label>
      </div>
      {recording&&<div role="status" className="cb-recording">녹음 중입니다. 28초에 자동으로 전사합니다.<button className="text-button" onClick={()=>{if(timer.current)clearTimeout(timer.current);recorder.current?.cancel();recorder.current=null;setRecording(false);}}>녹음 취소</button></div>}
      <label className="field">원문 관찰 메모<textarea aria-label="원문 관찰 메모" rows={7} maxLength={4000} value={memo} disabled={!!busy||recording} onChange={e=>updateMemo(e.target.value)} placeholder={"예: Ate half the breakfast.\nMay have slept after lunch."}/></label>
      <div className="cb-count">{memo.length.toLocaleString()} / 4,000자 · 최대 40줄</div>
      {inputKind==="transcript"&&<label className="cb-check"><input type="checkbox" checked={transcriptConfirmed} disabled={!!busy} onChange={e=>setTranscriptConfirmed(e.target.checked)}/>전사문을 확인하고 필요한 부분을 수정했습니다.</label>}
      <div className="actions"><button className="primary" disabled={!!busy||recording||!memo.trim()||!dataUse||!policy.aiEnabled||(inputKind==="transcript"&&!transcriptConfirmed)} onClick={()=>void create()}><Icon name="spark" size={18}/>검토 전 초안 만들기</button><span className="cb-muted">아직 가족에게 공유되지 않습니다.</span></div>
    </section>}

    {(tab==="notes"||tab==="family")&&policy&&<div className={tab==="notes"?"cb-workspace":"cb-family"}>
      <section className="card cb-list">
        <div className="cb-section-title"><h2>{tab==="family"?"승인된 메모":"관찰 메모"}</h2><button className="text-button" disabled={!!busy} onClick={()=>void run("목록을 확인하고 있습니다…",async()=>{setPreview(null);await reloadList(tab==="family");})}>새로고침</button></div>
        {!items.length&&<div className="cb-empty"><Icon name="file" size={34}/><p>{tab==="family"?"담당자가 승인한 메모가 아직 없습니다.":"아직 메모가 없습니다. 먼저 관찰을 남겨 주세요."}</p></div>}
        {items.map(item=><button key={item.id} className={"cb-note-link "+(note?.id===item.id&&tab==="notes"?"selected":"")} disabled={!!busy} onClick={()=>void(tab==="family"?openPreview(item.id):loadNote(item.id))}>
          <span className={"cb-status "+item.status}>{statusLabels[item.status]}</span><b>{date(item.createdAt)}</b><span>{memberName(item.createdBy)} · v{item.version} · {item.language}</span><small>{tab==="family"?"직접 눌러 미리보기":"원문과 초안 비교하기"} →</small>
        </button>)}
        {cursor&&<button className="secondary" disabled={!!busy} onClick={()=>void run("더 불러오고 있습니다…",()=>reloadList(tab==="family",cursor))}>더 보기</button>}
      </section>
      {tab==="family"&&<section className="card cb-preview" aria-live="polite">
        <h2>가족 미리보기</h2><p className="cb-muted">열 때마다 현재 버전의 승인을 확인합니다. 자동 전송이나 외부 공유는 하지 않습니다.</p>
        {preview?<><div className="cb-approved"><Icon name="check" size={20}/>{preview.label}</div><p>v{preview.version} · {date(preview.approvedAt)} 승인</p>{preview.observations.map((o,i)=><article className="cb-preview-item" key={i}><span>{categoryLabels[o.category]}</span><p>{o.text}</p></article>)}<button className="secondary" onClick={()=>setPreview(null)}>미리보기 닫기</button></>:<div className="cb-empty">왼쪽에서 승인된 메모를 선택해 주세요.</div>}
      </section>}
      {tab==="notes"&&<section className="cb-detail" aria-live="polite">
        {!note||!shown?<div className="card cb-empty">메모를 선택하면 원문과 검토 전 초안이 표시됩니다.</div>:<>
          <div className="card"><div className="cb-section-title"><div><h2>원문과 초안 대조</h2><p className="cb-muted">{memberName(note.createdBy)} · {date(note.createdAt)} · v{note.version}</p></div><span className={"cb-status "+note.status}>{statusLabels[note.status]}</span></div>
            <p className="cb-draft-label">{shown.label}</p>
            {historical&&<p className="cb-alert">과거 버전 v{historical.version}입니다. 이 화면에서는 승인할 수 없습니다. 사유: {historical.reason}<button className="text-button" onClick={()=>{setHistorical(null);setEdits(editValues(note.draft));}}>현재 버전으로 돌아가기</button></p>}
            <div className="cb-comparison"><article><h3>보존된 원문</h3><pre dir="auto">{shown.source.text}</pre></article><article><h3>한국어 번역</h3><pre>{shown.translation.text}</pre></article></div>
            <h3>관찰 항목</h3>
            {shown.observations.map((o,i)=><article key={o.id} className="cb-observation">
              <div className="cb-observation-head"><b>관찰 {i+1}</b><span>원문 근거 연결</span></div><blockquote dir="auto">{o.evidence.quote}</blockquote>
              {historical?<p>{o.text}</p>:<><label className="field">한국어 관찰 {i+1}<textarea rows={3} value={edits[i]?.text??""} disabled={!!busy} maxLength={4000} onChange={e=>setEdits(all=>all.map((v,j)=>j===i?{...v,text:e.target.value}:v))}/></label>
              <div className="cb-edit-meta"><label className="field">분류<select value={edits[i]?.category??"other"} disabled={!!busy} onChange={e=>setEdits(all=>all.map((v,j)=>j===i?{...v,category:e.target.value as Category}:v))}>{Object.entries(categoryLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="cb-check"><input type="checkbox" checked={edits[i]?.needsConfirmation??false} disabled={!!busy} onChange={e=>setEdits(all=>all.map((v,j)=>j===i?{...v,needsConfirmation:e.target.checked}:v))}/>작성자에게 추가확인 필요</label></div></>}
            </article>)}
            {shown.additional_checks.length>0&&<div className="cb-alert"><b>추가확인 항목</b>{shown.additional_checks.map(c=><p key={c.id}>{c.evidence.quote} — {c.question}</p>)}</div>}
          </div>
          <section className="card cb-qa"><h2>QA 게이트</h2><p className="cb-muted">검사 통과는 정확도 보증이나 승인이 아닙니다. 담당자가 원문을 대조해야 합니다.</p><div className="cb-qa-count">{shown.qa.checks.filter(c=>c.passed).length} / {shown.qa.checks.length} 항목 확인</div>
            {shown.qa.issues.map((issue,i)=><p key={issue.code+i} className={issue.severity==="hold"?"cb-hold-reason":"cb-review-note"}><b>{issue.severity==="hold"?"보류 사유":"검토 안내"}</b> {issue.message}</p>)}
          </section>
          {!historical&&<section className="card cb-decisions"><h2>{policy.myRole==="reviewer"?"담당자 검토":"초안 수정"}</h2>
            {dirty&&<p className="cb-alert">저장하지 않은 수정이 있습니다. 먼저 ‘수정 저장·재검사’를 눌러 주세요.</p>}
            <label className="field">수정·검토 사유<textarea aria-label="수정·검토 사유" rows={3} maxLength={1000} value={reason} disabled={!!busy} onChange={e=>setReason(e.target.value)} placeholder="확인한 내용이나 수정 이유를 남겨 주세요."/></label>
            <div className="actions"><button className="secondary" disabled={!!busy||!dirty||!reason.trim()||!policy.aiEnabled} onClick={()=>void saveEdit()}>수정 저장·재검사</button><button className="text-button" disabled={!!busy||dirty||!policy.aiEnabled} onClick={()=>void run("초안을 다시 검사하고 있습니다…",async()=>{showNote(await api.check(note.id,note.version));await reloadList(false);})}>QA 다시 검사</button></div>
            {policy.myRole==="reviewer"&&<><label className="cb-check"><input type="checkbox" checked={confirmSource} disabled={!!busy} onChange={e=>setConfirmSource(e.target.checked)}/>원문·한국어 번역·관찰 초안을 대조했습니다.</label>{note.draft.additional_checks.length>0&&<label className="cb-check"><input type="checkbox" checked={confirmChecks} disabled={!!busy} onChange={e=>setConfirmChecks(e.target.checked)}/>작성자에게 추가확인할 내용을 확인했습니다.</label>}
              {self&&<p className="cb-muted">내가 작성한 메모는 다른 검토자가 승인해야 합니다.</p>}
              <div className="actions"><button className="primary" disabled={!!busy||dirty||!reason.trim()||!confirmSource||!!hasHold||self||note.status==="approved"||!policy.aiEnabled||(note.draft.additional_checks.length>0&&!confirmChecks)} onClick={()=>void decide("approve")}>이 버전 승인</button><button className="danger" disabled={!!busy||dirty||!reason.trim()} onClick={()=>void decide("hold")}>보류·미리보기 차단</button></div>
            </>}
            {note.status==="approved"&&!dirty&&<button className="secondary" disabled={!!busy} onClick={()=>void run("승인된 버전을 확인하고 있습니다…",async()=>{setTab("family");setPreview(null);await reloadList(true);setPreview(await api.preview(note.id));})}>승인된 가족 미리보기 열기</button>}
          </section>}
          <section className="card cb-history"><h2>검토·수정 이력</h2>{[...note.history].reverse().map(h=><div className="cb-history-item" key={h.version}><button className="text-button" disabled={!!busy} onClick={()=>void run("이전 버전을 읽고 있습니다…",async()=>{const value=await api.version(note.id,h.version);setHistorical({version:h.version,draft:value.draft,reason:value.reason});})}>v{h.version} · {actionNames[h.action]??h.action}</button><span>{memberName(h.by)} · {date(h.at)}</span><p>{h.reason}</p></div>)}</section>
        </>}
      </section>}
    </div>}

    {tab==="roles"&&policy?.canManage&&<section className="card cb-roles"><h2>케어브릿지 역할</h2><p>메모 작성자는 자신의 초안을, 검토자는 그룹의 검토함을 확인합니다. 가족 열람자는 승인된 미리보기만 볼 수 있습니다.</p><p className="cb-muted">그룹 소유자는 검토자로, 고령자 구성원은 가족 열람자로 고정됩니다. 다른 검토자가 필요하면 ‘가족 관리’에서 보호자를 초대한 뒤 지정해 주세요.</p>
      {policy.roles.map(member=><div className="cb-role-row" key={member.userId}><b>{member.name}</b><label><span className="sr-only">{member.name}의 역할</span><select aria-label={member.name+"의 역할"} value={member.role} disabled={member.locked||!!busy} onChange={e=>void run("역할을 변경하고 있습니다…",async()=>setPolicy(await api.setRole(policy.version,member.userId,e.target.value as CareRole)))}>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>)}
    </section>}
  </div>;
}

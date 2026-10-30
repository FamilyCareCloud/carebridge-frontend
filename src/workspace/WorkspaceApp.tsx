import { t, useLocale } from './i18n';
import { LanguageSelector, ErrorMessage } from './LanguageSelector';
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, gateway, isMock } from "./gateway";
import { MockGateway } from "./mock";
import { roleNames, stamp, statusNames } from "./model";
import type {
  Command,
  Publication,
  Role,
  Session,
  Snapshot,
  Submission,
  ReviewCheck,
} from "./model";
import { blobToBase64, startRecording, toPcmWav, type Recorder } from "../voice";
import { Brand, Badge, Empty, Heading, Modal } from "./ui";
import Login from "./Login";
import "./workspace.css";
import "./renewal.css";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { useWorkspaceHistory, type WorkspaceView, type ListPosition } from './navigation';

const publicationDraftKey = (content: string, ids: string[]) => JSON.stringify([content,[...ids].sort()]);

type Page =
  | "home"
  | "compose"
  | "notes"
  | "requests"
  | "members"
  | "subjects"
  | "publications"
  | "history"
  | "settings";
const labels = {
  home: "업무 현황",
  compose: "메모 작성",
  notes: "내 메모",
  requests: "참여 요청",
  members: "구성원 관리",
  subjects: "돌봄 대상",
  publications: "공개 기록",
  history: "검토 이력",
  settings: "설정",
};
const menus: Record<Role, Page[]> = {
  author: ["compose", "notes", "home", "settings"],
  reviewer: [
    "notes",
    "publications",
    "home",
    "requests",
    "members",
    "subjects",
    "history",
    "settings",
  ],
  reader: ["publications", "settings"],
};
const blankDraft = {
  subjectId: "",
  language: "ko",
  source: "",
  generated: "",
  final: "",
  generatedSource: "",
  generationId: undefined as string | undefined,
  warnings: [] as string[],
  threadId: undefined as string | undefined,
  previousId: undefined as string | undefined,
};
export default function WorkspaceApp() {
  useLocale();
  const [session, setSession] = useState<Session | null>(null),
    [role, setRole] = useState<Role>("reviewer"),
    [data, setData] = useState<Snapshot | null>(null),
    [page, setPage] = useState<Page>("home");
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false),
    [retry, setRetry] = useState(0),
    [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState(blankDraft),
    [requestId, setRequestId] = useState(crypto.randomUUID());
  const [selected, setSelected] = useState<string | null>(null),
    [review, setReview] = useState(""),
    [reason, setReason] = useState(""),
    [reviewVersion, setReviewVersion] = useState(0);
  const [publishId, setPublishId] = useState<string | null>(null),
    [publishVersion, setPublishVersion] = useState(0),
    [publishContent, setPublishContent] = useState(""),
    [recipients, setRecipients] = useState<string[]>([]),
    [preview, setPreview] = useState(false);
  const [readerId, setReaderId] = useState<string | null>(null),
    [subjectForm, setSubjectForm] = useState(false),
    [subjectName, setSubjectName] = useState(""),
    [subjectMemo, setSubjectMemo] = useState("");
  const [code, setCode] = useState(""),
    [groupName, setGroupName] = useState(""),
    [transfer, setTransfer] = useState(""),
    [confirm, setConfirm] = useState<{ text: string; command: Command } | null>(
      null,
    );
  const [regenerate, setRegenerate] = useState(false);
  const [existingPublication, setExistingPublication] = useState<Publication | null>(null);
  const [sourceChecked, setSourceChecked] = useState(false);
  const [checksChecked, setChecksChecked] = useState(false);
  const [dataUse, setDataUse] = useState(false);
  const [transcriptConfirmed, setTranscriptConfirmed] = useState(true);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<Recorder | null>(null);
  const [reviewCheck, setReviewCheck] = useState<ReviewCheck | null>(null);
  const [discardDecision, setDiscardDecision] = useState<((approved: boolean) => void) | null>(null);
  const reviewBaseline = useRef({content:'',reason:''});
  const publishBaseline = useRef('');
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState(!!gateway.restoreSession);
  const [restoreError, setRestoreError] = useState('');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const restoration = useRef<Promise<Session | null> | null>(null);
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  useEffect(() => {
    if (!gateway.restoreSession) return;
    let live = true;
    restoration.current ??= gateway.restoreSession();
    void restoration.current.then(s => { if (live && s) login(s); }).catch(err => {
      if (!live) return;
      if (err instanceof ApiError && [401,403].includes(err.status)) setError(err.message);
      else setRestoreError('로그인 상태를 확인하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    }).finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, [restoreAttempt]);
  const editingNote = data?.submissions.find(n => n.id === selected);
  const reviewConflict = !!editingNote && editingNote.version !== reviewVersion;
  const publishNote = data?.submissions.find(n => n.id === publishId);
  const publishConflict = !!publishId && !!data && (!publishNote || publishNote.version !== publishVersion
    || (!!existingPublication && data.publications.find(p => p.id === existingPublication.id)?.version !== existingPublication.version));
  const dirty = !!draft.source.trim() || !!draft.final.trim() || recording
    || (!!selected && (review !== (editingNote?.review || editingNote?.final || '') || reason !== (editingNote?.reason || '')))
    || !!publishId || (subjectForm && !!(subjectName.trim() || subjectMemo.trim()));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const currentView: WorkspaceView = {page,selected,readerId,publishId,preview,subjectForm};
  function needsDiscard(next: WorkspaceView) {
    return (!!selected && next.selected!==selected && role==='reviewer' && (review!==reviewBaseline.current.content || reason!==reviewBaseline.current.reason))
      || (!!publishId && next.publishId!==publishId && publicationDraftKey(publishContent,recipients)!==publishBaseline.current)
      || (subjectForm && !next.subjectForm && !!(subjectName.trim() || subjectMemo.trim()));
  }
  function decideDiscard(): Promise<boolean> {
    return new Promise(resolve=>setDiscardDecision(()=>resolve));
  }
  function settleDiscard(approved: boolean) { const resolve=discardDecision;setDiscardDecision(null);resolve?.(approved); }
  function restoreView(next: WorkspaceView, position: ListPosition) {
    if(!menus[role].includes(next.page as Page))return;
    if(next.selected && next.selected!==selected) {
      const n=data?.submissions.find(n=>n.id===next.selected);
      if(n) {
        reviewBaseline.current={content:n.review||n.final,reason:n.reason};
        setReview(n.review||n.final);setReason(n.reason);setReviewVersion(n.version);
        setReviewCheck(null);setSourceChecked(false);setChecksChecked(false);
      } else next={...next,selected:null};
    }
    if(next.publishId && next.publishId!==publishId) {
      const n=data?.submissions.find(n=>n.id===next.publishId);
      if(n?.status==='confirmed' && role==='reviewer' && !data?.publications.some(p=>p.submissionId===n.id && p.state==='published')) {
        initializePublication(n);
        // Reopening a discarded editor starts from its saved settings before preview.
        next={...next,preview:false};
      } else next={...next,publishId:null,preview:false};
    }
    if(next.subjectForm && !subjectForm){setSubjectName('');setSubjectMemo('');}
    setPage(next.page as Page);setSelected(next.selected);setReaderId(next.readerId);
    setPublishId(next.publishId);setPreview(next.preview);setSubjectForm(next.subjectForm);
    setQuery(position.query);setFilter(position.filter);setMobile(false);setError('');
    requestAnimationFrame(()=>window.scrollTo({top:position.scroll}));
  }
  const navigation = useWorkspaceHistory({
    identity:session ? `${isMock?'preview':'api'}:${session.user.id}:${role}` : null,
    view:currentView,position:{query,filter,scroll:window.scrollY},allowedPages:menus[role],restore:restoreView,
    mayLeave:async next=>{
      if(regenerate){setRegenerate(false);return false;}
      if(confirm){setConfirm(null);return false;}
      if(busy){setToast('처리 중인 작업이 끝난 뒤 이동해 주세요.');return false;}
      return !needsDiscard(next) || await decideDiscard();
    },
  });
  function transition(next: WorkspaceView, apply:()=>void) {
    if(busy){setToast('처리 중인 작업이 끝난 뒤 이동해 주세요.');return;}
    if(needsDiscard(next))void decideDiscard().then(approved=>{if(approved)apply();});
    else apply();
  }
  const epoch = useRef(0),
    generation = useRef(0),
    readOrder = useRef(0),
    connected = useRef(false);
  const refreshQueue = useRef<{ epoch: number; requested: number; promise: Promise<void> | null }>({epoch:-1,requested:0,promise:null});
  const refreshedData = useRef<Snapshot | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (!session || !connected.current) return Promise.resolve();
    const e = epoch.current, order = ++readOrder.current;
    if (refreshQueue.current.epoch !== e) refreshQueue.current={epoch:e,requested:order,promise:null};
    const queue=refreshQueue.current;
    queue.requested=order;
    // QA save/check and stream invalidations can arrive together. Share one
    // current read and perform a fresh trailing read; never render stale data.
    if (queue.promise) return queue.promise;
    setRefreshing(true);
    queue.promise=(async () => {
      while (connected.current && e===epoch.current) {
        const requested=queue.requested;
        try {
          const next=await gateway.snapshot(session,role);
          if (connected.current && e===epoch.current && requested===readOrder.current) {
            refreshedData.current=next;setData(next);setOffline(false);
          }
        } catch (err) {
          if (e===epoch.current && requested===readOrder.current) {
            if (err instanceof ApiError && [401,403].includes(err.status)) {
              connected.current=false;setData(null);setOffline(true);
              if(err.status===401)setSession(null);
            }
            setError((err as Error).message);
          }
        }
        if (queue.requested===requested) break;
      }
    })().finally(()=>{queue.promise=null;if(e===epoch.current)setRefreshing(false);});
    return queue.promise;
  }, [session, role]);
  useEffect(() => {
    const e = ++epoch.current;
    connected.current = false;
    if (!session) return;
    const invalidate = () => {
      if (e !== epoch.current) return;
      // Publications may have been revoked: mask only their content until verified.
      // Author/reviewer editors stay mounted throughout ordinary refreshes.
      if(role === 'reader') setData(previous => previous ? {...previous, publications: []} : previous);
      void refresh();
    };
    const disconnect = (message?: string, status?: number) => {
      if (e !== epoch.current) return;
      connected.current = false;
      generation.current++;
      recorder.current?.cancel();recorder.current=null;setRecording(false);
      readOrder.current++;
      setOffline(true);
      setRefreshing(false);
      setData(null);
      if (message) setError(message);
      if (status===401) setSession(null);
    };
    const stop = gateway.subscribe(session, invalidate, disconnect, () => {
      if (e !== epoch.current) return;
      connected.current = true;
      void refresh();
    });
    const reconnect = () => {
      if(offlineRef.current) setRetry((r) => r + 1);
      else void refresh();
    };
    const visibility = () => {
      if (!document.hidden) reconnect();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setData(null);
        setOffline(false);
        setRetry((r) => r + 1);
      }
    };
    const disconnectedEvent = () => disconnect();
    window.addEventListener("focus", reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("pagehide", disconnectedEvent);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      recorder.current?.cancel();
      recorder.current=null;
      setRecording(false);
      epoch.current = e + 1;
      connected.current = false;
      stop();
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("pagehide", disconnectedEvent);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session, role, refresh, retry]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  function clearViews() {
    recorder.current?.cancel();recorder.current=null;setRecording(false);
    setDataUse(false);setTranscriptConfirmed(true);setReviewCheck(null);
    generation.current++;
    setBusy(false);
    setRefreshing(false);
    setOffline(false);
    setRegenerate(false);
    setSelected(null);
    setReaderId(null);
    setPublishId(null);
    setExistingPublication(null);
    setPublishContent("");
    setRecipients([]);
    setReview("");
    setReason("");
    setSubjectForm(false);
    setSubjectName("");
    setSubjectMemo("");
    setPreview(false);
    setConfirm(null);
    setDraft(blankDraft);
    setRequestId(crypto.randomUUID());
    setQuery("");
    setFilter("all");
    setError("");
    setToast("");
    setData(null);
  }
  function login(s: Session) {
    clearViews();
    setMobile(false);
    window.scrollTo({ top: 0 });
    setSession(s);
    setRole(s.user.role);
    setPage(s.user.role === "reader" ? "publications" : s.user.role === "author" ? "compose" : "notes");
  }
  function navigate(p: Page) {
    if(p===page && !selected && !readerId && !publishId && !subjectForm){setMobile(false);return;}
    const next={...currentView,page:p,selected:null,readerId:null,publishId:null,preview:false,subjectForm:false};
    transition(next,()=>{
    recorder.current?.cancel();recorder.current=null;setRecording(false);
    setPage(p);
    setMobile(false);
    setQuery("");
    setFilter("all");
    setSelected(null);
    setReaderId(null);setPublishId(null);setPreview(false);setSubjectForm(false);
    setError("");
    window.scrollTo({ top: 0 });
    });
  }
  async function logout() {
    const current = session;
    epoch.current++;
    connected.current = false;
    clearViews();
    setSession(null);
    if (current) {
      try { await gateway.logout?.(current); }
      catch { window.alert(t("이 기기에서는 로그아웃했지만 서버 세션 종료에 실패했습니다.")); }
    }
  }
  async function selectRole(next: Role) {
    if (!session) return;
    epoch.current++;
    connected.current = false;
    clearViews();
    setBusy(true);
    try {
      if (gateway.selectRole) login(await gateway.selectRole(session, next));
      else { setRole(next); setPage(next === "reader" ? "publications" : next === "author" ? "compose" : "notes"); }
    } catch (err) { setError((err as Error).message); setRetry(r=>r+1); }
    finally { setBusy(false); }
  }
  async function action(command: Command, message: string) {
    if (!session || busy || !connected.current) return false;
    if ((command.type === 'review' && reviewConflict) || (command.type === 'publish' && publishConflict)) {
      setError('다른 작업에서 기록이 변경되었습니다. 입력 내용은 유지됩니다. 최신 기록을 확인한 뒤 다시 진행해 주세요.'); return false;
    }
    const e = epoch.current;
    setBusy(true);
    setError("");
    try {
      refreshedData.current=null;
      await gateway.execute(session, role, command);
      if (e !== epoch.current) return false;
      await refresh();
      if (e !== epoch.current) return false;
      setToast(message);
      if (["createWorkspace", "join", "acceptTransfer"].includes(command.type)) setRetry(r=>r+1);
      return true;
    } catch (err) {
      if (e === epoch.current) {
        setError((err as Error).message);
        if(err instanceof ApiError && err.status===409) await refresh();
      }
      return false;
    } finally {
      if (e === epoch.current) setBusy(false);
    }
  }
  async function generate() {
    if (!session || busy || (!isMock && (!dataUse || !transcriptConfirmed))) return;
    const e = epoch.current;
    setRegenerate(false);
    setBusy(true);
    setError("");
    const id = ++generation.current;
    try {
      const result = await gateway.generate(
        session,
        role,
        draft.source,
        draft.language,
      );
      if (id === generation.current && e === epoch.current) {
        setRequestId(crypto.randomUUID());
        setDraft((d) => ({
          ...d,
          generated: result.text,
          final: result.text,
          generatedSource: result.source,
          generationId: result.generationId,
          warnings: result.warnings ?? [],
        }));
      }
    } catch (err) {
      if (e === epoch.current) setError((err as Error).message);
    } finally {
      if (e === epoch.current) setBusy(false);
    }
  }
  function edit(n: Submission) {
    setDraft({
      subjectId: n.subjectId,
      language: n.language,
      source: n.source,
      generated: n.generated,
      final: n.final,
      generatedSource: n.source,
      generationId: n.generationId,
      warnings: n.warnings ?? [],
      threadId: n.threadId,
      previousId: n.id,
    });
    setRequestId(crypto.randomUUID());
    navigate("compose");
  }
  function openNote(n: Submission) {
    reviewBaseline.current={content:n.review||n.final,reason:n.reason};
    setReviewCheck(null);
    setSourceChecked(false);
    setChecksChecked(false);
    setSelected(n.id);
    setReview(n.review || n.final);
    setReason(n.reason);
    setReviewVersion(n.version);
  }
  async function checkFinal() {
    if (!session || !note || busy || !gateway.checkReview) return;
    if(reviewConflict) {setError('다른 작업에서 기록이 변경되었습니다. 최신 기록을 확인해 주세요.');return;}
    const e=epoch.current;
    setBusy(true);setError("");setReviewCheck(null);setChecksChecked(false);
    try {
      const result=await gateway.checkReview(session,role,note.id,reviewVersion,review,reason);
      if(e===epoch.current){setReviewVersion(result.version);setReviewCheck(result);await refresh();}
    } catch(err) { if(e===epoch.current){if(err instanceof ApiError && err.details?.savedVersion)setReviewVersion(err.details.savedVersion);setError((err as Error).message);await refresh();} }
    finally {if(e===epoch.current)setBusy(false);}
  }
  async function transcribe(blob: Blob) {
    if(!session || !gateway.transcribe) return;
    if(blob.size>44+16000*2*30) throw new Error("음성 메모는 30초 이하로 준비해 주세요.");
    const e=epoch.current,id=++generation.current;
    setBusy(true);setError("");
    try {
      const result=await gateway.transcribe(session,role,await blobToBase64(blob),draft.language);
      if(e===epoch.current && id===generation.current){
        setDraft(d=>({...d,source:result.text,generatedSource:"",generationId:undefined}));
        setTranscriptConfirmed(false);setRequestId(crypto.randomUUID());
      }
    } catch(err){if(e===epoch.current)setError((err as Error).message);}
    finally{if(e===epoch.current)setBusy(false);}
  }
  async function record() {
    if(recording && recorder.current){const activeRecorder=recorder.current;recorder.current=null;setRecording(false);try{await transcribe((await activeRecorder.stop()).blob);}catch(err){setError((err as Error).message);}return;}
    const e=epoch.current;setBusy(true);setError("");
    try{const next=await startRecording();if(e!==epoch.current){next.cancel();return;}recorder.current=next;setRecording(true);}
    catch(err){if(e===epoch.current)setError((err as Error).message);}
    finally{if(e===epoch.current)setBusy(false);}
  }
  function initializePublication(n: Submission, existing?: Publication, snapshot = data) {
    const saved=existing ?? snapshot?.publications.filter(p=>p.submissionId===n.id && p.state!=="published")
      .slice().reverse().sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0))[0] ?? null;
    const content=saved?.content ?? (n.review || n.final);
    const ids=(saved?.recipients ?? []).filter(id=>snapshot?.members.some(m=>m.userId===id && m.role==='reader' && m.status==='active'));
    publishBaseline.current=publicationDraftKey(content,ids);
    setExistingPublication(saved);
    setPublishVersion(n.version);
    setPublishContent(content);
    setRecipients(ids);
  }
  function openPublish(n: Submission, existing?: Publication, snapshot = data) {
    if(snapshot?.publications.some(p=>p.submissionId===n.id && p.state==='published')) {
      setError('이미 공개 중인 기록입니다. 현재 공개를 차단한 뒤 수정해 주세요.');return;
    }
    initializePublication(n,existing,snapshot);
    setPublishId(n.id);
    setPreview(false);
    setSelected(null);
  }
  if (restoring || restoreError) return <div className="cb-loading" role="status">
    <LanguageSelector />
    {restoring ? t("로그인 상태를 확인하고 있어요…") : t(restoreError)}
    {restoreError && <button className="cb-primary" onClick={() => {restoration.current=null;setRestoring(true);setRestoreError('');setRestoreAttempt(n=>n+1);}}>{t("다시 확인")}</button>}
  </div>;
  if (!session) return <Login onSession={login} sessionError={error} />;
  const user = session.user,
    active =
      !!data?.workspace &&
      (user.admin ||
        (role === "reviewer"
          ? data.workspace.ownerId === user.id
          : data.membership?.status === "active"));
  const notes = data?.submissions ?? [],
    pubs = data?.publications ?? [],
    subjects = data?.subjects ?? [],
    members = data?.members ?? [];
  const note = notes.find((n) => n.id === selected),
    publication = pubs.find(
      (p) => p.id === readerId && p.state === "published",
    );
  const eligibleRecipients=members.filter(m=>m.role==='reader' && m.status==='active');
  const selectedRecipientCount=eligibleRecipients.filter(m=>recipients.includes(m.userId)).length;
  const allRecipientsSelected=eligibleRecipients.length>0 && selectedRecipientCount===eligibleRecipients.length;
  const invalidRecipients=recipients.some(id=>!eligibleRecipients.some(m=>m.userId===id));
  const excludedPreviousRecipients=existingPublication?.recipients.some(id=>!eligibleRecipients.some(m=>m.userId===id));
  const subjectLabel = (id: string) => {
    const s = subjects.find((s) => s.id === id);
    return s ? `${s.name} · #${String(s.number).padStart(3, "0")}` : t("대상자");
  };
  const counts = {
      pending: notes.filter((n) => n.status === "pending").length,
      held: notes.filter((n) => n.status === "held").length,
      confirmed: notes.filter((n) => n.status === "confirmed").length,
    },
    pendingMembers = members.filter((m) => m.status === "pending");
  const pageLabel = (p: Page) => t(
    p === "notes" && role === "reviewer"
      ? "검토함"
      : p === "publications" && role === "reader"
        ? "전달 사항"
        : labels[p]);
  function noteTable(items: Submission[]) {
    return items.length ? (
      <div className="cb-table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("대상자 / 기록")}</th>
              {role === "reviewer" && <th>{t("작성자")}</th>}
              <th>{t("제출 시각")}</th>
              <th>{t("상태")}</th>
              <th>
                <span className="cb-sr">{t("상세")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id}>
                <td>
                  <button
                    className="cb-record-link"
                    onClick={() => openNote(n)}
                  >
                    <strong>{subjectLabel(n.subjectId)}</strong>
                    <span>{n.final.split("\n")[0]}</span>
                    {n.previousId && (
                      <small>{t("↳ 이전 제출에서 이어진 새 검토 건")}</small>
                    )}
                  </button>
                </td>
                {role === "reviewer" && (
                  <td>
                    <span className="cb-avatar tiny">{n.authorName[0]}</span>
                    {n.authorName}
                  </td>
                )}
                <td className="cb-muted">{stamp(n.createdAt)}</td>
                <td>
                  <Badge status={n.status} />
                </td>
                <td>
                  <button className="cb-text" onClick={() => openNote(n)}>
                    {t("내용 보기 ↗")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty title={t("표시할 메모가 없습니다")}>
        {t("새로운 기록이 도착하면 여기에서 확인할 수 있어요.")}</Empty>
    );
  }
  return (
    <div className={`cb-app cb-role-${role} cb-page-${page}`}>
      <aside className={`cb-sidebar ${mobile ? "open" : ""}`}>
        <Brand />
        <div className="cb-workspace">
          <WorkspaceIcon name="building" />
          <div>
            <strong>{data?.workspace?.name || t("작업 그룹")}</strong>
            <small>{t("기관 작업 공간")}</small>
          </div>
        </div>
        <small className="cb-nav-label">{t("매일의 돌봄")}</small>
        <nav aria-label={t("주 메뉴")}>
          {menus[role].map((p) => (
            <button
              key={p}
              aria-label={pageLabel(p)}
              aria-current={page === p ? "page" : undefined}
              className={`${page === p ? "active" : ""} ${p === "requests" || p === "settings" ? "cb-nav-section" : ""}`}
              onClick={() => navigate(p)}
            >
              <WorkspaceIcon name={p} />
              {pageLabel(p)}
              {p === "requests" && pendingMembers.length > 0 && (
                <b>{pendingMembers.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="cb-sidebar-footer">
          <div className="cb-person">
            <span className="cb-avatar">{user.name[0]}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{t(roleNames[role])}</small>
            </div>
          </div>
          <button
            className="cb-text"
            onClick={() => void logout()}
          >
            {t("↪ 로그아웃")}</button>
        </div>
      </aside>
      {mobile && (
        <button
          className="cb-scrim"
          aria-label={t("메뉴 닫기")}
          onClick={() => setMobile(false)}
        />
      )}
      <div className="cb-main">
        <header className="cb-topbar">
          <button
            className="cb-mobile-menu cb-icon"
            aria-label={t("메뉴 열기")}
            onClick={() => setMobile(!mobile)}
          >
            ☰
          </button>
          <div className="cb-breadcrumb">
            {data?.workspace?.name || "CareBridge"} <span>/</span>{" "}
            <strong>{pageLabel(page)}</strong>
          </div>
          <div className="cb-top-actions">
            <LanguageSelector />
            <span className="cb-role-dot" />
            {t(roleNames[role])}
            <span className="cb-avatar small">{user.name[0]}</span>
          </div>
        </header>
        {isMock && (
          <div className="cb-devbar">
            <span>
              <b>LOCAL QA</b>{" "}
              {t("합성 데이터 · AI 응답은 모의 결과입니다")}</span>
            {user.admin ? (
              <label>
                {t("테스트 역할")}{" "}
                <select
                  aria-label={t("테스트 역할")}
                  value={role}
                  disabled={busy}
                  onChange={(e) => void selectRole(e.target.value as Role)}
                >
                  {Object.entries(roleNames).map(([r, n]) => (
                    <option key={r} value={r}>
                      {t(n)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <small>{t("역할은 가입 시 고정됩니다")}</small>
            )}
          </div>
        )}
        <main className="cb-content">
          {navigation.canBack && <button className="cb-text cb-back" onClick={navigation.back}>{t("← 뒤로가기")}</button>}
          {refreshing && data && <div className="cb-refresh-status" role="status">{t("최신 내용을 확인하고 있어요…")}</div>}
          {error && (
            <div className="cb-error" role="alert">
              {<ErrorMessage message={error} />}
              <button className="cb-text" onClick={() => setError("")}>
                {t("닫기")}</button>
            </div>
          )}
          {offline ? (
            <Empty title={t("접근 권한을 다시 확인해야 합니다")}>
              {t("연결이 끊겨 기록 표시를 중단했습니다.")}<br />
              <button
                className="cb-primary"
                onClick={() => {
                  setError("");
                  setData(null);
                  setOffline(false);
                  setRetry((r) => r + 1);
                }}
              >
                {t("다시 연결")}</button>
            </Empty>
          ) : !data ? (
            <div className="cb-loading" role="status">
              {error ? <button className="cb-primary" disabled={refreshing} onClick={() => void refresh()}>{t("다시 불러오기")}</button> : t("작업 공간을 확인하고 있어요…")}
            </div>
          ) : !active ? (
            <section className="cb-join">
              <Heading
                eyebrow="YOUR WORKSPACE"
                title={
                  role === "reviewer"
                    ? t("기관의 작업 공간을 연결하세요")
                    : t("함께할 작업 그룹에 참여하세요")
                }
              >
                {t("담당자의 승인 후 업무를 시작할 수 있습니다.")}</Heading>
              {data.membership && (
                <div className="cb-notice">
                  {t("참여 상태:")}{" "}
                  {
                    {
                      pending: t("승인 대기"),
                      active: t("참여 중"),
                      rejected: t("거절 · 재요청 가능"),
                      removed: t("퇴출 · 접근 차단"),
                    }[data.membership.status]
                  }
                </div>
              )}
              {(data.transfers ?? []).filter(transferItem=>transferItem.incoming && transferItem.status==="pending").map(transferItem=>(
                <div className="cb-notice" key={transferItem.id}>
                  {transferItem.workspaceName} {t("관리 권한 이전 요청")}<button className="cb-primary" disabled={busy} onClick={()=>setConfirm({text:"이 기관의 관리 권한을 수락할까요?",command:{type:"acceptTransfer",workspaceId:transferItem.workspaceId,id:transferItem.id,version:transferItem.version}})}>{t("이전 수락")}</button>
                </div>
              ))}
              {role === "reviewer" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(
                      { type: "createWorkspace", name: groupName },
                      "작업 그룹을 만들었습니다.",
                    );
                  }}
                >
                  <label>
                    {t("기관 이름")}<input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      required
                    />
                  </label>
                  <button className="cb-primary" disabled={busy}>
                    {t("작업 그룹 생성")}</button>
                  {isMock && (
                    <p className="cb-muted">
                      {t("모의 환경에는 온유요양센터가 있습니다. 기존 담당자의 설정에서 권한을 이전받을 수 있어요.")}</p>
                  )}
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action({ type: "join", code }, "참여를 요청했습니다.");
                  }}
                >
                  <label>
                    {t("초대코드")}<input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={isMock ? "CARE2026" : t("초대코드 입력")}
                      required
                    />
                  </label>
                  <button
                    className="cb-primary"
                    disabled={
                      busy ||
                      data.membership?.status === "pending"
                    }
                  >
                    {t("참여 요청")}</button>
                </form>
              )}
            </section>
          ) : (
            <>
              {page === "home" && (
                <>
                  <Heading
                    eyebrow="CARE, CONNECTED."
                    title={
                      role === "reviewer"
                        ? t("오늘의 기록, 함께 확인해요")
                        : t("작은 관찰을, 놓치지 않도록")
                    }
                    action={
                      <button
                        className="cb-primary"
                        onClick={() => {
                          if (role === "author") {
                            setDraft(blankDraft);
                            setRequestId(crypto.randomUUID());
                          }
                          navigate(role === "author" ? "compose" : "notes");
                        }}
                      >
                        {role === "author"
                          ? t("＋ 새 메모 작성")
                          : t("검토함 열기 ↗")}
                      </button>
                    }
                  >
                    {t("원문부터 검토까지. 확인된 기록을 필요한 사람에게 전달하세요.")}</Heading>
                  <div className={`cb-stats ${role==='reviewer' ? 'cb-stats-reviewer' : ''}`}>
                    {(["pending", "held", "confirmed"] as const).filter(s=>role!=='reviewer' || s!=='confirmed').map((s, i) => (
                      <button
                        key={s}
                        className={`cb-stat stat-${s}`}
                        onClick={() => {
                          navigate("notes");
                          setFilter(s);
                        }}
                      >
                        <span className="cb-stat-icon">
                          {["▤", "◷", "✓"][i]}
                        </span>
                        <span>
                          <small>{t(statusNames[s])}</small>
                          <strong>
                            {counts[s]}
                            <em>{t("건")}</em>
                          </strong>
                          <p>
                            {
                              [
                                t("확인이 필요한 기록"),
                                t("추가 확인을 기다리는 기록"),
                                t("담당자가 확인한 기록"),
                              ][i]
                            }
                          </p>
                        </span>
                        <span className="cb-stat-arrow">↗</span>
                      </button>
                    ))}
                  </div>
                  <div className="cb-home-grid">
                    <section className="cb-card">
                      <div className="cb-section-title">
                        <div>
                          <h2>
                            {role === "reviewer"
                              ? t("검토가 필요한 메모")
                              : t("최근 제출한 메모")}
                          </h2>
                          <p>{t("각 제출 건의 진행 상황을 확인하세요.")}</p>
                        </div>
                        <button
                          className="cb-text"
                          onClick={() => navigate("notes")}
                        >
                          {t("전체 보기 →")}</button>
                      </div>
                      {noteTable(
                        (role === "reviewer"
                          ? notes.filter((n) => n.status !== "confirmed")
                          : notes
                        ).slice(0, 5),
                      )}
                    </section>
                    <aside className="cb-side-cards">
                      {role==='reviewer' ? (
                        <section className="cb-card cb-home-requests" aria-labelledby="home-requests-title">
                          <div className="cb-section-title">
                            <h2 id="home-requests-title">{t("참여 요청")}{" "}<span className="cb-count">{pendingMembers.length}{t("명")}</span></h2>
                            <button className="cb-text" onClick={()=>navigate('requests')}>{t("요청 관리 →")}</button>
                          </div>
                          {pendingMembers.length ? (
                            <ul className="cb-request-preview">
                              {pendingMembers.map(m=>(
                                <li key={m.requestId ?? m.userId}>
                                  <span className="cb-avatar" aria-hidden="true">{m.name[0]}</span>
                                  <div className="cb-grow">
                                    <h3>{m.name}</h3><p>{t(roleNames[m.role])}</p>
                                    <small>{t("요청 시각")}{" "}{stamp(m.requestedAt ?? '')}</small>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : <p className="cb-request-empty">{t("대기 중인 참여 요청이 없습니다.")}</p>}
                        </section>
                      ) : (
                      <section className="cb-card cb-focus">
                        <span className="cb-eyebrow">{t('NEXT ACTION')}</span>
                        <h2>{t("이렇게 기록해 주세요")}</h2>
                        <p>{t("직접 관찰한 사실, 당사자의 말, 제공한 지원을 구분하면 더 명확한 기록이 됩니다.")}</p>
                        <button
                          className="cb-text"
                          onClick={() => navigate('compose')}
                        >
                          {t("메모 작성하기 →")}</button>
                      </section>
                      )}
                    </aside>
                  </div>
                  <section className="cb-flow">
                    <div>
                      <h3>{t("케어브릿지 기록 과정")}</h3>
                      <small>{t("관찰이 안전하게 전달되는 네 단계")}</small>
                    </div>
                    {[
                      t("메모 작성"),
                      t("AI 초안 확인"),
                      t("담당자 검토"),
                      t("선별한 기록 공개"),
                    ].map((s, i) => (
                      <div className="cb-flow-step" key={s}>
                        <b>{String(i + 1).padStart(2, "0")}</b>
                        <span>{s}</span>
                      </div>
                    ))}
                  </section>
                </>
              )}
              {page === "compose" && role === "author" && (
                <>
                  <Heading
                    eyebrow="OBSERVATION NOTE"
                    title={
                      draft.previousId
                        ? t("메모 보완 · 새 제출")
                        : t("관찰 메모 작성")
                    }
                    action={
                      <span className="cb-step-label">
                        {t("01 입력 → 02 확인 → 03 제출")}</span>
                    }
                  >
                    {t("원문을 작성하고 초안을 확인한 뒤, 담당자에게 제출하세요.")}</Heading>
                  <div className="cb-compose-grid">
                    <section className="cb-card cb-form-card">
                      <div className="cb-compose-status">
                        <span>{t("오늘의 관찰을 기록해 주세요")}</span>
                        {counts.held > 0 && <button onClick={() => { navigate("notes"); setFilter("held"); }}>{t('보완이 필요한 메모 {count}건 →',{count:counts.held})}</button>}
                      </div>
                      <div className="cb-form-row">
                        <label>
                          {t("돌봄 대상")}<select
                            value={draft.subjectId}
                            onChange={(e) => {
                              setRequestId(crypto.randomUUID());
                              setDraft((d) => ({
                                ...d,
                                subjectId: e.target.value,
                              }));
                            }}
                          >
                            <option value="">{t("대상자를 선택하세요")}</option>
                            {subjects.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} · #{String(s.number).padStart(3, "0")}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("작성 언어")}<select
                            value={draft.language}
                            onChange={(e) => {
                              generation.current++;
                              setRequestId(crypto.randomUUID());
                              setDraft((d) => ({
                                ...d,
                                language: e.target.value,
                                generatedSource: "",
                              }));
                            }}
                          >
                            <option value="ko">{t("한국어")}</option>
                            <option value="en">English</option>
                            <option value="vi">Tiếng Việt</option>
                            <option value="id">Bahasa Indonesia</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        {t("원문 메모")}<textarea
                          rows={12}
                          maxLength={4000}
                          value={draft.source}
                          onChange={(e) => {
                            generation.current++;
                            setRequestId(crypto.randomUUID());
                            setDraft((d) => ({ ...d, source: e.target.value }));
                          }}
                          placeholder={t("직접 관찰한 사실과 제공한 지원을 적어 주세요.")}
                        />
                      </label>
                      <div className="cb-field-footer">
                        <span>{t("모르는 내용은 추측하지 않고 남겨 주세요.")}</span>
                        <span>
                          {draft.source.length.toLocaleString()} / 4,000
                        </span>
                      </div>
                      {!isMock && <>
                        <label><input type="checkbox" checked={dataUse} onChange={e=>setDataUse(e.target.checked)} /> {t("실제 개인정보가 없는 연습용 메모·음성임을 확인했습니다.")}</label>
                        <p className="cb-muted">{t("음성은 30초 이내로 녹음하거나 선택해 주세요. 받아쓴 원문은 생성 전에 직접 확인합니다.")}</p>
                        <div className="cb-modal-actions">
                          <button className="cb-secondary" disabled={busy || !dataUse} onClick={()=>void record()}>{recording?t("녹음 중지 · 받아쓰기"):t("음성 메모 녹음")}</button>
                          <label>{t("음성 파일 선택")}<input type="file" accept="audio/*,.wav,.webm,.mp3,.m4a" disabled={busy || recording || !dataUse} onChange={async e=>{
                            const file=e.target.files?.[0];e.target.value="";if(!file)return;
                            const epochAtStart=epoch.current;setBusy(true);setError("");
                            try{if(file.size>10*1024*1024)throw new Error("음성 파일은 10MB 이하로 선택해 주세요.");const wav=await toPcmWav(file);if(epochAtStart===epoch.current)await transcribe(wav);}
                            catch(err){if(epochAtStart===epoch.current)setError((err as Error).message);}
                            finally{if(epochAtStart===epoch.current)setBusy(false);}
                          }} /></label>
                        </div>
                        {!transcriptConfirmed && <label><input type="checkbox" checked={transcriptConfirmed} onChange={e=>setTranscriptConfirmed(e.target.checked)} /> {t("받아쓴 원문을 확인하고 필요한 부분을 수정했습니다.")}</label>}
                      </>}
                      <button
                        className="cb-primary"
                        disabled={busy || recording || !draft.source.trim() || (!isMock && (!dataUse || !transcriptConfirmed))}
                        onClick={() =>
                          draft.generated
                            ? setRegenerate(true)
                            : void generate()
                        }
                      >
                        {busy
                          ? t("처리 중…")
                          : draft.generated
                            ? t("초안 다시 생성")
                            : t("✧ 초안 만들기")}
                      </button>
                      {draft.generated && (
                        <div className="cb-draft-result">
                          <div className="cb-section-title">
                            <h2>{t("초안 확인 · 수정")}</h2>
                            <Badge status="pending" />
                          </div>
                          {(draft.warnings ?? []).length>0 && <div className="cb-notice"><b>{t("초안 확인사항")}</b>{draft.warnings.map((w,i)=><p key={i}>{w}</p>)}</div>}
                          {draft.generatedSource !== draft.source && (
                            <div className="cb-notice">
                              {t("원문 또는 언어가 변경됐습니다. 초안을 다시 생성해 주세요.")}</div>
                          )}
                          {isMock && (
                            <p className="cb-muted">
                              {t("화면 QA용 모의 결과입니다. 실제 번역이나 의미 검사를 수행하지 않습니다.")}</p>
                          )}
                          <label>
                            {t("제출할 최종 초안")}<textarea
                              rows={7}
                              value={draft.final}
                              onChange={(e) => {
                                setRequestId(crypto.randomUUID());
                                setDraft((d) => ({
                                  ...d,
                                  final: e.target.value,
                                }));
                              }}
                            />
                          </label>
                          <details>
                            <summary>{t("최초 생성 결과 보기")}</summary>
                            <pre>{draft.generated}</pre>
                          </details>
                          <p className="cb-muted">
                            {t("전송마다 새 검토 건이 쌓이며, 이전 제출 내용은 유지됩니다.")}</p>
                          <button
                            className="cb-primary"
                            disabled={
                              busy ||
                              !draft.subjectId ||
                              !draft.final.trim() ||
                              recording || (!isMock && (!dataUse || !transcriptConfirmed || !draft.generationId)) ||
                              draft.generatedSource !== draft.source
                            }
                            onClick={async () => {
                              if (
                                await action(
                                  { type: "submit", ...draft, requestId },
                                  "담당자에게 검토를 요청했습니다.",
                                )
                              ) {
                                setDraft(blankDraft);
                                setRequestId(crypto.randomUUID());
                                navigate("notes");
                              }
                            }}
                          >
                            {t("확인했어요 · 검토 요청 →")}</button>
                        </div>
                      )}
                    </section>
                    <aside className="cb-card cb-guide">
                      <span className="cb-eyebrow">{t('WRITING GUIDE')}</span>
                      <h2>{t("이렇게 기록해 주세요")}</h2>
                      {[
                        [
                          "◎",
                          t("직접 관찰한 사실"),
                          t("식사량, 수면 모습, 활동 모습 등 직접 본 내용을 구체적으로 적어 주세요."),
                        ],
                        [
                          "❝",
                          t("당사자가 한 말"),
                          t("“무릎이 불편해요”처럼 표현을 그대로 남겨 주세요."),
                        ],
                        [
                          "♧",
                          t("제공한 지원"),
                          t("이동 보조, 식사 도움 등 실제 제공한 지원을 구분해 주세요."),
                        ],
                        [
                          "◷",
                          t("추가로 확인할 사항"),
                          t("확인하지 못한 내용은 미확인으로 남겨 주세요."),
                        ],
                      ].map(([icon, title, text]) => (
                        <div className="cb-guide-item" key={title}>
                          <WorkspaceIcon name={icon === "◎" ? "subjects" : icon === "◷" ? "history" : icon === "♧" ? "members" : "notes"} />
                          <div>
                            <h3>{title}</h3>
                            <p>{text}</p>
                          </div>
                        </div>
                      ))}
                      <div className="cb-notice">
                        {isMock ? t("이 미리보기에서는 합성 메모로 작성 흐름을 확인할 수 있습니다.") : t("음성으로도 기록할 수 있어요. 받아쓴 내용을 확인한 뒤 초안을 만들어 주세요.")}
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {page === "notes" && (
                <>
                  <Heading
                    eyebrow={role === "reviewer" ? "REVIEW INBOX" : "MY NOTES"}
                    title={pageLabel("notes")}
                  >
                    {role === "reviewer" ? t("도착한 메모를 확인하고, 검토를 마친 기록을 전달하세요.") : t("내가 남긴 기록과 담당자의 검토 결과를 확인하세요.")}
                  </Heading>
                  {role === "reviewer" && <div className="cb-review-summary" aria-label={t("검토 진행 상황")}>
                    {([['pending', t("검토 대기"), 'notes'], ['held', t("보류 중"), 'history'], ['confirmed', t("검토 완료"), 'publications']] as const).map(([status, label, icon]) =>
                      <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}><WorkspaceIcon name={icon} /><span>{label}</span><strong>{counts[status]}</strong></button>
                    )}
                  </div>}
                  <section className="cb-card">
                    <div className="cb-toolbar">
                      <div className="cb-tabs">
                        {["all", "pending", "held", "confirmed"].map((f) => (
                          <button
                            key={f}
                            className={filter === f ? "active" : ""}
                            onClick={() => setFilter(f)}
                          >
                            {f === "all"
                              ? t("전체")
                              : t(statusNames[f as keyof typeof statusNames])}{" "}
                            <span>
                              {f === "all"
                                ? notes.length
                                : counts[f as keyof typeof counts]}
                            </span>
                          </button>
                        ))}
                      </div>
                      <input
                        aria-label={t("메모 검색")}
                        className="cb-search"
                        placeholder={t("대상자, 작성자, 메모 검색")}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    {noteTable(
                      notes.filter(
                        (n) =>
                          (filter === "all" || n.status === filter) &&
                          `${subjectLabel(n.subjectId)} ${n.authorName} ${n.final}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      ),
                    )}
                  </section>
                </>
              )}
              {page === "requests" && (
                <>
                  <Heading
                    eyebrow="JOIN REQUESTS"
                    title={t("함께할 구성원을 확인해요")}
                    action={
                      <span className="cb-count">
                        {t('{count}건 대기',{count:pendingMembers.length})}</span>
                    }
                  >
                    {t("초대코드로 요청한 사용자는 승인 후에 업무를 시작할 수 있어요.")}</Heading>
                  <section className="cb-card">
                    {pendingMembers.length ? (
                      pendingMembers.map((m) => (
                        <div className="cb-member-row" key={m.userId}>
                          <span className="cb-avatar">{m.name[0]}</span>
                          <div className="cb-grow">
                            <h3>{m.name}</h3>
                            <p>
                              {t(roleNames[m.role])}
                              {m.requestedAt &&
                                ` · ${t('요청 시각')} ${stamp(m.requestedAt)}`}
                            </p>
                          </div>
                          <button
                            className="cb-secondary"
                            disabled={busy}
                            onClick={() =>
                              void action(
                                {
                                  type: "membership",
                                  userId: m.userId,
                                  status: "rejected",
                                  requestId: m.requestId,
                                  requestVersion: m.requestVersion,
                                },
                                "거절했습니다. 사용자는 재요청할 수 있습니다.",
                              )
                            }
                          >
                            {t("거절")}</button>
                          <button
                            className="cb-primary"
                            disabled={busy}
                            onClick={() =>
                              void action(
                                {
                                  type: "membership",
                                  userId: m.userId,
                                  status: "active",
                                  requestId: m.requestId,
                                  requestVersion: m.requestVersion,
                                },
                                "참여를 승인했습니다.",
                              )
                            }
                          >
                            {t("참여 승인")}</button>
                        </div>
                      ))
                    ) : (
                      <Empty title={t("대기 중인 요청이 없습니다")}>
                        {t("새로운 참여 요청이 도착하면 표시됩니다.")}</Empty>
                    )}
                  </section>
                </>
              )}
              {page === "members" && (
                <>
                  <Heading
                    eyebrow="PEOPLE"
                    title={t("함께하는 구성원")}
                    action={
                      <button
                        className="cb-secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              data.workspace!.code,
                            );
                            setToast("초대코드를 복사했습니다.");
                          } catch {
                            setError(
                              `복사하지 못했습니다. 초대코드: ${data.workspace!.code}`,
                            );
                          }
                        }}
                      >
                        {t("초대코드")}{data.workspace?.code} ⧉
                      </button>
                    }
                  >
                    {t("참여 권한과 기록 공개 권한은 각각 관리됩니다.")}</Heading>
                  <section className="cb-card">
                    {members
                      .filter((m) => m.status !== "pending")
                      .map((m) => (
                        <div className="cb-member-row" key={m.userId}>
                          <span className="cb-avatar">{m.name[0]}</span>
                          <div className="cb-grow">
                            <h3>{m.name}</h3>
                            <p>
                              {t(roleNames[m.role])}
                              {m.requestedAt &&
                                ` · ${t('요청 시각')} ${stamp(m.requestedAt)}`}
                            </p>
                          </div>
                          <Badge status={m.status} />
                          {m.status === "active" && (
                            <button
                              className="cb-danger-text"
                              onClick={() =>
                                setConfirm({
                                  text: `${m.name} 님을 퇴출하면 기록 열람·전송 권한이 종료됩니다. 이미 제출한 메모는 유지됩니다.`,
                                  command: {
                                    type: "membership",
                                    userId: m.userId,
                                    status: "removed",
                                  },
                                })
                              }
                            >
                              {t("퇴출")}</button>
                          )}
                        </div>
                      ))}
                  </section>
                </>
              )}
              {page === "subjects" && (
                <>
                  <Heading
                    eyebrow="CARE RECIPIENTS"
                    title={t("돌봄 대상")}
                    action={
                      <button
                        className="cb-primary"
                        onClick={() => setSubjectForm(true)}
                      >
                        {t("＋ 대상자 등록")}</button>
                    }
                  >
                    {t("이름으로 찾고, 관리번호로 정확하게 구분하세요.")}</Heading>
                  <input
                    className="cb-search"
                    aria-label={t("대상자 검색")}
                    placeholder={t("이름 또는 관리번호 검색")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="cb-subject-grid">
                    {subjects
                      .filter((s) => `${s.name} ${s.number}`.includes(query))
                      .map((s) => (
                        <article className="cb-card cb-subject" key={s.id}>
                          <span className="cb-subject-avatar">{s.name[0]}</span>
                          <span className="cb-subject-number">
                            #{String(s.number).padStart(3, "0")}
                          </span>
                          <h2>{s.name}</h2>
                          <p>{s.memo || t("등록된 메모가 없습니다.")}</p>
                          <small>{t("수신자는 공개할 때 직접 선택합니다")}</small>
                        </article>
                      ))}
                  </div>
                </>
              )}
              {page === "publications" && (
                <>
                  <Heading
                    eyebrow={
                      role === "reader" ? "SHARED WITH YOU" : "PUBLICATION DESK"
                    }
                    title={
                      role === "reader"
                        ? t("나에게 전달된 기록")
                        : t("확인하고, 필요한 사람에게")
                    }
                  >
                    {role === "reader"
                      ? t("담당자가 확인하고 나에게 공개한 내용만 모았습니다.")
                      : t("확정된 기록의 공개 내용과 수신자를 직접 결정하세요.")}
                  </Heading>
                  {role === "reviewer" && (
                    <section className="cb-card cb-unpublished">
                      <div className="cb-section-title">
                        <h2>{t("공개 준비")}</h2>
                        <small>{t("확정과 공개는 별도 단계입니다")}</small>
                      </div>
                      {notes
                        .filter(
                          (n) =>
                            n.status === "confirmed" &&
                            !pubs.some(
                              (p) =>
                                p.submissionId === n.id &&
                                p.state === "published",
                            ),
                        )
                        .map((n) => (
                          <div className="cb-member-row" key={n.id}>
                            <span className="cb-stat-icon">✓</span>
                            <div className="cb-grow">
                              <h3>{subjectLabel(n.subjectId)}</h3>
                              <p>{(n.review || n.final).slice(0, 90)}</p>
                            </div>
                            <button
                              className="cb-primary"
                              onClick={() => openPublish(n)}
                            >
                              {t("내용·수신자 선택")}</button>
                          </div>
                        ))}
                      {!notes.some(
                        (n) =>
                          n.status === "confirmed" &&
                          !pubs.some(
                            (p) =>
                              p.submissionId === n.id &&
                              p.state === "published",
                          ),
                      ) && (
                        <p className="cb-padding cb-muted">
                          {t("공개 준비 중인 확정 기록이 없습니다.")}</p>
                      )}
                    </section>
                  )}
                  <div className="cb-publication-grid">
                    {pubs.map((p) => (
                      <article className="cb-card cb-publication" key={p.id}>
                        <div className="cb-publication-head">
                          <Badge status={p.state} />
                          <div className="cb-publication-times">
                            <small>{t("기록 시각")}{" "}{stamp(p.recordedAt ?? '')}</small>
                            <small>{t("공개 시각")}{" "}{stamp(p.publishedAt)}</small>
                          </div>
                        </div>
                        <h2>
                          {p.subjectName}
                          <span>
                            #{String(p.subjectNumber).padStart(3, "0")}
                          </span>
                        </h2>
                        <p className="cb-publication-excerpt">{p.content}</p>
                        {role === "reader" ? (
                          <button
                            className="cb-text"
                            onClick={() => setReaderId(p.id)}
                          >
                            {t("전달 내용 읽기 →")}</button>
                        ) : (
                          <>
                            <div className="cb-recipient-list">
                              {t("수신자")}{" "}
                              {p.recipients
                                .map(
                                  (id) =>
                                    members.find((m) => m.userId === id)
                                      ?.name || id,
                                )
                                .join(", ") || t("없음")}
                            </div>
                            {p.state !== 'published' && !pubs.some(other=>other.submissionId===p.submissionId && other.state==='published') && notes.some(n=>n.id===p.submissionId && n.status==='confirmed') && (
                              <button className="cb-secondary" disabled={busy} onClick={()=>openPublish(notes.find(n=>n.id===p.submissionId)!,p)}>
                                {t("공개 내용·수신자 수정")}</button>
                            )}
                            {p.state === "published" && (
                              <div className="cb-actions">
                                <button
                                  className="cb-secondary"
                                  disabled={busy}
                                  onClick={async () => {
                                    if (
                                      await action(
                                        {
                                          type: "revoke",
                                          id: p.id,
                                          version: p.version,
                                        },
                                        "기존 공개를 차단했습니다. 정정 후 별도로 공개해 주세요.",
                                      )
                                    ) {
                                      const snapshot=refreshedData.current;
                                      const saved=snapshot?.publications.find(item=>item.id===p.id && item.state!=="published");
                                      const n = snapshot?.submissions.find(
                                        (n) => n.id === p.submissionId,
                                      );
                                      if (n && saved) openPublish(n,saved,snapshot);
                                      else setError('차단 후 상태를 확인하지 못했습니다. 공개 기록을 다시 불러온 뒤 수정해 주세요.');
                                    }
                                  }}
                                >
                                  {t("차단 후 내용·수신자 정정")}</button>
                                <button
                                  className="cb-danger-text"
                                  onClick={() =>
                                    setConfirm({
                                      text: "공개를 철회하면 모든 수신자의 열린 화면에서도 내용이 숨겨집니다.",
                                      command: {
                                        type: "revoke",
                                        id: p.id,
                                        version: p.version,
                                      },
                                    })
                                  }
                                >
                                  {t("철회")}</button>
                              </div>
                            )}
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                  {!pubs.length && (
                    <section className="cb-card">
                      <Empty title={t("아직 전달된 기록이 없습니다")}>
                        {t("담당자가 내용을 공개하면 여기에서 확인할 수 있어요.")}</Empty>
                    </section>
                  )}
                </>
              )}
              {page === "history" && (
                <>
                  <Heading eyebrow="ACTIVITY LOG" title={t("검토 이력")}>
                    {t("메모 검토, 기록 공개, 참여 승인 등 작업 그룹의 처리 내역을 확인하세요.")}</Heading>
                  <section className="cb-card">
                    {data.audit.length ? (
                      data.audit.map((a) => (
                        <div className="cb-audit-row" key={a.id}>
                          <span className="cb-audit-dot" />
                          <div className="cb-grow">
                            <h3>{t(a.text)}</h3>
                            <p>{t("처리자:")}{" "}{a.actor}</p>
                            {a.details && (
                              <details>
                                <summary>{t("상세 내용")}</summary>
                                <pre>{a.details.startsWith('사유: ') ? <>{t('사유:')}{' '}{a.details.slice(4)}</> : a.details}</pre>
                              </details>
                            )}
                          </div>
                          <time>{stamp(a.at)}</time>
                        </div>
                      ))
                    ) : (
                      <Empty title={t("새로운 활동을 기다리고 있어요")}>
                        {t("검토·참여 승인·공개 등의 활동이 기록됩니다.")}</Empty>
                    )}
                  </section>
                </>
              )}
              {page === "settings" && (
                <>
                  <Heading eyebrow="ACCOUNT & WORKSPACE" title={t("설정")}>
                    {t("내 계정과 작업 그룹 정보를 확인하세요.")}</Heading>
                  <section className="cb-card cb-form-card cb-settings">
                    <h2>{t("계정 정보")}</h2>
                    <dl>
                      <dt>{t("이름")}</dt>
                      <dd>{user.name}</dd>
                      <dt>{user.admin ? t("현재 역할") : t("가입 역할")}</dt>
                      <dd>
                        {t(roleNames[role])}
                      </dd>
                      <dt>{t("작업 그룹")}</dt>
                      <dd>{data.workspace?.name}</dd>
                    </dl>
                    {user.admin ? <label>
                      {t("사용 역할")}<select aria-label={t("사용 역할")} value={role} disabled={busy} onChange={e => void selectRole(e.target.value as Role)}>
                        {Object.entries(roleNames).map(([r, n], i) => <option key={r} value={r}>{t('{count}그룹 · {role}',{count:i+1,role:t(n)})}</option>)}
                      </select>
                    </label> : <p className="cb-muted">
                      {t("역할은 회원가입 시 고정됩니다.")}</p>}
                    {role === "reviewer" && !user.admin && (
                      <>
                        <hr />
                        <h2>{t("관리 권한 이전")}</h2>
                        <p>
                          {t("새 담당자에게 구성원과 기록 관리 권한을 넘깁니다. 완료하면 현재 담당자의 권한이 종료됩니다.")}</p>
                        {isMock && (
                          <div className="cb-notice">
                            {t("로컬 QA에서는 즉시 이전을 시뮬레이션합니다. 실제 초대·수락 방식은 백엔드와 협의할 예정입니다.")}</div>
                        )}
                        <p className="cb-muted">{t("내 사용자 ID:")}{" "}{user.id}</p>
                        <label>
                          {t("새 2그룹 담당자")}{!isMock ? <input value={transfer} onChange={e=>setTransfer(e.target.value)} placeholder={t("이전받을 담당자의 사용자 ID")} /> : <select
                            value={transfer}
                            onChange={(e) => setTransfer(e.target.value)}
                          >
                            <option value="">{t("담당자를 선택하세요")}</option>
                            {data.transferCandidates.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>}
                        </label>
                        <button
                          className="cb-secondary"
                          disabled={!transfer || busy || (!isMock && !!user.admin)}
                          onClick={() =>
                            setConfirm({
                              text: "관리 권한을 이전하면 현재 담당자는 이 그룹을 관리할 수 없습니다. 이전하시겠어요?",
                              command: { type: "transfer", userId: transfer },
                            })
                          }
                        >
                          {t("관리 권한 이전")}</button>
                        {(data.transfers ?? []).filter(transferItem=>!transferItem.incoming).map(transferItem=>(
                          <div className="cb-notice" key={transferItem.id}>
                            {transferItem.targetName} · {transferItem.status === "pending" ? t("수락 대기") : transferItem.status === "completed" ? t("이전 완료") : t("취소됨")}
                            {transferItem.status==="pending" && <button className="cb-text" disabled={busy} onClick={()=>setConfirm({text:"이전 요청을 취소할까요?",command:{type:"cancelTransfer",workspaceId:transferItem.workspaceId,id:transferItem.id,version:transferItem.version}})}>{t("요청 취소")}</button>}
                          </div>
                        ))}
                      </>
                    )}
                    {isMock && user.admin && (
                      <>
                        <hr />
                        <h2>{t("로컬 QA 데이터")}</h2>
                        <p>
                          {t("이 브라우저의 합성 데이터를 초기 시나리오로 되돌립니다.")}</p>
                        <button
                          className="cb-secondary"
                          onClick={() => {
                            (gateway as MockGateway).reset();
                            setToast("합성 데이터를 초기화했습니다.");
                          }}
                        >
                          {t("합성 데이터 초기화")}</button>
                      </>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </main>
        <footer className="cb-footer">
          CareBridge <span>{t("함께 만드는, 더 나은 돌봄 기록")}</span>
        </footer>
      </div>
      {regenerate && (
        <Modal
          title={t("초안을 다시 생성할까요?")}
          close={() => setRegenerate(false)}
        >
          <p>
            {t("다시 생성하면 현재 초안과 직접 수정한 내용이 새 결과로 바뀝니다. 취소하면 작성한 내용이 유지됩니다.")}</p>
          <div className="cb-modal-actions">
            <button
              className="cb-secondary"
              onClick={() => setRegenerate(false)}
            >
              {t("취소")}</button>
            <button className="cb-primary" onClick={() => void generate()}>
              {t("새 초안 생성")}</button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="cb-toast" role="status">
          ✓ {t(toast)}
        </div>
      )}
      {note && active && (
        <Modal
          title={role === "reviewer" ? t("메모 검토") : t("내 메모 상세")}
          close={navigation.back}
        >
          <button className="cb-text cb-back" onClick={navigation.back}>{t("← 목록으로")}</button>
          {reviewConflict && <div className="cb-notice" role="alert">{t("다른 작업에서 이 기록이 변경되었습니다. 작성 중인 내용은 유지했으며 저장·확정은 중단했습니다. 최신 내용을 확인하려면 입력 내용을 따로 보관한 뒤 닫고 다시 열어 주세요.")}</div>}
          <div className="cb-detail-heading">
            <div>
              <h3>{subjectLabel(note.subjectId)}</h3>
              <p>
                {note.authorName} · {stamp(note.createdAt)}
              </p>
            </div>
            <Badge status={note.status} />
          </div>
          <div className="cb-comparison">
            <section>
              <h3>{t("원문 메모")}</h3>
              <pre>{note.source}</pre>
              <small>{t("제출 당시 원문 · 변경되지 않습니다")}</small>
            </section>
            <section>
              <h3>{t("작성자가 확인한 초안")}</h3>
              <pre>{note.final}</pre>
              <details>
                <summary>{t("최초 생성 결과")}</summary>
                <pre>{note.generated}</pre>
              </details>
            </section>
          </div>
          {note.reason && (
            <div className="cb-notice">
              <b>{t("검토 사유")}</b>
              <p>{note.reason}</p>
            </div>
          )}
          {!isMock && (note.warnings ?? []).length > 0 && <div className="cb-notice">
            <b>{t("저장된 검사 확인사항")}</b>
            {note.warnings!.map((warning,i)=><p key={i}>{warning}</p>)}
          </div>}
          {role === "reviewer" && (note.status !== "confirmed" || reviewConflict) ? (
            <>
              {!isMock && <div className="cb-notice">
                <label><input type="checkbox" checked={sourceChecked} onChange={e=>setSourceChecked(e.target.checked)} /> {t("원문을 대조했습니다.")}</label>
                <label><input type="checkbox" checked={checksChecked} onChange={e=>setChecksChecked(e.target.checked)} /> {t("확인사항과 경고를 확인했습니다. 경고가 있어도 확정할 수 있습니다.")}</label>
                {t("최종 내용을 검사한 뒤 확인사항을 검토해 주세요. 수정 후에는 다시 검사해야 합니다.")}</div>}
              <label>
                {t("검토 내용")}<textarea
                  rows={5}
                  value={review}
                  onChange={(e) => {setReview(e.target.value);setReviewCheck(null);setChecksChecked(false);}}
                />
              </label>
              <label>
                {t("검토·보류 사유")}<textarea
                  rows={2}
                  placeholder={t("보류할 때는 사유를 반드시 남겨 주세요.")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {!isMock && <>
                <button className="cb-secondary" disabled={busy || !review.trim()} onClick={()=>void checkFinal()}>{t("최종 내용 저장 · AI 검사")}</button>
                {reviewCheck && <div className="cb-notice"><b>{reviewCheck.status==="hold"?t("확인이 필요한 검사 결과입니다"):t("최종 내용 검사를 마쳤습니다")}</b>{reviewCheck.warnings.length?reviewCheck.warnings.map((w,i)=><p key={i}>{w}</p>):<p>{t("추가 경고가 없습니다. 원문과 내용을 직접 확인해 주세요.")}</p>}</div>}
              </>}
              <div className="cb-modal-actions">
                {(["held", "pending", "confirmed"] as const).map((s) => (
                  <button
                    key={s}
                    className={
                      s === "confirmed" ? "cb-primary" : "cb-secondary"
                    }
                    disabled={busy || reviewConflict || !review.trim() || (!isMock && s === "confirmed" && (!sourceChecked || !checksChecked || reviewCheck?.content!==review || reviewCheck?.version!==reviewVersion))}
                    onClick={() =>
                      void action(
                        {
                          type: "review",
                          id: note.id,
                          version: reviewVersion,
                          content: review,
                          reason,
                          status: s,
                        },
                        s === "confirmed"
                          ? "기록을 확정했습니다. 공개는 별도로 진행해 주세요."
                          : "검토 내용을 저장했습니다.",
                      ).then((ok) => {
                        if (ok) setSelected(null);
                      })
                    }
                  >
                    {s === "held"
                      ? t("보류")
                      : s === "pending"
                        ? t("수정 저장")
                        : t("검토 완료 · 확정")}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {note.review && (
                <section className="cb-approved-content">
                  <h3>{t("담당자 검토 내용")}</h3>
                  <pre>{note.review}</pre>
                </section>
              )}
              <div className="cb-modal-actions">
                {role === "author" ? (
                  <button className="cb-primary" onClick={() => edit(note)}>
                    {note.status === "held"
                      ? t("보완 후 재검토 요청")
                      : t("수정해서 새로 제출")}
                  </button>
                ) : (
                  <button
                    className="cb-primary"
                    onClick={() =>
                      pubs.some(
                        (p) =>
                          p.submissionId === note.id && p.state === "published",
                      )
                        ? navigate("publications")
                        : openPublish(note)
                    }
                  >
                    {pubs.some(
                      (p) =>
                        p.submissionId === note.id && p.state === "published",
                    )
                      ? t("공개 기록 관리")
                      : t("공개 내용·수신자 선택")}
                  </button>
                )}
              </div>
            </>
          )}
          <details className="cb-history-details">
            <summary>
              {t("이 메모의 제출 이력 (")}{notes.filter((n) => n.threadId === note.threadId).length})
            </summary>
            {notes
              .filter((n) => n.threadId === note.threadId)
              .map((n) => (
                <button
                  className="cb-history-item"
                  key={n.id}
                  onClick={() => openNote(n)}
                >
                  {stamp(n.createdAt)} <Badge status={n.status} />
                </button>
              ))}
          </details>
          {error && (
            <div className="cb-error" role="alert">
              {<ErrorMessage message={error} />}
            </div>
          )}
        </Modal>
      )}
      {publishId && active && role === "reviewer" && (
        <Modal
          title={preview ? t("공개 전 마지막 확인") : t("공개 내용과 수신자 선택")}
          close={navigation.closePublication}
        >
          {publishConflict && <div className="cb-notice" role="alert">{t("공개할 기록이 다른 작업에서 변경되었습니다. 입력 내용은 유지됩니다. 최신 기록을 확인한 뒤 공개해 주세요.")}</div>}
          {invalidRecipients && <div className="cb-notice" role="alert">{t("선택한 수신자의 참여 상태가 변경되었습니다. 수신자 선택으로 돌아가 전체 선택을 다시 확인해 주세요.")}</div>}
          {preview ? (
            <>
              <div className="cb-approved-content">
                <pre>{publishContent}</pre>
              </div>
              <p>
                {t("수신자:")}{" "}
                <b>
                  {members
                    .filter((m) => recipients.includes(m.userId))
                    .map((m) => m.name)
                    .join(", ")}
                </b>
              </p>
              <div className="cb-notice">
                {t("공개 버튼을 눌러야 선택한 수신자가 열람할 수 있습니다.")}</div>
              <div className="cb-modal-actions">
                <button
                  className="cb-secondary"
                  onClick={navigation.back}
                >
                  {t("이전")}</button>
                <button
                  className="cb-primary"
                  disabled={busy || publishConflict || invalidRecipients || !recipients.length || !publishContent.trim()}
                  onClick={async () => {
                    if (
                      await action(
                        {
                          type: "publish",
                          submissionId: publishId,
                          version: publishVersion,
                          content: publishContent,
                          recipients,
                          ...(existingPublication ? {publicationId:existingPublication.id,publicationVersion:existingPublication.version} : {}),
                        },
                        "선택한 수신자에게 공개했습니다.",
                      )
                    )
                      setPublishId(null);
                  }}
                >
                  {t("선택한 수신자에게 공개")}</button>
              </div>
            </>
          ) : (
            <>
              <label>
                {t("공개할 내용")}<textarea
                  rows={8}
                  value={publishContent}
                  onChange={(e) => setPublishContent(e.target.value)}
                />
              </label>
              <h3>{t("수신자 직접 선택")}</h3>
              <label className="cb-check-row cb-select-all">
                <input type="checkbox" aria-label={t("수신자 전체 선택")}
                  ref={node=>{if(node)node.indeterminate=selectedRecipientCount>0 && !allRecipientsSelected;}}
                  checked={allRecipientsSelected} disabled={!eligibleRecipients.length && !recipients.length}
                  onChange={e=>setRecipients(e.target.checked ? eligibleRecipients.map(m=>m.userId) : [])} />
                <span>{t("전체 선택")}</span><small>{t('{selected} / {total}명 선택',{selected:selectedRecipientCount,total:eligibleRecipients.length})}</small>
              </label>
              {!eligibleRecipients.length && <p className="cb-muted">{t("선택할 수 있는 참여 중인 열람자가 없습니다.")}</p>}
              {excludedPreviousRecipients && <p className="cb-muted">{t("이전 수신자 중 현재 참여하지 않는 열람자는 선택에서 제외했습니다.")}</p>}
              {eligibleRecipients.map((m) => (
                  <label className="cb-check-row" key={m.userId}>
                    <input
                      type="checkbox"
                      checked={recipients.includes(m.userId)}
                      onChange={(e) =>
                        setRecipients((old) =>
                          e.target.checked
                            ? [...old, m.userId]
                            : old.filter((id) => id !== m.userId),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
              <div className="cb-modal-actions">
                <button
                  className="cb-primary"
                  disabled={busy || publishConflict || invalidRecipients || !publishContent.trim() || !recipients.length}
                  onClick={() => setPreview(true)}
                >
                  {t("공개 내용 미리보기 →")}</button>
              </div>
            </>
          )}
          {error && (
            <div className="cb-error" role="alert">
              {<ErrorMessage message={error} />}
            </div>
          )}
        </Modal>
      )}
      {readerId && (
        <Modal
          title={
            publication
              ? `${publication.subjectName} · #${String(publication.subjectNumber).padStart(3, "0")}`
              : t("열람할 수 없는 기록")
          }
          close={navigation.back}
        >
          <button className="cb-text cb-back" onClick={navigation.back}>{t("← 목록으로")}</button>
          {publication && active && !offline ? (
            <>
              <span className="cb-lock-label">
                {t("✓ 담당자가 확인하고 공개한 기록")}</span>
              <div className="cb-reader-content">
                <pre>{publication.content}</pre>
              </div>
              <div className="cb-publication-times cb-muted">
                <small>{t("기록 시각")}{" "}{stamp(publication.recordedAt ?? '')}</small>
                <small>{t("공개 시각")}{" "}{stamp(publication.publishedAt)}</small>
              </div>
            </>
          ) : (
            <Empty title={t("기록 표시가 중단되었습니다")}>
              {t("공개 범위 또는 참여 권한이 변경되었거나 연결을 확인하고 있습니다.")}</Empty>
          )}
        </Modal>
      )}
      {subjectForm && role === "reviewer" && active && (
        <Modal title={t("돌봄 대상 등록")} close={navigation.back}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(
                  { type: "subject", name: subjectName, memo: subjectMemo },
                  "돌봄 대상을 등록했습니다.",
                )
              ) {
                setSubjectForm(false);
                setSubjectName("");
                setSubjectMemo("");
              }
            }}
          >
            <label>
              {t("이름")}<input
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                required
                maxLength={80}
              />
            </label>
            <label>
              {t("메모")}<small>{t("선택")}</small>
              <textarea
                rows={3}
                value={subjectMemo}
                onChange={(e) => setSubjectMemo(e.target.value)}
              />
            </label>
            <p className="cb-muted">
              {t("관리번호는 등록 순서로 자동 부여됩니다. 동명이인도 등록할 수 있어요.")}</p>
            <button className="cb-primary" disabled={busy}>
              {t("등록하기")}</button>
            {error && <p className="cb-error">{<ErrorMessage message={error} />}</p>}
          </form>
        </Modal>
      )}
      {discardDecision && <Modal title={t("작성 중인 변경 내용을 버릴까요?")} close={()=>settleDiscard(false)}>
        <p>{t("저장하지 않은 수정 내용이 사라집니다.")}</p>
        {publishId && <p>{t("이미 차단한 공개 기록은 차단 상태로 유지됩니다.")}</p>}
        <div className="cb-modal-actions">
          <button className="cb-secondary" onClick={()=>settleDiscard(false)}>{t("계속 작성")}</button>
          <button className="cb-primary" onClick={()=>settleDiscard(true)}>{t("변경 내용 버리고 이동")}</button>
        </div>
      </Modal>}
      {confirm && (
        <Modal title={t("작업을 확인해 주세요")} close={() => setConfirm(null)}>
          <p>{t(confirm.text)}</p>
          <div className="cb-modal-actions">
            <button className="cb-secondary" onClick={() => setConfirm(null)}>
              {t("취소")}</button>
            <button
              className="cb-primary"
              disabled={busy}
              onClick={async () => {
                if (await action(confirm.command, "처리했습니다."))
                  setConfirm(null);
              }}
            >
              {t("확인하고 진행")}</button>
          </div>
          {error && <p className="cb-error">{<ErrorMessage message={error} />}</p>}
        </Modal>
      )}
    </div>
  );
}

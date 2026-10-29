import type { Command, Gateway, GenerationResult, ReviewCheck, Role, Session, Snapshot, Transfer, User } from "./model";
import { MockGateway } from "./mock";
import { subscribeWorkspace } from "./realtime";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { confirmationRequired?: boolean; savedVersion?: number };
  constructor(message: string, status = 0, code = "", details?: { confirmationRequired?: boolean; savedVersion?: number }) { super(message); this.status=status; this.code=code; this.details=details; }
}
type ApiUser = { userId: string; name: string; role: string; workspaceRole?: string; isTestAdmin?: boolean; qaRole?: string };
export type WorkspaceRow = { workspaceId: string; name: string; status: string; role: string; request?: JoinRequest; transfers?: ApiTransfer[] };
type JoinRequest = { requestId: string; userId: string; name: string; role: string; status: string; version: number; requestedAt: string };
type ApiTransfer = { transferId: string; targetUserId: string; targetNameAtRequest?: string; targetCurrentName?: string; status: string; version: number };
type ApiSubject = { subjectId: string; name: string; managementNumber: number; memo?: string };
type ApiQa = { issues?: { message: string }[] };
type ApiSubmission = {
  submissionId: string; threadId: string; parentSubmissionId?: string; authorId: string;
  authorNameAtSubmission?: string; authorCurrentName?: string; subject: ApiSubject;
  memo: string; authorDraft: string; generationId: string;
  generatedDraft: { translation: { text: string }; source: { language: string }; qa?: ApiQa };
  reviewContent?: string; reviews: { reason: string; at: string }[];
  status: "review_pending" | "held" | "confirmed"; version: number; submittedAt: string;
  finalQa?: { qa: { qa: ApiQa } };
};
type ApiPublication = { publicationId: string; submissionId?: string; subject: ApiSubject; content: string; recipientIds?: string[]; status?: "published" | "revoked" | "unpublished" | "blocked"; publishedAt?: string; version: number };
type AuditPage = { items: { eventId: string; action: string; at: string; actorNameAtEvent?: string; actorCurrentName?: string; actorId: string; reason?: string }[]; nextCursor: string | null };
const encode = encodeURIComponent;
const serverRole = (role: Role) => role === "reader" ? "viewer" : role;
function roleOf(role?: string): Role {
  if (role === "viewer") return "reader";
  if (role === "author" || role === "reviewer") return role;
  throw new ApiError("가입 역할이 연결되지 않은 계정입니다. 담당자에게 역할 배정을 문의해 주세요.", 403, "ROLE_ASSIGNMENT_REQUIRED");
}
function userOf(u: ApiUser): User {
  return { id: u.userId, name: u.name, role: roleOf(u.isTestAdmin ? u.qaRole : u.workspaceRole), admin: u.isTestAdmin === true };
}
const empty = (): Snapshot => ({ workspace: null, membership: null, members: [], subjects: [], submissions: [], publications: [], audit: [], revision: 0, transferCandidates: [], transfers: [] });
function transferOf(t: ApiTransfer, w: WorkspaceRow, incoming: boolean): Transfer {
  return { id: t.transferId, workspaceId: w.workspaceId, workspaceName: w.name, targetId: t.targetUserId, targetName: t.targetNameAtRequest || t.targetCurrentName || t.targetUserId, status: t.status, version: t.version, incoming };
}

/** AI requests use the authenticated workspace backend; service keys never enter the browser. */
export class HttpGateway implements Gateway {
  mode = "api" as const;
  private base: string;
  private snapshots = new Map<string, Snapshot>();
  private proofs = new Map<string, string>();
  constructor(base: string) { this.base = base.replace(/\/$/, ""); }
  async request<T>(path: string, body?: unknown, session?: Session, signal?: AbortSignal, method = body === undefined ? "GET" : "POST"): Promise<T> {
    if (!this.base) throw new ApiError("새 API 연결을 준비 중입니다. 서비스 주소를 설정해 주세요.");
    const response = await fetch(this.base + path, {
      method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(error.error || error.message || `요청 실패 (${response.status})`, response.status, error.code, error.details);
    }
    return response.status === 204 ? undefined as T : response.json();
  }
  async login(id: string, password: string): Promise<Session> {
    const result = await this.request<{accessToken: string; user: ApiUser}>("/auth/login", id.trim() === "admin" ? {loginId: "admin", password} : {email: id.trim(), password});
    return {token: result.accessToken, user: userOf(result.user)};
  }
  async register(name: string, id: string, password: string, role: Role): Promise<Session> {
    const result = await this.request<{confirmationRequired?: boolean}>("/workspace-auth/register", {name, email: id.trim(), password, role: serverRole(role)});
    if (result.confirmationRequired) throw new ApiError("이메일로 받은 인증코드를 입력해 주세요.", 0, "EMAIL_NOT_VERIFIED");
    return this.login(id, password);
  }
  async confirmEmail(email: string, code: string) { await this.request("/auth/confirm", {email: email.trim(), code}); }
  async resendConfirmation(email: string) { await this.request("/auth/resend-confirmation", {email: email.trim()}); }
  async logout(session: Session) {
    this.snapshots.delete(session.token); this.proofs.delete(session.token);
    await this.request("/auth/logout", {}, session);
  }
  async selectRole(session: Session, role: Role): Promise<Session> {
    await this.request("/auth/test-role", {role: serverRole(role)}, session);
    const user = userOf(await this.request<ApiUser>("/me", undefined, session));
    this.snapshots.delete(session.token); this.proofs.delete(session.token);
    return {...session, user};
  }
  async snapshot(session: Session, role: Role): Promise<Snapshot> {
    const rows = await this.request<WorkspaceRow[]>("/workspaces", undefined, session);
    const data = empty();
    data.transfers = rows.flatMap(w => (w.transfers ?? []).map(t => transferOf(t,w,true)));
    const active = rows.find(w => w.status === "active");
    if (!active) {
      const last = rows.find(w => w.status === "pending") ?? rows.at(-1);
      if (last && ["pending", "rejected", "removed"].includes(last.status)) data.membership = {userId:session.user.id, name:session.user.name, role, status: last.status as "pending" | "rejected" | "removed"};
      this.snapshots.set(session.token, data);
      return data;
    }
    // Active records are only loaded after the event channel proves current access.
    if (this.proofs.get(session.token) !== active.workspaceId) return data;
    const path = `/workspaces/${encode(active.workspaceId)}`;
    const w = await this.request<{workspaceId:string;name:string;inviteCode?:string;ownerReviewerId:string;revision:number;role:string}>(path, undefined, session);
    if (roleOf(w.role) !== role) throw new ApiError("서버 역할이 변경되었습니다. 다시 로그인해 주세요.",403,"ROLE_CHANGED");
    data.workspace = {id:w.workspaceId,name:w.name,code:w.inviteCode ?? "",ownerId:w.ownerReviewerId};
    data.revision=w.revision;
    data.membership={userId:session.user.id,name:session.user.name,role,status:"active"};
    if(role !== "reader") {
      const subjects=await this.request<ApiSubject[]>(path+"/subjects",undefined,session);
      data.subjects=subjects.map(s=>({id:s.subjectId,name:s.name,number:s.managementNumber,memo:s.memo ?? ""}));
      const list=await this.request<{submissionId:string}[]>(path+"/submissions",undefined,session);
      // Current backend bounds the aggregate; each detail remains server-authorized.
      for(const row of list) {
        const s=await this.request<ApiSubmission>(path+"/submissions/"+encode(row.submissionId),undefined,session);
        data.submissions.push({id:s.submissionId,threadId:s.threadId,previousId:s.parentSubmissionId || undefined,
          authorId:s.authorId,authorName:s.authorNameAtSubmission || s.authorCurrentName || s.authorId,
          subjectId:s.subject.subjectId,source:s.memo,language:s.generatedDraft.source.language,generated:s.generatedDraft.translation.text,
          final:s.authorDraft,review:s.reviewContent ?? "",reason:s.reviews.at(-1)?.reason ?? "",
          status:s.status==="review_pending"?"pending":s.status,createdAt:s.submittedAt,reviewedAt:s.reviews.at(-1)?.at,version:s.version,
          generationId:s.generationId,warnings:(s.finalQa?.qa.qa ?? s.generatedDraft.qa)?.issues?.map(i=>i.message) ?? []});
      }
    }
    if(role !== "author") {
      const list=await this.request<ApiPublication[]>(path+"/publications",undefined,session);
      data.publications=list.map(p=>({id:p.publicationId,submissionId:p.submissionId ?? "",subjectName:p.subject.name,subjectNumber:p.subject.managementNumber,
        content:p.content,recipients:role==="reader"?[]:p.recipientIds ?? [],state:role==="reader"?"published":p.status ?? "unpublished",publishedAt:p.publishedAt ?? "",version:p.version}));
    }
    if(role==="reviewer") {
      const members=await this.request<{userId:string;name:string;role:string;status:"active"}[]>(path+"/members",undefined,session);
      data.members=members.map(m=>({...m,role:roleOf(m.role)}));
      const requests=await this.request<JoinRequest[]>(path+"/join-requests",undefined,session);
      data.members.push(...requests.filter(r=>r.status==="pending").map(r=>({userId:r.userId,name:r.name,role:roleOf(r.role),status:"pending" as const,requestId:r.requestId,requestVersion:r.version,requestedAt:r.requestedAt})));
      let cursor: string | null=null;
      const seen=new Set<string>();
      do {
        const page: AuditPage=await this.request<AuditPage>(path+"/audit?limit=50"+(cursor?"&cursor="+encode(cursor):""),undefined,session);
        data.audit.push(...page.items.map(a=>({id:a.eventId,text:a.action,actor:a.actorNameAtEvent || a.actorCurrentName || a.actorId,at:a.at,details:a.reason || undefined})));
        cursor=page.nextCursor;
        if(cursor && seen.has(cursor)) throw new ApiError("이력 페이지 응답을 확인할 수 없습니다.");
        if(cursor) seen.add(cursor);
      } while(cursor);
      const transfers=await this.request<ApiTransfer[]>(path+"/transfers",undefined,session);
      data.transfers!.push(...transfers.map(t=>transferOf(t,active,false)));
    }
    this.snapshots.set(session.token,data);
    return data;
  }
  async execute(session: Session, _role: Role, c: Command): Promise<void> {
    if(c.type==="createWorkspace") { await this.request("/workspaces",{name:c.name},session); return; }
    if(c.type==="join") {await this.request("/workspaces/join-requests",{code:c.code},session);return;}
    if(c.type==="acceptTransfer" || c.type==="cancelTransfer") {
      await this.request(`/workspaces/${encode(c.workspaceId)}/transfers/${encode(c.id)}/${c.type==="acceptTransfer"?"accept":"cancel"}`,{expectedVersion:c.version},session);return;
    }
    const data=this.snapshots.get(session.token);
    if(!data?.workspace) throw new ApiError("작업 그룹을 다시 조회해 주세요.");
    const path="/workspaces/"+encode(data.workspace.id);
    switch(c.type) {
      case "membership": {
        if(c.status==="removed") { await this.request(path+"/members/"+encode(c.userId),{expectedVersion:data.revision},session,undefined,"DELETE");break; }
        const member=data.members.find(m=>m.userId===c.userId && m.status==="pending");
        const requestId=c.requestId ?? member?.requestId, version=c.requestVersion ?? member?.requestVersion;
        if(!requestId || !version) throw new ApiError("참여 요청을 다시 조회해 주세요.");
        await this.request(path+"/join-requests/"+encode(requestId)+(c.status==="active"?"/approve":"/reject"),{expectedVersion:version},session);break;
      }
      case "subject": await this.request(path+"/subjects",{name:c.name,...(c.memo.trim()?{memo:c.memo}:{})},session);break;
      case "submit": {
        const previous=data.submissions.find(s=>s.id===c.previousId);
        const generationId=c.generationId ?? previous?.generationId;
        if(!generationId || (previous && previous.source!==c.source && !c.generationId)) throw new ApiError("현재 원문으로 초안을 다시 생성해 주세요.");
        await this.request(path+"/submissions",{requestId:c.requestId,subjectId:c.subjectId,generationId,memo:c.source,authorDraft:c.final,confirmSource:true,...(c.previousId?{parentSubmissionId:c.previousId}:{})},session);break;
      }
      case "review": await this.request(path+"/submissions/"+encode(c.id)+"/review",{
        expectedVersion:c.version,decision:c.status==="pending"?"edit":c.status==="held"?"hold":"confirm",content:c.content,
        ...(c.reason.trim()?{reason:c.reason}:{}),...(c.status==="confirmed"?{confirmSource:true,confirmChecks:true}:{})
      },session);break;
      case "publish": {
        // Recover prepared records from the server after a lost response or refresh.
        const records=await this.request<ApiPublication[]>(path+"/publications",undefined,session);
        const published=records.find(p=>p.submissionId===c.submissionId && p.status==="published");
        if (!c.publicationId && published) {
          if (published.content===c.content && JSON.stringify(published.recipientIds)===JSON.stringify(c.recipients)) return;
          throw new ApiError("이미 공개된 기록입니다. 정정 기능을 이용해 주세요.");
        }
        const existing=c.publicationId?records.find(p=>p.publicationId===c.publicationId):
          records.find(p=>p.submissionId===c.submissionId && p.status!=="published");
        if(c.publicationId && !existing) throw new ApiError("공개 기록을 다시 조회해 주세요.");
        let p: ApiPublication;
        if(existing) {
          const unchanged=existing.content===c.content && JSON.stringify(existing.recipientIds)===JSON.stringify(c.recipients);
          if(unchanged && existing.status==="published") return;
          p=unchanged?existing:await this.request<ApiPublication>(path+"/publications/"+encode(existing.publicationId),{
            expectedVersion:c.publicationVersion ?? existing.version,content:c.content,recipientIds:c.recipients
          },session,undefined,"PATCH");
        } else p=await this.request<ApiPublication>(path+"/publications",{submissionId:c.submissionId,expectedVersion:c.version,content:c.content,recipientIds:c.recipients},session);
        await this.request(path+"/publications/"+encode(p.publicationId)+"/publish",{expectedVersion:p.version},session);break;
      }
      case "revoke": await this.request(path+"/publications/"+encode(c.id)+"/revoke",{expectedVersion:c.version},session);break;
      case "transfer": await this.request(path+"/transfers",{expectedVersion:data.revision,targetUserId:c.userId},session);break;
    }
  }
  private aiPath(session: Session, role: Role, expected: Role) {
    const data=this.snapshots.get(session.token);
    if (role!==expected || !data?.workspace || data.membership?.status!=="active" || this.proofs.get(session.token)!==data.workspace.id) throw new ApiError("현재 작업 그룹의 권한을 다시 확인해 주세요.",403,"WORKSPACE_ACCESS_REQUIRED");
    return "/workspaces/"+encode(data.workspace.id);
  }
  async generate(session: Session, role: Role, source: string, language: string): Promise<GenerationResult> {
    const path=this.aiPath(session,role,"author");
    const result=await this.request<{generationId:string;draft:{source:{text:string};translation:{text:string};qa:ApiQa}}>(path+"/drafts",{memo:source,sourceLanguage:language,dataUse:"synthetic_deidentified"},session);
    if (!result.generationId || result.draft?.source?.text!==source || !result.draft.translation?.text?.trim()) throw new ApiError("원문에 연결된 초안 응답을 확인하지 못했습니다.",502,"CAREBRIDGE_BAD_RESPONSE");
    return {text:result.draft.translation.text,source,generationId:result.generationId,warnings:result.draft.qa?.issues?.map(i=>i.message) ?? []};
  }
  async transcribe(session: Session, role: Role, audioBase64: string, language: string) {
    const path=this.aiPath(session,role,"author");
    const result=await this.request<{text:string;requiresTranscriptReview:true}>(path+"/transcriptions",{audioBase64,sourceLanguage:language,dataUse:"synthetic_deidentified"},session);
    if (!result.text?.trim() || result.requiresTranscriptReview!==true) throw new ApiError("음성 인식 결과를 확인하지 못했습니다.",502,"CAREBRIDGE_BAD_RESPONSE");
    return result;
  }
  async checkReview(session: Session, role: Role, id: string, version: number, content: string, reason: string): Promise<ReviewCheck> {
    const path=this.aiPath(session,role,"reviewer")+"/submissions/"+encode(id);
    const saved=await this.request<{version:number}>(path+"/review",{expectedVersion:version,decision:"edit",content,...(reason.trim()?{reason}:{})},session);
    try {
      const result=await this.request<{version:number;qa:{status:string;qa:ApiQa}}>(path+"/check",{expectedVersion:saved.version},session);
      if (result.version!==saved.version || !["hold","review_required"].includes(result.qa?.status) || !Array.isArray(result.qa?.qa?.issues)) throw new ApiError("최종 검사 응답의 버전·형식을 확인하지 못했습니다.",502,"CAREBRIDGE_BAD_RESPONSE");
      return {version:saved.version,content,status:result.qa.status,warnings:result.qa.qa.issues?.map(i=>i.message) ?? []};
    } catch(error) {
      throw new ApiError((error as Error).message,error instanceof ApiError?error.status:0,error instanceof ApiError?error.code:"",{savedVersion:saved.version});
    }
  }
  subscribe(session: Session,onChange:()=>void,onDisconnect:()=>void,onConnected:()=>void) {
    return subscribeWorkspace({
      request: <T>(path:string,body?:unknown,signal?:AbortSignal)=>this.request<T>(path,body,session,signal),
      openStream: (path,signal)=>fetch(this.base+path,{headers:{Authorization:`Bearer ${session.token}`,Accept:"text/event-stream"},cache:"no-store",signal}),
      onChange,onDisconnect,onConnected,
      proof: id=>{if(id)this.proofs.set(session.token,id);else this.proofs.delete(session.token);},
    });
  }
}
export const isMock = import.meta.env.DEV && import.meta.env.MODE === "carebridge";
export const gateway: Gateway = isMock ? new MockGateway() : new HttpGateway(import.meta.env.VITE_CAREBRIDGE_API_URL || "");

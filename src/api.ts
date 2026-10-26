// Backend API client.
import type { CareEvent, EventType, Schedule } from "./data";

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: VerificationInfo;
  constructor(status: number, message: string, code?: string, details?: VerificationInfo) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function qs(query?: Record<string, string | undefined>) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function request<T>(
  path: string,
  opts: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.");
  }
  const raw = await res.text();
  const data: unknown = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    const body = data as { error?: string; code?: string; details?: VerificationInfo };
    throw new ApiError(res.status, body?.error ?? "요청을 처리하지 못했습니다.", body?.code, body?.details);
  }
  return data as T;
}

// ---- Auth ----
export type AuthUser = { userId: string; name: string; email: string };
export type LoginResult = {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  user: AuthUser;
};
export type VerificationInfo = {
  status?: "UNCONFIRMED" | "CONFIRMED";
  confirmationRequired?: boolean;
  nextAction?: string;
  email?: string;
  deliveryStatus?: string;
  codeExpiresAt?: string | null;
  retryAfterSeconds?: number;
  resendAvailableAt?: string;
};
export type RegisterResult = { userId?: string } & VerificationInfo & Partial<AuthUser>;
export const authApi = {
  register: (input: { email: string; password: string; name: string }) =>
    request<RegisterResult>("/auth/register", { method: "POST", body: input }),
  confirm: (input: { email: string; code: string }) =>
    request<{ confirmed: true }>("/auth/confirm", { method: "POST", body: input }),
  resend: (email: string) =>
    request<VerificationInfo>("/auth/resend-confirmation", { method: "POST", body: { email } }),
  login: (input: { email: string; password: string }) =>
    request<LoginResult>("/auth/login", { method: "POST", body: input }),
  logout: (token: string) => request<{ loggedOut: true }>("/auth/logout", { method: "POST", token, body: {} }),
  me: (token: string) => request<AuthUser>("/me", { token }),
  updateName: (token: string, name: string) =>
    request<AuthUser>("/me", { method: "PATCH", token, body: { name } }),
};

// ---- Groups ----
export type ElderInfo = { id: string; name: string; birthDate: string | null; note: string };
export type GroupSummary = {
  id: string;
  name: string;
  elder: ElderInfo | null;
  primaryCaregiverId: string;
  nextCaregiverId: string | null;
  createdAt: string;
};
export type Assignment = { id: string; userId: string; startedAt: string; endedAt?: string; handoffId?: string | null };
export type GroupMembership = { memberId: string; userId: string; role: "owner" | "caregiver" | "elder"; joinedAt: string };
export type GroupMember = GroupMembership & { name: string };
export type GroupDetail = GroupSummary & {
  members: GroupMembership[];
  assignments: Assignment[];
  events: BackendEvent[];
  schedules: BackendSchedule[];
  handoffs: BackendHandoff[];
  approvals: unknown[];
};
export const groupsApi = {
  list: (token: string) => request<GroupSummary[]>("/groups", { token }),
  create: (token: string, input: { name: string; elderName?: string }) =>
    request<GroupDetail>("/groups", { method: "POST", token, body: input }),
  get: (token: string, groupId: string) => request<GroupDetail>(`/groups/${groupId}`, { token }),
  members: (token: string, groupId: string) => request<GroupMember[]>(`/groups/${groupId}/members`, { token }),
  invite: (token: string, groupId: string, email: string, role: "caregiver" | "elder" = "caregiver") =>
    request<{ token: string; expiresAt: string; groupId: string }>(`/groups/${groupId}/invitations`, {
      method: "POST",
      token,
      body: { email, role },
    }),
  acceptInvite: (token: string, inviteToken: string) =>
    request<{ groupId: string; joined: true }>("/invitations/accept", { method: "POST", token, body: { token: inviteToken } }),
  leave: (token: string, groupId: string) => request<{ left: true }>(`/groups/${groupId}/leave`, { method: "POST", token, body: {} }),
  setElder: (token: string, groupId: string, exists: boolean, input: { name?: string; birthDate?: string | null; note?: string }) =>
    request<ElderInfo>(`/groups/${groupId}/elder`, { method: exists ? "PATCH" : "POST", token, body: input }),
  setNextCaregiver: (token: string, groupId: string, nextCaregiverId: string | null) =>
    request<{ primaryCaregiverId: string; nextCaregiverId: string | null; members: GroupMembership[] }>(
      `/groups/${groupId}/assignment`,
      { method: "PATCH", token, body: { nextCaregiverId } },
    ),
  transferOwnership: (token: string, groupId: string, userId: string) =>
    request<{ primaryCaregiverId: string; nextCaregiverId: string | null; members: GroupMembership[] }>(
      `/groups/${groupId}/ownership`,
      { method: "PATCH", token, body: { userId } },
    ),
  handover: (token: string, groupId: string, nextCaregiverId?: string) =>
    request<{ primaryCaregiverId: string; history: Assignment[]; handoff: BackendHandoff | null; message: string }>(
      `/groups/${groupId}/handover`,
      { method: "POST", token, body: nextCaregiverId ? { nextCaregiverId } : {} },
    ),
};

// ---- Care events ----
export type BackendEventType =
  | "hospital"
  | "medication"
  | "meal"
  | "life"
  | "schedule"
  | "observation"
  | "homecoming"
  | "care_center";
export type BackendEvent = {
  id: string;
  elderId: string;
  type: BackendEventType;
  content: string;
  timestamp: string;
  createdAt: string;
  createdBy: string;
  source: "caregiver" | "system";
  version: number;
};
export const eventsApi = {
  list: (token: string, groupId: string, query?: { from?: string; to?: string; type?: string }) =>
    request<BackendEvent[]>(`/groups/${groupId}/events${qs(query)}`, { token }),
  create: (
    token: string,
    groupId: string,
    input: { content: string; type?: BackendEventType; timestamp?: string; analyze?: boolean },
  ) => request<BackendEvent>(`/groups/${groupId}/events`, { method: "POST", token, body: input }),
  update: (
    token: string,
    groupId: string,
    id: string,
    input: Partial<{ content: string; type: BackendEventType; timestamp: string; version: number }>,
  ) => request<BackendEvent>(`/groups/${groupId}/events/${id}`, { method: "PATCH", token, body: input }),
  remove: (token: string, groupId: string, id: string) =>
    request<{ deleted: true }>(`/groups/${groupId}/events/${id}`, { method: "DELETE", token }),
};

// ---- Schedules ----
export type BackendScheduleType = "hospital" | "examination" | "visit" | "care_center" | "medication" | "other";
export type BackendScheduleStatus = "scheduled" | "completed" | "cancelled";
export type BackendSchedule = {
  deletedAt?: string | null;
  id: string;
  elderId: string;
  title: string;
  type: BackendScheduleType;
  scheduledAt: string;
  caregiverId: string;
  status: BackendScheduleStatus;
  version: number;
  createdBy: string;
  createdAt: string;
};
export const schedulesApi = {
  list: (token: string, groupId: string) => request<BackendSchedule[]>(`/groups/${groupId}/schedules`, { token }),
  create: (
    token: string,
    groupId: string,
    input: { title: string; type?: BackendScheduleType; scheduledAt: string; caregiverId?: string },
  ) => request<BackendSchedule>(`/groups/${groupId}/schedules`, { method: "POST", token, body: input }),
  update: (
    token: string,
    groupId: string,
    id: string,
    input: Partial<{
      title: string;
      type: BackendScheduleType;
      scheduledAt: string;
      caregiverId: string;
      status: BackendScheduleStatus;
      version: number;
    }>,
  ) => request<BackendSchedule>(`/groups/${groupId}/schedules/${id}`, { method: "PATCH", token, body: input }),
  remove: (token: string, groupId: string, id: string) =>
    request<{ deleted: true }>(`/groups/${groupId}/schedules/${id}`, { method: "DELETE", token }),
};

// ---- Handoffs ----
export type HandoffEvidenceItem = { text: string; sources: { id: string; quote: string }[] };
export type BackendHandoff = {
  id: string;
  elderId: string;
  fromCaregiverId: string;
  toCaregiverId: string;
  fromDate: string;
  toDate: string;
  createdAt: string;
  createdBy: string;
  mode: string;
  modelId: string | null;
  healthSummary: string;
  lifeSummary: string;
  scheduleSummary: string;
  followUp: string;
  evidence: Record<string, HandoffEvidenceItem[]>;
  acknowledgements: { userId: string; acknowledgedAt: string }[];
  regeneratesId: string | null;
};
export const handoffsApi = {
  list: (token: string, groupId: string) => request<BackendHandoff[]>(`/groups/${groupId}/handoffs`, { token }),
  latest: (token: string, groupId: string) => request<BackendHandoff | null>(`/groups/${groupId}/handoffs/latest`, { token }),
  get: (token: string, groupId: string, id: string) => request<BackendHandoff>(`/groups/${groupId}/handoffs/${id}`, { token }),
  create: (token: string, groupId: string, input: { fromDate?: string; toDate?: string; toCaregiverId?: string }) =>
    request<BackendHandoff>(`/groups/${groupId}/handoffs`, { method: "POST", token, body: input }),
  regenerate: (
    token: string,
    groupId: string,
    id: string,
    input: { fromDate?: string; toDate?: string; toCaregiverId?: string },
  ) => request<BackendHandoff>(`/groups/${groupId}/handoffs/${id}/regenerate`, { method: "POST", token, body: input }),
  acknowledge: (token: string, groupId: string, id: string) =>
    request<BackendHandoff>(`/groups/${groupId}/handoffs/${id}/acknowledge`, { method: "POST", token, body: {} }),
};

// ---- Assistant (text + voice) ----
export type AssistantAnswer = {
  mode: string;
  answer: string;
  sources: unknown[];
  requiresApproval?: boolean;
};
export const assistantApi = {
  ask: (token: string, groupId: string, question: string) =>
    request<AssistantAnswer>(`/groups/${groupId}/assistant`, {
      method: "POST",
      token,
      body: { question },
    }),
  askVoice: (token: string, groupId: string, audioBase64: string, mimeType?: string) =>
    request<AssistantAnswer & { transcript: string }>(`/groups/${groupId}/assistant/voice`, {
      method: "POST",
      token,
      body: { audioBase64, mimeType },
    }),
};

// ---- Approvals ----
export type ApprovalAction = "cancel" | "reschedule";
export type ApprovalDecision = "approve" | "reject" | "call";
export type Approval = {
  id: string;
  scheduleId: string;
  scheduleVersion: number;
  requestedAction: ApprovalAction;
  reason: string;
  proposedAt: string | null;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  assignedCaregiver: string;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
  contactRequestedAt?: string;
};
export const approvalsApi = {
  list: (token: string, groupId: string) => request<Approval[]>(`/groups/${groupId}/approvals`, { token }),
  create: (
    token: string,
    groupId: string,
    input: { scheduleId: string; action: ApprovalAction; reason: string; proposedAt?: string },
  ) => request<Approval>(`/groups/${groupId}/approvals`, { method: "POST", token, body: input }),
  decide: (token: string, groupId: string, id: string, decision: ApprovalDecision) =>
    request<Approval>(`/groups/${groupId}/approvals/${id}`, { method: "PATCH", token, body: { decision } }),
};

// ---- Type adapters: backend DTO <-> existing frontend view types (data.ts) ----
const EVENT_TYPE_TO_KR: Record<BackendEventType, EventType> = {
  hospital: "병원",
  medication: "복약",
  meal: "식사",
  life: "생활",
  schedule: "일정",
  observation: "특이사항",
  homecoming: "생활",
  care_center: "생활",
};
const EVENT_TYPE_TO_EN: Record<EventType, BackendEventType> = {
  병원: "hospital",
  복약: "medication",
  식사: "meal",
  생활: "life",
  일정: "schedule",
  특이사항: "observation",
};
export const toBackendEventType = (t: EventType): BackendEventType => EVENT_TYPE_TO_EN[t];
export function fromBackendEvent(e: BackendEvent): CareEvent {
  return {
    eventId: e.id,
    elderId: e.elderId,
    createdBy: e.createdBy,
    type: EVENT_TYPE_TO_KR[e.type] ?? "생활",
    content: e.content,
    timestamp: e.timestamp,
    createdAt: e.createdAt,
  };
}

export const scheduleKinds = ["병원", "검사", "방문", "돌봄센터", "복약", "기타"] as const;
export type ScheduleKind = (typeof scheduleKinds)[number];
const SCHEDULE_KIND_TO_KR: Record<BackendScheduleType, ScheduleKind> = {
  hospital: "병원",
  examination: "검사",
  visit: "방문",
  care_center: "돌봄센터",
  medication: "복약",
  other: "기타",
};
const SCHEDULE_KIND_TO_EN: Record<ScheduleKind, BackendScheduleType> = {
  병원: "hospital",
  검사: "examination",
  방문: "visit",
  돌봄센터: "care_center",
  복약: "medication",
  기타: "other",
};
export const toBackendScheduleType = (k: string): BackendScheduleType => SCHEDULE_KIND_TO_EN[k as ScheduleKind] ?? "other";
const STATUS_TO_KR: Record<BackendScheduleStatus, Schedule["status"]> = {
  scheduled: "예정",
  completed: "완료",
  cancelled: "취소",
};
const STATUS_TO_EN: Record<Schedule["status"], BackendScheduleStatus> = {
  예정: "scheduled",
  완료: "completed",
  취소: "cancelled",
};
export const toBackendStatus = (s: Schedule["status"]) => STATUS_TO_EN[s];
export function fromBackendSchedule(s: BackendSchedule): Schedule {
  return {
    scheduleId: s.id,
    title: s.title,
    scheduledAt: s.scheduledAt,
    caregiverId: s.caregiverId,
    status: STATUS_TO_KR[s.status],
    kind: SCHEDULE_KIND_TO_KR[s.type] ?? "기타",
  };
}

const avatarColors = ["blue", "green", "purple", "teal", "orange"];
export function colorFor(index: number) {
  return avatarColors[index % avatarColors.length];
}

// ---- Session persistence (localStorage; per-browser like the rest of the prototype) ----
export type Session = { accessToken: string; user: AuthUser };
const SESSION_KEY = "fcc.session.v1";
const GROUP_KEY = "fcc.session.group.v1";
export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const s = parsed as Session;
    if (typeof s?.accessToken !== "string" || typeof s?.user?.userId !== "string") return null;
    return s;
  } catch {
    return null;
  }
}
export function saveSession(session: Session | null) {
  if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(SESSION_KEY);
}
export function loadGroupId(): string | null {
  try {
    return window.localStorage.getItem(GROUP_KEY);
  } catch {
    return null;
  }
}
export function saveGroupId(groupId: string | null) {
  if (groupId) window.localStorage.setItem(GROUP_KEY, groupId);
  else window.localStorage.removeItem(GROUP_KEY);
}

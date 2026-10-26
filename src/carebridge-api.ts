import { request } from "./api";

export type CareRole = "author" | "reviewer" | "family";
export type CareStatus = "review_required" | "hold" | "approved";
export type Category = "meal" | "hydration" | "mobility" | "sleep" | "hygiene" | "medication" | "condition" | "other";
export type Evidence = { segment_id: string; start: number; end: number; quote: string };
export type QA = {
  checks: { code: string; passed: boolean }[];
  issues: { code: string; severity: "hold" | "review"; message: string }[];
  external_share_allowed: false; requires_human_review: true;
};
export type BridgeDraft = {
  schema_version: string; id: string; status: "review_required" | "hold"; label: string; mode: string;
  source: { kind: string; language: string; text: string; sha256: string };
  translation: { language: "ko"; text: string; segments: { text: string; evidence: Evidence }[] };
  observations: { id: string; category: Category; text: string; evidence: Evidence }[];
  additional_checks: { id: string; question: string; evidence: Evidence }[];
  qa: QA;
};
export type NoteSummary = {
  id: string; createdBy: string; createdAt: string; updatedAt: string; status: CareStatus;
  version: number; language: string; inputKind: "text" | "transcript"; approvedAt: string | null;
};
export type VersionMeta = { version: number; action: string; reason: string; by: string; at: string; status: CareStatus };
export type BridgeNote = NoteSummary & {
  groupId: string; source: BridgeDraft["source"]; approvedVersion: number | null; approvedBy: string | null;
  history: VersionMeta[]; draft: BridgeDraft; qa: QA;
};
export type RolePolicy = {
  version: number; myRole: CareRole; canManage: boolean; aiEnabled: boolean;
  roles: { userId: string; name: string; role: CareRole; locked: boolean }[];
};
export type Preview = { id: string; version: number; approvedAt: string; label: string; manualOnly: true; observations: { category: Category; text: string }[] };
export type SegmentEdit = { segmentId: string; text: string; category: Category; needsConfirmation: boolean };
export type NotePage = { items: NoteSummary[]; nextCursor: string | null };
export function carebridgeApi(token: string, groupId: string) {
  const root = `/groups/${encodeURIComponent(groupId)}/carebridge`;
  const call = <T>(path: string, method = "GET", body?: unknown) => request<T>(root + path, { token, method, body });
  return {
    roles: () => call<RolePolicy>("/roles"),
    setRole: (expectedVersion: number, userId: string, role: CareRole) => call<RolePolicy>("/roles", "PATCH", { expectedVersion, userId, role }),
    list: (family = false, cursor?: string) => call<NotePage>((family ? "/family" : "/notes") + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "")),
    create: (memo: string, sourceLanguage: string, requestId: string, inputKind: "text" | "transcript") => call<BridgeNote>("/notes", "POST", { memo, sourceLanguage, requestId, inputKind, dataUse: "synthetic_deidentified" }),
    get: (id: string) => call<BridgeNote>(`/notes/${id}`),
    edit: (id: string, expectedVersion: number, reason: string, segments: SegmentEdit[]) => call<BridgeNote>(`/notes/${id}`, "PATCH", { expectedVersion, reason, segments }),
    check: (id: string, expectedVersion: number) => call<BridgeNote>(`/notes/${id}/check`, "POST", { expectedVersion }),
    decide: (id: string, expectedVersion: number, decision: "approve" | "hold", reason: string, confirmSource: boolean, confirmChecks: boolean) => call<BridgeNote>(`/notes/${id}/review`, "POST", { expectedVersion, decision, reason, confirmSource, confirmChecks }),
    preview: (id: string) => call<Preview>(`/notes/${id}/preview`),
    version: (id: string, version: number) => call<VersionMeta & { draft: BridgeDraft }>(`/notes/${id}/versions/${version}`),
    transcribe: (audioBase64: string, sourceLanguage: string) => call<{ text: string; requiresTranscriptReview: true }>("/transcriptions", "POST", { audioBase64, sourceLanguage, dataUse: "synthetic_deidentified" }),
  };
}
export const categoryLabels: Record<Category, string> = { meal: "식사", hydration: "수분", mobility: "이동", sleep: "수면", hygiene: "위생", medication: "복약 관찰", condition: "상태 관찰", other: "기타" };
export const statusLabels: Record<CareStatus, string> = { review_required: "검토 대기", hold: "보류", approved: "담당자 승인" };
export const roleLabels: Record<CareRole, string> = { author: "메모 작성자", reviewer: "담당 검토자", family: "가족 열람자" };

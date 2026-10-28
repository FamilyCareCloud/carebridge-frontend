export type Role = "author" | "reviewer" | "reader";
export type Status = "pending" | "held" | "confirmed";
export type User = { id: string; name: string; role: Role; admin?: boolean };
export type Session = { token: string; user: User };
export type Member = {
  userId: string;
  name: string;
  role: Role;
  status: "pending" | "active" | "rejected" | "removed";
  requestedAt?: string;
};
export type Subject = {
  id: string;
  name: string;
  memo: string;
  number: number;
};
export type Submission = {
  id: string;
  threadId: string;
  previousId?: string;
  authorId: string;
  authorName: string;
  subjectId: string;
  source: string;
  language: string;
  generated: string;
  final: string;
  review: string;
  reason: string;
  status: Status;
  createdAt: string;
  reviewedAt?: string;
  version: number;
};
export type Publication = {
  id: string;
  submissionId: string;
  subjectName: string;
  subjectNumber: number;
  content: string;
  recipients: string[];
  state: "published" | "revoked";
  publishedAt: string;
  version: number;
};
export type Audit = {
  id: string;
  text: string;
  at: string;
  actor: string;
  details?: string;
};
export type Workspace = {
  id: string;
  name: string;
  code: string;
  ownerId: string;
};
export type Snapshot = {
  workspace: Workspace | null;
  membership: Member | null;
  members: Member[];
  subjects: Subject[];
  submissions: Submission[];
  publications: Publication[];
  audit: Audit[];
  revision: number;
  transferCandidates: User[];
};
export type Command =
  | { type: "createWorkspace"; name: string }
  | { type: "join"; code: string }
  | {
      type: "membership";
      userId: string;
      status: "active" | "rejected" | "removed";
    }
  | { type: "subject"; name: string; memo: string }
  | {
      type: "submit";
      subjectId: string;
      source: string;
      generated: string;
      final: string;
      language: string;
      threadId?: string;
      previousId?: string;
      requestId: string;
    }
  | {
      type: "review";
      id: string;
      version: number;
      content: string;
      reason: string;
      status: Status;
    }
  | {
      type: "publish";
      submissionId: string;
      version: number;
      content: string;
      recipients: string[];
    }
  | { type: "revoke"; id: string; version: number }
  | { type: "transfer"; userId: string };
export interface Gateway {
  mode: "mock" | "api";
  login(id: string, password: string): Promise<Session>;
  register(
    name: string,
    id: string,
    password: string,
    role: Role,
  ): Promise<Session>;
  snapshot(session: Session, role: Role): Promise<Snapshot>;
  execute(session: Session, role: Role, command: Command): Promise<void>;
  generate(
    session: Session,
    role: Role,
    source: string,
    language: string,
  ): Promise<{ text: string; source: string }>;
  subscribe(
    session: Session,
    onChange: () => void,
    onDisconnect: () => void,
    onConnected: () => void,
  ): () => void;
}
export const roleNames: Record<Role, string> = {
  author: "기록 작성자",
  reviewer: "관리자 · 검토자",
  reader: "기록 열람자",
};
export const statusNames: Record<Status, string> = {
  pending: "검토 대기",
  held: "보류",
  confirmed: "검토 완료",
};
export const stamp = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

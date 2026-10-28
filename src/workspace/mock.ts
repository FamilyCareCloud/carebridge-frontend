import type {
  Audit,
  Command,
  Gateway,
  Member,
  Publication,
  Role,
  Session,
  Snapshot,
  Subject,
  Submission,
  User,
  Workspace,
} from "./model";

const KEY = "carebridge.synthetic.workspace.v2";
type DB = {
  users: User[];
  workspace: Workspace | null;
  members: Member[];
  subjects: Subject[];
  submissions: Submission[];
  publications: Publication[];
  audit: Audit[];
  requests: Record<string, string>;
  revision: number;
};
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export const demoUsers: User[] = [
  { id: "reviewer", name: "김지현", role: "reviewer" },
  { id: "author", name: "린 응우옌", role: "author" },
  { id: "reader", name: "김민서", role: "reader" },
  { id: "successor", name: "박서연", role: "reviewer" },
  { id: "admin", name: "QA 관리자", role: "reviewer", admin: true },
];
function seed(): DB {
  const submissions: Submission[] = [
    {
      id: "n1",
      threadId: "t1",
      authorId: "author",
      authorName: "린 응우옌",
      subjectId: "s1",
      source:
        "점심을 절반 드셨고 무릎이 불편하다고 말씀하셨습니다. 복약 여부는 확인하지 못했습니다.",
      language: "ko",
      generated:
        "식사: 점심을 절반 드심.\n당사자 표현: 무릎이 불편하다고 말씀하심.\n추가 확인: 복약 여부 미확인.",
      final:
        "식사: 점심을 절반 드심.\n당사자 표현: 무릎이 불편하다고 말씀하심.\n추가 확인: 복약 여부 미확인.",
      review: "",
      reason: "",
      status: "pending",
      createdAt: now(),
      version: 1,
    },
    {
      id: "n2",
      threadId: "t2",
      authorId: "author",
      authorName: "린 응우옌",
      subjectId: "s2",
      source: "산책 시 이동을 도왔습니다. 중간에 쉬고 싶다고 말씀하셨습니다.",
      language: "ko",
      generated:
        "제공한 지원: 산책 시 이동 도움.\n당사자 표현: 중간에 쉬고 싶다고 말씀하심.",
      final:
        "제공한 지원: 산책 시 이동 도움.\n당사자 표현: 중간에 쉬고 싶다고 말씀하심.",
      review: "",
      reason: "산책 중 어느 시점에 휴식을 요청하셨는지 확인해 주세요.",
      status: "held",
      createdAt: now(),
      version: 2,
    },
    {
      id: "n3",
      threadId: "t3",
      authorId: "author",
      authorName: "린 응우옌",
      subjectId: "s3",
      source: "오후에 책을 읽으셨습니다. 물 한 잔을 드렸습니다.",
      language: "ko",
      generated: "관찰: 오후 독서.\n제공한 지원: 물 한 잔 제공.",
      final: "관찰: 오후에 책을 읽으심.\n제공한 지원: 물 한 잔 제공.",
      review: "오후에 책을 읽으셨으며, 물 한 잔을 제공했습니다.",
      reason: "원문 대조 완료",
      status: "confirmed",
      createdAt: now(),
      reviewedAt: now(),
      version: 2,
    },
  ];
  return {
    users: [
      ...demoUsers,
      { id: "pending-author", name: "아유", role: "author" },
      { id: "pending-reader", name: "이하늘", role: "reader" },
    ],
    workspace: {
      id: "w1",
      name: "온유요양센터",
      code: "CARE2026",
      ownerId: "reviewer",
    },
    members: [
      ...demoUsers
        .filter((u) => u.role !== "reviewer")
        .map((u) => ({
          userId: u.id,
          name: u.name,
          role: u.role,
          status: "active" as const,
        })),
      {
        userId: "pending-author",
        name: "아유",
        role: "author",
        status: "pending",
        requestedAt: now(),
      },
      {
        userId: "pending-reader",
        name: "이하늘",
        role: "reader",
        status: "pending",
        requestedAt: now(),
      },
    ],
    subjects: [
      { id: "s1", name: "김철수", memo: "합성 사례 A", number: 1 },
      { id: "s2", name: "이영희", memo: "합성 사례 B", number: 2 },
      { id: "s3", name: "김철수", memo: "합성 사례 C · 동명이인", number: 3 },
    ],
    submissions,
    publications: [
      {
        id: "p1",
        submissionId: "n3",
        subjectName: "김철수",
        subjectNumber: 3,
        content: "오후에 책을 읽으셨으며, 물 한 잔을 제공했습니다.",
        recipients: ["reader"],
        state: "published",
        publishedAt: now(),
        version: 1,
      },
    ],
    audit: [],
    requests: {},
    revision: 1,
  };
}

// Explicit local-development fixture only. No real credentials or clinical data belong here.
export class MockGateway implements Gateway {
  mode = "mock" as const;
  private read(): DB {
    const value = localStorage.getItem(KEY);
    return value ? JSON.parse(value) : seed();
  }
  private save(db: DB) {
    db.revision++;
    localStorage.setItem(KEY, JSON.stringify(db));
    window.dispatchEvent(new Event(KEY));
  }
  reset(empty = false) {
    const db = seed();
    if (empty) {
      db.workspace = null;
      db.members = [];
      db.subjects = [];
      db.submissions = [];
      db.publications = [];
    }
    this.save(db);
  }
  private user(db: DB, session: Session, role: Role) {
    const user = db.users.find((u) => u.id === session.user.id);
    if (!user || session.token !== `mock:${user.id}`)
      throw new Error("로그인이 필요합니다.");
    if (!user.admin && user.role !== role)
      throw new Error("이 역할에 접근할 권한이 없습니다.");
    return user;
  }
  private active(db: DB, user: User, role: Role) {
    return (
      !!db.workspace &&
      (user.admin ||
        (role === "reviewer"
          ? db.workspace.ownerId === user.id
          : db.members.some(
              (m) => m.userId === user.id && m.status === "active",
            )))
    );
  }
  async login(id: string, password: string): Promise<Session> {
    const db = this.read();
    const user = db.users.find((u) => u.id === id);
    if (!user || password !== "demo")
      throw new Error("모의 계정의 비밀번호는 demo입니다.");
    if (!localStorage.getItem(KEY)) this.save(db);
    return { token: `mock:${user.id}`, user };
  }
  async register(
    name: string,
    id: string,
    password: string,
    role: Role,
  ): Promise<Session> {
    const db = this.read();
    if (!name.trim() || !id.trim() || password !== "demo")
      throw new Error("이름·ID와 모의 비밀번호 demo를 입력해 주세요.");
    if (db.users.some((u) => u.id === id) || id.toLowerCase() === "admin")
      throw new Error("이미 사용 중인 ID입니다.");
    const user = { id, name, role };
    db.users.push(user);
    this.save(db);
    return { token: `mock:${id}`, user };
  }
  async snapshot(session: Session, role: Role): Promise<Snapshot> {
    const db = this.read();
    const user = this.user(db, session, role);
    const active = this.active(db, user, role);
    const membership = db.members.find((m) => m.userId === user.id) ?? null;
    const reviewer = active && role === "reviewer";
    return structuredClone({
      workspace:
        active || membership
          ? { ...db.workspace!, code: reviewer ? db.workspace!.code : "" }
          : null,
      membership,
      members: reviewer ? db.members : [],
      subjects: active && role !== "reader" ? db.subjects : [],
      submissions: active
        ? reviewer
          ? db.submissions
          : role === "author"
            ? db.submissions.filter((n) => n.authorId === user.id)
            : []
        : [],
      publications: active
        ? reviewer
          ? db.publications
          : role === "reader"
            ? db.publications
                .filter(
                  (p) =>
                    p.state === "published" &&
                    (user.admin || p.recipients.includes(user.id)),
                )
                .map((p) => ({ ...p, recipients: [] }))
            : []
        : [],
      audit: reviewer ? db.audit : [],
      revision: db.revision,
      transferCandidates: reviewer
        ? db.users.filter(
            (u) =>
              u.role === "reviewer" &&
              !u.admin &&
              u.id !== db.workspace?.ownerId,
          )
        : [],
    });
  }
  async generate(
    session: Session,
    role: Role,
    source: string,
  ): Promise<{ text: string; source: string }> {
    const db = this.read();
    const user = this.user(db, session, role);
    if (role !== "author" || !this.active(db, user, role))
      throw new Error("작성 권한이 없습니다.");
    if (!source.trim() || source.length > 4000)
      throw new Error("원문은 1~4,000자로 입력해 주세요.");
    await new Promise((resolve) => setTimeout(resolve, 350));
    return {
      source,
      text: `관찰 메모\n${source}\n\n추가 확인\n원문에서 확인되지 않은 정보는 검토자가 확인해 주세요.`,
    };
  }
  async execute(session: Session, role: Role, command: Command): Promise<void> {
    const db = this.read();
    const user = this.user(db, session, role);
    const c = command;
    const oldReview =
      c.type === "review"
        ? structuredClone(db.submissions.find((n) => n.id === c.id))
        : null;
    const oldOwner = db.workspace?.ownerId;
    if (c.type === "createWorkspace") {
      if (role !== "reviewer" || db.workspace)
        throw new Error(
          "이 모의 환경에는 이미 작업 그룹이 있습니다. 그룹이 없는 환경에서 생성할 수 있습니다.",
        );
      if (!c.name.trim()) throw new Error("기관 이름을 입력해 주세요.");
      db.workspace = {
        id: uuid(),
        name: c.name.trim(),
        ownerId: user.id,
        code: uuid().slice(0, 8).toUpperCase(),
      };
    } else if (c.type === "join") {
      if (
        role === "reviewer" ||
        !db.workspace ||
        c.code.trim() !== db.workspace.code
      )
        throw new Error("초대코드 또는 역할을 확인해 주세요.");
      const member = db.members.find((m) => m.userId === user.id);
      if (member?.status === "removed")
        throw new Error("퇴출 후 재가입 정책은 협의 중입니다.");
      if (member?.status === "active" || member?.status === "pending")
        throw new Error("이미 참여했거나 승인 대기 중입니다.");
      if (member) {
        member.status = "pending";
        member.requestedAt = now();
      } else
        db.members.push({
          userId: user.id,
          name: user.name,
          role,
          status: "pending",
          requestedAt: now(),
        });
    } else {
      if (!this.active(db, user, role))
        throw new Error("작업 그룹 접근 권한이 없습니다.");
      if (c.type === "submit") {
        if (role !== "author") throw new Error("작성자만 제출할 수 있습니다.");
        const requestKey = `${user.id}:${c.requestId}`,
          fingerprint = JSON.stringify(c);
        if (db.requests[requestKey]) {
          if (db.requests[requestKey] !== fingerprint)
            throw new Error(
              "이미 처리된 요청입니다. 새 요청으로 제출해 주세요.",
            );
          return;
        }
        if (
          !db.subjects.some((s) => s.id === c.subjectId) ||
          !c.source.trim() ||
          !c.final.trim() ||
          !c.generated.trim()
        )
          throw new Error("대상자·원문·초안을 확인해 주세요.");
        if (
          c.previousId &&
          !db.submissions.some(
            (n) =>
              n.id === c.previousId &&
              n.authorId === user.id &&
              n.threadId === c.threadId,
          )
        )
          throw new Error("이전 제출에 접근할 수 없습니다.");
        if (
          (c.threadId && !c.previousId) ||
          c.source.length > 4000 ||
          !c.requestId
        )
          throw new Error("제출 입력을 확인해 주세요.");
        db.submissions.unshift({
          id: uuid(),
          threadId: c.threadId ?? uuid(),
          previousId: c.previousId,
          subjectId: c.subjectId,
          authorId: user.id,
          authorName: user.name,
          source: c.source,
          language: c.language,
          generated: c.generated,
          final: c.final,
          review: "",
          reason: "",
          status: "pending",
          createdAt: now(),
          version: 1,
        });
        db.requests[requestKey] = fingerprint;
      } else {
        if (role !== "reviewer")
          throw new Error("관리자만 처리할 수 있습니다.");
        if (c.type === "membership") {
          const m = db.members.find((m) => m.userId === c.userId);
          if (
            !m ||
            (c.status !== "removed" && m.status !== "pending") ||
            (c.status === "removed" && m.status !== "active")
          )
            throw new Error("참여 상태가 변경되었습니다.");
          m.status = c.status;
          if (c.status === "removed")
            db.publications.forEach((p) => {
              p.recipients = p.recipients.filter((id) => id !== m.userId);
              p.version++;
            });
        }
        if (c.type === "subject") {
          if (!c.name.trim()) throw new Error("대상자 이름을 입력해 주세요.");
          db.subjects.push({
            id: uuid(),
            name: c.name.trim(),
            memo: c.memo.trim(),
            number: Math.max(0, ...db.subjects.map((s) => s.number)) + 1,
          });
        }
        if (c.type === "review") {
          const n = db.submissions.find((n) => n.id === c.id);
          if (!n || n.version !== c.version)
            throw new Error(
              "다른 화면에서 기록이 변경됐습니다. 다시 열어 주세요.",
            );
          if (n.status === "confirmed")
            throw new Error("확정 기록은 공개 관리에서 정정해 주세요.");
          if (!c.content.trim() || (c.status === "held" && !c.reason.trim()))
            throw new Error("검토 내용과 보류 사유를 확인해 주세요.");
          n.review = c.content;
          n.reason = c.reason;
          n.status = c.status;
          n.reviewedAt = now();
          n.version++;
        }
        if (c.type === "publish") {
          const n = db.submissions.find((n) => n.id === c.submissionId);
          if (!n || n.status !== "confirmed")
            throw new Error("확정된 기록만 공개할 수 있습니다.");
          if (n.version !== c.version)
            throw new Error("확정 버전이 변경되었습니다. 다시 확인해 주세요.");
          if (
            db.publications.some(
              (p) => p.submissionId === n.id && p.state === "published",
            )
          )
            throw new Error(
              "이미 공개 중입니다. 공개 기록 관리에서 기존 열람을 차단한 후 정정해 주세요.",
            );
          if (
            !c.content.trim() ||
            !c.recipients.length ||
            c.recipients.some(
              (id) =>
                !db.members.some(
                  (m) =>
                    m.userId === id &&
                    m.role === "reader" &&
                    m.status === "active",
                ),
            )
          )
            throw new Error("공개 내용과 활성 열람자를 선택해 주세요.");
          const s = db.subjects.find((s) => s.id === n.subjectId)!;
          db.publications
            .filter((p) => p.submissionId === n.id)
            .forEach((p) => {
              p.state = "revoked";
              p.version++;
            });
          db.publications.unshift({
            id: uuid(),
            submissionId: n.id,
            subjectName: s.name,
            subjectNumber: s.number,
            content: c.content,
            recipients: c.recipients,
            state: "published",
            publishedAt: now(),
            version: 1,
          });
        }
        if (c.type === "revoke") {
          const p = db.publications.find((p) => p.id === c.id);
          if (!p || p.version !== c.version)
            throw new Error("공개 상태가 변경되었습니다. 다시 확인해 주세요.");
          p.state = "revoked";
          p.version++;
        }
        if (c.type === "transfer") {
          const next = db.users.find(
            (u) => u.id === c.userId && u.role === "reviewer" && !u.admin,
          );
          if (!next || next.id === db.workspace!.ownerId)
            throw new Error("새로운 2그룹 계정을 선택해 주세요.");
          db.workspace!.ownerId = next.id;
        }
      }
    }
    const names: Record<Command["type"], string> = {
      createWorkspace: "작업 그룹 생성",
      join: "참여 요청",
      membership: "구성원 상태 변경",
      subject: "돌봄 대상 등록",
      submit: "메모 제출",
      review: "기록 검토",
      publish: "기록 공개",
      revoke: "공개 차단",
      transfer: "관리 권한 이전",
    };
    let details = "";
    if (c.type === "review")
      details = `제출 ${c.id}\n이전 검토 내용\n${oldReview?.review || "(없음)"}\n\n변경한 검토 내용\n${c.content}\n\n사유: ${c.reason || "(없음)"}\n상태: ${oldReview?.status} → ${c.status}`;
    if (c.type === "membership")
      details = `${db.members.find((m) => m.userId === c.userId)?.name} · ${c.userId}\n참여 상태: ${c.status}`;
    if (c.type === "transfer")
      details = `이전 담당자: ${db.users.find((u) => u.id === oldOwner)?.name}\n새 담당자: ${db.users.find((u) => u.id === c.userId)?.name}`;
    if (c.type === "publish")
      details = `제출 ${c.submissionId}\n수신자: ${c.recipients.map((id) => db.users.find((u) => u.id === id)?.name).join(", ")}\n\n공개 내용\n${c.content}`;
    if (c.type === "revoke")
      details = `공개 기록 ${c.id}\n모든 수신자의 열람 차단`;
    if (c.type === "join")
      details = `${user.name} · ${user.role}\n참여 승인 요청`;
    db.audit.unshift({
      id: uuid(),
      text: names[c.type],
      actor: user.name,
      at: now(),
      details,
    });
    this.save(db);
  }
  subscribe(
    _session: Session,
    onChange: () => void,
    _onDisconnect: () => void,
    onConnected: () => void,
  ): () => void {
    const listener = () => onChange();
    window.addEventListener(KEY, listener);
    const storage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) onChange();
    };
    window.addEventListener("storage", storage);
    onConnected();
    return () => {
      window.removeEventListener(KEY, listener);
      window.removeEventListener("storage", storage);
    };
  }
}

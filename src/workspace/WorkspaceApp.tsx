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
} from "./model";
import { Brand, Badge, Empty, Heading, Modal } from "./ui";
import Login from "./Login";
import "./workspace.css";

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
const icons = {
  home: "▦",
  compose: "＋",
  notes: "▤",
  requests: "⇥",
  members: "♧",
  subjects: "◎",
  publications: "↗",
  history: "◷",
  settings: "⚙",
};
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
  author: ["home", "compose", "notes", "settings"],
  reviewer: [
    "home",
    "notes",
    "publications",
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
  threadId: undefined as string | undefined,
  previousId: undefined as string | undefined,
};
export default function WorkspaceApp() {
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
  const epoch = useRef(0),
    generation = useRef(0),
    readOrder = useRef(0),
    connected = useRef(false);
  const refresh = useCallback(async () => {
    if (!session || !connected.current) return;
    const e = epoch.current,
      order = ++readOrder.current;
    try {
      const next = await gateway.snapshot(session, role);
      if (
        connected.current &&
        e === epoch.current &&
        order === readOrder.current
      ) {
        setData(next);
        setOffline(false);
      }
    } catch (err) {
      if (e === epoch.current && order === readOrder.current) {
        if (err instanceof ApiError && err.status === 401) {
          setSession(null);
        }
        setData(null);
        setOffline(true);
        setError((err as Error).message);
      }
    }
  }, [session, role]);
  useEffect(() => {
    const e = ++epoch.current;
    connected.current = false;
    if (!session) return;
    const invalidate = () => {
      if (e !== epoch.current) return;
      setData(null);
      void refresh();
    };
    const disconnect = (message?: string) => {
      if (e !== epoch.current) return;
      connected.current = false;
      readOrder.current++;
      setOffline(true);
      setData(null);
      if (message) setError(message);
    };
    const stop = gateway.subscribe(session, invalidate, disconnect, () => {
      if (e !== epoch.current) return;
      connected.current = true;
      void refresh();
    });
    const reconnect = () => {
      disconnect();
      setRetry((r) => r + 1);
    };
    const visibility = () => {
      setData(null);
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
    window.addEventListener("offline", disconnectedEvent);
    window.addEventListener("pagehide", disconnectedEvent);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      epoch.current = e + 1;
      connected.current = false;
      stop();
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("offline", disconnectedEvent);
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
    generation.current++;
    setBusy(false);
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
    setSession(s);
    setRole(s.user.role);
    setPage(s.user.role === "reader" ? "publications" : "home");
  }
  function navigate(p: Page) {
    setPage(p);
    setMobile(false);
    setQuery("");
    setFilter("all");
    setSelected(null);
    setError("");
    window.scrollTo({ top: 0 });
  }
  async function logout() {
    const current = session;
    epoch.current++;
    connected.current = false;
    clearViews();
    setSession(null);
    if (current) {
      try { await gateway.logout?.(current); }
      catch { window.alert("이 기기에서는 로그아웃했지만 서버 세션 종료에 실패했습니다."); }
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
      else { setRole(next); setPage(next === "reader" ? "publications" : "home"); }
    } catch (err) { setError((err as Error).message); setRetry(r=>r+1); }
    finally { setBusy(false); }
  }
  async function action(command: Command, message: string) {
    if (!session || busy || !connected.current) return false;
    const e = epoch.current;
    setBusy(true);
    setError("");
    try {
      await gateway.execute(session, role, command);
      if (e !== epoch.current) return false;
      await refresh();
      if (e !== epoch.current) return false;
      setToast(message);
      if (["createWorkspace", "join", "acceptTransfer"].includes(command.type)) setRetry(r=>r+1);
      return true;
    } catch (err) {
      if (e === epoch.current) setError((err as Error).message);
      return false;
    } finally {
      if (e === epoch.current) setBusy(false);
    }
  }
  async function generate() {
    if (!session || busy) return;
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
      threadId: n.threadId,
      previousId: n.id,
    });
    setRequestId(crypto.randomUUID());
    navigate("compose");
  }
  function openNote(n: Submission) {
    setSourceChecked(false);
    setChecksChecked(false);
    setSelected(n.id);
    setReview(n.review || n.final);
    setReason(n.reason);
    setReviewVersion(n.version);
  }
  function openPublish(n: Submission, existing?: Publication) {
    setExistingPublication(existing ?? pubs.find(p=>p.submissionId===n.id && p.state!=="published") ?? null);
    setPublishId(n.id);
    setPublishVersion(n.version);
    setPublishContent(existing?.content || n.review || n.final);
    setRecipients([]);
    setPreview(false);
    setSelected(null);
  }
  if (!session) return <Login onSession={login} />;
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
  const subjectLabel = (id: string) => {
    const s = subjects.find((s) => s.id === id);
    return s ? `${s.name} · #${String(s.number).padStart(3, "0")}` : "대상자";
  };
  const counts = {
      pending: notes.filter((n) => n.status === "pending").length,
      held: notes.filter((n) => n.status === "held").length,
      confirmed: notes.filter((n) => n.status === "confirmed").length,
    },
    pendingMembers = members.filter((m) => m.status === "pending");
  const pageLabel = (p: Page) =>
    p === "notes" && role === "reviewer"
      ? "검토함"
      : p === "publications" && role === "reader"
        ? "전달 사항"
        : labels[p];
  function noteTable(items: Submission[]) {
    return items.length ? (
      <div className="cb-table-scroll">
        <table>
          <thead>
            <tr>
              <th>대상자 / 기록</th>
              {role === "reviewer" && <th>작성자</th>}
              <th>제출 시각</th>
              <th>상태</th>
              <th>
                <span className="cb-sr">상세</span>
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
                      <small>↳ 이전 제출에서 이어진 새 검토 건</small>
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
                    내용 보기 ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty title="표시할 메모가 없습니다">
        새로운 기록이 도착하면 여기에서 확인할 수 있어요.
      </Empty>
    );
  }
  return (
    <div className="cb-app">
      <aside className={`cb-sidebar ${mobile ? "open" : ""}`}>
        <Brand />
        <div className="cb-workspace">
          <span>▥</span>
          <div>
            <strong>{data?.workspace?.name || "작업 그룹"}</strong>
            <small>기관 작업 공간</small>
          </div>
        </div>
        <small className="cb-nav-label">WORKSPACE</small>
        <nav aria-label="주 메뉴">
          {menus[role].map((p) => (
            <button
              key={p}
              aria-label={pageLabel(p)}
              className={page === p ? "active" : ""}
              onClick={() => navigate(p)}
            >
              <span className="cb-nav-icon">{icons[p]}</span>
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
              <small>{roleNames[role]}</small>
            </div>
          </div>
          <button
            className="cb-text"
            onClick={() => void logout()}
          >
            ↪ 로그아웃
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="cb-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="cb-main">
        <header className="cb-topbar">
          <button
            className="cb-mobile-menu cb-icon"
            aria-label="메뉴 열기"
            onClick={() => setMobile(!mobile)}
          >
            ☰
          </button>
          <div className="cb-breadcrumb">
            {data?.workspace?.name || "CareBridge"} <span>/</span>{" "}
            <strong>{pageLabel(page)}</strong>
          </div>
          <div className="cb-top-actions">
            <span className="cb-role-dot" />
            {roleNames[role]}
            <span className="cb-avatar small">{user.name[0]}</span>
          </div>
        </header>
        {isMock && (
          <div className="cb-devbar">
            <span>
              <b>LOCAL QA</b>{" "}
              합성 데이터 · AI 응답은 모의 결과입니다
            </span>
            {user.admin ? (
              <label>
                테스트 역할{" "}
                <select
                  aria-label="테스트 역할"
                  value={role}
                  disabled={busy}
                  onChange={(e) => void selectRole(e.target.value as Role)}
                >
                  {Object.entries(roleNames).map(([r, n]) => (
                    <option key={r} value={r}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <small>역할은 가입 시 고정됩니다</small>
            )}
          </div>
        )}
        <main className="cb-content">
          {!isMock && <div className="cb-notice">AI 생성·검사는 아직 연결하지 않았습니다. 기존 기록과 그룹 관리부터 연결 중이며, 신규 생성 및 검사 결과가 필요한 확정은 제한될 수 있습니다.</div>}
          {error && (
            <div className="cb-error" role="alert">
              {error}
              <button className="cb-text" onClick={() => setError("")}>
                닫기
              </button>
            </div>
          )}
          {offline ? (
            <Empty title="접근 권한을 다시 확인해야 합니다">
              연결이 끊겨 기록 표시를 중단했습니다.
              <br />
              <button
                className="cb-primary"
                onClick={() => {
                  setError("");
                  setData(null);
                  setOffline(false);
                  setRetry((r) => r + 1);
                }}
              >
                다시 연결
              </button>
            </Empty>
          ) : !data ? (
            <div className="cb-loading" role="status">
              작업 공간을 확인하고 있어요…
            </div>
          ) : !active ? (
            <section className="cb-join">
              <Heading
                eyebrow="YOUR WORKSPACE"
                title={
                  role === "reviewer"
                    ? "기관의 작업 공간을 연결하세요"
                    : "함께할 작업 그룹에 참여하세요"
                }
              >
                담당자의 승인 후 업무를 시작할 수 있습니다.
              </Heading>
              {data.membership && (
                <div className="cb-notice">
                  참여 상태:{" "}
                  {
                    {
                      pending: "승인 대기",
                      active: "참여 중",
                      rejected: "거절 · 재요청 가능",
                      removed: "퇴출 · 접근 차단",
                    }[data.membership.status]
                  }
                </div>
              )}
              {(data.transfers ?? []).filter(t=>t.incoming && t.status==="pending").map(t=>(
                <div className="cb-notice" key={t.id}>
                  {t.workspaceName} 관리 권한 이전 요청
                  <button className="cb-primary" disabled={busy} onClick={()=>setConfirm({text:"이 기관의 관리 권한을 수락할까요?",command:{type:"acceptTransfer",workspaceId:t.workspaceId,id:t.id,version:t.version}})}>이전 수락</button>
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
                    기관 이름
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      required
                    />
                  </label>
                  <button className="cb-primary" disabled={busy}>
                    작업 그룹 생성
                  </button>
                  {isMock && (
                    <p className="cb-muted">
                      모의 환경에는 온유요양센터가 있습니다. 기존 담당자의
                      설정에서 권한을 이전받을 수 있어요.
                    </p>
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
                    초대코드
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder={isMock ? "CARE2026" : "초대코드 입력"}
                      required
                    />
                  </label>
                  <button
                    className="cb-primary"
                    disabled={
                      busy ||
                      data.membership?.status === "pending" ||
                      data.membership?.status === "removed"
                    }
                  >
                    참여 요청
                  </button>
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
                        ? "오늘의 기록, 함께 확인해요"
                        : "작은 관찰을, 놓치지 않도록"
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
                          ? "＋ 새 메모 작성"
                          : "검토함 열기 ↗"}
                      </button>
                    }
                  >
                    원문부터 검토까지. 확인된 기록을 필요한 사람에게 전달하세요.
                  </Heading>
                  <div className="cb-stats">
                    {(["pending", "held", "confirmed"] as const).map((s, i) => (
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
                          <small>{statusNames[s]}</small>
                          <strong>
                            {counts[s]}
                            <em>건</em>
                          </strong>
                          <p>
                            {
                              [
                                "확인이 필요한 기록",
                                "추가 확인을 기다리는 기록",
                                "담당자가 확인한 기록",
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
                              ? "검토가 필요한 메모"
                              : "최근 제출한 메모"}
                          </h2>
                          <p>각 제출 건의 진행 상황을 확인하세요.</p>
                        </div>
                        <button
                          className="cb-text"
                          onClick={() => navigate("notes")}
                        >
                          전체 보기 →
                        </button>
                      </div>
                      {noteTable(
                        (role === "reviewer"
                          ? notes.filter((n) => n.status !== "confirmed")
                          : notes
                        ).slice(0, 5),
                      )}
                    </section>
                    <aside className="cb-side-cards">
                      <section className="cb-card cb-focus">
                        <span className="cb-eyebrow">NEXT ACTION</span>
                        <h2>
                          {role === "reviewer"
                            ? "함께할 동료가 기다려요"
                            : "이렇게 기록해 주세요"}
                        </h2>
                        <p>
                          {role === "reviewer"
                            ? `${pendingMembers.length}명의 참여 요청을 확인하고 역할에 맞는 업무를 연결해 주세요.`
                            : "직접 관찰한 사실, 당사자의 말, 제공한 지원을 구분하면 더 명확한 기록이 됩니다."}
                        </p>
                        <button
                          className="cb-text"
                          onClick={() =>
                            navigate(
                              role === "reviewer" ? "requests" : "compose",
                            )
                          }
                        >
                          {role === "reviewer"
                            ? "참여 요청 확인"
                            : "메모 작성하기"}{" "}
                          →
                        </button>
                      </section>
                      <section className="cb-card cb-principle">
                        <span>✧</span>
                        <h3>최종 확인은 사람의 몫</h3>
                        <p>
                          초안에 없는 사실을 추측하지 않아요.
                          <br />
                          원문을 확인하고 신중하게 전달해요.
                        </p>
                      </section>
                    </aside>
                  </div>
                  <section className="cb-flow">
                    <div>
                      <h3>케어브릿지 기록 과정</h3>
                      <small>관찰이 안전하게 전달되는 네 단계</small>
                    </div>
                    {[
                      "메모 작성",
                      "AI 초안 확인",
                      "담당자 검토",
                      "선별한 기록 공개",
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
                        ? "메모 보완 · 새 제출"
                        : "관찰 메모 작성"
                    }
                    action={
                      <span className="cb-step-label">
                        01 입력 → 02 확인 → 03 제출
                      </span>
                    }
                  >
                    원문을 작성하고 초안을 확인한 뒤, 담당자에게 제출하세요.
                  </Heading>
                  <div className="cb-compose-grid">
                    <section className="cb-card cb-form-card">
                      <div className="cb-form-row">
                        <label>
                          돌봄 대상
                          <select
                            value={draft.subjectId}
                            onChange={(e) => {
                              setRequestId(crypto.randomUUID());
                              setDraft((d) => ({
                                ...d,
                                subjectId: e.target.value,
                              }));
                            }}
                          >
                            <option value="">대상자를 선택하세요</option>
                            {subjects.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} · #{String(s.number).padStart(3, "0")}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          작성 언어
                          <select
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
                            <option value="ko">한국어</option>
                            <option value="en">English</option>
                            <option value="vi">Tiếng Việt</option>
                            <option value="id">Bahasa Indonesia</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        원문 메모
                        <textarea
                          rows={8}
                          maxLength={4000}
                          value={draft.source}
                          onChange={(e) => {
                            generation.current++;
                            setRequestId(crypto.randomUUID());
                            setDraft((d) => ({ ...d, source: e.target.value }));
                          }}
                          placeholder="직접 관찰한 사실과 제공한 지원을 적어 주세요."
                        />
                      </label>
                      <div className="cb-field-footer">
                        <span>모르는 내용은 추측하지 않고 남겨 주세요.</span>
                        <span>
                          {draft.source.length.toLocaleString()} / 4,000
                        </span>
                      </div>
                      <button
                        className="cb-primary"
                        disabled={busy || !draft.source.trim() || !isMock}
                        onClick={() =>
                          draft.generated
                            ? setRegenerate(true)
                            : void generate()
                        }
                      >
                        {busy
                          ? "처리 중…"
                          : draft.generated
                            ? "초안 다시 생성"
                            : "✧ 초안 만들기"}
                      </button>
                      {draft.generated && (
                        <div className="cb-draft-result">
                          <div className="cb-section-title">
                            <h2>초안 확인 · 수정</h2>
                            <Badge status="pending" />
                          </div>
                          {draft.generatedSource !== draft.source && (
                            <div className="cb-notice">
                              원문 또는 언어가 변경됐습니다. 초안을 다시 생성해
                              주세요.
                            </div>
                          )}
                          {isMock && (
                            <p className="cb-muted">
                              화면 QA용 모의 결과입니다. 실제 번역이나 의미
                              검사를 수행하지 않습니다.
                            </p>
                          )}
                          <label>
                            제출할 최종 초안
                            <textarea
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
                            <summary>최초 생성 결과 보기</summary>
                            <pre>{draft.generated}</pre>
                          </details>
                          <p className="cb-muted">
                            전송마다 새 검토 건이 쌓이며, 이전 제출 내용은
                            유지됩니다.
                          </p>
                          <button
                            className="cb-primary"
                            disabled={
                              busy ||
                              !draft.subjectId ||
                              !draft.final.trim() ||
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
                            확인했어요 · 검토 요청 →
                          </button>
                        </div>
                      )}
                    </section>
                    <aside className="cb-card cb-guide">
                      <span className="cb-eyebrow">WRITING GUIDE</span>
                      <h2>이렇게 기록해 주세요</h2>
                      {[
                        [
                          "◎",
                          "직접 관찰한 사실",
                          "식사량, 수면 모습, 활동 모습 등 직접 본 내용을 구체적으로 적어 주세요.",
                        ],
                        [
                          "❝",
                          "당사자가 한 말",
                          "“무릎이 불편해요”처럼 표현을 그대로 남겨 주세요.",
                        ],
                        [
                          "♧",
                          "제공한 지원",
                          "이동 보조, 식사 도움 등 실제 제공한 지원을 구분해 주세요.",
                        ],
                        [
                          "◷",
                          "추가로 확인할 사항",
                          "확인하지 못한 내용은 미확인으로 남겨 주세요.",
                        ],
                      ].map(([icon, title, text]) => (
                        <div className="cb-guide-item" key={title}>
                          <span>{icon}</span>
                          <div>
                            <h3>{title}</h3>
                            <p>{text}</p>
                          </div>
                        </div>
                      ))}
                      <div className="cb-notice">
                        음성 입력은 전사 API 계약 확정 후 연결할 예정입니다.
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
                    각 제출 건의 내용과 진행 상황을 확인하세요.
                  </Heading>
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
                              ? "전체"
                              : statusNames[f as keyof typeof statusNames]}{" "}
                            <span>
                              {f === "all"
                                ? notes.length
                                : counts[f as keyof typeof counts]}
                            </span>
                          </button>
                        ))}
                      </div>
                      <input
                        aria-label="메모 검색"
                        className="cb-search"
                        placeholder="대상자, 작성자, 메모 검색"
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
                    title="함께할 구성원을 확인해요"
                    action={
                      <span className="cb-count">
                        {pendingMembers.length}건 대기
                      </span>
                    }
                  >
                    초대코드로 요청한 사용자는 승인 후에 업무를 시작할 수
                    있어요.
                  </Heading>
                  <section className="cb-card">
                    {pendingMembers.length ? (
                      pendingMembers.map((m) => (
                        <div className="cb-member-row" key={m.userId}>
                          <span className="cb-avatar">{m.name[0]}</span>
                          <div className="cb-grow">
                            <h3>{m.name}</h3>
                            <p>
                              {roleNames[m.role]}
                              {m.requestedAt &&
                                ` · 요청 ${stamp(m.requestedAt)}`}
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
                            거절
                          </button>
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
                            참여 승인
                          </button>
                        </div>
                      ))
                    ) : (
                      <Empty title="대기 중인 요청이 없습니다">
                        새로운 참여 요청이 도착하면 표시됩니다.
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {page === "members" && (
                <>
                  <Heading
                    eyebrow="PEOPLE"
                    title="함께하는 구성원"
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
                        초대코드 {data.workspace?.code} ⧉
                      </button>
                    }
                  >
                    참여 권한과 기록 공개 권한은 각각 관리됩니다.
                  </Heading>
                  <section className="cb-card">
                    {members
                      .filter((m) => m.status !== "pending")
                      .map((m) => (
                        <div className="cb-member-row" key={m.userId}>
                          <span className="cb-avatar">{m.name[0]}</span>
                          <div className="cb-grow">
                            <h3>{m.name}</h3>
                            <p>
                              {roleNames[m.role]}
                              {m.requestedAt &&
                                ` · 요청 ${stamp(m.requestedAt)}`}
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
                              퇴출
                            </button>
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
                    title="돌봄 대상"
                    action={
                      <button
                        className="cb-primary"
                        onClick={() => setSubjectForm(true)}
                      >
                        ＋ 대상자 등록
                      </button>
                    }
                  >
                    이름으로 찾고, 관리번호로 정확하게 구분하세요.
                  </Heading>
                  <input
                    className="cb-search"
                    aria-label="대상자 검색"
                    placeholder="이름 또는 관리번호 검색"
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
                          <p>{s.memo || "등록된 메모가 없습니다."}</p>
                          <small>수신자는 공개할 때 직접 선택합니다</small>
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
                        ? "나에게 전달된 기록"
                        : "확인하고, 필요한 사람에게"
                    }
                  >
                    {role === "reader"
                      ? "담당자가 확인하고 나에게 공개한 내용만 모았습니다."
                      : "확정된 기록의 공개 내용과 수신자를 직접 결정하세요."}
                  </Heading>
                  {role === "reviewer" && (
                    <section className="cb-card cb-unpublished">
                      <div className="cb-section-title">
                        <h2>공개 준비</h2>
                        <small>확정과 공개는 별도 단계입니다</small>
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
                              내용·수신자 선택
                            </button>
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
                          공개 준비 중인 확정 기록이 없습니다.
                        </p>
                      )}
                    </section>
                  )}
                  <div className="cb-publication-grid">
                    {pubs.map((p) => (
                      <article className="cb-card cb-publication" key={p.id}>
                        <div className="cb-publication-head">
                          <Badge status={p.state} />
                          <small>{stamp(p.publishedAt)}</small>
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
                            전달 내용 읽기 →
                          </button>
                        ) : (
                          <>
                            <div className="cb-recipient-list">
                              수신자{" "}
                              {p.recipients
                                .map(
                                  (id) =>
                                    members.find((m) => m.userId === id)
                                      ?.name || id,
                                )
                                .join(", ") || "없음"}
                            </div>
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
                                      const n = notes.find(
                                        (n) => n.id === p.submissionId,
                                      );
                                      if (n) openPublish(n, isMock ? p : {...p, version:p.version+1, state:"revoked"});
                                    }
                                  }}
                                >
                                  차단 후 내용·수신자 정정
                                </button>
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
                                  철회
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                  {!pubs.length && (
                    <section className="cb-card">
                      <Empty title="아직 전달된 기록이 없습니다">
                        담당자가 내용을 공개하면 여기에서 확인할 수 있어요.
                      </Empty>
                    </section>
                  )}
                </>
              )}
              {page === "history" && (
                <>
                  <Heading eyebrow="ACTIVITY LOG" title="검토와 관리의 발자취">
                    작업 그룹에서 수행한 업무 이력을 확인하세요.
                  </Heading>
                  <section className="cb-card">
                    {data.audit.length ? (
                      data.audit.map((a) => (
                        <div className="cb-audit-row" key={a.id}>
                          <span className="cb-audit-dot" />
                          <div className="cb-grow">
                            <h3>{a.text}</h3>
                            <p>{a.actor}</p>
                            {a.details && (
                              <details>
                                <summary>변경 내용 확인</summary>
                                <pre>{a.details}</pre>
                              </details>
                            )}
                          </div>
                          <time>{stamp(a.at)}</time>
                        </div>
                      ))
                    ) : (
                      <Empty title="새로운 활동을 기다리고 있어요">
                        검토·참여 승인·공개 등의 활동이 기록됩니다.
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {page === "settings" && (
                <>
                  <Heading eyebrow="ACCOUNT & WORKSPACE" title="설정">
                    내 계정과 작업 그룹 정보를 확인하세요.
                  </Heading>
                  <section className="cb-card cb-form-card cb-settings">
                    <h2>계정 정보</h2>
                    <dl>
                      <dt>이름</dt>
                      <dd>{user.name}</dd>
                      <dt>{user.admin ? "현재 역할" : "가입 역할"}</dt>
                      <dd>
                        {roleNames[role]}
                      </dd>
                      <dt>작업 그룹</dt>
                      <dd>{data.workspace?.name}</dd>
                    </dl>
                    {user.admin ? <label>
                      사용 역할
                      <select aria-label="사용 역할" value={role} disabled={busy} onChange={e => void selectRole(e.target.value as Role)}>
                        {Object.entries(roleNames).map(([r, n], i) => <option key={r} value={r}>{i + 1}그룹 · {n}</option>)}
                      </select>
                    </label> : <p className="cb-muted">
                      역할은 회원가입 시 고정됩니다.
                    </p>}
                    {role === "reviewer" && !user.admin && (
                      <>
                        <hr />
                        <h2>관리 권한 이전</h2>
                        <p>
                          새 담당자에게 구성원과 기록 관리 권한을 넘깁니다.
                          완료하면 현재 담당자의 권한이 종료됩니다.
                        </p>
                        {isMock && (
                          <div className="cb-notice">
                            로컬 QA에서는 즉시 이전을 시뮬레이션합니다. 실제
                            초대·수락 방식은 백엔드와 협의할 예정입니다.
                          </div>
                        )}
                        <p className="cb-muted">내 사용자 ID: {user.id}</p>
                        <label>
                          새 2그룹 담당자
                          {!isMock ? <input value={transfer} onChange={e=>setTransfer(e.target.value)} placeholder="이전받을 담당자의 사용자 ID" /> : <select
                            value={transfer}
                            onChange={(e) => setTransfer(e.target.value)}
                          >
                            <option value="">담당자를 선택하세요</option>
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
                          관리 권한 이전
                        </button>
                        {(data.transfers ?? []).filter(t=>!t.incoming).map(t=>(
                          <div className="cb-notice" key={t.id}>
                            {t.targetName} · {t.status === "pending" ? "수락 대기" : t.status === "completed" ? "이전 완료" : "취소됨"}
                            {t.status==="pending" && <button className="cb-text" disabled={busy} onClick={()=>setConfirm({text:"이전 요청을 취소할까요?",command:{type:"cancelTransfer",workspaceId:t.workspaceId,id:t.id,version:t.version}})}>요청 취소</button>}
                          </div>
                        ))}
                      </>
                    )}
                    {isMock && user.admin && (
                      <>
                        <hr />
                        <h2>로컬 QA 데이터</h2>
                        <p>
                          이 브라우저의 합성 데이터를 초기 시나리오로
                          되돌립니다.
                        </p>
                        <button
                          className="cb-secondary"
                          onClick={() => {
                            (gateway as MockGateway).reset();
                            setToast("합성 데이터를 초기화했습니다.");
                          }}
                        >
                          합성 데이터 초기화
                        </button>
                      </>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </main>
        <footer className="cb-footer">
          CareBridge <span>함께 만드는, 더 나은 돌봄 기록</span>
        </footer>
      </div>
      {regenerate && (
        <Modal
          title="초안을 다시 생성할까요?"
          close={() => setRegenerate(false)}
        >
          <p>
            다시 생성하면 현재 초안과 직접 수정한 내용이 새 결과로 바뀝니다.
            취소하면 작성한 내용이 유지됩니다.
          </p>
          <div className="cb-modal-actions">
            <button
              className="cb-secondary"
              onClick={() => setRegenerate(false)}
            >
              취소
            </button>
            <button className="cb-primary" onClick={() => void generate()}>
              새 초안 생성
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="cb-toast" role="status">
          ✓ {toast}
        </div>
      )}
      {note && active && (
        <Modal
          title={role === "reviewer" ? "메모 검토" : "내 메모 상세"}
          close={() => setSelected(null)}
        >
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
              <h3>원문 메모</h3>
              <pre>{note.source}</pre>
              <small>제출 당시 원문 · 변경되지 않습니다</small>
            </section>
            <section>
              <h3>작성자가 확인한 초안</h3>
              <pre>{note.final}</pre>
              <details>
                <summary>최초 생성 결과</summary>
                <pre>{note.generated}</pre>
              </details>
            </section>
          </div>
          {note.reason && (
            <div className="cb-notice">
              <b>검토 사유</b>
              <p>{note.reason}</p>
            </div>
          )}
          {!isMock && (note.warnings ?? []).length > 0 && <div className="cb-notice">
            <b>저장된 검사 확인사항</b>
            {note.warnings!.map((warning,i)=><p key={i}>{warning}</p>)}
          </div>}
          {role === "reviewer" && note.status !== "confirmed" ? (
            <>
              {!isMock && <div className="cb-notice">
                <label><input type="checkbox" checked={sourceChecked} onChange={e=>setSourceChecked(e.target.checked)} /> 원문을 대조했습니다.</label>
                <label><input type="checkbox" checked={checksChecked} onChange={e=>setChecksChecked(e.target.checked)} /> 확인사항과 경고를 확인했습니다. 경고가 있어도 확정할 수 있습니다.</label>
                최종 내용에 연결된 검사 결과가 없으면 서버가 확정을 거절합니다. 이번 단계에서는 AI 검사를 새로 실행하지 않습니다.
              </div>}
              <label>
                검토 내용
                <textarea
                  rows={5}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                />
              </label>
              <label>
                검토·보류 사유
                <textarea
                  rows={2}
                  placeholder="보류할 때는 사유를 반드시 남겨 주세요."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="cb-modal-actions">
                {(["held", "pending", "confirmed"] as const).map((s) => (
                  <button
                    key={s}
                    className={
                      s === "confirmed" ? "cb-primary" : "cb-secondary"
                    }
                    disabled={busy || !review.trim() || (!isMock && s === "confirmed" && (!sourceChecked || !checksChecked))}
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
                      ? "보류"
                      : s === "pending"
                        ? "수정 저장"
                        : "검토 완료 · 확정"}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {note.review && (
                <section className="cb-approved-content">
                  <h3>담당자 검토 내용</h3>
                  <pre>{note.review}</pre>
                </section>
              )}
              <div className="cb-modal-actions">
                {role === "author" ? (
                  <button className="cb-primary" onClick={() => edit(note)}>
                    {note.status === "held"
                      ? "보완 후 재검토 요청"
                      : "수정해서 새로 제출"}
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
                      ? "공개 기록 관리"
                      : "공개 내용·수신자 선택"}
                  </button>
                )}
              </div>
            </>
          )}
          <details className="cb-history-details">
            <summary>
              이 메모의 제출 이력 (
              {notes.filter((n) => n.threadId === note.threadId).length})
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
              {error}
            </div>
          )}
        </Modal>
      )}
      {publishId && active && role === "reviewer" && (
        <Modal
          title={preview ? "공개 전 마지막 확인" : "공개 내용과 수신자 선택"}
          close={() => setPublishId(null)}
        >
          {preview ? (
            <>
              <div className="cb-approved-content">
                <pre>{publishContent}</pre>
              </div>
              <p>
                수신자:{" "}
                <b>
                  {members
                    .filter((m) => recipients.includes(m.userId))
                    .map((m) => m.name)
                    .join(", ")}
                </b>
              </p>
              <div className="cb-notice">
                공개 버튼을 눌러야 선택한 수신자가 열람할 수 있습니다.
              </div>
              <div className="cb-modal-actions">
                <button
                  className="cb-secondary"
                  onClick={() => setPreview(false)}
                >
                  이전
                </button>
                <button
                  className="cb-primary"
                  disabled={busy}
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
                  선택한 수신자에게 공개
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                공개할 내용
                <textarea
                  rows={8}
                  value={publishContent}
                  onChange={(e) => setPublishContent(e.target.value)}
                />
              </label>
              <h3>수신자 직접 선택</h3>
              <p className="cb-muted">
                대상자와 연결된 수신자를 자동으로 선택하지 않습니다.
              </p>
              {members
                .filter((m) => m.role === "reader" && m.status === "active")
                .map((m) => (
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
                  disabled={!publishContent.trim() || !recipients.length}
                  onClick={() => setPreview(true)}
                >
                  공개 내용 미리보기 →
                </button>
              </div>
            </>
          )}
          {error && (
            <div className="cb-error" role="alert">
              {error}
            </div>
          )}
        </Modal>
      )}
      {readerId && (
        <Modal
          title={
            publication
              ? `${publication.subjectName} · #${String(publication.subjectNumber).padStart(3, "0")}`
              : "열람할 수 없는 기록"
          }
          close={() => setReaderId(null)}
        >
          {publication && active && !offline ? (
            <>
              <span className="cb-lock-label">
                ✓ 담당자가 확인하고 공개한 기록
              </span>
              <div className="cb-reader-content">
                <pre>{publication.content}</pre>
              </div>
              <small className="cb-muted">
                공개 시각 {stamp(publication.publishedAt)}
              </small>
            </>
          ) : (
            <Empty title="기록 표시가 중단되었습니다">
              공개 범위 또는 참여 권한이 변경되었거나 연결을 확인하고 있습니다.
            </Empty>
          )}
        </Modal>
      )}
      {subjectForm && role === "reviewer" && active && (
        <Modal title="돌봄 대상 등록" close={() => setSubjectForm(false)}>
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
              이름
              <input
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                required
                maxLength={80}
              />
            </label>
            <label>
              메모 <small>선택</small>
              <textarea
                rows={3}
                value={subjectMemo}
                onChange={(e) => setSubjectMemo(e.target.value)}
              />
            </label>
            <p className="cb-muted">
              관리번호는 등록 순서로 자동 부여됩니다. 동명이인도 등록할 수
              있어요.
            </p>
            <button className="cb-primary" disabled={busy}>
              등록하기
            </button>
            {error && <p className="cb-error">{error}</p>}
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title="작업을 확인해 주세요" close={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="cb-modal-actions">
            <button className="cb-secondary" onClick={() => setConfirm(null)}>
              취소
            </button>
            <button
              className="cb-primary"
              disabled={busy}
              onClick={async () => {
                if (await action(confirm.command, "처리했습니다."))
                  setConfirm(null);
              }}
            >
              확인하고 진행
            </button>
          </div>
          {error && <p className="cb-error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}

import { GuestApp } from "./GuestApp";
import { useCallback, useEffect, useState } from "react";
import {
  authApi,
  colorFor,
  fromBackendEvent,
  fromBackendSchedule,
  groupsApi,
  loadGroupId,
  loadSession,
  saveGroupId,
  saveSession,
  ApiError,
  type GroupDetail,
  type GroupMember,
  type Session,
} from "./api";
import { type Member } from "./data";
import { Shell, type NavItem } from "./Shell";
import { Icon } from "./ui";
import { Dashboard } from "./Dashboard";
import { RealAuth } from "./RealAuth";
import { RealGroupSetup } from "./RealGroupSetup";
import { RealRecords } from "./RealRecords";
import { RealSchedules } from "./RealSchedules";
import { RealFamily } from "./RealFamily";

import { CarebridgePage } from "./CarebridgePage";
import { RealAssistant } from "./RealAssistant";
import { RealProfile } from "./RealProfile";

export type RealPage =
  | "대시보드"
  | "돌봄 기록"
  | "일정"
  | "AI 인수인계"
  | "가족 관리"
  | "AI 비서"
  | "케어브릿지";
const navigation: NavItem[] = [
  { name: "대시보드", icon: "home", english: "Overview" },
  { name: "돌봄 기록", icon: "clock", english: "Care Timeline" },
  { name: "일정", icon: "calendar", english: "Schedule" },
  { name: "AI 인수인계", icon: "spark", english: "Care Handoff" },
  { name: "AI 비서", icon: "mic", english: "Assistant" },
  { name: "케어브릿지", icon: "file", english: "CareBridge" },
  { name: "가족 관리", icon: "users", english: "Our Family" },
];

const ROLE_LABEL: Record<GroupMember["role"], string> = {
  owner: "소유자",
  caregiver: "보호자",
  elder: "고령자",
};

export type RealCtx = {
  token: string;
  groupId: string;
  group: GroupDetail;
  members: Member[];
  session: Session;
  reload: () => Promise<void>;
  notify: (text: string) => void;
};

export function RealApp() {
  const [authIntent,setAuthIntent]=useState<"create"|"join"|"login"|null>(null);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [groupId, setGroupId] = useState<string | null>(loadGroupId);
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<RealPage>("대시보드");
  const [toast, setToast] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  const logout = useCallback(() => {
    setAuthIntent(null);
    saveSession(null);
    saveGroupId(null);
    setSession(null);
    setGroupId(null);
    setGroup(null);
    setMembers([]);
    setProfileOpen(false);
    setPage("대시보드");
    setToast("");
    setError("");
  }, []);

  const switchGroup = useCallback(() => {
    saveGroupId(null);
    setGroupId(null);
    setGroup(null);
    setMembers([]);
    setProfileOpen(false);
    setPage("대시보드");
    setToast("");
    setError("");
  }, []);

  const reload = useCallback(async () => {
    if (!session || !groupId) return;
    setLoading(true);
    setError("");
    try {
      const [g, m] = await Promise.all([
        groupsApi.get(session.accessToken, groupId),
        groupsApi.members(session.accessToken, groupId),
      ]);
      setGroup({ ...g, schedules: g.schedules.filter((schedule) => !schedule.deletedAt) });
      setMembers(m);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        return;
      }
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        saveGroupId(null);
        setGroupId(null);
        return;
      }
      setError(e instanceof Error ? e.message : "그룹 정보를 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, [session, groupId, logout]);

  useEffect(() => {
    Promise.resolve().then(() => void reload());
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!session) return;
    authApi.me(session.accessToken).catch((e) => {
      if (e instanceof ApiError && e.status === 401) logout();
    });
  }, [session, logout]);

  if (!session) return authIntent ? <RealAuth onBack={()=>setAuthIntent(null)} onAuthenticated={setSession} /> : <GuestApp onStart={setAuthIntent}/>;
  if (!groupId)
    return (
      <RealGroupSetup
        token={session.accessToken}
        initialAction={authIntent === "create" || authIntent === "join" ? authIntent : null}
        onGroupSelected={id=>{setGroupId(id);setAuthIntent(null);}}
        onLogout={logout}
      />
    );
  if (!group)
    return (
      <main className="production-gate">
        <Icon name="cloud" size={56} />
        <h1>Family Care Cloud</h1>
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button className="primary" onClick={() => void reload()}>
              다시 시도
            </button>
          </>
        ) : (
          <p>그룹 정보를 불러오는 중입니다…</p>
        )}
      </main>
    );

  const memberList: Member[] = members.map((m, i) => ({
    id: m.userId,
    name: m.name,
    relation: ROLE_LABEL[m.role],
    color: colorFor(i),
  }));
  const ctx: RealCtx = {
    token: session.accessToken,
    groupId,
    group,
    members: memberList,
    session,
    reload,
    notify: setToast,
  };
  const navigate = (p: string) => {
    setPage(p as RealPage);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <Shell
        page={page}
        navItems={navigation}
        navigate={navigate}
        name={session.user.name}
        onProfileClick={() => setProfileOpen(true)}
        toast={toast}
        onToastClose={() => setToast("")}
      >
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="text-button" onClick={() => void reload()}>
              다시 불러오기
            </button>
          </div>
        )}
        {loading && (
          <div className="inline-note" role="status">
            불러오는 중입니다…
          </div>
        )}
        <div hidden={page !== "돌봄 기록" && page !== "AI 인수인계"}>
          <RealRecords ctx={ctx} showHandoff={page === "AI 인수인계"} onHandoff={open=>setPage(open ? "AI 인수인계" : "돌봄 기록")} />
        </div>
        <div hidden={page !== "일정"}>
          <RealSchedules ctx={ctx} />
        </div>

        <div hidden={page !== "AI 비서"}>
          <RealAssistant ctx={ctx} />
        </div>
        {page === "케어브릿지" && <CarebridgePage key={ctx.groupId + ctx.token} ctx={ctx} />}
        <div hidden={page !== "가족 관리"}>
          <RealFamily ctx={ctx} />
        </div>
        <div hidden={page !== "대시보드"}>
          <Dashboard
            events={ctx.group.events.map(fromBackendEvent)}
            schedules={ctx.group.schedules.map(fromBackendSchedule)}
            members={ctx.members}
            current={ctx.group.primaryCaregiverId}
            next={ctx.group.nextCaregiverId}
            handoff={[...ctx.group.handoffs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]}
            elder={ctx.group.elder?.name ?? "고령자 미등록"}
            navigate={navigate}
            name={session.user.name}
            write={() => navigate("돌봄 기록")}
          />
        </div>
      </Shell>
      {profileOpen && (
        <RealProfile
          ctx={ctx}
          onClose={() => setProfileOpen(false)}
          onSessionChange={setSession}
          onLogout={logout}
          onSwitchGroup={() => {
            setProfileOpen(false);
            switchGroup();
          }}
        />
      )}
    </>
  );
}

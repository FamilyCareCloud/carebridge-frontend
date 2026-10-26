import { ViewportFit } from "./ViewportFit";
import { useState } from "react";
import { HomeDetail } from "./UxDetails";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./ui";

export type NavItem = { name: string; icon: IconName; english: string };
export function Shell({guest = false, page, navItems, navigate, name, onProfileClick, toast, onToastClose, children}: {
  guest?: boolean; page: string; navItems: NavItem[]; navigate: (name: string) => void; name: string;
  onProfileClick: () => void; toast: string; onToastClose: () => void; children: ReactNode;
}) {
  const [notifications,setNotifications]=useState(false);
  const primary = ["대시보드", "일정", "돌봄 기록", "케어브릿지", "가족 관리"].filter(key => navItems.some(item => item.name === key));
  const labels: Record<string, string> = { 대시보드: "홈", "가족 관리": "가족" };
  return <div className="ux-shell">{notifications && <HomeDetail kind="알림" onClose={()=>setNotifications(false)}/>}
    <a className="skip" href="#main">본문으로 이동</a>
    <header className="topbar">
      <a className="brand" href="#" onClick={e => {e.preventDefault(); navigate("대시보드");}}>
        <span className="brand-mark"><Icon name="heart" size={26}/></span>
        <span><b>Family Care Cloud</b><small>함께 돌보는, 우리 가족</small></span>
      </a>
      <div className="topbar-right">
        <span className="ux-notification"><button onClick={()=>setNotifications(true)} aria-label="알림 · 준비 중"><Icon name="clock" size={19}/></button><small>알림 준비 중</small></span>
        <button className="profile-button" aria-label={guest ? "로그인·회원가입" : "내 프로필 열기"} onClick={onProfileClick}>
          <span className="avatar green">{guest ? <Icon name="users" size={18}/> : name.slice(-2)}</span><span><b>{guest ? "로그인·회원가입" : `${name} 님`}</b><small>{guest ? "우리 가족과 시작하기" : "내 프로필"}</small></span>
        </button>
      </div>
    </header>
    <aside className="sidebar">
      <div className="nav-label">우리 가족의 공간</div>
      <nav aria-label="주 메뉴" style={{gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))`}}>{primary.map(key => {const item = navItems.find(n=>n.name===key); if (!item) return null; return <button key={key} onClick={()=>navigate(key)} className={`nav-item ${(page===key || (key==="돌봄 기록" && page==="AI 인수인계")) ? "active" : ""}`} aria-current={(page===key || (key==="돌봄 기록" && page==="AI 인수인계")) ? "page":undefined}><Icon name={item.icon}/><span>{labels[key]??key}</span></button>;})}</nav>
      <div className="ux-sidebar-extra"><div className="nav-label">돌봄 도구</div>{navItems.filter(n=>!primary.includes(n.name) && n.name!=="AI 인수인계").map(item=><button key={item.name} onClick={()=>navigate(item.name)} className={`nav-item ${page===item.name ? "active":""}`} aria-current={page===item.name ? "page":undefined}><Icon name={item.icon}/><span>{item.name}</span></button>)}<button className="nav-item" onClick={onProfileClick}><Icon name="settings"/><span>{guest ? "로그인" : "내 프로필"}</span></button></div>
      <div className="sidebar-bottom"><Icon name="heart" size={25}/><p>작은 기록 하나가<br/>든든한 돌봄이 되도록.</p><small>FAMILY CARE CLOUD</small></div>
    </aside>
    <main id="main" className="main">{page === "케어브릿지" ? <div className="carebridge-scroll">{children}</div> : <ViewportFit>{children}</ViewportFit>}</main>
    <button className="ux-voice" onClick={()=>navigate("AI 비서")} aria-label="AI 비서 열기"><Icon name="mic" size={23}/><span>AI 비서</span></button>
    {toast && <div className="toast" role="status"><Icon name="check" size={18}/>{toast}<button aria-label="알림 닫기" onClick={onToastClose}><Icon name="close" size={16}/></button></div>}
  </div>;
}

import type { WorkspaceRow } from "./gateway";
declare const __CAREBRIDGE_WS_PROXY__: boolean;
type Ticket = {ticket:string;websocketUrl:string;heartbeatSeconds:number};
type Options = {
  request:<T>(path:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
  openStream:(path:string,signal:AbortSignal)=>Promise<Response>;
  proof:(id:string|null)=>void;
  onChange:()=>void; onDisconnect:(message?:string,status?:number)=>void; onConnected:()=>void;
};
/** No active record may be rendered until an authenticated revalidate event. */
export function subscribeWorkspace(o: Options): ()=>void {
  const controller=new AbortController();
  let socket:WebSocket|undefined;
  let deadline:ReturnType<typeof setTimeout>|undefined;
  let poll:ReturnType<typeof setTimeout>|undefined;
  let renewal:ReturnType<typeof setInterval>|undefined;
  let validated=false;
  let verifiedState:string|undefined;
  function clear() {clearTimeout(deadline);clearTimeout(poll);clearInterval(renewal);}
  function stop() {clear();controller.abort();socket?.close();o.proof(null);}
  function fail(message="실시간 접근 확인 연결이 종료되었습니다.",status?:number) {
    if(controller.signal.aborted) return;
    stop();o.onDisconnect(message,status);
  }
  function arm(ms:number) {
    clearTimeout(deadline);
    deadline=setTimeout(()=>fail("접근 확인 유효시간이 지났습니다. 다시 연결해 주세요."),ms);
  }
  function verified(id:string, revision?:unknown, role?:unknown) {
    if(controller.signal.aborted) return;
    const state=typeof revision==="number" && Number.isSafeInteger(revision) && revision>=0 && typeof role==="string" && role.length>0
      ? JSON.stringify([revision,role]) : undefined;
    const unchanged=state!==undefined && state===verifiedState;
    verifiedState=state;
    o.proof(id);
    // A fresh authorization proof alone must not clear the current screen.
    // Changed or missing state still forces a reload, including missed invalidations.
    if(!validated) {validated=true;o.onConnected();} else if(!unchanged) o.onChange();
  }
  async function connect(w:WorkspaceRow) {
    // A pending screen may have been shown; hide it while establishing proof.
    o.proof(null); validated=false; verifiedState=undefined;
    const path="/workspaces/"+encodeURIComponent(w.workspaceId);
    const response=await o.openStream(path+"/events",controller.signal);
    if(controller.signal.aborted) return;
    if(!response.ok) throw new Error("실시간 API를 사용할 수 없습니다. 백엔드 배포 상태를 확인해 주세요.");
    if(response.headers.get("content-type")?.includes("text/event-stream") && response.body) {
      arm(45000);
      const reader=response.body.getReader(), decoder=new TextDecoder();
      let pending="";
      while(!controller.signal.aborted) {
        const {done,value}=await reader.read();
        if(done) throw new Error("실시간 연결이 종료되었습니다.");
        arm(45000);
        pending+=decoder.decode(value,{stream:true});
        pending=pending.replace(/\r\n/g,"\n");
        let end:number;
        while((end=pending.indexOf("\n\n"))>=0) {
          const frame=pending.slice(0,end);pending=pending.slice(end+2);
          if(frame.startsWith(":")) continue;
          if(frame.includes("event: access-revoked")) {fail("작업 그룹 접근 권한이 종료되었습니다.");return;}
          if(frame.includes("event: revalidate")) verified(w.workspaceId);
          else if(frame.split("\n").some(line=>line.startsWith("data:")) && validated) o.onChange();
        }
      }
      return;
    }
    const descriptor=await response.json();
    if(descriptor.transport!=="websocket" || !descriptor.websocketUrl) throw new Error("배포된 WebSocket 설정이 없습니다.");
    const ticketPath=path+"/event-tickets";
    const ticket=await o.request<Ticket>(ticketPath,{},controller.signal);
    if(controller.signal.aborted) return;
    const url=new URL(ticket.websocketUrl);
    if(!["wss:","ws:"].includes(url.protocol)) throw new Error("잘못된 실시간 연결 주소입니다.");
    url.searchParams.set("ticket",ticket.ticket);
    const useProxy=import.meta.env.DEV && typeof __CAREBRIDGE_WS_PROXY__ !== "undefined" && __CAREBRIDGE_WS_PROXY__;
    socket=new WebSocket(useProxy ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/backend-events${url.search}` : url.toString());
    let renewing=false;
    async function revalidate() {
      if(renewing || controller.signal.aborted || socket?.readyState!==WebSocket.OPEN)return;
      renewing=true;
      try {
        const proof=await o.request<Ticket>(ticketPath,{},controller.signal);
        if(!controller.signal.aborted && socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({action:"revalidate",ticket:proof.ticket}));
      } catch(e) {fail((e as Error).message,(e as {status?:number}).status);} finally {renewing=false;}
    }
    socket.onopen=()=>{
      void revalidate();
      renewal=setInterval(()=>void revalidate(),Math.min(20,Math.max(1,ticket.heartbeatSeconds))*1000);
    };
    socket.onmessage=event=>{
      if(controller.signal.aborted) return;
      try {
        const data=JSON.parse(event.data);
        if(data.workspaceId!==w.workspaceId) throw new Error("실시간 응답의 작업 그룹이 다릅니다.");
        if(data.type==="access-revoked") {fail("작업 그룹 접근 권한이 종료되었습니다.");return;}
        if(data.type==="revalidate") {
          const remaining=data.validUntil*1000-Date.now();
          if(!Number.isFinite(remaining) || remaining<=0) throw new Error("접근 확인 응답이 만료되었습니다.");
          arm(Math.min(remaining,60000));verified(w.workspaceId,data.revision,data.role);
        } else if(data.type==="invalidate" && validated) o.onChange();
        // heartbeat deliberately does not renew authorization.
      } catch(e) {fail((e as Error).message);}
    };
    socket.onerror=()=>fail("실시간 연결에 실패했습니다. 배포 설정과 허용 출처를 확인해 주세요.");
    socket.onclose=()=>fail();
  }
  let previous="";
  async function discover() {
    try {
      const rows=await o.request<WorkspaceRow[]>("/workspaces",undefined,controller.signal);
      if(controller.signal.aborted)return;
      const active=rows.find(w=>w.status==="active");
      if(active) {arm(45000);await connect(active);return;}
      clearTimeout(deadline);
      const signature=JSON.stringify(rows);
      if(!validated) {validated=true;o.onConnected();}
      else if(signature!==previous)o.onChange();
      previous=signature;
      // Pending membership has no sensitive business data and cannot subscribe.
      poll=setTimeout(()=>{arm(45000);void discover();},5000);
    } catch(e) {fail((e as Error).message,(e as {status?:number}).status);}
  }
  arm(45000);void discover();
  return stop;
}

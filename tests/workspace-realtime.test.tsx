import { afterEach, expect, it, vi } from "vitest";
import { subscribeWorkspace } from "../src/workspace/realtime";
class Socket {
 static OPEN=1; static instances:Socket[]=[];
 readyState=0; onopen:(()=>void)|null=null; onmessage:((e:{data:string})=>void)|null=null; onclose:(()=>void)|null=null; onerror:(()=>void)|null=null;
 send=vi.fn(); close=vi.fn(()=>{this.readyState=3;this.onclose?.();});
 url:string;
 constructor(url:string){this.url=url;Socket.instances.push(this);}
 open(){this.readyState=1;this.onopen?.();}
 message(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
const cleanup:(()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).forEach(f=>f());vi.unstubAllGlobals();vi.useRealTimers();Socket.instances=[];});
async function setup(){
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-29T00:00:00Z"));vi.stubGlobal("WebSocket",Socket);
 let count=0;
 const request=vi.fn(async(path:string)=>path==="/workspaces"?[{workspaceId:"w",status:"active"}]:{ticket:"ticket-"+(++count),websocketUrl:"wss://events.example/stage",heartbeatSeconds:20});
 const proof=vi.fn(),ready=vi.fn(),changed=vi.fn(),failed=vi.fn();
 const stop=subscribeWorkspace({request:request as never,openStream:async()=>new Response(JSON.stringify({transport:"websocket",websocketUrl:"wss://events.example/stage"}),{headers:{"content-type":"application/json"}}),proof,onConnected:ready,onChange:changed,onDisconnect:failed});
 cleanup.push(stop);
 await vi.advanceTimersByTimeAsync(0);
 const socket=Socket.instances[0];
 return {socket,proof,ready,changed,failed,request,stop};
}
it("waits for a new-ticket proof after socket open and forwards invalidation",async()=>{
 const {socket,ready,changed,request}=await setup();
 expect(socket.url).toContain("ticket=ticket-1");expect(socket.url).not.toContain("Bearer");
 socket.open();await vi.advanceTimersByTimeAsync(0);
 expect(socket.send).toHaveBeenCalledWith(JSON.stringify({action:"revalidate",ticket:"ticket-2"}));
 expect(ready).not.toHaveBeenCalled();
 socket.message({type:"revalidate",workspaceId:"w",validUntil:Date.now()/1000+60});
 expect(ready).toHaveBeenCalledOnce();
 socket.message({type:"invalidate",workspaceId:"w"});expect(changed).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(20000);expect(request).toHaveBeenCalledTimes(4);
});
it("preserves authentication status on failed ticket renewal and clears proof",async()=>{
 const {socket,request,failed,proof}=await setup();
 socket.open();await vi.advanceTimersByTimeAsync(0);
 socket.message({type:"revalidate",workspaceId:"w",validUntil:Date.now()/1000+60});
 request.mockRejectedValueOnce(Object.assign(new Error("다시 로그인해 주세요."),{status:401}));
 await vi.advanceTimersByTimeAsync(20000);
 expect(failed).toHaveBeenCalledWith("다시 로그인해 주세요.",401);
 expect(proof).toHaveBeenLastCalledWith(null);
});
it("heartbeat never extends the authorization deadline",async()=>{
 const {socket,failed,proof}=await setup();
 socket.open();await vi.advanceTimersByTimeAsync(0);
 socket.message({type:"revalidate",workspaceId:"w",validUntil:Date.now()/1000+60});
 await vi.advanceTimersByTimeAsync(59000);
 socket.message({type:"heartbeat",workspaceId:"w"});
 await vi.advanceTimersByTimeAsync(1000);
 expect(failed).toHaveBeenCalledOnce();expect(proof).toHaveBeenLastCalledWith(null);
});
it("keeps the screen through repeated unchanged proofs while renewing the access deadline",async()=>{
 const {socket,ready,changed,failed,proof}=await setup();
 socket.open();await vi.advanceTimersByTimeAsync(0);
 const renew=()=>socket.message({type:"revalidate",workspaceId:"w",revision:7,role:"viewer",validUntil:Date.now()/1000+60});
 renew();
 for(let i=0;i<9;i++) {await vi.advanceTimersByTimeAsync(20000);renew();}
 expect(ready).toHaveBeenCalledOnce();expect(changed).not.toHaveBeenCalled();
 expect(failed).not.toHaveBeenCalled();expect(proof).toHaveBeenLastCalledWith("w");
 // Ordinary heartbeat messages cannot keep stale authorization alive.
 await vi.advanceTimersByTimeAsync(59000);
 socket.message({type:"heartbeat",workspaceId:"w"});
 await vi.advanceTimersByTimeAsync(1000);
 expect(failed).toHaveBeenCalledOnce();expect(proof).toHaveBeenLastCalledWith(null);
});
it("reloads on revision or role changes even when the invalidation event was missed",async()=>{
 const {socket,changed}=await setup();
 const renew=(revision:number,role:string)=>socket.message({type:"revalidate",workspaceId:"w",revision,role,validUntil:Date.now()/1000+60});
 renew(7,"viewer");renew(8,"viewer");
 expect(changed).toHaveBeenCalledTimes(1);
 renew(8,"viewer");expect(changed).toHaveBeenCalledTimes(1);
 renew(8,"author");expect(changed).toHaveBeenCalledTimes(2);
 // Explicit invalidation must still hide records immediately, even at the same revision.
 socket.message({type:"invalidate",workspaceId:"w",revision:8});
 expect(changed).toHaveBeenCalledTimes(3);
});
it("does not suppress refreshes when proof revision metadata is missing or malformed",async()=>{
 const {socket,changed}=await setup();
 const renew=(revision?:unknown,role?:string)=>socket.message({type:"revalidate",workspaceId:"w",revision,role,validUntil:Date.now()/1000+60});
 renew(7,"viewer");renew();renew();renew("7","viewer");renew(7);
 expect(changed).toHaveBeenCalledTimes(4);
});
it("revocation after unchanged renewals still clears the access proof immediately",async()=>{
 const {socket,failed,proof}=await setup();
 const renewal={type:"revalidate",workspaceId:"w",revision:7,role:"viewer",validUntil:Date.now()/1000+60};
 socket.message(renewal);socket.message(renewal);
 socket.message({type:"access-revoked",workspaceId:"w"});socket.message(renewal);
 expect(failed).toHaveBeenCalledOnce();expect(proof).toHaveBeenLastCalledWith(null);
 expect(socket.close).toHaveBeenCalledOnce();
});
it("revocation closes the channel and ignores late successful proof",async()=>{
 const {socket,failed,ready}=await setup();socket.open();await vi.advanceTimersByTimeAsync(0);
 socket.message({type:"access-revoked",workspaceId:"w"});
 socket.message({type:"revalidate",workspaceId:"w",validUntil:Date.now()/1000+60});
 expect(failed).toHaveBeenCalledOnce();expect(ready).not.toHaveBeenCalled();expect(socket.close).toHaveBeenCalled();
});
it("reads split local SSE frames and clears access on stream termination",async()=>{
 let stream!:ReadableStreamDefaultController<Uint8Array>;
 const ready=vi.fn(),failed=vi.fn(),changed=vi.fn();
 const stop=subscribeWorkspace({request:(async()=>[{workspaceId:"w",status:"active"}]) as never,openStream:async()=>new Response(new ReadableStream<Uint8Array>({start(c){stream=c;}}),{headers:{"content-type":"text/event-stream"}}),proof:vi.fn(),onConnected:ready,onChange:changed,onDisconnect:failed});
 cleanup.push(stop);await vi.waitFor(()=>expect(stream).toBeDefined());
 const encoder=new TextEncoder();
 stream.enqueue(encoder.encode("event: revalidate\r\ndata: {}\r"));
 stream.enqueue(encoder.encode("\n\r\n"));
 await vi.waitFor(()=>expect(ready).toHaveBeenCalledOnce());
 stream.enqueue(encoder.encode("event: invalidate\ndata: {}\n\n"));
 await vi.waitFor(()=>expect(changed).toHaveBeenCalledOnce());
 stream.close();await vi.waitFor(()=>expect(failed).toHaveBeenCalledOnce());
});
it("times out discovery and aborts unfinished requests",async()=>{
 vi.useFakeTimers();const failed=vi.fn();let signal:AbortSignal|undefined;
 cleanup.push(subscribeWorkspace({request:((_p:string,_b:unknown,s:AbortSignal)=>{signal=s;return new Promise(()=>{});}) as never,openStream:vi.fn(),proof:vi.fn(),onConnected:vi.fn(),onChange:vi.fn(),onDisconnect:failed}));
 await vi.advanceTimersByTimeAsync(45000);
 expect(failed).toHaveBeenCalledOnce();expect(signal?.aborted).toBe(true);
});

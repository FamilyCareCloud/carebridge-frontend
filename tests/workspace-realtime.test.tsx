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
it("heartbeat never extends the authorization deadline",async()=>{
 const {socket,failed,proof}=await setup();
 socket.open();await vi.advanceTimersByTimeAsync(0);
 socket.message({type:"revalidate",workspaceId:"w",validUntil:Date.now()/1000+60});
 await vi.advanceTimersByTimeAsync(59000);
 socket.message({type:"heartbeat",workspaceId:"w"});
 await vi.advanceTimersByTimeAsync(1000);
 expect(failed).toHaveBeenCalledOnce();expect(proof).toHaveBeenLastCalledWith(null);
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

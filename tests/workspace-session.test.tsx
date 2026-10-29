import { afterEach, expect, it, vi } from "vitest";
import { HttpGateway } from "../src/workspace/gateway";
import type { Session } from "../src/workspace/model";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const user={id:"u",name:"사용자",role:"author" as const};
const fresh=()=>({accessToken:"fresh-access",expiresAt:new Date(Date.now()+3600000).toISOString(),user:{userId:"u",name:"사용자",workspaceRole:"author"}});
const expired=():Session=>({token:"old-access",user,refreshToken:"private-refresh",expiresAt:new Date(Date.now()-1000).toISOString()});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it("keeps refresh credentials and expiry only in the in-memory session",async()=>{
  const spy=vi.spyOn(Storage.prototype,"setItem");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(json({...fresh(),refreshToken:"private-refresh"})));
  const session=await new HttpGateway("https://api.example").login("a@b.test","password");
  expect(session.refreshToken).toBe("private-refresh");expect(session.expiresAt).toBeDefined();
  expect(spy).not.toHaveBeenCalled();spy.mockRestore();
});

it("coalesces simultaneous requests into one renewal before using fresh authorization",async()=>{
  let release!:(value:Response)=>void;
  const pending=new Promise<Response>(resolve=>{release=resolve;});
  const fetcher=vi.fn().mockImplementation((path:string)=>path.endsWith("/auth/refresh")?pending:Promise.resolve(json({ok:true})));
  vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example"),session=expired();
  const a=api.request("/me",undefined,session),b=api.request("/workspaces",undefined,session);
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  release(json(fresh()));await Promise.all([a,b]);
  expect(fetcher.mock.calls.filter(([p])=>String(p).endsWith("/auth/refresh"))).toHaveLength(1);
  expect(fetcher.mock.calls.slice(1).every(([,init])=>init.headers.Authorization==="Bearer fresh-access")).toBe(true);
});

it("retries only an explicitly expired request once and preserves a mutation body",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(json({code:"SESSION_EXPIRED"},401)).mockResolvedValueOnce(json(fresh())).mockResolvedValueOnce(json({saved:true}));
  vi.stubGlobal("fetch",fetcher);const api=new HttpGateway("https://api.example"),session={...expired(),expiresAt:fresh().expiresAt};
  await expect(api.request("/workspaces/w/submissions",{requestId:"stable"},session)).resolves.toEqual({saved:true});
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[2][1].body);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each(["SESSION_REVOKED","SESSION_INVALID","INVALID_CREDENTIALS"])("never renews or replays a %s response",async(code)=>{
  const fetcher=vi.fn().mockResolvedValue(json({code},401));vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example"),session={...expired(),expiresAt:fresh().expiresAt};
  await expect(api.request("/me",undefined,session)).rejects.toMatchObject({status:401,code});
  await expect(api.request("/me",undefined,session)).rejects.toMatchObject({status:401});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not replay a network failure and checks request cancellation after renewal",async()=>{
  const fetcher=vi.fn().mockRejectedValue(new Error("network"));vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example");await expect(api.request("/save",{}, {...expired(),expiresAt:fresh().expiresAt})).rejects.toThrow("network");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(json(fresh()));const controller=new AbortController();controller.abort();
  await expect(api.request("/save",{},expired(),controller.signal)).rejects.toThrow();
  expect(fetcher.mock.calls.map(([path])=>path)).toEqual(["https://api.example/save","https://api.example/auth/refresh"]);
});

it("logout during renewal never resurrects the session and revokes the fresh token",async()=>{
  let release!:(value:Response)=>void;
  const pending=new Promise<Response>(resolve=>{release=resolve;});
  const fetcher=vi.fn().mockImplementation((path:string)=>path.endsWith("/auth/refresh")?pending:Promise.resolve(json({loggedOut:true})));
  vi.stubGlobal("fetch",fetcher);const api=new HttpGateway("https://api.example"),session=expired();
  const request=api.request("/me",undefined,session);const rejected=expect(request).rejects.toMatchObject({status:401});
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));const logout=api.logout(session);
  release(json(fresh()));await rejected;await logout;
  expect(fetcher.mock.calls.map(([p])=>p)).toEqual(["https://api.example/auth/refresh","https://api.example/auth/logout"]);
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-access");
  expect(session.refreshToken).toBeUndefined();
  await expect(api.request("/me",undefined,session)).rejects.toMatchObject({status:401});
});
it("does not send a queued protected mutation after logout even with a valid token",async()=>{
  const fetcher=vi.fn().mockResolvedValue(json({loggedOut:true}));vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example"),session={...expired(),expiresAt:fresh().expiresAt};
  const request=api.request("/workspaces/w/submissions",{requestId:"must-not-send"},session);
  const rejected=expect(request).rejects.toMatchObject({status:401});
  await api.logout(session);await rejected;
  expect(fetcher.mock.calls.map(([path])=>path)).toEqual(["https://api.example/auth/logout"]);
});

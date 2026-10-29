import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, HttpGateway } from "../src/workspace/gateway";
const session = {token:"test-token",user:{id:"u",name:"테스트",role:"reviewer" as const}};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const w={workspaceId:"w",name:"기관",status:"active",role:"reviewer"};
const subject={subjectId:"s",name:"대상",managementNumber:1};
const note={submissionId:"n",threadId:"n",authorId:"a",authorNameAtSubmission:"기록 당시 이름",authorCurrentName:"현재 이름",subject,memo:"원문",authorDraft:"초안",generationId:"g",generatedDraft:{source:{language:"ko"},translation:{text:"초안"},qa:{issues:[{message:"확인 필요"}]}},reviews:[],status:"confirmed",version:3,submittedAt:"2026-10-29T00:00:00Z"};
let stream:ReadableStreamDefaultController<Uint8Array>;
const stops:(()=>void)[]=[];
afterEach(()=>{stops.splice(0).forEach(stop=>stop());vi.unstubAllGlobals();vi.useRealTimers();});
function setup(role="reviewer") {
 const active={...w,role};
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const path=String(input).replace("https://api.example","");
  if(path==="/workspaces")return json([active]);
  if(path==="/workspaces/w/events") return new Response(new ReadableStream<Uint8Array>({start(c){stream=c;}}),{headers:{"content-type":"text/event-stream"}});
  if(path==="/workspaces/w")return json({...active,ownerReviewerId:"u",revision:8,inviteCode:"INVITE"});
  if(path==="/workspaces/w/subjects")return json([subject]);
  if(path==="/workspaces/w/submissions")return json([{submissionId:"n"}]);
  if(path==="/workspaces/w/submissions/n")return json(note);
  if(path==="/workspaces/w/members")return json([{userId:"v",name:"열람자",role:"viewer",status:"active"}]);
  if(path==="/workspaces/w/join-requests")return json([{requestId:"r",userId:"a",name:"작성자",role:"author",status:"pending",version:2}]);
  if(path.startsWith("/workspaces/w/audit?"))return json({items:[],nextCursor:null});
  if(path==="/workspaces/w/transfers" && !init?.body)return json([]);
  if(path==="/workspaces/w/publications")return json([]);
  return json({});
 });
 vi.stubGlobal("fetch",fetcher);
 return fetcher;
}
async function connect(api:HttpGateway) {
 const ready=vi.fn();
 const stop=api.subscribe(session,vi.fn(),vi.fn(),ready);stops.push(stop);
 await vi.waitFor(()=>expect(stream).toBeDefined());
 stream.enqueue(new TextEncoder().encode("event: revalidate\ndata: {}\n\n"));
 await vi.waitFor(()=>expect(ready).toHaveBeenCalled());
}
describe("latest backend REST adapter",()=>{
 it("shows source-author confirmation items in generated and stored draft warnings",async()=>{
  stream=undefined!;const fetcher=setup("author"),api=new HttpGateway("https://api.example");await connect(api);
  const additional_checks=[{question:"원문 작성자에게 장소를 확인해 주세요.",evidence:{quote:"Tidak berjalan ke taman."}}];
  const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(input,init)=>{
   if(String(input).endsWith("/submissions/n"))return json({...note,generatedDraft:{...note.generatedDraft,additional_checks}});
   if(String(input).endsWith("/drafts"))return json({generationId:"g",draft:{source:{text:"Tidak berjalan ke taman."},translation:{text:"정원 또는 공원까지 걸어가지 않았습니다."},qa:{issues:[]},additional_checks}});
   return original(input,init);
  });
  const data=await api.snapshot(session,"author");
  expect(data.submissions[0].warnings).toContain("원문 작성자에게 장소를 확인해 주세요. · 원문: Tidak berjalan ke taman.");
  const result=await api.generate(session,"author","Tidak berjalan ke taman.","id");
  expect(result.warnings).toEqual(["원문 작성자에게 장소를 확인해 주세요. · 원문: Tidak berjalan ke taman."]);
 });
 it("does not fall back to mock data and preserves server errors",async()=>{
  const fetcher=vi.fn().mockResolvedValue(json({error:"권한 없음",code:"FORBIDDEN"},403));vi.stubGlobal("fetch",fetcher);
  await expect(new HttpGateway("").login("admin","x")).rejects.toThrow("연결을 준비");expect(fetcher).not.toHaveBeenCalled();
  await expect(new HttpGateway("https://api.example").login("a@b.com","x")).rejects.toMatchObject({status:403,code:"FORBIDDEN",message:"권한 없음"});
 });
 it("maps email login and fixed viewer role; admin uses loginId",async()=>{
  const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(json({accessToken:"token",user:{userId:"u",name:"이름",workspaceRole:"viewer"}})));vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example/");
  expect((await api.login("a@b.com","secret")).user.role).toBe("reader");
  expect(fetcher).toHaveBeenLastCalledWith("https://api.example/auth/login",expect.objectContaining({body:JSON.stringify({email:"a@b.com",password:"secret"})}));
  await api.login("admin","secret");
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toEqual({loginId:"admin",password:"secret"});
 });
 it("registers viewer and routes Cognito confirmation without inventing a session",async()=>{
  const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(json({confirmationRequired:true})));vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example");
  await expect(api.register("이름","a@b.com","secret","reader")).rejects.toMatchObject({code:"EMAIL_NOT_VERIFIED"});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).role).toBe("viewer");
  await api.confirmEmail("a@b.com","123456");
  expect(fetcher.mock.calls.at(-1)![0]).toBe("https://api.example/auth/confirm");
 });
 it("does not load business data before subscription proof",async()=>{
  const fetcher=setup();const api=new HttpGateway("https://api.example");
  expect((await api.snapshot(session,"reviewer")).workspace).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it("maps records, request versions and avoids sending blank optional memo",async()=>{
  stream=undefined!;const fetcher=setup();const api=new HttpGateway("https://api.example");
  await connect(api);const data=await api.snapshot(session,"reviewer");
  expect(data.submissions[0]).toMatchObject({authorName:"기록 당시 이름",generationId:"g",warnings:["확인 필요"]});
  await api.execute(session,"reviewer",{type:"membership",userId:"a",status:"active",requestId:"r",requestVersion:2});
  expect(fetcher).toHaveBeenCalledWith("https://api.example/workspaces/w/join-requests/r/approve",expect.objectContaining({body:JSON.stringify({expectedVersion:2})}));
  await api.execute(session,"reviewer",{type:"subject",name:"대상",memo:""});
  expect(fetcher).toHaveBeenLastCalledWith("https://api.example/workspaces/w/subjects",expect.objectContaining({body:JSON.stringify({name:"대상"}),cache:"no-store"}));
 });
 it("requests only viewer-allowed resources",async()=>{
  stream=undefined!;const fetcher=setup("viewer");const api=new HttpGateway("https://api.example");await connect(api);
  const data=await api.snapshot({...session,user:{...session.user,role:"reader"}},"reader");
  expect(data.submissions).toEqual([]);expect(data.members).toEqual([]);
  expect(fetcher.mock.calls.map(x=>String(x[0])).some(x=>x.endsWith("/subjects")||x.endsWith("/submissions"))).toBe(false);
 });
 it("keeps pending membership usable without subscribing to protected records",async()=>{
  const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(json([{...w,status:"pending"}])));vi.stubGlobal("fetch",fetcher);
  const api=new HttpGateway("https://api.example");const ready=vi.fn();
  stops.push(api.subscribe(session,vi.fn(),vi.fn(),ready));await vi.waitFor(()=>expect(ready).toHaveBeenCalled());
  expect((await api.snapshot(session,"reviewer")).membership?.status).toBe("pending");
  expect(fetcher.mock.calls.every(x=>x[0]==="https://api.example/workspaces")).toBe(true);
 });
 it("resumes prepared publication after a lost publish response without creating another record",async()=>{
  stream=undefined!;const fetcher=setup();const api=new HttpGateway("https://api.example");await connect(api);await api.snapshot(session,"reviewer");
  let pub:Record<string,unknown>|undefined;let creates=0,publishes=0;
  const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(input,init)=>{
   const path=String(input);
   if(path.endsWith("/publications")) {
    if(init?.body){creates++;pub={publicationId:"p",submissionId:"n",version:1,status:"unpublished",content:"공개문",recipientIds:["v"]};return json(pub);}
    return json(pub?[pub]:[]);
   }
   if(path.endsWith("/p/publish")){publishes++;if(publishes===1)throw new Error("network");pub={...pub,version:2,status:"published"};return json(pub);}
   return original(input,init);
  });
  const command={type:"publish" as const,submissionId:"n",version:3,content:"공개문",recipients:["v"]};
  await expect(api.execute(session,"reviewer",command)).rejects.toThrow("network");
  await api.execute(session,"reviewer",command);
  await api.execute(session,"reviewer",command);
  expect(creates).toBe(1);expect(publishes).toBe(2);
 });
 it("requires explicit checking and preserves FINAL_QA_REQUIRED on confirmation",async()=>{
  stream=undefined!;const fetcher=setup();const api=new HttpGateway("https://api.example");await connect(api);await api.snapshot(session,"reviewer");
  fetcher.mockResolvedValue(json({error:"유효한 QA 필요",code:"FINAL_QA_REQUIRED"},409));
  await expect(api.execute(session,"reviewer",{type:"review",id:"n",version:3,content:"초안",reason:"",status:"confirmed"})).rejects.toBeInstanceOf(ApiError);
  expect(fetcher.mock.calls.some(x=>/\/(check|drafts|transcriptions)$/.test(String(x[0])))).toBe(false);
 });
 it("creates a source-bound generation through the backend and submits its ID",async()=>{
  stream=undefined!;const fetcher=setup("author");const api=new HttpGateway("https://api.example");await connect(api);await api.snapshot(session,"author");
  const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(input,init)=>String(input).endsWith("/drafts")?json({generationId:"new-generation",draft:{source:{text:"Drank juice."},translation:{text:"주스를 마셨습니다."},qa:{issues:[{message:"원문 대조"}]}}}):original(input,init));
  const result=await api.generate(session,"author","Drank juice.","en");
  expect(result).toEqual({generationId:"new-generation",source:"Drank juice.",text:"주스를 마셨습니다.",warnings:["원문 대조"]});
  expect(fetcher).toHaveBeenLastCalledWith("https://api.example/workspaces/w/drafts",expect.objectContaining({body:JSON.stringify({memo:"Drank juice.",sourceLanguage:"en",dataUse:"synthetic_deidentified"})}));
  await api.execute(session,"author",{type:"submit",subjectId:"s",source:result.source,generated:result.text,final:result.text,language:"en",requestId:"r",generationId:result.generationId});
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).generationId).toBe("new-generation");
  expect(fetcher.mock.calls.every(([url])=>String(url).startsWith("https://api.example/"))).toBe(true);
 });
 it("rejects generation without current workspace proof and retains AI errors",async()=>{
  const fetcher=setup();const api=new HttpGateway("https://api.example");
  await expect(api.generate(session,"author","memo","en")).rejects.toMatchObject({code:"WORKSPACE_ACCESS_REQUIRED"});
  expect(fetcher).not.toHaveBeenCalled();
  stream=undefined!;setup("author");await connect(api);await api.snapshot(session,"author");
  vi.mocked(fetch).mockResolvedValue(json({error:"AI 일시 중단",code:"CAREBRIDGE_UNAVAILABLE"},503));
  await expect(api.generate(session,"author","memo","en")).rejects.toMatchObject({status:503,code:"CAREBRIDGE_UNAVAILABLE"});
 });
 it("saves the edited final content then checks that version without auto-confirming",async()=>{
  stream=undefined!;const fetcher=setup();const api=new HttpGateway("https://api.example");await connect(api);await api.snapshot(session,"reviewer");
  fetcher.mockImplementation(async(input)=>String(input).endsWith("/review")?json({version:4}):json({version:4,qa:{checks:[{code:"SEMANTIC_OMITTED_FACTS",passed:false}],issues:[{message:"수량 대조 필요",severity:"hold"}]}}));
  expect(await api.checkReview(session,"reviewer","n",3,"수정한 최종본","대조")).toEqual({version:4,content:"수정한 최종본",status:"hold",warnings:["수량 대조 필요"]});
  expect(fetcher.mock.calls.slice(-2).map(c=>JSON.parse(c[1]!.body as string))).toEqual([{expectedVersion:3,decision:"edit",content:"수정한 최종본",reason:"대조"},{expectedVersion:4}]);
 });
 it("returns the saved version when QA fails so the editor can retry",async()=>{
  stream=undefined!;const fetcher=setup();const api=new HttpGateway("https://api.example");await connect(api);await api.snapshot(session,"reviewer");
  fetcher.mockImplementation(async(input)=>String(input).endsWith("/review")?json({version:4}):json({error:"AI 장애",code:"CAREBRIDGE_AI_FAILED"},502));
  await expect(api.checkReview(session,"reviewer","n",3,"보존할 편집본","")).rejects.toMatchObject({code:"CAREBRIDGE_AI_FAILED",details:{savedVersion:4}});
 });
 it("loads the normalized final QA warnings from the actual backend contract",async()=>{
  stream=undefined!;const fetcher=setup();const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(input,init)=>String(input).endsWith("/submissions/n")?json({...note,finalQa:{qa:{checks:[{code:"SEMANTIC_OMITTED_FACTS",passed:false}],issues:[{message:"최종본 대상 확인",severity:"hold"}]}}}):original(input,init));
  const api=new HttpGateway("https://api.example");await connect(api);
  expect((await api.snapshot(session,"reviewer")).submissions[0].warnings).toEqual(["최종본 대상 확인"]);
 });
 it("connects editable transcription through the same workspace backend",async()=>{
  stream=undefined!;const fetcher=setup("author");const api=new HttpGateway("https://api.example");await connect(api);await api.snapshot(session,"author");
  fetcher.mockResolvedValue(json({text:"Drank water.",requiresTranscriptReview:true}));
  expect((await api.transcribe(session,"author","UklGRg==","en")).requiresTranscriptReview).toBe(true);
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual({audioBase64:"UklGRg==",sourceLanguage:"en",dataUse:"synthetic_deidentified"});
 });
});

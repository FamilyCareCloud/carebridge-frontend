import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CarebridgePage } from "../src/CarebridgePage";
import type { RealCtx } from "../src/RealApp";
import { ApiError } from "../src/api";

const mocks=vi.hoisted(()=>({
 api:{roles:vi.fn(),list:vi.fn(),get:vi.fn(),create:vi.fn(),edit:vi.fn(),check:vi.fn(),decide:vi.fn(),preview:vi.fn(),version:vi.fn(),transcribe:vi.fn(),setRole:vi.fn()},
 startRecording:vi.fn(),
}));
vi.mock("../src/carebridge-api",async original=>({...await original<typeof import("../src/carebridge-api")>(),carebridgeApi:()=>mocks.api}));
vi.mock("../src/voice",()=>({startRecording:mocks.startRecording,blobToBase64:vi.fn(),toPcmWav:vi.fn()}));
const evidence={segment_id:"s001",start:0,end:15,quote:"Ate breakfast."};
const draft={schema_version:"carebridge.v1",id:"ai",status:"review_required",label:"검토 전 초안 · 공식기록 아님",mode:"model_translation",source:{kind:"text",language:"en",text:"Ate breakfast.",sha256:"hash"},translation:{language:"ko",text:"아침 식사를 하셨습니다.",segments:[{text:"아침 식사를 하셨습니다.",evidence}]},observations:[{id:"o1",category:"meal",text:"아침 식사를 하셨습니다.",evidence}],additional_checks:[],qa:{checks:[{code:"SOURCE_INTEGRITY",passed:true}],issues:[{code:"HUMAN_REVIEW_REQUIRED",severity:"review",message:"원문 대조가 필요합니다."}],external_share_allowed:false,requires_human_review:true}};
const note={id:"note",groupId:"group",createdBy:"author",createdAt:"2026-10-26T10:00:00Z",updatedAt:"2026-10-26T10:00:00Z",version:1,status:"review_required",language:"en",inputKind:"text",approvedAt:null,approvedVersion:null,approvedBy:null,source:draft.source,history:[],draft,qa:draft.qa};
const ctx={token:"test-session",groupId:"group",group:{},members:[],session:{accessToken:"test-session",user:{userId:"reviewer",name:"검토자",email:"local@example.test"}},reload:async()=>{},notify:vi.fn()} as unknown as RealCtx;
function policy(role="reviewer",aiEnabled=true){return {version:1,myRole:role,canManage:role==="reviewer",aiEnabled,roles:[{userId:"author",name:"작성자",role:"author",locked:false},{userId:"reviewer",name:"검토자",role:"reviewer",locked:true}]};}
async function openNote(){
 render(<CarebridgePage ctx={ctx}/>);
 const button=await screen.findByRole("button",{name:/원문과 초안 비교하기/});
 fireEvent.click(button);
 await screen.findByRole("heading",{name:"원문과 초안 대조"});
}
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.api.roles.mockResolvedValue(policy());
 mocks.api.list.mockResolvedValue({items:[note],nextCursor:null});
 mocks.api.get.mockResolvedValue(structuredClone(note));
 mocks.api.create.mockResolvedValue(structuredClone(note));
 mocks.api.edit.mockResolvedValue({...structuredClone(note),version:2});
});
afterEach(cleanup);
describe("CareBridge 역할과 검토 화면",()=>{
 it("가족은 승인 목록과 수동 미리보기만 보고 원문 API를 호출하지 않음",async()=>{
  mocks.api.roles.mockResolvedValue(policy("family"));
  mocks.api.list.mockResolvedValue({items:[{...note,status:"approved"}],nextCursor:null});
  mocks.api.preview.mockResolvedValue({id:"note",version:2,approvedAt:"2026-10-26T10:00:00Z",label:"담당자 검토 완료 · 교육용 미리보기 · 공식기록 아님",manualOnly:true,observations:[{category:"meal",text:"승인된 문장입니다."}]});
  render(<CarebridgePage ctx={ctx}/>);
  fireEvent.click(await screen.findByRole("button",{name:/직접 눌러 미리보기/}));
  await screen.findByText("승인된 문장입니다.");
  expect(screen.queryByRole("button",{name:"메모 작성"})).toBeNull();
  expect(screen.queryByText("Ate breakfast.")).toBeNull();
  expect(mocks.api.get).not.toHaveBeenCalled();
  expect(mocks.api.list).toHaveBeenCalledWith(true,undefined);
 });
 it("가상·비식별 확인을 해야 생성할 수 있고 요청 ID를 서버에 전달",async()=>{
  mocks.api.roles.mockResolvedValue(policy("author"));
  render(<CarebridgePage ctx={ctx}/>);
  const input=await screen.findByLabelText("원문 관찰 메모");
  fireEvent.change(input,{target:{value:"Ate breakfast."}});
  const generate=screen.getByRole("button",{name:/검토 전 초안 만들기/});
  expect((generate as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("교육용 가상·비식별 메모임을 확인합니다."));
  fireEvent.click(generate);
  await waitFor(()=>expect(mocks.api.create).toHaveBeenCalled());
  expect(mocks.api.create.mock.calls[0][0]).toBe("Ate breakfast.");
  expect(mocks.api.create.mock.calls[0][2]).toMatch(/^[0-9a-f-]{36}$/);
 });
 it("원문 대조·사유 입력 전과 저장 안 한 수정이 있을 때 승인을 막음",async()=>{
  await openNote();
  const approve=screen.getByRole("button",{name:"이 버전 승인"}) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("수정·검토 사유"),{target:{value:"원문 대조를 마쳤습니다."}});
  fireEvent.click(screen.getByLabelText("원문·한국어 번역·관찰 초안을 대조했습니다."));
  expect(approve.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("한국어 관찰 1"),{target:{value:"아침 식사를 드셨습니다."}});
  expect(approve.disabled).toBe(true);
  expect((screen.getByRole("button",{name:"수정 저장·재검사"}) as HTMLButtonElement).disabled).toBe(false);
 });
 it("내가 작성한 메모는 검토자여도 스스로 승인할 수 없음",async()=>{
  mocks.api.get.mockResolvedValue({...structuredClone(note),createdBy:"reviewer"});
  await openNote();
  fireEvent.change(screen.getByLabelText("수정·검토 사유"),{target:{value:"원문 확인"}});
  fireEvent.click(screen.getByLabelText("원문·한국어 번역·관찰 초안을 대조했습니다."));
  expect((screen.getByRole("button",{name:"이 버전 승인"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("내가 작성한 메모는 다른 검토자가 승인해야 합니다.")).toBeTruthy();
 });
 it("충돌이 나도 수정한 메모와 사유를 잃지 않고 최신 버전 재조회 안내",async()=>{
  mocks.api.edit.mockRejectedValue(new ApiError(409,"버전이 변경됐습니다."));
  await openNote();
  fireEvent.change(screen.getByLabelText("한국어 관찰 1"),{target:{value:"수정 내용을 보존합니다."}});
  fireEvent.change(screen.getByLabelText("수정·검토 사유"),{target:{value:"표현을 수정했습니다."}});
  fireEvent.click(screen.getByRole("button",{name:"수정 저장·재검사"}));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("한국어 관찰 1") as HTMLTextAreaElement).value).toBe("수정 내용을 보존합니다.");
  expect(screen.getByRole("button",{name:"최신 버전 불러오기"})).toBeTruthy();
  expect(mocks.api.preview).not.toHaveBeenCalled();
 });
 it("메모 화면을 닫으면 진행 중인 마이크 녹음을 종료",async()=>{
  const cancel=vi.fn();
  mocks.startRecording.mockResolvedValue({stop:vi.fn(),cancel});
  mocks.api.roles.mockResolvedValue(policy("author"));
  const view=render(<CarebridgePage ctx={ctx}/>);
  fireEvent.click(await screen.findByLabelText("교육용 가상·비식별 메모임을 확인합니다."));
  fireEvent.click(screen.getByRole("button",{name:"음성 메모"}));
  await screen.findByRole("button",{name:"녹음 중지·전사"});
  view.unmount();
  expect(cancel).toHaveBeenCalledOnce();
 });
});

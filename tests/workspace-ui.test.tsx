import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateway } from "../src/workspace/gateway";
import type { MockGateway } from "../src/workspace/mock";
import WorkspaceApp from "../src/workspace/WorkspaceApp";

vi.mock("../src/workspace/gateway", async () => {
  const { MockGateway } = await import("../src/workspace/mock");
  return { gateway: new MockGateway(), isMock: true };
});
const api = gateway as MockGateway;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function login(id: string) {
  fireEvent.change(screen.getByLabelText("로그인 ID"), {
    target: { value: id },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인 →" }));
  await screen.findByRole("navigation", { name: "주 메뉴" });
}

describe("CareBridge role workspace screens", () => {
  it('shows pending people on the reviewer dashboard and updates the list after approval and rejection',async()=>{
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click(screen.getByRole('button',{name:'업무 현황',exact:true}));
    expect(screen.queryByText('검토 완료',{exact:true})).toBeNull();
    expect(screen.queryByText('최종 확인은 사람의 몫')).toBeNull();
    const requests=within(screen.getByRole('region',{name:/참여 요청/}));
    expect(requests.getByText('아유')).toBeTruthy();expect(requests.getByText('이하늘')).toBeTruthy();
    expect(requests.getByText('기록 작성자')).toBeTruthy();expect(requests.getAllByText(/^요청 시각/)).toHaveLength(2);
    fireEvent.click(requests.getByRole('button',{name:'요청 관리 →'}));
    await screen.findByRole('heading',{name:'함께할 구성원을 확인해요'});
    const row=screen.getByRole('heading',{name:'아유'}).closest('.cb-member-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button',{name:'참여 승인'}));
    await waitFor(()=>expect(screen.queryByRole('heading',{name:'아유'})).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'업무 현황',exact:true}));
    expect(within(screen.getByRole('region',{name:/참여 요청/})).queryByText('아유')).toBeNull();
    await act(async()=>api.execute(await api.login('reviewer','demo'),'reviewer',{type:'membership',userId:'pending-reader',status:'rejected'}));
    expect(await screen.findByText('대기 중인 참여 요청이 없습니다.')).toBeTruthy();
  });
  it('keeps completed counts on the author dashboard while removing the principle card',async()=>{
    render(<WorkspaceApp />);await login('author');
    fireEvent.click(screen.getByRole('button',{name:'업무 현황',exact:true}));
    expect(screen.getByRole('button',{name:/검토 완료/})).toBeTruthy();
    expect(screen.queryByText('최종 확인은 사람의 몫')).toBeNull();
    expect(screen.queryByRole('region',{name:/참여 요청/})).toBeNull();
  });
  it('distinguishes saved edits, held reviews, completed reviews and blocked publications in the activity screen',async()=>{
    const reviewer=await api.login('reviewer','demo');
    await api.execute(reviewer,'reviewer',{type:'review',id:'n1',version:1,status:'pending',content:'수정한 검토',reason:'내용 보완'});
    await api.execute(reviewer,'reviewer',{type:'review',id:'n1',version:2,status:'held',content:'수정한 검토',reason:'작성자 확인 필요'});
    await api.execute(reviewer,'reviewer',{type:'review',id:'n1',version:3,status:'confirmed',content:'확인한 검토',reason:'확인 완료'});
    await api.execute(reviewer,'reviewer',{type:'revoke',id:'p1',version:1});
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click(screen.getByRole('button',{name:'검토 이력',exact:true}));
    for(const name of ['검토 내용 수정','검토 보류','검토 완료','기록 공개 차단'])expect(screen.getByRole('heading',{name,exact:true})).toBeTruthy();
    expect(screen.getAllByText('처리자: 김지현')).toHaveLength(4);
    expect(screen.getByText(/사유: 작성자 확인 필요/)).toBeTruthy();
    expect(screen.queryByText(/상태: pending/)).toBeNull();
  });
  it('selects all active readers, shows mixed selection, and starts a new publication unselected',async()=>{
    const reviewer=await api.login('reviewer','demo');
    await api.execute(reviewer,'reviewer',{type:'membership',userId:'pending-reader',status:'active'});
    await api.execute(reviewer,'reviewer',{type:'review',id:'n1',version:1,content:'새로운 확정 기록',reason:'확인',status:'confirmed'});
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click(screen.getByRole('button',{name:'공개 기록',exact:true}));
    fireEvent.click(await screen.findByRole('button',{name:'내용·수신자 선택'}));
    const all=screen.getByRole('checkbox',{name:'수신자 전체 선택'}) as HTMLInputElement;
    const preview=screen.getByRole('button',{name:'공개 내용 미리보기 →'}) as HTMLButtonElement;
    expect(all.checked).toBe(false);expect(preview.disabled).toBe(true);
    expect(screen.queryByText('대상자와 연결된 수신자를 자동으로 선택하지 않습니다.')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(all);
    expect(screen.getAllByRole('checkbox').every(node=>(node as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('checkbox',{name:'김민서'}));
    expect(all.checked).toBe(false);expect(all.indeterminate).toBe(true);
    fireEvent.click(all);expect(all.checked).toBe(true);expect(all.indeterminate).toBe(false);
    fireEvent.click(all);expect(preview.disabled).toBe(true);
  });
  it('blocks then restores the exact published content and recipients, including after cancelling edits',async()=>{
    const reviewer=await api.login('reviewer','demo');
    const original=(await api.snapshot(reviewer,'reviewer')).submissions.find(n=>n.id==='n3')!;
    await api.execute(reviewer,'reviewer',{type:'revoke',id:'p1',version:1});
    await api.execute(reviewer,'reviewer',{type:'publish',submissionId:'n3',version:2,content:'공개용으로 따로 작성한 내용',recipients:['reader']});
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click(screen.getByRole('button',{name:'공개 기록',exact:true}));
    fireEvent.click(await screen.findByRole('button',{name:'차단 후 내용·수신자 정정'}));
    const editor=await screen.findByLabelText('공개할 내용') as HTMLTextAreaElement;
    expect(editor.value).toBe('공개용으로 따로 작성한 내용');
    expect((screen.getByRole('checkbox',{name:'김민서'}) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(/공개할 기록이 다른 작업에서 변경/)).toBeNull();
    fireEvent.change(editor,{target:{value:'저장하지 않을 수정'}});
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'닫기'}));
    fireEvent.click(await screen.findByRole('button',{name:'변경 내용 버리고 이동'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect((await api.snapshot(await api.login('reader','demo'),'reader')).publications).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'내용·수신자 선택'}));
    expect((await screen.findByLabelText('공개할 내용') as HTMLTextAreaElement).value).toBe('공개용으로 따로 작성한 내용');
    expect((screen.getByRole('checkbox',{name:'김민서'}) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'공개 내용 미리보기 →'}));
    fireEvent.click(screen.getByRole('button',{name:'선택한 수신자에게 공개'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    const published=(await api.snapshot(await api.login('reader','demo'),'reader')).publications;
    expect(published).toHaveLength(1);expect(published[0].recordedAt).toBe(original.createdAt);
    expect(screen.queryByRole('button',{name:'공개 내용·수신자 수정'})).toBeNull();
  });
  it('does not select removed or pending readers when reopening saved publication settings',async()=>{
    const reviewer=await api.login('reviewer','demo');
    await api.execute(reviewer,'reviewer',{type:'revoke',id:'p1',version:1});
    await api.execute(reviewer,'reviewer',{type:'membership',userId:'reader',status:'removed'});
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click(screen.getByRole('button',{name:'공개 기록',exact:true}));
    fireEvent.click(await screen.findByRole('button',{name:'공개 내용·수신자 수정'}));
    expect(screen.queryByRole('checkbox',{name:'김민서'})).toBeNull();
    expect(screen.queryByRole('checkbox',{name:'이하늘'})).toBeNull();
    expect(screen.getByText('선택할 수 있는 참여 중인 열람자가 없습니다.')).toBeTruthy();
    expect((screen.getByRole('button',{name:'공개 내용 미리보기 →'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows recording and publication times in the reader list and detail',async()=>{
    render(<WorkspaceApp />);await login('reader');
    expect(await screen.findByText(/^기록 시각 /)).toBeTruthy();expect(screen.getByText(/^공개 시각 /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'전달 내용 읽기 →'}));
    const detail=within(screen.getByRole('dialog'));
    expect(detail.getByText(/^기록 시각 /)).toBeTruthy();expect(detail.getByText(/^공개 시각 /)).toBeTruthy();
  });
  it('stops publication if a selected reader is removed while the preview is open',async()=>{
    const reviewer=await api.login('reviewer','demo');
    await api.execute(reviewer,'reviewer',{type:'revoke',id:'p1',version:1});
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click(screen.getByRole('button',{name:'공개 기록',exact:true}));
    fireEvent.click(await screen.findByRole('button',{name:'내용·수신자 선택'}));
    fireEvent.click(screen.getByRole('button',{name:'공개 내용 미리보기 →'}));
    await act(async()=>api.execute(reviewer,'reviewer',{type:'membership',userId:'reader',status:'removed'}));
    expect(await screen.findByText(/선택한 수신자의 참여 상태가 변경/)).toBeTruthy();
    expect((screen.getByRole('button',{name:'선택한 수신자에게 공개'}) as HTMLButtonElement).disabled).toBe(true);
    expect((await api.snapshot(reviewer,'reviewer')).publications.every(p=>p.state!=='published')).toBe(true);
  });
  it('browser back and forward restore menus without discarding the author memo',async()=>{
    render(<WorkspaceApp />);await login('author');
    fireEvent.change(await screen.findByLabelText('원문 메모'),{target:{value:'이동해도 유지되는 메모'}});
    fireEvent.click(screen.getByRole('button',{name:'내 메모',exact:true}));
    await screen.findByRole('heading',{name:'내 메모'});
    act(()=>history.back());
    await waitFor(()=>expect((screen.getByLabelText('원문 메모') as HTMLTextAreaElement).value).toBe('이동해도 유지되는 메모'));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(()=>history.forward());
    expect(await screen.findByRole('heading',{name:'내 메모'})).toBeTruthy();
  });
  it('cancels a browser back without losing edits, then discards and restores list search',async()=>{
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.change(await screen.findByLabelText('메모 검색'),{target:{value:'이영희'}});
    vi.spyOn(window,'scrollY','get').mockReturnValue(320);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('button',{name:'내용 보기 ↗'}));
    fireEvent.change(screen.getByLabelText('검토 내용'),{target:{value:'아직 저장하지 않은 검토'}});
    act(()=>history.back());
    fireEvent.click(await screen.findByRole('button',{name:'계속 작성'}));
    expect((screen.getByLabelText('검토 내용') as HTMLTextAreaElement).value).toBe('아직 저장하지 않은 검토');
    act(()=>history.back());
    fireEvent.click(await screen.findByRole('button',{name:'변경 내용 버리고 이동'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect((screen.getByLabelText('메모 검색') as HTMLInputElement).value).toBe('이영희');
    await waitFor(()=>expect(window.scrollTo).toHaveBeenCalledWith({top:320}));
    act(()=>history.forward());
    await screen.findByRole('dialog',{name:'메모 검토'});
    expect((screen.getByLabelText('검토 내용') as HTMLTextAreaElement).value).not.toBe('아직 저장하지 않은 검토');
  });
  it('restores only a permitted last menu after reload',async()=>{
    sessionStorage.setItem('carebridge.last-page.v1:preview:author:author','notes');
    render(<WorkspaceApp />);await login('author');
    expect(await screen.findByRole('heading',{name:'내 메모'})).toBeTruthy();
    expect(location.href).not.toContain('notes');
    expect(JSON.stringify(history.state)).not.toContain('이영희');
  });
  it('ignores a last menu outside the current role',async()=>{
    sessionStorage.setItem('carebridge.last-page.v1:preview:author:author','members');
    render(<WorkspaceApp />);await login('author');
    expect(await screen.findByLabelText('원문 메모')).toBeTruthy();
    expect(screen.queryByRole('heading',{name:'구성원 관리'})).toBeNull();
  });
  it('keeps the editor DOM, focus and selection through invalidation and tab focus', async()=>{
    let changed=()=>{};
    const subscribe=api.subscribe.bind(api);
    vi.spyOn(api,'subscribe').mockImplementation((s,c,f,r)=>{changed=c;return subscribe(s,c,f,r);});
    render(<WorkspaceApp />);await login('author');
    const editor=await screen.findByLabelText('원문 메모') as HTMLTextAreaElement;
    fireEvent.change(editor,{target:{value:'작성 중인 원문'}});editor.focus();editor.setSelectionRange(2,4);
    const snapshot=await api.snapshot(await api.login('author','demo'),'author');
    let resolve!:(value:typeof snapshot)=>void;
    vi.spyOn(api,'snapshot').mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    act(()=>changed());
    expect(screen.getByLabelText('원문 메모')).toBe(editor);
    expect(document.activeElement).toBe(editor);expect(editor.selectionStart).toBe(2);
    expect(screen.queryByText('작업 공간을 확인하고 있어요…')).toBeNull();
    await act(async()=>resolve(snapshot));
    await act(async()=>window.dispatchEvent(new Event('focus')));
    expect(screen.getByLabelText('원문 메모')).toBe(editor);
    expect(editor.value).toBe('작성 중인 원문');expect(document.activeElement).toBe(editor);
    const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
    expect(api.subscribe).toHaveBeenCalledTimes(1);
  });
  it('retains review edits and blocks overwriting a newer server version',async()=>{
    render(<WorkspaceApp />);await login('reviewer');
    fireEvent.click((await screen.findAllByRole('button',{name:'내용 보기 ↗'}))[0]);
    const editor=screen.getByLabelText('검토 내용') as HTMLTextAreaElement;
    fireEvent.change(editor,{target:{value:'내가 작성 중인 검토'}});
    await act(async()=>{await api.execute(await api.login('reviewer','demo'),'reviewer',{type:'review',id:'n1',version:1,content:'다른 검토자의 변경',reason:'',status:'pending'});});
    await screen.findByText(/다른 작업에서 이 기록이 변경되었습니다/);
    expect(screen.getByLabelText('검토 내용')).toBe(editor);expect(editor.value).toBe('내가 작성 중인 검토');
    expect((screen.getByRole('button',{name:'수정 저장'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each(["author", "reader"] as const)("lets a removed %s request readmission and waits for approval", async (role) => {
    const reviewer = await api.login("reviewer", "demo");
    await api.execute(reviewer, "reviewer", {type:"membership",userId:role,status:"removed"});
    render(<WorkspaceApp />);await login(role);
    const code = await screen.findByLabelText("초대코드");
    const button = screen.getByRole("button",{name:"참여 요청"}) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.change(code,{target:{value:"CARE2026"}});
    fireEvent.click(button);
    await screen.findByText("참여 상태: 승인 대기");
    expect((screen.getByRole("button",{name:"참여 요청"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button",{name:"전달 내용 읽기 →"})).toBeNull();
    await act(async()=>api.execute(reviewer,"reviewer",{type:"membership",userId:role,status:"active"}));
    await waitFor(()=>expect(screen.queryByLabelText("초대코드")).toBeNull());
    const state=await api.snapshot(await api.login(role,"demo"),role);
    expect(state.membership?.status).toBe("active");
    if(role==="reader") expect(state.publications).toEqual([]);
    else expect(state.submissions).toHaveLength(3);
  });
  it("opens the author editor directly and keeps input when visiting their notes", async () => {
    render(<WorkspaceApp />);
    await login("author");
    const memo = await screen.findByLabelText("원문 메모");
    fireEvent.change(memo, { target: { value: "작성 중인 합성 관찰" } });
    fireEvent.click(screen.getByRole("button", { name: "내 메모", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "메모 작성", exact: true }));
    expect((screen.getByLabelText("원문 메모") as HTMLTextAreaElement).value).toBe("작성 중인 합성 관찰");
  });
  it("hides an open reader detail without refresh when the reviewer revokes it", async () => {
    render(<WorkspaceApp />);
    await login("reader");
    fireEvent.click(
      await screen.findByRole("button", { name: "전달 내용 읽기 →" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "오후에 책을 읽으셨으며, 물 한 잔을 제공했습니다.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("원문 메모")).toBeNull();
    expect(screen.queryByRole("button", { name: "검토함" })).toBeNull();
    const reviewer = await api.login("reviewer", "demo");
    await act(async () => {
      await api.execute(reviewer, "reviewer", {
        type: "revoke",
        id: "p1",
        version: 1,
      });
    });
    expect(await screen.findByText("기록 표시가 중단되었습니다")).toBeTruthy();
    expect(
      screen.queryByText("오후에 책을 읽으셨으며, 물 한 잔을 제공했습니다."),
    ).toBeNull();
  });
  it("keeps reader content hidden after stream disconnect even if an older snapshot returns late", async () => {
    let disconnected = () => {};
    const original = api.subscribe.bind(api);
    vi.spyOn(api, "subscribe").mockImplementation(
      (s, changed, failed, ready) => {
        disconnected = failed;
        return original(s, changed, failed, ready);
      },
    );
    render(<WorkspaceApp />);
    await login("reader");
    fireEvent.click(
      await screen.findByRole("button", { name: "전달 내용 읽기 →" }),
    );
    const reader = await api.login("reader", "demo");
    const old = await api.snapshot(reader, "reader");
    let resolveLate!: (value: typeof old) => void;
    vi.spyOn(api, "snapshot").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
    );
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => disconnected());
    await act(async () => resolveLate(old));
    expect(screen.getByText("접근 권한을 다시 확인해야 합니다")).toBeTruthy();
    expect(
      screen.queryByText("오후에 책을 읽으셨으며, 물 한 잔을 제공했습니다."),
    ).toBeNull();
  });
  it("coalesces overlapping invalidations and never shows a stale snapshot", async () => {
    let changed=()=>{};
    const subscribe=api.subscribe.bind(api);
    vi.spyOn(api,"subscribe").mockImplementation((s,onChange,failed,ready)=>{
      changed=onChange;return subscribe(s,onChange,failed,ready);
    });
    render(<WorkspaceApp />);await login("author");
    await screen.findByLabelText("원문 메모");
    fireEvent.click(screen.getByRole("button", { name: "내 메모", exact: true }));
    const state=await api.snapshot(await api.login("author","demo"),"author");
    const stale=structuredClone(state),fresh=structuredClone(state);
    stale.submissions[0].final="오래된 재조회 내용";
    fresh.submissions[0].final="가장 최신인 재조회 내용";fresh.revision++;
    let resolveOld!:(value:typeof state)=>void,resolveNew!:(value:typeof state)=>void;
    const snapshot=vi.spyOn(api,"snapshot")
      .mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}))
      .mockImplementationOnce(()=>new Promise(resolve=>{resolveNew=resolve;}));
    act(()=>{changed();changed();changed();});
    expect(snapshot).toHaveBeenCalledTimes(1);
    await act(async()=>resolveOld(stale));
    await waitFor(()=>expect(snapshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("오래된 재조회 내용")).toBeNull();
    await act(async()=>resolveNew(fresh));
    expect(await screen.findByText("가장 최신인 재조회 내용")).toBeTruthy();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
  it("requires generation and explicit submission and preserves manual text on regeneration cancellation", async () => {
    render(<WorkspaceApp />);
    await login("author");
    await screen.findByLabelText("원문 메모");
    fireEvent.change(screen.getByLabelText("돌봄 대상"), {
      target: { value: "s1" },
    });
    fireEvent.change(screen.getByLabelText("원문 메모"), {
      target: { value: "합성 메모입니다." },
    });
    fireEvent.click(screen.getByRole("button", { name: "✧ 초안 만들기" }));
    const final = await screen.findByLabelText("제출할 최종 초안");
    fireEvent.change(final, { target: { value: "내가 직접 수정한 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "초안 다시 생성" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }),
    );
    expect((final as HTMLTextAreaElement).value).toBe("내가 직접 수정한 초안");
    const author = await api.login("author", "demo");
    expect((await api.snapshot(author, "author")).submissions).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "확인했어요 · 검토 요청 →" }),
    );
    await screen.findByText("담당자에게 검토를 요청했습니다.", {
      exact: false,
    });
    expect((await api.snapshot(author, "author")).submissions).toHaveLength(4);
  });
  it("restores saved recipients and keeps a separate preview before republication", async () => {
    render(<WorkspaceApp />);
    await login("reviewer");
    await screen.findByRole("heading", { name: "검토함" });
    const reviewer = await api.login("reviewer", "demo");
    await act(async () => {
      await api.execute(reviewer, "reviewer", {
        type: "revoke",
        id: "p1",
        version: 1,
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "공개 기록", exact: true }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "내용·수신자 선택" }),
    );
    const preview = screen.getByRole("button", {
      name: "공개 내용 미리보기 →",
    }) as HTMLButtonElement;
    expect((screen.getByRole('checkbox',{name:'김민서'}) as HTMLInputElement).checked).toBe(true);
    expect(preview.disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox',{name:'수신자 전체 선택'}));
    expect(preview.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox',{name:'수신자 전체 선택'}));
    fireEvent.click(preview);
    expect(
      screen.getByRole("dialog", { name: "공개 전 마지막 확인" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'이전',exact:true}));
    await screen.findByRole('dialog',{name:'공개 내용과 수신자 선택'});
    expect((screen.getByRole('checkbox',{name:'김민서'}) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('button',{name:'계속 작성'})).toBeNull();
    act(()=>history.forward());
    await screen.findByRole('dialog',{name:'공개 전 마지막 확인'});
    expect(
      (await api.snapshot(await api.login("reader", "demo"), "reader"))
        .publications,
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", { name: "선택한 수신자에게 공개" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      (await api.snapshot(await api.login("reader", "demo"), "reader"))
        .publications,
    ).toHaveLength(1);
  });
});

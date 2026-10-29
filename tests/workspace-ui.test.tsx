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
  localStorage.clear();
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
  it("forces explicit recipients and a separate preview before publication", async () => {
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
    expect(preview.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "김민서" }));
    fireEvent.click(preview);
    expect(
      screen.getByRole("dialog", { name: "공개 전 마지막 확인" }),
    ).toBeTruthy();
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

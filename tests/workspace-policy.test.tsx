import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockGateway } from "../src/workspace/mock";
import type { Command, Session } from "../src/workspace/model";

const api = new MockGateway();
let reviewer: Session, author: Session, reader: Session;
const submit = (requestId: string): Command => ({
  type: "submit",
  subjectId: "s1",
  source: "합성 관찰 메모",
  generated: "합성 초안",
  final: "작성자가 수정한 합성 초안",
  language: "ko",
  requestId,
});
beforeEach(async () => {
  localStorage.clear();
  reviewer = await api.login("reviewer", "demo");
  author = await api.login("author", "demo");
  reader = await api.login("reader", "demo");
});

describe("CareBridge role and membership boundaries", () => {
  it("rejects ordinary role switching and grants only the dedicated admin exception", async () => {
    await expect(api.snapshot(author, "reviewer")).rejects.toThrow("역할");
    await expect(
      api.execute(reader, "reader", {
        type: "subject",
        name: "테스트",
        memo: "",
      }),
    ).rejects.toThrow("관리자");
    const admin = await api.login("admin", "demo");
    for (const role of ["author", "reviewer", "reader"] as const)
      expect((await api.snapshot(admin, role)).workspace).not.toBeNull();
    await expect(
      api.register("위장 관리자", "admin", "demo", "reviewer"),
    ).rejects.toThrow("ID");
  });
  it("requires approval, supports rejected re-requests, and never shares other authors notes", async () => {
    const newAuthor = await api.register(
      "합성 작성자",
      "new-author",
      "demo",
      "author",
    );
    await api.execute(newAuthor, "author", { type: "join", code: "CARE2026" });
    expect((await api.snapshot(newAuthor, "author")).subjects).toEqual([]);
    await expect(
      api.execute(newAuthor, "author", submit("blocked")),
    ).rejects.toThrow("접근 권한");
    await api.execute(reviewer, "reviewer", {
      type: "membership",
      userId: newAuthor.user.id,
      status: "rejected",
    });
    await api.execute(newAuthor, "author", { type: "join", code: "CARE2026" });
    await api.execute(reviewer, "reviewer", {
      type: "membership",
      userId: newAuthor.user.id,
      status: "active",
    });
    expect((await api.snapshot(newAuthor, "author")).submissions).toEqual([]);
    await api.execute(newAuthor, "author", submit("own"));
    expect((await api.snapshot(newAuthor, "author")).submissions).toHaveLength(
      1,
    );
    expect((await api.snapshot(author, "author")).submissions).toHaveLength(3);
  });
  it("removes author access while preserving submitted records for review", async () => {
    await api.execute(reviewer, "reviewer", {
      type: "membership",
      userId: "author",
      status: "removed",
    });
    const blocked = await api.snapshot(author, "author");
    expect(blocked.submissions).toEqual([]);
    expect(blocked.subjects).toEqual([]);
    await expect(
      api.execute(author, "author", submit("blocked")),
    ).rejects.toThrow("접근 권한");
    expect((await api.snapshot(reviewer, "reviewer")).submissions).toHaveLength(
      3,
    );
  });
  it("transfers sole ownership with history and denies the old owner", async () => {
    await api.execute(reviewer, "reviewer", {
      type: "transfer",
      userId: "successor",
    });
    expect((await api.snapshot(reviewer, "reviewer")).submissions).toEqual([]);
    await expect(
      api.execute(reviewer, "reviewer", {
        type: "subject",
        name: "테스트",
        memo: "",
      }),
    ).rejects.toThrow("접근 권한");
    const next = await api.login("successor", "demo");
    const snapshot = await api.snapshot(next, "reviewer");
    expect(snapshot.workspace?.ownerId).toBe("successor");
    expect(snapshot.submissions).toHaveLength(3);
    expect(snapshot.audit[0].actor).toBe("김지현");
  });
  it("creates an empty workspace and assigns distinct sequential numbers to same-name subjects", async () => {
    api.reset(true);
    await api.execute(reviewer, "reviewer", {
      type: "createWorkspace",
      name: "합성 기관",
    });
    await api.execute(reviewer, "reviewer", {
      type: "subject",
      name: "김철수",
      memo: "",
    });
    await api.execute(reviewer, "reviewer", {
      type: "subject",
      name: "김철수",
      memo: "",
    });
    const snapshot = await api.snapshot(reviewer, "reviewer");
    expect(snapshot.workspace?.code).toBeTruthy();
    expect(snapshot.subjects.map((s) => s.number)).toEqual([1, 2]);
  });
});

describe("CareBridge submission and publication invariants", () => {
  it("retries one request once, rejects changed replay payloads and preserves independent resubmissions", async () => {
    const command = submit("retry");
    await api.execute(author, "author", command);
    await api.execute(author, "author", command);
    let notes = (await api.snapshot(author, "author")).submissions;
    expect(notes).toHaveLength(4);
    if (command.type !== "submit") throw new Error("fixture");
    await expect(
      api.execute(author, "author", { ...command, final: "different" }),
    ).rejects.toThrow("이미 처리");
    const first = structuredClone(notes[0]);
    await api.execute(author, "author", {
      ...command,
      final: "새 최종본",
      requestId: "intentional",
      threadId: first.threadId,
      previousId: first.id,
    });
    notes = (await api.snapshot(author, "author")).submissions;
    expect(notes).toHaveLength(5);
    expect(notes.find((n) => n.id === first.id)).toEqual(first);
    expect(notes[0].previousId).toBe(first.id);
    expect(notes[0].status).toBe("pending");
  });
  it("requires hold reasons, rejects stale reviews and does not publish on confirmation", async () => {
    const command = {
      type: "review",
      id: "n1",
      version: 1,
      content: "확인 내용",
      reason: "",
      status: "held",
    } as const;
    await expect(api.execute(reviewer, "reviewer", command)).rejects.toThrow(
      "보류 사유",
    );
    await api.execute(reviewer, "reviewer", {
      ...command,
      reason: "추가 확인",
      status: "pending",
    });
    await expect(
      api.execute(reviewer, "reviewer", { ...command, status: "confirmed" }),
    ).rejects.toThrow("변경");
    await api.execute(reviewer, "reviewer", {
      ...command,
      version: 2,
      status: "confirmed",
    });
    expect((await api.snapshot(reader, "reader")).publications).toHaveLength(1);
  });
  it("projects only assigned public content and immediately invalidates revoked and expelled readers", async () => {
    const first = await api.snapshot(reader, "reader");
    expect(first.submissions).toEqual([]);
    expect(first.subjects).toEqual([]);
    expect(first.members).toEqual([]);
    expect(first.audit).toEqual([]);
    expect(first.publications[0].recipients).toEqual([]);
    const changed = vi.fn();
    const stop = api.subscribe(reader, changed, vi.fn(), vi.fn());
    await api.execute(reviewer, "reviewer", {
      type: "revoke",
      id: "p1",
      version: 1,
    });
    expect(changed).toHaveBeenCalledOnce();
    expect((await api.snapshot(reader, "reader")).publications).toEqual([]);
    await api.execute(reviewer, "reviewer", {
      type: "publish",
      submissionId: "n3",
      version: 2,
      content: "선별 공개문",
      recipients: ["reader"],
    });
    expect((await api.snapshot(reader, "reader")).publications[0].content).toBe(
      "선별 공개문",
    );
    await api.execute(reviewer, "reviewer", {
      type: "membership",
      userId: "reader",
      status: "removed",
    });
    expect((await api.snapshot(reader, "reader")).publications).toEqual([]);
    stop();
  });
  it("rejects publication to unapproved recipients or from unconfirmed records", async () => {
    await expect(
      api.execute(reviewer, "reviewer", {
        type: "publish",
        submissionId: "n1",
        version: 1,
        content: "공개",
        recipients: ["reader"],
      }),
    ).rejects.toThrow("확정");
    await api.execute(reviewer, "reviewer", {
      type: "revoke",
      id: "p1",
      version: 1,
    });
    await expect(
      api.execute(reviewer, "reviewer", {
        type: "publish",
        submissionId: "n3",
        version: 2,
        content: "공개",
        recipients: ["pending-reader"],
      }),
    ).rejects.toThrow("활성 열람자");
  });
});

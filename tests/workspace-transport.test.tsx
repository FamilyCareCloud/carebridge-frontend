import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpGateway } from "../src/workspace/gateway";
const session = {
  token: "test-token",
  user: { id: "reader", name: "합성 열람자", role: "reader" as const },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("CareBridge HTTP adapter contract", () => {
  it("never falls back to synthetic data when API configuration is missing or requests fail", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "권한 없음" }), { status: 403 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(new HttpGateway("").login("admin", "demo")).rejects.toThrow(
      "연결을 준비",
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      new HttpGateway("https://api.example.invalid").snapshot(
        session,
        "reader",
      ),
    ).rejects.toThrow("권한 없음");
  });
  it("sends authenticated uncached requests to the explicitly configured backend", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await new HttpGateway("https://api.example.invalid/").execute(
      session,
      "reader",
      { type: "join", code: "CODE" },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.invalid/commands",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        body: JSON.stringify({
          view: "reader",
          command: { type: "join", code: "CODE" },
        }),
      }),
    );
  });
  it("parses split SSE frames and reports disconnection so the UI can clear visible records", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamController = c;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
        ),
    );
    const connected = vi.fn(),
      changed = vi.fn(),
      failed = vi.fn();
    const stop = new HttpGateway("https://api.example.invalid").subscribe(
      session,
      changed,
      failed,
      connected,
    );
    await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce());
    const encoder = new TextEncoder();
    streamController.enqueue(encoder.encode("event: changed\r\ndata: {}\r"));
    streamController.enqueue(encoder.encode("\n\r\n"));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    streamController.close();
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    stop();
  });
  it("times out a silent event connection and aborts it", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const failed = vi.fn();
    const stop = new HttpGateway("https://api.example.invalid").subscribe(
      session,
      vi.fn(),
      failed,
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(45000);
    expect(failed).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    stop();
  });
});

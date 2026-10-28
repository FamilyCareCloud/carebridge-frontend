import type { Command, Gateway, Role, Session, Snapshot } from "./model";
import { MockGateway } from "./mock";

// Provisional transport: backend agreement required. Never fall back to mock on API failure.
export class HttpGateway implements Gateway {
  mode = "api" as const;
  private base: string;
  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }
  private async request<T>(
    path: string,
    body?: unknown,
    session?: Session,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.base)
      throw new Error(
        "새 API 연결을 준비 중입니다. 백엔드 계약 확정 후 서비스 주소를 설정해 주세요.",
      );
    const response = await fetch(`${this.base}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `요청을 처리하지 못했습니다 (${response.status}).`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  }
  login(id: string, password: string) {
    return this.request<Session>("/session", { id, password });
  }
  register(name: string, id: string, password: string, role: Role) {
    return this.request<Session>("/registration", { name, id, password, role });
  }
  snapshot(session: Session, role: Role) {
    return this.request<Snapshot>(
      `/workspace?view=${role}`,
      undefined,
      session,
    );
  }
  execute(session: Session, role: Role, command: Command) {
    return this.request<void>("/commands", { view: role, command }, session);
  }
  generate(session: Session, role: Role, source: string, language: string) {
    return this.request<{ text: string; source: string }>(
      "/drafts",
      { view: role, source, language },
      session,
    );
  }
  subscribe(
    session: Session,
    onChange: () => void,
    onDisconnect: () => void,
    onConnected: () => void,
  ) {
    const controller = new AbortController();
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = () => {
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => {
        onDisconnect();
        controller.abort();
      }, 45000);
    };
    armTimeout();
    void (async () => {
      try {
        if (!this.base) throw new Error("API not configured");
        const response = await fetch(`${this.base}/events`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
          cache: "no-store",
        });
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        )
          throw new Error("Event stream unavailable");
        onConnected();
        armTimeout();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (!controller.signal.aborted) {
          const value = await reader.read();
          if (value.done) throw new Error("Disconnected");
          armTimeout();
          pending = (
            pending + decoder.decode(value.value, { stream: true })
          ).replace(/\r\n/g, "\n");
          let end: number;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const event = pending.slice(0, end);
            pending = pending.slice(end + 2);
            if (event.split("\n").some((line) => line.startsWith("data:")))
              onChange();
          }
        }
      } catch {
        if (!controller.signal.aborted) onDisconnect();
      } finally {
        clearTimeout(heartbeat);
      }
    })();
    return () => {
      clearTimeout(heartbeat);
      controller.abort();
    };
  }
}
export const isMock =
  import.meta.env.DEV && import.meta.env.MODE === "carebridge";
export const gateway: Gateway = isMock
  ? new MockGateway()
  : new HttpGateway(import.meta.env.VITE_CAREBRIDGE_API_URL || "");

import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import bridgeExtension from "../defaults/extensions/bryti-bridge.js";

interface RegisteredTool {
  name: string;
  execute: (toolCallId: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function makeTmpHome(): string {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bridge-home-"));
  vi.stubEnv("HOME", tmpHome);
  return tmpHome;
}

function makeFakePi() {
  const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void>>();
  const tools = new Map<string, RegisteredTool>();
  const sentMessages: string[] = [];

  const pi = {
    on: (event: string, handler: (event: unknown, ctx: any) => Promise<void>) => {
      handlers.set(event, handler);
    },
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
    sendUserMessage: (text: string) => {
      sentMessages.push(text);
    },
  };

  bridgeExtension(pi as any);
  return { handlers, tools, sentMessages };
}

async function waitFor<T>(fn: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function readMode(filePath: string): number {
  return fs.statSync(filePath).mode & 0o777;
}

function sendBridgeMessage(sockPath: string, text: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(sockPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error("bridge response timed out"));
    }, 1000);

    conn.on("connect", () => {
      conn.write(`${JSON.stringify({ type: "user_message", text })}\n`);
    });

    conn.on("data", (data) => {
      buffer += data.toString();
      const line = buffer.split("\n").find((candidate) => candidate.trim());
      if (!line) return;
      clearTimeout(timeout);
      conn.end();
      resolve(JSON.parse(line) as Record<string, unknown>);
    });

    conn.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("default pi bridge extension", () => {
  let tmpHome: string | null = null;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      tmpHome = null;
    }
  });

  it("creates a discoverable private socket and injects user messages", async () => {
    tmpHome = makeTmpHome();
    const { handlers, sentMessages } = makeFakePi();
    const sessionId = "session-57713565";

    await handlers.get("session_start")?.({}, {
      sessionManager: { getSessionId: () => sessionId },
    });

    const socketsDir = path.join(tmpHome, ".pi", "agent", "sockets");
    const sockPath = await waitFor(() => {
      const file = fs.readdirSync(socketsDir).find((entry) => entry.startsWith(`${sessionId}-`) && entry.endsWith(".sock"));
      return file ? path.join(socketsDir, file) : null;
    });
    await waitFor(() => (readMode(sockPath) === 0o600 ? sockPath : null));

    expect(readMode(socketsDir)).toBe(0o700);
    expect(path.basename(sockPath)).toMatch(new RegExp(`^${sessionId}-[0-9a-f]{16}\\.sock$`));

    const response = await sendBridgeMessage(sockPath, "hello from bryti");
    expect(response).toEqual({ ok: true });
    expect(sentMessages).toEqual(["hello from bryti"]);

    await handlers.get("session_shutdown")?.({}, {});
    expect(fs.existsSync(sockPath)).toBe(false);
  });

  it("reports a missing Bryti instance for notify calls", async () => {
    tmpHome = makeTmpHome();
    const { tools } = makeFakePi();
    const notify = tools.get("bryti_notify");

    const result = await notify?.execute("call-1", { message: "done" });
    const payload = JSON.parse(result?.content[0].text ?? "{}");

    expect(payload.error).toContain("Bryti is not running");
  });

  it("writes private notification event files for Bryti", async () => {
    tmpHome = makeTmpHome();
    const eventsDir = path.join(tmpHome, "bryti-events");
    const agentDir = path.join(tmpHome, ".pi", "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "bryti-instance.json"),
      JSON.stringify({ eventsDir, allowedUsers: ["123", "456"] }),
      "utf-8",
    );

    const { tools } = makeFakePi();
    const notify = tools.get("bryti_notify");
    const result = await notify?.execute("call-1", { message: "task complete" });
    const payload = JSON.parse(result?.content[0].text ?? "{}");

    expect(payload).toMatchObject({ ok: true, userId: "123" });
    const files = fs.readdirSync(eventsDir).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(1);

    const eventPath = path.join(eventsDir, files[0]);
    expect(readMode(eventsDir)).toBe(0o700);
    expect(readMode(eventPath)).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(eventPath, "utf-8"))).toEqual({
      userId: "123",
      text: "task complete",
      source: "pi-session",
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createPiSessionTools } from "./pi-sessions.js";

type ToolResult = Awaited<ReturnType<ReturnType<typeof createPiSessionTools>[number]["execute"]>>;

function makeTmpSessionsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-sessions-test-"));
}

function makeSessionFile(root: string, sessionId: string, cwd = "/tmp/pi-bridge-project"): string {
  const encodedDir = "--tmp-pi-bridge-project--";
  const dir = path.join(root, encodedDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `20260630_${sessionId}.jsonl`);
  const now = new Date().toISOString();
  const lines = [
    { type: "session", id: sessionId, cwd, timestamp: now },
    { type: "message", id: "root", timestamp: now, message: { role: "user", content: "start" } },
  ];
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
  return filePath;
}

function parseResult(result: ToolResult): Record<string, any> {
  return JSON.parse(result.content[0].text) as Record<string, any>;
}

function injectTool() {
  const tool = createPiSessionTools().find((candidate) => candidate.name === "pi_session_inject");
  if (!tool) throw new Error("pi_session_inject tool not registered");
  return tool;
}

function socketsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "sockets");
}

describe("pi_session_inject bridge behavior", () => {
  let sessionsDir: string;
  let previousSessionsDir: string | undefined;
  const socketPaths: string[] = [];
  const servers: net.Server[] = [];

  beforeEach(() => {
    sessionsDir = makeTmpSessionsDir();
    previousSessionsDir = process.env.PI_SESSIONS_DIR;
    process.env.PI_SESSIONS_DIR = sessionsDir;
  });

  afterEach(() => {
    if (previousSessionsDir === undefined) {
      delete process.env.PI_SESSIONS_DIR;
    } else {
      process.env.PI_SESSIONS_DIR = previousSessionsDir;
    }
    for (const server of servers.splice(0)) {
      server.close();
    }
    for (const sockPath of socketPaths.splice(0)) {
      try { fs.unlinkSync(sockPath); } catch { /* already gone */ }
    }
    fs.rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("discovers the tokenized bridge socket and injects into a running session", async () => {
    const sessionId = `test-${crypto.randomBytes(8).toString("hex")}`;
    makeSessionFile(sessionsDir, sessionId);

    fs.mkdirSync(socketsDir(), { recursive: true, mode: 0o700 });
    const sockPath = path.join(socketsDir(), `${sessionId}-${crypto.randomBytes(8).toString("hex")}.sock`);
    socketPaths.push(sockPath);

    const received = new Promise<string>((resolve) => {
      const server = net.createServer((conn) => {
        let buffer = "";
        conn.on("data", (data) => {
          buffer += data.toString();
          const line = buffer.split("\n").find((candidate) => candidate.trim());
          if (!line) return;
          const request = JSON.parse(line) as { text: string };
          resolve(request.text);
          conn.write(`${JSON.stringify({ ok: true })}\n`);
        });
      });
      servers.push(server);
      server.listen(sockPath);
    });

    await new Promise((resolve) => servers[0].once("listening", resolve));

    const result = await injectTool().execute("call-1", {
      session_id: sessionId,
      message: "continue please",
    });

    expect(parseResult(result)).toMatchObject({
      injected: true,
      method: "bridge",
      session_id: sessionId,
      message_preview: "continue please",
    });
    await expect(received).resolves.toBe("continue please");
  });

  it("reports missing bridge sockets for sessions detected as running", async () => {
    const sessionId = `test-${crypto.randomBytes(8).toString("hex")}`;
    const filePath = makeSessionFile(sessionsDir, sessionId);
    fs.utimesSync(filePath, new Date(), new Date());

    const result = await injectTool().execute("call-1", {
      session_id: sessionId,
      message: "continue please",
    });
    const payload = parseResult(result);

    expect(payload.error).toContain("Session is running but bridge injection failed");
    expect(payload.error).toContain("Bridge socket not found");
  });
});

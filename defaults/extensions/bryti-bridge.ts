/**
 * Pi Bridge - two-way bridge between pi sessions and Bryti.
 *
 * Provides two capabilities:
 *
 * 1. Bryti to pi live injection.
 *    Creates a Unix socket at ~/.pi/agent/sockets/<session-id>-<token>.sock.
 *    Bryti discovers the socket by listing the sockets directory and matching
 *    the session ID prefix. The random token prevents blind connection
 *    attempts. The socket directory is kept at 0700 and the socket at 0600.
 *
 *    Protocol: one JSON object per line.
 *      Request:  { "type": "user_message", "text": "..." }
 *      Response: { "ok": true } or { "ok": false, "error": "..." }
 *
 * 2. Pi to Bryti notification.
 *    Registers the bryti_notify tool. The tool writes a JSON event file into
 *    Bryti's event directory. Bryti advertises that directory in
 *    ~/.pi/agent/bryti-instance.json at startup, so notifications can queue
 *    while Bryti is down and be picked up on the next scan.
 */

import * as crypto from "node:crypto";
import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface BrytiInstance {
  eventsDir: string;
  allowedUsers: string[];
}

function socketsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "sockets");
}

function socketPath(sessionId: string, token: string): string {
  return path.join(socketsDir(), `${sessionId}-${token}.sock`);
}

function instanceFilePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "bryti-instance.json");
}

function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
}

function readInstance(): BrytiInstance | null {
  try {
    const raw = fs.readFileSync(instanceFilePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<BrytiInstance>;
    if (!parsed.eventsDir || !Array.isArray(parsed.allowedUsers)) return null;
    return {
      eventsDir: parsed.eventsDir,
      allowedUsers: parsed.allowedUsers.map(String),
    };
  } catch {
    return null;
  }
}

function writeNotifyEvent(eventsDir: string, userId: string, message: string): string {
  if (!path.isAbsolute(eventsDir)) {
    throw new Error("Bryti instance file contains a non-absolute eventsDir");
  }

  ensurePrivateDir(eventsDir);

  const filename = `notify-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
  const tmpPath = path.join(eventsDir, `.${filename}.tmp`);
  const filePath = path.join(eventsDir, filename);
  const event = { userId, text: message, source: "pi-session" };

  try {
    fs.writeFileSync(tmpPath, JSON.stringify(event, null, 2), { encoding: "utf-8", mode: 0o600 });
    try { fs.chmodSync(tmpPath, 0o600); } catch { /* best effort */ }
    fs.renameSync(tmpPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
    return filename;
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}

export default function (pi: ExtensionAPI) {
  let server: net.Server | null = null;
  let currentSocketPath: string | null = null;
  let sendUserMessage: ((text: string) => void) | null = null;

  function closeBridge(): void {
    if (server) {
      server.close();
      server = null;
    }
    if (currentSocketPath) {
      try { fs.unlinkSync(currentSocketPath); } catch { /* already gone */ }
      currentSocketPath = null;
    }
    sendUserMessage = null;
  }

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) return;

    closeBridge();
    sendUserMessage = (text: string) => pi.sendUserMessage(text);

    const dir = socketsDir();
    ensurePrivateDir(dir);

    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${sessionId}-`) && f.endsWith(".sock")) {
          try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore stale socket cleanup failure */ }
        }
      }
    } catch { /* directory may disappear between mkdir and readdir */ }

    const token = crypto.randomBytes(8).toString("hex");
    const sockPath = socketPath(sessionId, token);
    currentSocketPath = sockPath;

    server = net.createServer((conn) => {
      let buffer = "";

      conn.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as { type?: unknown; text?: unknown };
            if (msg.type === "user_message" && typeof msg.text === "string" && sendUserMessage) {
              sendUserMessage(msg.text);
              conn.write(`${JSON.stringify({ ok: true })}\n`);
            } else {
              conn.write(`${JSON.stringify({ ok: false, error: "Unknown message type or bridge not ready" })}\n`);
            }
          } catch {
            conn.write(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
          }
        }
      });

      conn.on("error", () => { /* ignore connection errors */ });
    });

    server.on("error", (err) => {
      console.error(`[pi-bridge] Socket error: ${err.message}`);
    });

    server.listen(sockPath, () => {
      try { fs.chmodSync(sockPath, 0o600); } catch { /* best effort */ }
    });

    server.unref();
  });

  pi.on("session_shutdown", async () => {
    closeBridge();
  });

  pi.registerTool({
    name: "bryti_notify",
    label: "bryti_notify",
    description:
      "Send a notification message to Bryti, the AI assistant on Telegram or WhatsApp. " +
      "Bryti will deliver the message to the target user. Use this to report task completion, " +
      "surface findings, or flag something that needs the user's attention without requiring " +
      "the user to poll this session. If Bryti is not running, the event file will be picked up " +
      "the next time Bryti starts.",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description:
            "The Telegram or WhatsApp user ID to notify. Must be an allowed Bryti user. " +
            "If omitted, Bryti uses the first configured user.",
        },
        message: {
          type: "string",
          description: "The message text to deliver. Be concise and include the key result.",
        },
      },
      required: ["message"],
    } as any,
    async execute(_toolCallId: string, params: { userId?: string; message: string }) {
      const instance = readInstance();
      if (!instance) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error:
                "Bryti is not running or has not written ~/.pi/agent/bryti-instance.json. " +
                "Start Bryti first, or leave a note in the session for the user to read manually.",
            }),
          }],
        };
      }

      let userId = params.userId;
      if (userId && !instance.allowedUsers.includes(userId)) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `userId "${userId}" is not an allowed Bryti user. Allowed: ${instance.allowedUsers.join(", ")}`,
            }),
          }],
        };
      }

      if (!userId) {
        userId = instance.allowedUsers[0];
        if (!userId) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: "No allowed users configured in the Bryti instance file." }),
            }],
          };
        }
      }

      try {
        const eventFile = writeNotifyEvent(instance.eventsDir, userId, params.message);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              userId,
              message: params.message.slice(0, 100) + (params.message.length > 100 ? "..." : ""),
              eventFile,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Failed to write event file: ${(err as Error).message}` }),
          }],
        };
      }
    },
  });
}

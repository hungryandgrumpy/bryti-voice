     
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { loadOrCreateServerKeyPair } from "./server-key-store.js";
import { WebE2EEHttpServer } from "./http-server.js";
import { WebE2EEWsServer } from "./ws-server.js";

async function createServers(pathPrefix = "/") {
  const tempDir = fs.mkdtempSync("/tmp/bryti-web-e2ee-ws-");
  const serverKeys = await loadOrCreateServerKeyPair(tempDir);
  const httpServer = new WebE2EEHttpServer({
    listenHost: "127.0.0.1",
    listenPort: 0,
    publicOrigin: "https://chat.example.test",
    pathPrefix,
    serverInfo: {
      channel: "web_e2ee",
      protocolVersion: 1,
      designVersion: "slice3-transport-shell",
      serverPublicFingerprint: serverKeys.fingerprint,
      pathPrefix,
      pairingEnabled: true,
      encryptedTransport: false,
      chatEnabled: false,
    },
  });
  await httpServer.start();
  const wsServer = new WebE2EEWsServer(httpServer.getHttpServer(), {
    pathPrefix,
    allowedOrigins: ["https://chat.example.test"],
  });
  return { tempDir, httpServer, wsServer };
}

async function connectWebSocket(url: string, origin: string): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function connectWebSocketWithHello(url: string, origin: string): Promise<{
  ws: WebSocket;
  hello: Record<string, unknown>;
}> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    ws.once("message", (data) => {
      try {
        resolve({
          ws,
          hello: JSON.parse(String(data)) as Record<string, unknown>,
        });
      } catch (error) {
        reject(error);
      }
    });
    ws.once("error", reject);
  });
}

async function nextJsonMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(String(data)) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("WebE2EEWsServer", () => {
  const tempDirs: string[] = [];
  const servers: Array<{ httpServer: WebE2EEHttpServer; wsServer: WebE2EEWsServer }> = [];

  afterEach(async () => {
    for (const entry of servers.splice(0)) {
      entry.wsServer.detachFrom(entry.httpServer.getHttpServer());
      await entry.wsServer.stop();
      await entry.httpServer.stop();
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an allowed origin", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);

    const ws = await connectWebSocket(`${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`, "https://chat.example.test");
    ws.close();
    expect(ws.readyState).not.toBe(WebSocket.CLOSED);
  });

  it("rejects a disallowed origin", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);

    await expect(connectWebSocket(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://evil.example.test",
    )).rejects.toThrow();
  });

  it("sends hello and status frames that do not claim encrypted chat works", async () => {
    const created = await createServers("/chat");
    tempDirs.push(created.tempDir);
    servers.push(created);

    const { ws, hello } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/chat/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify({ kind: "status" }));
    const status = await nextJsonMessage(ws);

    expect(hello).toMatchObject({
      kind: "hello",
      channel: "web_e2ee",
      encrypted: false,
      chat: false,
    });
    expect(status).toMatchObject({
      kind: "status",
      channel: "web_e2ee",
      encrypted: false,
      chat: false,
    });

    ws.close();
  });
});

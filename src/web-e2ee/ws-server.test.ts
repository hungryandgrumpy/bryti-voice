import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  deriveDirectionalAesKeys,
  encryptPayload,
  exportPublicKeyJwk,
  exportRawPublicKey,
  fingerprintPublicKey,
  generateMessageNonce,
  generateX25519KeyPair,
} from "./crypto.js";
import { bytesToBase64Url } from "./encoding.js";
import { createDeviceStore } from "./device-store.js";
import { WebE2EEHttpServer } from "./http-server.js";
import { loadOrCreateServerKeyPair } from "./server-key-store.js";
import { WebE2EEWsServer } from "./ws-server.js";

async function createServers(pathPrefix = "/") {
  const tempDir = fs.mkdtempSync("/tmp/bryti-web-e2ee-ws-");
  const serverKeys = await loadOrCreateServerKeyPair(tempDir);
  const deviceStore = createDeviceStore(tempDir);
  const onDecryptedMessage = vi.fn(async () => {});
  const httpServer = new WebE2EEHttpServer({
    listenHost: "127.0.0.1",
    listenPort: 0,
    publicOrigin: "https://chat.example.test",
    pathPrefix,
    serverInfo: {
      channel: "web_e2ee",
      protocolVersion: 1,
      designVersion: "slice4b-encrypted-inbound",
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
    deviceStore,
    serverKeys,
    onDecryptedMessage,
  });
  return { tempDir, httpServer, wsServer, serverKeys, deviceStore, onDecryptedMessage };
}

async function registerDevice(deviceStore: ReturnType<typeof createDeviceStore>, status: "active" | "revoked" = "active") {
  const devicePair = await generateX25519KeyPair();
  const publicKeyJwk = await exportPublicKeyJwk(devicePair.publicKey);
  const publicKeyFingerprint = await fingerprintPublicKey(devicePair.publicKey);
  await deviceStore.add({
    deviceId: "wed_test",
    label: "Test Device",
    publicKeyJwk,
    publicKeyFingerprint,
    pairedAt: new Date().toISOString(),
    lastSeenAt: null,
    status,
    notes: "",
    lastInboundCounter: 0,
    lastOutboundCounter: 0,
  });
  return { devicePair, publicKeyJwk };
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

async function makeEncryptedFrame(counter: number, text: string, devicePair: CryptoKeyPair, serverPublicKey: CryptoKey) {
  const serverPublicRaw = await exportRawPublicKey(serverPublicKey);
  const devicePublicRaw = await exportRawPublicKey(devicePair.publicKey);
  const { c2sKey } = await deriveDirectionalAesKeys(
    devicePair.privateKey,
    serverPublicKey,
    serverPublicRaw,
    devicePublicRaw,
  );
  const frame = {
    v: 1 as const,
    kind: "msg" as const,
    deviceId: "wed_test",
    messageId: `msg_${counter}`,
    counter,
    ts: "2026-01-01T00:00:00.000Z",
    nonce: bytesToBase64Url(generateMessageNonce()),
  };
  return {
    ...frame,
    ciphertext: await encryptPayload(c2sKey, frame, { kind: "text", text }),
  };
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

  it("sends hello and status frames without claiming replies are implemented", async () => {
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
      encrypted: true,
      chat: false,
    });
    expect(status).toMatchObject({
      kind: "status",
      channel: "web_e2ee",
      encrypted: true,
      chat: false,
    });

    ws.close();
  });

  it("accepts a valid encrypted frame from a paired device", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    const { devicePair } = await registerDevice(created.deviceStore);
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify(await makeEncryptedFrame(1, "hello bryti", devicePair, created.serverKeys.publicKey)));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(created.onDecryptedMessage).toHaveBeenCalledTimes(1);
    expect(created.onDecryptedMessage).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: "wed_test",
      messageId: "msg_1",
      counter: 1,
      payload: { kind: "text", text: "hello bryti" },
    }));
    expect(created.deviceStore.get("wed_test")?.lastInboundCounter).toBe(1);

    ws.close();
  });

  it("rejects plaintext chat frames and does not call handler", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    await registerDevice(created.deviceStore);
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify({ kind: "msg", text: "plaintext" }));
    const error = await nextJsonMessage(ws);

    expect(error).toMatchObject({ kind: "error", code: "invalid_frame" });
    expect(created.onDecryptedMessage).not.toHaveBeenCalled();
    expect(created.deviceStore.get("wed_test")?.lastInboundCounter).toBe(0);
    ws.close();
  });

  it("rejects unknown device frames", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    const { devicePair } = await generateX25519KeyPair().then((pair) => ({ devicePair: pair }));
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify(await makeEncryptedFrame(1, "hello", devicePair, created.serverKeys.publicKey)));
    const error = await nextJsonMessage(ws);
    expect(error).toMatchObject({ kind: "error", code: "unknown_device" });
    ws.close();
  });

  it("rejects revoked device frames", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    const { devicePair } = await registerDevice(created.deviceStore, "revoked");
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify(await makeEncryptedFrame(1, "hello", devicePair, created.serverKeys.publicKey)));
    const error = await nextJsonMessage(ws);
    expect(error).toMatchObject({ kind: "error", code: "revoked_device" });
    ws.close();
  });

  it("rejects replayed counters", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    const { devicePair } = await registerDevice(created.deviceStore);
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify(await makeEncryptedFrame(1, "hello", devicePair, created.serverKeys.publicKey)));
    await new Promise((resolve) => setTimeout(resolve, 25));
    ws.send(JSON.stringify(await makeEncryptedFrame(1, "hello again", devicePair, created.serverKeys.publicKey)));
    const error = await nextJsonMessage(ws);

    expect(error).toMatchObject({ kind: "error", code: "replay_detected" });
    expect(created.deviceStore.get("wed_test")?.lastInboundCounter).toBe(1);
    ws.close();
  });

  it("does not update counter on failed decrypt or invalid payload", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    const { devicePair } = await registerDevice(created.deviceStore);
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    const frame = await makeEncryptedFrame(1, "hello", devicePair, created.serverKeys.publicKey);
    ws.send(JSON.stringify({ ...frame, nonce: bytesToBase64Url(generateMessageNonce()) }));
    const decryptError = await nextJsonMessage(ws);
    expect(decryptError).toMatchObject({ kind: "error", code: "decrypt_failed" });
    expect(created.deviceStore.get("wed_test")?.lastInboundCounter).toBe(0);

    const invalidPayloadFrame = await makeEncryptedFrame(2, "   ", devicePair, created.serverKeys.publicKey);
    ws.send(JSON.stringify(invalidPayloadFrame));
    const payloadError = await nextJsonMessage(ws);
    expect(payloadError).toMatchObject({ kind: "error", code: "decrypt_failed" });
    expect(created.deviceStore.get("wed_test")?.lastInboundCounter).toBe(0);
    ws.close();
  });

  it("catches bridge handler failures without unhandled rejections", async () => {
    const created = await createServers("/");
    tempDirs.push(created.tempDir);
    servers.push(created);
    const { devicePair } = await registerDevice(created.deviceStore);
    created.onDecryptedMessage.mockImplementationOnce(async () => {
      throw new Error("bridge failed");
    });
    const { ws } = await connectWebSocketWithHello(
      `${created.httpServer.getBaseUrl().replace("http", "ws")}/ws`,
      "https://chat.example.test",
    );

    ws.send(JSON.stringify(await makeEncryptedFrame(1, "hello bryti", devicePair, created.serverKeys.publicKey)));
    const error = await nextJsonMessage(ws);

    expect(error).toMatchObject({ kind: "error", code: "handler_failed" });
    expect(created.onDecryptedMessage).toHaveBeenCalledTimes(1);
    expect(created.deviceStore.get("wed_test")?.lastInboundCounter).toBe(1);
    ws.close();
  });
});

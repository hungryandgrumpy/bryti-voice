// src/web-e2ee/http-server.test.ts         
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateServerKeyPair } from "./server-key-store.js";
import { WebE2EEHttpServer } from "./http-server.js";

async function createServer(pathPrefix = "/") {
  const tempDir = fs.mkdtempSync("/tmp/bryti-web-e2ee-http-");
  const serverKeys = await loadOrCreateServerKeyPair(tempDir);
  const server = new WebE2EEHttpServer({
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
  await server.start();
  return { tempDir, server, fingerprint: serverKeys.fingerprint };
}

describe("WebE2EEHttpServer", () => {
  const tempDirs: string[] = [];
  const servers: WebE2EEHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves index.html", async () => {
    const created = await createServer("/");
    tempDirs.push(created.tempDir);
    servers.push(created.server);

    const response = await fetch(`${created.server.getBaseUrl()}/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body).toContain("Bryti web_e2ee");
  });

  it("serves /api/server-info without private data", async () => {
    const created = await createServer("/");
    tempDirs.push(created.tempDir);
    servers.push(created.server);

    const response = await fetch(`${created.server.getBaseUrl()}/api/server-info`);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.channel).toBe("web_e2ee");
    expect(body.serverPublicFingerprint).toBe(created.fingerprint);
    expect(body.chatEnabled).toBe(false);
    expect(body.encryptedTransport).toBe(false);
    expect(body.privateKeyJwk).toBeUndefined();
    expect(body.inviteCodes).toBeUndefined();
  });

  it("respects path_prefix", async () => {
    const created = await createServer("/chat");
    tempDirs.push(created.tempDir);
    servers.push(created.server);

    const indexResponse = await fetch(`${created.server.getBaseUrl()}/chat`);
    const apiResponse = await fetch(`${created.server.getBaseUrl()}/chat/api/server-info`);

    expect(indexResponse.status).toBe(200);
    expect(apiResponse.status).toBe(200);
  });

  it("returns 404 for unknown static paths", async () => {
    const created = await createServer("/");
    tempDirs.push(created.tempDir);
    servers.push(created.server);

    const response = await fetch(`${created.server.getBaseUrl()}/missing.js`);
    expect(response.status).toBe(404);
  });

  it("rejects obvious path traversal", async () => {
    const created = await createServer("/");
    tempDirs.push(created.tempDir);
    servers.push(created.server);

    const response = await fetch(`${created.server.getBaseUrl()}/..%2Fpackage.json`);
    expect([400, 404]).toContain(response.status);
  });
});

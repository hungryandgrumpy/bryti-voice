// src/channels/web_e2ee.test.ts 

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";
import { WebE2EEBridge } from "./web_e2ee.js";
import type { ChannelBridge, Platform } from "./types.js";

describe("WebE2EEBridge", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync("/tmp/bryti-web-e2ee-bridge-");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function getAvailablePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to allocate test port"));
          return;
        }
        const { port } = address;
        server.close((err) => err ? reject(err) : resolve(port));
      });
    });
  }

  function makeBridge(port: number): ChannelBridge {
    return new WebE2EEBridge(tempDir, {
      listen_host: "127.0.0.1",
      listen_port: port,
      public_origin: "https://bryti.tailnet.ts.net",
      allowed_origins: ["https://bryti.tailnet.ts.net"],
      path_prefix: "/",
      pairing: { invite_ttl_minutes: 10 },
    });
  }

  it("uses the web_e2ee platform", async () => {
    const bridge = makeBridge(await getAvailablePort());
    const platform: Platform = bridge.platform;

    expect(bridge.name).toBe("web_e2ee");
    expect(platform).toBe("web_e2ee");
  });

  it("starts the transport shell and stops cleanly", async () => {
    const port = await getAvailablePort();
    const bridge = makeBridge(port);

    await expect(bridge.start()).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(tempDir, "web-e2ee", "server-key.jwk.json"))).toBe(true);

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);

    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it("does not forward websocket payloads into the Bryti message pipeline", async () => {
    const port = await getAvailablePort();
    const bridge = new WebE2EEBridge(tempDir, {
      listen_host: "127.0.0.1",
      listen_port: port,
      public_origin: "https://bryti.tailnet.ts.net",
      allowed_origins: ["https://bryti.tailnet.ts.net"],
      path_prefix: "/",
      pairing: { invite_ttl_minutes: 10 },
    });
    const handler = vi.fn(async () => {});
    bridge.onMessage(handler);

    await bridge.start();

    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Origin: "https://bryti.tailnet.ts.net" },
      });
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });

    ws.send(JSON.stringify({ kind: "msg", text: "plaintext chat should not pass" }));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(handler).not.toHaveBeenCalled();

    ws.close();
    await bridge.stop();
  });

  it("fails loudly for outbound methods until transport exists", async () => {
    const bridge = makeBridge(await getAvailablePort());
    await bridge.start();

    await expect(bridge.sendMessage("c1", "hello")).rejects.toThrow(
      "web_e2ee.sendMessage is not implemented yet (transport shell only)",
    );
    await expect(bridge.editMessage("c1", "m1", "hello")).rejects.toThrow(
      "web_e2ee.editMessage is not implemented yet (transport shell only)",
    );
    await expect(bridge.sendTyping("c1")).rejects.toThrow(
      "web_e2ee.sendTyping is not implemented yet (transport shell only)",
    );
    await expect(bridge.sendApprovalRequest("c1", "approve?", "key")).rejects.toThrow(
      "web_e2ee.sendApprovalRequest is not implemented yet (transport shell only)",
    );

    await bridge.stop();
  });
});

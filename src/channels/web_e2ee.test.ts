// src/channels/web_e2ee.test.ts 

import { describe, it, expect } from "vitest";
import { WebE2EEBridge } from "./web_e2ee.js";
import type { ChannelBridge, Platform } from "./types.js";

describe("WebE2EEBridge", () => {
  function makeBridge(): ChannelBridge {
    return new WebE2EEBridge({
      listen_host: "127.0.0.1",
      listen_port: 8787,
      public_origin: "https://bryti.tailnet.ts.net",
      allowed_origins: ["https://bryti.tailnet.ts.net"],
      path_prefix: "/",
      pairing: { invite_ttl_minutes: 10 },
    });
  }

  it("uses the web_e2ee platform", () => {
    const bridge = makeBridge();
    const platform: Platform = bridge.platform;

    expect(bridge.name).toBe("web_e2ee");
    expect(platform).toBe("web_e2ee");
  });

  it("starts and stops cleanly as a skeleton bridge", async () => {
    const bridge = makeBridge();

    await expect(bridge.start()).resolves.toBeUndefined();
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it("fails loudly for outbound methods until transport exists", async () => {
    const bridge = makeBridge();
    await bridge.start();

    await expect(bridge.sendMessage("c1", "hello")).rejects.toThrow(
      "web_e2ee.sendMessage is not implemented yet",
    );
    await expect(bridge.editMessage("c1", "m1", "hello")).rejects.toThrow(
      "web_e2ee.editMessage is not implemented yet",
    );
    await expect(bridge.sendTyping("c1")).rejects.toThrow(
      "web_e2ee.sendTyping is not implemented yet",
    );
    await expect(bridge.sendApprovalRequest("c1", "approve?", "key")).rejects.toThrow(
      "web_e2ee.sendApprovalRequest is not implemented yet",
    );

    await bridge.stop();
  });
});

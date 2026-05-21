import { describe, expect, it } from "vitest";
import { assertValidPairingCompleteRequest, sanitizeDeviceLabel } from "./protocol.js";

describe("web-e2ee protocol", () => {
  it("accepts a valid pairing request", () => {
    const request = assertValidPairingCompleteRequest({
      code: "ABCD-EFGH-IJKL-MNOP",
      label: "June Chromium",
      publicKeyJwk: { kty: "OKP", crv: "X25519", x: "abc" },
    });

    expect(request.label).toBe("June Chromium");
    expect(request.publicKeyJwk.crv).toBe("X25519");
  });

  it("rejects malformed pairing requests", () => {
    expect(() => assertValidPairingCompleteRequest(null)).toThrow("Invalid pairing request");
    expect(() => assertValidPairingCompleteRequest({ code: "x", label: "ok" })).toThrow(
      "publicKeyJwk is required",
    );
  });

  it("trims and bounds device labels", () => {
    expect(sanitizeDeviceLabel("  June Chromium  ")).toBe("June Chromium");
    expect(() => sanitizeDeviceLabel("   ")).toThrow("Device label is required");
    expect(() => sanitizeDeviceLabel("x".repeat(121))).toThrow(
      "Device label must be 120 characters or fewer",
    );
  });
});

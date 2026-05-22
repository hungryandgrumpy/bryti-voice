import { describe, expect, it } from "vitest";
import {
  WEB_E2EE_MAX_AUDIO_BASE64_LENGTH,
  WEB_E2EE_MAX_AUDIO_BYTES,
  assertValidEncryptedAudioPayload,
  assertValidEncryptedBindPayload,
  assertValidEncryptedFrame,
  assertValidEncryptedTextPayload,
  assertValidPairingCompleteRequest,
  canonicalFrameHeaderJson,
  decodedBase64ByteLength,
  sanitizeDeviceLabel,
} from "./protocol.js";

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

  it("canonical aad field order includes nonce and excludes ciphertext", () => {
    const json = canonicalFrameHeaderJson({
      v: 1,
      kind: "msg",
      deviceId: "wed_123",
      messageId: "msg_123",
      counter: 7,
      ts: "2026-01-01T00:00:00.000Z",
      nonce: "nonce123",
      ciphertext: "secret",
    });

    expect(json).toBe(
      JSON.stringify({
        v: 1,
        kind: "msg",
        deviceId: "wed_123",
        messageId: "msg_123",
        counter: 7,
        ts: "2026-01-01T00:00:00.000Z",
        nonce: "nonce123",
      }),
    );
    expect(json).not.toContain("ciphertext");
  });

  it("accepts encrypted msg/bind frames and text payloads", () => {
    expect(assertValidEncryptedFrame({
      v: 1,
      kind: "msg",
      deviceId: "wed_123",
      messageId: "msg_123",
      counter: 1,
      ts: "2026-01-01T00:00:00.000Z",
      nonce: "abc",
      ciphertext: "def",
    }).messageId).toBe("msg_123");

    expect(assertValidEncryptedFrame({
      v: 1,
      kind: "bind",
      deviceId: "wed_123",
      messageId: "msg_124",
      counter: 2,
      ts: "2026-01-01T00:00:00.000Z",
      nonce: "ghi",
      ciphertext: "jkl",
    }).kind).toBe("bind");

    expect(assertValidEncryptedTextPayload({ kind: "text", text: "hello" }).text).toBe("hello");
    expect(assertValidEncryptedBindPayload({ kind: "bind" }).kind).toBe("bind");
  });

  it("accepts valid encrypted audio payloads", () => {
    const payload = assertValidEncryptedAudioPayload({
      kind: "audio",
      mimeType: "audio/ogg",
      durationSeconds: 12,
      fileName: "clip.ogg",
      dataBase64: Buffer.from("voice bytes").toString("base64"),
    });

    expect(payload.mimeType).toBe("audio/ogg");
    expect(payload.durationSeconds).toBe(12);
    expect(decodedBase64ByteLength(payload.dataBase64)).toBe(Buffer.byteLength("voice bytes"));
  });

  it("rejects malformed encrypted frames and invalid payloads", () => {
    expect(() => assertValidEncryptedFrame({ kind: "msg" })).toThrow("Invalid encrypted frame version");
    expect(() => assertValidEncryptedTextPayload({ kind: "text", text: "   " })).toThrow(
      "Encrypted text payload is empty",
    );
    expect(() => assertValidEncryptedBindPayload({ kind: "bind", text: "nope" })).toThrow(
      "Invalid encrypted bind payload",
    );
  });

  it("rejects empty, oversized, and invalid encrypted audio payloads", () => {
    expect(() => assertValidEncryptedAudioPayload({
      kind: "audio",
      mimeType: "audio/ogg",
      dataBase64: "",
    })).toThrow("Encrypted audio payload is empty");

    expect(() => assertValidEncryptedAudioPayload({
      kind: "audio",
      mimeType: "audio/ogg",
      dataBase64: "%%%",
    })).toThrow("Invalid encrypted audio payload dataBase64");

    expect(() => assertValidEncryptedAudioPayload({
      kind: "audio",
      mimeType: "audio/ogg",
      durationSeconds: 61,
      dataBase64: Buffer.from("voice bytes").toString("base64"),
    })).toThrow("Invalid encrypted audio payload durationSeconds");

    expect(() => assertValidEncryptedAudioPayload({
      kind: "audio",
      mimeType: "audio/wav",
      dataBase64: Buffer.from("voice bytes").toString("base64"),
    })).toThrow("Invalid encrypted audio payload mimeType");

    expect(() => assertValidEncryptedAudioPayload({
      kind: "audio",
      mimeType: "audio/ogg",
      dataBase64: "A".repeat(WEB_E2EE_MAX_AUDIO_BASE64_LENGTH + 1),
    })).toThrow(`Encrypted audio payload exceeds ${WEB_E2EE_MAX_AUDIO_BYTES} bytes`);
  });
});

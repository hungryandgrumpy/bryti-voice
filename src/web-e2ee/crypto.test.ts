import { describe, it, expect } from "vitest";
import {
  assertValidPublicX25519Jwk,
  decryptPayload,
  deriveDirectionalAesKeys,
  deriveKeyContextSalt,
  encryptPayload,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  exportRawPublicKey,
  fingerprintPublicKey,
  generateDeviceId,
  generateInviteCode,
  generateMessageNonce,
  generateX25519KeyPair,
  hashInviteCode,
  importPrivateKeyJwk,
  importPublicKeyJwk,
} from "./crypto.js";
import { bytesToBase64Url } from "./encoding.js";

describe("web-e2ee crypto", () => {
  it("round-trips X25519 JWK export/import", async () => {
    const pair = await generateX25519KeyPair();
    const publicJwk = await exportPublicKeyJwk(pair.publicKey);
    const privateJwk = await exportPrivateKeyJwk(pair.privateKey);

    const importedPublic = await importPublicKeyJwk(publicJwk);
    const importedPrivate = await importPrivateKeyJwk(privateJwk);
    const bits = await crypto.subtle.deriveBits(
      { name: "X25519", public: importedPublic },
      importedPrivate,
      256,
    );

    expect(publicJwk.crv).toBe("X25519");
    expect(privateJwk.crv).toBe("X25519");
    expect(bits.byteLength).toBe(32);
  });

  it("derives stable fingerprints from raw public keys", async () => {
    const pair = await generateX25519KeyPair();
    const fingerprint1 = await fingerprintPublicKey(pair.publicKey);
    const fingerprint2 = await fingerprintPublicKey(pair.publicKey);
    const raw = await exportRawPublicKey(pair.publicKey);

    expect(fingerprint1).toBe(fingerprint2);
    expect(fingerprint1.startsWith("sha256:")).toBe(true);
    expect(raw.byteLength).toBe(32);
  });

  it("generates opaque device ids with wed_ prefix", () => {
    const id = generateDeviceId();
    expect(id.startsWith("wed_")).toBe(true);
    expect(id.length).toBeGreaterThan(8);
  });

  it("generates segmented invite codes and hashes normalized forms", async () => {
    const code = generateInviteCode();
    const hashA = await hashInviteCode(code);
    const hashB = await hashInviteCode(code.toLowerCase().replaceAll("-", ""));

    expect(code).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(hashA).toBe(hashB);
    expect(hashA.startsWith("sha256:")).toBe(true);
  });

  it("validates public X25519 JWKs", async () => {
    const pair = await generateX25519KeyPair();
    const publicJwk = await exportPublicKeyJwk(pair.publicKey);

    expect(() => assertValidPublicX25519Jwk(publicJwk)).not.toThrow();
    expect(() => assertValidPublicX25519Jwk({ kty: "EC", crv: "P-256", x: "abc" })).toThrow(
      "Invalid X25519 public JWK",
    );
  });

  it("derives directional AES keys and encrypts/decrypts with canonical aad", async () => {
    const serverPair = await generateX25519KeyPair();
    const devicePair = await generateX25519KeyPair();
    const serverPublicRaw = await exportRawPublicKey(serverPair.publicKey);
    const devicePublicRaw = await exportRawPublicKey(devicePair.publicKey);
    const deviceKeys = await deriveDirectionalAesKeys(
      devicePair.privateKey,
      serverPair.publicKey,
      serverPublicRaw,
      devicePublicRaw,
    );
    const serverKeys = await deriveDirectionalAesKeys(
      serverPair.privateKey,
      devicePair.publicKey,
      serverPublicRaw,
      devicePublicRaw,
    );
    const header = {
      v: 1 as const,
      kind: "msg" as const,
      deviceId: "wed_123",
      messageId: "msg_123",
      counter: 1,
      ts: "2026-01-01T00:00:00.000Z",
      nonce: bytesToBase64Url(generateMessageNonce()),
    };

    expect(deviceKeys.c2sKey).not.toBe(deviceKeys.s2cKey);

    const ciphertext = await encryptPayload(deviceKeys.c2sKey, header, { kind: "text", text: "hello" });
    const payload = await decryptPayload(serverKeys.c2sKey, header, ciphertext);

    expect(payload).toEqual({ kind: "text", text: "hello" });
  });

  it("binds HKDF context to both public keys", async () => {
    const serverPair = await generateX25519KeyPair();
    const devicePair = await generateX25519KeyPair();
    const otherDevicePair = await generateX25519KeyPair();
    const serverPublicRaw = await exportRawPublicKey(serverPair.publicKey);
    const devicePublicRaw = await exportRawPublicKey(devicePair.publicKey);
    const otherDevicePublicRaw = await exportRawPublicKey(otherDevicePair.publicKey);

    const expectedSalt = await deriveKeyContextSalt(serverPublicRaw, devicePublicRaw);
    const swappedSalt = await deriveKeyContextSalt(devicePublicRaw, serverPublicRaw);
    const otherDeviceSalt = await deriveKeyContextSalt(serverPublicRaw, otherDevicePublicRaw);

    expect(bytesToBase64Url(expectedSalt)).not.toBe(bytesToBase64Url(swappedSalt));
    expect(bytesToBase64Url(expectedSalt)).not.toBe(bytesToBase64Url(otherDeviceSalt));

    const deviceKeys = await deriveDirectionalAesKeys(
      devicePair.privateKey,
      serverPair.publicKey,
      serverPublicRaw,
      devicePublicRaw,
    );
    const wrongServerKeys = await deriveDirectionalAesKeys(
      serverPair.privateKey,
      devicePair.publicKey,
      devicePublicRaw,
      serverPublicRaw,
    );
    const header = {
      v: 1 as const,
      kind: "msg" as const,
      deviceId: "wed_123",
      messageId: "msg_123",
      counter: 1,
      ts: "2026-01-01T00:00:00.000Z",
      nonce: bytesToBase64Url(generateMessageNonce()),
    };
    const ciphertext = await encryptPayload(deviceKeys.c2sKey, header, { kind: "text", text: "hello" });

    await expect(decryptPayload(wrongServerKeys.c2sKey, header, ciphertext)).rejects.toThrow(
      "Failed to decrypt encrypted payload",
    );
  });

  it("fails to decrypt when aad header changes", async () => {
    const serverPair = await generateX25519KeyPair();
    const devicePair = await generateX25519KeyPair();
    const serverPublicRaw = await exportRawPublicKey(serverPair.publicKey);
    const devicePublicRaw = await exportRawPublicKey(devicePair.publicKey);
    const deviceKeys = await deriveDirectionalAesKeys(
      devicePair.privateKey,
      serverPair.publicKey,
      serverPublicRaw,
      devicePublicRaw,
    );
    const serverKeys = await deriveDirectionalAesKeys(
      serverPair.privateKey,
      devicePair.publicKey,
      serverPublicRaw,
      devicePublicRaw,
    );
    const header = {
      v: 1 as const,
      kind: "msg" as const,
      deviceId: "wed_123",
      messageId: "msg_123",
      counter: 1,
      ts: "2026-01-01T00:00:00.000Z",
      nonce: bytesToBase64Url(generateMessageNonce()),
    };
    const ciphertext = await encryptPayload(deviceKeys.c2sKey, header, { kind: "text", text: "hello" });

    await expect(decryptPayload(serverKeys.c2sKey, { ...header, counter: 2 }, ciphertext)).rejects.toThrow(
      "Failed to decrypt encrypted payload",
    );
  });
});

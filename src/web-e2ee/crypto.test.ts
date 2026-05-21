import { describe, it, expect } from "vitest";
import {
  assertValidPublicX25519Jwk,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  exportRawPublicKey,
  fingerprintPublicKey,
  generateDeviceId,
  generateInviteCode,
  generateX25519KeyPair,
  hashInviteCode,
  importPrivateKeyJwk,
  importPublicKeyJwk,
} from "./crypto.js";

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
});

import { base64UrlToBytes, bytesToBase64Url, encodeBase32, normalizeInviteCode, segmentCode, utf8ToBytes } from "./encoding.js";

export async function generateX25519KeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", publicKey);
}

export async function exportPrivateKeyJwk(privateKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", privateKey);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "X25519" }, true, []);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "X25519" }, false, ["deriveBits"]);
}

export async function exportRawPublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  return new Uint8Array(raw);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const stable = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stable.buffer);
  return new Uint8Array(digest);
}

export async function fingerprintPublicKey(publicKey: CryptoKey): Promise<string> {
  const raw = await exportRawPublicKey(publicKey);
  const digest = await sha256(raw);
  return `sha256:${bytesToBase64Url(digest)}`;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function generateDeviceId(): string {
  return `wed_${bytesToBase64Url(randomBytes(12))}`;
}

export function generateInviteId(): string {
  return `inv_${bytesToBase64Url(randomBytes(12))}`;
}

export function generateInviteCode(): string {
  const encoded = encodeBase32(randomBytes(10)).slice(0, 16);
  return segmentCode(encoded, 4);
}

export async function hashInviteCode(code: string): Promise<string> {
  const normalized = normalizeInviteCode(code);
  const digest = await sha256(utf8ToBytes(normalized));
  return `sha256:${bytesToBase64Url(digest)}`;
}

export function publicKeyJwkToRawBytes(jwk: JsonWebKey): Uint8Array {
  if (jwk.kty !== "OKP" || jwk.crv !== "X25519" || typeof jwk.x !== "string") {
    throw new Error("Invalid X25519 public JWK");
  }
  return base64UrlToBytes(jwk.x);
}

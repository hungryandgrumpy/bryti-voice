import { utf8ToBytes } from "./encoding.js";

export const WEB_E2EE_PROTOCOL_VERSION = 1 as const;
export const WEB_E2EE_MAX_TEXT_LENGTH = 10_000;
export const WEB_E2EE_MAX_AUDIO_DURATION_SECONDS = 60;
export const WEB_E2EE_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const WEB_E2EE_MAX_AUDIO_BASE64_LENGTH = 4 * Math.ceil(WEB_E2EE_MAX_AUDIO_BYTES / 3);
export const WEB_E2EE_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/opus",
] as const;

export type WebE2EEAudioMimeType = (typeof WEB_E2EE_AUDIO_MIME_TYPES)[number];

export interface PairingCompleteRequest {
  code: string;
  label: string;
  publicKeyJwk: JsonWebKey;
}

export interface PairingCompleteResponse {
  deviceId: string;
  serverPublicKeyJwk: JsonWebKey;
  serverPublicFingerprint: string;
  protocolVersion: 1;
  pathPrefix: string;
}

export interface EncryptedFrame {
  v: 1;
  kind: "msg" | "bind";
  deviceId: string;
  messageId: string;
  counter: number;
  ts: string;
  nonce: string;
  ciphertext: string;
}

export interface CanonicalFrameHeader {
  v: 1;
  kind: "msg" | "bind";
  deviceId: string;
  messageId: string;
  counter: number;
  ts: string;
  nonce: string;
}

export interface EncryptedTextPayload {
  kind: "text";
  text: string;
}

export interface EncryptedAudioPayload {
  kind: "audio";
  mimeType: WebE2EEAudioMimeType;
  dataBase64: string;
  durationSeconds?: number;
  fileName?: string;
}

export interface EncryptedBindPayload {
  kind: "bind";
}

interface DecryptedMessageEventBase {
  deviceId: string;
  messageId: string;
  counter: number;
  ts: string;
  raw: {
    type: "web_e2ee_encrypted_msg";
    deviceId: string;
    messageId: string;
    counter: number;
    ts: string;
    kind: "msg";
    nonceLength: number;
    ciphertextLength: number;
  };
}

export interface DecryptedTextMessageEvent extends DecryptedMessageEventBase {
  payload: EncryptedTextPayload;
}

export interface DecryptedAudioMessageEvent extends DecryptedMessageEventBase {
  payload: EncryptedAudioPayload;
}

export type DecryptedMessageEvent = DecryptedTextMessageEvent | DecryptedAudioMessageEvent;

export function sanitizeDeviceLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error("Device label is required");
  }
  if (trimmed.length > 120) {
    throw new Error("Device label must be 120 characters or fewer");
  }
  return trimmed;
}

export function assertValidPairingCompleteRequest(value: unknown): PairingCompleteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid pairing request");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.code !== "string" || !raw.code.trim()) {
    throw new Error("Pairing code is required");
  }
  if (typeof raw.label !== "string") {
    throw new Error("Device label is required");
  }
  if (!raw.publicKeyJwk || typeof raw.publicKeyJwk !== "object" || Array.isArray(raw.publicKeyJwk)) {
    throw new Error("publicKeyJwk is required");
  }

  return {
    code: raw.code,
    label: sanitizeDeviceLabel(raw.label),
    publicKeyJwk: raw.publicKeyJwk as JsonWebKey,
  };
}

export function assertValidEncryptedFrame(value: unknown): EncryptedFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid encrypted frame");
  }
  const raw = value as Record<string, unknown>;
  if (raw.v !== WEB_E2EE_PROTOCOL_VERSION) {
    throw new Error("Invalid encrypted frame version");
  }
  if (raw.kind !== "msg" && raw.kind !== "bind") {
    throw new Error("Invalid encrypted frame kind");
  }
  if (typeof raw.deviceId !== "string" || !raw.deviceId) {
    throw new Error("Invalid encrypted frame deviceId");
  }
  if (typeof raw.messageId !== "string" || !raw.messageId) {
    throw new Error("Invalid encrypted frame messageId");
  }
  if (typeof raw.counter !== "number" || !Number.isInteger(raw.counter) || raw.counter <= 0) {
    throw new Error("Invalid encrypted frame counter");
  }
  if (typeof raw.ts !== "string" || !raw.ts) {
    throw new Error("Invalid encrypted frame ts");
  }
  if (typeof raw.nonce !== "string" || !raw.nonce) {
    throw new Error("Invalid encrypted frame nonce");
  }
  if (typeof raw.ciphertext !== "string" || !raw.ciphertext) {
    throw new Error("Invalid encrypted frame ciphertext");
  }
  return {
    v: WEB_E2EE_PROTOCOL_VERSION,
    kind: raw.kind,
    deviceId: raw.deviceId,
    messageId: raw.messageId,
    counter: raw.counter,
    ts: raw.ts,
    nonce: raw.nonce,
    ciphertext: raw.ciphertext,
  };
}

export function canonicalFrameHeader(frame: EncryptedFrame | CanonicalFrameHeader): CanonicalFrameHeader {
  return {
    v: WEB_E2EE_PROTOCOL_VERSION,
    kind: frame.kind,
    deviceId: frame.deviceId,
    messageId: frame.messageId,
    counter: frame.counter,
    ts: frame.ts,
    nonce: frame.nonce,
  };
}

export function canonicalFrameHeaderJson(frame: EncryptedFrame | CanonicalFrameHeader): string {
  const header = canonicalFrameHeader(frame);
  return JSON.stringify({
    v: header.v,
    kind: header.kind,
    deviceId: header.deviceId,
    messageId: header.messageId,
    counter: header.counter,
    ts: header.ts,
    nonce: header.nonce,
  });
}

export function canonicalFrameHeaderBytes(frame: EncryptedFrame | CanonicalFrameHeader): Uint8Array {
  return utf8ToBytes(canonicalFrameHeaderJson(frame));
}

export function assertValidEncryptedTextPayload(value: unknown): EncryptedTextPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid encrypted payload");
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "text") {
    throw new Error("Invalid encrypted payload kind");
  }
  if (typeof raw.text !== "string") {
    throw new Error("Invalid encrypted payload text");
  }
  const text = raw.text.trim();
  if (!text) {
    throw new Error("Encrypted text payload is empty");
  }
  if (text.length > WEB_E2EE_MAX_TEXT_LENGTH) {
    throw new Error(`Encrypted text payload exceeds ${WEB_E2EE_MAX_TEXT_LENGTH} characters`);
  }
  return { kind: "text", text: raw.text };
}

function isValidBase64Text(text: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text);
}

export function decodedBase64ByteLength(dataBase64: string): number {
  if (!dataBase64 || dataBase64.length % 4 !== 0) {
    throw new Error("Invalid encrypted audio payload dataBase64");
  }
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  return (dataBase64.length / 4) * 3 - padding;
}

export function assertValidEncryptedAudioPayload(value: unknown): EncryptedAudioPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid encrypted payload");
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "audio") {
    throw new Error("Invalid encrypted payload kind");
  }
  if (typeof raw.mimeType !== "string" || !WEB_E2EE_AUDIO_MIME_TYPES.includes(raw.mimeType as WebE2EEAudioMimeType)) {
    throw new Error("Invalid encrypted audio payload mimeType");
  }
  if (typeof raw.dataBase64 !== "string") {
    throw new Error("Invalid encrypted audio payload dataBase64");
  }
  if (!raw.dataBase64) {
    throw new Error("Encrypted audio payload is empty");
  }
  if (raw.dataBase64.length > WEB_E2EE_MAX_AUDIO_BASE64_LENGTH) {
    throw new Error(`Encrypted audio payload exceeds ${WEB_E2EE_MAX_AUDIO_BYTES} bytes`);
  }
  if (!isValidBase64Text(raw.dataBase64)) {
    throw new Error("Invalid encrypted audio payload dataBase64");
  }
  const decodedBytes = decodedBase64ByteLength(raw.dataBase64);
  if (decodedBytes <= 0) {
    throw new Error("Encrypted audio payload is empty");
  }
  if (decodedBytes > WEB_E2EE_MAX_AUDIO_BYTES) {
    throw new Error(`Encrypted audio payload exceeds ${WEB_E2EE_MAX_AUDIO_BYTES} bytes`);
  }
  if (raw.durationSeconds !== undefined) {
    if (
      typeof raw.durationSeconds !== "number" ||
      !Number.isFinite(raw.durationSeconds) ||
      raw.durationSeconds <= 0 ||
      raw.durationSeconds > WEB_E2EE_MAX_AUDIO_DURATION_SECONDS
    ) {
      throw new Error("Invalid encrypted audio payload durationSeconds");
    }
  }
  if (raw.fileName !== undefined && typeof raw.fileName !== "string") {
    throw new Error("Invalid encrypted audio payload fileName");
  }
  return {
    kind: "audio",
    mimeType: raw.mimeType as WebE2EEAudioMimeType,
    dataBase64: raw.dataBase64,
    durationSeconds: raw.durationSeconds,
    fileName: raw.fileName,
  };
}

export function assertValidEncryptedBindPayload(value: unknown): EncryptedBindPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid encrypted payload");
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "bind") {
    throw new Error("Invalid encrypted payload kind");
  }
  if (Object.keys(raw).length !== 1) {
    throw new Error("Invalid encrypted bind payload");
  }
  return { kind: "bind" };
}

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

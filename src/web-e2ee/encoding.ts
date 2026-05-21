const BASE32_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlToBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return out;
}

export function segmentCode(text: string, segmentLength = 4): string {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += segmentLength) {
    parts.push(text.slice(i, i + segmentLength));
  }
  return parts.join("-");
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

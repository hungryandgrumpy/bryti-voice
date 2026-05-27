export interface WebE2EEServerKeyFile {
  version: 1;
  algorithm: "X25519";
  createdAt: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface PairedDeviceRecord {
  deviceId: string;
  label: string;
  publicKeyJwk: JsonWebKey;
  publicKeyFingerprint: string;
  pairedAt: string;
  lastSeenAt: string | null;
  status: "active" | "revoked";
  notes: string;
  lastInboundCounter: number;
  lastOutboundCounter: number;
}

export interface PairedDevicesFile {
  version: 1;
  devices: PairedDeviceRecord[];
}

export interface PairingInviteRecord {
  inviteId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByDeviceId: string | null;
  status: "pending" | "used" | "expired";
}

export interface PairingInvitesFile {
  version: 1;
  invites: PairingInviteRecord[];
}

export interface LoadedServerKeyPair {
  path: string;
  createdAt: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  fingerprint: string;
}

import {
  loadDevicePrivateKey,
  loadPairedState,
  saveDeviceKeyPair,
  savePairedState,
} from "./idb.js";

const httpStatusEl = document.getElementById("http-status");
const wsStatusEl = document.getElementById("ws-status");
const serverFingerprintEl = document.getElementById("server-fingerprint");
const protocolVersionEl = document.getElementById("protocol-version");
const pairingStatusEl = document.getElementById("pairing-status");
const pairingMessageEl = document.getElementById("pairing-message");
const deviceLabelEl = document.getElementById("device-label");
const inviteCodeEl = document.getElementById("invite-code");
const pairButtonEl = document.getElementById("pair-button");

function supportsRequiredCrypto() {
  return !!(
    window.indexedDB &&
    window.crypto?.subtle &&
    typeof CryptoKey !== "undefined"
  );
}

async function loadServerInfo() {
  try {
    const response = await fetch("api/server-info", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const info = await response.json();
    httpStatusEl.textContent = "Connected";
    serverFingerprintEl.textContent = info.serverPublicFingerprint || "Unavailable";
    protocolVersionEl.textContent = `v${info.protocolVersion} (${info.designVersion})`;
    return info;
  } catch (error) {
    httpStatusEl.textContent = "Failed";
    serverFingerprintEl.textContent = "Unavailable";
    protocolVersionEl.textContent = "Unavailable";
    pairingMessageEl.textContent = `Could not load server info: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}

async function restorePairedState() {
  const state = await loadPairedState();
  const privateKey = await loadDevicePrivateKey();
  if (!state || !privateKey) {
    pairingStatusEl.textContent = "Not paired";
    return null;
  }

  pairingStatusEl.textContent = `Paired as ${state.deviceId}`;
  pairingMessageEl.textContent = `Stored server fingerprint: ${state.serverPublicFingerprint}`;
  if (state.label) {
    deviceLabelEl.value = state.label;
  }
  return state;
}

async function generateDeviceKeyPair() {
  // Chromium WebCrypto allows exporting the generated public key JWK while
  // keeping the private key non-extractable, which is the desired v1 behavior.
  return await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
}

async function pairDevice(info) {
  if (!supportsRequiredCrypto()) {
    pairingMessageEl.textContent = "This browser is not supported. Use a current Chromium-based browser.";
    return;
  }

  const label = deviceLabelEl.value.trim();
  const code = inviteCodeEl.value.trim();
  if (!label || !code) {
    pairingMessageEl.textContent = "Device label and invite code are required.";
    return;
  }

  pairButtonEl.disabled = true;
  pairingMessageEl.textContent = "Generating device keypair…";

  try {
    const keyPair = await generateDeviceKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    pairingMessageEl.textContent = "Submitting pairing request…";
    const response = await fetch("api/pairing/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, label, publicKeyJwk }),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }

    await saveDeviceKeyPair({ privateKey: keyPair.privateKey, publicKey: keyPair.publicKey });
    await savePairedState({
      deviceId: body.deviceId,
      label,
      protocolVersion: body.protocolVersion,
      pathPrefix: body.pathPrefix,
      serverPublicFingerprint: body.serverPublicFingerprint,
      serverPublicKeyJwk: body.serverPublicKeyJwk,
      devicePublicKeyJwk: publicKeyJwk,
      pairedAt: new Date().toISOString(),
      nextOutboundCounter: 1,
      lastInboundCounter: 0,
    });

    pairingStatusEl.textContent = `Paired as ${body.deviceId}`;
    pairingMessageEl.textContent = `Paired successfully. Server fingerprint: ${body.serverPublicFingerprint}`;
    serverFingerprintEl.textContent = body.serverPublicFingerprint || info.serverPublicFingerprint || "Unavailable";
  } catch (error) {
    pairingMessageEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    pairButtonEl.disabled = false;
  }
}

async function init() {
  if (!supportsRequiredCrypto()) {
    pairingMessageEl.textContent = "This browser is not supported. Use a current Chromium-based browser.";
    pairButtonEl.disabled = true;
    return;
  }

  const info = await loadServerInfo();
  if (!info) {
    pairButtonEl.disabled = true;
    return;
  }

  await restorePairedState();
  pairButtonEl.addEventListener("click", () => {
    void pairDevice(info);
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

void init();

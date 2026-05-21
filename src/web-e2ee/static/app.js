// src/web-e2ee/static/app.js     
const httpStatusEl = document.getElementById("http-status");
const wsStatusEl = document.getElementById("ws-status");
const serverFingerprintEl = document.getElementById("server-fingerprint");
const protocolVersionEl = document.getElementById("protocol-version");
const transportNoteEl = document.getElementById("transport-note");

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
    transportNoteEl.textContent = info.chatEnabled
      ? "Chat available"
      : "Transport shell only. Encrypted chat is not implemented yet.";
    return info;
  } catch (error) {
    httpStatusEl.textContent = "Failed";
    serverFingerprintEl.textContent = "Unavailable";
    protocolVersionEl.textContent = "Unavailable";
    transportNoteEl.textContent = `Could not load server info: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  }
}

function webSocketUrl(pathPrefix) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const prefix = !pathPrefix || pathPrefix === "/"
    ? ""
    : pathPrefix.endsWith("/") ? pathPrefix.slice(0, -1) : pathPrefix;
  return `${protocol}//${window.location.host}${prefix}/ws`;
}

function openWebSocket(info) {
  const ws = new WebSocket(webSocketUrl(info.pathPrefix));

  wsStatusEl.textContent = "Connecting";

  ws.addEventListener("open", () => {
    wsStatusEl.textContent = "Connected";
    ws.send(JSON.stringify({ kind: "status" }));
  });

  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.kind === "hello") {
        wsStatusEl.textContent = `Connected (${payload.kind})`;
      } else if (payload.kind === "status") {
        transportNoteEl.textContent = payload.chat
          ? "Chat available"
          : "WebSocket connected. Encrypted chat is not implemented yet.";
      }
    } catch {
      wsStatusEl.textContent = "Connected (unparsed frame)";
    }
  });

  ws.addEventListener("close", () => {
    wsStatusEl.textContent = "Closed";
  });

  ws.addEventListener("error", () => {
    wsStatusEl.textContent = "Error";
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

loadServerInfo().then((info) => {
  if (info) {
    openWebSocket(info);
  }
});

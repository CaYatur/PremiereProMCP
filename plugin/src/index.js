const { RelayConnection } = require("./src/relayConnection.js");

function setStatus(connected, detail) {
  const dot = document.getElementById("dot");
  const text = document.getElementById("statusText");
  const log = document.getElementById("log");
  if (connected) {
    dot.classList.add("connected");
    text.classList.add("active");
    text.textContent = "Active";
  } else {
    dot.classList.remove("connected");
    text.classList.remove("active");
    text.textContent = "Not connected — retrying…";
  }
  if (detail && log) {
    const line = document.createElement("div");
    line.textContent = `${new Date().toLocaleTimeString()} ${detail}`;
    log.appendChild(line);
    while (log.childNodes.length > 40) log.removeChild(log.firstChild);
  }
}

// Open developer site from UXP (best-effort)
try {
  const link = document.getElementById("siteLink");
  if (link) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        const uxp = require("uxp");
        if (uxp.shell && typeof uxp.shell.openExternal === "function") {
          uxp.shell.openExternal("https://cayadev.com");
        }
      } catch {
        /* ignore */
      }
    });
  }
} catch {
  /* ignore */
}

console.log("[PPMCP] panel script starting · CaYaDev · cayadev.com");
const relay = new RelayConnection(setStatus);
relay.start();

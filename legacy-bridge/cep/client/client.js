/**
 * PPMCP legacy-bridge CEP client.
 * Connects to the same WebSocket relay as the UXP plugin (role: legacy-bridge).
 * Forwards only legacy.* methods into ExtendScript host.jsx via evalScript.
 */
/* global CSInterface, WebSocket */
(function () {
  var RELAY_URL = "ws://127.0.0.1:8265";
  var cs = new CSInterface();
  var ws = null;
  var statusEl = document.getElementById("status");
  var logEl = document.getElementById("log");
  var reconnectTimer = null;

  function setStatus(text, cls) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = cls || "";
  }

  function log(line) {
    if (!logEl) return;
    var t = new Date().toISOString().slice(11, 19);
    logEl.textContent = "[" + t + "] " + line + "\n" + logEl.textContent.slice(0, 2000);
  }

  function escapeForEval(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  /** Map relay method → host.jsx function name */
  function methodToHostFn(method) {
    var map = {
      "legacy.ping": "ping",
      "legacy.mogrt.setText": "setText",
      "legacy.mogrt.getText": "getText",
      "legacy.mogrt.listTextProps": "listTextProps",
      "legacy.mogrt.insertAndSetText": "insertAndSetText",
    };
    return map[method] || null;
  }

  function evalHost(fnName, params, callback) {
    var payload = escapeForEval(JSON.stringify(params || {}));
    var script;
    if (fnName === "ping") {
      script = "PPMCP_legacy.ping()";
    } else {
      script = "PPMCP_legacy." + fnName + "('" + payload + "')";
    }
    cs.evalScript(script, function (result) {
      callback(result);
    });
  }

  /** Re-load host.jsx from the extension folder so updates apply without full Premiere restart. */
  function reloadHostJsx(done) {
    try {
      var extPath = cs.getSystemPath(SystemPath.EXTENSION);
      // Forward slashes work in ExtendScript File on Windows
      var jsxPath = (extPath + "/jsx/host.jsx").replace(/\\/g, "/");
      var script =
        "$.evalFile(new File('" + escapeForEval(jsxPath) + "')); 'reloaded';";
      cs.evalScript(script, function (r) {
        log("host.jsx reload: " + String(r).slice(0, 80));
        if (done) done();
      });
    } catch (e) {
      log("host.jsx reload failed: " + e);
      if (done) done();
    }
  }

  function sendResult(id, ok, data, error) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    var msg = { type: "result", id: id, ok: !!ok };
    if (ok) msg.data = data;
    else msg.error = error || { code: "INTERNAL_ERROR", message: "unknown" };
    ws.send(JSON.stringify(msg));
  }

  function parseHostResult(raw, id) {
    if (!raw || raw === "EvalScript error." || String(raw).indexOf("EvalScript error") === 0) {
      sendResult(id, false, null, {
        code: "PREMIERE_API_ERROR",
        message: "evalScript failed: " + String(raw),
      });
      return;
    }
    try {
      var parsed = JSON.parse(raw);
      if (parsed.ok) {
        sendResult(id, true, parsed.data, null);
      } else {
        sendResult(id, false, null, parsed.error || { code: "PREMIERE_API_ERROR", message: raw });
      }
    } catch (e) {
      sendResult(id, false, null, {
        code: "INTERNAL_ERROR",
        message: "Bad ES response: " + String(raw).slice(0, 300),
      });
    }
  }

  function handleCall(msg) {
    var fn = methodToHostFn(msg.method);
    if (!fn) {
      sendResult(msg.id, false, null, {
        code: "INTERNAL_ERROR",
        message: 'No legacy handler for method "' + msg.method + '".',
      });
      return;
    }
    log("call " + msg.method);
    evalHost(fn, msg.params || {}, function (raw) {
      // Fragility reduction: on EvalScript error, reload host.jsx once and retry
      if (!raw || raw === "EvalScript error." || String(raw).indexOf("EvalScript error") === 0) {
        log("evalScript fail — reload host + retry once");
        reloadHostJsx(function () {
          evalHost(fn, msg.params || {}, function (raw2) {
            parseHostResult(raw2, msg.id);
          });
        });
        return;
      }
      parseHostResult(raw, msg.id);
    });
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    setStatus("Connecting to relay…", "warn");
    try {
      ws = new WebSocket(RELAY_URL);
    } catch (e) {
      setStatus("WebSocket failed", "err");
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      ws.send(
        JSON.stringify({
          type: "hello",
          role: "legacy-bridge",
          info: { name: "ppmcp-legacy-cep", version: "0.1.1" },
        }),
      );
      setStatus("Connected — text bridge ready", "ok");
      log("hello legacy-bridge → " + RELAY_URL);
      reloadHostJsx(function () {
        evalHost("ping", {}, function (r) {
          log("ping " + String(r).slice(0, 120));
        });
      });
    };
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === "call") handleCall(msg);
    };
    ws.onclose = function () {
      setStatus("Disconnected — retrying…", "warn");
      scheduleReconnect();
    };
    ws.onerror = function () {
      setStatus("Relay error (is bridge running?)", "err");
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  document.getElementById("reconnect").onclick = function () {
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
    }
    ws = null;
    reloadHostJsx(function () {
      connect();
    });
  };

  document.getElementById("testPing").onclick = function () {
    evalHost("ping", {}, function (r) {
      log("manual ping: " + r);
      alert(String(r).slice(0, 400));
    });
  };

  connect();
})();

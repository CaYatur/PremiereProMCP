/**
 * Minimal CSInterface subset for PPMCP legacy bridge (evalScript + host env).
 * Based on Adobe CEP samples (trimmed).
 */
/* global window, __adobe_cep__ */
(function (global) {
  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (callback === null || callback === undefined) {
      callback = function () {};
    }
    if (global.__adobe_cep__) {
      global.__adobe_cep__.evalScript(script, callback);
    } else {
      callback('EvalScript error: __adobe_cep__ not available (open inside Premiere CEP panel).');
    }
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    if (!global.__adobe_cep__) return "";
    var path = decodeURI(global.__adobe_cep__.getSystemPath(pathType));
    // strip file://
    if (path.indexOf("file:") === 0) {
      path = path.replace("file://", "");
      if (path.indexOf("/") === 0 && /^[A-Za-z]:/.test(path.substring(1, 3))) {
        path = path.substring(1);
      }
    }
    return path;
  };

  CSInterface.prototype.getExtensionID = function () {
    return global.__adobe_cep__ ? global.__adobe_cep__.getExtensionId() : "com.ppmcp.legacybridge.panel";
  };

  global.CSInterface = CSInterface;
  global.SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication",
  };
})(window);

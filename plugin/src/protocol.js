// Hand-kept duplicate of shared/src/protocol.ts's wire shapes — this plugin
// runs in UXP's browser-like JS environment (global WebSocket, no npm
// workspace linking), so it can't import the shared TS package directly.
// Keep this in sync if the envelope shapes change.

const DEFAULT_RELAY_PORT = 8265;

module.exports = { DEFAULT_RELAY_PORT };

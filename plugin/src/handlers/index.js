const project = require("./project.js");
const sequence = require("./sequence.js");
const track = require("./track.js");
const clip = require("./clip.js");
const title = require("./title.js");
const shape = require("./shape.js");
const effect = require("./effect.js");
const color = require("./color.js");
const audio = require("./audio.js");
const exportHandlers = require("./exportHandlers.js");
const transition = require("./transition.js");
const marker = require("./marker.js");
const selection = require("./selection.js");
const media = require("./media.js");
const debug = require("./debug.js");
// debug.js is registered during gap investigation (text/shape/insert/marker).
// Not exposed as MCP tools — only raw relay methods for live probes.

// Flat method-name -> async handler(params) map. Matches the "call" methods
// the MCP server issues in server/src/tools/*.ts (everything except the
// "legacy." prefix, which the relay routes to legacy-bridge instead).
module.exports = {
  ...project,
  ...sequence,
  ...track,
  ...clip,
  ...title,
  ...shape,
  ...effect,
  ...color,
  ...audio,
  ...exportHandlers,
  ...transition,
  ...marker,
  ...selection,
  ...media,
  ...debug,
};

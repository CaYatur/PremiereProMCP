import { systemTools } from "./system.js";
import { projectTools } from "./project.js";
import { sequenceTools } from "./sequence.js";
import { trackTools } from "./track.js";
import { clipTools } from "./clip.js";
import { titleTools } from "./title.js";
import { effectTools } from "./effect.js";
import { colorTools } from "./color.js";
import { audioTools } from "./audio.js";
import { exportTools } from "./exportTools.js";
import { transitionTools } from "./transition.js";
import { markerTools } from "./marker.js";
import { dedicatedShortcutTools } from "./dedicatedShortcuts.js";
import { workflowTools } from "./workflow.js";
import { selectionTools } from "./selection.js";
import { mediaTools } from "./media.js";
import { analyzeTools } from "./analyze.js";
import { batchTools } from "./batch.js";
import { visionTools } from "./vision.js";
import { competitiveTools } from "./competitive.js";
import { agentOrchestrationTools } from "./agentOrchestration.js";
import { checkpointTools } from "./checkpoint.js";

// Tool surface:
// 1) agentOrchestration FIRST in catalog intent (models should prefer these)
// 2) atomic tools for precision / strong models
// Design: outcome tools + playbooks reduce token cost and retry thrash.
export const allTools = [
  ...agentOrchestrationTools,
  ...checkpointTools,
  ...systemTools,
  ...projectTools,
  ...sequenceTools,
  ...trackTools,
  ...clipTools,
  ...titleTools,
  ...effectTools,
  ...colorTools,
  ...audioTools,
  ...exportTools,
  ...transitionTools,
  ...markerTools,
  ...dedicatedShortcutTools,
  ...workflowTools,
  ...selectionTools,
  ...mediaTools,
  ...analyzeTools,
  ...batchTools,
  ...visionTools,
  ...competitiveTools,
];

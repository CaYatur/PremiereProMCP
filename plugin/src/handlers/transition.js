// Confirmed against Adobe UXP docs:
// TransitionFactory.createVideoTransition(matchName) +
// VideoClipTrackItem.createAddVideoTransitionAction(videoTransition, addTransitionOptions)
// / createRemoveVideoTransitionAction(transitionPosition).
// SequenceEditor#createAddTransitionAction was a guess and is not the real path.

const { apiError, ppro, getActiveProject, getSequence, getClip, tickTime, runTransaction } = require("../ppro.js");

function makeAddOptions({ edge, durationTicks, forceSingleSided, alignment }) {
  if (!ppro.AddTransitionOptions) {
    return undefined;
  }
  const opts = new ppro.AddTransitionOptions();
  // head = start of clip, tail = end
  if (typeof opts.setApplyToStart === "function") {
    opts.setApplyToStart(edge === "head");
  }
  if (durationTicks && typeof opts.setDuration === "function") {
    opts.setDuration(tickTime(durationTicks));
  }
  if (forceSingleSided !== undefined && typeof opts.setForceSingleSided === "function") {
    opts.setForceSingleSided(!!forceSingleSided);
  }
  if (alignment !== undefined && typeof opts.setTransitionAlignment === "function") {
    opts.setTransitionAlignment(alignment);
  }
  return opts;
}

function transitionPosition(edge) {
  const pos = ppro.Constants && ppro.Constants.TransitionPosition ? ppro.Constants.TransitionPosition : {};
  if (edge === "head" || edge === "start") return pos.START ?? pos.Head ?? 0;
  return pos.END ?? pos.Tail ?? 1;
}

module.exports = {
  "transition.listAvailable": async ({ kind }) => {
    try {
      if (kind === "audio") {
        return {
          available: false,
          note: "No audio TransitionFactory methods in official UXP docs — only video transitions are confirmed.",
          transitions: [],
        };
      }
      const matchNames = await ppro.TransitionFactory.getVideoTransitionMatchNames();
      return matchNames.map((matchName) => ({ matchName, kind: "video" }));
    } catch (err) {
      throw apiError("transition.listAvailable", err);
    }
  },

  "transition.apply": async ({ sequenceId, trackType, trackIndex, clipIndex, matchName, edge, durationTicks, forceSingleSided, alignment }) => {
    if (trackType === "audio") {
      const e = new Error("Audio transitions are not exposed by UXP TransitionFactory. Use video tracks only.");
      e.code = "INVALID_PARAMS";
      throw e;
    }
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, "video", trackIndex, clipIndex);
    try {
      const videoTransition = ppro.TransitionFactory.createVideoTransition(matchName);
      if (!videoTransition) {
        throw new Error(`TransitionFactory.createVideoTransition("${matchName}") returned null.`);
      }
      if (typeof item.createAddVideoTransitionAction !== "function") {
        throw new Error("TrackItem has no createAddVideoTransitionAction — cannot apply transitions on this item type.");
      }
      const opts = makeAddOptions({
        edge: edge || "tail",
        durationTicks,
        forceSingleSided,
        alignment,
      });
      const action = opts
        ? item.createAddVideoTransitionAction(videoTransition, opts)
        : item.createAddVideoTransitionAction(videoTransition);
      if (!action) throw new Error("createAddVideoTransitionAction returned null/undefined.");
      await runTransaction(project, "PPMCP transition_apply", (c) => c.addAction(action));
      return { applied: true, matchName, edge: edge || "tail" };
    } catch (err) {
      throw apiError("transition.apply", err);
    }
  },

  "transition.remove": async ({ sequenceId, trackType, trackIndex, clipIndex, edge }) => {
    const project = await getActiveProject();
    const sequence = await getSequence(project, sequenceId);
    const { item } = await getClip(sequence, trackType || "video", trackIndex, clipIndex);
    try {
      if (typeof item.createRemoveVideoTransitionAction !== "function") {
        throw new Error("TrackItem has no createRemoveVideoTransitionAction.");
      }
      const action = item.createRemoveVideoTransitionAction(transitionPosition(edge || "tail"));
      if (!action) throw new Error("createRemoveVideoTransitionAction returned null/undefined.");
      await runTransaction(project, "PPMCP transition_remove", (c) => c.addAction(action));
      return { removed: true, edge: edge || "tail" };
    } catch (err) {
      throw apiError("transition.remove", err);
    }
  },

  "transition.setDuration": async ({ sequenceId, trackType, trackIndex, clipIndex, edge, durationTicks }) => {
    // No dedicated set-duration action on VideoClipTrackItem in the docs —
    // remove + re-apply with new duration is the reliable compose path.
    // Surface that clearly rather than calling a non-existent method.
    const e = new Error(
      "transition_set_duration is not a direct UXP action. Remove the transition and re-apply with durationTicks, or use transition_apply with the desired duration.",
    );
    e.code = "INVALID_PARAMS";
    throw e;
  },
};

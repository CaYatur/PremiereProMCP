// Premiere's own speech-to-text transcript (UXP `Transcript`, 25.6+).
// Live-verified on Premiere 26.5.2: transcribeClipProjectItem(item,
// { language }) runs Premiere's transcription and exportToJSON(item)
// returns { language, segments: [{ start, duration, speaker, words: [{
// start, duration, text, confidence, eos, type }] }], speakers }, with
// times in seconds of the media file.

const { apiError, ppro, getActiveProject, findProjectItemById } = require("../ppro.js");

async function clipItem(projectItemId) {
  const project = await getActiveProject();
  const item = await findProjectItemById(project, projectItemId);
  const clip = ppro.ClipProjectItem.cast(item);
  if (!clip) {
    const e = new Error(`Project item ${projectItemId} is not a clip.`);
    e.code = "INVALID_PARAMS";
    throw e;
  }
  return clip;
}

function transcriptApi() {
  const T = ppro.Transcript;
  if (!T || typeof T.exportToJSON !== "function") {
    const e = new Error("This Premiere build has no UXP Transcript API (needs Premiere 25.6+).");
    e.code = "UNSUPPORTED";
    throw e;
  }
  return T;
}

module.exports = {
  "transcript.status": async ({ projectItemId }) => {
    const T = transcriptApi();
    const clip = await clipItem(projectItemId);
    let hasTranscript;
    try {
      hasTranscript = typeof T.hasTranscript === "function" ? !!(await T.hasTranscript(clip)) : undefined;
    } catch {
      hasTranscript = undefined;
    }
    let languages;
    try {
      languages = typeof T.querySupportedLanguages === "function" ? await T.querySupportedLanguages() : undefined;
    } catch {
      languages = undefined;
    }
    return { projectItemId, hasTranscript, languages };
  },

  "transcript.export": async ({ projectItemId }) => {
    const T = transcriptApi();
    const clip = await clipItem(projectItemId);
    try {
      const json = await T.exportToJSON(clip);
      return { projectItemId, json: String(json) };
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/no transcript/i.test(msg)) {
        const e = new Error(`No transcript for this clip yet. Transcribe it first (transcribe: true, or Premiere's Text panel). (${msg})`);
        e.code = "NOT_FOUND";
        throw e;
      }
      throw apiError("transcript.export", err);
    }
  },

  "transcript.transcribe": async ({ projectItemId, language }) => {
    const T = transcriptApi();
    const clip = await clipItem(projectItemId);
    try {
      const ok = await T.transcribeClipProjectItem(clip, language ? { language } : {});
      return { projectItemId, started: !!ok, language: language || "(Premiere default)" };
    } catch (err) {
      throw apiError("transcript.transcribe", err);
    }
  },
};

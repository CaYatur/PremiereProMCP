// Phase 0 diagnostic probe for the Premiere Pro MCP project.
// Read-only: does not create, modify, or delete anything in the user's project.
// Goal: resolve the ❔ / 🔧 tags in docs/FEATURES.md by querying the real
// @adobe/premierepro runtime API surface inside a live Premiere Pro instance.

const ppro = require('premierepro');

async function safe(label, fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

async function runDiagnostics() {
  const results = {};

  results.appVersion = await safe('appVersion', () => ppro.Application.version);

  // --- Gate/probe 1: Lumetri / color grading ---
  const videoFilterNames = await safe('videoFilterMatchNames', () => ppro.VideoFilterFactory.getMatchNames());
  const videoFilterDisplay = await safe('videoFilterDisplayNames', () => ppro.VideoFilterFactory.getDisplayNames());
  results.videoFilters = {
    matchNamesOk: videoFilterNames.ok,
    matchNameCount: videoFilterNames.ok ? videoFilterNames.value.length : null,
    displayNamesOk: videoFilterDisplay.ok,
    lumetriMatches: (videoFilterNames.ok && videoFilterDisplay.ok)
      ? videoFilterNames.value
          .map((n, i) => ({ matchName: n, displayName: videoFilterDisplay.value[i] }))
          .filter(x => /lumetri/i.test(x.matchName) || /lumetri/i.test(x.displayName || ''))
      : null,
    allDisplayNames: videoFilterDisplay.ok ? videoFilterDisplay.value : videoFilterDisplay.error,
  };

  // --- Gate/probe 2: Audio filters (noise reduction, essential sound, dialogue) ---
  const audioFilterDisplay = await safe('audioFilterDisplayNames', () => ppro.AudioFilterFactory.getDisplayNames());
  results.audioFilters = {
    ok: audioFilterDisplay.ok,
    allDisplayNames: audioFilterDisplay.ok ? audioFilterDisplay.value : audioFilterDisplay.error,
    noiseRelatedMatches: audioFilterDisplay.ok
      ? audioFilterDisplay.value.filter(n => /noise|denoise|dereverb|hum/i.test(n))
      : null,
    duckingRelatedMatches: audioFilterDisplay.ok
      ? audioFilterDisplay.value.filter(n => /duck|dialogue|loudness|essential/i.test(n))
      : null,
  };

  // --- Gate/probe 3: Transitions ---
  const videoTransitions = await safe('videoTransitionMatchNames', () => ppro.TransitionFactory.getVideoTransitionMatchNames());
  results.videoTransitions = {
    ok: videoTransitions.ok,
    matchNames: videoTransitions.ok ? videoTransitions.value : videoTransitions.error,
  };

  // --- Gate/probe 4: Transcript / auto-captioning ---
  results.transcript = await safe('transcriptSupportedLanguages', () => ppro.Transcript.querySupportedLanguages());

  // --- Gate/probe 5: Active project / sequence (read-only inspection) ---
  const projectProbe = await safe('activeProject', () => ppro.Project.getActiveProject());
  results.project = { ok: projectProbe.ok, error: projectProbe.ok ? null : projectProbe.error };
  if (projectProbe.ok && projectProbe.value) {
    const project = projectProbe.value;
    results.project.name = await safe('projectName', () => project.name);

    const seqProbe = await safe('activeSequence', () => project.getActiveSequence());
    results.sequence = { ok: seqProbe.ok, error: seqProbe.ok ? null : seqProbe.error };
    if (seqProbe.ok && seqProbe.value) {
      const seq = seqProbe.value;
      results.sequence.videoTrackCount = await safe('videoTrackCount', () => seq.getVideoTrackCount());
      results.sequence.audioTrackCount = await safe('audioTrackCount', () => seq.getAudioTrackCount());
      results.sequence.captionTrackCount = await safe('captionTrackCount', () => seq.getCaptionTrackCount());

      // Peek at first video track's first item, read-only, to confirm clip
      // introspection works (does NOT modify anything).
      const vt0 = await safe('videoTrack0', () => seq.getVideoTrack(0));
      if (vt0.ok && vt0.value) {
        const items = await safe('videoTrack0Items', () => vt0.value.getTrackItems(1, false));
        results.sequence.videoTrack0ItemCount = items.ok ? (items.value ? items.value.length : 0) : items.error;
      }
    }

    const rootProbe = await safe('rootItem', () => project.getRootItem());
    if (rootProbe.ok && rootProbe.value) {
      const children = await safe('rootItemChildren', () => rootProbe.value.getItems ? rootProbe.value.getItems() : null);
      results.project.rootItemChildrenOk = children.ok;
    }
  }

  return results;
}

// Candidate paths for Adobe's own bundled "Basic Title" MOGRT, found on
// this machine via filesystem search. Tries the app-install copy first,
// falls back to the per-user Creative Cloud Libraries copy.
const BASIC_TITLE_MOGRT_CANDIDATES = [
  'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\Basic Title.mogrt',
  'C:\\Users\\cagan\\AppData\\Roaming\\Adobe\\Common\\Motion Graphics Templates\\Basic Title.mogrt',
];

// WRITE test: creates a throwaway sequence (does not touch any existing
// sequence), inserts Adobe's own bundled "Basic Title" MOGRT into it, then
// inspects + tries to edit its text parameter. This is the concrete test
// for whether text/graphic creation is achievable via bundled MOGRTs
// rather than a (confirmed non-existent) freeform text API.
async function testTextCreation() {
  const results = {};
  const projectProbe = await safe('activeProject', () => ppro.Project.getActiveProject());
  if (!projectProbe.ok || !projectProbe.value) {
    results.error = 'No active project: ' + (projectProbe.error || 'unknown');
    return results;
  }
  const project = projectProbe.value;

  const seqName = 'PPMCP_TextShapeTest_' + Date.now();
  const seqCreate = await safe('createSequence', () => project.createSequence(seqName));
  results.sequenceCreate = { ok: seqCreate.ok, error: seqCreate.ok ? null : seqCreate.error, name: seqName };
  if (!seqCreate.ok || !seqCreate.value) return results;
  const seq = seqCreate.value;

  const editorProbe = await safe('getEditor', () => ppro.SequenceEditor.getEditor(seq));
  if (!editorProbe.ok || !editorProbe.value) {
    results.editorError = editorProbe.error;
    return results;
  }
  const editor = editorProbe.value;

  let insertResult = null;
  let usedPath = null;
  for (const path of BASIC_TITLE_MOGRT_CANDIDATES) {
    const attempt = await safe('insertMogrt:' + path, () =>
      editor.insertMogrtFromPath(path, ppro.TickTime.TIME_ZERO, 0, 0)
    );
    if (attempt.ok) {
      insertResult = attempt;
      usedPath = path;
      break;
    } else {
      results['insertAttempt_' + path] = attempt.error;
    }
  }
  results.mogrtInsert = { ok: !!insertResult, usedPath, error: insertResult ? null : 'all candidate paths failed' };
  if (!insertResult || !insertResult.value || !insertResult.value.length) return results;

  const trackItem = insertResult.value[0];
  results.trackItem = await safe('trackItemName', () => trackItem.getName());

  const chainProbe = await safe('getComponentChain', () => trackItem.getComponentChain());
  if (!chainProbe.ok || !chainProbe.value) {
    results.chainError = chainProbe.error;
    return results;
  }
  const chain = chainProbe.value;
  const compCount = await safe('componentCount', () => chain.getComponentCount());
  results.componentCount = compCount.ok ? compCount.value : compCount.error;

  const components = [];
  if (compCount.ok) {
    for (let i = 0; i < compCount.value; i++) {
      const comp = await safe('component' + i, () => chain.getComponentAtIndex(i));
      if (!comp.ok || !comp.value) { components.push({ index: i, error: comp.error }); continue; }
      const dispName = await safe('compDisplayName' + i, () => comp.value.getDisplayName());
      const paramCount = await safe('paramCount' + i, () => comp.value.getParamCount());
      const params = [];
      if (paramCount.ok) {
        for (let p = 0; p < paramCount.value; p++) {
          const param = await safe('param' + i + '_' + p, () => comp.value.getParam(p));
          if (param.ok && param.value) {
            const pName = await safe('paramName', () => param.value.displayName);
            params.push({ index: p, displayName: pName.ok ? pName.value : pName.error });
          }
        }
      }
      components.push({ index: i, displayName: dispName.ok ? dispName.value : dispName.error, paramCount: paramCount.ok ? paramCount.value : paramCount.error, params });
    }
  }
  results.components = components;

  // Try to find something that looks like a text/"Source Text" param and set it.
  let textParamRef = null;
  for (const c of components) {
    if (!c.params) continue;
    for (const p of c.params) {
      if (typeof p.displayName === 'string' && /text/i.test(p.displayName)) {
        textParamRef = { componentIndex: c.index, paramIndex: p.index, displayName: p.displayName };
      }
    }
  }
  results.textParamFound = textParamRef;

  if (textParamRef) {
    const comp = await safe('reGetComp', () => chain.getComponentAtIndex(textParamRef.componentIndex));
    if (comp.ok && comp.value) {
      const param = await safe('reGetParam', () => comp.value.getParam(textParamRef.paramIndex));
      if (param.ok && param.value) {
        const setAttempt = await safe('setTextValue', async () => {
          const kf = param.value.createKeyframe('PPMCP Test Text');
          const action = param.value.createSetValueAction(kf);
          await project.executeTransaction((compoundAction) => {
            compoundAction.addAction(action);
          }, 'PPMCP set title text');
          return true;
        });
        results.setTextAttempt = setAttempt;
      }
    }
  }

  return results;
}

document.getElementById('runBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  statusEl.textContent = 'Running...';
  outputEl.value = '';
  try {
    const results = await runDiagnostics();
    const json = JSON.stringify(results, null, 2);
    console.log('PPRO_MCP_PROBE_RESULT_START');
    console.log(json);
    console.log('PPRO_MCP_PROBE_RESULT_END');
    outputEl.value = json;
    statusEl.textContent = 'Done. Copy the text below and paste it back in chat.';
  } catch (e) {
    statusEl.textContent = 'Diagnostics crashed: ' + (e && e.message ? e.message : String(e));
  }
});

document.getElementById('textTestBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  statusEl.textContent = 'Running text-creation test (creates a new test sequence)...';
  outputEl.value = '';
  try {
    const results = await testTextCreation();
    const json = JSON.stringify(results, null, 2);
    console.log('PPRO_MCP_TEXT_TEST_RESULT_START');
    console.log(json);
    console.log('PPRO_MCP_TEXT_TEST_RESULT_END');
    outputEl.value = json;
    statusEl.textContent = 'Done. A new sequence named "PPMCP_TextShapeTest_..." was created in your project — copy the results below and paste back in chat, then feel free to delete that test sequence.';
  } catch (e) {
    statusEl.textContent = 'Text test crashed: ' + (e && e.message ? e.message : String(e));
  }
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const outputEl = document.getElementById('output');
  outputEl.select();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(outputEl.value);
      document.getElementById('status').textContent = 'Copied to clipboard.';
    } else {
      document.execCommand('copy');
      document.getElementById('status').textContent = 'Copied (fallback).';
    }
  } catch (e) {
    document.getElementById('status').textContent = 'Copy failed — select the text manually (Ctrl+A, Ctrl+C).';
  }
});

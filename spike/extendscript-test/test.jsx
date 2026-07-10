// PPMCP ExtendScript live probe — round 3.
// Round 1 confirmed: "AE.ADBE Text" component IS visible via classic
// ExtendScript clip.components (unlike UXP's getComponentChain(), which
// never showed it). Round 2 confirmed getValue() on "Source Text" reliably
// returns a single opaque char (code 380), not the JSON blob the community
// technique expects — for Adobe's own bundled "Basic Title.mogrt".
// Hypothesis this round: Adobe's own bundled MOGRTs are Premiere-native,
// not After-Effects-authored, and the JSON.parse(getValue()) technique
// specifically requires an AE-authored MOGRT (a caveat found in the
// original research). This machine has folders literally named
// "[AE] Sports Package" / "[AE] Video Gaming Package" in the default
// Essential Graphics library — genuinely AE-authored templates — so this
// script imports one of those into a NEW clip and repeats the same
// inspection, to compare against the Basic Title result.

function log(x) {
  $.writeln(JSON.stringify(x, null, 2));
}

var results = {};

function inspectClip(clip, label) {
  var out = { label: label };
  try {
    out.clipName = clip.name;
    var componentsInfo = [];
    for (var c = 0; c < clip.components.numItems; c++) {
      var comp = clip.components[c];
      var props = [];
      for (var p = 0; p < comp.properties.numItems; p++) {
        props.push({ index: p, displayName: comp.properties[p].displayName });
      }
      componentsInfo.push({ index: c, matchName: comp.matchName, propCount: comp.properties.numItems, props: props });
    }
    out.components = componentsInfo;

    var textCompIndex = -1, textPropIndex = -1;
    for (var ci = 0; ci < componentsInfo.length; ci++) {
      if (/text/i.test(componentsInfo[ci].matchName || '')) {
        textCompIndex = componentsInfo[ci].index;
        for (var pi = 0; pi < componentsInfo[ci].props.length; pi++) {
          if (/source text/i.test(componentsInfo[ci].props[pi].displayName || '')) {
            textPropIndex = componentsInfo[ci].props[pi].index;
            break;
          }
        }
        if (textPropIndex < 0 && componentsInfo[ci].props.length > 0) textPropIndex = componentsInfo[ci].props[0].index;
        break;
      }
    }
    out.foundTextComponent = textCompIndex >= 0;

    if (textCompIndex >= 0 && textPropIndex >= 0) {
      var textParam = clip.components[textCompIndex].properties[textPropIndex];
      try {
        var raw = textParam.getValue();
        out.rawType = typeof raw;
        out.rawLength = (raw && raw.length !== undefined) ? raw.length : null;
        out.rawValue = raw;
        try {
          var parsed = JSON.parse(raw);
          out.jsonParseOk = true;
          out.parsedKeys = [];
          for (var kk in parsed) out.parsedKeys.push(kk);
          parsed.textEditValue = 'PPMCP Test Text';
          parsed.fontTextRunLength = [('PPMCP Test Text').length];
          out.setTextResult = textParam.setValue(JSON.stringify(parsed), true);
        } catch (eParse) {
          out.jsonParseOk = false;
          out.jsonParseError = String(eParse);
        }
      } catch (e) {
        out.getValueError = String(e);
      }
    }
  } catch (e) {
    out.inspectError = String(e);
  }
  return out;
}

try {
  results.projectName = app.project.name;
} catch (e) {
  results.projectNameError = String(e);
}

var targetSeq = null;
try {
  var numSeq = app.project.sequences.numSequences;
  results.totalSequences = numSeq;
  var seqNames = [];
  for (var i = 0; i < numSeq; i++) {
    var s = app.project.sequences[i];
    seqNames.push(s.name);
    if (s.name.indexOf('PPMCP_TextShapeTest') === 0) targetSeq = s;
  }
  results.sequenceNames = seqNames;
  results.foundTestSequence = !!targetSeq;
} catch (e) {
  results.sequenceSearchError = String(e);
}

if (targetSeq) {
  // Re-inspect the existing Basic Title clip (Premiere-native MOGRT), for
  // a side-by-side comparison against the AE-authored one below.
  try {
    var existingClip = targetSeq.videoTracks[0].clips[0];
    results.basicTitleClip = inspectClip(existingClip, 'Basic Title.mogrt (Premiere-native)');
  } catch (e) {
    results.basicTitleInspectError = String(e);
  }

  // Import an AE-authored MOGRT into the SAME sequence and inspect it too.
  var AE_MOGRT_CANDIDATES = [
    'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\[AE] Sports Package\\Sports Lower Third Center.mogrt',
    'C:\\Users\\cagan\\AppData\\Roaming\\Adobe\\Common\\Motion Graphics Templates\\[AE] Sports Package\\Sports Lower Third Center.mogrt',
  ];
  var imported = null, usedPath = null, importErrors = {};
  for (var m = 0; m < AE_MOGRT_CANDIDATES.length; m++) {
    var path = AE_MOGRT_CANDIDATES[m];
    try {
      // importMGT(path, timeInTicks, videoTrackIndex, audioTrackIndex) —
      // per community-documented usage; time 0 = start of sequence.
      imported = targetSeq.importMGT(path, 0, 1, 0); // put it on video track 2 (index 1) so it doesn't overlap the existing clip
      usedPath = path;
      break;
    } catch (e) {
      importErrors[path] = String(e);
    }
  }
  results.aeMogrtImport = { ok: !!imported, usedPath: usedPath, errors: importErrors };

  if (imported) {
    try {
      // The newly imported clip should now be the last (or only) clip on
      // video track 2 (index 1).
      var track2 = targetSeq.videoTracks[1];
      var newClip = track2.clips[track2.clips.numItems - 1];
      results.aeMogrtClip = inspectClip(newClip, 'AE-authored Sports Lower Third (from [AE] Sports Package)');

      // Round 4: proper JSON-preserving edit — parse existing value, change
      // ONLY textEditValue + fontTextRunLength, keep font/size/style intact,
      // re-stringify. This is the real community-documented technique,
      // done correctly (round 3's plain-string set likely corrupted the
      // rich-text structure instead of properly editing it).
      var capsuleResults = [];
      for (var cc = 0; cc < newClip.components.numItems; cc++) {
        var comp = newClip.components[cc];
        if (comp.matchName === 'AE.ADBE Capsule') {
          var targets = [
            { name: 'Title', index: 1, newText: 'PPMCP TITLE TEST' },
            { name: 'Subtitle', index: 2, newText: 'PPMCP Subtitle Test' },
          ];
          for (var tIdx = 0; tIdx < targets.length; tIdx++) {
            var t = targets[tIdx];
            var entry = { propIndex: t.index, expectedName: t.name };
            try {
              var param = comp.properties[t.index];
              var rawVal = param.getValue();
              entry.rawValueBefore = rawVal;
              try {
                var parsed = JSON.parse(rawVal);
                parsed.textEditValue = t.newText;
                parsed.fontTextRunLength = [t.newText.length];
                var newJson = JSON.stringify(parsed);
                entry.newJsonSent = newJson;
                entry.setResult = param.setValue(newJson, true);
                entry.rawValueAfter = param.getValue();
                try { entry.rawValueAfterParsed = JSON.parse(entry.rawValueAfter); } catch (eee) { entry.rawValueAfterParseError = String(eee); }
              } catch (eParse) {
                entry.jsonParseError = String(eParse);
              }
            } catch (eGet) {
              entry.getError = String(eGet);
            }
            capsuleResults.push(entry);
          }
        }
      }
      results.capsuleTextTestV2 = capsuleResults;

      // Round 5: color/simple-value properties — the shape-relevant test.
      // No bundled blank "shape" MOGRT exists, but if a plain property like
      // "Main Color" reads/writes as a simple (non-JSON-blob) value the
      // same way clip transforms do, that's direct evidence the same
      // technique will work for a custom-authored shape MOGRT's fill
      // color/size/position — since those are the same property types.
      var colorResults = [];
      for (var cc2 = 0; cc2 < newClip.components.numItems; cc2++) {
        var comp2 = newClip.components[cc2];
        if (comp2.matchName === 'AE.ADBE Capsule') {
          for (var p2 = 0; p2 < comp2.properties.numItems; p2++) {
            var dn = comp2.properties[p2].displayName;
            if (/color/i.test(dn || '')) {
              var centry = { index: p2, displayName: dn };
              try {
                var cparam = comp2.properties[p2];
                var cval = cparam.getValue();
                centry.rawType = typeof cval;
                centry.rawValue = cval;
              } catch (eC) {
                centry.getError = String(eC);
              }
              colorResults.push(centry);
            }
          }
        }
      }
      results.colorPropertyTest = colorResults;

      try { app.project.save(); results.projectSaved = true; } catch (eSave) { results.projectSaveError = String(eSave); }
    } catch (e) {
      results.aeMogrtClipInspectError = String(e);
    }
  }
} else {
  results.note = 'No PPMCP_TextShapeTest_* sequence found.';
}

// --- QE DOM: retry enable + dump raw reflect output verbatim ---
try {
  var qeEnabled = app.enableQE();
  results.qeEnabled = qeEnabled;
  if (!qeEnabled) {
    // Try once more in case of a transient failure.
    qeEnabled = app.enableQE();
    results.qeEnabledRetry = qeEnabled;
  }
  if (qeEnabled && typeof qe !== 'undefined') {
    var candidates = [
      { label: 'qe_reflect_methods', fn: function () { return qe.reflect.methods; } },
      { label: 'qe_project_reflect_methods', fn: function () { return qe.project.reflect.methods; } },
    ];
    try {
      var qeSeq = qe.project.getActiveSequence();
      var qeTrack = qeSeq.getVideoTrackAt(0);
      var qeItem = qeTrack.getItemAt(0);
      candidates.push({ label: 'qe_trackitem_reflect_methods', fn: function () { return qeItem.reflect.methods; } });
    } catch (eQeItem) {
      results.qeTrackItemAccessError = String(eQeItem);
    }
    var scanResults = {};
    for (var ccc = 0; ccc < candidates.length; ccc++) {
      try {
        var val = candidates[ccc].fn();
        var str = (typeof val === 'string') ? val : JSON.stringify(val);
        scanResults[candidates[ccc].label] = { ok: true, type: typeof val, raw: str };
      } catch (e) {
        scanResults[candidates[ccc].label] = { ok: false, error: String(e) };
      }
    }
    results.qeMethodScan = scanResults;
  }
} catch (e) {
  results.qeError = String(e);
}

log(results);

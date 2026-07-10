// PPMCP legacy text helper — ExtendScript only (CEP evalScript target).
// Live-confirmed: AE.ADBE Capsule → JSON.parse(getValue()), mutate
// textEditValue + fontTextRunLength, setValue(json, true).

var PPMCP_legacy = (function () {
  function ok(data) {
    return JSON.stringify({ ok: true, data: data || {} });
  }
  function fail(message, detail) {
    return JSON.stringify({
      ok: false,
      error: { code: "PREMIERE_API_ERROR", message: String(message), detail: detail || null },
    });
  }

  function getActiveSequence() {
    if (!app.project) throw new Error("No open project.");
    var seq = app.project.activeSequence;
    if (!seq) throw new Error("No active sequence.");
    return seq;
  }

  function getVideoClip(seq, trackIndex, clipIndex) {
    var tracks = seq.videoTracks;
    if (!tracks || trackIndex < 0 || trackIndex >= tracks.numTracks) {
      throw new Error("Video track " + trackIndex + " out of range.");
    }
    var track = tracks[trackIndex];
    var clips = track.clips;
    if (!clips || clipIndex < 0 || clipIndex >= clips.numItems) {
      throw new Error("Clip " + clipIndex + " not on video track " + trackIndex + ".");
    }
    return clips[clipIndex];
  }

  function tryParseJson(raw) {
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeTextParam(param, newText) {
    var raw = null;
    try {
      raw = param.getValue();
    } catch (e0) {
      raw = null;
    }
    var parsed = tryParseJson(raw);
    var errors = [];
    // Strategy 1: AE Capsule JSON (live-confirmed for AE-authored MOGRTs)
    if (parsed && typeof parsed === "object") {
      try {
        parsed.textEditValue = newText;
        if (parsed.fontTextRunLength) {
          parsed.fontTextRunLength = [newText.length];
        }
        if (parsed.SourceText !== undefined) parsed.SourceText = newText;
        if (parsed.sourceText !== undefined) parsed.sourceText = newText;
        param.setValue(JSON.stringify(parsed), true);
        return { via: "json-capsule", preserved: true };
      } catch (e1) {
        errors.push("json-capsule: " + String(e1));
      }
    }
    // Strategy 2: build minimal capsule from scratch (when getValue is empty/broken)
    try {
      var capsule = {
        textEditValue: String(newText),
        fontEditValue: ["ArialMT"],
        fontSizeEditValue: [48],
        fontTextRunLength: [String(newText).length],
      };
      param.setValue(JSON.stringify(capsule), true);
      return { via: "json-capsule-minimal" };
    } catch (e2) {
      errors.push("json-minimal: " + String(e2));
    }
    // Strategy 3: plain string
    try {
      param.setValue(String(newText), true);
      return { via: "plain-string" };
    } catch (e3) {
      errors.push("plain: " + String(e3));
    }
    // Strategy 4: setValue without updateUI flag
    try {
      param.setValue(String(newText));
      return { via: "plain-string-noflag" };
    } catch (e4) {
      throw new Error("writeTextParam failed: " + errors.join(" | ") + " | " + String(e4));
    }
  }

  /** Soft verify: re-read and compare (reduces silent wrong text). */
  function verifyTextParam(param, expected) {
    try {
      var raw = param.getValue();
      var parsed = tryParseJson(raw);
      var got = null;
      if (parsed && parsed.textEditValue !== undefined) got = String(parsed.textEditValue);
      else if (typeof raw === "string") got = raw;
      if (got === null) return { verified: false, reason: "unreadable" };
      if (got === String(expected)) return { verified: true, text: got };
      // Prefix match for templates that pad/wrap
      if (got.indexOf(String(expected).slice(0, Math.min(12, String(expected).length))) >= 0) {
        return { verified: true, soft: true, text: got };
      }
      return { verified: false, reason: "mismatch", got: got, expected: String(expected) };
    } catch (e) {
      return { verified: false, reason: String(e) };
    }
  }

  function isTextyName(name) {
    if (!name) return false;
    var n = String(name).toLowerCase();
    return (
      n === "text" ||
      n === "title" ||
      n === "subtitle" ||
      n === "source text" ||
      n === "content" ||
      n.indexOf("text") >= 0 ||
      n.indexOf("title") >= 0
    );
  }

  function collectTextProps(clip) {
    var list = [];
    if (!clip || !clip.components) return list;
    for (var c = 0; c < clip.components.numItems; c++) {
      var comp = clip.components[c];
      var matchName = comp.matchName || "";
      for (var p = 0; p < comp.properties.numItems; p++) {
        var prop = comp.properties[p];
        var dn = prop.displayName || "";
        if (matchName === "AE.ADBE Capsule" && isTextyName(dn)) {
          list.push({ prop: prop, matchName: matchName, displayName: dn, propIndex: p });
        } else if (isTextyName(dn) || dn === "" || dn === " ") {
          list.push({ prop: prop, matchName: matchName, displayName: dn, propIndex: p });
        }
      }
    }
    return list;
  }

  function findPropByName(list, name) {
    var lower = String(name).toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].displayName || "").toLowerCase() === lower) return list[i];
    }
    return null;
  }

  function setClipText(clip, newText, subtitle) {
    if (!clip || !clip.components) throw new Error("Clip has no components.");
    var list = collectTextProps(clip);
    if (!list.length) {
      throw new Error("No text-like properties. Use an AE-authored MOGRT (AE.ADBE Capsule).");
    }

    var titleProp = findPropByName(list, "Title") || findPropByName(list, "Text") || list[0];
    var subProp = findPropByName(list, "Subtitle");
    var attempts = [];
    var written = [];

    function tryWrite(entry, value, label) {
      var lastErr = null;
      // Up to 2 attempts — first write sometimes races right after importMGT
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          var r = writeTextParam(entry.prop, String(value || ""));
          var v = verifyTextParam(entry.prop, String(value || ""));
          if (!v.verified && attempt === 0) {
            // rewrite once on mismatch
            try {
              writeTextParam(entry.prop, String(value || ""));
              v = verifyTextParam(entry.prop, String(value || ""));
            } catch (re) {
              lastErr = re;
            }
          }
          written.push({
            displayName: entry.displayName,
            component: entry.matchName,
            propIndex: entry.propIndex,
            via: r.via,
            text: String(value || ""),
            verify: v,
          });
          return true;
        } catch (e) {
          lastErr = e;
        }
      }
      attempts.push(label + ": " + String(lastErr));
      return false;
    }

    tryWrite(titleProp, String(newText || ""), "Title");

    if (subtitle !== undefined && subtitle !== null && String(subtitle).length && subProp) {
      tryWrite(subProp, String(subtitle), "Subtitle");
    }

    if (!written.length) {
      for (var i = 0; i < list.length; i++) {
        if (tryWrite(list[i], String(newText || ""), list[i].displayName || "prop" + i)) break;
      }
    }

    if (!written.length) {
      throw new Error("No writable text property. " + attempts.join(" | "));
    }

    return {
      written: true,
      text: String(newText || ""),
      subtitle: subtitle !== undefined && subtitle !== null ? String(subtitle) : null,
      fields: written,
      component: written[0].component,
      displayName: written[0].displayName,
      propIndex: written[0].propIndex,
      via: written[0].via,
      verified: !!(written[0].verify && written[0].verify.verified),
    };
  }

  function getClipText(clip) {
    if (!clip || !clip.components) throw new Error("Clip has no components.");
    var list = collectTextProps(clip);
    var fields = [];
    for (var i = 0; i < list.length; i++) {
      try {
        var raw = list[i].prop.getValue();
        var parsed = tryParseJson(raw);
        var textVal = null;
        if (parsed && parsed.textEditValue !== undefined) textVal = parsed.textEditValue;
        else if (typeof raw === "string") textVal = raw;
        if (textVal !== null) {
          fields.push({
            displayName: list[i].displayName,
            component: list[i].matchName,
            text: textVal,
          });
        }
      } catch (e) {
        /* skip */
      }
    }
    if (!fields.length) throw new Error("Could not read any text property on this clip.");
    var title = null;
    var subtitle = null;
    for (var f = 0; f < fields.length; f++) {
      var dn = String(fields[f].displayName || "").toLowerCase();
      if (dn === "title" || dn === "text") title = fields[f].text;
      if (dn === "subtitle") subtitle = fields[f].text;
    }
    return {
      text: title !== null ? title : fields[0].text,
      subtitle: subtitle,
      fields: fields,
      via: "extendscript-read",
    };
  }

  function listTextProps(clip) {
    var out = [];
    var list = collectTextProps(clip);
    for (var i = 0; i < list.length; i++) {
      var sample = null;
      try {
        sample = String(list[i].prop.getValue()).slice(0, 80);
      } catch (e) {
        sample = "ERR:" + String(e);
      }
      out.push({
        component: list[i].matchName,
        propIndex: list[i].propIndex,
        displayName: list[i].displayName,
        sample: sample,
      });
    }
    return out;
  }

  function splitTitleSub(p) {
    var title = p.text;
    var sub = p.subtitle;
    if ((sub === undefined || sub === null) && typeof title === "string" && title.indexOf("\n") >= 0) {
      var parts = title.split(/\r?\n/);
      title = parts[0];
      sub = parts.slice(1).join(" ").replace(/^\s+|\s+$/g, "");
    }
    return { title: title, sub: sub };
  }

  return {
    ping: function () {
      return ok({
        app: "Premiere Pro",
        version: app.version,
        bridge: "ppmcp-legacy-text",
      });
    },

    setText: function (paramsJson) {
      try {
        var p = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var seq = getActiveSequence();
        var clip = getVideoClip(seq, p.trackIndex | 0, p.clipIndex | 0);
        var ts = splitTitleSub(p);
        var result = setClipText(clip, String(ts.title || ""), ts.sub);
        result.clipName = clip.name;
        result.sequenceName = seq.name;
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },

    getText: function (paramsJson) {
      try {
        var p = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var seq = getActiveSequence();
        var clip = getVideoClip(seq, p.trackIndex | 0, p.clipIndex | 0);
        var result = getClipText(clip);
        result.clipName = clip.name;
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },

    listTextProps: function (paramsJson) {
      try {
        var p = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var seq = getActiveSequence();
        var clip = getVideoClip(seq, p.trackIndex | 0, p.clipIndex | 0);
        return ok({ clipName: clip.name, props: listTextProps(clip) });
      } catch (e) {
        return fail(e);
      }
    },

    insertAndSetText: function (paramsJson) {
      try {
        var p = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
        var seq = getActiveSequence();
        var path = p.mogrtPath;
        if (!path) throw new Error("mogrtPath required");
        // Normalize Windows path separators for File/importMGT
        path = String(path).replace(/\//g, "\\");
        var f = new File(path);
        if (!f.exists) throw new Error("MOGRT file not found: " + path);
        var timeTicks = String(p.atTicks || "0");
        var vTrack = p.trackIndex | 0;
        var aTrack = p.audioTrackIndex !== undefined ? p.audioTrackIndex | 0 : 0;

        var clip = null;
        var lastImportErr = null;
        // importMGT can be flaky right after sequence switch — retry
        for (var attempt = 0; attempt < 3; attempt++) {
          try {
            clip = seq.importMGT(path, timeTicks, vTrack, aTrack);
            if (clip) break;
            lastImportErr = "importMGT returned null";
          } catch (ie) {
            lastImportErr = String(ie);
          }
        }
        if (!clip) throw new Error("importMGT failed for " + path + ": " + lastImportErr);

        var track = seq.videoTracks[vTrack];
        var clipIndex = track.clips.numItems - 1;
        for (var i = 0; i < track.clips.numItems; i++) {
          if (track.clips[i] === clip) {
            clipIndex = i;
            break;
          }
        }

        var ts = splitTitleSub(p);
        // Components may not be ready immediately after importMGT — retry setClipText
        var write = null;
        var writeErr = null;
        for (var w = 0; w < 3; w++) {
          try {
            // Re-resolve clip by index each try (object may stale)
            var liveClip = track.clips[clipIndex] || clip;
            write = setClipText(liveClip, String(ts.title || ""), ts.sub);
            if (write && write.written) break;
          } catch (we) {
            writeErr = we;
          }
        }
        if (!write || !write.written) {
          throw new Error(
            "MOGRT inserted but text write failed: " +
              (writeErr ? String(writeErr) : "unknown") +
              " (AE Capsule template required; Adobe Basic Title is not reliable)",
          );
        }

        return ok({
          trackIndex: vTrack,
          clipIndex: clipIndex,
          clipName: clip.name,
          mogrtPath: path,
          text: ts.title,
          subtitle: ts.sub || null,
          write: write,
          editable: true,
          quality: "editable-cep",
        });
      } catch (e) {
        return fail(e);
      }
    },
  };
})();

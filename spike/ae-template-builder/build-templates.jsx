// PPMCP — fully-scripted After Effects Motion Graphics Template builder.
// Creates our OWN "Basic Shape" and "Basic Text" MOGRT templates, entirely
// via ExtendScript (no manual GUI steps), and exports them to the same
// Motion Graphics Templates folder Premiere reads from by default.
//
// Why: Adobe's own bundled Premiere-native MOGRTs are confirmed broken for
// programmatic text editing (see docs/PLAN.md §3). An After-Effects
// -authored MOGRT is confirmed to work. So instead of asking the user to
// hand-build one in the AE GUI, this script builds and exports minimal,
// reusable ones we can bundle with the plugin.
//
// Run via VS Code + Adobe's "ExtendScript Debugger" extension, attached to
// a running After Effects (same workflow as the Premiere test, just a
// different target app in the attach picker).

// Minimal hand-rolled serializer — this AE ExtendScript engine has no
// native JSON object (unlike the Premiere Pro engine used earlier).
function toStr(x, indent) {
  indent = indent || '';
  var nextIndent = indent + '  ';
  if (x === null || x === undefined) return String(x);
  if (typeof x === 'string') return '"' + x.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  if (x instanceof Array) {
    if (x.length === 0) return '[]';
    var items = [];
    for (var i = 0; i < x.length; i++) items.push(nextIndent + toStr(x[i], nextIndent));
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }
  if (typeof x === 'object') {
    var keys = [];
    for (var k in x) { if (x.hasOwnProperty(k)) keys.push(k); }
    if (keys.length === 0) return '{}';
    var pairs = [];
    for (var j = 0; j < keys.length; j++) {
      pairs.push(nextIndent + '"' + keys[j] + '": ' + toStr(x[keys[j]], nextIndent));
    }
    return '{\n' + pairs.join(',\n') + '\n' + indent + '}';
  }
  return '"' + String(x) + '"';
}

function log(x) {
  $.writeln(toStr(x));
}

var results = {};
var OUT_DIR = 'C:\\Users\\cagan\\AppData\\Roaming\\Adobe\\Common\\Motion Graphics Templates\\';

function ensureProject() {
  if (!app.project) {
    app.newProject();
  }
}

function buildShapeTemplate() {
  var out = {};
  try {
    var comp = app.project.items.addComp('PPMCP_BasicShape', 1920, 1080, 1, 5, 25);
    var shapeLayer = comp.layers.addShape();
    shapeLayer.name = 'Shape';

    var root = shapeLayer.property('ADBE Root Vectors Group');
    var group = root.addProperty('ADBE Vector Group');
    var groupContents = group.property('ADBE Vectors Group');

    var rect = groupContents.addProperty('ADBE Vector Shape - Rect');
    var rectSize = rect.property('ADBE Vector Rect Size');
    rectSize.setValue([400, 200]);

    var fill = groupContents.addProperty('ADBE Vector Graphic - Fill');
    var fillColor = fill.property('ADBE Vector Fill Color');
    fillColor.setValue([1, 0, 0, 1]); // red RGBA 0..1, placeholder default

    var posProp = shapeLayer.transform.position;

    // Expose to Essential Graphics — each wrapped so one failure doesn't
    // block the others or skip export.
    var exposed = {};
    try { exposed.position = posProp.addToMotionGraphicsTemplateAs(comp, 'Position'); } catch (e1) { exposed.position = 'ERR: ' + String(e1); }
    try { exposed.size = rect.property('ADBE Vector Rect Size').addToMotionGraphicsTemplateAs(comp, 'Size'); } catch (e2) { exposed.size = 'ERR: ' + String(e2); }
    try { exposed.color = fill.property('ADBE Vector Fill Color').addToMotionGraphicsTemplateAs(comp, 'Color'); } catch (e3) { exposed.color = 'ERR: ' + String(e3); }
    out.exposed = exposed;

    comp.motionGraphicsTemplateName = 'Basic Shape';
    var outPath = OUT_DIR + 'Basic Shape.mogrt';
    out.exportOk = comp.exportAsMotionGraphicsTemplate(true, outPath);
    out.outPath = outPath;
  } catch (e) {
    out.error = String(e) + ' (line ' + (e.line || '?') + ')';
  }
  return out;
}

function buildTextTemplate() {
  var out = {};
  try {
    var comp = app.project.items.addComp('PPMCP_BasicText', 1920, 1080, 1, 5, 25);
    var textLayer = comp.layers.addText('Sample Text');
    textLayer.name = 'Text';
    var sourceTextProp = textLayer.property('Source Text');
    var posProp = textLayer.transform.position;

    var exposed = {};
    exposed.sourceText = sourceTextProp.canAddToMotionGraphicsTemplate(comp)
      ? sourceTextProp.addToMotionGraphicsTemplateAs(comp, 'Text') : false;
    exposed.position = posProp.canAddToMotionGraphicsTemplate(comp)
      ? posProp.addToMotionGraphicsTemplateAs(comp, 'Position') : false;
    out.exposed = exposed;

    comp.motionGraphicsTemplateName = 'Basic Text';
    var outPath = OUT_DIR + 'Basic Text.mogrt';
    out.exportOk = comp.exportAsMotionGraphicsTemplate(true, outPath);
    out.outPath = outPath;
  } catch (e) {
    out.error = String(e) + ' (line ' + (e.line || '?') + ')';
  }
  return out;
}

try {
  ensureProject();
  results.appVersion = app.version;
  results.shapeTemplate = buildShapeTemplate();
  results.textTemplate = buildTextTemplate();
} catch (e) {
  results.topLevelError = String(e);
}

log(results);

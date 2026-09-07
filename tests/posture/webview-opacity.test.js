import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { appendVoiceSessionDiagnostic } from "../../src/features/voice/voice-session.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
const cssSource = () => readFile(new URL("../../src/index.css", import.meta.url), "utf8");

function memoryStorage() {
  const cells = new Map();
  return { getItem: (k) => (cells.has(k) ? cells.get(k) : null), setItem: (k, v) => cells.set(k, String(v)) };
}

/* ------------------------- (a) the opaque ground ------------------------ */

test("#root always paints a ground of its own", async () => {
  const css = await cssSource();
  /* A transparent #root lets the WebView composite the previous screen's
     pixels behind the current one -- the overlap on the save screen. */
  assert.match(css, /html,\s*\r?\nbody,\s*\r?\n#root \{\s*\r?\n\s*background-color: var\(--page\);\s*\r?\n\}/);
});

test("the camera keeps its transparent override", async () => {
  const source = await appSource();
  // The native preview sits behind the WebView, so this rule has to win.
  assert.match(source, /html\.posture-camera-native-active, html\.posture-camera-native-active body, html\.posture-camera-native-active #root \{ background: transparent !important; \}/);
});

test("the theme variable the ground uses is defined", async () => {
  const css = await cssSource();
  // --page is swapped by applyTheme(); a ground bound to an undefined variable
  // would paint nothing at all.
  assert.match(css, /--page: #F2F2F7;/);
});

/* ---------------------- (c) the opacity diagnostic ---------------------- */

test("opacity is read at camera start and at camera stop", async () => {
  const source = await appSource();
  const calls = source.match(/cameraPipelineLog\("camera_webview_opacity", \{/g) || [];
  assert.equal(calls.length, 2, "one at start, one at stop");
  assert.match(source, /state: "camera_started", \.\.\.readWebViewOpacity\(\)/);
  assert.match(source, /state: "camera_stopped", reason, \.\.\.readWebViewOpacity\(\)/);
});

test("the stop reading happens after the transparent class is dropped", async () => {
  const source = await appSource();
  /* Reading before the class comes off would always report transparent and
     say nothing about whether the ground was restored. */
  const removal = source.indexOf(`    document.documentElement.classList.remove("posture-camera-native-active");\r\n    cameraPipelineLog("camera_webview_opacity"`);
  const removalLf = source.indexOf(`    document.documentElement.classList.remove("posture-camera-native-active");\n    cameraPipelineLog("camera_webview_opacity"`);
  assert.ok(removal >= 0 || removalLf >= 0, "the log must directly follow the class removal");
});

test("the stage and its fields actually reach the device diagnostics", () => {
  // Unregistered stages and unlisted fields are dropped silently, and that
  // sink is the only thing the on-device screen reads.
  const entry = appendVoiceSessionDiagnostic("camera_webview_opacity", {
    source: "native_preview", state: "camera_stopped",
    webViewOpaque: false, root: "transparent", surface: "opaque",
    message: "html=rgb(242, 242, 247) body=rgba(0, 0, 0, 0) root=rgba(0, 0, 0, 0)",
  }, memoryStorage());
  assert.ok(entry, "the stage is dropped before it reaches diagnostics");
  assert.equal(entry.event, "camera_webview_opacity");
  assert.equal(entry.webViewOpaque, false, "false must survive, not be filtered as falsy");
  assert.equal(entry.root, "transparent");
  assert.equal(entry.surface, "opaque");
  /* The verdict alone does not say which colour was painted. The raw values go
     through the message field, which keeps punctuation the id sanitiser would
     strip. */
  assert.equal(entry.message, "html=rgb(242, 242, 247) body=rgba(0, 0, 0, 0) root=rgba(0, 0, 0, 0)");
});

test("the raw colours are carried verbatim, not summarised away", async () => {
  const source = await appSource();
  assert.match(source, /message: `html=\$\{surface \|\| "none"\} body=\$\{body \|\| "none"\} root=\$\{root \|\| "none"\}`/);
});

test("an opaque reading is recorded as such", () => {
  const entry = appendVoiceSessionDiagnostic("camera_webview_opacity", {
    source: "native_preview", state: "camera_started", webViewOpaque: true,
  }, memoryStorage());
  assert.equal(entry.webViewOpaque, true);
});

test("an unreadable value is left out rather than guessed", () => {
  const entry = appendVoiceSessionDiagnostic("camera_webview_opacity", { source: "native_preview", state: "camera_stopped" }, memoryStorage());
  assert.ok(!("webViewOpaque" in entry), "no value is better than a made-up one");
});

/* --------------- the reader itself, run against a fake DOM -------------- */

/* The helper lives inside App.jsx, which cannot be imported in a plain node
   test. Its two rules are lifted here verbatim so a change to either one is
   caught: an alpha of exactly 0 is transparent, anything else is a ground. */
const opaque = (value) => {
  if (!value || value === "transparent") return false;
  const alpha = value.match(/^rgba\([^)]*,\s*([0-9.]+)\s*\)$/);
  return alpha ? Number(alpha[1]) > 0 : true;
};

test("the transparent shapes a browser actually returns all read as transparent", async () => {
  const source = await appSource();
  assert.match(source, /const alpha = value\.match\(\/\^rgba\\\(\[\^\)\]\*,\\s\*\(\[0-9\.\]\+\)\\s\*\\\)\$\/\);/, "the rule under test must match the shipped one");
  for (const value of ["rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)", "transparent", "", null, undefined]) {
    assert.equal(opaque(value), false, `${value} is not a ground`);
  }
});

test("any painted colour reads as a ground", () => {
  for (const value of ["rgb(242, 242, 247)", "#F2F2F7", "rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 1)", "rgba(0,0,0,.01)"]) {
    assert.equal(opaque(value), true, `${value} is a ground`);
  }
});

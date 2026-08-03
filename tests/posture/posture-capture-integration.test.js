import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../../src/App.jsx", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);
const envExamplePath = new URL("../../.env.example", import.meta.url);
const iosInfoPath = new URL("../../ios/App/App/Info.plist", import.meta.url);
const iosPackagePath = new URL("../../ios/App/CapApp-SPM/Package.swift", import.meta.url);

async function appSource() {
  return readFile(appPath, "utf8");
}

test("iOS review capture is opt-in while dependencies and permission declarations stay explicit", async () => {
  const [packageText, envExample, iosInfo, iosPackage, source] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(envExamplePath, "utf8"),
    readFile(iosInfoPath, "utf8"),
    readFile(iosPackagePath, "utf8"),
    appSource(),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.dependencies["@capgo/camera-preview"], "8.11.2");
  assert.equal(packageJson.dependencies["@capacitor/motion"], "8.0.1");
  assert.match(envExample, /^VITE_IOS_NATIVE_CAPTURE_ENABLED=false$/m);
  assert.match(iosInfo, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(iosInfo, /<key>NSMotionUsageDescription<\/key>/);
  assert.match(iosPackage, /\.package\(name: "CapgoCameraPreview"/);
  assert.match(iosPackage, /\.product\(name: "CapgoCameraPreview"/);
  assert.match(source, /Capacitor\.getPlatform\(\) === "ios" && !IOS_NATIVE_CAPTURE_ENABLED/);
  assert.match(source, /iosStableCaptureFallback \? "사진 촬영 또는 선택"/);
});

test("posture capture render path uses a real rear preview with browser fallback and no body silhouette", async () => {
  const source = await appSource();
  const start = source.indexOf("function PostureCaptureScreen(");
  const end = source.indexOf("function PoseAnalyzer(", start);
  assert.ok(start >= 0 && end > start, "PostureCaptureScreen must be in the active App render source");
  const capture = source.slice(start, end);

  assert.match(capture, /CameraPreview\.checkPermissions/);
  assert.match(capture, /CameraPreview\.requestPermissions/);
  assert.match(capture, /CameraPreview\.start/);
  assert.match(capture, /Capacitor\.isPluginAvailable\("CameraPreview"\)/);
  assert.match(capture, /position:\s*"rear"/);
  assert.match(capture, /CameraPreview\.capture/);
  assert.match(capture, /CameraPreview\.stop/);
  assert.match(capture, /cameraGeneration\.current/);
  assert.match(capture, /motionPermission\.current/);
  assert.match(capture, /new ResizeObserver\(update\)/);
  assert.match(capture, /window\.addEventListener\("orientationchange", update\)/);
  assert.match(capture, /syncPreviewBounds/);
  assert.match(capture, /stageRef\.current\?\.getBoundingClientRect\(\) \|\| previewRect/);
  assert.match(capture, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(capture, /createPortal\(screen, document\.body\)/);
  assert.match(capture, /height:\s*"100dvh"/);
  assert.match(capture, /aspectRatio:\s*"3 \/ 4"/);
  assert.match(capture, /width:\s*1440, height:\s*1920/);
  assert.match(capture, />머리 위치</);
  assert.match(capture, />발 위치</);
  assert.match(capture, /left-1\/2 top-\[17%\] border-l/);
  assert.doesNotMatch(capture, /<svg\b/i);
  assert.doesNotMatch(capture, /silhouette|body.?outline/i);
  assert.match(capture, />다시 촬영</);
  assert.match(capture, /사용하기<\/button>/);
});

test("capture timer, motion lifecycle, and storage handoff are connected to the active UI", async () => {
  const source = await appSource();
  assert.match(source, /CAPTURE_TIMER_OPTIONS\.map/);
  assert.match(source, /readCaptureTimer\(/);
  assert.match(source, /writeCaptureTimer\(/);
  assert.match(source, /Motion\.addListener\("orientation"/);
  assert.match(source, /threshold:\s*LEVEL_THRESHOLD_DEG/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pagehide/);
  assert.match(source, /onAcceptCapture=\{\(blob, metadata\) => acceptCaptureBlob/);
  assert.match(source, /await onSaveCaptureDraft\(\{ assessmentId: assessmentId\.current/);
  assert.match(source, /if \(stored === false\) throw/);
  assert.match(source, /storage:\s*"indexedDB"/);
});

test("new, resumed, and completed assessment entry routes are distinct", async () => {
  const source = await appSource();
  const workspaceStart = source.indexOf("function AssessmentWorkspace(");
  const workspace = source.slice(workspaceStart);
  const newStart = workspace.indexOf("const startNew = () => {");
  const nextHandler = workspace.indexOf("const startCapture =", newStart);
  const startNewBody = workspace.slice(newStart, nextHandler);

  assert.match(startNewBody, /startNewAssessmentEvent\(newAssessmentId\)/);
  assert.doesNotMatch(startNewBody, /resumeSet\(/);
  assert.match(workspace, /POSTURE_WORKFLOW_EVENTS\.RESUME_DRAFT/);
  assert.match(workspace, /POSTURE_WORKFLOW_EVENTS\.OPEN_COMPLETED_ASSESSMENT/);
  assert.match(workspace, /openSet\(requestedCompletedSet, "result"\)/);
  assert.match(workspace, /initialAssessmentId=\{workflow\.activeAssessmentId\}/);
  assert.match(source, /mode:\s*"resume", assessmentId:\s*assessment\.id/);
});

test("draft restore rejects records explicitly owned by another member", async () => {
  const source = await appSource();
  const analyzerStart = source.indexOf("function PoseAnalyzer(");
  const workspaceStart = source.indexOf("function AssessmentWorkspace(", analyzerStart);
  const analyzer = source.slice(analyzerStart, workspaceStart);

  assert.match(analyzer, /!pose\.memberId \|\| pose\.memberId === member\?\.id/);
  assert.match(analyzer, /photo\?\.memberId && photo\.memberId !== member\?\.id/);
});

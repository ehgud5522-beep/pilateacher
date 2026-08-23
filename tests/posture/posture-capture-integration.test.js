import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appPath = new URL("../../src/App.jsx", import.meta.url);
const annotationPath = new URL("../../src/features/posture/posture-annotations.js", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);
const androidManifestPath = new URL("../../android/app/src/main/AndroidManifest.xml", import.meta.url);
const iosInfoPath = new URL("../../ios/App/App/Info.plist", import.meta.url);
const iosPackagePath = new URL("../../ios/App/CapApp-SPM/Package.swift", import.meta.url);

async function appSource() {
  return readFile(appPath, "utf8");
}

test("native preview dependencies and camera/motion permission declarations stay explicit", async () => {
  const [packageText, androidManifest, iosInfo, iosPackage] = await Promise.all([
    readFile(packagePath, "utf8"),
    readFile(androidManifestPath, "utf8"),
    readFile(iosInfoPath, "utf8"),
    readFile(iosPackagePath, "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.dependencies["@capgo/camera-preview"], "8.11.2");
  assert.equal(packageJson.dependencies["@capacitor/motion"], "8.0.1");
  assert.match(androidManifest, /android\.permission\.CAMERA/);
  assert.match(iosInfo, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(iosInfo, /<key>NSMotionUsageDescription<\/key>/);
  assert.match(iosPackage, /\.package\(name: "CapgoCameraPreview"/);
  assert.match(iosPackage, /\.product\(name: "CapgoCameraPreview"/);
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
  assert.match(capture, /머리 기준 · 이 선 아래/);
  assert.match(capture, /발 기준 · 이 선 위/);
  assert.match(capture, /bottom-\[15%\] left-1\/2 top-\[15%\] border-l/);
  assert.doesNotMatch(capture, /left-\[7%\] top-\[8%\]/);
  assert.doesNotMatch(capture, /<svg\b/i);
  assert.doesNotMatch(capture, /silhouette|body.?outline/i);
  assert.match(capture, />다시 촬영</);
  assert.match(capture, /사용하기<\/button>/);
  assert.match(capture, /member, assessmentId, roleLabel, captureViews/);
  assert.match(source, /assessmentId=\{assessmentId\.current\} roleLabel=\{roleLabel\} captureViews/);
  assert.match(capture, /sensor\.isLevel \? "촬영 적합" : "조정 필요"/);
  assert.doesNotMatch(capture, /sensor\.roll > 0 \? "\+"/);
  assert.match(capture, /const captureCompleteIdle = capturesComplete/);
  assert.match(capture, /촬영이 완료되었습니다/);
  assert.match(capture, /!captureCompleteIdle && activePhoto\?\.src/);
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
  assert.match(source, /previewStaged = true/);
  assert.match(source, /사진을 불러오지 못했습니다\. 다시 시도해 주세요/);
  assert.match(source, /사진을 확인한 뒤/);
  assert.match(source, /if \(f\) pickFile\(f\)/);
  assert.doesNotMatch(source.slice(source.indexOf("const usePending = async"), source.indexOf("const handleBack = async")), /startCamera\(\)/);
});

test("direct annotation exposes opt-in guides, ruler, handwriting, colors, re-edit, and a real report-card path", async () => {
  const [source, annotationSource] = await Promise.all([appSource(), readFile(annotationPath, "utf8")]);
  const canvasStart = source.indexOf("function PostureCanvas(");
  const canvasEnd = source.indexOf("function MemberList(", canvasStart);
  const canvas = source.slice(canvasStart, canvasEnd);
  const workspaceStart = source.indexOf("function AssessmentWorkspace(");
  const workspace = source.slice(workspaceStart);

  assert.match(canvas, /initialTool = "pen"/);
  assert.match(canvas, /const \[guideSheet, setGuideSheet\] = useState\(false\)/);
  assert.match(canvas, /\{ k: "ruler", l: "자", I: Move \}/);
  assert.match(canvas, /\{ k: "memo", l: "손메모", I: MessageSquare \}/);
  assert.match(canvas, /tool === "memo"\) \{[\s\S]*memoTapRef\.current =/);
  assert.match(canvas, /if \(memoTapRef\.current\?\.pointerId === e\?\.pointerId\)[\s\S]*setMemoDraft/);
  assert.match(canvas, /fontStyle: "handwriting"/);
  assert.match(canvas, /Nanum Pen Script/);
  const prepareGuideStart = canvas.indexOf("const prepareGuide =");
  const prepareGuideEnd = canvas.indexOf("const saveMemo =", prepareGuideStart);
  assert.ok(prepareGuideStart >= 0 && prepareGuideEnd > prepareGuideStart);
  assert.doesNotMatch(canvas.slice(prepareGuideStart, prepareGuideEnd), /setMarks/);
  assert.doesNotMatch(canvas, /type="color"/);
  assert.match(canvas, /사용자 지정 색상/);
  assert.match(canvas, /customColorPreview/);
  assert.match(canvas, /hitTestAnnotations/);
  assert.match(canvas, /applyAnnotationDrag/);
  assert.match(canvas, /selectedMarkId/);
  assert.match(canvas, /undoStack/);
  assert.match(canvas, /redoStack/);
  assert.match(annotationSource, /#FFD43B/);
  assert.match(annotationSource, /#36C98F/);
  assert.match(annotationSource, /#35B8FF/);
  assert.match(source, /function AnnotationSvgMark/);
  assert.match(source, /function MarkLayer[\s\S]*<AnnotationSvgMark/);
  assert.match(source, /function AssessmentAnnotationOverlay[\s\S]*<AnnotationSvgMark/);
  assert.match(source, /function AssessmentSetFrame[\s\S]*transform: ptf\(photo\)[\s\S]*<AssessmentAnnotationOverlay/);
  assert.match(source, /function AssessmentComparisonLayer[\s\S]*object-cover[\s\S]*transform: ptf\(photo\)[\s\S]*<AssessmentAnnotationOverlay/);
  assert.match(source, /zoomPhoto\?\.src[\s\S]*transform: ptf\(zoomPhoto\)[\s\S]*<AssessmentAnnotationOverlay/);
  assert.match(workspace, /사진 표시 다시 수정하기/);
  assert.match(workspace, /<ResultCardMaker[\s\S]*initialOpen/);
  assert.doesNotMatch(workspace, /이미지 저장 · 연결 예정/);
  assert.match(workspace, /먼저 Before로 사용할 분석을 누르세요/);
  assert.match(workspace, /이제 After로 사용할 분석을 누르세요/);
  assert.match(workspace, /아니오 · 다시 선택/);
  assert.match(workspace, /예 · 비교하기/);
  assert.match(source, /toggleAssessmentFavorite/);
  assert.match(source, /photo\?\.assessmentId === assessmentId \? \{ \.\.\.photo, favorite: Boolean\(favorite\) \}/);
  assert.match(workspace, /즐겨찾기만 보기/);
  assert.doesNotMatch(source, /회원 즐겨찾기/);
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

test("schedule detail uses three final statuses and native speech recognition owns the microphone", async () => {
  const source = await appSource();
  const scheduleStart = source.indexOf("function ScheduleForm(");
  const scheduleEnd = source.indexOf("function ScheduleQueueSheet(", scheduleStart);
  const schedule = source.slice(scheduleStart, scheduleEnd);
  const voiceStart = source.indexOf("function VoiceNote(");
  const voiceEnd = source.indexOf("function NoteForm(", voiceStart);
  const voice = source.slice(voiceStart, voiceEnd);

  assert.match(schedule, /\{ k: "done", l: "출석" \}, \{ k: "noshow", l: "노쇼" \}, \{ k: "cancel", l: "취소" \}/);
  assert.doesNotMatch(schedule, /\{ k: "booked", l: "예정" \}/);
  assert.match(schedule, /activeAttendee\.status !== "booked"/);
  assert.match(schedule, /"booked", activeMemberId/);
  assert.match(schedule, /처리 되돌리기/);
  assert.doesNotMatch(schedule, /출석·노쇼·취소 중 하나를 선택하면/);
  assert.doesNotMatch(schedule, /AI 수업 시퀀스 추천|추천 생성|Provider/);
  assert.match(schedule, /grid grid-cols-2 gap-2/);
  assert.match(schedule, /> 말하기<\/button>/);
  assert.match(schedule, /> 직접입력<\/button>/);
  assert.match(schedule, />노코멘트<\/button>/);
  assert.match(schedule, />나중에<\/button>/);
  assert.match(schedule, />닫기<\/button>/);
  assert.match(source, /const timeOf = \(stamp\) =>/);
  assert.match(voice, /if \(!NS\) \{[\s\S]*await prepareMedia\(\)/);
  assert.match(voice, /Android SpeechRecognizer와 MediaRecorder가 동시에 마이크를 잡으면/);
});

test("draft restore rejects records explicitly owned by another member", async () => {
  const source = await appSource();
  const analyzerStart = source.indexOf("function PoseAnalyzer(");
  const workspaceStart = source.indexOf("function AssessmentWorkspace(", analyzerStart);
  const analyzer = source.slice(analyzerStart, workspaceStart);

  assert.match(analyzer, /!pose\.memberId \|\| pose\.memberId === member\?\.id/);
  assert.match(analyzer, /photo\?\.memberId && photo\.memberId !== member\?\.id/);
});

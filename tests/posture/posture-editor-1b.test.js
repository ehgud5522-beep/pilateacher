import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ANNOTATION_PRESET_COLORS,
  HANDWRITING_SIZE_OPTIONS,
  closestHandwritingWidth,
  normalizeAnnotationColor,
} from "../../src/features/posture/posture-annotations.js";
import {
  LOCAL_PHOTO_NOTICE_MESSAGE,
  claimLocalPhotoNotice,
} from "../../src/features/posture/photo-storage-notice.js";

const appPath = new URL("../../src/App.jsx", import.meta.url);
const appSource = () => readFile(appPath, "utf8");

test("preset palette exposes ten immediate colors and keeps custom normalization", () => {
  assert.equal(ANNOTATION_PRESET_COLORS.length, 10);
  assert.deepEqual(ANNOTATION_PRESET_COLORS.map((item) => item.label), [
    "빨간색", "주황색", "노란색", "초록색", "민트색",
    "하늘색", "파란색", "보라색", "흰색", "검정색",
  ]);
  assert.equal(normalizeAnnotationColor("#1af"), "#11AAFF");
  assert.equal(normalizeAnnotationColor("#123456"), "#123456");
});

test("handwriting size uses the existing width field for backward compatibility", () => {
  assert.deepEqual(HANDWRITING_SIZE_OPTIONS.map((option) => option.value), [2, 4, 6]);
  assert.equal(closestHandwritingWidth(undefined), 4);
  assert.equal(closestHandwritingWidth(2.4), 2);
  assert.equal(closestHandwritingWidth(5.5), 6);
});

test("local photo warning is claimed once and uses the required recovery copy", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(claimLocalPhotoNotice(storage), true);
  assert.equal(claimLocalPhotoNotice(storage), false);
  assert.equal(LOCAL_PHOTO_NOTICE_MESSAGE, "현재 원본 사진은 이 기기에 저장됩니다. 앱 삭제, 휴대폰 변경 또는 분실 시 사진을 복구하지 못할 수 있습니다.");
});

test("direct drawing has a compact toolbar, exact preview, and single-photo completion path", async () => {
  const source = await appSource();
  const canvasStart = source.indexOf("function PostureCanvas(");
  const canvasEnd = source.indexOf("function MemberList(", canvasStart);
  const canvas = source.slice(canvasStart, canvasEnd);
  const analyzerStart = source.indexOf("function PoseAnalyzer(");
  const analyzerEnd = source.indexOf("function AssessmentWorkspace(", analyzerStart);
  const analyzer = source.slice(analyzerStart, analyzerEnd);

  assert.match(canvas, /pt-hscroll flex gap-1 overflow-x-auto/);
  assert.match(canvas, /h-11 min-w-\[50px\]/);
  assert.match(canvas, /h-8 w-8 items-center justify-center rounded-full/);
  assert.match(canvas, /min-h-11 items-center gap-1 border-t/);
  assert.match(canvas, /HANDWRITING_SIZE_OPTIONS/);
  assert.match(canvas, /setHandwritingSize/);
  assert.match(canvas, /선택한 손메모 삭제/);
  assert.match(canvas, /최종 이미지 미리보기/);
  assert.match(canvas, /보이는 모습 그대로 저장·공유됩니다/);
  assert.match(canvas, /runPreviewExport\(true\)/);
  assert.match(canvas, /runPreviewExport\(false\)/);
  assert.match(canvas, /canvasFromPreviewUrl\(exportPreview\.url\)/);
  assert.match(canvas, /fetch\(exportPreview\.url\)\.then\(\(response\) => response\.blob\(\)\)/);
  assert.match(canvas, /exportCanvas\(canvas, exportPreview\.filename, "PilaTeacher 사진 기록", saveOnly, exactBlob\)/);
  assert.match(canvas, /이미지 저장/);
  assert.match(canvas, />공유<\/button>/);

  assert.match(source, /startCapture\("partial", \["custom"\]\)/);
  assert.match(analyzer, /const capturesComplete = captureViews\.every/);
  assert.match(analyzer, /const willComplete = captureViews\.every/);
  assert.match(analyzer, /const finalized = await onSaved\?\./);
});

test("save failure keeps editor state and manual results omit AI-only cards", async () => {
  const source = await appSource();
  const canvasStart = source.indexOf("function PostureCanvas(");
  const canvasEnd = source.indexOf("function MemberList(", canvasStart);
  const canvas = source.slice(canvasStart, canvasEnd);
  const workspaceStart = source.indexOf("function AssessmentWorkspace(");
  const workspace = source.slice(workspaceStart);

  assert.match(canvas, /if \(stored === false\) throw/);
  assert.match(canvas, /표시를 저장하지 못했습니다\. 현재 편집 내용은 유지됩니다/);
  const saveHandler = canvas.slice(canvas.indexOf("const stored = await onSave"), canvas.indexOf("사진에 등록", canvas.indexOf("const stored = await onSave")));
  assert.match(saveHandler, /initialMarks\.current/);
  assert.match(saveHandler, /onClose\(\)/);
  assert.match(saveHandler, /catch \(error\)/);

  assert.match(workspace, /const selectedIsManualResult = \["draw", "manual"\]/);
  assert.match(workspace, /selectedIsManualResult \? "사진 기록" : "분석 결과"/);
  assert.match(workspace, /!selectedIsManualResult && selected\?\.status === "completed"/);
  assert.match(workspace, /!selectedIsManualResult && <button type="button" onClick=\{\(\) => openReportForSet\(selected\)\}/);
  assert.match(workspace, /Before \/ After 비교/);
  assert.match(workspace, /screen === "history"/);
});

test("photo notice is emitted only after successful persistence and backup copy is explicit", async () => {
  const source = await appSource();
  const saveStart = source.indexOf("const saveCaptureDraft = async (memberId, input)");
  const saveEnd = source.indexOf("const completeAssessment =", saveStart);
  const saveCapture = source.slice(saveStart, saveEnd);
  assert.match(saveCapture, /const stored = await savePhotos/);
  assert.match(saveCapture, /if \(!stored\)[\s\S]*return false/);
  assert.ok(saveCapture.indexOf("showLocalPhotoWarningOnce()") > saveCapture.indexOf("if (!stored)"));
  assert.match(source, /‘사진 포함 호환 백업’을 선택한 경우에만 JSON 파일에 사진이 포함됩니다/);
  assert.match(source, /인계 코드는 위 ‘사진도 함께 넘기기’를 선택해야 사진이 포함됩니다/);
});

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve("node_modules/@capgo/camera-preview");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "8.11.2") throw new Error(`[camera-h6] expected 8.11.2, found ${packageJson.version}`);

const controllerPath = path.join(packageRoot, "ios/Sources/CapgoCameraPreviewPlugin/CameraController.swift");
const pluginPath = path.join(packageRoot, "ios/Sources/CapgoCameraPreviewPlugin/Plugin.swift");
let controller = await readFile(controllerPath, "utf8");
let plugin = await readFile(pluginPath, "utf8");
const marker = "PILATEACHER_H6_PHOTO_OUTPUT_READINESS";

// Older H-6 drafts did not embed their marker in Plugin.swift. Normalize any
// repeated draft methods before applying the canonical, marker-bearing method.
if (plugin.includes("    @objc func getPilaTeacherCameraState(_ call: CAPPluginCall) {")) {
  const first = plugin.indexOf("    @objc func getPilaTeacherCameraState(_ call: CAPPluginCall) {");
  const capture = plugin.indexOf("    @objc func capture(_ call: CAPPluginCall) {", first);
  if (capture < 0) throw new Error("[camera-h6] capture boundary missing while normalizing readiness method");
  plugin = `${plugin.slice(0, first)}${plugin.slice(capture)}`;
  plugin = plugin.replace(/^\s*CAPPluginMethod\(name: "getPilaTeacherCameraState"[^\n]*\n/gm, "");
}

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`[camera-h6] missing ${label}`);
};

const stateDefinition = `    // ${marker}
    struct PilaTeacherPhotoOutputState {
        let outputsPrepared: Bool
        let photoOutputAvailable: Bool
        let photoOutputAttached: Bool
        let photoConnectionAvailable: Bool
        let photoConnectionEnabled: Bool
        let sessionRunning: Bool
        let previewLayerAttached: Bool
        let firstFrameReceived: Bool
    }

    func pilaTeacherPhotoOutputState() -> PilaTeacherPhotoOutputState {
        let output = photoOutput
        let connection = output?.connection(with: .video)
        let outputAttached = output.map { target in
            captureSession?.outputs.contains(where: { $0 === target }) == true
        } ?? false
        return PilaTeacherPhotoOutputState(
            outputsPrepared: outputsPrepared,
            photoOutputAvailable: output != nil,
            photoOutputAttached: outputAttached,
            photoConnectionAvailable: connection != nil,
            photoConnectionEnabled: connection?.isEnabled ?? false,
            sessionRunning: captureSession?.isRunning ?? false,
            previewLayerAttached: previewLayer?.superlayer != nil,
            firstFrameReceived: hasReceivedFirstFrame
        )
    }

`;

if (controller.includes("    func pilaTeacherPhotoOutputState() -> [String: Any] {")) {
  const first = controller.indexOf("    func pilaTeacherPhotoOutputState() -> [String: Any] {");
  const cleanup = controller.indexOf("    func cleanup() {", first);
  if (cleanup < 0) throw new Error("[camera-h6] cleanup boundary missing while normalizing readiness state");
  controller = `${controller.slice(0, first)}${stateDefinition}${controller.slice(cleanup)}`;
}

if (!controller.includes(marker)) {
  requireText(controller, "                self.photoOutput = nil", "safe cleanup photo output");
  controller = controller.replace(
    "                self.photoOutput = nil\n                self.fileVideoOutput = nil",
    `                self.photoOutput = nil
                self.fileVideoOutput = nil
                // H-6: a later start must recreate photo/data outputs after safe teardown.
                self.outputsPrepared = false
                self.hasReceivedFirstFrame = false`,
  );

  requireText(controller, "    func cleanup() {", "cleanup method");
  controller = controller.replace("    func cleanup() {", `${stateDefinition}    func cleanup() {`);
}

if (!plugin.includes(marker)) {
  requireText(plugin, 'CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),', "plugin method list");
  plugin = plugin.replace(
    '        CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),',
    '        CAPPluginMethod(name: "isRunning", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "getPilaTeacherCameraState", returnType: CAPPluginReturnPromise),',
  );

  const method = `    @objc func getPilaTeacherCameraState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let state = self.cameraController.pilaTeacherPhotoOutputState()
            var result = JSObject()
            result["h6Marker"] = "${marker}"
            result["outputsPrepared"] = state.outputsPrepared
            result["photoOutputAvailable"] = state.photoOutputAvailable
            result["photoOutputAttached"] = state.photoOutputAttached
            result["photoConnectionAvailable"] = state.photoConnectionAvailable
            result["photoConnectionEnabled"] = state.photoConnectionEnabled
            result["sessionRunning"] = state.sessionRunning
            result["previewLayerAttached"] = state.previewLayerAttached
            result["firstFrameReceived"] = state.firstFrameReceived
            let preview = self.previewView
            let webView = self.webView
            result["previewAttached"] = preview?.superview != nil
            result["previewX"] = Double(preview?.frame.origin.x ?? 0)
            result["previewY"] = Double(preview?.frame.origin.y ?? 0)
            result["previewWidth"] = Double(preview?.frame.width ?? 0)
            result["previewHeight"] = Double(preview?.frame.height ?? 0)
            result["previewZIndex"] = Double(preview?.layer.zPosition ?? 0)
            result["previewBackgroundAlpha"] = Double(preview?.backgroundColor?.cgColor.alpha ?? 0)
            result["parentBackgroundAlpha"] = Double(preview?.superview?.backgroundColor?.cgColor.alpha ?? 0)
            result["webViewOpaque"] = webView?.isOpaque ?? true
            result["ready"] = state.photoOutputAvailable
                && state.photoOutputAttached
                && state.photoConnectionAvailable
                && state.photoConnectionEnabled
                && state.sessionRunning
                && state.previewLayerAttached
                && (preview?.superview != nil)
                && state.firstFrameReceived
            call.resolve(result)
        }
    }

`;
  requireText(plugin, "    @objc func capture(_ call: CAPPluginCall) {", "capture method");
  plugin = plugin.replace("    @objc func capture(_ call: CAPPluginCall) {", `${method}    @objc func capture(_ call: CAPPluginCall) {`);
}

await writeFile(controllerPath, controller, "utf8");
await writeFile(pluginPath, plugin, "utf8");

for (const expected of [
  marker,
  "self.outputsPrepared = false",
  "self.hasReceivedFirstFrame = false",
  "func pilaTeacherPhotoOutputState() -> PilaTeacherPhotoOutputState",
  'CAPPluginMethod(name: "getPilaTeacherCameraState"',
  "@objc func getPilaTeacherCameraState",
  'result["previewBackgroundAlpha"]',
]) {
  if (!controller.includes(expected) && !plugin.includes(expected)) throw new Error(`[camera-h6] verification failed: ${expected}`);
}

console.log("camera preview H-6 photo output readiness patch verified");

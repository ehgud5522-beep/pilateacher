import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve("node_modules/@capgo/camera-preview");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "8.11.2") throw new Error(`[camera-session-safety] expected 8.11.2, found ${packageJson.version}`);

const controllerPath = path.join(packageRoot, "ios/Sources/CapgoCameraPreviewPlugin/CameraController.swift");
const pluginPath = path.join(packageRoot, "ios/Sources/CapgoCameraPreviewPlugin/Plugin.swift");
let controller = await readFile(controllerPath, "utf8");
let plugin = await readFile(pluginPath, "utf8");
const marker = "PILATEACHER_H5_CAMERA_SESSION_SAFETY";

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`[camera-session-safety] missing ${label}`);
};

if (!controller.includes(marker)) {
  requireText(controller, "    var stopRequestedAfterCapture: Bool = false", "capture stop state");
  controller = controller.replace(
    "    var stopRequestedAfterCapture: Bool = false",
    `    var stopRequestedAfterCapture: Bool = false
    private let pilateacherSessionTeardownQueue = DispatchQueue(label: "com.pilateacher.camera.session-teardown", qos: .userInitiated)
    private var pilateacherCleanupCompletions: [() -> Void] = []
    private var pilateacherCleanupInFlight = false
    private let pilateacherSessionSafetyMarker = "${marker}"`,
  );

  const safeCleanup = `    func requestPilaTeacherSafeCleanup(completion: @escaping () -> Void) {
        let enqueue = {
            self.pilateacherCleanupCompletions.append(completion)
            if self.isCapturingPhoto {
                self.stopRequestedAfterCapture = true
                return
            }
            self.performPilaTeacherSafeCleanupIfNeeded()
        }
        if Thread.isMainThread { enqueue() } else { DispatchQueue.main.async(execute: enqueue) }
    }

    func finishPilaTeacherDeferredCleanup() {
        stopRequestedAfterCapture = false
        performPilaTeacherSafeCleanupIfNeeded()
    }

    private func performPilaTeacherSafeCleanupIfNeeded() {
        guard !pilateacherCleanupInFlight else { return }
        pilateacherCleanupInFlight = true
        cancelPendingFocusExposureRestore()
        configuredVideoFrameRate = nil
        stopBarcodeScanner()
        firstFrameReadyCallback = nil
        sampleBufferCaptureCompletionBlock = nil
        barcodeScannerCallback = nil
        dataOutput?.setSampleBufferDelegate(nil, queue: nil)
        metadataOutput?.setMetadataObjectsDelegate(nil, queue: nil)
        let session = captureSession
        pilateacherSessionTeardownQueue.async { [weak self] in
            guard let self = self else { return }
            if session?.isRunning == true { session?.stopRunning() }
            if let session = session {
                session.beginConfiguration()
                session.inputs.forEach { session.removeInput($0) }
                session.outputs.forEach { session.removeOutput($0) }
                session.commitConfiguration()
            }
            DispatchQueue.main.async {
                NotificationCenter.default.removeObserver(self, name: .AVCaptureDeviceSubjectAreaDidChange, object: nil)
                self.motionManager.stopAccelerometerUpdates()
                self.previewLayer?.removeFromSuperlayer()
                self.previewLayer = nil
                self.gridOverlayView?.removeFromSuperview()
                self.gridOverlayView = nil
                self.focusIndicatorView?.removeFromSuperview()
                self.focusIndicatorView = nil
                self.frontCameraInput = nil
                self.rearCameraInput = nil
                self.audioInput = nil
                self.frontCamera = nil
                self.rearCamera = nil
                self.audioDevice = nil
                self.allDiscoveredDevices = []
                self.dataOutput = nil
                self.metadataOutput = nil
                self.photoOutput = nil
                self.fileVideoOutput = nil
                self.captureSession = nil
                self.currentCameraPosition = nil
                self.pilateacherCleanupInFlight = false
                let completions = self.pilateacherCleanupCompletions
                self.pilateacherCleanupCompletions.removeAll()
                completions.forEach { $0() }
            }
        }
    }

`;
  requireText(controller, "    func cleanup() {", "cleanup method");
  controller = controller.replace("    func cleanup() {", `${safeCleanup}    func cleanup() {`);
  controller = controller.replaceAll(
    "DispatchQueue.main.async { self.cleanup(); self.stopRequestedAfterCapture = false }",
    "DispatchQueue.main.async { self.finishPilaTeacherDeferredCleanup() }",
  );
  await writeFile(controllerPath, controller, "utf8");
}

if (!plugin.includes(marker)) {
  requireText(plugin, "    var previewView: UIView!", "preview view property");
  plugin = plugin.replace(
    "    var previewView: UIView!",
    `    var previewView: UIView!
    private var pilateacherPreviousAudioCategory: AVAudioSession.Category?
    private var pilateacherPreviousAudioMode: AVAudioSession.Mode?
    private var pilateacherPreviousAudioOptions: AVAudioSession.CategoryOptions = []
    private var pilateacherAudioSessionReleased = false
    private let pilateacherSessionSafetyMarker = "${marker}"`,
  );

  requireText(plugin, "    private func mapAudioPermission", "audio permission helper");
  plugin = plugin.replace(
    "    private func mapAudioPermission",
    `    private func releasePilaTeacherAudioSessionForCamera() {
        guard !pilateacherAudioSessionReleased else { return }
        let session = AVAudioSession.sharedInstance()
        pilateacherPreviousAudioCategory = session.category
        pilateacherPreviousAudioMode = session.mode
        pilateacherPreviousAudioOptions = session.categoryOptions
        do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            pilateacherAudioSessionReleased = true
            print("[CameraPreview/PilaTeacher] audio_session_released category=\\(session.category.rawValue) mode=\\(session.mode.rawValue)")
        } catch {
            let nsError = error as NSError
            print("[CameraPreview/PilaTeacher] audio_session_release_failed domain=\\(nsError.domain) code=\\(nsError.code) message=\\(nsError.localizedDescription)")
        }
    }

    private func restorePilaTeacherAudioSessionAfterCamera() {
        guard pilateacherAudioSessionReleased else { return }
        defer {
            pilateacherAudioSessionReleased = false
            pilateacherPreviousAudioCategory = nil
            pilateacherPreviousAudioMode = nil
            pilateacherPreviousAudioOptions = []
        }
        guard let category = pilateacherPreviousAudioCategory,
              let mode = pilateacherPreviousAudioMode else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(category, mode: mode, options: pilateacherPreviousAudioOptions)
            print("[CameraPreview/PilaTeacher] audio_session_restored category=\\(category.rawValue) mode=\\(mode.rawValue)")
        } catch {
            let nsError = error as NSError
            print("[CameraPreview/PilaTeacher] audio_session_restore_failed domain=\\(nsError.domain) code=\\(nsError.code) message=\\(nsError.localizedDescription)")
        }
    }

    private func mapAudioPermission`,
  );

  plugin = plugin.replace(
    `        let beginStart: () -> Void = {
            if (self.cameraController.captureSession?.isRunning ?? false) && !force {`,
    `        let beginStart: () -> Void = {
            if (self.cameraController.captureSession?.isRunning ?? false) && !force {`,
  );
  plugin = plugin.replace(
    `                return
            }

            if let videoStabilizationMode = videoStabilizationMode {`,
    `                return
            }

            self.releasePilaTeacherAudioSessionForCamera()

            if let videoStabilizationMode = videoStabilizationMode {`,
  );
  plugin = plugin.replace(
    `                        self.pendingStartBarcodeScannerOptions = nil
                        call.reject("Failed to set video stabilization mode: \\(error.localizedDescription)")`,
    `                        self.pendingStartBarcodeScannerOptions = nil
                        self.restorePilaTeacherAudioSessionAfterCamera()
                        call.reject("Failed to set video stabilization mode: \\(error.localizedDescription)")`,
  );
  plugin = plugin.replace(
    `                        self.pendingStartBarcodeScannerOptions = nil
                        call.reject(error.localizedDescription)`,
    `                        self.pendingStartBarcodeScannerOptions = nil
                        self.restorePilaTeacherAudioSessionAfterCamera()
                        call.reject(error.localizedDescription)`,
  );

  const stopStart = plugin.indexOf("    @objc func stop(_ call: CAPPluginCall) {");
  const stopEnd = plugin.indexOf("    override public func checkPermissions", stopStart);
  if (stopStart < 0 || stopEnd < 0) throw new Error("[camera-session-safety] stop boundaries missing");
  const safeStop = `    @objc func stop(_ call: CAPPluginCall) {
        let force = call.getBool("force") ?? false
        if !force {
            if self.isInitializing { call.reject("cannot stop camera while initialization is in progress"); return }
            if !self.isInitialized { call.reject("camera not initialized"); return }
        }
        self.cameraController.requestPilaTeacherSafeCleanup { [weak self] in
            guard let self = self else { call.resolve(); return }
            self.cameraController.removeGridOverlay()
            self.previewView?.removeFromSuperview()
            self.previewView = nil
            if let webView = self.webView {
                webView.isOpaque = true
                self.restoreWebViewBackground(webView)
            }
            self.isInitialized = false
            self.isInitializing = false
            NotificationCenter.default.removeObserver(self)
            if self.isGeneratingDeviceOrientationNotifications {
                UIDevice.current.endGeneratingDeviceOrientationNotifications()
                self.isGeneratingDeviceOrientationNotifications = false
            }
            self.restorePilaTeacherAudioSessionAfterCamera()
            print("[CameraPreview/PilaTeacher] preview_stopped")
            call.resolve(["stage": "preview_stopped"])
        }
    }

`;
  plugin = `${plugin.slice(0, stopStart)}${safeStop}${plugin.slice(stopEnd)}`;

  plugin = plugin.replace(
    `            print("[CameraPreview] captureImage callback received")
            DispatchQueue.main.async {
                print("[CameraPreview] Processing capture on main thread")`,
    `            print("[CameraPreview] captureImage callback received")
            DispatchQueue.global(qos: .userInitiated).async {
                autoreleasepool {
                print("[CameraPreview] Processing capture off main thread")`,
  );
  plugin = plugin.replace(
    `                print("[CameraPreview] Resolving capture call immediately")
                call.resolve(result)
            }
        }
    }`,
    `                print("[CameraPreview] Resolving capture call immediately")
                DispatchQueue.main.async { call.resolve(result) }
                }
            }
        }
    }`,
  );

  await writeFile(pluginPath, plugin, "utf8");
}

for (const expected of [
  marker,
  "requestPilaTeacherSafeCleanup",
  "dataOutput?.setSampleBufferDelegate(nil, queue: nil)",
  "session?.stopRunning()",
  "restorePilaTeacherAudioSessionAfterCamera",
  "Processing capture off main thread",
  'call.resolve(["stage": "preview_stopped"])',
]) {
  if (!controller.includes(expected) && !plugin.includes(expected)) throw new Error(`[camera-session-safety] verification failed: ${expected}`);
}

console.log("camera preview H-5 session safety patch verified");

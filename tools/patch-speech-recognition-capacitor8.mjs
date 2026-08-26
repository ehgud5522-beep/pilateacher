import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "node_modules", "@capacitor-community", "speech-recognition");
const packageJsonPath = path.join(packageRoot, "package.json");
const androidPluginPath = path.join(
  packageRoot,
  "android",
  "src",
  "main",
  "java",
  "com",
  "getcapacitor",
  "community",
  "speechrecognition",
  "SpeechRecognition.java",
);
const iosPluginPath = path.join(packageRoot, "ios", "Plugin", "Plugin.swift");
const swiftPackagePath = path.join(packageRoot, "Package.swift");
const expectedVersion = "7.0.1";

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (packageJson.version !== expectedVersion) {
  throw new Error(`Speech Recognition patch expected ${expectedVersion}, found ${packageJson.version}`);
}

let androidSource = await readFile(androidPluginPath, "utf8");
if (!/stopListening\(\);\s*call\.resolve\(\);/.test(androidSource)) {
  const stopPattern = /(public void stop\(final PluginCall call\) \{\s*try \{\s*stopListening\(\);)/;
  if (!stopPattern.test(androidSource)) {
    throw new Error("Speech Recognition Android stop() source changed; patch was not applied");
  }
  androidSource = androidSource.replace(stopPattern, "$1\n            call.resolve();");
  await writeFile(androidPluginPath, androidSource, "utf8");
  console.log("[postinstall] Speech Recognition Android stop() completion patch applied");
} else {
  console.log("[postinstall] Speech Recognition Android stop() completion patch already applied");
}

let iosSource = await readFile(iosPluginPath, "utf8");
if (!iosSource.includes("CAPBridgedPlugin")) {
  const classPattern = /public class SpeechRecognition: CAPPlugin \{/;
  if (!classPattern.test(iosSource)) {
    throw new Error("Speech Recognition iOS plugin source changed; Capacitor 8 bridge patch was not applied");
  }
  iosSource = iosSource.replace(
    classPattern,
    `public class SpeechRecognition: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechRecognition"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSupportedLanguages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise),
    ]`,
  );
  if (!iosSource.includes("import AVFoundation")) {
    iosSource = iosSource.replace("import Foundation", "import Foundation\nimport AVFoundation");
  }
  await writeFile(iosPluginPath, iosSource, "utf8");
  console.log("[postinstall] Speech Recognition iOS Capacitor 8 bridge patch applied");
} else {
  console.log("[postinstall] Speech Recognition iOS Capacitor 8 bridge patch already applied");
}

if (!iosSource.includes('CAPPluginMethod(name: "releaseAudioSession"')) {
  iosSource = iosSource.replace(
    '        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),\n',
    '        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "releaseAudioSession", returnType: CAPPluginReturnPromise),\n',
  );
}

if (!iosSource.includes("private var inputTapInstalled = false")) {
  iosSource = iosSource.replace(
    "    private var recognitionTask: SFSpeechRecognitionTask?\n",
    "    private var recognitionTask: SFSpeechRecognitionTask?\n    private var inputTapInstalled = false\n",
  );
}

if (!iosSource.includes("private func releaseRecognitionAudioSession()")) {
  iosSource = iosSource.replace(
    "    @objc func available(_ call: CAPPluginCall) {\n",
    `    private func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                completion(true)
            case .denied:
                completion(false)
            case .undetermined:
                AVAudioApplication.requestRecordPermission { granted in completion(granted) }
            @unknown default:
                completion(false)
            }
            return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in completion(granted) }
    }

    private func releaseRecognitionAudioSession() {
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        if let engine = audioEngine {
            if engine.isRunning { engine.stop() }
            if inputTapInstalled {
                engine.inputNode.removeTap(onBus: 0)
                inputTapInstalled = false
            }
        }
        recognitionTask = nil
        recognitionRequest = nil
        speechRecognizer = nil
        audioEngine = nil
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            let nsError = error as NSError
            CAPLog.print(
                "SpeechRecognition",
                "releaseAudioSession domain=\\(nsError.domain) code=\\(nsError.code) localizedDescription=\\(nsError.localizedDescription)"
            )
        }
    }

    @objc func releaseAudioSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.releaseRecognitionAudioSession()
            call.resolve([
                "released": true,
                "audioSessionCategory": AVAudioSession.sharedInstance().category.rawValue,
                "audioSessionMode": AVAudioSession.sharedInstance().mode.rawValue
            ])
        }
    }

    @objc func available(_ call: CAPPluginCall) {
`,
  );
}

iosSource = iosSource.replace(
  `        if self.audioEngine != nil {
            if self.audioEngine!.isRunning {
                call.reject(self.messageOngoing)
                return
            }
        }
`,
  `        if self.audioEngine != nil {
            if self.audioEngine!.isRunning {
                call.reject(self.messageOngoing)
                return
            }
            self.releaseRecognitionAudioSession()
        }
`,
);
iosSource = iosSource.replace(
  "        AVAudioSession.sharedInstance().requestRecordPermission { (granted) in\n",
  "        self.requestMicrophonePermission { (granted) in\n",
);
iosSource = iosSource.replace(
  `            let audioSession: AVAudioSession = AVAudioSession.sharedInstance()
            do {
                try audioSession.setCategory(AVAudioSession.Category.playAndRecord, options: AVAudioSession.CategoryOptions.defaultToSpeaker)
                try audioSession.setMode(AVAudioSession.Mode.default)
                do {
                    try audioSession.setActive(true, options: AVAudioSession.SetActiveOptions.notifyOthersOnDeactivation)
                } catch {
                      call.reject("Microphone is already in use by another application.")
                      return
                }
            } catch {

            }
`,
  `            let audioSession: AVAudioSession = AVAudioSession.sharedInstance()
            do {
                try audioSession.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.allowBluetooth, .defaultToSpeaker]
                )
                try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            } catch {
                let nsError = error as NSError
                CAPLog.print(
                    "SpeechRecognition",
                    "start domain=\\(nsError.domain) code=\\(nsError.code) localizedDescription=\\(nsError.localizedDescription)"
                )
                self.releaseRecognitionAudioSession()
                call.reject("Unable to activate the microphone audio session.", nil, error)
                return
            }
`,
);
iosSource = iosSource.replace(
  `                    if result!.isFinal {
                        self.audioEngine!.stop()
                        self.audioEngine?.inputNode.removeTap(onBus: 0)
                        self.notifyListeners("listeningState", data: ["status": "stopped"])
                        self.recognitionTask = nil
                        self.recognitionRequest = nil
                    }
`,
  `                    if result!.isFinal {
                        self.releaseRecognitionAudioSession()
                        self.notifyListeners("listeningState", data: ["status": "stopped"])
                    }
`,
);
iosSource = iosSource.replace(
  `                if error != nil {
                    self.audioEngine!.stop()
                    self.audioEngine?.inputNode.removeTap(onBus: 0)
                    self.recognitionRequest = nil
                    self.recognitionTask = nil
                    self.notifyListeners("listeningState", data: ["status": "stopped"])
                    call.reject(error!.localizedDescription)
                }
`,
  `                if error != nil {
                    self.releaseRecognitionAudioSession()
                    self.notifyListeners("listeningState", data: ["status": "stopped"])
                    call.reject(error!.localizedDescription)
                }
`,
);
iosSource = iosSource.replace(
  `            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { (buffer: AVAudioPCMBuffer, _: AVAudioTime) in
                self.recognitionRequest?.append(buffer)
            }
`,
  `            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { (buffer: AVAudioPCMBuffer, _: AVAudioTime) in
                self.recognitionRequest?.append(buffer)
            }
            self.inputTapInstalled = true
`,
);
iosSource = iosSource.replace(
  `    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: DispatchQoS.QoSClass.default).async {
            if let engine = self.audioEngine, engine.isRunning {
                engine.stop()
                self.recognitionRequest?.endAudio()
                self.notifyListeners("listeningState", data: ["status": "stopped"])
            }
            call.resolve()
        }
    }
`,
  `    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.releaseRecognitionAudioSession()
            self.notifyListeners("listeningState", data: ["status": "stopped"])
            call.resolve()
        }
    }
`,
);
iosSource = iosSource.replace(
  "                    AVAudioSession.sharedInstance().requestRecordPermission { (granted: Bool) in\n",
  "                    self.requestMicrophonePermission { (granted: Bool) in\n",
);
await writeFile(iosPluginPath, iosSource, "utf8");
console.log("[postinstall] Speech Recognition iOS audio-session release patch applied");

const swiftPackage = `// swift-tools-version: 5.9
import PackageDescription

// Compatibility package for @capacitor-community/speech-recognition 7.0.1.
// The upstream package ships CocoaPods metadata only, while this app uses Capacitor SPM.
let package = Package(
    name: "CapacitorCommunitySpeechRecognition",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorCommunitySpeechRecognition",
            targets: ["CapacitorCommunitySpeechRecognition"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CapacitorCommunitySpeechRecognition",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm")
            ],
            path: "ios/Plugin",
            exclude: ["Info.plist", "Plugin.h", "Plugin.m"],
            sources: ["Plugin.swift"])
    ]
)
`;

let currentSwiftPackage = "";
try {
  currentSwiftPackage = await readFile(swiftPackagePath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (currentSwiftPackage !== swiftPackage) {
  await writeFile(swiftPackagePath, swiftPackage, "utf8");
  console.log("[postinstall] Speech Recognition iOS SPM compatibility package written");
} else {
  console.log("[postinstall] Speech Recognition iOS SPM compatibility package already present");
}

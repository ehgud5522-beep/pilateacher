import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve("node_modules/@capgo/capacitor-audio-recorder");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "8.2.7") throw new Error(`[audio-recorder-h5] expected 8.2.7, found ${packageJson.version}`);

const swiftPath = path.join(packageRoot, "ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift");
let source = await readFile(swiftPath, "utf8");
const marker = "PILATEACHER_H5_SESSION_PER_START";

const required = (needle, label) => {
  if (!source.includes(needle)) throw new Error(`[audio-recorder-h5] missing ${label}`);
};

if (!source.includes(marker)) {
  required('private let h4RecordRetryMarker = "PILATEACHER_H4_RECORD_RETRY"', "H-4 base marker");
  source = source.replace(
    `    private var categoryConfigured = false
    private var lastRecorderStopAt: Date?
    private var sessionInterrupted = false
    private let routeStabilizationDelay: TimeInterval = 0.15
    private let recordRetryDelay: TimeInterval = 0.20
    private let maxRecordAttempts = 3
    private let h4RecordRetryMarker = "PILATEACHER_H4_RECORD_RETRY"

    public override func load() {
        super.load()
        configureCategoryOnce()
    }

    private func configureCategoryOnce() {
        guard !categoryConfigured else { return }
        do {
            try audioSession.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.allowBluetooth, .defaultToSpeaker]
            )
            categoryConfigured = true
            CAPLog.print("CapacitorAudioRecorderPlugin", "audioSession category configured once at plugin load")
        } catch {
            logNSError(stage: "configure_category_at_load", error: error as NSError)
        }
    }
`,
    `    private var lastRecorderStopAt: Date?
    private var sessionInterrupted = false
    private let routeStabilizationDelay: TimeInterval = 0.15
    private let recordRetryDelay: TimeInterval = 0.20
    private let maxRecordAttempts = 3
    private let h4RecordRetryMarker = "PILATEACHER_H4_RECORD_RETRY"
    private let h5SessionPerStartMarker = "${marker}"
`,
  );

  source = source.replaceAll("try self.activateAudioSession()", "try self.configureAndActivateAudioSession()");
  source = source.replace(
    '            steps.append(self.diagnosticStep(stage: "category_configured", success: self.categoryConfigured))',
    '            steps.append(self.diagnosticStep(stage: "category_before_start", success: true))',
  );

  const helperStart = source.indexOf("    private func activateAudioSession() throws {");
  const helperEnd = source.indexOf("    private func attemptStartRecording(", helperStart);
  if (helperStart < 0 || helperEnd < 0) throw new Error("[audio-recorder-h5] helper boundaries missing");
  const helpers = `    private func configureAndActivateAudioSession() throws {
        try audioSession.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.allowBluetooth, .defaultToSpeaker]
        )
        let categoryStep = diagnosticStep(stage: "set_category", success: true)
        logDiagnostic(categoryStep)
        do {
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            logNSError(stage: "set_active", error: error as NSError)
            throw error
        }
        logDiagnostic(diagnosticStep(stage: "set_active", success: true))
    }

    private func recordingSettings() -> [String: Any] {
        [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]
    }

    private func newRecorder(prefix: String) throws -> (AVAudioRecorder, URL, Bool, Bool, [String: Any]) {
        let directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent("CapacitorAudioRecorder", isDirectory: true)
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: directoryURL.path, isDirectory: &isDirectory)
        if !exists {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        } else if !isDirectory.boolValue {
            throw NSError(domain: "PilaTeacher.AudioSession", code: 6, userInfo: [NSLocalizedDescriptionKey: "Recorder temporary path is not a directory."])
        }
        let fileURL = directoryURL.appendingPathComponent("\\(prefix)-\\(UUID().uuidString).m4a")
        let existedBefore = FileManager.default.fileExists(atPath: fileURL.path)
        let settings = recordingSettings()
        do {
            let recorder = try AVAudioRecorder(url: fileURL, settings: settings)
            recorder.isMeteringEnabled = true
            let prepared = recorder.prepareToRecord()
            return (recorder, fileURL, existedBefore, prepared, settings)
        } catch {
            let nsError = error as NSError
            CAPLog.print(
                "CapacitorAudioRecorderPlugin",
                "stage=recorder_init fileURL=\\(fileURL.absoluteString) settings=\\(settings) domain=\\(nsError.domain) code=\\(nsError.code) localizedDescription=\\(nsError.localizedDescription)"
            )
            throw NSError(
                domain: nsError.domain,
                code: nsError.code,
                userInfo: [
                    NSLocalizedDescriptionKey: nsError.localizedDescription,
                    "fileURL": fileURL.absoluteString,
                    "recordingSettings": settings
                ]
            )
        }
    }

`;
  source = `${source.slice(0, helperStart)}${helpers}${source.slice(helperEnd)}`;

  source = source.replaceAll(
    `newRecorder(
                bitRate: bitRate,
                sampleRate: sampleRate,
                prefix:`,
    `newRecorder(
                prefix:`,
  );
  source = source.replaceAll(
    `newRecorder(
                bitRate: 8_000,
                sampleRate: 16_000,
                prefix:`,
    `newRecorder(
                prefix:`,
  );

  source = source.replace(
    `        } catch {
            logNSError(stage: "record_start_attempt_\\(attempt)", error: error as NSError)
            retryOrRejectRecording(`,
    `        } catch {
            let nsError = error as NSError
            let diagnostics = diagnosticStep(stage: "recorder_init", success: false, error: nsError, extra: [
                "attempt": attempt,
                "fileURL": nsError.userInfo["fileURL"] as? String ?? "",
                "recordingSettings": nsError.userInfo["recordingSettings"] as? [String: Any] ?? recordingSettings()
            ])
            logDiagnostic(diagnostics)
            logNSError(stage: "record_start_attempt_\\(attempt)", error: nsError)
            retryOrRejectRecording(`,
  );
  source = source.replace(
    `        } catch {
            let nsError = error as NSError
            nextSteps.append(diagnosticStep(stage: "record_start_attempt", success: false, error: nsError, extra: ["attempt": attempt]))
            logNSError(stage: "microphone_test_attempt_\\(attempt)", error: nsError)`,
    `        } catch {
            let nsError = error as NSError
            nextSteps.append(diagnosticStep(stage: "recorder_init", success: false, error: nsError, extra: [
                "attempt": attempt,
                "fileURL": nsError.userInfo["fileURL"] as? String ?? "",
                "recordingSettings": nsError.userInfo["recordingSettings"] as? [String: Any] ?? recordingSettings()
            ]))
            logNSError(stage: "microphone_test_attempt_\\(attempt)", error: nsError)`,
  );
  source = source.replace(
    '            "audioSessionMode": audioSession.mode.rawValue,',
    '            "audioSessionMode": audioSession.mode.rawValue,\n            "audioSessionCategoryOptions": audioSession.categoryOptions.rawValue,',
  );

  await writeFile(swiftPath, source, "utf8");
}

for (const expected of [
  marker,
  "private func configureAndActivateAudioSession() throws",
  "try audioSession.setCategory(",
  "AVSampleRateKey: 44_100.0",
  "AVAudioQuality.medium.rawValue",
  '"audioSessionCategoryOptions": audioSession.categoryOptions.rawValue',
  'prefix: "microphone-test-attempt-\\(attempt)"',
]) required(expected, expected);

if (source.includes("configureCategoryOnce()") || source.includes("categoryConfigured")) {
  throw new Error("[audio-recorder-h5] app-start category configuration still present");
}

console.log("audio recorder H-5 per-start session patch verified");

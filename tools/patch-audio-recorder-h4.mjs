import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve("node_modules/@capgo/capacitor-audio-recorder");
const packageJsonPath = path.join(packageRoot, "package.json");
const swiftPath = path.join(
  packageRoot,
  "ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift",
);
const definitionsPath = path.join(packageRoot, "dist/esm/definitions.d.ts");
const expectedVersion = "8.2.7";
const marker = "PILATEACHER_H4_RECORD_RETRY";

const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
if (pkg.version !== expectedVersion) {
  throw new Error(`Unsupported @capgo/capacitor-audio-recorder version ${pkg.version}; expected ${expectedVersion}`);
}

const replaceBetween = (source, start, end, replacement, label) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Unable to locate ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
};

let source = await readFile(swiftPath, "utf8");
if (!source.includes(marker)) {
  source = source.replace(
    "    private var microphoneTestRecorder: AVAudioRecorder?\n",
    `    private var microphoneTestRecorder: AVAudioRecorder?
    private var categoryConfigured = false
    private var lastRecorderStopAt: Date?
    private var sessionInterrupted = false
    private let routeStabilizationDelay: TimeInterval = 0.15
    private let recordRetryDelay: TimeInterval = 0.20
    private let maxRecordAttempts = 3
    private let h4RecordRetryMarker = "${marker}"

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
  );

  source = replaceBetween(
    source,
    "    @objc func prepareRecording(_ call: CAPPluginCall) {\n",
    "    @objc func startRecording(_ call: CAPPluginCall) {\n",
    `    @objc func prepareRecording(_ call: CAPPluginCall) {
        guard status == .inactive || status == .prepared else {
            call.reject("A recording is already in progress.")
            return
        }
        ensurePermission { granted in
            guard granted else { call.reject("Microphone permission not granted."); return }
            let previousRecorderAlive = self.audioRecorder != nil || self.microphoneTestRecorder != nil
            self.forceCleanupPreviousRecorder(deleteFile: true, deactivate: false)
            do {
                try self.activateAudioSession()
                self.status = .prepared
                let diagnostics = self.diagnosticStep(stage: "prepare_recording", success: true, extra: [
                    "previousRecorderAlive": previousRecorderAlive,
                    "millisecondsSinceLastStop": self.millisecondsSinceLastStop()
                ])
                self.logDiagnostic(diagnostics)
                DispatchQueue.main.asyncAfter(deadline: .now() + self.routeStabilizationDelay) {
                    call.resolve(["diagnostic": diagnostics])
                }
            } catch {
                self.logNSError(stage: "prepare_recording", error: error as NSError)
                self.forceCleanupPreviousRecorder(deleteFile: true, deactivate: true)
                call.reject("Failed to prepare recording.", nil, error)
            }
        }
    }

`,
    "prepareRecording",
  );

  source = replaceBetween(
    source,
    "    @objc func startRecording(_ call: CAPPluginCall) {\n",
    "    @objc func runMicrophoneTest(_ call: CAPPluginCall) {\n",
    `    @objc func startRecording(_ call: CAPPluginCall) {
        guard status == .inactive || status == .prepared else {
            call.reject("A recording is already in progress.")
            return
        }

        ensurePermission { granted in
            guard granted else { call.reject("Microphone permission not granted."); return }
            let wasPrepared = self.status == .prepared
            let previousRecorderAlive = self.audioRecorder != nil || self.microphoneTestRecorder != nil
            self.forceCleanupPreviousRecorder(deleteFile: true, deactivate: false)
            do {
                try self.activateAudioSession()
                let delay = wasPrepared ? 0.0 : self.routeStabilizationDelay
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    self.attemptStartRecording(
                        call,
                        bitRate: call.getDouble("bitRate") ?? 192_000,
                        sampleRate: call.getDouble("sampleRate") ?? 44_100,
                        attempt: 1,
                        previousRecorderAlive: previousRecorderAlive
                    )
                }
            } catch {
                self.logNSError(stage: "start_recording_activate", error: error as NSError)
                self.forceCleanupPreviousRecorder(deleteFile: true, deactivate: true)
                call.reject("Failed to start recording.", nil, error)
            }
        }
    }

`,
    "startRecording",
  );

  source = replaceBetween(
    source,
    "    @objc func runMicrophoneTest(_ call: CAPPluginCall) {\n",
    "    @objc func trimRecording(_ call: CAPPluginCall) {\n",
    `    @objc func runMicrophoneTest(_ call: CAPPluginCall) {
        guard status == .inactive || status == .prepared else {
            call.resolve(["ok": false, "steps": [diagnosticStep(
                stage: "availability",
                success: false,
                error: NSError(domain: "PilaTeacher.AudioSession", code: 4, userInfo: [NSLocalizedDescriptionKey: "A recording is already in progress."])
            )]])
            return
        }

        var steps: [[String: Any]] = []
        ensurePermission { granted in
            guard granted else {
                let error = NSError(domain: "AVAudioApplication.RecordPermission", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission not granted."])
                steps.append(self.diagnosticStep(stage: "permission", success: false, error: error))
                call.resolve(["ok": false, "steps": steps])
                return
            }
            steps.append(self.diagnosticStep(stage: "permission", success: true))
            let previousRecorderAlive = self.audioRecorder != nil || self.microphoneTestRecorder != nil
            self.forceCleanupPreviousRecorder(deleteFile: true, deactivate: false)
            steps.append(self.diagnosticStep(stage: "session_before_start", success: true, extra: [
                "previousRecorderAlive": previousRecorderAlive,
                "millisecondsSinceLastStop": self.millisecondsSinceLastStop()
            ]))
            steps.append(self.diagnosticStep(stage: "category_configured", success: self.categoryConfigured))
            do {
                try self.activateAudioSession()
                steps.append(self.diagnosticStep(stage: "set_active", success: true))
                DispatchQueue.main.asyncAfter(deadline: .now() + self.routeStabilizationDelay) {
                    self.attemptMicrophoneTest(
                        call,
                        steps: steps,
                        attempt: 1,
                        previousRecorderAlive: previousRecorderAlive
                    )
                }
            } catch {
                let nsError = error as NSError
                steps.append(self.diagnosticStep(stage: "set_active", success: false, error: nsError))
                self.logNSError(stage: "set_active", error: nsError)
                self.forceCleanupPreviousRecorder(deleteFile: true, deactivate: true)
                call.resolve(["ok": false, "steps": steps])
            }
        }
    }

`,
    "runMicrophoneTest",
  );

  source = replaceBetween(
    source,
    "    @objc func stopRecording(_ call: CAPPluginCall) {\n",
    "    @objc func cancelRecording(_ call: CAPPluginCall) {\n",
    `    @objc func stopRecording(_ call: CAPPluginCall) {
        if audioRecorder == nil, let url = currentFileURL {
            let result: [String: Any] = ["duration": 0, "uri": url.absoluteString]
            currentFileURL = nil
            unregisterInterruptionObserver()
            deactivateSessionIfNeeded()
            notifyListeners("recordingStopped", data: result)
            call.resolve(result)
            return
        }

        guard let recorder = audioRecorder, status != .inactive else {
            call.reject("No active recording to stop.")
            return
        }
        shouldEmitStoppedEvent = false
        recorder.stop()
        let durationMilliseconds = recorder.currentTime * 1000
        let uri = currentFileURL?.absoluteString ?? ""
        let result: [String: Any] = ["duration": durationMilliseconds, "uri": uri]
        audioRecorder = nil
        lastRecorderStopAt = Date()
        resetRecorder(deleteFile: false)
        deactivateSessionIfNeeded()
        notifyListeners("recordingStopped", data: result)
        call.resolve(result)
    }

`,
    "stopRecording",
  );

  source = replaceBetween(
    source,
    "    @objc func cancelRecording(_ call: CAPPluginCall) {\n",
    "    @objc func getRecordingStatus(_ call: CAPPluginCall) {\n",
    `    @objc func cancelRecording(_ call: CAPPluginCall) {
        shouldEmitStoppedEvent = false
        audioRecorder?.stop()
        audioRecorder = nil
        lastRecorderStopAt = Date()
        resetRecorder(deleteFile: true)
        deactivateSessionIfNeeded()
        call.resolve()
    }

`,
    "cancelRecording",
  );

  source = replaceBetween(
    source,
    "    private func configureAudioSession(options call: CAPPluginCall) throws {\n",
    "    private func registerInterruptionObserver() {\n",
    `    private func activateAudioSession() throws {
        guard categoryConfigured else {
            throw NSError(domain: "PilaTeacher.AudioSession", code: 5, userInfo: [NSLocalizedDescriptionKey: "Audio session category was not configured at plugin load."])
        }
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func recordingSettings(bitRate: Double, sampleRate: Double) -> [String: Any] {
        [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: bitRate,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
    }

    private func newRecorder(bitRate: Double, sampleRate: Double, prefix: String) throws -> (AVAudioRecorder, URL, Bool, Bool, [String: Any]) {
        let directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent("CapacitorAudioRecorder", isDirectory: true)
        if !FileManager.default.fileExists(atPath: directoryURL.path) {
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        }
        let fileURL = directoryURL.appendingPathComponent("\\(prefix)-\\(UUID().uuidString).m4a")
        let existedBefore = FileManager.default.fileExists(atPath: fileURL.path)
        let settings = recordingSettings(bitRate: bitRate, sampleRate: sampleRate)
        let recorder = try AVAudioRecorder(url: fileURL, settings: settings)
        recorder.isMeteringEnabled = true
        let prepared = recorder.prepareToRecord()
        return (recorder, fileURL, existedBefore, prepared, settings)
    }

    private func attemptStartRecording(
        _ call: CAPPluginCall,
        bitRate: Double,
        sampleRate: Double,
        attempt: Int,
        previousRecorderAlive: Bool
    ) {
        do {
            let (recorder, fileURL, existedBefore, prepared, settings) = try newRecorder(
                bitRate: bitRate,
                sampleRate: sampleRate,
                prefix: "recording-attempt-\\(attempt)"
            )
            recorder.delegate = self
            let didRecord = prepared && recorder.record()
            let diagnostics = diagnosticStep(stage: "record_start_attempt", success: didRecord, extra: [
                "attempt": attempt,
                "prepareToRecord": prepared,
                "fileURL": fileURL.absoluteString,
                "fileExistedBefore": existedBefore,
                "previousRecorderAlive": previousRecorderAlive,
                "millisecondsSinceLastStop": millisecondsSinceLastStop(),
                "recordingSettings": settings
            ])
            logDiagnostic(diagnostics)
            guard didRecord else {
                recorder.stop()
                lastRecorderStopAt = Date()
                try? FileManager.default.removeItem(at: fileURL)
                retryOrRejectRecording(
                    call,
                    bitRate: bitRate,
                    sampleRate: sampleRate,
                    attempt: attempt,
                    previousRecorderAlive: previousRecorderAlive
                )
                return
            }
            audioRecorder = recorder
            currentFileURL = fileURL
            status = .recording
            recordingStartDate = Date()
            accumulatedPauseDuration = 0
            pauseStartDate = nil
            shouldEmitStoppedEvent = true
            registerInterruptionObserver()
            call.resolve(["diagnostic": diagnostics])
        } catch {
            logNSError(stage: "record_start_attempt_\\(attempt)", error: error as NSError)
            retryOrRejectRecording(
                call,
                bitRate: bitRate,
                sampleRate: sampleRate,
                attempt: attempt,
                previousRecorderAlive: previousRecorderAlive
            )
        }
    }

    private func retryOrRejectRecording(
        _ call: CAPPluginCall,
        bitRate: Double,
        sampleRate: Double,
        attempt: Int,
        previousRecorderAlive: Bool
    ) {
        guard attempt < maxRecordAttempts else {
            let error = NSError(domain: "PilaTeacher.AudioSession", code: 2, userInfo: [NSLocalizedDescriptionKey: "AVAudioRecorder.record() returned false after 3 attempts."])
            logNSError(stage: "record_start", error: error)
            forceCleanupPreviousRecorder(deleteFile: true, deactivate: true)
            call.reject("Failed to start recording after 3 attempts.", nil, error)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + recordRetryDelay) {
            self.attemptStartRecording(
                call,
                bitRate: bitRate,
                sampleRate: sampleRate,
                attempt: attempt + 1,
                previousRecorderAlive: previousRecorderAlive
            )
        }
    }

    private func attemptMicrophoneTest(
        _ call: CAPPluginCall,
        steps: [[String: Any]],
        attempt: Int,
        previousRecorderAlive: Bool
    ) {
        var nextSteps = steps
        do {
            let (recorder, fileURL, existedBefore, prepared, settings) = try newRecorder(
                bitRate: 8_000,
                sampleRate: 16_000,
                prefix: "microphone-test-attempt-\\(attempt)"
            )
            let prepareStep = diagnosticStep(stage: "prepare_to_record_attempt", success: prepared, extra: [
                "attempt": attempt,
                "prepareToRecord": prepared,
                "fileURL": fileURL.absoluteString,
                "fileExistedBefore": existedBefore,
                "previousRecorderAlive": previousRecorderAlive,
                "millisecondsSinceLastStop": millisecondsSinceLastStop(),
                "recordingSettings": settings
            ])
            nextSteps.append(prepareStep)
            logDiagnostic(prepareStep)
            let didRecord = prepared && recorder.record()
            let recordStep = diagnosticStep(stage: "record_start_attempt", success: didRecord, extra: [
                "attempt": attempt,
                "prepareToRecord": prepared,
                "fileURL": fileURL.absoluteString,
                "fileExistedBefore": existedBefore,
                "previousRecorderAlive": previousRecorderAlive,
                "millisecondsSinceLastStop": millisecondsSinceLastStop(),
                "recordingSettings": settings
            ])
            nextSteps.append(recordStep)
            logDiagnostic(recordStep)
            guard didRecord else {
                recorder.stop()
                lastRecorderStopAt = Date()
                try? FileManager.default.removeItem(at: fileURL)
                retryMicrophoneTest(call, steps: nextSteps, attempt: attempt, previousRecorderAlive: previousRecorderAlive)
                return
            }
            microphoneTestRecorder = recorder
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                recorder.stop()
                let durationMs = Int(max(0, recorder.currentTime) * 1_000)
                let fileSize = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.intValue ?? 0
                self.microphoneTestRecorder = nil
                self.lastRecorderStopAt = Date()
                let success = durationMs > 0 && fileSize > 0
                let error = success ? nil : NSError(domain: "PilaTeacher.AudioSession", code: 3, userInfo: [NSLocalizedDescriptionKey: "The one-second microphone test produced no audio file."])
                let stopStep = self.diagnosticStep(stage: "record_stop", success: success, error: error, extra: [
                    "durationMs": durationMs,
                    "fileSize": fileSize,
                    "fileURL": fileURL.absoluteString,
                    "attempt": attempt
                ])
                nextSteps.append(stopStep)
                self.logDiagnostic(stopStep)
                try? FileManager.default.removeItem(at: fileURL)
                self.deactivateSessionIfNeeded()
                call.resolve(["ok": success, "steps": nextSteps])
            }
        } catch {
            let nsError = error as NSError
            nextSteps.append(diagnosticStep(stage: "record_start_attempt", success: false, error: nsError, extra: ["attempt": attempt]))
            logNSError(stage: "microphone_test_attempt_\\(attempt)", error: nsError)
            retryMicrophoneTest(call, steps: nextSteps, attempt: attempt, previousRecorderAlive: previousRecorderAlive)
        }
    }

    private func retryMicrophoneTest(
        _ call: CAPPluginCall,
        steps: [[String: Any]],
        attempt: Int,
        previousRecorderAlive: Bool
    ) {
        guard attempt < maxRecordAttempts else {
            let error = NSError(domain: "PilaTeacher.AudioSession", code: 2, userInfo: [NSLocalizedDescriptionKey: "AVAudioRecorder.record() returned false after 3 attempts."])
            var finalSteps = steps
            finalSteps.append(diagnosticStep(stage: "record_start", success: false, error: error, extra: ["attempt": attempt]))
            logNSError(stage: "record_start", error: error)
            forceCleanupPreviousRecorder(deleteFile: true, deactivate: true)
            call.resolve(["ok": false, "steps": finalSteps, "domain": error.domain, "code": error.code, "localizedDescription": error.localizedDescription])
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + recordRetryDelay) {
            self.attemptMicrophoneTest(
                call,
                steps: steps,
                attempt: attempt + 1,
                previousRecorderAlive: previousRecorderAlive
            )
        }
    }

    private func forceCleanupPreviousRecorder(deleteFile: Bool, deactivate: Bool) {
        let hadRecorder = audioRecorder != nil || microphoneTestRecorder != nil
        audioRecorder?.stop()
        microphoneTestRecorder?.stop()
        audioRecorder = nil
        microphoneTestRecorder = nil
        if hadRecorder { lastRecorderStopAt = Date() }
        if deleteFile, let url = currentFileURL { try? FileManager.default.removeItem(at: url) }
        currentFileURL = nil
        status = .inactive
        recordingStartDate = nil
        pauseStartDate = nil
        accumulatedPauseDuration = 0
        unregisterInterruptionObserver()
        if deactivate { deactivateSessionIfNeeded() }
    }

    private func millisecondsSinceLastStop() -> Int {
        guard let lastRecorderStopAt else { return -1 }
        return Int(max(0, Date().timeIntervalSince(lastRecorderStopAt) * 1_000))
    }

`,
    "audio session and recorder helpers",
  );

  source = source.replace(
    "        case .began:\n            CAPLog.print(\"CapacitorAudioRecorderPlugin\", \"audioSessionInterruption began\")\n",
    `        case .began:
            sessionInterrupted = true
            CAPLog.print("CapacitorAudioRecorderPlugin", "audioSessionInterruption began")
`,
  );
  source = source.replace(
    "        case .ended:\n            CAPLog.print(\"CapacitorAudioRecorderPlugin\", \"audioSessionInterruption ended\")\n",
    `        case .ended:
            sessionInterrupted = false
            CAPLog.print("CapacitorAudioRecorderPlugin", "audioSessionInterruption ended")
`,
  );
  source = replaceBetween(
    source,
    "        case .ended:\n            sessionInterrupted = false\n",
    "        @unknown default:\n",
    `        case .ended:
            sessionInterrupted = false
            CAPLog.print("CapacitorAudioRecorderPlugin", "audioSessionInterruption ended; waiting for explicit continuation")
            let shouldResume: Bool = {
                guard let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt else { return false }
                return AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume)
            }()
            notifyListeners("recordingInterruptionEnded", data: [
                "shouldResume": shouldResume,
                "message": "녹음이 중단됐어요 · 이어서 말하기"
            ])

`,
    "interruption ended handling",
  );
  source = source.replace(
    '                notifyListeners("recordingInterruptionEnded", data: ["shouldResume": false])',
    '                notifyListeners("recordingInterruptionEnded", data: ["shouldResume": false, "message": "녹음이 중단됐어요 · 이어서 말하기"])',
  );
  source = source.replace(
    '            notifyListeners("recordingInterruptionEnded", data: ["shouldResume": shouldResume])',
    '            notifyListeners("recordingInterruptionEnded", data: ["shouldResume": shouldResume, "message": "녹음이 중단됐어요 · 이어서 말하기"])',
  );
  source = source.replace(
    '                    CAPLog.print("CapacitorAudioRecorderPlugin", "Failed to resume after interruption: \\(error.localizedDescription)")',
    '                    self.logNSError(stage: "interruption_resume", error: error as NSError)',
  );
  source = source.replace(
    '            "routeOutputs": audioSession.currentRoute.outputs.map { "\\($0.portType.rawValue):\\($0.portName)" }\n',
    '            "routeOutputs": audioSession.currentRoute.outputs.map { "\\($0.portType.rawValue):\\($0.portName)" },\n            "sessionInterrupted": sessionInterrupted,\n            "millisecondsSinceLastStop": millisecondsSinceLastStop()\n',
  );
  source = source.replace(
    "    private func logNSError(stage: String, error: NSError) {\n",
    `    private func logDiagnostic(_ payload: [String: Any]) {
        CAPLog.print("CapacitorAudioRecorderPlugin", "diagnostic=\\(payload)")
    }

    private func logNSError(stage: String, error: NSError) {
`,
  );

  await writeFile(swiftPath, source, "utf8");
}

let definitions = await readFile(definitionsPath, "utf8");
definitions = definitions.replace(
  "    prepareRecording(options?: StartRecordingOptions): Promise<void>;",
  "    prepareRecording(options?: StartRecordingOptions): Promise<{ diagnostic?: Record<string, unknown> }>;",
);
definitions = definitions.replace(
  "    startRecording(options?: StartRecordingOptions): Promise<void>;",
  "    startRecording(options?: StartRecordingOptions): Promise<{ diagnostic?: Record<string, unknown> }>;",
);
await writeFile(definitionsPath, definitions, "utf8");

console.log(source.includes(marker)
  ? "audio recorder H-4 retry patch verified"
  : "audio recorder H-4 retry patch failed");

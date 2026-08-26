import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve("node_modules/@capgo/capacitor-audio-recorder");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (packageJson.version !== "8.2.7") throw new Error(`[audio-recorder-h6] expected 8.2.7, found ${packageJson.version}`);

const swiftPath = path.join(packageRoot, "ios/Sources/CapacitorAudioRecorderPlugin/CapacitorAudioRecorderPlugin.swift");
let source = await readFile(swiftPath, "utf8");
const marker = "PILATEACHER_H6_INPUT_FILE_GUARDS";

const required = (needle, label) => {
  if (!source.includes(needle)) throw new Error(`[audio-recorder-h6] missing ${label}`);
};

if (!source.includes(marker)) {
  required('private let h5SessionPerStartMarker = "PILATEACHER_H5_SESSION_PER_START"', "H-5 base marker");
  source = source.replace(
    '    private let h5SessionPerStartMarker = "PILATEACHER_H5_SESSION_PER_START"',
    `    private let h5SessionPerStartMarker = "PILATEACHER_H5_SESSION_PER_START"
    private let h6InputFileGuardsMarker = "${marker}"
    private let inputRouteWaitTimeout: TimeInterval = 1.0
    private let microphoneTestDuration: TimeInterval = 1.5`,
  );

  const startOld = `                let delay = wasPrepared ? 0.0 : self.routeStabilizationDelay
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    self.attemptStartRecording(
                        call,
                        bitRate: call.getDouble("bitRate") ?? 192_000,
                        sampleRate: call.getDouble("sampleRate") ?? 44_100,
                        attempt: 1,
                        previousRecorderAlive: previousRecorderAlive
                    )
                }`;
  required(startOld, "recording start delay");
  source = source.replace(startOld, `                let delay = wasPrepared ? 0.0 : self.routeStabilizationDelay
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    self.waitForInputRoute(timeout: self.inputRouteWaitTimeout) { routeReady in
                        self.logDiagnostic(self.diagnosticStep(stage: "input_route_before_record", success: routeReady))
                        self.attemptStartRecording(
                            call,
                            bitRate: call.getDouble("bitRate") ?? 192_000,
                            sampleRate: call.getDouble("sampleRate") ?? 44_100,
                            attempt: 1,
                            previousRecorderAlive: previousRecorderAlive
                        )
                    }
                }`);

  const testOld = `                DispatchQueue.main.asyncAfter(deadline: .now() + self.routeStabilizationDelay) {
                    self.attemptMicrophoneTest(
                        call,
                        steps: steps,
                        attempt: 1,
                        previousRecorderAlive: previousRecorderAlive
                    )
                }`;
  required(testOld, "microphone test delay");
  source = source.replace(testOld, `                DispatchQueue.main.asyncAfter(deadline: .now() + self.routeStabilizationDelay) {
                    self.waitForInputRoute(timeout: self.inputRouteWaitTimeout) { routeReady in
                        var routeSteps = steps
                        let routeStep = self.diagnosticStep(stage: "input_route_before_test", success: routeReady)
                        routeSteps.append(routeStep)
                        self.logDiagnostic(routeStep)
                        self.attemptMicrophoneTest(
                            call,
                            steps: routeSteps,
                            attempt: 1,
                            previousRecorderAlive: previousRecorderAlive
                        )
                    }
                }`);

  required("    private func attemptStartRecording(", "recording attempt helper");
  const helpers = `    private func waitForInputRoute(timeout: TimeInterval, completion: @escaping (Bool) -> Void) {
        let deadline = Date().addingTimeInterval(timeout)
        func poll() {
            let ready = self.audioSession.isInputAvailable && !self.audioSession.currentRoute.inputs.isEmpty
            if ready || Date() >= deadline {
                completion(ready)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.10, execute: poll)
        }
        poll()
    }

    private func recordingFileState(_ url: URL?) -> (exists: Bool, bytes: Int) {
        guard let url = url else { return (false, 0) }
        let exists = FileManager.default.fileExists(atPath: url.path)
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
        return (exists, bytes)
    }

    private func collectMicrophoneTestLevels(
        recorder: AVAudioRecorder,
        sample: Int,
        steps: [[String: Any]],
        completion: @escaping ([[String: Any]]) -> Void
    ) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.20) {
            recorder.updateMeters()
            let power = recorder.averagePower(forChannel: 0)
            var nextSteps = steps
            let step = self.diagnosticStep(stage: "input_level_sample", success: recorder.isRecording && power > -160.0, extra: [
                "sample": sample,
                "isRecording": recorder.isRecording,
                "averagePower": Double(power)
            ])
            nextSteps.append(step)
            self.logDiagnostic(step)
            if sample < 3 {
                self.collectMicrophoneTestLevels(recorder: recorder, sample: sample + 1, steps: nextSteps, completion: completion)
            } else {
                completion(nextSteps)
            }
        }
    }

`;
  source = source.replace("    private func attemptStartRecording(", `${helpers}    private func attemptStartRecording(`);

  const stopOld = `        recorder.stop()
        let durationMilliseconds = recorder.currentTime * 1000
        let uri = currentFileURL?.absoluteString ?? ""
        let result: [String: Any] = ["duration": durationMilliseconds, "uri": uri]
        audioRecorder = nil`;
  required(stopOld, "normal recording stop");
  source = source.replace(stopOld, `        let durationMilliseconds = recorder.currentTime * 1000
        recorder.stop()
        let fileState = recordingFileState(currentFileURL)
        let uri = currentFileURL?.absoluteString ?? ""
        let result: [String: Any] = [
            "duration": durationMilliseconds,
            "uri": uri,
            "fileExists": fileState.exists,
            "fileBytes": fileState.bytes
        ]
        logDiagnostic(diagnosticStep(stage: "record_stop", success: fileState.exists && fileState.bytes > 0, extra: [
            "durationMs": durationMilliseconds,
            "fileExists": fileState.exists,
            "fileBytes": fileState.bytes,
            "fileURL": uri
        ]))
        audioRecorder = nil`);

  const recoveryOld = `            let result: [String: Any] = ["duration": 0, "uri": url.absoluteString]
            currentFileURL = nil`;
  required(recoveryOld, "recording stop recovery");
  source = source.replace(recoveryOld, `            let fileState = recordingFileState(url)
            let result: [String: Any] = [
                "duration": 0,
                "uri": url.absoluteString,
                "fileExists": fileState.exists,
                "fileBytes": fileState.bytes
            ]
            logDiagnostic(diagnosticStep(stage: "record_stop_recovered", success: fileState.exists && fileState.bytes > 0, extra: [
                "fileExists": fileState.exists,
                "fileBytes": fileState.bytes,
                "fileURL": url.absoluteString
            ]))
            currentFileURL = nil`);

  const testStopOld = `            microphoneTestRecorder = recorder
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
            }`;
  required(testStopOld, "one-second microphone test stop");
  source = source.replace(testStopOld, `            microphoneTestRecorder = recorder
            collectMicrophoneTestLevels(recorder: recorder, sample: 1, steps: nextSteps) { sampledSteps in
                let remaining = max(0, self.microphoneTestDuration - 0.60)
                DispatchQueue.main.asyncAfter(deadline: .now() + remaining) {
                    let durationMs = Int(max(0, recorder.currentTime) * 1_000)
                    recorder.stop()
                    let fileState = self.recordingFileState(fileURL)
                    self.microphoneTestRecorder = nil
                    self.lastRecorderStopAt = Date()
                    let success = durationMs > 0 && fileState.exists && fileState.bytes > 0
                    let error = success ? nil : NSError(domain: "PilaTeacher.AudioSession", code: 3, userInfo: [NSLocalizedDescriptionKey: "The 1.5-second microphone test produced a zero-byte or missing audio file."])
                    let stopStep = self.diagnosticStep(stage: "record_stop", success: success, error: error, extra: [
                        "durationMs": durationMs,
                        "fileExists": fileState.exists,
                        "fileBytes": fileState.bytes,
                        "fileURL": fileURL.absoluteString,
                        "attempt": attempt
                    ])
                    var finalSteps = sampledSteps
                    finalSteps.append(stopStep)
                    self.logDiagnostic(stopStep)
                    try? FileManager.default.removeItem(at: fileURL)
                    self.deactivateSessionIfNeeded()
                    call.resolve(["ok": success, "steps": finalSteps, "fileExists": fileState.exists, "fileBytes": fileState.bytes])
                }
            }`);

  await writeFile(swiftPath, source, "utf8");
}

for (const expected of [
  marker,
  "private func waitForInputRoute",
  "input_route_before_record",
  "input_route_before_test",
  "private func collectMicrophoneTestLevels",
  'stage: "input_level_sample"',
  '"averagePower": Double(power)',
  '"fileExists": fileState.exists',
  '"fileBytes": fileState.bytes',
  "The 1.5-second microphone test produced a zero-byte or missing audio file.",
]) required(expected, expected);

if (source.includes("The one-second microphone test produced no audio file.")) {
  throw new Error("[audio-recorder-h6] old one-second microphone test remains");
}

console.log("audio recorder H-6 input and file guards patch verified");

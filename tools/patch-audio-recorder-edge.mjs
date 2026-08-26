import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageRoot = path.join(root, "node_modules", "@capgo", "capacitor-audio-recorder");
const expectedVersion = "8.2.7";
const installedVersion = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
if (installedVersion !== expectedVersion) {
  throw new Error(`Audio Recorder patch expected ${expectedVersion}, found ${installedVersion}`);
}
const files = {
  android: path.join(packageRoot, "android", "src", "main", "java", "app", "capgo", "audiorecorder", "CapacitorAudioRecorderPlugin.java"),
  ios: path.join(packageRoot, "ios", "Sources", "CapacitorAudioRecorderPlugin", "CapacitorAudioRecorderPlugin.swift"),
  definitions: path.join(packageRoot, "dist", "esm", "definitions.d.ts"),
  web: path.join(packageRoot, "dist", "esm", "web.js"),
};

const replaceOnce = (source, before, after, label) => {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`audio recorder patch anchor missing: ${label}`);
  return source.replace(before, after);
};

function patchAndroid(source) {
  let next = source;
  next = replaceOnce(next,
    "import android.media.MediaRecorder;\n",
    "import android.media.MediaCodec;\nimport android.media.MediaExtractor;\nimport android.media.MediaFormat;\nimport android.media.MediaMuxer;\nimport android.media.MediaRecorder;\n",
    "android media imports");
  next = replaceOnce(next,
    "import java.text.SimpleDateFormat;\n",
    "import java.nio.ByteBuffer;\nimport java.text.SimpleDateFormat;\n",
    "android byte buffer import");
  next = replaceOnce(next,
    "        INACTIVE,\n        RECORDING,\n",
    "        INACTIVE,\n        PREPARED,\n        RECORDING,\n",
    "android prepared status");
  next = replaceOnce(next,
    "    @PluginMethod\n    public void startRecording(PluginCall call) {\n        if (status != RecordingStatus.INACTIVE) {\n",
    `    @PluginMethod
    public void prepareRecording(PluginCall call) {
        if (status == RecordingStatus.PREPARED && mediaRecorder != null) {
            call.resolve();
            return;
        }
        if (status != RecordingStatus.INACTIVE) {
            call.reject("Recording already in progress.");
            return;
        }
        if (!ensurePermission(call)) return;
        int bitRate = call.getInt("bitRate", 192000);
        int sampleRate = call.getInt("sampleRate", 44100);
        try {
            prepareRecorder(bitRate, sampleRate);
            status = RecordingStatus.PREPARED;
            call.resolve();
        } catch (IOException ex) {
            releaseRecorder();
            call.reject("Unable to prepare recording.", ex);
        }
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (status == RecordingStatus.RECORDING || status == RecordingStatus.PAUSED) {
`,
    "android prepare method");
  next = replaceOnce(next,
    "        try {\n            prepareRecorder(bitRate, sampleRate);\n            mediaRecorder.start();\n",
    "        try {\n            if (status != RecordingStatus.PREPARED || mediaRecorder == null) prepareRecorder(bitRate, sampleRate);\n            mediaRecorder.start();\n",
    "android reuse prepared recorder");
  next = replaceOnce(next,
    "    @PluginMethod\n    public void pauseRecording(PluginCall call) {\n",
    `    @PluginMethod
    public void trimRecording(PluginCall call) {
        String rawUri = call.getString("uri", "");
        long startMs = Math.max(0L, call.getLong("startMs", 0L));
        long endMs = Math.max(startMs, call.getLong("endMs", 0L));
        try {
            File input = new File(Uri.parse(rawUri).getPath());
            if (!input.exists() || endMs <= startMs) {
                call.reject("Invalid trim range.");
                return;
            }
            File trimmed = new File(input.getParentFile(), input.getName().replace(".m4a", "-trimmed.m4a"));
            trimAudioFile(input, trimmed, startMs * 1000L, endMs * 1000L);
            JSObject result = new JSObject();
            result.put("uri", Uri.fromFile(trimmed).toString());
            result.put("duration", endMs - startMs);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Unable to trim recording.", ex);
        }
    }

    @PluginMethod
    public void pauseRecording(PluginCall call) {
`,
    "android trim method");
  next = replaceOnce(next,
    "    private void releaseRecorder() {\n",
    `    private void trimAudioFile(File input, File output, long startUs, long endUs) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        boolean muxerStarted = false;
        try {
            extractor.setDataSource(input.getAbsolutePath());
            int sourceTrack = -1;
            MediaFormat format = null;
            for (int index = 0; index < extractor.getTrackCount(); index++) {
                MediaFormat candidate = extractor.getTrackFormat(index);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    sourceTrack = index;
                    format = candidate;
                    break;
                }
            }
            if (sourceTrack < 0 || format == null) throw new IOException("Audio track missing.");
            extractor.selectTrack(sourceTrack);
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int targetTrack = muxer.addTrack(format);
            muxer.start();
            muxerStarted = true;
            int maxInput = format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE) ? format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) : 262144;
            ByteBuffer buffer = ByteBuffer.allocateDirect(Math.max(65536, maxInput));
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long firstWrittenUs = -1L;
            int written = 0;
            while (true) {
                long sampleTime = extractor.getSampleTime();
                if (sampleTime < 0 || sampleTime >= endUs) break;
                if (sampleTime < startUs) {
                    if (!extractor.advance()) break;
                    continue;
                }
                buffer.clear();
                int size = extractor.readSampleData(buffer, 0);
                if (size < 0) break;
                if (firstWrittenUs < 0) firstWrittenUs = sampleTime;
                info.set(0, size, Math.max(0L, sampleTime - firstWrittenUs), extractor.getSampleFlags());
                muxer.writeSampleData(targetTrack, buffer, info);
                written += 1;
                if (!extractor.advance()) break;
            }
            if (written == 0) throw new IOException("Trim produced no audio samples.");
        } finally {
            extractor.release();
            if (muxer != null) {
                if (muxerStarted) {
                    try { muxer.stop(); } catch (RuntimeException ignored) {}
                }
                muxer.release();
            }
        }
    }

    private void releaseRecorder() {
`,
    "android trim helper");
  return next;
}

function patchIos(source) {
  if (
    source.includes("    @objc func runMicrophoneTest(_ call: CAPPluginCall) {")
    && source.includes("    private func diagnosticStep(")
    && source.includes("AVAudioApplication.shared.recordPermission")
    && source.includes("        case prepared = \"PREPARED\"")
  ) {
    return source;
  }
  let next = source.replace(
    'appendingPathComponent("(UUID().uuidString)-trimmed.m4a")',
    String.raw`appendingPathComponent("\(UUID().uuidString)-trimmed.m4a")`,
  );
  next = replaceOnce(next,
    "        CAPPluginMethod(name: \"startRecording\", returnType: CAPPluginReturnPromise),\n",
    "        CAPPluginMethod(name: \"prepareRecording\", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: \"runMicrophoneTest\", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: \"startRecording\", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: \"trimRecording\", returnType: CAPPluginReturnPromise),\n",
    "ios plugin methods");
  next = replaceOnce(next,
    "        case inactive = \"INACTIVE\"\n        case recording = \"RECORDING\"\n",
    "        case inactive = \"INACTIVE\"\n        case prepared = \"PREPARED\"\n        case recording = \"RECORDING\"\n",
    "ios prepared status");
  next = replaceOnce(next,
    "    @objc func startRecording(_ call: CAPPluginCall) {\n        guard status == .inactive else {\n",
    `    @objc func prepareRecording(_ call: CAPPluginCall) {
        if status == .prepared, audioRecorder != nil {
            call.resolve()
            return
        }
        guard status == .inactive else {
            call.reject("A recording is already in progress.")
            return
        }
        ensurePermission { granted in
            guard granted else { call.reject("Microphone permission not granted."); return }
            do {
                try self.configureAudioSession(options: call)
                try self.prepareRecorder(call)
                call.resolve()
            } catch {
                self.resetRecorder(deleteFile: true)
                call.reject("Failed to prepare recording.", nil, error)
            }
        }
    }

    @objc func startRecording(_ call: CAPPluginCall) {
        guard status == .inactive || status == .prepared else {
`,
    "ios prepare method");
  next = replaceOnce(next,
    "    private var interruptionObserver: NSObjectProtocol?\n",
    "    private var interruptionObserver: NSObjectProtocol?\n    private var microphoneTestRecorder: AVAudioRecorder?\n",
    "ios microphone test recorder");
  if (!next.includes("    @objc func runMicrophoneTest(_ call: CAPPluginCall) {")) {
    next = replaceOnce(next,
    "    @objc func pauseRecording(_ call: CAPPluginCall) {\n",
    `    @objc func runMicrophoneTest(_ call: CAPPluginCall) {
        var steps: [[String: Any]] = []
        let finishFailure: (String, NSError) -> Void = { stage, error in
            steps.append(self.diagnosticStep(stage: stage, success: false, error: error))
            self.logNSError(stage: stage, error: error)
            self.microphoneTestRecorder?.stop()
            self.microphoneTestRecorder = nil
            self.deactivateSessionIfNeeded()
            call.resolve([
                "ok": false,
                "steps": steps,
                "domain": error.domain,
                "code": error.code,
                "localizedDescription": error.localizedDescription
            ])
        }

        ensurePermission { granted in
            guard granted else {
                finishFailure("permission", NSError(
                    domain: "AVAudioApplication.RecordPermission",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Microphone permission not granted."]
                ))
                return
            }
            steps.append(self.diagnosticStep(stage: "permission", success: true))
            steps.append(self.diagnosticStep(stage: "session_before_start", success: true))

            do {
                try self.audioSession.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.allowBluetooth, .defaultToSpeaker]
                )
                steps.append(self.diagnosticStep(stage: "set_category", success: true))
            } catch {
                finishFailure("set_category", error as NSError)
                return
            }

            do {
                try self.audioSession.setActive(true, options: .notifyOthersOnDeactivation)
                steps.append(self.diagnosticStep(stage: "set_active", success: true))
            } catch {
                finishFailure("set_active", error as NSError)
                return
            }

            do {
                let fileURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent("pilateacher-microphone-test-\\(UUID().uuidString).m4a")
                let recorder = try AVAudioRecorder(url: fileURL, settings: [
                    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                    AVSampleRateKey: 16_000,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderBitRateKey: 8_000,
                    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
                ])
                recorder.prepareToRecord()
                guard recorder.record() else {
                    throw NSError(
                        domain: "PilaTeacher.AudioSession",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "AVAudioRecorder.record() returned false."]
                    )
                }
                self.microphoneTestRecorder = recorder
                steps.append(self.diagnosticStep(stage: "record_start", success: true))

                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    recorder.stop()
                    let durationMs = Int(max(0, recorder.currentTime) * 1_000)
                    let fileSize = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.intValue ?? 0
                    self.microphoneTestRecorder = nil
                    let success = durationMs > 0 && fileSize > 0
                    let error = success ? nil : NSError(
                        domain: "PilaTeacher.AudioSession",
                        code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "The one-second microphone test produced no audio file."]
                    )
                    steps.append(self.diagnosticStep(stage: "record_stop", success: success, error: error, extra: [
                        "durationMs": durationMs,
                        "fileSize": fileSize
                    ]))
                    try? FileManager.default.removeItem(at: fileURL)
                    self.deactivateSessionIfNeeded()
                    call.resolve(["ok": success, "steps": steps])
                }
            } catch {
                finishFailure("record_start", error as NSError)
            }
        }
    }

    @objc func pauseRecording(_ call: CAPPluginCall) {
`,
    "ios microphone test method");
  }
  next = replaceOnce(next,
    "                try self.configureAudioSession(options: call)\n                try self.beginRecording(call)\n",
    "                if self.status != .prepared {\n                    try self.configureAudioSession(options: call)\n                    try self.prepareRecorder(call)\n                }\n                try self.beginRecording()\n",
    "ios reuse prepared recorder");
  next = replaceOnce(next,
    "    @objc func pauseRecording(_ call: CAPPluginCall) {\n",
    `    @objc func trimRecording(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let inputURL = URL(string: uri) else {
            call.reject("Invalid recording URI.")
            return
        }
        let startMs = max(0.0, call.getDouble("startMs") ?? 0.0)
        let endMs = max(startMs, call.getDouble("endMs") ?? 0.0)
        guard endMs > startMs else { call.reject("Invalid trim range."); return }
        let outputURL = inputURL.deletingLastPathComponent().appendingPathComponent("\\(UUID().uuidString)-trimmed.m4a")
        let asset = AVURLAsset(url: inputURL)
        guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
            call.reject("Unable to create audio exporter.")
            return
        }
        exporter.outputURL = outputURL
        exporter.outputFileType = .m4a
        exporter.timeRange = CMTimeRange(
            start: CMTime(seconds: startMs / 1000.0, preferredTimescale: 1000),
            duration: CMTime(seconds: (endMs - startMs) / 1000.0, preferredTimescale: 1000)
        )
        exporter.exportAsynchronously {
            DispatchQueue.main.async {
                if exporter.status == .completed {
                    call.resolve(["uri": outputURL.absoluteString, "duration": endMs - startMs])
                } else {
                    call.reject("Unable to trim recording.", nil, exporter.error)
                }
            }
        }
    }

    @objc func pauseRecording(_ call: CAPPluginCall) {
`,
    "ios trim method");
  next = replaceOnce(next,
    "    private func beginRecording(_ call: CAPPluginCall) throws {\n        let bitRate = call.getDouble(\"bitRate\") ?? 192_000\n",
    "    private func prepareRecorder(_ call: CAPPluginCall) throws {\n        let bitRate = call.getDouble(\"bitRate\") ?? 192_000\n",
    "ios split prepare helper");
  next = replaceOnce(next,
    "        recorder.prepareToRecord()\n        recorder.record()\n\n        audioRecorder = recorder\n        currentFileURL = fileURL\n        status = .recording\n        recordingStartDate = Date()\n        accumulatedPauseDuration = 0\n        pauseStartDate = nil\n        shouldEmitStoppedEvent = true\n\n        registerInterruptionObserver()\n    }\n",
    `        recorder.prepareToRecord()

        audioRecorder = recorder
        currentFileURL = fileURL
        status = .prepared
        accumulatedPauseDuration = 0
        pauseStartDate = nil
        shouldEmitStoppedEvent = true
    }

    private func beginRecording() throws {
        guard let recorder = audioRecorder, status == .prepared, recorder.record() else {
            throw NSError(domain: "CapacitorAudioRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "Prepared recorder failed to start."])
        }
        status = .recording
        recordingStartDate = Date()
        registerInterruptionObserver()
    }
`,
    "ios begin prepared recorder");
  next = replaceOnce(next,
    `    private func configureAudioSession(options call: CAPPluginCall) throws {
        var categoryOptions: AVAudioSession.CategoryOptions = []
        if let options = call.getArray("audioSessionCategoryOptions", String.self) {
            options.forEach {
                if let option = mapCategoryOption(from: $0) {
                    categoryOptions.insert(option)
                }
            }
        } else {
            categoryOptions.insert(.duckOthers)
        }

        let mode = mapSessionMode(from: call.getString("audioSessionMode")) ?? .measurement

        try audioSession.setCategory(.playAndRecord, mode: mode, options: categoryOptions.union([.allowBluetooth, .defaultToSpeaker]))
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
    }
`,
    `    private func configureAudioSession(options call: CAPPluginCall) throws {
        try audioSession.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.allowBluetooth, .defaultToSpeaker]
        )
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
    }
`,
    "ios deterministic audio session");
  next = replaceOnce(next,
    "    private func ensurePermission(completion: @escaping (Bool) -> Void) {\n        switch audioSession.recordPermission {\n",
    `    private func diagnosticStep(
        stage: String,
        success: Bool,
        error: NSError? = nil,
        extra: [String: Any] = [:]
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "stage": stage,
            "success": success,
            "audioSessionCategory": audioSession.category.rawValue,
            "audioSessionMode": audioSession.mode.rawValue,
            "inputAvailable": audioSession.isInputAvailable,
            "otherAudioPlaying": audioSession.isOtherAudioPlaying,
            "secondaryAudioShouldBeSilencedHint": audioSession.secondaryAudioShouldBeSilencedHint,
            "otherSessionOwner": "not_exposed_by_ios",
            "routeInputs": audioSession.currentRoute.inputs.map { "\\($0.portType.rawValue):\\($0.portName)" },
            "routeOutputs": audioSession.currentRoute.outputs.map { "\\($0.portType.rawValue):\\($0.portName)" }
        ]
        if let error {
            payload["domain"] = error.domain
            payload["code"] = error.code
            payload["localizedDescription"] = error.localizedDescription
        }
        extra.forEach { payload[$0.key] = $0.value }
        return payload
    }

    private func logNSError(stage: String, error: NSError) {
        CAPLog.print(
            "CapacitorAudioRecorderPlugin",
            "stage=\\(stage) domain=\\(error.domain) code=\\(error.code) localizedDescription=\\(error.localizedDescription)"
        )
    }

    private func ensurePermission(completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted:
                completion(true)
            case .denied:
                completion(false)
            case .undetermined:
                AVAudioApplication.requestRecordPermission { granted in
                    DispatchQueue.main.async { completion(granted) }
                }
            @unknown default:
                completion(false)
            }
            return
        }
        switch audioSession.recordPermission {
`,
    "ios modern permission request");
  next = replaceOnce(next,
    "    private func microphonePermissionState() -> String {\n        switch audioSession.recordPermission {\n",
    `    private func microphonePermissionState() -> String {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return "granted"
            case .denied: return "denied"
            case .undetermined: return "prompt"
            @unknown default: return "prompt"
            }
        }
        switch audioSession.recordPermission {
`,
    "ios modern permission state");
  next = next.replace(
    `            } catch {
                self.resetRecorder(deleteFile: true)
                call.reject("Failed to prepare recording.", nil, error)
            }
`,
    `            } catch {
                self.logNSError(stage: "prepare_recording", error: error as NSError)
                self.resetRecorder(deleteFile: true)
                call.reject("Failed to prepare recording.", nil, error)
            }
`,
  );
  next = next.replace(
    `            } catch {
                self.resetRecorder(deleteFile: true)
                call.reject("Failed to start recording.", nil, error)
            }
`,
    `            } catch {
                self.logNSError(stage: "start_recording", error: error as NSError)
                self.resetRecorder(deleteFile: true)
                call.reject("Failed to start recording.", nil, error)
            }
`,
  );
  next = next.replace(
    `        case .began:
            // iOS is interrupting (call, Siri, alarm, Bluetooth disconnect).
`,
    `        case .began:
            CAPLog.print("CapacitorAudioRecorderPlugin", "audioSessionInterruption began")
            // iOS is interrupting (call, Siri, alarm, Bluetooth disconnect).
`,
  );
  next = next.replace(
    `        case .ended:
            // Interruption ended. iOS hints whether we should resume via the
`,
    `        case .ended:
            CAPLog.print("CapacitorAudioRecorderPlugin", "audioSessionInterruption ended")
            // Interruption ended. iOS hints whether we should resume via the
`,
  );
  next = next.replace(
    `                } catch {
                    CAPLog.print("CapacitorAudioRecorderPlugin", "Failed to resume after interruption: \(error.localizedDescription)")
                }
`,
    `                } catch {
                    self.logNSError(stage: "interruption_resume", error: error as NSError)
                }
`,
  );
  return next;
}

function patchDefinitions(source) {
  let next = source;
  next = replaceOnce(next,
    "    Inactive = \"INACTIVE\",\n    Recording = \"RECORDING\",\n",
    "    Inactive = \"INACTIVE\",\n    Prepared = \"PREPARED\",\n    Recording = \"RECORDING\",\n",
    "definition prepared status");
  next = replaceOnce(next,
    "    startRecording(options?: StartRecordingOptions): Promise<void>;\n",
    "    prepareRecording(options?: StartRecordingOptions): Promise<void>;\n    runMicrophoneTest(): Promise<{ ok: boolean; steps: Array<Record<string, unknown>> }>;\n    startRecording(options?: StartRecordingOptions): Promise<void>;\n    trimRecording(options: { uri: string; startMs: number; endMs: number }): Promise<StopRecordingResult>;\n",
    "definition edge methods");
  return next;
}

function patchWeb(source) {
  let next = replaceOnce(source,
    "    async startRecording(_options) {\n",
    "    async prepareRecording(_options) {\n        return;\n    }\n    async runMicrophoneTest() {\n        return { ok: false, steps: [{ stage: 'availability', success: false, domain: 'CapacitorWeb', code: -1, localizedDescription: 'Native iOS microphone test is unavailable on web.' }] };\n    }\n    async trimRecording(options) {\n        return { uri: options === null || options === void 0 ? void 0 : options.uri, duration: Math.max(0, Number((options === null || options === void 0 ? void 0 : options.endMs) || 0) - Number((options === null || options === void 0 ? void 0 : options.startMs) || 0)) };\n    }\n    async startRecording(_options) {\n",
    "web edge methods");
  return next;
}

for (const [kind, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) throw new Error(`audio recorder package file missing: ${file}`);
  const current = fs.readFileSync(file, "utf8");
  const next = kind === "android" ? patchAndroid(current)
    : kind === "ios" ? patchIos(current)
      : kind === "definitions" ? patchDefinitions(current)
        : patchWeb(current);
  if (next !== current) fs.writeFileSync(file, next, "utf8");
}

process.stdout.write("audio recorder edge patch applied\n");

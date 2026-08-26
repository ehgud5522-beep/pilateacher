import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageRoot = path.join(root, "node_modules", "@capgo", "capacitor-audio-recorder");
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
  let next = source.replace(
    'appendingPathComponent("(UUID().uuidString)-trimmed.m4a")',
    String.raw`appendingPathComponent("\(UUID().uuidString)-trimmed.m4a")`,
  );
  next = replaceOnce(next,
    "        CAPPluginMethod(name: \"startRecording\", returnType: CAPPluginReturnPromise),\n",
    "        CAPPluginMethod(name: \"prepareRecording\", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: \"startRecording\", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: \"trimRecording\", returnType: CAPPluginReturnPromise),\n",
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
    "    prepareRecording(options?: StartRecordingOptions): Promise<void>;\n    startRecording(options?: StartRecordingOptions): Promise<void>;\n    trimRecording(options: { uri: string; startMs: number; endMs: number }): Promise<StopRecordingResult>;\n",
    "definition edge methods");
  return next;
}

function patchWeb(source) {
  return replaceOnce(source,
    "    async startRecording(_options) {\n",
    "    async prepareRecording(_options) {\n        return;\n    }\n    async trimRecording(options) {\n        return { uri: options === null || options === void 0 ? void 0 : options.uri, duration: Math.max(0, Number((options === null || options === void 0 ? void 0 : options.endMs) || 0) - Number((options === null || options === void 0 ? void 0 : options.startMs) || 0)) };\n    }\n    async startRecording(_options) {\n",
    "web edge methods");
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

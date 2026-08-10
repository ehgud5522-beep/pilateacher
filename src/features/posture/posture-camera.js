export const CAPTURE_TIMER_OPTIONS = Object.freeze([0, 3, 5, 10]);
export const DEFAULT_CAPTURE_TIMER_SECONDS = 3;
export const CAPTURE_TIMER_STORAGE_KEY = "pilateacher.posture.captureTimerSeconds";

export const LEVEL_THRESHOLD_DEG = 2;
export const SENSOR_STATUSES = Object.freeze({
  loading: "loading",
  active: "active",
  permissionRequired: "permission_required",
  denied: "denied",
  unavailable: "unavailable",
  error: "error",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 4) => {
  const scale = 10 ** digits;
  const result = Math.round(value * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
};

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
  return number;
}

export function normalizeCaptureTimer(value, fallback = DEFAULT_CAPTURE_TIMER_SECONDS) {
  if (value === null || value === undefined || value === "") {
    return normalizeCaptureTimer(fallback, DEFAULT_CAPTURE_TIMER_SECONDS);
  }
  const parsed = Number(value);
  if (CAPTURE_TIMER_OPTIONS.includes(parsed)) return parsed;
  const normalizedFallback = Number(fallback);
  return CAPTURE_TIMER_OPTIONS.includes(normalizedFallback)
    ? normalizedFallback
    : DEFAULT_CAPTURE_TIMER_SECONDS;
}

export function readCaptureTimer(
  storage,
  key = CAPTURE_TIMER_STORAGE_KEY,
  fallback = DEFAULT_CAPTURE_TIMER_SECONDS,
) {
  if (!storage || typeof storage.getItem !== "function") return normalizeCaptureTimer(fallback);
  try {
    return normalizeCaptureTimer(storage.getItem(key), fallback);
  } catch {
    return normalizeCaptureTimer(fallback);
  }
}

export function writeCaptureTimer(
  storage,
  value,
  key = CAPTURE_TIMER_STORAGE_KEY,
) {
  const seconds = normalizeCaptureTimer(value);
  if (!storage || typeof storage.setItem !== "function") return seconds;
  try {
    storage.setItem(key, String(seconds));
  } catch {
    // A disabled or full storage must not prevent a capture.
  }
  return seconds;
}

export function base64ToBlob(value, { defaultMimeType = "image/jpeg", decode } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("A non-empty base64 string is required");
  }

  const input = value.trim();
  const dataUrl = input.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (dataUrl && !dataUrl[2]) {
    throw new TypeError("Only base64 data URLs are supported");
  }

  const mimeType = dataUrl?.[1] || defaultMimeType;
  const payload = (dataUrl ? dataUrl[3] : input).replace(/\s+/g, "");
  const decoder = decode || globalThis.atob;
  if (typeof decoder !== "function") {
    throw new Error("No base64 decoder is available");
  }

  const binary = decoder(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function computePreviewGeometry({
  containerX = 0,
  containerY = 0,
  containerWidth,
  containerHeight,
  sourceWidth,
  sourceHeight,
  mode = "contain",
}) {
  const width = positiveNumber(containerWidth, "containerWidth");
  const height = positiveNumber(containerHeight, "containerHeight");
  const mediaWidth = positiveNumber(sourceWidth, "sourceWidth");
  const mediaHeight = positiveNumber(sourceHeight, "sourceHeight");
  if (mode !== "contain" && mode !== "cover") {
    throw new TypeError('mode must be either "contain" or "cover"');
  }

  const scale = mode === "contain"
    ? Math.min(width / mediaWidth, height / mediaHeight)
    : Math.max(width / mediaWidth, height / mediaHeight);
  const renderedWidth = mediaWidth * scale;
  const renderedHeight = mediaHeight * scale;
  const renderedX = Number(containerX) + ((width - renderedWidth) / 2);
  const renderedY = Number(containerY) + ((height - renderedHeight) / 2);
  const visibleX = Math.max(Number(containerX), renderedX);
  const visibleY = Math.max(Number(containerY), renderedY);
  const visibleRight = Math.min(Number(containerX) + width, renderedX + renderedWidth);
  const visibleBottom = Math.min(Number(containerY) + height, renderedY + renderedHeight);
  const visibleWidth = Math.max(0, visibleRight - visibleX);
  const visibleHeight = Math.max(0, visibleBottom - visibleY);

  const cropX = clamp((visibleX - renderedX) / scale, 0, mediaWidth);
  const cropY = clamp((visibleY - renderedY) / scale, 0, mediaHeight);
  const cropWidth = clamp(visibleWidth / scale, 0, mediaWidth - cropX);
  const cropHeight = clamp(visibleHeight / scale, 0, mediaHeight - cropY);

  return Object.freeze({
    mode,
    scale,
    containerRect: Object.freeze({ x: Number(containerX), y: Number(containerY), width, height }),
    sourceSize: Object.freeze({ width: mediaWidth, height: mediaHeight }),
    renderedRect: Object.freeze({
      x: renderedX,
      y: renderedY,
      width: renderedWidth,
      height: renderedHeight,
    }),
    visibleRect: Object.freeze({
      x: visibleX,
      y: visibleY,
      width: visibleWidth,
      height: visibleHeight,
    }),
    sourceCropRect: Object.freeze({ x: cropX, y: cropY, width: cropWidth, height: cropHeight }),
    normalizedCrop: Object.freeze({
      x: cropX / mediaWidth,
      y: cropY / mediaHeight,
      width: cropWidth / mediaWidth,
      height: cropHeight / mediaHeight,
    }),
  });
}

export function createCaptureGeometryMetadata({
  geometry,
  captureWidth,
  captureHeight,
  orientationDegrees = 0,
  previewMirrored = false,
  captureMirrored = false,
  measuredAt = null,
}) {
  if (!geometry?.normalizedCrop || !geometry?.renderedRect || !geometry?.visibleRect) {
    throw new TypeError("A preview geometry result is required");
  }
  const width = positiveNumber(captureWidth, "captureWidth");
  const height = positiveNumber(captureHeight, "captureHeight");
  const crop = geometry.normalizedCrop;

  return Object.freeze({
    schemaVersion: 1,
    aspectMode: geometry.mode,
    preview: Object.freeze({
      containerRect: geometry.containerRect,
      renderedRect: geometry.renderedRect,
      visibleRect: geometry.visibleRect,
      sourceSize: geometry.sourceSize,
      mirrored: Boolean(previewMirrored),
    }),
    capture: Object.freeze({
      width,
      height,
      orientationDegrees: normalizeScreenAngle(orientationDegrees),
      mirrored: Boolean(captureMirrored),
    }),
    crop: Object.freeze({
      normalized: crop,
      pixels: Object.freeze({
        x: round(crop.x * width),
        y: round(crop.y * height),
        width: round(crop.width * width),
        height: round(crop.height * height),
      }),
    }),
    measuredAt,
  });
}

export function mapPreviewPointToCapture(point, metadata, { clampToVisible = true } = {}) {
  const rendered = metadata?.preview?.renderedRect;
  const visible = metadata?.preview?.visibleRect;
  const capture = metadata?.capture;
  if (!rendered || !visible || !capture) throw new TypeError("Capture geometry metadata is required");
  let x = Number(point?.x);
  let y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("A finite preview point is required");

  if (clampToVisible) {
    x = clamp(x, visible.x, visible.x + visible.width);
    y = clamp(y, visible.y, visible.y + visible.height);
  }

  let normalizedX = (x - rendered.x) / rendered.width;
  const normalizedY = (y - rendered.y) / rendered.height;
  if (metadata.preview.mirrored) normalizedX = 1 - normalizedX;
  if (capture.mirrored) normalizedX = 1 - normalizedX;

  return Object.freeze({
    x: round(clamp(normalizedX, 0, 1) * capture.width),
    y: round(clamp(normalizedY, 0, 1) * capture.height),
    normalizedX: round(clamp(normalizedX, 0, 1)),
    normalizedY: round(clamp(normalizedY, 0, 1)),
  });
}

export function normalizeScreenAngle(value) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  const normalized = ((angle % 360) + 360) % 360;
  return (Math.round(normalized / 90) * 90) % 360;
}

export function correctOrientationForScreen({ beta, gamma, screenAngle = 0 }) {
  const rawBeta = Number(beta);
  const rawGamma = Number(gamma);
  if (!Number.isFinite(rawBeta) || !Number.isFinite(rawGamma)) {
    return Object.freeze({ roll: null, pitch: null, screenAngle: normalizeScreenAngle(screenAngle) });
  }

  const angle = normalizeScreenAngle(screenAngle);
  let roll;
  let pitch;
  if (angle === 90) {
    roll = rawBeta;
    pitch = rawGamma - 90;
  } else if (angle === 180) {
    roll = -rawGamma;
    pitch = -rawBeta - 90;
  } else if (angle === 270) {
    roll = -rawBeta;
    pitch = -rawGamma - 90;
  } else {
    roll = rawGamma;
    pitch = rawBeta - 90;
  }

  return Object.freeze({ roll: round(roll, 2), pitch: round(pitch, 2), screenAngle: angle });
}

export function resolveSensorStatus({ supported = true, permission = "granted", hasReading = false, error = null } = {}) {
  if (error) return SENSOR_STATUSES.error;
  if (!supported) return SENSOR_STATUSES.unavailable;
  if (permission === "denied") return SENSOR_STATUSES.denied;
  if (permission === "prompt" || permission === "prompt-with-rationale" || permission === "required") {
    return SENSOR_STATUSES.permissionRequired;
  }
  return hasReading ? SENSOR_STATUSES.active : SENSOR_STATUSES.loading;
}

export function evaluateDeviceLevel({
  roll,
  pitch,
  status = SENSOR_STATUSES.active,
  threshold = LEVEL_THRESHOLD_DEG,
} = {}) {
  const statusMessages = {
    [SENSOR_STATUSES.loading]: "기울기 센서를 확인하고 있습니다.",
    [SENSOR_STATUSES.permissionRequired]: "기울기 센서 권한이 필요합니다.",
    [SENSOR_STATUSES.denied]: "기울기 센서 권한이 거부되었습니다.",
    [SENSOR_STATUSES.unavailable]: "자동 수평 감지를 사용할 수 없습니다.",
    [SENSOR_STATUSES.error]: "기울기 센서를 불러오지 못했습니다.",
  };
  if (status !== SENSOR_STATUSES.active) {
    return Object.freeze({
      status,
      roll: Number.isFinite(Number(roll)) ? Number(roll) : null,
      pitch: Number.isFinite(Number(pitch)) ? Number(pitch) : null,
      isLevel: false,
      code: status,
      message: statusMessages[status] || statusMessages[SENSOR_STATUSES.error],
    });
  }

  const normalizedRoll = Number(roll);
  const normalizedPitch = Number(pitch);
  if (!Number.isFinite(normalizedRoll) || !Number.isFinite(normalizedPitch)) {
    return evaluateDeviceLevel({ status: SENSOR_STATUSES.unavailable, threshold });
  }

  const limit = Math.abs(Number(threshold)) || LEVEL_THRESHOLD_DEG;
  const isLevel = Math.abs(normalizedRoll) <= limit && Math.abs(normalizedPitch) <= limit;
  if (isLevel) {
    return Object.freeze({
      status,
      roll: normalizedRoll,
      pitch: normalizedPitch,
      isLevel: true,
      code: "level",
      message: "좋아요. 수평이 맞습니다.",
    });
  }

  if (Math.abs(normalizedRoll) >= Math.abs(normalizedPitch)) {
    const tiltsLeft = normalizedRoll < 0;
    return Object.freeze({
      status,
      roll: normalizedRoll,
      pitch: normalizedPitch,
      isLevel: false,
      code: tiltsLeft ? "tilted_left" : "tilted_right",
      message: tiltsLeft
        ? "휴대폰을 오른쪽으로 조금 기울여주세요."
        : "휴대폰을 왼쪽으로 조금 기울여주세요.",
    });
  }

  return Object.freeze({
    status,
    roll: normalizedRoll,
    pitch: normalizedPitch,
    isLevel: false,
    code: normalizedPitch < 0 ? "tilted_forward" : "tilted_backward",
    message: normalizedPitch < 0
      ? "휴대폰 상단을 몸 쪽으로 조금 기울여주세요."
      : "휴대폰 상단을 회원 쪽으로 조금 기울여주세요.",
  });
}

export function createCaptureCountdown({
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  onTick = () => {},
  onComplete = () => {},
} = {}) {
  let timerId = null;
  let running = false;
  let remaining = null;
  let generation = 0;

  const clearPending = () => {
    if (timerId !== null) clearTimer(timerId);
    timerId = null;
  };

  const cancel = () => {
    const wasRunning = running;
    generation += 1;
    clearPending();
    running = false;
    remaining = null;
    return wasRunning;
  };

  const start = (value) => {
    if (running) return false;
    const seconds = normalizeCaptureTimer(value);
    generation += 1;
    const activeGeneration = generation;
    remaining = seconds;
    if (seconds === 0) {
      onTick(0);
      remaining = null;
      onComplete();
      return true;
    }

    running = true;
    onTick(remaining);
    const step = () => {
      if (!running || activeGeneration !== generation) return;
      remaining -= 1;
      if (remaining <= 0) {
        running = false;
        remaining = null;
        timerId = null;
        onComplete();
        return;
      }
      onTick(remaining);
      timerId = setTimer(step, 1000);
    };
    timerId = setTimer(step, 1000);
    return true;
  };

  return Object.freeze({
    start,
    cancel,
    dispose: cancel,
    isRunning: () => running,
    getRemaining: () => remaining,
  });
}

export function createIdempotentLifecycle({ startResource, stopResource, isResourceRunning } = {}) {
  if (typeof startResource !== "function" || typeof stopResource !== "function") {
    throw new TypeError("startResource and stopResource functions are required");
  }

  let state = "idle";
  let disposed = false;
  let startPromise = null;
  let stopPromise = null;
  let lastError = null;

  const start = async (options) => {
    if (disposed) throw new Error("Lifecycle has been disposed");
    if (state === "running") return { started: false, state };
    if (startPromise) return startPromise;
    if (stopPromise) await stopPromise;

    startPromise = (async () => {
      state = "starting";
      lastError = null;
      try {
        if (typeof isResourceRunning === "function" && await isResourceRunning()) {
          state = "running";
          return { started: false, state };
        }
        await startResource(options);
        state = "running";
        return { started: true, state };
      } catch (error) {
        lastError = error;
        state = "error";
        throw error;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  };

  const stop = async (reason = "manual") => {
    if (stopPromise) return stopPromise;
    const pendingStop = (async () => {
      if (startPromise) {
        try {
          await startPromise;
        } catch {
          // A failed start has no live resource to retain.
        }
      }
      if (state === "idle") return { stopped: false, state };
      state = "stopping";
      try {
        await stopResource({ reason });
        state = "idle";
        return { stopped: true, state };
      } catch (error) {
        lastError = error;
        state = "error";
        throw error;
      }
    })();
    stopPromise = pendingStop;
    try {
      return await pendingStop;
    } finally {
      if (stopPromise === pendingStop) stopPromise = null;
    }
  };

  const dispose = async () => {
    if (disposed) return { stopped: false, state };
    const result = await stop("dispose");
    disposed = true;
    return result;
  };

  return Object.freeze({
    start,
    stop,
    dispose,
    getState: () => state,
    getLastError: () => lastError,
    isDisposed: () => disposed,
  });
}

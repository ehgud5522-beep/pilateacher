import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const EXPECTED_VERSION = "8.11.2";
const packageRoot = path.resolve("node_modules/@capgo/camera-preview");
const packageJsonPath = path.join(packageRoot, "package.json");
const pluginPath = path.join(
  packageRoot,
  "ios/Sources/CapgoCameraPreviewPlugin/Plugin.swift",
);
const controllerPath = path.join(
  packageRoot,
  "ios/Sources/CapgoCameraPreviewPlugin/CameraController.swift",
);
const marker = "PILATEACHER_IOS_LOCATION_DISABLED";

function fail(message) {
  throw new Error(`[camera-preview-no-location] ${message}`);
}

function readNormalized(filePath) {
  if (!fs.existsSync(filePath)) fail(`missing required file: ${filePath}`);
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) fail(`upstream source changed at ${label}`);
  return text.replace(before, after);
}

function replaceRange(text, start, end, replacement, label) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) fail(`upstream source changed at ${label}`);
  return text.slice(0, startIndex) + replacement + text.slice(endIndex);
}

function assertLocationFree(label, text) {
  const forbidden = [
    "import CoreLocation",
    "CLLocationManager",
    "CLLocation",
    "CLHeading",
    "requestWhenInUseAuthorization",
    "requestAlwaysAuthorization",
    "startUpdatingLocation",
    "NSLocationWhenInUseUsageDescription",
    "NSLocationAlwaysUsageDescription",
    "NSLocationAlwaysAndWhenInUseUsageDescription",
  ];
  const found = forbidden.filter((token) => text.includes(token));
  if (found.length) fail(`${label} still contains: ${found.join(", ")}`);
}

const packageJson = JSON.parse(readNormalized(packageJsonPath));
if (packageJson.version !== EXPECTED_VERSION) {
  fail(`expected @capgo/camera-preview ${EXPECTED_VERSION}, found ${packageJson.version}`);
}

let plugin = readNormalized(pluginPath);
let controller = readNormalized(controllerPath);

if (!plugin.includes(marker)) {
  plugin = replaceRequired(plugin, "import CoreLocation\n", "", "Plugin.swift import");
  plugin = replaceRequired(
    plugin,
    "public class CameraPreview: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {",
    "public class CameraPreview: CAPPlugin, CAPBridgedPlugin {",
    "Plugin.swift class conformance",
  );
  plugin = replaceRequired(
    plugin,
    "    var locationManager: CLLocationManager?\n    var currentLocation: CLLocation?\n    var currentHeading: CLHeading?\n",
    "",
    "Plugin.swift location state",
  );
  plugin = replaceRequired(
    plugin,
    "    private var permissionCallID: String?\n    private var waitingForLocation: Bool = false\n",
    "",
    "Plugin.swift location permission state",
  );
  plugin = replaceRange(
    plugin,
    "    @objc func capture(_ call: CAPPluginCall) {",
    "    private func performCapture(call: CAPPluginCall) {",
    `    // ${marker}: PilaTeacher does not collect or embed GPS metadata.\n` +
      "    @objc func capture(_ call: CAPPluginCall) {\n" +
      "        self.performCapture(call: call)\n" +
      "    }\n\n",
    "Plugin.swift capture flow",
  );
  plugin = replaceRequired(
    plugin,
    "        let withExifLocation = call.getBool(\"withExifLocation\", false)\n        let embedTimestamp = call.getBool(\"embedTimestamp\", false) ?? false\n        let embedLocationRequested = call.getBool(\"embedLocation\", false) ?? false\n        let effectiveEmbedLocation = (withExifLocation ?? false) && embedLocationRequested\n",
    "        let embedTimestamp = call.getBool(\"embedTimestamp\", false) ?? false\n",
    "Plugin.swift capture options",
  );
  plugin = replaceRequired(
    plugin,
    "        print(\"[CameraPreview] Capture params - quality: \\(quality), saveToGallery: \\(saveToGallery), withExifLocation: \\(withExifLocation ?? false), embedTimestamp: \\(embedTimestamp), embedLocation: \\(effectiveEmbedLocation) (requested=\\(embedLocationRequested)), width: \\(width ?? -1), height: \\(height ?? -1), mirrorFrontCamera: \\(mirrorFrontCamera)\")\n        print(\"[CameraPreview] Current location: \\(self.currentLocation?.description ?? \"nil\")\")\n",
    "        print(\"[CameraPreview] Capture params - quality: \\(quality), saveToGallery: \\(saveToGallery), embedTimestamp: \\(embedTimestamp), width: \\(width ?? -1), height: \\(height ?? -1), mirrorFrontCamera: \\(mirrorFrontCamera)\")\n",
    "Plugin.swift capture logging",
  );
  plugin = replaceRequired(
    plugin,
    "        let gpsForThisCapture = (withExifLocation ?? false) ? self.currentLocation : nil\n        self.cameraController.captureImage(width: width, height: height, quality: quality, gpsLocation: gpsForThisCapture, embedTimestamp: embedTimestamp, embedLocation: effectiveEmbedLocation, photoQualityPrioritization: photoQualityPrioritization) { (image, originalPhotoData, _, error) in",
    "        self.cameraController.captureImage(width: width, height: height, quality: quality, embedTimestamp: embedTimestamp, photoQualityPrioritization: photoQualityPrioritization) { (image, originalPhotoData, _, error) in",
    "Plugin.swift controller call",
  );
  plugin = replaceRequired(
    plugin,
    "                // Ensure heading updates are stopped on all exit paths (error, guard failure, or success)\n                defer {\n                    if withExifLocation ?? false {\n                        self.locationManager?.stopUpdatingHeading()\n                        self.currentHeading = nil\n                    }\n                }\n",
    "",
    "Plugin.swift heading cleanup",
  );
  plugin = replaceRequired(
    plugin,
    "                        quality: Int(quality),\n                        location: withExifLocation ? self.currentLocation : nil,\n                        heading: withExifLocation ? self.currentHeading : nil,\n                        originalPhotoData: originalPhotoData",
    "                        quality: Int(quality),\n                        originalPhotoData: originalPhotoData",
    "Plugin.swift EXIF call",
  );
  plugin = replaceRequired(
    plugin,
    "    private func createImageDataWithExif(from image: UIImage, quality: Int, location: CLLocation?, heading: CLHeading?, originalPhotoData: Data?) -> Data? {",
    "    private func createImageDataWithExif(from image: UIImage, quality: Int, originalPhotoData: Data?) -> Data? {",
    "Plugin.swift EXIF signature",
  );
  plugin = replaceRange(
    plugin,
    "        // Add GPS location if available\n",
    "        // Create or update TIFF dictionary for device info and set orientation to Up\n",
    "        // Do not retain GPS metadata from any source image.\n        finalProperties.removeValue(forKey: kCGImagePropertyGPSDictionary as String)\n\n",
    "Plugin.swift GPS metadata",
  );
  plugin = replaceRange(
    plugin,
    "    // MARK: - Capacitor Permissions\n",
    "    private func saveImageDataToGallery(imageData: Data, completion: @escaping (Bool, Error?) -> Void) {",
    "    // Location permission support is intentionally removed for PilaTeacher.\n\n",
    "Plugin.swift location delegates",
  );
}

if (!controller.includes(marker)) {
  controller = replaceRequired(controller, "import CoreLocation\n", "", "CameraController.swift import");
  controller = replaceRequired(
    controller,
    "    func captureImage(width: Int?, height: Int?, quality: Float, gpsLocation: CLLocation?, embedTimestamp: Bool, embedLocation: Bool, photoQualityPrioritization: String, completion: @escaping (UIImage?, Data?, [AnyHashable: Any]?, Error?) -> Void) {",
    `    // ${marker}: capture never receives or embeds location data.\n` +
      "    func captureImage(width: Int?, height: Int?, quality: Float, embedTimestamp: Bool, photoQualityPrioritization: String, completion: @escaping (UIImage?, Data?, [AnyHashable: Any]?, Error?) -> Void) {",
    "CameraController.swift capture signature",
  );
  controller = replaceRequired(
    controller,
    "            if let location = gpsLocation {\n                self.addGPSMetadata(to: image, location: location)\n            }\n\n",
    "",
    "CameraController.swift GPS injection",
  );
  controller = replaceRange(
    controller,
    "            // Draw overlays if either flag is set (timestamp and/or location)\n",
    "            completion(finalImage, photoData, metadata, nil)\n",
    "            if embedTimestamp {\n                let timestamp = self.makeTimestampString(from: photoData, metadata: metadata)\n                finalImage = self.drawTimestamp(on: finalImage, text: timestamp)\n            }\n\n",
    "CameraController.swift overlay",
  );
  controller = replaceRange(
    controller,
    "    /// Draws timestamp and/or location pills at the top-right. Pass nil to skip either line.\n",
    "    func makeTimestampString(from photoData: Data?, metadata: [AnyHashable: Any]?) -> String {",
    "    /// Draws a timestamp pill at the top-right.\n" +
      "    func drawTimestamp(on image: UIImage, text: String) -> UIImage {\n" +
      "        let base = image.fixedOrientation() ?? image\n" +
      "        let size = base.size\n" +
      "        let font = UIFont.systemFont(ofSize: max(10, size.width * 0.035), weight: .semibold)\n" +
      "        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.white]\n" +
      "        let textSize = (text as NSString).size(withAttributes: attributes)\n" +
      "        let padding = CGSize(width: 16, height: 10)\n" +
      "        let box = CGRect(x: size.width - textSize.width - padding.width * 2 - 12, y: 12, width: textSize.width + padding.width * 2, height: textSize.height + padding.height * 2)\n" +
      "        let format = UIGraphicsImageRendererFormat.default()\n" +
      "        format.scale = base.scale\n" +
      "        format.opaque = true\n" +
      "        return UIGraphicsImageRenderer(size: size, format: format).image { context in\n" +
      "            base.draw(in: CGRect(origin: .zero, size: size))\n" +
      "            let path = UIBezierPath(roundedRect: box, cornerRadius: 10)\n" +
      "            context.cgContext.saveGState()\n" +
      "            context.cgContext.setShadow(offset: CGSize(width: 0, height: 2), blur: 6, color: UIColor.black.withAlphaComponent(0.25).cgColor)\n" +
      "            UIColor(white: 0.12, alpha: 0.22).setFill()\n" +
      "            path.fill()\n" +
      "            context.cgContext.restoreGState()\n" +
      "            (text as NSString).draw(at: CGPoint(x: box.minX + padding.width, y: box.minY + padding.height), withAttributes: attributes)\n" +
      "        }\n" +
      "    }\n\n",
    "CameraController.swift timestamp drawing",
  );
  controller = replaceRange(
    controller,
    "    func makeLocationString(from location: CLLocation?",
    "    // Create JPEG data from `image`, merging the original EXIF/GPS/etc. and forcing Orientation=1.\n",
    "",
    "CameraController.swift location string",
  );
  controller = replaceRequired(
    controller,
    "        var metaOut = baseMetadata\n",
    "        var metaOut = baseMetadata\n        metaOut.removeValue(forKey: kCGImagePropertyGPSDictionary as String)\n",
    "CameraController.swift retained GPS metadata",
  );
  controller = replaceRange(
    controller,
    "    func addGPSMetadata(to image: UIImage, location: CLLocation) {",
    "    func resizeImage(image: UIImage, to size: CGSize) -> UIImage? {",
    "",
    "CameraController.swift GPS writer",
  );
}

assertLocationFree("Plugin.swift", plugin);
assertLocationFree("CameraController.swift", controller);
fs.writeFileSync(pluginPath, plugin, "utf8");
fs.writeFileSync(controllerPath, controller, "utf8");
console.log(`[camera-preview-no-location] verified @capgo/camera-preview ${EXPECTED_VERSION}`);

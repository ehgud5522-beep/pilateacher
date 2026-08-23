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

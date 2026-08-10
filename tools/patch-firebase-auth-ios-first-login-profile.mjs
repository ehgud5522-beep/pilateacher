import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules",
  "@capacitor-firebase",
  "authentication",
  "ios",
  "Plugin",
  "FirebaseAuthenticationHelper.swift",
);
const marker = 'result["firstTimeDisplayName"] = displayName';
const before = `        result["additionalUserInfo"] = additionalUserInfoResult ?? NSNull()\n        return result`;
const after = `        result["additionalUserInfo"] = additionalUserInfoResult ?? NSNull()\n        if let displayName = displayName {\n            result["firstTimeDisplayName"] = displayName\n        }\n        return result`;

const source = await readFile(target, "utf8");
if (source.includes(marker)) {
  console.log("[postinstall] Firebase Authentication iOS first-login profile patch already applied");
} else {
  if (!source.includes(before)) {
    throw new Error("Firebase Authentication iOS source changed; first-login profile patch was not applied");
  }
  await writeFile(target, source.replace(before, after), "utf8");
  console.log("[postinstall] Firebase Authentication iOS first-login profile patch applied");
}

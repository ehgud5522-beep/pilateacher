import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getMetadata, ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "pilateacher-dev";
const ORG_A = "org-a";
const ORG_B = "org-b";
const users = {
  owner: "owner-a",
  manager: "manager-a",
  instructor: "instructor-a",
  staff: "staff-a",
  member: "member-a",
  outsider: "owner-b",
};

let testEnv;

function dbFor(userId) {
  return userId ? testEnv.authenticatedContext(userId).firestore() : testEnv.unauthenticatedContext().firestore();
}
function storageFor(userId) {
  return userId ? testEnv.authenticatedContext(userId).storage() : testEnv.unauthenticatedContext().storage();
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "organizations", ORG_A), {
      organizationId: ORG_A,
      name: "A",
      plan: "starter",
      subscriptionStatus: "active",
      aiUsageCount: 0,
    });
    await setDoc(doc(db, "organizations", ORG_B), {
      organizationId: ORG_B,
      name: "B",
      plan: "starter",
      subscriptionStatus: "active",
      aiUsageCount: 0,
    });
    for (const [role, userId] of Object.entries(users)) {
      const organizationId = role === "outsider" ? ORG_B : ORG_A;
      await setDoc(doc(db, "memberships", `${organizationId}_${userId}`), {
        organizationId,
        userId,
        role: role === "outsider" ? "owner" : role,
        status: "active",
      });
      await setDoc(doc(db, "users", userId), { displayName: role });
    }
    await setDoc(doc(db, "clients", "client-member"), {
      organizationId: ORG_A,
      userId: users.member,
      displayName: "Member",
    });
    await setDoc(doc(db, "clients", "client-other"), {
      organizationId: ORG_A,
      userId: "another-member",
      displayName: "Other",
    });
    await setDoc(doc(db, "events", "event-1"), { organizationId: ORG_A, type: "fixture" });
    await setDoc(doc(db, "auditLogs", "audit-1"), { organizationId: ORG_A, action: "fixture" });
    await setDoc(doc(db, "runtimeConfig", "aiRecording"), { status: "normal", reasonCode: "", updatedAt: Timestamp.now() });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await readFile(new URL("../../firestore.foundation.rules", import.meta.url), "utf8"),
    },
    storage: {
      rules: await readFile(new URL("../../storage.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seed();
});

after(async () => {
  await testEnv.cleanup();
});

describe("authentication and organization isolation", () => {
  test("unauthenticated users are denied", async () => {
    await assertFails(getDoc(doc(dbFor(null), "organizations", ORG_A)));
  });

  test("another organization is denied", async () => {
    await assertFails(getDoc(doc(dbFor(users.outsider), "organizations", ORG_A)));
  });

  test("legacy users and backup remain accessible only to the owner", async () => {
    await assertSucceeds(getDoc(doc(dbFor(users.member), "users", users.member)));
    await assertSucceeds(setDoc(doc(dbFor(users.member), "users", users.member, "backup", "latest"), { data: {} }));
    await assertFails(getDoc(doc(dbFor(users.outsider), "users", users.member)));
  });

  test("AI consent is owner-only, scope-limited, and versioned", async () => {
    const consentRef = doc(dbFor(users.member), "users", users.member, "aiConsents", "member_local_1");
    await assertSucceeds(setDoc(consentRef, {
      status: "granted",
      policyVersion: "2026-08-23",
      scopes: ["analyzeBody", "summarizeVoice", "recommendSequence", "generateReport"],
      grantedAt: Timestamp.now(),
      revokedAt: null,
      updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(getDoc(consentRef));
    await assertFails(getDoc(doc(dbFor(users.outsider), "users", users.member, "aiConsents", "member_local_1")));
    await assertFails(setDoc(doc(dbFor(users.member), "users", users.member, "aiConsents", "member_local_2"), {
      status: "granted",
      policyVersion: "old-policy",
      scopes: ["analyzeBody", "exportEveryPhoto"],
      grantedAt: Timestamp.now(),
      revokedAt: null,
      updatedAt: Timestamp.now(),
    }));
  });

  test("photo backup metadata is owner-only and path constrained", async () => {
    const payload = {
      schemaVersion: 1, photoId: "photo-1", memberId: "member-1", assessmentId: "assessment-1",
      bucketKey: "front", view: "front", date: "2026-08-24", width: 1800, height: 1200,
      storagePath: `users/${users.member}/photos/photo-1/image.jpg`,
      thumbnailPath: `users/${users.member}/photos/photo-1/thumb.jpg`,
      imageBytes: 1200, thumbnailBytes: 120, status: "active", record: {}, references: [],
    };
    await assertSucceeds(setDoc(doc(dbFor(users.member), "users", users.member, "photoBackups", "photo-1"), payload));
    await assertFails(getDoc(doc(dbFor(users.outsider), "users", users.member, "photoBackups", "photo-1")));
    await assertFails(setDoc(doc(dbFor(users.member), "users", users.member, "photoBackups", "photo-2"), { ...payload, photoId: "photo-2" }));
  });

  test("photo binaries allow only owner JPEG writes and deny client deletes", async () => {
    const path = `users/${users.member}/photos/photo-1/image.jpg`;
    const ownerRef = ref(storageFor(users.member), path);
    await assertSucceeds(uploadBytes(ownerRef, new Uint8Array([1, 2, 3]), { contentType: "image/jpeg" }));
    await assertSucceeds(getMetadata(ownerRef));
    await assertFails(getMetadata(ref(storageFor(users.outsider), path)));
    await assertFails(uploadBytes(ref(storageFor(users.member), `users/${users.member}/photos/photo-2/image.jpg`), new Uint8Array([1]), { contentType: "image/png" }));
    await assertFails(deleteObject(ownerRef));
  });

  test("remote diagnostics are owner-only, append-only, and bounded", async () => {
    const reportRef = doc(dbFor(users.member), "diagnostics", users.member, "reports", "1724634000000");
    const report = {
      schemaVersion: 1,
      createdAt: "2026-08-26T00:00:00.000Z",
      app: { id: "com.pilateacher.app", version: "1.1.22", build: "37" },
      device: { platform: "android", online: true },
      logs: [{ kind: "voice", event: "failed", code: "no_speech" }],
      logCount: 1,
      uid: users.member,
      uploadedAt: Timestamp.now(),
    };
    await assertSucceeds(setDoc(reportRef, report));
    await assertSucceeds(getDoc(reportRef));
    await assertFails(getDoc(doc(dbFor(users.outsider), "diagnostics", users.member, "reports", "1724634000000")));
    await assertFails(updateDoc(reportRef, { logCount: 0 }));
    await assertFails(setDoc(doc(dbFor(users.member), "diagnostics", users.member, "reports", "bad"), { ...report, transcript: "forbidden" }));
  });

  test("pilot metric attempts contain aggregates only and stay owner-scoped", async () => {
    const metricRef = doc(dbFor(users.member), "pilotMetrics", users.member, "attempts", "audio-safe-1");
    const metric = {
      schemaVersion: 1,
      uid: users.member,
      date: "2026-08-26",
      result: "ok",
      flags: ["tail_dropped"],
      confirmed: false,
      latencyMs: 2340,
      source: "server_audio",
      updatedAt: Timestamp.now(),
    };
    await assertSucceeds(setDoc(metricRef, metric));
    await assertSucceeds(updateDoc(metricRef, { confirmed: true, updatedAt: Timestamp.now() }));
    await assertFails(getDoc(doc(dbFor(users.outsider), "pilotMetrics", users.member, "attempts", "audio-safe-1")));
    await assertFails(setDoc(doc(dbFor(users.member), "pilotMetrics", users.member, "attempts", "bad"), { ...metric, transcript: "forbidden" }));
  });
});

describe("role permissions", () => {
  test("owner can update ordinary organization fields but not billing or AI usage", async () => {
    await assertSucceeds(updateDoc(doc(dbFor(users.owner), "organizations", ORG_A), { name: "Updated" }));
    await assertFails(updateDoc(doc(dbFor(users.owner), "organizations", ORG_A), { plan: "enterprise" }));
    await assertFails(updateDoc(doc(dbFor(users.owner), "organizations", ORG_A), { subscriptionStatus: "cancelled" }));
    await assertFails(updateDoc(doc(dbFor(users.owner), "organizations", ORG_A), { aiUsageCount: 999 }));
  });

  test("manager can create a location", async () => {
    await assertSucceeds(setDoc(doc(dbFor(users.manager), "locations", "location-a"), {
      organizationId: ORG_A,
      name: "Location",
    }));
  });

  test("instructor can create an assessment", async () => {
    await assertSucceeds(setDoc(doc(dbFor(users.instructor), "assessments", "assessment-a"), {
      organizationId: ORG_A,
      clientId: "client-member",
      createdBy: users.instructor,
    }));
  });

  test("staff can create lessons but cannot create assessments", async () => {
    await assertSucceeds(setDoc(doc(dbFor(users.staff), "lessons", "lesson-a"), {
      organizationId: ORG_A,
      status: "scheduled",
    }));
    await assertFails(setDoc(doc(dbFor(users.staff), "assessments", "assessment-staff"), {
      organizationId: ORG_A,
      clientId: "client-member",
    }));
  });

  test("dual-write client and lesson paths allow same-organization staff only", async () => {
    const staffDb = dbFor(users.staff);
    await assertSucceeds(setDoc(doc(staffDb, "organizations", ORG_A, "clients", "client-dual"), {
      organizationId: ORG_A,
      clientId: "client-dual",
      status: "active",
    }));
    await assertSucceeds(setDoc(doc(staffDb, "organizations", ORG_A, "lessons", "lesson-dual"), {
      organizationId: ORG_A,
      lessonId: "lesson-dual",
      status: "scheduled",
    }));
    await assertSucceeds(setDoc(doc(staffDb, "organizations", ORG_A, "lessons", "lesson-dual", "participants", "client-dual"), {
      organizationId: ORG_A,
      lessonId: "lesson-dual",
      clientId: "client-dual",
      attendanceStatus: "booked",
    }));
    await assertFails(setDoc(doc(dbFor(users.outsider), "organizations", ORG_A, "clients", "client-blocked"), {
      organizationId: ORG_A,
      clientId: "client-blocked",
      status: "active",
    }));
  });

  test("member reads only the linked client document", async () => {
    await assertSucceeds(getDoc(doc(dbFor(users.member), "clients", "client-member")));
    await assertFails(getDoc(doc(dbFor(users.member), "clients", "client-other")));
  });
});

describe("protected and append-only data", () => {
  test("signed-in clients can read but never write the server-owned AI recording status", async () => {
    await assertSucceeds(getDoc(doc(dbFor(users.instructor), "runtimeConfig", "aiRecording")));
    await assertFails(getDoc(doc(dbFor(null), "runtimeConfig", "aiRecording")));
    await assertFails(updateDoc(doc(dbFor(users.owner), "runtimeConfig", "aiRecording"), { status: "off" }));
  });

  test("ordinary users cannot change roles", async () => {
    await assertFails(updateDoc(doc(dbFor(users.owner), "memberships", `${ORG_A}_${users.owner}`), {
      role: "member",
    }));
  });

  test("users cannot add protected profile fields", async () => {
    await assertFails(updateDoc(doc(dbFor(users.member), "users", users.member), { role: "owner" }));
  });

  test("events and audit logs reject client creates, updates, and deletes", async () => {
    await assertFails(setDoc(doc(dbFor(users.owner), "events", "event-2"), {
      organizationId: ORG_A,
      type: "client-write",
    }));
    await assertFails(updateDoc(doc(dbFor(users.owner), "events", "event-1"), { type: "changed" }));
    await assertFails(deleteDoc(doc(dbFor(users.owner), "events", "event-1")));
    await assertFails(setDoc(doc(dbFor(users.owner), "auditLogs", "audit-2"), {
      organizationId: ORG_A,
      action: "client-write",
    }));
    await assertFails(updateDoc(doc(dbFor(users.owner), "auditLogs", "audit-1"), { action: "changed" }));
    await assertFails(deleteDoc(doc(dbFor(users.owner), "auditLogs", "audit-1")));
  });

  test("fixture sanity check has all role identities", () => {
    assert.equal(Object.keys(users).length, 6);
  });
});

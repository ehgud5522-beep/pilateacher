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
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getMetadata, ref, uploadBytes } from "firebase/storage";

const PROJECT_ID = "pilateacher-dev";
const ORG_A = "org-a";
const ORG_B = "org-b";
const PASS_A = "pass-a";
const PASS_B = "pass-b";
const PRODUCT_A = "product-a";
const PRODUCT_B = "product-b";
const SESSION_TYPES = ["pt_1_1", "pt_2_1"];
const PT_1_1_CATEGORIES = [
  "pt_1_1_new",
  "pt_1_1_repurchase_event",
  "pt_1_1_repurchase_normal",
  "service",
  "letmein",
  "etc",
];
const PT_2_1_CATEGORIES = ["pt_2_1_new", "pt_2_1_repurchase", "service", "etc"];
const PAYMENT_METHODS = ["card", "cash", "transfer", "zeropay", "voucher"];
const PAY_CATEGORIES = [
  "pt_1_1_new",
  "pt_1_1_repurchase_event",
  "pt_1_1_repurchase_normal",
  "pt_2_1_new",
  "pt_2_1_repurchase",
  "service",
  "letmein",
  "etc",
];
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

function productFixture(organizationId, overrides = {}) {
  return {
    organizationId,
    name: "1:1 20회 이벤트",
    sessionType: "pt_1_1",
    payCategory: "pt_1_1_new",
    defaultSessions: 20,
    defaultPrice: 1200000,
    status: "active",
    createdBy: users.owner,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function hoursAgo(hours) {
  return Timestamp.fromMillis(Date.now() - hours * 60 * 60 * 1000);
}

function passFixture(organizationId, passId, overrides = {}) {
  return {
    organizationId,
    passId,
    clientId: "client-member",
    locationId: "location-a",
    productId: "product-1on1-new",
    category: "pt_1_1_new",
    totalSessions: 20,
    serviceSessions: 0,
    contractPrice: 1200000,
    paymentMethod: "card",
    purchaseRound: 1,
    remainingCount: 20,
    status: "active",
    createdBy: users.manager,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function ledgerFixture(organizationId, passId, overrides = {}) {
  return {
    organizationId,
    passId,
    locationId: "location-a",
    type: "deduct",
    delta: -1,
    category: "pt_1_1_new",
    unitPrice: 60000,
    lessonId: "lesson-dual",
    instructorId: users.instructor,
    occurredAt: hoursAgo(2),
    createdBy: users.instructor,
    createdAt: serverTimestamp(),
    ...overrides,
  };
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
    await setDoc(doc(db, "organizations", ORG_A, "clients", "client-member"), {
      organizationId: ORG_A,
      userId: users.member,
      displayName: "Member",
    });
    await setDoc(doc(db, "organizations", ORG_A, "clients", "client-other"), {
      organizationId: ORG_A,
      userId: "another-member",
      displayName: "Other",
    });
    await setDoc(doc(db, "events", "event-1"), { organizationId: ORG_A, type: "fixture" });
    await setDoc(doc(db, "auditLogs", "audit-1"), { organizationId: ORG_A, action: "fixture" });
    await setDoc(doc(db, "organizations", ORG_A, "products", PRODUCT_A), productFixture(ORG_A));
    await setDoc(doc(db, "organizations", ORG_B, "products", PRODUCT_B), productFixture(ORG_B));
    await setDoc(doc(db, "organizations", ORG_A, "passes", PASS_A), passFixture(ORG_A, PASS_A));
    await setDoc(doc(db, "organizations", ORG_B, "passes", PASS_B), passFixture(ORG_B, PASS_B));
    await setDoc(
      doc(db, "organizations", ORG_A, "passes", PASS_A, "ledger", "entry-issue"),
      ledgerFixture(ORG_A, PASS_A, { type: "issue", delta: 20 }),
    );
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
    await assertSucceeds(setDoc(doc(dbFor(users.manager), "organizations", ORG_A, "locations", "location-a"), {
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
    await assertSucceeds(setDoc(doc(dbFor(users.staff), "organizations", ORG_A, "lessons", "lesson-a"), {
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
    await assertSucceeds(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "clients", "client-member")));
    await assertFails(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "clients", "client-other")));
  });
});

describe("PT passes and their ledger", () => {
  const passRef = (userId, organizationId, passId) =>
    doc(dbFor(userId), "organizations", organizationId, "passes", passId);
  const ledgerRef = (userId, organizationId, passId, entryId) =>
    doc(dbFor(userId), "organizations", organizationId, "passes", passId, "ledger", entryId);

  test("members read passes and outsiders do not", async () => {
    await assertSucceeds(getDoc(passRef(users.instructor, ORG_A, PASS_A)));
    await assertFails(getDoc(passRef(users.outsider, ORG_A, PASS_A)));
    await assertFails(getDoc(passRef(null, ORG_A, PASS_A)));
  });

  test("only owner and manager issue a pass", async () => {
    await assertSucceeds(setDoc(passRef(users.manager, ORG_A, "pass-by-manager"), passFixture(ORG_A, "pass-by-manager")));
    await assertSucceeds(setDoc(passRef(users.owner, ORG_A, "pass-by-owner"), passFixture(ORG_A, "pass-by-owner")));
    await assertFails(setDoc(passRef(users.instructor, ORG_A, "pass-by-instructor"), passFixture(ORG_A, "pass-by-instructor")));
    await assertFails(setDoc(passRef(users.staff, ORG_A, "pass-by-staff"), passFixture(ORG_A, "pass-by-staff")));
  });

  test("a pass whose organizationId disagrees with its path is rejected", async () => {
    await assertFails(setDoc(
      passRef(users.manager, ORG_A, "pass-wrong-org"),
      passFixture(ORG_B, "pass-wrong-org"),
    ));
  });

  test("only the owner updates a pass, and never deletes one", async () => {
    await assertSucceeds(updateDoc(passRef(users.owner, ORG_A, PASS_A), {
      organizationId: ORG_A,
      remainingCount: 19,
    }));
    await assertFails(updateDoc(passRef(users.manager, ORG_A, PASS_A), { remainingCount: 18 }));
    await assertFails(updateDoc(passRef(users.owner, ORG_A, PASS_A), { organizationId: ORG_B }));
    await assertFails(deleteDoc(passRef(users.owner, ORG_A, PASS_A)));
  });

  test("instructors append a deduction to the ledger", async () => {
    await assertSucceeds(setDoc(
      ledgerRef(users.instructor, ORG_A, PASS_A, "entry-deduct"),
      ledgerFixture(ORG_A, PASS_A),
    ));
    await assertSucceeds(getDoc(ledgerRef(users.instructor, ORG_A, PASS_A, "entry-issue")));
    await assertFails(setDoc(
      ledgerRef(users.staff, ORG_A, PASS_A, "entry-by-staff"),
      ledgerFixture(ORG_A, PASS_A, { instructorId: users.staff, createdBy: users.staff }),
    ));
  });

  test("a ledger entry whose body disagrees with its path is rejected", async () => {
    await assertFails(setDoc(
      ledgerRef(users.instructor, ORG_A, PASS_A, "entry-wrong-pass"),
      ledgerFixture(ORG_A, PASS_B),
    ));
    await assertFails(setDoc(
      ledgerRef(users.instructor, ORG_A, PASS_A, "entry-wrong-org"),
      ledgerFixture(ORG_B, PASS_A),
    ));
  });

  test("nobody edits or removes a ledger entry", async () => {
    for (const userId of [users.owner, users.manager, users.instructor]) {
      await assertFails(updateDoc(ledgerRef(userId, ORG_A, PASS_A, "entry-issue"), { delta: 999 }));
      await assertFails(deleteDoc(ledgerRef(userId, ORG_A, PASS_A, "entry-issue")));
    }
  });

  test("one organization never reaches another organization passes", async () => {
    await assertFails(getDoc(passRef(users.owner, ORG_B, PASS_B)));
    await assertFails(setDoc(passRef(users.manager, ORG_B, "pass-crossing"), passFixture(ORG_B, "pass-crossing")));
    await assertFails(getDoc(ledgerRef(users.instructor, ORG_B, PASS_B, "entry-issue")));
    await assertFails(setDoc(
      ledgerRef(users.instructor, ORG_B, PASS_B, "entry-crossing"),
      ledgerFixture(ORG_B, PASS_B),
    ));
  });
});

describe("membership products are added and archived, never edited", () => {
  const productRef = (userId, organizationId, productId) =>
    doc(dbFor(userId), "organizations", organizationId, "products", productId);

  function withoutField(body, field) {
    const copy = { ...body };
    delete copy[field];
    return copy;
  }

  test("members read products and outsiders do not", async () => {
    await assertSucceeds(getDoc(productRef(users.instructor, ORG_A, PRODUCT_A)));
    await assertFails(getDoc(productRef(users.outsider, ORG_A, PRODUCT_A)));
    await assertFails(getDoc(productRef(null, ORG_A, PRODUCT_A)));
  });

  test("only the owner adds a product", async () => {
    await assertSucceeds(setDoc(productRef(users.owner, ORG_A, "product-by-owner"), productFixture(ORG_A)));
    for (const userId of [users.manager, users.instructor, users.staff]) {
      await assertFails(setDoc(
        productRef(userId, ORG_A, `product-by-${userId}`),
        productFixture(ORG_A, { createdBy: userId }),
      ));
    }
  });

  test("a product whose organizationId disagrees with its path is rejected", async () => {
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-wrong-org"), productFixture(ORG_B)));
  });

  test("every field in the set is required", async () => {
    for (const field of [
      "organizationId", "name", "sessionType", "payCategory",
      "defaultSessions", "defaultPrice", "status", "createdAt", "createdBy",
    ]) {
      await assertFails(setDoc(
        productRef(users.owner, ORG_A, `product-missing-${field}`),
        withoutField(productFixture(ORG_A), field),
      ));
    }
  });

  test("an unlisted field is rejected", async () => {
    await assertFails(setDoc(
      productRef(users.owner, ORG_A, "product-extra"),
      productFixture(ORG_A, { unitPrice: 60000 }),
    ));
  });

  test("name has to be a non-empty string", async () => {
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-empty-name"), productFixture(ORG_A, { name: "" })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-int-name"), productFixture(ORG_A, { name: 20 })));
  });

  test("sessionType and payCategory come from their allowed lists", async () => {
    for (const sessionType of SESSION_TYPES) {
      await assertSucceeds(setDoc(
        productRef(users.owner, ORG_A, `product-type-${sessionType}`),
        productFixture(ORG_A, { sessionType, payCategory: "service" }),
      ));
    }
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-type-3on1"), productFixture(ORG_A, { sessionType: "pt_3_1" })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-pay-typo"), productFixture(ORG_A, { payCategory: "pt_1_1_New" })));
  });

  test("every pay category that fits the session type is accepted", async () => {
    for (const payCategory of PT_1_1_CATEGORIES) {
      await assertSucceeds(setDoc(
        productRef(users.owner, ORG_A, `product-1on1-${payCategory}`),
        productFixture(ORG_A, { sessionType: "pt_1_1", payCategory }),
      ));
    }
    for (const payCategory of PT_2_1_CATEGORIES) {
      await assertSucceeds(setDoc(
        productRef(users.owner, ORG_A, `product-2on1-${payCategory}`),
        productFixture(ORG_A, { sessionType: "pt_2_1", payCategory }),
      ));
    }
  });

  test("a pay category from the other session shape is rejected", async () => {
    for (const payCategory of ["pt_2_1_new", "pt_2_1_repurchase"]) {
      await assertFails(setDoc(
        productRef(users.owner, ORG_A, `product-1on1-bad-${payCategory}`),
        productFixture(ORG_A, { sessionType: "pt_1_1", payCategory }),
      ));
    }
    for (const payCategory of ["pt_1_1_new", "pt_1_1_repurchase_event", "pt_1_1_repurchase_normal"]) {
      await assertFails(setDoc(
        productRef(users.owner, ORG_A, `product-2on1-bad-${payCategory}`),
        productFixture(ORG_A, { sessionType: "pt_2_1", payCategory }),
      ));
    }
  });

  test("letmein is 1:1 only while service and etc attach to either shape", async () => {
    await assertSucceeds(setDoc(
      productRef(users.owner, ORG_A, "product-letmein-1on1"),
      productFixture(ORG_A, { sessionType: "pt_1_1", payCategory: "letmein" }),
    ));
    await assertFails(setDoc(
      productRef(users.owner, ORG_A, "product-letmein-2on1"),
      productFixture(ORG_A, { sessionType: "pt_2_1", payCategory: "letmein" }),
    ));
    for (const sessionType of SESSION_TYPES) {
      for (const payCategory of ["service", "etc"]) {
        await assertSucceeds(setDoc(
          productRef(users.owner, ORG_A, `product-${sessionType}-${payCategory}`),
          productFixture(ORG_A, { sessionType, payCategory }),
        ));
      }
    }
  });

  test("defaultSessions must be positive and defaultPrice non-negative", async () => {
    await assertSucceeds(setDoc(productRef(users.owner, ORG_A, "product-free"), productFixture(ORG_A, { defaultPrice: 0 })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-zero-sessions"), productFixture(ORG_A, { defaultSessions: 0 })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-string-sessions"), productFixture(ORG_A, { defaultSessions: "20" })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-negative-price"), productFixture(ORG_A, { defaultPrice: -1 })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-string-price"), productFixture(ORG_A, { defaultPrice: "1200000" })));
  });

  test("status, createdAt and createdBy are constrained at creation", async () => {
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-bad-status"), productFixture(ORG_A, { status: "draft" })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-backdated"), productFixture(ORG_A, { createdAt: hoursAgo(24) })));
    await assertFails(setDoc(productRef(users.owner, ORG_A, "product-forged"), productFixture(ORG_A, { createdBy: users.manager })));
  });

  test("status moves both ways and nothing else moves", async () => {
    const ownerRef = productRef(users.owner, ORG_A, PRODUCT_A);
    await assertSucceeds(updateDoc(ownerRef, { status: "archived" }));
    await assertSucceeds(updateDoc(ownerRef, { status: "active" }));
    await assertFails(updateDoc(ownerRef, { status: "draft" }));
    await assertFails(updateDoc(ownerRef, { name: "renamed" }));
    await assertFails(updateDoc(ownerRef, { defaultPrice: 990000 }));
    await assertFails(updateDoc(ownerRef, { defaultSessions: 10 }));
    await assertFails(updateDoc(ownerRef, { payCategory: "etc" }));
    await assertFails(updateDoc(ownerRef, { sessionType: "pt_2_1" }));
    await assertFails(updateDoc(ownerRef, { createdBy: users.manager }));
    await assertFails(updateDoc(ownerRef, { status: "archived", defaultPrice: 990000 }));
    await assertFails(updateDoc(ownerRef, { unitPrice: 60000 }));
  });

  test("only the owner archives, and nobody deletes", async () => {
    await assertFails(updateDoc(productRef(users.manager, ORG_A, PRODUCT_A), { status: "archived" }));
    await assertFails(deleteDoc(productRef(users.owner, ORG_A, PRODUCT_A)));
  });

  test("one organization never reaches another organization products", async () => {
    await assertFails(getDoc(productRef(users.owner, ORG_B, PRODUCT_B)));
    await assertFails(setDoc(productRef(users.owner, ORG_B, "product-crossing"), productFixture(ORG_B)));
    await assertFails(updateDoc(productRef(users.owner, ORG_B, PRODUCT_B), { status: "archived" }));
  });
});

describe("ledger and pass bodies are validated at write time", () => {
  const ledgerRef = (userId, entryId) =>
    doc(dbFor(userId), "organizations", ORG_A, "passes", PASS_A, "ledger", entryId);
  const passRef = (userId, passId) => doc(dbFor(userId), "organizations", ORG_A, "passes", passId);

  function withoutField(body, field) {
    const copy = { ...body };
    delete copy[field];
    return copy;
  }

  test("a well formed deduction is accepted", async () => {
    await assertSucceeds(setDoc(ledgerRef(users.instructor, "ok-deduct"), ledgerFixture(ORG_A, PASS_A)));
  });

  test("an issue entry needs no lessonId but a deduction does", async () => {
    await assertSucceeds(setDoc(
      ledgerRef(users.manager, "ok-issue"),
      withoutField(ledgerFixture(ORG_A, PASS_A, {
        type: "issue",
        delta: 20,
        instructorId: users.manager,
        createdBy: users.manager,
      }), "lessonId"),
    ));
    await assertFails(setDoc(
      ledgerRef(users.instructor, "deduct-without-lesson"),
      withoutField(ledgerFixture(ORG_A, PASS_A), "lessonId"),
    ));
  });

  test("delta must be a non-zero int", async () => {
    await assertFails(setDoc(ledgerRef(users.instructor, "delta-string"), ledgerFixture(ORG_A, PASS_A, { delta: "-1" })));
    await assertFails(setDoc(ledgerRef(users.instructor, "delta-zero"), ledgerFixture(ORG_A, PASS_A, { delta: 0 })));
  });

  test("delta has to agree in sign with the entry type", async () => {
    await assertFails(setDoc(ledgerRef(users.instructor, "deduct-positive"), ledgerFixture(ORG_A, PASS_A, { delta: 1 })));
    await assertFails(setDoc(ledgerRef(users.manager, "issue-negative"), withoutField(ledgerFixture(ORG_A, PASS_A, {
      type: "issue",
      delta: -20,
      instructorId: users.manager,
      createdBy: users.manager,
    }), "lessonId")));
  });

  test("type outside the allowed list is rejected", async () => {
    await assertFails(setDoc(ledgerRef(users.instructor, "type-refund"), ledgerFixture(ORG_A, PASS_A, { type: "refund" })));
    await assertFails(setDoc(ledgerRef(users.instructor, "type-int"), ledgerFixture(ORG_A, PASS_A, { type: 1 })));
  });

  test("unitPrice must be a non-negative int", async () => {
    await assertFails(setDoc(ledgerRef(users.instructor, "price-string"), ledgerFixture(ORG_A, PASS_A, { unitPrice: "60000" })));
    await assertFails(setDoc(ledgerRef(users.instructor, "price-negative"), ledgerFixture(ORG_A, PASS_A, { unitPrice: -1 })));
  });

  test("an unlisted field anywhere in the body is rejected", async () => {
    await assertFails(setDoc(
      ledgerRef(users.instructor, "extra-field"),
      ledgerFixture(ORG_A, PASS_A, { memo: "손으로 적은 메모" }),
    ));
  });

  test("every required field is required", async () => {
    for (const field of ["locationId", "category", "unitPrice", "instructorId", "createdAt", "createdBy"]) {
      await assertFails(setDoc(
        ledgerRef(users.instructor, `missing-${field}`),
        withoutField(ledgerFixture(ORG_A, PASS_A), field),
      ));
    }
  });

  test("occurredAt is required on both entry types", async () => {
    await assertFails(setDoc(
      ledgerRef(users.instructor, "deduct-no-occurred"),
      withoutField(ledgerFixture(ORG_A, PASS_A), "occurredAt"),
    ));
    await assertFails(setDoc(
      ledgerRef(users.manager, "issue-no-occurred"),
      withoutField(withoutField(ledgerFixture(ORG_A, PASS_A, {
        type: "issue",
        delta: 20,
        instructorId: users.manager,
        createdBy: users.manager,
      }), "lessonId"), "occurredAt"),
    ));
  });

  test("occurredAt has to be a timestamp inside the backdating window", async () => {
    await assertFails(setDoc(
      ledgerRef(users.instructor, "occurred-string"),
      ledgerFixture(ORG_A, PASS_A, { occurredAt: "2026-09-13T00:00:00Z" }),
    ));
    await assertFails(setDoc(
      ledgerRef(users.instructor, "occurred-future"),
      ledgerFixture(ORG_A, PASS_A, { occurredAt: hoursAgo(-24) }),
    ));
    await assertFails(setDoc(
      ledgerRef(users.instructor, "occurred-eight-days"),
      ledgerFixture(ORG_A, PASS_A, { occurredAt: hoursAgo(8 * 24) }),
    ));
  });

  test("an entry recorded later than the lesson is accepted", async () => {
    const occurredAt = hoursAgo(2 * 24);
    await assertSucceeds(setDoc(
      ledgerRef(users.instructor, "occurred-two-days"),
      ledgerFixture(ORG_A, PASS_A, { occurredAt }),
    ));
    let written;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDoc(
        doc(context.firestore(), "organizations", ORG_A, "passes", PASS_A, "ledger", "occurred-two-days"),
      );
      written = snapshot.data();
    });
    assert.equal(written.occurredAt.toMillis(), occurredAt.toMillis());
    assert.ok(written.createdAt.toMillis() > written.occurredAt.toMillis());
  });

  test("createdAt has to be the server clock, not a client timestamp", async () => {
    const lastMonth = Timestamp.fromDate(new Date("2026-08-01T00:00:00Z"));
    await assertFails(setDoc(
      ledgerRef(users.instructor, "backdated"),
      ledgerFixture(ORG_A, PASS_A, { createdAt: lastMonth }),
    ));
    await assertFails(setDoc(
      ledgerRef(users.instructor, "client-now"),
      ledgerFixture(ORG_A, PASS_A, { createdAt: Timestamp.now() }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-backdated"),
      passFixture(ORG_A, "pass-backdated", { createdAt: lastMonth }),
    ));
  });

  test("category outside the pay table is rejected", async () => {
    for (const typo of ["pt_1_1_New", "1:1 신규", "pt_11_new", "pt_1_1_repurchase", ""]) {
      await assertFails(setDoc(
        ledgerRef(users.instructor, `category-${typo || "empty"}`),
        ledgerFixture(ORG_A, PASS_A, { category: typo }),
      ));
    }
  });

  test("every pay table category is accepted", async () => {
    assert.equal(PAY_CATEGORIES.length, 8);
    for (const category of PAY_CATEGORIES) {
      await assertSucceeds(setDoc(
        ledgerRef(users.instructor, `category-ok-${category}`),
        ledgerFixture(ORG_A, PASS_A, { category }),
      ));
    }
  });

  test("createdBy has to be the authenticated uid", async () => {
    await assertFails(setDoc(
      ledgerRef(users.instructor, "createdBy-forged"),
      ledgerFixture(ORG_A, PASS_A, { createdBy: users.owner }),
    ));
  });

  test("a pass records what was actually issued, not just the product", async () => {
    await assertSucceeds(setDoc(
      passRef(users.manager, "pass-adjusted"),
      passFixture(ORG_A, "pass-adjusted", {
        totalSessions: 18,
        serviceSessions: 2,
        contractPrice: 990000,
        purchaseRound: 3,
      }),
    ));
    for (const field of ["productId", "totalSessions", "serviceSessions", "contractPrice", "paymentMethod", "purchaseRound"]) {
      await assertFails(setDoc(
        passRef(users.manager, `pass-missing-${field}`),
        withoutField(passFixture(ORG_A, `pass-missing-${field}`), field),
      ));
    }
  });

  test("serviceSessions may be zero but never negative or fractional", async () => {
    await assertSucceeds(setDoc(
      passRef(users.manager, "pass-service-zero"),
      passFixture(ORG_A, "pass-service-zero", { serviceSessions: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-service-negative"),
      passFixture(ORG_A, "pass-service-negative", { serviceSessions: -1 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-service-string"),
      passFixture(ORG_A, "pass-service-string", { serviceSessions: "2" }),
    ));
  });

  test("contractPrice may be zero but never negative or a string", async () => {
    await assertSucceeds(setDoc(
      passRef(users.manager, "pass-price-zero"),
      passFixture(ORG_A, "pass-price-zero", { contractPrice: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-price-negative"),
      passFixture(ORG_A, "pass-price-negative", { contractPrice: -1 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-price-string"),
      passFixture(ORG_A, "pass-price-string", { contractPrice: "990000" }),
    ));
  });

  test("purchaseRound starts at one", async () => {
    await assertSucceeds(setDoc(
      passRef(users.manager, "pass-round-four"),
      passFixture(ORG_A, "pass-round-four", { purchaseRound: 4 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-round-zero"),
      passFixture(ORG_A, "pass-round-zero", { purchaseRound: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-round-string"),
      passFixture(ORG_A, "pass-round-string", { purchaseRound: "1" }),
    ));
  });

  test("every payment method is accepted and nothing else is", async () => {
    assert.equal(PAYMENT_METHODS.length, 5);
    for (const paymentMethod of PAYMENT_METHODS) {
      await assertSucceeds(setDoc(
        passRef(users.manager, `pass-pay-${paymentMethod}`),
        passFixture(ORG_A, `pass-pay-${paymentMethod}`, { paymentMethod }),
      ));
    }
    for (const bogus of ["Card", "credit", "", "kakao"]) {
      await assertFails(setDoc(
        passRef(users.manager, `pass-pay-bad-${bogus || "empty"}`),
        passFixture(ORG_A, `pass-pay-bad-${bogus || "empty"}`, { paymentMethod: bogus }),
      ));
    }
  });

  test("a pass needs its product fields and a positive session count", async () => {
    await assertSucceeds(setDoc(passRef(users.manager, "pass-valid"), passFixture(ORG_A, "pass-valid")));
    await assertFails(setDoc(
      passRef(users.manager, "pass-no-product"),
      withoutField(passFixture(ORG_A, "pass-no-product"), "productId"),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-no-client"),
      withoutField(passFixture(ORG_A, "pass-no-client"), "clientId"),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-zero-sessions"),
      passFixture(ORG_A, "pass-zero-sessions", { totalSessions: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-string-sessions"),
      passFixture(ORG_A, "pass-string-sessions", { totalSessions: "20" }),
    ));
    await assertFails(setDoc(
      passRef(users.manager, "pass-int-status"),
      passFixture(ORG_A, "pass-int-status", { status: 1 }),
    ));
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

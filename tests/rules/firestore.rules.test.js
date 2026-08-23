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
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await readFile(new URL("../../firestore.foundation.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
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

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
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { CLIENT_STATUS, COLLECTIONS, MEMBERSHIP_STATUS } from "../../src/data/schema/constants.js";
import { CLIENT_STATUS_FOR_CREATE } from "../../src/data/repositories/client-repository.js";
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

// 상품 블록에도 같은 이름의 헬퍼가 있지만 그 describe 안에 갇혀 있다.
const dropField = (body, field) => {
  const copy = { ...body };
  delete copy[field];
  return copy;
};

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
    unitPrice: 25000,
    handedOver: false,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)),
    instructorId: users.instructor,
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
    clientId: "client-member",
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

const seedAll = () => seed();

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
    await setDoc(doc(db, "organizations", ORG_A, "locations", "location-a"), {
      organizationId: ORG_A,
      name: "반송점",
      status: "active",
    });
    await setDoc(doc(db, "organizations", ORG_B, "locations", "location-b"), {
      organizationId: ORG_B,
      name: "다른 조직 지점",
      status: "active",
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
    /* 아래는 list 규칙을 위한 것이다. 컬렉션이 비어 있으면 평가할 문서가 없어
       거부돼야 할 쿼리도 조용히 통과한다 -- locations 에서 그 구멍 때문에
       결함을 반년 놓쳤다. */
    await setDoc(doc(db, "organizations", ORG_A, "lessons", "lesson-seed"), {
      organizationId: ORG_A, lessonId: "lesson-seed", status: "scheduled",
    });
    await setDoc(doc(db, "organizations", ORG_B, "lessons", "lesson-seed-b"), {
      organizationId: ORG_B, lessonId: "lesson-seed-b", status: "scheduled",
    });
    await setDoc(doc(db, "organizations", ORG_A, "lessons", "lesson-seed", "participants", "client-member"), {
      organizationId: ORG_A, lessonId: "lesson-seed", clientId: "client-member", attendanceStatus: "booked",
    });
    await setDoc(doc(db, "organizations", ORG_A, "lessonNotes", "note-seed"), {
      organizationId: ORG_A, clientId: "client-member", lessonId: "lesson-seed",
      userId: users.member, createdBy: users.instructor,
    });
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

  /* 회원 등록 화면은 지점 목록을 list 쿼리로 읽는다 (location-repository).
     단일 문서 get 이 되는 것과 컬렉션 list 가 되는 것은 규칙에서 같은 동작이
     아니다 -- memberships 에서 같은 자리를 이미 겪었다. */
  const locationsOf = (userId, organizationId) =>
    collection(dbFor(userId), "organizations", organizationId, COLLECTIONS.LOCATIONS);

  test("a member lists the locations of their own organization", async () => {
    const snapshot = await assertSucceeds(getDocs(locationsOf(users.owner, ORG_A)));
    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.docs[0].id, "location-a");
    assert.equal(snapshot.docs[0].data().name, "반송점");
  });

  test("every role can list locations, so registration works for all of them", async () => {
    for (const [role, userId] of Object.entries(users)) {
      if (role === "outsider") continue;
      await assertSucceeds(getDocs(locationsOf(userId, ORG_A)), `${role} 이 지점을 읽을 수 있어야 한다`);
    }
  });

  test("another organization's locations are refused", async () => {
    await assertFails(getDocs(locationsOf(users.owner, ORG_B)));
  });

  test("an unauthenticated reader gets nothing from locations", async () => {
    await assertFails(getDocs(locationsOf(null, ORG_A)));
  });

  test("a malformed location no longer poisons the whole list", async () => {
    /* 예전 read 규칙은 resource.data.organizationId 를 봤는데, list 는 쿼리가
       보장하는 것으로 평가되므로 그 조건을 만족시킬 방법이 없었다 -- 지점이
       멀쩡해도 목록 전체가 거부됐고 화면에는 "지점이 없다"로만 보였다.
       list 를 분리한 뒤에는 경로가 조직을 한정하므로 한 건이 망가져도 나머지를
       읽을 수 있다. 그 한 건을 문서로 직접 여는 것은 여전히 막힌다. */
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "organizations", ORG_A, "locations", "location-no-org"), {
        name: "조직이 빠진 지점",
      });
    });
    const snapshot = await assertSucceeds(getDocs(locationsOf(users.owner, ORG_A)));
    assert.equal(snapshot.size, 2);
    await assertFails(getDoc(doc(dbFor(users.owner), "organizations", ORG_A, "locations", "location-no-org")));
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

  /* 등록 화면이 쓰는 문서를 규칙이 실제로 받는지, 그리고 잘못된 문서를 실제로
     막는지 고정한다. 규칙은 고정된 집합을 요구하지 않고 "있는 필드만" 검사한다 --
     dual-write 어댑터가 더 넓은 레거시 모양을 쓰기 때문이다. 그래서 어댑터 모양이
     계속 통과하는 것도 함께 확인한다. */

  const registration = (overrides = {}) => ({
    organizationId: ORG_A,
    name: "김하나",
    phone: "01012345678",
    locationId: "bansong",
    status: "active",
    createdAt: serverTimestamp(),
    createdBy: users.owner,
    ...overrides,
  });
  const clientRef = (userId, clientId) => doc(dbFor(userId), "organizations", ORG_A, "clients", clientId);

  test("the registration screen's document is accepted", async () => {
    await assertSucceeds(setDoc(clientRef(users.owner, "client-registered"), registration()));
  });

  test("a manager registers too, an outsider does not", async () => {
    await assertSucceeds(setDoc(clientRef(users.manager, "client-by-manager"), registration({ createdBy: users.manager })));
    await assertFails(setDoc(
      doc(dbFor(users.outsider), "organizations", ORG_A, "clients", "client-by-outsider"),
      registration({ createdBy: users.outsider }),
    ));
  });

  test("a nameless or mistyped client is refused", async () => {
    const refused = {
      "빈 이름": registration({ name: "" }),
      "이름이 문자열이 아님": registration({ name: 123 }),
      "연락처가 문자열이 아님": registration({ phone: 1012345678 }),
      "지점이 문자열이 아님": registration({ locationId: 7 }),
      "없는 상태": registration({ status: "made-up" }),
    };
    for (const [label, payload] of Object.entries(refused)) {
      await assertFails(setDoc(clientRef(users.owner, "client-refused"), payload), label);
    }
  });

  test("a client-made timestamp is refused even when it looks right", async () => {
    // 시각은 호출자가 기록을 소급해 적을 수 있는 유일한 필드다.
    await assertFails(setDoc(clientRef(users.owner, "client-backdated"), registration({
      createdAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    })));
  });

  test("nobody files a registration under someone else's name", async () => {
    await assertFails(setDoc(clientRef(users.owner, "client-forged"), registration({
      createdBy: users.instructor,
    })));
  });

  test("the legacy dual-write shape still passes the new validation", async () => {
    // 규칙을 조인 뒤에도 마이그레이션 경로가 살아 있어야 한다. locationId 는
    // 레거시 회원에게 아직 지점이 없을 때 null 로 온다.
    await assertSucceeds(setDoc(clientRef(users.staff, "client-legacy"), {
      organizationId: ORG_A,
      clientId: "client-legacy",
      locationId: null,
      name: "이두리",
      phone: "01099998888",
      status: CLIENT_STATUS.INACTIVE,
      instructorId: null,
      membershipBalance: { regular: 10, service: 2 },
      legacySource: { userId: users.staff, memberId: "client-legacy" },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: users.staff,
    }));
  });

  test("the statuses the rules accept cover the ones registration can make", () => {
    for (const status of CLIENT_STATUS_FOR_CREATE) {
      assert.ok(Object.values(CLIENT_STATUS).includes(status), `${status} 가 상수에 없다`);
    }
  });

  const clientsOf = (userId, organizationId) =>
    collection(dbFor(userId), "organizations", organizationId, COLLECTIONS.CLIENTS);

  test("the member directory lists the organization's clients", async () => {
    // 회원 관리 화면이 하는 연산이다. 지점 목록과 같은 자리를 지난다.
    const snapshot = await assertSucceeds(getDocs(clientsOf(users.owner, ORG_A)));
    assert.ok(snapshot.size >= 1);
  });

  test("every staff role lists the directory, an outsider does not", async () => {
    for (const role of ["owner", "manager", "instructor", "staff"]) {
      await assertSucceeds(getDocs(clientsOf(users[role], ORG_A)), `${role} 은 명부를 읽을 수 있어야 한다`);
    }
    await assertFails(getDocs(clientsOf(users.outsider, ORG_A)));
    await assertFails(getDocs(clientsOf(null, ORG_A)));
  });

  test("a plain member cannot list the directory, only their own document", async () => {
    /* get 규칙은 자기와 연결된 문서 한 건을 읽게 해 주지만, 쿼리는 "내 것만"을
       증명할 필터가 없으면 그 조건을 표현할 수 없다. 명부 열람은 직원의 일이다. */
    await assertFails(getDocs(clientsOf(users.member, ORG_A)));
    await assertSucceeds(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "clients", "client-member")));
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

  test("the owner rewrites a pass, and nobody deletes one", async () => {
    /* 출석 체크가 생기면서 잔여 한 칸을 줄이는 일은 수업하는 사람 모두에게
       열렸다 -- 아래 "checking attendance" 블록이 그 경계를 따로 고정한다.
       여기서 지키는 것은 나머지다: 회원권의 다른 모든 값은 대표의 것이고,
       조직을 옮기는 것과 지우는 것은 누구에게도 열려 있지 않다. */
    await assertSucceeds(updateDoc(passRef(users.owner, ORG_A, PASS_A), {
      organizationId: ORG_A,
      contractPrice: 990000,
    }));
    await assertFails(updateDoc(passRef(users.manager, ORG_A, PASS_A), { contractPrice: 1 }));
    await assertFails(updateDoc(passRef(users.instructor, ORG_A, PASS_A), { contractPrice: 1 }));
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
    for (const field of ["productId", "totalSessions", "serviceSessions", "contractPrice", "paymentMethod", "purchaseRound", "instructorId", "unitPrice", "remainingCount", "expiresAt", "handedOver"]) {
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

  /* 앱이 소속을 읽을 때 실제로 하는 연산은 list 쿼리 하나뿐이다
     (createFirestoreMembershipReader). 나머지 memberships 테스트는 전부
     setDoc/updateDoc 이라 이 경로를 한 번도 지나지 않았다. get 이 되는 것과
     where 로 목록을 긁는 것이 규칙에서 같은 동작이 아니므로 따로 고정한다.

     컬렉션 경로와 status 값은 리더와 같은 상수에서 가져온다 -- 상수가 어긋나면
     여기서 먼저 깨진다. */
  const membershipQuery = (userId, forUserId) => query(
    collection(dbFor(userId), COLLECTIONS.MEMBERSHIPS),
    where("userId", "==", forUserId),
    where("status", "==", MEMBERSHIP_STATUS.ACTIVE),
  );

  test("a member can list their own active membership with the reader's query", async () => {
    const snapshot = await assertSucceeds(getDocs(membershipQuery(users.owner, users.owner)));
    assert.equal(snapshot.size, 1, "본인 소속 문서가 정확히 한 건 나와야 한다");
    const found = snapshot.docs[0].data();
    assert.equal(found.userId, users.owner);
    assert.equal(found.organizationId, ORG_A);
    assert.equal(found.status, "active");
    assert.equal(snapshot.docs[0].id, `${ORG_A}_${users.owner}`);
  });

  test("every role can read its own membership, so no role is silently legacy", async () => {
    for (const [role, userId] of Object.entries(users)) {
      const snapshot = await assertSucceeds(getDocs(membershipQuery(userId, userId)));
      assert.equal(snapshot.size, 1, `${role} 은 자기 소속을 읽을 수 있어야 한다`);
    }
  });

  test("listing someone else's membership is refused, not silently empty", async () => {
    // 0건으로 돌아오면 앱은 legacy(개인 모드)로 확정해 버린다. 남의 소속을
    // 훔쳐보지 못하는 것과, 못 읽었다는 사실이 드러나는 것은 둘 다 필요하다.
    await assertFails(getDocs(membershipQuery(users.outsider, users.owner)));
  });

  test("listing the whole memberships collection is refused", async () => {
    await assertFails(getDocs(collection(dbFor(users.owner), COLLECTIONS.MEMBERSHIPS)));
  });

  test("a status-only list without the userId filter is refused", async () => {
    await assertFails(getDocs(query(
      collection(dbFor(users.owner), COLLECTIONS.MEMBERSHIPS),
      where("status", "==", MEMBERSHIP_STATUS.ACTIVE),
    )));
  });

  test("an unauthenticated reader gets nothing from memberships", async () => {
    await assertFails(getDocs(membershipQuery(null, users.owner)));
  });
});

/* list 는 쿼리 기준으로 평가된다. resource.data 조건을 allow read 에 쓰면
   컬렉션 쿼리가 통째로 거부되는데, 빈 컬렉션은 조용히 통과하므로 첫 문서가
   생기기 전까지 드러나지 않는다. 그래서 여기 fixture 는 전부 문서를 심는다.

   앱이 곧 list 할 컬렉션을 한자리에서 고정한다 -- 고친 것과, 이미 안전해서
   고치지 않은 것 양쪽 다. */
describe("collection queries the app will run", () => {
  const listOf = (userId, ...segments) => collection(dbFor(userId), ...segments);
  const orgList = (userId, ...segments) => listOf(userId, "organizations", ORG_A, ...segments);

  test("lessons list for any member of the organization", async () => {
    const snapshot = await assertSucceeds(getDocs(orgList(users.instructor, "lessons")));
    assert.equal(snapshot.size, 1);
    await assertFails(getDocs(listOf(users.outsider, "organizations", ORG_A, "lessons")));
    await assertFails(getDocs(listOf(null, "organizations", ORG_A, "lessons")));
  });

  test("lesson participants list for any member of the organization", async () => {
    const snapshot = await assertSucceeds(getDocs(orgList(users.instructor, "lessons", "lesson-seed", "participants")));
    assert.equal(snapshot.size, 1);
    await assertFails(getDocs(listOf(users.outsider, "organizations", ORG_A, "lessons", "lesson-seed", "participants")));
  });

  test("lesson notes list for the roles that teach and run the centre", async () => {
    for (const role of ["owner", "manager", "instructor"]) {
      await assertSucceeds(getDocs(orgList(users[role], "lessonNotes")), role);
    }
    // staff 는 수업 기록을 읽지 않는다. 회원 본인도 목록으로는 못 읽는다 --
    // "나에 대한 기록만"을 쿼리가 증명할 수 없기 때문이다.
    await assertFails(getDocs(orgList(users.staff, "lessonNotes")));
    await assertFails(getDocs(orgList(users.member, "lessonNotes")));
    // 한 건씩은 여전히 읽는다.
    await assertSucceeds(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "lessonNotes", "note-seed")));
  });

  /* 아래 셋은 규칙을 고치지 않았다. read 조건에 resource.data 가 없어 처음부터
     list 가 통과한다. 고치지 않았다는 사실 자체를 고정해 둔다 -- 나중에 누가
     organizationId 조건을 "더 안전해 보여서" 덧붙이면 여기서 깨진다. */
  test("products list without a rule change", async () => {
    const snapshot = await assertSucceeds(getDocs(orgList(users.staff, COLLECTIONS.PRODUCTS)));
    assert.equal(snapshot.size, 1);
    await assertFails(getDocs(listOf(users.outsider, "organizations", ORG_A, COLLECTIONS.PRODUCTS)));
  });

  test("passes list without a rule change", async () => {
    const snapshot = await assertSucceeds(getDocs(orgList(users.instructor, COLLECTIONS.PASSES)));
    assert.equal(snapshot.size, 1);
    await assertFails(getDocs(listOf(users.outsider, "organizations", ORG_A, COLLECTIONS.PASSES)));
  });

  test("the pass ledger lists without a rule change", async () => {
    const snapshot = await assertSucceeds(getDocs(orgList(users.owner, COLLECTIONS.PASSES, PASS_A, COLLECTIONS.LEDGER)));
    assert.equal(snapshot.size, 1);
    await assertFails(getDocs(listOf(users.outsider, "organizations", ORG_A, COLLECTIONS.PASSES, PASS_A, COLLECTIONS.LEDGER)));
  });

  /* auditLogs 는 최상위라 조직이 경로가 아니라 문서 안에 있다. 규칙은 그대로
     두고, 호출부가 organizationId 로 걸러야 한다 -- memberships 와 같은 방식
     이다. 이 테스트가 그 요구를 적어 둔다. */
  test("audit logs list only when the query names the organization", async () => {
    await assertFails(getDocs(listOf(users.owner, COLLECTIONS.AUDIT_LOGS)));
    await assertSucceeds(getDocs(query(
      listOf(users.owner, COLLECTIONS.AUDIT_LOGS),
      where("organizationId", "==", ORG_A),
    )));
    // 필터가 있어도 역할은 여전히 본다.
    await assertFails(getDocs(query(
      listOf(users.instructor, COLLECTIONS.AUDIT_LOGS),
      where("organizationId", "==", ORG_A),
    )));
  });
});

/* 회원권 발급과 담당 강사 교체. 발급은 회원권과 원장 항목 두 문서를 함께
   쓰는데 규칙은 문서마다 따로 판정하므로, 여기서는 각 문서가 통과하는지를
   본다 -- 두 문서가 실제로 함께 쓰이는지는 리포지토리 테스트가 본다. */
describe("issuing a pass and moving its instructor", () => {
  const passDoc = (userId, passId) => doc(dbFor(userId), "organizations", ORG_A, COLLECTIONS.PASSES, passId);
  const ledgerDoc = (userId, passId, entryId) =>
    doc(dbFor(userId), "organizations", ORG_A, COLLECTIONS.PASSES, passId, COLLECTIONS.LEDGER, entryId);

  const transferEntry = (overrides = {}) => ({
    organizationId: ORG_A,
    passId: PASS_A,
    clientId: "client-member",
    locationId: "location-a",
    type: "transfer",
    delta: 0,
    fromInstructorId: users.instructor,
    toInstructorId: users.staff,
    occurredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: users.owner,
    ...overrides,
  });

  test("the pass list is readable by every member of the organization", async () => {
    const snapshot = await assertSucceeds(getDocs(
      collection(dbFor(users.instructor), "organizations", ORG_A, COLLECTIONS.PASSES),
    ));
    assert.equal(snapshot.size, 1);
    await assertFails(getDocs(collection(dbFor(users.outsider), "organizations", ORG_A, COLLECTIONS.PASSES)));
    await assertFails(getDocs(collection(dbFor(null), "organizations", ORG_A, COLLECTIONS.PASSES)));
  });

  test("a pass without an instructor is refused", async () => {
    // 담당이 없으면 차감한 회차가 누구의 급여인지 알 수 없다.
    await assertFails(setDoc(
      passDoc(users.manager, "pass-no-instructor"),
      dropField(passFixture(ORG_A, "pass-no-instructor"), "instructorId"),
    ));
    await assertFails(setDoc(
      passDoc(users.manager, "pass-blank-instructor"),
      passFixture(ORG_A, "pass-blank-instructor", { instructorId: "" }),
    ));
  });

  test("a transfer entry records who handed over to whom", async () => {
    await assertSucceeds(setDoc(ledgerDoc(users.owner, PASS_A, "entry-transfer"), transferEntry()));
    await assertSucceeds(setDoc(
      ledgerDoc(users.manager, PASS_A, "entry-transfer-manager"),
      transferEntry({ createdBy: users.manager }),
    ));
  });

  test("an instructor cannot move a pass onto themselves", async () => {
    // 강사가 담당을 옮길 수 있으면 급여가 스스로 움직인다.
    await assertFails(setDoc(
      ledgerDoc(users.instructor, PASS_A, "entry-self-transfer"),
      transferEntry({ createdBy: users.instructor, fromInstructorId: users.staff, toInstructorId: users.instructor }),
    ));
  });

  test("a transfer carries no category and no unit price", async () => {
    /* 교체는 돈이 오가는 일이 아니라 두 필드에 넣을 참값이 없다. 자리를
       채우려고 아무 값이나 넣으면 급여를 카테고리별로 묶는 계산에 섞여 든다. */
    const extras = [{ category: "pt_1_1_new" }, { unitPrice: 25000 }, { lessonId: "lesson-seed" }];
    for (const extra of extras) {
      await assertFails(
        setDoc(ledgerDoc(users.owner, PASS_A, "entry-transfer-extra"), transferEntry(extra)),
        Object.keys(extra)[0],
      );
    }
  });

  test("a transfer that names the same instructor twice is refused", async () => {
    await assertFails(setDoc(
      ledgerDoc(users.owner, PASS_A, "entry-same"),
      transferEntry({ toInstructorId: users.instructor }),
    ));
  });

  test("a transfer must say both ends and must not move a count", async () => {
    const broken = [
      { label: "delta 1", patch: { delta: 1 } },
      { label: "delta -1", patch: { delta: -1 } },
      { label: "no from", drop: "fromInstructorId" },
      { label: "no to", drop: "toInstructorId" },
    ];
    for (const item of broken) {
      const entry = transferEntry(item.patch || {});
      if (item.drop) delete entry[item.drop];
      await assertFails(setDoc(ledgerDoc(users.owner, PASS_A, "entry-broken"), entry), item.label);
    }
  });

  test("issue and deduct still have to carry a category and a unit price", async () => {
    // transfer 를 열면서 나머지가 느슨해지지 않았는지 확인한다.
    const issue = {
      organizationId: ORG_A,
      passId: PASS_A,
      clientId: "client-member",
      locationId: "location-a",
      type: "issue",
      delta: 20,
      instructorId: users.instructor,
      occurredAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: users.owner,
    };
    await assertFails(setDoc(ledgerDoc(users.owner, PASS_A, "entry-issue-bare"), issue));
    await assertSucceeds(setDoc(ledgerDoc(users.owner, PASS_A, "entry-issue-full"), {
      ...issue, category: "pt_1_1_new", unitPrice: 25000,
    }));
    await assertFails(setDoc(ledgerDoc(users.owner, PASS_A, "entry-issue-zero"), {
      ...issue, category: "pt_1_1_new", unitPrice: 25000, delta: 0,
    }));
  });

  test("a manager may move the instructor and nothing else", async () => {
    /* 담당 교체는 handedOver 를 함께 올려야 한다 -- 둘 중 하나만 바뀌면 새 강사가
       인수인계 단가가 아니라 기준 단가를 받는다. */
    await assertFails(updateDoc(passDoc(users.manager, PASS_A), { instructorId: users.staff }));
    await assertSucceeds(updateDoc(passDoc(users.manager, PASS_A), {
      instructorId: users.staff, handedOver: true,
    }));
    // 계약 금액까지 손대는 것은 대표의 일이다.
    await assertFails(updateDoc(passDoc(users.manager, PASS_A), { contractPrice: 1 }));
    await assertFails(updateDoc(passDoc(users.manager, PASS_A), { instructorId: users.staff, handedOver: true, contractPrice: 1 }));
    // 넘겨받지 않았다고 되돌리는 것은 이 문으로 할 수 없다.
    await assertFails(updateDoc(passDoc(users.manager, PASS_A), { instructorId: users.owner, handedOver: false }));
    // 대표의 권한은 그대로다.
    await assertSucceeds(updateDoc(passDoc(users.owner, PASS_A), { contractPrice: 990000 }));
  });

  test("an instructor cannot move the instructor field", async () => {
    await assertFails(updateDoc(passDoc(users.instructor, PASS_A), { instructorId: users.staff, handedOver: true }));
    await assertFails(updateDoc(passDoc(users.staff, PASS_A), { instructorId: users.staff, handedOver: true }));
  });

  /* 발급 화면의 강사 목록. 규칙을 바꾸지 않고도 통과한다 -- 쿼리가
     organizationId 를 걸어 read 규칙의 두 번째 가지를 증명하기 때문이다. */
  const instructorsOf = (userId) => query(
    collection(dbFor(userId), COLLECTIONS.MEMBERSHIPS),
    where("organizationId", "==", ORG_A),
    where("role", "==", "instructor"),
    where("status", "==", "active"),
  );

  test("an owner lists the instructors of their organization", async () => {
    const snapshot = await assertSucceeds(getDocs(instructorsOf(users.owner)));
    assert.equal(snapshot.size, 1);
    assert.equal(snapshot.docs[0].data().userId, users.instructor);
  });

  test("a manager lists them too, an instructor does not", async () => {
    await assertSucceeds(getDocs(instructorsOf(users.manager)));
    // 발급 화면이 대표·매니저 전용이므로 여기서 막히는 것이 맞는 경계다.
    await assertFails(getDocs(instructorsOf(users.instructor)));
    await assertFails(getDocs(instructorsOf(users.outsider)));
    await assertFails(getDocs(instructorsOf(null)));
  });

  test("the organization context query still works alongside it", async () => {
    // 같은 컬렉션을 다른 모양으로 읽는다. 하나를 고치다 다른 하나가 깨지면
    // 앱이 시작하지 못한다.
    const snapshot = await assertSucceeds(getDocs(query(
      collection(dbFor(users.owner), COLLECTIONS.MEMBERSHIPS),
      where("userId", "==", users.owner),
      where("status", "==", "active"),
    )));
    assert.equal(snapshot.size, 1);
  });
});

/* 강사 풀방금액과 그 변경 이력.

   이 값은 pt_1_1_repurchase_normal 한 카테고리의 단가를 정한다. 강사가 자기
   금액을 올릴 수 있으면 급여가 스스로 움직이므로 대표만 바꾼다. 이력은
   기록용이고 급여 계산에는 쓰이지 않는다 -- 급여는 원장에 박힌 unitPrice 다. */
describe("instructor full-room rate", () => {
  const membershipDoc = (userId, ofUserId = users.instructor) =>
    doc(dbFor(userId), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${ofUserId}`);
  const historyDoc = (userId, entryId, ofUserId = users.instructor) =>
    doc(dbFor(userId), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${ofUserId}`, COLLECTIONS.RATE_HISTORY, entryId);

  const historyEntry = (overrides = {}) => ({
    organizationId: ORG_A,
    userId: users.instructor,
    previousRate: null,
    newRate: 45000,
    effectiveFrom: serverTimestamp(),
    changedBy: users.owner,
    createdAt: serverTimestamp(),
    ...overrides,
  });

  test("the owner sets a full-room rate", async () => {
    await assertSucceeds(updateDoc(membershipDoc(users.owner), { fullRoomRate: 45000 }));
    await assertSucceeds(updateDoc(membershipDoc(users.owner), { fullRoomRate: 0 }));
  });

  test("nobody else sets it, least of all the instructor themselves", async () => {
    // 강사가 자기 금액을 올릴 수 있으면 급여가 스스로 움직인다.
    await assertFails(updateDoc(membershipDoc(users.instructor), { fullRoomRate: 45000 }));
    await assertFails(updateDoc(membershipDoc(users.manager), { fullRoomRate: 45000 }));
    await assertFails(updateDoc(membershipDoc(users.staff), { fullRoomRate: 45000 }));
    await assertFails(updateDoc(membershipDoc(users.outsider), { fullRoomRate: 45000 }));
  });

  test("a rate has to be a non-negative whole number of won", async () => {
    for (const bad of [-1, 45000.5, "45000", null]) {
      await assertFails(updateDoc(membershipDoc(users.owner), { fullRoomRate: bad }), JSON.stringify(bad));
    }
  });

  test("no other field travels through this door", async () => {
    /* 이 경로로 role 이나 status 가 바뀌면 대표가 실수 한 번으로 강사를 센터에서
       잘라내거나 대표로 올릴 수 있다. */
    for (const forbidden of [
      { role: "owner" },
      { status: "revoked" },
      { organizationId: ORG_B },
      { userId: users.owner },
      { fullRoomRate: 45000, role: "owner" },
    ]) {
      await assertFails(updateDoc(membershipDoc(users.owner), forbidden), JSON.stringify(forbidden));
    }
  });

  test("changing a role is still refused, as it always was", async () => {
    // 기존 보장이 이 변경으로 느슨해지지 않았는지.
    await assertFails(updateDoc(
      doc(dbFor(users.owner), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${users.owner}`),
      { role: "member" },
    ));
  });

  test("memberships still cannot be created or deleted by a client", async () => {
    await assertFails(setDoc(
      doc(dbFor(users.owner), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_newcomer`),
      { organizationId: ORG_A, userId: "newcomer", role: "instructor", status: "active" },
    ));
    await assertFails(deleteDoc(membershipDoc(users.owner)));
  });

  /* 이름은 membership 에 싣는다. users/{uid} 를 여는 대신 그렇게 하는 이유는
     규칙에서 읽기의 필드를 가릴 수 없기 때문이다 -- 이름을 얻자고 그 문서를
     열면 전화번호와 이메일이 함께 열린다. */
  test("a member writes their own name onto their membership", async () => {
    await assertSucceeds(updateDoc(membershipDoc(users.instructor), { displayName: "정예진" }));
    await assertSucceeds(updateDoc(
      doc(dbFor(users.manager), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${users.manager}`),
      { displayName: "박서연" },
    ));
  });

  test("nobody writes somebody else's name, not even the owner", async () => {
    await assertFails(updateDoc(membershipDoc(users.owner), { displayName: "남의이름" }));
    await assertFails(updateDoc(membershipDoc(users.manager), { displayName: "남의이름" }));
    await assertFails(updateDoc(membershipDoc(users.outsider), { displayName: "남의이름" }));
  });

  test("a name has to be a non-empty string of sane length", async () => {
    for (const bad of ["", 1234, null, "가".repeat(61)]) {
      await assertFails(updateDoc(membershipDoc(users.instructor), { displayName: bad }), JSON.stringify(bad));
    }
  });

  test("the name door carries nothing else either", async () => {
    for (const forbidden of [
      { displayName: "정예진", role: "owner" },
      { displayName: "정예진", fullRoomRate: 45000 },
      { displayName: "정예진", status: "revoked" },
    ]) {
      await assertFails(updateDoc(membershipDoc(users.instructor), forbidden), JSON.stringify(forbidden));
    }
  });

  test("users documents stay shut, so no phone number leaks with a name", async () => {
    /* 이름을 읽자고 이 문서를 열면 전화번호와 이메일이 함께 열린다. 규칙은
       읽기에서 필드를 가릴 수 없으므로 문을 닫아 두고 이름만 옮겨 왔다. */
    await assertFails(getDoc(doc(dbFor(users.owner), COLLECTIONS.USERS, users.instructor)));
    await assertFails(getDoc(doc(dbFor(users.manager), COLLECTIONS.USERS, users.instructor)));
    await assertSucceeds(getDoc(doc(dbFor(users.instructor), COLLECTIONS.USERS, users.instructor)));
  });

  test("the owner writes a history entry and can read it back", async () => {
    await assertSucceeds(setDoc(historyDoc(users.owner, "entry-first"), historyEntry()));
    await assertSucceeds(getDoc(historyDoc(users.owner, "entry-first")));
    await assertSucceeds(getDocs(collection(
      dbFor(users.owner), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${users.instructor}`, COLLECTIONS.RATE_HISTORY,
    )));
  });

  test("a raise records what it came from", async () => {
    await assertSucceeds(setDoc(
      historyDoc(users.owner, "entry-raise"),
      historyEntry({ previousRate: 45000, newRate: 50000 }),
    ));
  });

  test("an entry that changes nothing is refused", async () => {
    await assertFails(setDoc(
      historyDoc(users.owner, "entry-noop"),
      historyEntry({ previousRate: 45000, newRate: 45000 }),
    ));
  });

  test("nobody but the owner writes or reads the history", async () => {
    for (const role of ["instructor", "manager", "staff", "member", "outsider"]) {
      await assertFails(setDoc(
        historyDoc(users[role], `entry-by-${role}`),
        historyEntry({ changedBy: users[role] }),
      ), role);
    }
    await assertSucceeds(setDoc(historyDoc(users.owner, "entry-readable"), historyEntry()));
    for (const role of ["instructor", "manager", "staff", "outsider"]) {
      await assertFails(getDoc(historyDoc(users[role], "entry-readable")), role);
    }
  });

  test("the history cannot be rewritten or erased", async () => {
    // 고칠 수 있으면 "언제부터 이 금액이었나"가 이력이 아니라 주장이 된다.
    await assertSucceeds(setDoc(historyDoc(users.owner, "entry-fixed"), historyEntry()));
    await assertFails(updateDoc(historyDoc(users.owner, "entry-fixed"), { newRate: 99000 }));
    await assertFails(deleteDoc(historyDoc(users.owner, "entry-fixed")));
    await assertFails(setDoc(historyDoc(users.owner, "entry-fixed"), historyEntry({ newRate: 99000 })));
  });

  test("a history entry cannot be backdated far or filed under another name", async () => {
    await assertFails(setDoc(
      historyDoc(users.owner, "entry-old"),
      historyEntry({ effectiveFrom: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")) }),
    ));
    await assertFails(setDoc(
      historyDoc(users.owner, "entry-forged"),
      historyEntry({ changedBy: users.manager }),
    ));
    await assertFails(setDoc(
      historyDoc(users.owner, "entry-client-clock"),
      historyEntry({ createdAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")) }),
    ));
  });

  test("a history entry that hides which instructor it is about is refused", async () => {
    const broken = [
      { label: "no userId", drop: "userId" },
      { label: "no newRate", drop: "newRate" },
      { label: "no organization", drop: "organizationId" },
      { label: "other organization", patch: { organizationId: ORG_B } },
      { label: "rate as string", patch: { newRate: "45000" } },
      { label: "negative rate", patch: { newRate: -1 } },
      { label: "stray field", patch: { note: "승급" } },
    ];
    for (const item of broken) {
      const entry = historyEntry(item.patch || {});
      if (item.drop) delete entry[item.drop];
      await assertFails(setDoc(historyDoc(users.owner, "entry-broken"), entry), item.label);
    }
  });
});

/* 출석 체크(차감). 수업을 한 사람이 한 회차를 쓴다.

   차감은 원장에 항목을 쌓고 회원권의 잔여를 하나 줄인다. 원장은 append-only 라
   잘못 쌓인 항목을 지울 수 없으므로, 규칙이 받아 주는 모양을 여기서 좁게
   고정한다. */
describe("checking attendance against a pass", () => {
  const passDocOf = (userId, organizationId, passId) =>
    doc(dbFor(userId), "organizations", organizationId, COLLECTIONS.PASSES, passId);
  const ledgerDocOf = (userId, organizationId, passId, entryId) =>
    doc(dbFor(userId), "organizations", organizationId, COLLECTIONS.PASSES, passId, COLLECTIONS.LEDGER, entryId);

  const deductEntry = (overrides = {}) => ({
    organizationId: ORG_A,
    passId: PASS_A,
    clientId: "client-member",
    locationId: "location-a",
    type: "deduct",
    delta: -1,
    category: "pt_1_1_new",
    unitPrice: 25000,
    lessonId: "lesson-seed",
    instructorId: users.instructor,
    occurredAt: hoursAgo(2),
    createdAt: serverTimestamp(),
    createdBy: users.instructor,
    ...overrides,
  });

  test("an instructor appends a deduction", async () => {
    await assertSucceeds(setDoc(ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-deduct"), deductEntry()));
  });

  test("a deduction has to point at a lesson", async () => {
    /* 원장은 append-only 다. lessonId 없이 쌓인 항목은 나중에 채울 수 없고,
       "이 급여가 어느 수업에서 나왔나"를 영영 답할 수 없다. */
    const entry = deductEntry();
    delete entry.lessonId;
    await assertFails(setDoc(ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-no-lesson"), entry));
  });

  test("a deduction cannot add sessions", async () => {
    for (const delta of [1, 0]) {
      await assertFails(
        setDoc(ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-wrong-delta"), deductEntry({ delta })),
        String(delta),
      );
    }
  });

  test("a deduction carries the price it was taught at", async () => {
    for (const missing of ["category", "unitPrice", "instructorId"]) {
      const entry = deductEntry();
      delete entry[missing];
      await assertFails(setDoc(ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-bare"), entry), missing);
    }
  });

  test("nobody deducts from another organization's pass", async () => {
    await assertFails(setDoc(
      ledgerDocOf(users.outsider, ORG_B, PASS_B, "entry-crossing"),
      deductEntry({ organizationId: ORG_B, passId: PASS_B }),
    ));
    // 같은 사람이 남의 조직 경로로 자기 조직 본문을 밀어 넣는 것도 막힌다.
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, ORG_B, PASS_B, "entry-smuggled"),
      deductEntry({ passId: PASS_B }),
    ));
  });

  test("a deduction cannot be filed under someone else's name", async () => {
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-forged"),
      deductEntry({ createdBy: users.owner }),
    ));
  });

  test("a lesson older than the backdating window is refused", async () => {
    // 강사가 그날 밤에 몰아 누르는 것은 허용하고, 지난달 소급은 막는다.
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-old"),
      deductEntry({ occurredAt: Timestamp.fromDate(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)) }),
    ));
  });

  test("whoever teaches may spend one session", async () => {
    for (const role of ["owner", "manager", "instructor"]) {
      await assertSucceeds(
        updateDoc(passDocOf(users[role], ORG_A, PASS_A), { remainingCount: 19 }),
        role,
      );
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await updateDoc(doc(context.firestore(), "organizations", ORG_A, "passes", PASS_A), { remainingCount: 20 });
      });
    }
  });

  test("the remaining count never travels back upwards", async () => {
    /* 여기서 늘릴 수 있으면 누구든 회원이 사지 않은 수업을 스스로 줄 수 있고,
       그것을 반증할 원장은 append-only 라 고칠 수 없다. */
    for (const bad of [21, 20, 18, -1, "19"]) {
      await assertFails(
        updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), { remainingCount: bad }),
        String(bad),
      );
    }
  });

  test("an atomic decrement is seen by the rule as one step down", async () => {
    // increment(-1) 은 잠금 없이 줄인다. 규칙이 계산된 값을 보는지 확인한다.
    await assertSucceeds(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), { remainingCount: increment(-1) }));
    await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), { remainingCount: increment(-2) }));
    await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), { remainingCount: increment(1) }));
  });

  test("attendance touches the remaining count and nothing else", async () => {
    await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), {
      remainingCount: 19, contractPrice: 1,
    }));
    await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), {
      remainingCount: 19, instructorId: users.staff,
    }));
  });

  test("staff and outsiders do not spend sessions", async () => {
    // 데스크 직원은 수업을 하지 않는다.
    await assertFails(updateDoc(passDocOf(users.staff, ORG_A, PASS_A), { remainingCount: 19 }));
    await assertFails(updateDoc(passDocOf(users.outsider, ORG_A, PASS_A), { remainingCount: 19 }));
  });

  test("the lesson a deduction points at can be created by whoever taught it", async () => {
    await assertSucceeds(setDoc(
      doc(dbFor(users.instructor), "organizations", ORG_A, COLLECTIONS.LESSONS, "lesson-attendance"),
      {
        organizationId: ORG_A, lessonId: "lesson-attendance", clientId: "client-member",
        locationId: "location-a", instructorId: users.instructor,
        startsAt: hoursAgo(2), status: "completed",
        createdAt: serverTimestamp(), createdBy: users.instructor,
      },
    ));
    await assertSucceeds(setDoc(
      doc(dbFor(users.instructor), "organizations", ORG_A, COLLECTIONS.LESSONS, "lesson-attendance", COLLECTIONS.PARTICIPANTS, "client-member"),
      {
        organizationId: ORG_A, lessonId: "lesson-attendance",
        clientId: "client-member", attendanceStatus: "attended",
      },
    ));
  });

  test("a pass is issued with the price it will pay per session", async () => {
    // 차감이 읽을 값이다. 없으면 차감 시점에 표를 다시 보게 되고, 그 사이 바뀐
    // 단가가 지난 회원권에 소급된다.
    await assertFails(setDoc(
      passDocOf(users.manager, ORG_A, "pass-no-price"),
      dropField(passFixture(ORG_A, "pass-no-price"), "unitPrice"),
    ));
    await assertFails(setDoc(
      passDocOf(users.manager, ORG_A, "pass-string-price"),
      passFixture(ORG_A, "pass-string-price", { unitPrice: "25000" }),
    ));
    await assertSucceeds(setDoc(
      passDocOf(users.manager, ORG_A, "pass-priced"),
      passFixture(ORG_A, "pass-priced"),
    ));
  });
});

/* 강사 급여 화면은 원장을 collectionGroup 으로 가로질러 읽는다. 회원권마다
   하위 컬렉션이라 회원권을 하나씩 도는 방식은 센터 규모만큼 읽기가 늘어난다.

   그룹 쿼리는 중첩 경로의 규칙에 닿지 않으므로 match /{path=**}/ledger 가
   따로 있다. 그 문이 중첩 규칙보다 넓어지지 않았는지를 여기서 고정한다. */
describe("reading the ledger across passes", () => {
  const ledgerGroup = (userId) => collectionGroup(dbFor(userId), COLLECTIONS.LEDGER);
  const myDeductions = (userId, organizationId, instructorId) => query(
    ledgerGroup(userId),
    where("organizationId", "==", organizationId),
    where("instructorId", "==", instructorId),
    where("type", "==", "deduct"),
  );

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(
        doc(db, "organizations", ORG_A, "passes", PASS_A, "ledger", "entry-mine"),
        ledgerFixture(ORG_A, PASS_A, { instructorId: users.instructor }),
      );
      await setDoc(
        doc(db, "organizations", ORG_A, "passes", PASS_A, "ledger", "entry-theirs"),
        ledgerFixture(ORG_A, PASS_A, { instructorId: users.manager }),
      );
    });
  });

  test("an instructor reads their own month across every pass", async () => {
    const snapshot = await assertSucceeds(getDocs(myDeductions(users.instructor, ORG_A, users.instructor)));
    assert.ok(snapshot.size >= 1);
    for (const entry of snapshot.docs) {
      assert.equal(entry.data().instructorId, users.instructor);
    }
  });

  test("an instructor cannot read another instructor's month", async () => {
    // 본인 것만 본다는 것을 화면이 아니라 서버가 지킨다.
    await assertFails(getDocs(myDeductions(users.instructor, ORG_A, users.manager)));
  });

  test("an unfiltered group query is refused", async () => {
    /* organizationId 를 걸지 않으면 규칙이 평가할 것이 없어 쿼리 전체가 거부된다 --
       규칙 파일 머리말의 B 항목이 그 이야기다. */
    await assertFails(getDocs(ledgerGroup(users.instructor)));
    await assertFails(getDocs(query(ledgerGroup(users.instructor), where("type", "==", "deduct"))));
  });

  test("an owner and a manager read the whole organization", async () => {
    // 전 지점 급여 화면이 나중에 이 문으로 들어온다.
    for (const role of ["owner", "manager"]) {
      const snapshot = await assertSucceeds(getDocs(query(
        ledgerGroup(users[role]),
        where("organizationId", "==", ORG_A),
      )), role);
      assert.ok(snapshot.size >= 2, role);
    }
  });

  test("another organization's ledger stays out of reach", async () => {
    await assertFails(getDocs(query(ledgerGroup(users.instructor), where("organizationId", "==", ORG_B))));
    await assertFails(getDocs(query(ledgerGroup(users.outsider), where("organizationId", "==", ORG_A))));
    await assertFails(getDocs(query(ledgerGroup(null), where("organizationId", "==", ORG_A))));
  });

  test("the group door writes nothing", async () => {
    // 원장은 append-only 이고, 그 입구는 회원권 경로 하나뿐이다.
    await assertFails(updateDoc(
      doc(dbFor(users.instructor), "organizations", ORG_A, COLLECTIONS.PASSES, PASS_A, COLLECTIONS.LEDGER, "entry-mine"),
      { unitPrice: 99000 },
    ));
    await assertFails(deleteDoc(
      doc(dbFor(users.owner), "organizations", ORG_A, COLLECTIONS.PASSES, PASS_A, COLLECTIONS.LEDGER, "entry-mine"),
    ));
  });

  test("reading one entry through its pass still works", async () => {
    // 그룹 규칙을 더하면서 기존 경로가 좁아지지 않았는지.
    await assertSucceeds(getDoc(
      doc(dbFor(users.staff), "organizations", ORG_A, COLLECTIONS.PASSES, PASS_A, COLLECTIONS.LEDGER, "entry-theirs"),
    ));
  });
});

/* 만료일과, 원장 항목이 누구의 것인지. 둘 다 이번에 더한 필드다. */
describe("what a pass and its ledger must say", () => {
  const passDocOf = (userId, passId) =>
    doc(dbFor(userId), "organizations", ORG_A, COLLECTIONS.PASSES, passId);
  const ledgerDocOf = (userId, passId, entryId) =>
    doc(dbFor(userId), "organizations", ORG_A, COLLECTIONS.PASSES, passId, COLLECTIONS.LEDGER, entryId);

  test("a pass has to carry the expiry from the contract", async () => {
    // 회원이 가장 자주 묻는 값이고 회원 앱에도 들어간다.
    await assertFails(setDoc(
      passDocOf(users.manager, "pass-no-expiry"),
      dropField(passFixture(ORG_A, "pass-no-expiry"), "expiresAt"),
    ));
    for (const bad of ["2027-03-31", 1790000000, null]) {
      await assertFails(setDoc(
        passDocOf(users.manager, "pass-bad-expiry"),
        passFixture(ORG_A, "pass-bad-expiry", { expiresAt: bad }),
      ), JSON.stringify(bad));
    }
    await assertSucceeds(setDoc(
      passDocOf(users.manager, "pass-with-expiry"),
      passFixture(ORG_A, "pass-with-expiry"),
    ));
  });

  test("a ledger entry names the client, checked against its own pass", async () => {
    /* 원장은 append-only 다. 여기 잘못 적힌 이름은 영영 고칠 수 없으므로
       호출자를 믿지 않고 회원권에서 확인한다. */
    await assertSucceeds(setDoc(
      ledgerDocOf(users.instructor, PASS_A, "entry-named"),
      ledgerFixture(ORG_A, PASS_A),
    ));
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, PASS_A, "entry-wrong-client"),
      ledgerFixture(ORG_A, PASS_A, { clientId: "client-other" }),
    ));
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, PASS_A, "entry-no-client"),
      dropField(ledgerFixture(ORG_A, PASS_A), "clientId"),
    ));
  });

  test("an issue and a transfer name the client too", async () => {
    await assertSucceeds(setDoc(ledgerDocOf(users.owner, PASS_A, "entry-issue-named"), {
      ...ledgerFixture(ORG_A, PASS_A, { type: "issue", delta: 20, createdBy: users.owner }),
    }));
    await assertFails(setDoc(ledgerDocOf(users.owner, PASS_A, "entry-transfer-unnamed"), {
      organizationId: ORG_A, passId: PASS_A, locationId: "location-a",
      type: "transfer", delta: 0,
      fromInstructorId: users.instructor, toInstructorId: users.staff,
      occurredAt: serverTimestamp(), createdAt: serverTimestamp(), createdBy: users.owner,
    }));
  });
});

/* 강사-회원 누적. 급여 판정이 "이 강사에게 이 회원 누적 20회 미만이면 신규
   단가"를 묻는 근거이고, 원장으로는 셀 수 없어 따로 쌓는 숫자다.

   여기서 임의의 값을 쓸 수 있으면 누구든 자기 단가를 내릴 수도 올릴 수도
   있고, 그것을 반증할 원장은 append-only 라 고칠 수 없다. */
describe("counting what an instructor has taught a client", () => {
  const PAIR = `${users.instructor}_client-member`;
  const totalDoc = (userId, pairId = PAIR) =>
    doc(dbFor(userId), "organizations", ORG_A, COLLECTIONS.INSTRUCTOR_CLIENT_TOTALS, pairId);
  const total = (overrides = {}) => ({
    organizationId: ORG_A,
    instructorId: users.instructor,
    clientId: "client-member",
    sessions: 1,
    ...overrides,
  });
  const seed = async (sessions) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "organizations", ORG_A, "instructorClientTotals", PAIR),
        total({ sessions }),
      );
    });
  };

  test("the first lesson of a pair creates the count at one", async () => {
    for (const role of ["owner", "manager", "instructor"]) {
      await assertSucceeds(setDoc(totalDoc(users[role]), total()), role);
      await testEnv.clearFirestore();
      await seedAll();
    }
  });

  test("a first count of anything but one is refused", async () => {
    // 처음부터 큰 값을 넣을 수 있으면 신규 단가 구간을 건너뛸 수 있다.
    for (const sessions of [0, 2, 19, 99]) {
      await assertFails(setDoc(totalDoc(users.instructor), total({ sessions })), String(sessions));
    }
  });

  test("the owner may seed any count, for the october migration", async () => {
    // 엑셀에서 옮겨 온 누적을 심는다. 그 값을 아는 사람은 대표다.
    await assertSucceeds(setDoc(totalDoc(users.owner), total({ sessions: 99 })));
    await assertSucceeds(updateDoc(totalDoc(users.owner), { sessions: 7 }));
  });

  test("a count only ever climbs by one", async () => {
    await seed(19);
    await assertSucceeds(updateDoc(totalDoc(users.instructor), { sessions: 20 }));
    await seed(19);
    for (const bad of [21, 19, 18, 0, "20"]) {
      await assertFails(updateDoc(totalDoc(users.instructor), { sessions: bad }), String(bad));
    }
  });

  test("an atomic increment is seen by the rule as one step", async () => {
    await seed(19);
    await assertSucceeds(updateDoc(totalDoc(users.instructor), { sessions: increment(1) }));
    await seed(19);
    await assertFails(updateDoc(totalDoc(users.instructor), { sessions: increment(2) }));
    await assertFails(updateDoc(totalDoc(users.instructor), { sessions: increment(-1) }));
  });

  test("nothing else about the pair may change", async () => {
    await seed(5);
    for (const forbidden of [
      { instructorId: users.manager },
      { clientId: "client-other" },
      { organizationId: ORG_B },
      { sessions: 6, instructorId: users.manager },
    ]) {
      await assertFails(updateDoc(totalDoc(users.instructor), forbidden), JSON.stringify(forbidden));
    }
  });

  test("the document id has to be the pair it claims to be", async () => {
    // 한 쌍에 두 문서가 생기면 어느 쪽이 진짜 누적인지 알 수 없다.
    await assertFails(setDoc(totalDoc(users.instructor, "made-up-id"), total()));
    await assertFails(setDoc(
      totalDoc(users.instructor, `${users.manager}_client-member`),
      total(),
    ));
  });

  test("staff and outsiders do not touch the count", async () => {
    await assertFails(setDoc(totalDoc(users.staff), total()));
    await assertFails(setDoc(totalDoc(users.outsider), total()));
    await seed(5);
    await assertFails(updateDoc(totalDoc(users.staff), { sessions: 6 }));
    await assertFails(updateDoc(totalDoc(users.outsider), { sessions: 6 }));
  });

  test("the count is readable by the organization and nobody else", async () => {
    await seed(5);
    await assertSucceeds(getDoc(totalDoc(users.instructor)));
    await assertSucceeds(getDoc(totalDoc(users.staff)));
    await assertFails(getDoc(totalDoc(users.outsider)));
    await assertFails(getDoc(totalDoc(null)));
  });

  test("a count is never deleted", async () => {
    await seed(5);
    await assertFails(deleteDoc(totalDoc(users.owner)));
  });
});

/* 10월 이관이 실제로 쓰는 모양 그대로. 이 묶음이 통과하지 못하면 대표의 첫
   업로드가 통째로 거부되고, 그 사실은 이관 당일에야 드러난다.

   특히 회원권과 그 발급 항목은 한 배치로 나간다. 원장 규칙은 항목의 clientId 를
   상위 회원권에서 읽어 대조하는데, 그 회원권이 같은 배치 안에서 막 만들어진다.
   규칙의 get() 이 같은 배치의 쓰기를 보는지 아닌지는 문서가 아니라 여기가
   답한다. */
describe("the october migration writes what the rules accept", () => {
  beforeEach(seedAll);

  const CSV_CLIENT = "csv_01012345678";
  const CSV_PASS = `csv_${CSV_CLIENT}_2`;

  const migratedClient = () => ({
    organizationId: ORG_A,
    name: "김하나",
    phone: "01012345678",
    locationId: "location-a",
    status: CLIENT_STATUS.ACTIVE,
    createdBy: users.owner,
    createdAt: serverTimestamp(),
  });

  const migratedPass = () => passFixture(ORG_A, CSV_PASS, {
    clientId: CSV_CLIENT,
    purchaseRound: 2,
    // 9월 말 기준으로 남은 회차. 이미 진행한 회차는 옛 엑셀에 남는다.
    remainingCount: 8,
    serviceSessions: 2,
    category: "pt_1_1_repurchase_event",
    unitPrice: 30000,
    createdBy: users.owner,
  });

  const migratedIssueEntry = () => ({
    organizationId: ORG_A,
    passId: CSV_PASS,
    clientId: CSV_CLIENT,
    locationId: "location-a",
    type: "issue",
    delta: 8,
    category: "pt_1_1_repurchase_event",
    // 이관 항목은 지난 급여를 만들지 않는다. 계산은 앞으로의 차감부터다.
    unitPrice: 0,
    instructorId: users.instructor,
    occurredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: users.owner,
  });

  const migratedTotal = () => ({
    organizationId: ORG_A,
    instructorId: users.instructor,
    clientId: CSV_CLIENT,
    sessions: 35,
  });

  test("the owner creates a client out of a spreadsheet row", async () => {
    const db = dbFor(users.owner);
    await assertSucceeds(setDoc(doc(db, "organizations", ORG_A, "clients", CSV_CLIENT), migratedClient()));
  });

  test("the rules do not make the second upload safe — the repository has to", async () => {
    /* 같은 id 로 다시 쓰는 것은 create 가 아니라 update 다. 대표는 자기 센터의
       회원을 고칠 수 있는 사람이므로 규칙은 이것을 통과시킨다. 통과한다는 사실을
       여기에 못박아 둔다 -- migration-repository 가 쓰기 전에 있는지 확인하는
       이유가 이것이고, 누군가 그 확인을 "규칙이 막아 준다"며 지우면 두 번째
       업로드가 앱에서 고친 이름을 되돌린다. */
    const db = dbFor(users.owner);
    await assertSucceeds(setDoc(doc(db, "organizations", ORG_A, "clients", CSV_CLIENT), migratedClient()));
    await assertSucceeds(setDoc(doc(db, "organizations", ORG_A, "clients", CSV_CLIENT), migratedClient()));
  });

  test("a pass, its issue entry and the instructor's running total go up together", async () => {
    const db = dbFor(users.owner);
    const batch = writeBatch(db);
    batch.set(doc(db, "organizations", ORG_A, "passes", CSV_PASS), migratedPass());
    batch.set(
      doc(db, "organizations", ORG_A, "passes", CSV_PASS, "ledger", `${CSV_PASS}_issue`),
      migratedIssueEntry(),
    );
    batch.set(
      doc(db, "organizations", ORG_A, "instructorClientTotals", `${users.instructor}_${CSV_CLIENT}`),
      migratedTotal(),
    );
    await assertSucceeds(batch.commit());
  });

  test("only the owner seeds a running total that did not start at one", async () => {
    /* 누적 횟수가 급여 단가를 가른다. 매니저가 심을 수 있으면 그 숫자를
       올려 기준 단가를 앞당길 수 있다. */
    const totalFor = (userId) => doc(
      dbFor(userId), "organizations", ORG_A, "instructorClientTotals", `${users.instructor}_${CSV_CLIENT}`,
    );
    await assertFails(setDoc(totalFor(users.manager), migratedTotal()));
    await assertSucceeds(setDoc(totalFor(users.owner), migratedTotal()));
  });
});

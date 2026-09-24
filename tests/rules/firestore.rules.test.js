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
  deleteField,
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
import { netContractPriceFor } from "../../src/data/schema/deduction-pricing.js";
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
  const body = {
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
  /* 기타는 표에 단가가 없어 상품이 회당 단가를 들고 간다. 나머지 카테고리에서는
     이 필드가 있으면 거부된다. 테스트가 직접 넣은 값은 건드리지 않는다 --
     빠뜨렸을 때 거부되는지도 확인해야 하기 때문이다. */
  if (body.payCategory === "etc" && !("baseUnitPrice" in overrides)) body.baseUnitPrice = 25000;
  return body;
}

function hoursAgo(hours) {
  return Timestamp.fromMillis(Date.now() - hours * 60 * 60 * 1000);
}

function passFixture(organizationId, passId, overrides = {}) {
  const body = {
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
    baseUnitPrice: 25000,
    serviceUsed: 0,
    handedOver: false,
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)),
    instructorId: users.instructor,
    status: "active",
    createdBy: users.manager,
    createdAt: serverTimestamp(),
    ...overrides,
  };
  /* 부가세를 뺀 공급가액. 계약 금액과 결제 수단이 정하는 값이라 여기서 따라
     움직여야 한다 -- 고정된 숫자를 박아 두면 금액을 바꾼 테스트가 규칙이 아니라
     이 상수 때문에 거부된다. 일부러 망가뜨린 본문에서는 붙이지 않는다. */
  if (!("netContractPrice" in overrides)) {
    try {
      body.netContractPrice = netContractPriceFor(body.contractPrice, body.paymentMethod);
    } catch { /* 규칙이 거부하는지 보는 자리다. 이 필드는 선택이라 없어도 된다. */ }
  }
  return body;
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

  test("every centre role lists locations, and the member role does not", async () => {
    /* 지점 목록은 회원 등록·발급 화면이 쓴다. 가르치고 운영하는 네 역할은
       그대로 읽는다.

       role "member" 는 2026-09-23 에 닫혔다 (isCentreStaff). 회원 앱은 지점
       이름을 투영에서 받으므로 이 목록이 필요 없고, 열어 두면 소속 문서 하나로
       센터 구조가 드러난다. */
    for (const role of ["owner", "manager", "instructor", "staff"]) {
      await assertSucceeds(getDocs(locationsOf(users[role], ORG_A)), `${role} 이 지점을 읽을 수 있어야 한다`);
    }
    await assertFails(getDocs(locationsOf(users.member, ORG_A)));
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
    /* 회원 등록만 대표의 일이 됐다 -- canRegisterClient. 나머지 dual-write 경로
       (수업 · 참석자)는 가르치는 사람들에게 그대로 열려 있고, 그것이 여기서
       확인하려는 것이다. */
    await assertFails(setDoc(doc(staffDb, "organizations", ORG_A, "clients", "client-dual"), {
      organizationId: ORG_A,
      clientId: "client-dual",
      status: "active",
    }));
    await assertSucceeds(setDoc(doc(dbFor(users.owner), "organizations", ORG_A, "clients", "client-dual"), {
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

  test("only the owner and the FC manager register a member", async () => {
    /* 강사가 같은 사람을 다시 등록하면 같은 회원이 둘이 되고 수업 기록이
       갈라진다. FC매니저는 상담·계약을 받는 사람이라 2026-09-23 에 다시 열었다
       -- canRegisterClient. 읽기와 수정은 가르치는 사람들에게 그대로 열려 있다. */
    await assertSucceeds(setDoc(
      doc(dbFor(users.manager), "organizations", ORG_A, "clients", "client-by-manager"),
      registration({ createdBy: users.manager }),
    ));
    for (const userId of [users.instructor, users.staff, users.outsider]) {
      await assertFails(setDoc(
        doc(dbFor(userId), "organizations", ORG_A, "clients", `client-by-${userId}`),
        registration({ createdBy: userId }),
      ), userId);
    }
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
    /* 규칙을 조인 뒤에도 이관 경로가 살아 있어야 한다. locationId 는 레거시
       회원에게 아직 지점이 없을 때 null 로 온다.

       쓰는 사람이 대표다 -- 등록을 대표로 좁힌 뒤로 이 본문도 대표만 넣을 수
       있다. 이관은 원래 대표가 누르는 화면이라 경로는 그대로다. */
    await assertSucceeds(setDoc(clientRef(users.owner, "client-legacy"), {
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
      createdBy: users.owner,
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

  /* ── 이관이 쓰기 전에 하는 읽기 ─────────────────────────────────────────
     이관은 멱등해야 한다 -- 대표가 같은 파일을 두 번 올려도 앱에서 고친 값이
     되돌아가면 안 된다. 그래서 행마다 쓰기 전에 그 문서가 이미 있는지 읽는다.

     그 읽기는 대부분 "없는 문서" 를 향한다. 1차 업로드의 22행이 전부 새 회원이면
     22번 다 없는 문서다. 없는 문서의 get 에서 resource 는 null 이고,
     resource.data.organizationId 를 보는 조건은 그 자리에서 거부된다 --
     데이터가 아니라 규칙이 막은 것이고, 화면에는 permission-denied 한 줄로만
     돌아온다.

     이관은 1년에 한 번 누르는 기능이라 아무도 다시 눌러 보지 않는다. 여기에
     못을 박아 둔다. */

  test("staff may ask whether a client document exists, and get no for a missing one", async () => {
    const missing = (userId) => getDoc(doc(dbFor(userId), "organizations", ORG_A, "clients", "csv_01000000000"));
    for (const role of ["owner", "manager", "instructor", "staff"]) {
      const snapshot = await assertSucceeds(missing(users[role]), `${role} 이 없는 문서를 확인하지 못한다`);
      assert.equal(snapshot.exists(), false);
    }
  });

  test("asking about a document that is not there tells an outsider nothing", async () => {
    /* 명부를 훑을 수 없는 사람에게 존재 여부를 열어 주면 clientId 가 csv_{연락처}
       라서 "이 번호가 이 센터에 있는가" 를 물어보는 통로가 된다. */
    await assertFails(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "clients", "csv_01000000000")));
    await assertFails(getDoc(doc(dbFor(users.outsider), "organizations", ORG_A, "clients", "csv_01000000000")));
    await assertFails(getDoc(doc(dbFor(null), "organizations", ORG_A, "clients", "csv_01000000000")));
  });

  test("the migration's own sequence runs: ask, write, ask again", async () => {
    /* 이관 한 행이 실제로 지나는 길이다. 앞의 두 테스트는 조각을 보지만, 조각이
       다 서 있어도 순서가 막히면 업로드는 실패한다 -- 22행이 그렇게 실패했다.

       두 번째 물음이 "있다" 로 돌아오는 것이 멱등성의 전부다. 여기가 막히면
       두 번째 업로드가 앱에서 고친 값을 덮어쓴다. */
    const clientId = "csv_01044445555";
    const ref = () => doc(dbFor(users.owner), "organizations", ORG_A, "clients", clientId);

    const before = await assertSucceeds(getDoc(ref()));
    assert.equal(before.exists(), false, "쓰기 전에는 없다고 답해야 한다");

    await assertSucceeds(setDoc(ref(), {
      organizationId: ORG_A,
      name: "박세명",
      phone: "01044445555",
      locationId: "location-a",
      status: "active",
      createdAt: serverTimestamp(),
      createdBy: users.owner,
    }));

    const after = await assertSucceeds(getDoc(ref()));
    assert.equal(after.exists(), true, "두 번째 업로드가 이 답으로 덮어쓰기를 멈춘다");
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

  test("only the owner and the FC manager issue a pass", async () => {
    /* 발급은 그 순간 급여의 근거를 만들고, 원장은 append-only 라 고칠 수 없다.
       FC매니저에게는 2026-09-23 에 다시 열었다 -- canIssuePass. 강사는 여전히
       자기 앞으로 회원권을 만들 수 없다. */
    await assertSucceeds(setDoc(passRef(users.owner, ORG_A, "pass-by-owner"), passFixture(ORG_A, "pass-by-owner")));
    await assertSucceeds(setDoc(passRef(users.manager, ORG_A, "pass-by-manager"), passFixture(ORG_A, "pass-by-manager")));
    for (const userId of [users.instructor, users.staff]) {
      await assertFails(setDoc(
        passRef(userId, ORG_A, `pass-by-${userId}`),
        passFixture(ORG_A, `pass-by-${userId}`),
      ), userId);
    }
  });

  test("a pass whose organizationId disagrees with its path is rejected", async () => {
    await assertFails(setDoc(
      passRef(users.owner, ORG_A, "pass-wrong-org"),
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
    await assertFails(setDoc(passRef(users.owner, ORG_B, "pass-crossing"), passFixture(ORG_B, "pass-crossing")));
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

  test("only the owner and the FC manager add a product", async () => {
    await assertSucceeds(setDoc(productRef(users.owner, ORG_A, "product-by-owner"), productFixture(ORG_A)));
    await assertSucceeds(setDoc(
      productRef(users.manager, ORG_A, "product-by-manager"),
      productFixture(ORG_A, { createdBy: users.manager }),
    ));
    for (const userId of [users.instructor, users.staff]) {
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

  /* 기타만 회당 단가를 들고 간다. 표가 단가를 정해 주지 않는 카테고리가 그
     하나이고, 다른 카테고리에도 자리를 열어 두면 단가의 답이 둘이 된다 -- 표와
     어긋난 상품으로 발급된 회원권은 원장이 append-only 라 고칠 수 없다. */
  test("an etc product must carry the rate it will be issued at", async () => {
    await assertSucceeds(setDoc(
      productRef(users.owner, ORG_A, "product-etc-priced"),
      productFixture(ORG_A, { payCategory: "etc", baseUnitPrice: 28000 }),
    ));
    // 만원으로 떨어지지 않는 값이 실제로 쓰인다. 0원 상품도 있을 수 있다.
    await assertSucceeds(setDoc(
      productRef(users.owner, ORG_A, "product-etc-free"),
      productFixture(ORG_A, { payCategory: "etc", baseUnitPrice: 0 }),
    ));
    await assertFails(setDoc(
      productRef(users.owner, ORG_A, "product-etc-unpriced"),
      withoutField(productFixture(ORG_A, { payCategory: "etc" }), "baseUnitPrice"),
    ));
    for (const bad of [-1, "25000", 25000.5, null]) {
      await assertFails(setDoc(
        productRef(users.owner, ORG_A, `product-etc-bad-${String(bad)}`),
        productFixture(ORG_A, { payCategory: "etc", baseUnitPrice: bad }),
      ), JSON.stringify(bad));
    }
  });

  test("every other category is refused a rate of its own", async () => {
    for (const payCategory of ["pt_1_1_new", "pt_1_1_repurchase_normal", "service", "letmein"]) {
      await assertFails(setDoc(
        productRef(users.owner, ORG_A, `product-priced-${payCategory}`),
        productFixture(ORG_A, { payCategory, baseUnitPrice: 25000 }),
      ), payCategory);
    }
  });

  test("the rate cannot be added, changed or dropped after the fact", async () => {
    /* 상품은 고치지 않고 종료한 뒤 새로 추가한다. 단가만 예외로 두면 이미
       발급된 회원권이 팔린 조건과 다른 숫자를 가리키게 된다. */
    const etcRef = productRef(users.owner, ORG_A, "product-etc-locked");
    await assertSucceeds(setDoc(etcRef, productFixture(ORG_A, { payCategory: "etc", baseUnitPrice: 25000 })));
    await assertSucceeds(updateDoc(etcRef, { status: "archived" }));
    await assertFails(updateDoc(etcRef, { baseUnitPrice: 30000 }));
    await assertFails(updateDoc(etcRef, { status: "active", baseUnitPrice: 30000 }));
    await assertFails(updateDoc(etcRef, { baseUnitPrice: deleteField() }));
    // 없던 상품에 나중에 붙이는 것도 막는다.
    await assertFails(updateDoc(productRef(users.owner, ORG_A, PRODUCT_A), { baseUnitPrice: 25000 }));
  });

  test("only the owner and the FC manager archive, and nobody deletes", async () => {
    await assertFails(updateDoc(productRef(users.instructor, ORG_A, PRODUCT_A), { status: "archived" }));
    await assertSucceeds(updateDoc(productRef(users.manager, ORG_A, PRODUCT_A), { status: "archived" }));
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
      ledgerRef(users.owner, "ok-issue"),
      withoutField(ledgerFixture(ORG_A, PASS_A, {
        type: "issue",
        delta: 20,
        instructorId: users.manager,
        createdBy: users.owner,
      }), "lessonId"),
    ));
    await assertFails(setDoc(
      ledgerRef(users.instructor, "deduct-without-lesson"),
      withoutField(ledgerFixture(ORG_A, PASS_A), "lessonId"),
    ));
  });

  test("only the owner and the FC manager append an issue entry", async () => {
    /* 발급 항목은 회원권 문서와 한 배치로 쓰인다. 회원권 쪽만 좁히면 강사가
       이미 있는 회원권에 "20회 발급" 한 줄을 덧붙일 수 있고, 회원 이력 화면이
       그것을 그대로 읽는다. 두 반쪽은 같은 문(canIssuePass)을 통과해야 한다. */
    await assertSucceeds(setDoc(
      ledgerRef(users.manager, "issue-by-manager"),
      withoutField(ledgerFixture(ORG_A, PASS_A, {
        type: "issue", delta: 20, instructorId: users.instructor, createdBy: users.manager,
      }), "lessonId"),
    ));
    for (const userId of [users.instructor, users.staff]) {
      await assertFails(setDoc(
        ledgerRef(userId, `issue-by-${userId}`),
        withoutField(ledgerFixture(ORG_A, PASS_A, {
          type: "issue", delta: 20, instructorId: userId, createdBy: userId,
        }), "lessonId"),
      ), userId);
    }
    // 차감은 가르치는 사람들에게 그대로 열려 있다.
    await assertSucceeds(setDoc(
      ledgerRef(users.instructor, "deduct-by-instructor"),
      ledgerFixture(ORG_A, PASS_A, { instructorId: users.instructor, createdBy: users.instructor }),
    ));
  });

  test("delta must be a non-zero int", async () => {
    await assertFails(setDoc(ledgerRef(users.instructor, "delta-string"), ledgerFixture(ORG_A, PASS_A, { delta: "-1" })));
    await assertFails(setDoc(ledgerRef(users.instructor, "delta-zero"), ledgerFixture(ORG_A, PASS_A, { delta: 0 })));
  });

  test("delta has to agree in sign with the entry type", async () => {
    await assertFails(setDoc(ledgerRef(users.instructor, "deduct-positive"), ledgerFixture(ORG_A, PASS_A, { delta: 1 })));
    await assertFails(setDoc(ledgerRef(users.owner, "issue-negative"), withoutField(ledgerFixture(ORG_A, PASS_A, {
      type: "issue",
      delta: -20,
      instructorId: users.manager,
      createdBy: users.owner,
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
      ledgerRef(users.owner, "issue-no-occurred"),
      withoutField(withoutField(ledgerFixture(ORG_A, PASS_A, {
        type: "issue",
        delta: 20,
        instructorId: users.manager,
        createdBy: users.owner,
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
      passRef(users.owner, "pass-backdated"),
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
      passRef(users.owner, "pass-adjusted"),
      passFixture(ORG_A, "pass-adjusted", {
        totalSessions: 18,
        serviceSessions: 2,
        contractPrice: 990000,
        purchaseRound: 3,
      }),
    ));
    for (const field of ["productId", "totalSessions", "serviceSessions", "contractPrice", "paymentMethod", "purchaseRound", "instructorId", "baseUnitPrice", "remainingCount", "expiresAt", "handedOver"]) {
      await assertFails(setDoc(
        passRef(users.owner, `pass-missing-${field}`),
        withoutField(passFixture(ORG_A, `pass-missing-${field}`), field),
      ));
    }
  });

  test("the net price may be absent but never larger than the contract", async () => {
    /* 부원장의 5:5 가 이 값을 반으로 접는다. 세금이 붙어 계약보다 커질 수는
       없고, 뒤집힌 값이 들어오면 그 강사의 회당 단가가 계약보다 높아진다. */
    await assertSucceeds(setDoc(
      passRef(users.owner, "pass-net-ok"),
      passFixture(ORG_A, "pass-net-ok", { contractPrice: 1100000, netContractPrice: 1000000 }),
    ));
    // 이 필드가 생기기 전의 회원권. 없으면 차감이 결제 수단으로 다시 계산한다.
    await assertSucceeds(setDoc(
      passRef(users.owner, "pass-net-absent"),
      withoutField(passFixture(ORG_A, "pass-net-absent"), "netContractPrice"),
    ));
    await assertSucceeds(setDoc(
      passRef(users.owner, "pass-net-equal"),
      passFixture(ORG_A, "pass-net-equal", { contractPrice: 1000000, netContractPrice: 1000000 }),
    ));
    for (const bad of [1200001, -1, "1090909", 1090909.5]) {
      await assertFails(setDoc(
        passRef(users.owner, `pass-net-bad-${String(bad)}`),
        passFixture(ORG_A, `pass-net-bad-${String(bad)}`, { netContractPrice: bad }),
      ), String(bad));
    }
  });

  test("serviceSessions may be zero but never negative or fractional", async () => {
    await assertSucceeds(setDoc(
      passRef(users.owner, "pass-service-zero"),
      passFixture(ORG_A, "pass-service-zero", { serviceSessions: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-service-negative"),
      passFixture(ORG_A, "pass-service-negative", { serviceSessions: -1 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-service-string"),
      passFixture(ORG_A, "pass-service-string", { serviceSessions: "2" }),
    ));
  });

  test("contractPrice may be zero but never negative or a string", async () => {
    await assertSucceeds(setDoc(
      passRef(users.owner, "pass-price-zero"),
      passFixture(ORG_A, "pass-price-zero", { contractPrice: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-price-negative"),
      passFixture(ORG_A, "pass-price-negative", { contractPrice: -1 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-price-string"),
      passFixture(ORG_A, "pass-price-string", { contractPrice: "990000" }),
    ));
  });

  test("purchaseRound starts at one", async () => {
    await assertSucceeds(setDoc(
      passRef(users.owner, "pass-round-four"),
      passFixture(ORG_A, "pass-round-four", { purchaseRound: 4 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-round-zero"),
      passFixture(ORG_A, "pass-round-zero", { purchaseRound: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-round-string"),
      passFixture(ORG_A, "pass-round-string", { purchaseRound: "1" }),
    ));
  });

  test("every payment method is accepted and nothing else is", async () => {
    assert.equal(PAYMENT_METHODS.length, 5);
    for (const paymentMethod of PAYMENT_METHODS) {
      await assertSucceeds(setDoc(
        passRef(users.owner, `pass-pay-${paymentMethod}`),
        passFixture(ORG_A, `pass-pay-${paymentMethod}`, { paymentMethod }),
      ));
    }
    for (const bogus of ["Card", "credit", "", "kakao"]) {
      await assertFails(setDoc(
        passRef(users.owner, `pass-pay-bad-${bogus || "empty"}`),
        passFixture(ORG_A, `pass-pay-bad-${bogus || "empty"}`, { paymentMethod: bogus }),
      ));
    }
  });

  test("a pass needs its product fields and a positive session count", async () => {
    await assertSucceeds(setDoc(passRef(users.owner, "pass-valid"), passFixture(ORG_A, "pass-valid")));
    await assertFails(setDoc(
      passRef(users.owner, "pass-no-product"),
      withoutField(passFixture(ORG_A, "pass-no-product"), "productId"),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-no-client"),
      withoutField(passFixture(ORG_A, "pass-no-client"), "clientId"),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-zero-sessions"),
      passFixture(ORG_A, "pass-zero-sessions", { totalSessions: 0 }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-string-sessions"),
      passFixture(ORG_A, "pass-string-sessions", { totalSessions: "20" }),
    ));
    await assertFails(setDoc(
      passRef(users.owner, "pass-int-status"),
      passFixture(ORG_A, "pass-int-status", { status: 1 }),
    ));
  });
});

/* 강사를 센터에 붙이는 문. 여기까지는 소속 문서가 콘솔이나 이관 도구로만 생겼다.

   대표가 앱에서 붙일 수 있게 열되, 그 문으로 대표를 세우거나 자기 자신을 붙일 수
   없어야 한다 -- 둘 다 되돌릴 문이 없다. */
describe("the owner attaches instructors to the centre", () => {
  const membershipRef = (userId, documentId) => doc(dbFor(userId), "memberships", documentId);
  const NEW_USER = "uid-newcomer";
  const newMembership = (overrides = {}) => ({
    organizationId: ORG_A,
    userId: NEW_USER,
    role: "instructor",
    status: "active",
    displayName: "박서연",
    title: "team_lead",
    locationId: "location-a",
    createdAt: serverTimestamp(),
    createdBy: users.owner,
    ...overrides,
  });

  test("only the owner may attach someone", async () => {
    await assertSucceeds(setDoc(membershipRef(users.owner, `${ORG_A}_${NEW_USER}`), newMembership()));
    for (const userId of [users.manager, users.instructor, users.staff, users.outsider]) {
      await assertFails(setDoc(
        membershipRef(userId, `${ORG_A}_uid-by-${userId}`),
        newMembership({ userId: `uid-by-${userId}`, createdBy: userId }),
      ), userId);
    }
  });

  test("the document id has to be the organization-user pair", async () => {
    /* 규칙의 membershipId() 와 형식이 다르면 isActiveMember 가 영영 찾지 못하는
       소속이 만들어진다 -- 붙였는데 아무것도 안 보이는 상태다. */
    for (const documentId of [NEW_USER, `${ORG_B}_${NEW_USER}`, `${ORG_A}-${NEW_USER}`, `${ORG_A}_other`]) {
      await assertFails(setDoc(membershipRef(users.owner, documentId), newMembership()), documentId);
    }
  });

  test("nobody attaches themselves, and no owner is minted here", async () => {
    /* 자기 소속을 자기가 만들 수 있으면 아무나 아무 센터의 대표가 된다. 그리고
       이 문으로 owner 를 만들 수 있으면 대표 한 사람이 아무 계정이나 자기와 같은
       자리에 올릴 수 있고, 그것을 되돌리는 문은 없다. */
    await assertFails(setDoc(
      membershipRef(users.owner, `${ORG_A}_${users.owner}`),
      newMembership({ userId: users.owner }),
    ), "자기 자신");
    await assertFails(setDoc(
      membershipRef(users.owner, `${ORG_A}_${NEW_USER}`),
      newMembership({ role: "owner" }),
    ), "대표를 앱에서 세우지 않는다");
  });

  test("an attached membership starts active, named, and with a listed title", async () => {
    for (const overrides of [
      { status: "invited" },
      { status: "revoked" },
      { displayName: "" },
      { displayName: 7 },
      { title: "deputy_director" },
      { title: "owner" },
      { locationId: "" },
      { role: "member" },
    ]) {
      await assertFails(setDoc(
        membershipRef(users.owner, `${ORG_A}_${NEW_USER}`),
        newMembership(overrides),
      ), JSON.stringify(overrides));
    }
  });

  test("the two pay fields never come in through the attach door", async () => {
    /* 풀방금액과 부원장은 각자의 문으로만 들어온다. 그 문들은 rateHistory 와
       감사 항목을 같은 배치에 요구한다 -- 여기서 함께 받으면 이력 없이 단가가
       정해지는 길이 하나 생긴다. */
    await assertFails(setDoc(
      membershipRef(users.owner, `${ORG_A}_${NEW_USER}`),
      newMembership({ fullRoomRate: 45000 }),
    ));
    await assertFails(setDoc(
      membershipRef(users.owner, `${ORG_A}_${NEW_USER}`),
      newMembership({ isDeputyDirector: true }),
    ));
  });

  test("a client-made timestamp or a forged author is refused", async () => {
    await assertFails(setDoc(
      membershipRef(users.owner, `${ORG_A}_${NEW_USER}`),
      newMembership({ createdAt: hoursAgo(24) }),
    ));
    await assertFails(setDoc(
      membershipRef(users.owner, `${ORG_A}_${NEW_USER}`),
      newMembership({ createdBy: users.manager }),
    ));
  });

  test("the owner edits name, title and location together and nothing else", async () => {
    const ref = membershipRef(users.owner, `${ORG_A}_${users.instructor}`);
    await assertSucceeds(updateDoc(ref, {
      displayName: "정예진", title: "branch_manager", locationId: "location-b",
    }));
    await assertSucceeds(updateDoc(ref, { displayName: "정예진2" }));
    await assertFails(updateDoc(ref, { title: "deputy_director" }));
    await assertFails(updateDoc(ref, { locationId: "" }));
    await assertFails(updateDoc(ref, { displayName: "" }));
    // role 과 organizationId 는 어느 문으로도 움직이지 않는다.
    await assertFails(updateDoc(ref, { displayName: "정예진", role: "manager" }));
    await assertFails(updateDoc(ref, { displayName: "정예진", organizationId: ORG_B }));
    // 대표 말고는 남의 이름을 못 쓴다. 본인 문은 displayName 하나뿐이다.
    await assertFails(updateDoc(
      membershipRef(users.manager, `${ORG_A}_${users.instructor}`),
      { displayName: "남이 고침" },
    ));
    await assertFails(updateDoc(
      membershipRef(users.instructor, `${ORG_A}_${users.instructor}`),
      { displayName: "내 이름", title: "team_lead" },
    ), "본인 문은 이름 하나만 연다");
  });

  test("retiring moves the status and only between the two values", async () => {
    const ref = membershipRef(users.owner, `${ORG_A}_${users.staff}`);
    await assertSucceeds(updateDoc(ref, { status: "revoked" }));
    await assertSucceeds(updateDoc(ref, { status: "active" }));
    for (const status of ["invited", "suspended", "deleted", 1]) {
      await assertFails(updateDoc(ref, { status }), String(status));
    }
    await assertFails(updateDoc(ref, { status: "revoked", role: "member" }));
  });

  test("an owner cannot retire themselves, and nobody else can retire anyone", async () => {
    /* 대표가 자기 소속을 회수하면 그 센터에 owner 가 없어지고, 되돌릴 문이 아무
       데도 없다. */
    await assertFails(updateDoc(
      membershipRef(users.owner, `${ORG_A}_${users.owner}`),
      { status: "revoked" },
    ));
    for (const userId of [users.manager, users.instructor, users.staff]) {
      await assertFails(updateDoc(
        membershipRef(userId, `${ORG_A}_${users.staff}`),
        { status: "revoked" },
      ), userId);
    }
  });

  test("an owner of another centre reaches none of these doors", async () => {
    await assertFails(setDoc(
      membershipRef(users.outsider, `${ORG_A}_uid-crossing`),
      newMembership({ userId: "uid-crossing", createdBy: users.outsider }),
    ));
    await assertFails(updateDoc(
      membershipRef(users.outsider, `${ORG_A}_${users.instructor}`),
      { status: "revoked" },
    ));
  });

  test("a membership is never deleted, only retired", async () => {
    /* 지우면 급여 화면이 그 이름을 붙일 곳을 잃는다. 원장은 그 사람의 수업을
       그대로 들고 있는데. */
    await assertFails(deleteDoc(membershipRef(users.owner, `${ORG_A}_${users.instructor}`)));
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

  /* ── 회원에게 보낼 말 ────────────────────────────────────────────────

     규칙은 처음부터 이 모양이었고 쓰는 코드만 없었다. 이제 쓰는 코드가
     생겼으니, 그 코드가 실제로 통과하는지를 규칙 엔진에 직접 묻는다 --
     "통과할 것이다" 와 "통과한다" 는 다른 말이다. */

  const memberNotePath = (user, noteId) => doc(dbFor(user), "organizations", ORG_A, "lessonNotes", noteId);

  test("an instructor can write a member-facing note", async () => {
    await assertSucceeds(setDoc(memberNotePath(users.instructor, "lesson-1_client-member"), {
      organizationId: ORG_A, clientId: "client-member", lessonId: "lesson-1",
      memberNote: "오늘 정말 잘하셨어요",
      instructorId: users.instructor, createdBy: users.instructor,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  test("revising the note must not resend createdAt", async () => {
    /* immutable 은 값이 아니라 건드린 필드를 본다(affectedKeys). createdAt 에
       serverTimestamp 를 다시 실으면 값이 달라져 고치기가 통째로 거부되고,
       강사에게는 "권한이 없습니다" 로만 보인다. 리포지토리가 처음인지
       고치는지를 먼저 읽는 이유가 이것이다. */
    const note = memberNotePath(users.instructor, "note-seed");
    await assertSucceeds(setDoc(note, { memberNote: "고친 말", updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(note, { memberNote: "또 고친 말", createdAt: serverTimestamp() }, { merge: true }));
  });

  test("only the instructor who wrote it can revise it", async () => {
    // note-seed 의 createdBy 는 instructor 다.
    await assertFails(setDoc(memberNotePath(users.owner, "note-seed"), {
      memberNote: "대표가 고친 말", updatedAt: serverTimestamp(),
    }, { merge: true }));
  });

  test("the member never reads or writes the note directly", async () => {
    /* 회원 앱은 투영 두 컬렉션만 읽는다. 이 문서에는 userId 가 없으므로 회원
       본인도 열지 못하고, 강사가 적은 말은 투영을 거쳐서만 간다. */
    await assertFails(setDoc(memberNotePath(users.member, "lesson-2_client-member"), {
      organizationId: ORG_A, clientId: "client-member", lessonId: "lesson-2",
      memberNote: "회원이 쓴 말", createdBy: users.member,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  test("the note cannot be moved to another member after the fact", async () => {
    await assertFails(setDoc(memberNotePath(users.instructor, "note-seed"), {
      clientId: "someone-else", updatedAt: serverTimestamp(),
    }, { merge: true }));
  });

  test("a note is never deleted", async () => {
    /* 지우기는 빈 문자열로 저장된다. 보냈다가 거둬들인 사실은 남는 편이 낫고,
       무엇보다 규칙이 삭제를 막는다. */
    await assertFails(deleteDoc(memberNotePath(users.instructor, "note-seed")));
    await assertFails(deleteDoc(memberNotePath(users.owner, "note-seed")));
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

  /* ── 듀엣: 회원권 하나에 회원 둘 ───────────────────────────────────────
     계약서가 하나이고 회원권도 하나다. clientId 는 그대로 두고 clientIds 를
     더하며, 불변식은 clientIds[0] == clientId 다 -- 아래 원장 문이 항목을
     pass.clientId 에 못 박고 있어서, 대표가 흔들리면 규칙이 가리키는 사람과
     원장이 가리키는 사람이 달라진다. */

  test("a pass may name a second member, and the anchor must come first", async () => {
    await assertSucceeds(setDoc(
      passDoc(users.owner, "pass-duet"),
      passFixture(ORG_A, "pass-duet", {
        clientId: "client-member", clientIds: ["client-member", "client-partner"],
        category: "pt_2_1_new", baseUnitPrice: 30000,
      }),
    ));
    // 1:1 도 같은 모양을 쓸 수 있다. 읽는 쪽이 갈래를 만들지 않게.
    await assertSucceeds(setDoc(
      passDoc(users.owner, "pass-solo-list"),
      passFixture(ORG_A, "pass-solo-list", { clientIds: ["client-member"] }),
    ));
    // 없어도 된다. 이관된 회원권과 이 기능 전에 발급된 것이 전부 그렇다.
    await assertSucceeds(setDoc(passDoc(users.owner, "pass-no-list"), passFixture(ORG_A, "pass-no-list")));
  });

  test("a pass refuses a list that would make the ledger point elsewhere", async () => {
    const bad = (id, overrides) => setDoc(passDoc(users.owner, id), passFixture(ORG_A, id, overrides));
    // 대표가 첫 번째가 아니다.
    await assertFails(bad("pass-wrong-anchor", { clientIds: ["client-partner", "client-member"] }));
    await assertFails(bad("pass-missing-anchor", { clientIds: ["client-partner"] }));
    // 셋은 아직 없다.
    await assertFails(bad("pass-trio", { clientIds: ["client-member", "b", "c"] }));
    await assertFails(bad("pass-empty-list", { clientIds: [] }));
    await assertFails(bad("pass-not-a-list", { clientIds: "client-member" }));
    /* 같은 사람을 두 번. 회차는 하나인데 누적이 둘 올라가서 20회 판정이 실제의
       두 배 속도로 지나간다. */
    await assertFails(bad("pass-same-twice", { clientIds: ["client-member", "client-member"] }));
  });

  test("who shares a pass is settled at issue and never edited afterwards", async () => {
    /* 나중에 바꾸면 이미 차감된 회차가 누구의 것이었는지 소급해서 달라지고,
       원장은 append-only 라 고칠 수 없다. 대표라도 막는다 -- 듀엣이 깨지면
       취소하고 다시 발급한다. */
    await assertFails(updateDoc(passDoc(users.owner, PASS_A), { clientIds: ["client-member", "client-partner"] }));
    await assertFails(updateDoc(passDoc(users.owner, PASS_A), { clientId: "client-partner" }));
    // 나머지 문은 그대로 열려 있다.
    await assertSucceeds(updateDoc(passDoc(users.owner, PASS_A), { contractPrice: 1100000 }));
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
    /* 이 경로로 role 이 바뀌면 대표가 실수 한 번으로 강사를 대표로 올릴 수 있다.
       status 는 자기 문이 따로 있다 (퇴사) -- 그쪽은 active ↔ revoked 만 오가고
       자기 자신에게는 쓸 수 없다. 여기서는 금액과 함께 실려 나가지 못한다. */
    for (const forbidden of [
      { role: "owner" },
      { organizationId: ORG_B },
      { userId: users.owner },
      { fullRoomRate: 45000, role: "owner" },
      { fullRoomRate: 45000, status: "revoked" },
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

  test("a half-filled membership is still refused, and none is ever deleted", async () => {
    /* 대표가 강사를 붙이는 문은 열렸지만(아래 describe 참고) 본문은 닫힌 집합이다.
       이름도 작성자도 없는 문서는 그 문으로도 들어오지 못한다 -- 이름이 없으면
       목록이 uid 로 되돌아간다. */
    await assertFails(setDoc(
      doc(dbFor(users.owner), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_newcomer`),
      { organizationId: ORG_A, userId: "newcomer", role: "instructor", status: "active" },
    ));
    // 지우면 급여 화면이 그 이름을 붙일 곳을 잃는다. 퇴사는 status 로만 한다.
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

  test("the owner writes a name, and nobody else writes another's", async () => {
    /* 강사 관리 화면이 이름을 정한다 -- 강사가 앱을 한 번도 안 열었으면 이름을
       채울 사람이 대표뿐이고, 그때까지 목록은 uid 로 서 있다. 열었으면 본인이
       쓴 이름이 그대로 남는다. */
    await assertSucceeds(updateDoc(membershipDoc(users.owner), { displayName: "정예진" }));
    await assertFails(updateDoc(membershipDoc(users.manager), { displayName: "남의이름" }));
    await assertFails(updateDoc(membershipDoc(users.staff), { displayName: "남의이름" }));
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
/* 감사 로그. 되돌릴 수 없거나 돈에 닿는 조작만 남는다.

   최상위 컬렉션이라 경로가 조직을 고정해 주지 않는다. 그래서 읽는 쪽이 반드시
   organizationId 로 좁혀야 하고, 좁히지 않으면 규칙이 평가할 것이 없어 쿼리
   전체가 거부된다 -- 이 파일 머리말의 class B. 이 컬렉션이 그 함정의 첫 실사용자다. */
describe("the audit log", () => {
  beforeEach(seedAll);

  const auditRef = (userId, logId) => doc(dbFor(userId), COLLECTIONS.AUDIT_LOGS, logId);
  const auditCollection = (userId) => collection(dbFor(userId), COLLECTIONS.AUDIT_LOGS);

  const rateEntry = (overrides = {}) => ({
    organizationId: ORG_A,
    actorId: users.owner,
    actorRole: "owner",
    action: "full_room_rate_set",
    targetId: users.instructor,
    amount: 50000,
    previousAmount: 45000,
    createdAt: serverTimestamp(),
    ...overrides,
  });

  const seedOne = async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), COLLECTIONS.AUDIT_LOGS, "audit-seed"), {
        ...rateEntry(), createdAt: hoursAgo(1),
      });
      // 남의 조직 것도 하나 둔다 -- 조직을 좁히지 않은 쿼리가 무엇을 긁는지 보려면.
      await setDoc(doc(context.firestore(), COLLECTIONS.AUDIT_LOGS, "audit-seed-b"), {
        ...rateEntry({ organizationId: ORG_B, actorId: users.outsider }), createdAt: hoursAgo(1),
      });
    });
  };

  test("a list without the organization filter is refused", async () => {
    /* 규칙이 resource.data.organizationId 를 보는데 쿼리가 그 필드를 좁히지
       않으면, Firestore 는 false 가 아니라 "Property is undefined" 로 쿼리
       전체를 거부한다. 그 거부는 화면에 빈 목록으로 도착하고, 빈 목록은 "이달
       조작이 없었다"와 구별되지 않는다.

       컬렉션이 비어 있으면 평가할 문서가 없어 조용히 통과하므로, 먼저 하나를
       심어 둔다 -- locations 에서 그 구멍 때문에 결함을 반년 놓쳤다. */
    await seedOne();
    await assertFails(getDocs(auditCollection(users.owner)));
    await assertSucceeds(getDocs(query(auditCollection(users.owner), where("organizationId", "==", ORG_A))));
  });

  test("only the owner reads it, and only their own centre's", async () => {
    await seedOne();
    const mine = (userId) => query(auditCollection(userId), where("organizationId", "==", ORG_A));
    await assertSucceeds(getDocs(mine(users.owner)));
    // 매니저도 못 본다. 센터 전체의 조작 이력은 한 사람의 것이 아니다.
    await assertFails(getDocs(mine(users.manager)));
    await assertFails(getDocs(mine(users.instructor)));
    await assertFails(getDocs(mine(users.staff)));
    await assertFails(getDocs(mine(users.outsider)));
    await assertFails(getDocs(mine(null)));
    // 조직을 좁혀도 남의 조직은 열리지 않는다.
    await assertFails(getDocs(query(auditCollection(users.owner), where("organizationId", "==", ORG_B))));
  });

  test("the owner records what only the owner can do", async () => {
    /* 동작마다 말이 되는 칸이 다르다. 말이 안 되는 칸은 빼고 쓴다 -- null 로
       채우면 규칙이 거부한다. 0 이나 null 을 진짜 값으로 읽히게 두지 않으려는
       것이고, 그것이 여기서도 그대로 확인된다. */
    await assertSucceeds(setDoc(auditRef(users.owner, "audit-rate"), rateEntry()));

    const deputy = rateEntry({ action: "deputy_director_set", enabled: true });
    delete deputy.amount;
    delete deputy.previousAmount;
    await assertSucceeds(setDoc(auditRef(users.owner, "audit-deputy"), deputy));

    const migration = rateEntry({
      action: "migration_uploaded", stage: "clients", succeeded: 118, failed: 2,
    });
    delete migration.amount;
    delete migration.previousAmount;
    delete migration.targetId;
    await assertSucceeds(setDoc(auditRef(users.owner, "audit-migration"), migration));

    // null 은 "값이 없다"가 아니라 잘못된 값이다.
    await assertFails(setDoc(auditRef(users.owner, "audit-null"), rateEntry({ amount: null })));
  });

  test("nobody else records anything", async () => {
    for (const role of ["manager", "instructor", "staff", "outsider"]) {
      await assertFails(setDoc(auditRef(users[role], `audit-by-${role}`), rateEntry({
        actorId: users[role], actorRole: role,
      })), role);
    }
  });

  test("an entry cannot be filed under someone else's name or role", async () => {
    /* 거짓말한 행위자나 역할이 남으면 이 기록은 없는 것보다 해롭다 -- 있는
       그대로라고 믿고 읽게 된다. */
    await assertFails(setDoc(auditRef(users.owner, "audit-forged-actor"), rateEntry({
      actorId: users.manager,
    })));
    await assertFails(setDoc(auditRef(users.owner, "audit-forged-role"), rateEntry({
      actorRole: "instructor",
    })));
  });

  test("a made-up action and a backdated time are both refused", async () => {
    await assertFails(setDoc(auditRef(users.owner, "audit-made-up"), rateEntry({
      action: "pass_cancelled",
    })));
    // 발급·교체·차감은 원장에 남는다. 여기에 두 벌째를 만들지 않는다.
    await assertFails(setDoc(auditRef(users.owner, "audit-duplicate"), rateEntry({
      action: "pass_deducted",
    })));
    await assertFails(setDoc(auditRef(users.owner, "audit-backdated"), rateEntry({
      createdAt: hoursAgo(24),
    })));
  });

  test("there is no field a member's name could travel in", async () => {
    /* 이름은 개명과 오타 수정으로 바뀌는데 이 컬렉션은 고칠 수 없고, 삭제
       요청이 왔을 때 지울 수도 없다. 칸 자체를 두지 않는다. */
    for (const extra of [{ clientName: "김하나" }, { summary: "김하나님 회원권" }, { note: "메모" }]) {
      await assertFails(
        setDoc(auditRef(users.owner, "audit-with-name"), rateEntry(extra)),
        Object.keys(extra)[0],
      );
    }
  });

  test("an audit entry is never edited or removed", async () => {
    await seedOne();
    await assertFails(updateDoc(auditRef(users.owner, "audit-seed"), { amount: 1 }));
    await assertFails(deleteDoc(auditRef(users.owner, "audit-seed")));
  });
});

/* 부원장은 카테고리도 누적도 인수인계도 보지 않고 계약 금액의 5:5 를 받는다.
   급여 판정에서 가장 강한 플래그라, 누가 그것을 켤 수 있는가가 곧 누가 자기
   급여를 두 배로 만들 수 있는가다. */
describe("who may name a deputy director", () => {
  beforeEach(seedAll);

  const membershipDocOf = (userId, subjectId) =>
    doc(dbFor(userId), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${subjectId}`);

  test("the owner names someone else a deputy", async () => {
    await assertSucceeds(updateDoc(membershipDocOf(users.owner, users.instructor), { isDeputyDirector: true }));
    await assertSucceeds(updateDoc(membershipDocOf(users.owner, users.instructor), { isDeputyDirector: false }));
  });

  test("nobody names themselves a deputy, not even the owner", async () => {
    /* 대표가 직접 수업을 하는 센터가 있다. 스스로 켤 수 있으면 아무도 확인하지
       않는 인상이 된다. 풀방금액에는 이 조건이 없다 -- 그것은 대표가 관리하는
       숫자이고, 이것은 승진이다. */
    await assertFails(updateDoc(membershipDocOf(users.owner, users.owner), { isDeputyDirector: true }));
    await assertFails(updateDoc(membershipDocOf(users.instructor, users.instructor), { isDeputyDirector: true }));
  });

  test("a manager does not name a deputy", async () => {
    await assertFails(updateDoc(membershipDocOf(users.manager, users.instructor), { isDeputyDirector: true }));
    await assertFails(updateDoc(membershipDocOf(users.staff, users.instructor), { isDeputyDirector: true }));
    await assertFails(updateDoc(membershipDocOf(users.outsider, users.instructor), { isDeputyDirector: true }));
  });

  test("the flag is a yes or a no, and travels alone", async () => {
    await assertFails(updateDoc(membershipDocOf(users.owner, users.instructor), { isDeputyDirector: "true" }));
    // 한 문은 한 필드만 지나간다. 역할이나 소속이 같이 실려 오면 안 된다.
    await assertFails(updateDoc(membershipDocOf(users.owner, users.instructor), {
      isDeputyDirector: true, role: "owner",
    }));
    await assertFails(updateDoc(membershipDocOf(users.owner, users.instructor), {
      isDeputyDirector: true, fullRoomRate: 90000,
    }));
  });

  test("the change lands in the same history as a rate change", async () => {
    /* 별도 컬렉션을 만들지 않은 이유는 규칙 파일의 rateHistory 주석에 있다 --
       두 기록이 답하는 질문이 같고, 나누면 한쪽만 보고 "그때 단가가 안 바뀌었다"
       고 답하게 된다. */
    const historyDocOf = (userId, entryId) => doc(
      dbFor(userId), COLLECTIONS.MEMBERSHIPS, `${ORG_A}_${users.instructor}`, "rateHistory", entryId,
    );
    const deputyEntry = (overrides = {}) => ({
      organizationId: ORG_A,
      userId: users.instructor,
      previousDeputyDirector: null,
      newDeputyDirector: true,
      effectiveFrom: serverTimestamp(),
      changedBy: users.owner,
      createdAt: serverTimestamp(),
      ...overrides,
    });

    await assertSucceeds(setDoc(historyDocOf(users.owner, "deputy-1"), deputyEntry()));

    // 한 항목이 두 종류의 변경을 동시에 말하면 무엇이 바뀐 것인지 알 수 없다.
    await assertFails(setDoc(historyDocOf(users.owner, "deputy-mixed"), deputyEntry({ newRate: 45000 })));
    await assertFails(setDoc(historyDocOf(users.owner, "deputy-mixed-2"), deputyEntry({ previousRate: 45000 })));

    // 바뀌지 않는 변경은 이력만 늘리고 "그때 무슨 일이 있었나"를 흐린다.
    await assertFails(setDoc(historyDocOf(users.owner, "deputy-noop"), deputyEntry({
      previousDeputyDirector: true,
    })));
    await assertFails(setDoc(historyDocOf(users.owner, "deputy-string"), deputyEntry({
      newDeputyDirector: "true",
    })));
    // 이력도 대표만 쌓는다.
    await assertFails(setDoc(historyDocOf(users.instructor, "deputy-self"), deputyEntry({
      changedBy: users.instructor,
    })));
  });
});

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

  test("attendance touches the remaining count and the service counter, nothing else", async () => {
    await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), {
      remainingCount: 19, contractPrice: 1,
    }));
    await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), {
      remainingCount: 19, instructorId: users.staff,
    }));
  });

  test("a service session moves its counter in the same write as the deduction", async () => {
    /* 센터가 급여를 주는 서비스는 회원권당 1회분뿐이고, 이 숫자가 다음 서비스
       회차의 단가를 가른다. 차감과 갈라져 저장되면 한 번 더 급여가 나간다. */
    await assertSucceeds(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), {
      remainingCount: increment(-1), serviceUsed: increment(1),
    }));
  });

  test("the service counter only ever goes up by one, and never alone", async () => {
    const refused = [
      { label: "두 칸", data: { remainingCount: increment(-1), serviceUsed: increment(2) } },
      { label: "되돌리기", data: { remainingCount: increment(-1), serviceUsed: increment(-1) } },
      { label: "문자열", data: { remainingCount: increment(-1), serviceUsed: "1" } },
      // 차감 없이 카운터만 올리면 그 회원권의 남은 서비스 1회분이 조용히 사라진다.
      { label: "차감 없이", data: { serviceUsed: increment(1) } },
    ];
    for (const item of refused) {
      await assertFails(updateDoc(passDocOf(users.instructor, ORG_A, PASS_A), item.data), item.label);
    }
  });

  test("a pass from before the counter existed still spends its first service session", async () => {
    /* 이 필드가 없는 회원권이 이미 있다. 없던 자리에서 올리면 1 이어야 하고,
       그러지 않으면 옛 회원권의 출석 체크가 통째로 거부된다. */
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const reference = doc(context.firestore(), "organizations", ORG_A, "passes", "pass-before-counter");
      await setDoc(reference, passFixture(ORG_A, "pass-before-counter"));
      await updateDoc(reference, { serviceUsed: deleteField() });
    });
    await assertSucceeds(updateDoc(passDocOf(users.instructor, ORG_A, "pass-before-counter"), {
      remainingCount: increment(-1), serviceUsed: increment(1),
    }));
  });

  test("only the owner undoes a deduction, and only once", async () => {
    /* 강사와 매니저가 스스로 되돌릴 수 있으면 기록의 의미가 없다 -- 잘못 누른
       사람이 그것을 지울 수 있다는 뜻이기 때문이다. */
    const correctionOf = (userId, entryId) => ledgerDocOf(users[userId], ORG_A, PASS_A, `${entryId}_correction`);
    const correction = (overrides = {}) => ({
      organizationId: ORG_A,
      passId: PASS_A,
      clientId: "client-member",
      locationId: "location-a",
      type: "correction",
      delta: 1,
      category: "pt_1_1_new",
      unitPrice: 25000,
      correctsEntryId: "entry-issue",
      reason: "강사가 다른 회원을 눌렀습니다",
      instructorId: users.instructor,
      occurredAt: hoursAgo(1),
      createdAt: serverTimestamp(),
      createdBy: users.owner,
      ...overrides,
    });

    await assertSucceeds(setDoc(correctionOf("owner", "entry-issue"), correction()));
    // 같은 자리로 두 번째가 오고, 원장의 update 금지가 막는다.
    await assertFails(setDoc(correctionOf("owner", "entry-issue"), correction()));

    for (const role of ["manager", "instructor", "staff"]) {
      await assertFails(setDoc(correctionOf(role, `entry-by-${role}`), correction({
        correctsEntryId: `entry-by-${role}`, createdBy: users[role],
      })), role);
    }
  });

  test("a correction has to point at what it undoes, and say why", async () => {
    const correction = (overrides = {}) => ({
      organizationId: ORG_A,
      passId: PASS_A,
      clientId: "client-member",
      locationId: "location-a",
      type: "correction",
      delta: 1,
      category: "pt_1_1_new",
      unitPrice: 25000,
      correctsEntryId: "entry-target",
      reason: "잘못 눌렀습니다",
      instructorId: users.instructor,
      occurredAt: hoursAgo(1),
      createdAt: serverTimestamp(),
      createdBy: users.owner,
      ...overrides,
    });
    const at = (entryId) => ledgerDocOf(users.owner, ORG_A, PASS_A, entryId);

    // 문서 id 가 대상을 가리켜야 한다. 그 규칙이 두 번 보정을 막는 장치다.
    await assertFails(setDoc(at("somewhere-else"), correction()));
    // 정확히 한 회차만 되돌린다.
    await assertFails(setDoc(at("entry-target_correction"), correction({ delta: 2 })));
    await assertFails(setDoc(at("entry-target_correction"), correction({ delta: -1 })));
    // 사유가 없으면 반년 뒤 되돌린 것 자체가 실수인지 알 수 없다.
    const noReason = correction();
    delete noReason.reason;
    await assertFails(setDoc(at("entry-target_correction"), noReason));
    await assertFails(setDoc(at("entry-target_correction"), correction({ reason: "" })));
    await assertFails(setDoc(at("entry-target_correction"), correction({ reason: "가".repeat(201) })));
    // 단가와 카테고리가 있어야 급여에서 그 회차가 정확히 상쇄된다.
    const noPrice = correction();
    delete noPrice.unitPrice;
    await assertFails(setDoc(at("entry-target_correction"), noPrice));

    await assertSucceeds(setDoc(at("entry-target_correction"), correction()));
  });

  test("a cancellation collects exactly what the pass had left", async () => {
    /* 남은 회차는 회원권이 들고 있다. caller 에게 물으면 숫자를 지어낼 수 있고,
       그러면 원장의 합과 잔여 횟수가 어긋난다 -- 그 어긋남은 고칠 수 없다. */
    const cancel = (overrides = {}) => ({
      organizationId: ORG_A,
      passId: PASS_A,
      clientId: "client-member",
      locationId: "location-a",
      type: "cancel",
      delta: -20,
      reason: "잘못 발급했습니다",
      occurredAt: hoursAgo(1),
      createdAt: serverTimestamp(),
      createdBy: users.owner,
      ...overrides,
    });
    const at = (userId, entryId) => ledgerDocOf(users[userId], ORG_A, PASS_A, entryId);

    await assertFails(setDoc(at("owner", "c-wrong"), cancel({ delta: -19 })));
    await assertFails(setDoc(at("owner", "c-positive"), cancel({ delta: 20 })));
    // 취소는 돈이 오가지 않는다. 지어낸 단가가 급여에 묶여 들어가면 안 된다.
    await assertFails(setDoc(at("owner", "c-priced"), cancel({ category: "pt_1_1_new", unitPrice: 25000 })));
    await assertFails(setDoc(at("manager", "c-by-manager"), cancel({ createdBy: users.manager })));
    await assertFails(setDoc(at("instructor", "c-by-instructor"), cancel({ createdBy: users.instructor })));

    await assertSucceeds(setDoc(at("owner", "c-ok"), cancel()));
  });

  test("a handover says where the sessions went, and only the owner may send them", async () => {
    /* 회원권 양도. 회차가 나가는 항목이지만 차감이 아니다 -- 수업이 일어나지
       않았으므로 급여가 나가지 않고, 그래서 단가와 카테고리에 넣을 참값이
       없다. 어디로 갔는지가 없으면 회차가 줄어든 사실만 남는다. */
    const handover = (overrides = {}) => ({
      organizationId: ORG_A,
      passId: PASS_A,
      clientId: "client-member",
      locationId: "location-a",
      type: "handover",
      delta: -5,
      toPassId: "pass-new",
      toClientId: "client-other",
      instructorId: users.instructor,
      occurredAt: hoursAgo(1),
      createdAt: serverTimestamp(),
      createdBy: users.owner,
      ...overrides,
    });
    const at = (userId, entryId) => ledgerDocOf(users[userId], ORG_A, PASS_A, entryId);

    // 어디로 갔는지가 반드시 있어야 한다.
    const noTarget = handover();
    delete noTarget.toPassId;
    await assertFails(setDoc(at("owner", "h-no-target"), noTarget));
    const noClient = handover();
    delete noClient.toClientId;
    await assertFails(setDoc(at("owner", "h-no-client"), noClient));
    await assertFails(setDoc(at("owner", "h-empty-target"), handover({ toPassId: "" })));

    // 자기 자신에게 넘기는 것은 양도가 아니다.
    await assertFails(setDoc(at("owner", "h-self"), handover({ toClientId: "client-member" })));
    await assertFails(setDoc(at("owner", "h-same-pass"), handover({ toPassId: PASS_A })));

    // 남은 회차보다 많이 나갈 수 없고, 양수일 수도 없다.
    await assertFails(setDoc(at("owner", "h-too-many"), handover({ delta: -21 })));
    await assertFails(setDoc(at("owner", "h-positive"), handover({ delta: 5 })));
    await assertFails(setDoc(at("owner", "h-zero"), handover({ delta: 0 })));

    // 돈이 오가지 않는다. 지어낸 단가가 급여에 묶여 들어가면 안 된다.
    await assertFails(setDoc(at("owner", "h-priced"), handover({ category: "pt_1_1_new", unitPrice: 25000 })));
    await assertFails(setDoc(at("owner", "h-lesson"), handover({ lessonId: "lesson-1" })));
    await assertFails(setDoc(at("owner", "h-reason"), handover({ reason: "그냥" })));

    /* 회원 사이에 돈이 오가는 일이라 대표만 한다 -- 차감 보정·취소와 같은
       선이다. 매니저가 회차를 옮길 수 있으면 급여가 스스로 움직인다. */
    await assertFails(setDoc(at("manager", "h-by-manager"), handover({ createdBy: users.manager })));
    await assertFails(setDoc(at("instructor", "h-by-instructor"), handover({ createdBy: users.instructor })));

    await assertSucceeds(setDoc(at("owner", "h-ok"), handover()));
  });

  test("an ordinary entry has no room for a reason it does not need", async () => {
    // 자유 문장은 열어 둔 만큼 들어온다. 되돌리는 항목에만 칸이 있다.
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-with-reason"),
      deductEntry({ reason: "그냥" }),
    ));
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-with-target"),
      deductEntry({ correctsEntryId: "entry-issue" }),
    ));
  });

  test("a correction is no more editable than what it corrects", async () => {
    await assertSucceeds(setDoc(
      ledgerDocOf(users.owner, ORG_A, PASS_A, "entry-fix_correction"),
      {
        organizationId: ORG_A, passId: PASS_A, clientId: "client-member", locationId: "location-a",
        type: "correction", delta: 1, category: "pt_1_1_new", unitPrice: 25000,
        correctsEntryId: "entry-fix", reason: "잘못 눌렀습니다", instructorId: users.instructor,
        occurredAt: hoursAgo(1), createdAt: serverTimestamp(), createdBy: users.owner,
      },
    ));
    for (const role of ["owner", "manager", "instructor"]) {
      await assertFails(updateDoc(ledgerDocOf(users[role], ORG_A, PASS_A, "entry-fix_correction"), { delta: 9 }));
      await assertFails(deleteDoc(ledgerDocOf(users[role], ORG_A, PASS_A, "entry-fix_correction")));
    }
  });

  test("a deduction says which rule decided its price", async () => {
    /* 나중에 다시 계산할 수 없다 -- 그때의 누적 횟수는 계속 올라가 사라지고,
       부원장 지정과 서비스 사용 수도 그 뒤로 움직인다. */
    await assertSucceeds(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-with-rule"),
      deductEntry({ rule: "new_to_instructor" }),
    ));
    // 판정 엔진이 돌려줄 수 있는 다섯 가지 말고는 들어가지 않는다.
    await assertFails(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-made-up-rule"),
      deductEntry({ rule: "because_i_said_so" }),
    ));
    // 이 필드가 생기기 전 항목에는 없다. 없는 것은 거부하지 않는다.
    await assertSucceeds(setDoc(
      ledgerDocOf(users.instructor, ORG_A, PASS_A, "entry-without-rule"),
      deductEntry(),
    ));
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

  test("a pass is issued with the base its deductions will start from", async () => {
    /* 판정 4 가 읽을 값이다. 없으면 차감 시점에 표를 다시 보게 되고, 그 사이
       바뀐 단가가 지난 회원권에 소급된다. 실제 단가가 아니라는 것은
       deduction-pricing.js 가 말한다 -- 앞의 세 판정이 먼저 걸리면 쓰이지 않는다. */
    await assertFails(setDoc(
      passDocOf(users.owner, ORG_A, "pass-no-price"),
      dropField(passFixture(ORG_A, "pass-no-price"), "baseUnitPrice"),
    ));
    await assertFails(setDoc(
      passDocOf(users.owner, ORG_A, "pass-string-price"),
      passFixture(ORG_A, "pass-string-price", { baseUnitPrice: "25000" }),
    ));
    await assertSucceeds(setDoc(
      passDocOf(users.owner, ORG_A, "pass-priced"),
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

  test("the owner reads the whole centre's month without naming an instructor", async () => {
    /* 월말 정산은 강사를 지정하지 않는다. 그룹 규칙은 "본인 항목이거나
       대표·매니저"인데, 앞 절의 resource.data.instructorId 는 쿼리가 그 필드를
       좁히지 않으면 평가할 것이 없다 -- 이 파일 머리말의 list 함정이다.

       대표의 쿼리가 실제로 통과하는지를 여기서 고정한다. 거부되면 정산 화면이
       빈 목록으로 보이고, 그 빈 목록은 "이달 수업이 없다"와 구별되지 않는다. */
    const monthly = (userId) => query(
      ledgerGroup(userId),
      where("organizationId", "==", ORG_A),
      where("type", "==", "deduct"),
      where("occurredAt", ">=", hoursAgo(24 * 30)),
      where("occurredAt", "<", hoursAgo(-1)),
    );
    await assertSucceeds(getDocs(monthly(users.owner)));
    await assertSucceeds(getDocs(monthly(users.manager)));

    /* 강사는 남의 급여를 보지 못한다. 자기 것을 볼 때는 instructorId 를 함께
       좁혀야 하고, 그것이 곧 "내 것만"의 증명이다. */
    await assertFails(getDocs(monthly(users.instructor)));
    await assertFails(getDocs(monthly(users.staff)));
    await assertFails(getDocs(monthly(users.outsider)));
    await assertSucceeds(getDocs(query(
      monthly(users.instructor),
      where("instructorId", "==", users.instructor),
    )));
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
      passDocOf(users.owner, "pass-no-expiry"),
      dropField(passFixture(ORG_A, "pass-no-expiry"), "expiresAt"),
    ));
    for (const bad of ["2027-03-31", 1790000000, null]) {
      await assertFails(setDoc(
        passDocOf(users.owner, "pass-bad-expiry"),
        passFixture(ORG_A, "pass-bad-expiry", { expiresAt: bad }),
      ), JSON.stringify(bad));
    }
    await assertSucceeds(setDoc(
      passDocOf(users.owner, "pass-with-expiry"),
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
    baseUnitPrice: 30000,
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

/* ── 회원용 조회 앱이 읽는 두 곳 ──────────────────────────────────────────

   회원은 원본을 읽지 않는다. 투영(memberViews)과 자기 링크(memberLinks) 둘만
   읽는다 -- docs/member-app-design.md 5장.

   쓰기는 어느 쪽도 열지 않는다. 그 둘을 쓰는 것은 서버(Admin SDK)뿐이고,
   Admin SDK 는 규칙을 지나지 않는다.

   ── 이 describe 가 쓰는 회원은 소속 문서가 없다 ──
   위쪽 fixture 의 users.member 는 role "member" 로 memberships 문서를 갖고
   있다. 실제 회원 앱 사용자는 그것을 갖지 않는다 (설계 4장) -- 그 차이가
   결정적이라 여기서는 소속 없는 사용자를 따로 만든다. 왜 결정적인지는 아래
   "소속 문서 하나가 원장을 연다" 가 보여준다. */

const APP_MEMBER = "app-member-a";
const APP_MEMBER_CLIENT = "client-app-member";

describe("what the member app may read", () => {
  const viewRef = (userId, clientId = APP_MEMBER_CLIENT) =>
    doc(dbFor(userId), "organizations", ORG_A, "memberViews", clientId);
  const viewsOf = (userId) =>
    collection(dbFor(userId), "organizations", ORG_A, "memberViews");
  const linkRef = (userId, documentId = userId) =>
    doc(dbFor(userId), "memberLinks", documentId);

  const projection = (overrides = {}) => ({
    organizationId: ORG_A,
    clientId: APP_MEMBER_CLIENT,
    userId: APP_MEMBER,
    name: "회원",
    locationName: "반송점",
    clientStatus: "active",
    remainingTotal: 8,
    nextExpiresAt: Timestamp.fromDate(new Date(2027, 0, 31)),
    passes: [],
    history: [],
    journey: null,
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  const link = (overrides = {}) => ({
    userId: APP_MEMBER,
    phone: "01012345678",
    organizationId: ORG_A,
    clientId: APP_MEMBER_CLIENT,
    status: "linked",
    ...overrides,
  });

  beforeEach(async () => {
    /* 규칙을 지나지 않는 쓰기로 심는다 -- 실제로도 Admin SDK 가 쓴다.
       이 사용자에게 memberships 문서를 만들지 않는 것이 핵심이다. */
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "organizations", ORG_A, "clients", APP_MEMBER_CLIENT), {
        organizationId: ORG_A, userId: APP_MEMBER, name: "회원", phone: "01012345678", status: "active",
      });
      await setDoc(doc(db, "organizations", ORG_A, "memberViews", APP_MEMBER_CLIENT), projection());
      await setDoc(doc(db, "organizations", ORG_A, "memberViews", "client-other"), projection({
        clientId: "client-other", userId: "another-member",
      }));
      await setDoc(doc(db, "memberLinks", APP_MEMBER), link());
      await setDoc(doc(db, "memberLinks", "another-member"), link({ userId: "another-member" }));
    });
  });

  /* 1 */
  test("a member reads their own projection", async () => {
    const snapshot = await assertSucceeds(getDoc(viewRef(APP_MEMBER)));
    assert.equal(snapshot.data().remainingTotal, 8);
  });

  /* 2 */
  test("a member cannot read somebody else's projection", async () => {
    await assertFails(getDoc(viewRef(APP_MEMBER, "client-other")));
  });

  /* 3 */
  test("nobody lists the projections, not even the owner", async () => {
    /* 회원은 자기 clientId 를 memberLinks 에서 알고 그 문서 하나만 읽는다.
       목록을 열면 "내 것만" 을 증명할 필터를 요구하게 되고, 그 필터를 빼먹은
       질의 하나가 센터 전체를 넘긴다. */
    for (const userId of [APP_MEMBER, users.owner, users.manager, users.instructor, users.staff]) {
      await assertFails(getDocs(viewsOf(userId)), `${userId} 가 투영 목록을 훑는다`);
    }
  });

  /* 4 */
  test("a member reads their own link and nobody else's", async () => {
    const snapshot = await assertSucceeds(getDoc(linkRef(APP_MEMBER)));
    assert.equal(snapshot.data().clientId, APP_MEMBER_CLIENT);
    await assertFails(getDoc(linkRef(APP_MEMBER, "another-member")));
  });

  /* 5 */
  test("a member cannot read passes — the unit prices live there", async () => {
    await assertFails(getDoc(doc(dbFor(APP_MEMBER), "organizations", ORG_A, "passes", PASS_A)));
    await assertFails(getDocs(collection(dbFor(APP_MEMBER), "organizations", ORG_A, "passes")));
  });

  /* 6 */
  test("a member cannot read the ledger — every entry carries a price and a rule", async () => {
    await assertFails(getDoc(doc(
      dbFor(APP_MEMBER), "organizations", ORG_A, "passes", PASS_A, "ledger", "entry-issue",
    )));
    await assertFails(getDocs(collection(
      dbFor(APP_MEMBER), "organizations", ORG_A, "passes", PASS_A, "ledger",
    )));
  });

  /* 7 */
  test("a member cannot read the instructor's lesson notes", async () => {
    await assertFails(getDocs(collection(dbFor(APP_MEMBER), "organizations", ORG_A, "lessonNotes")));
  });

  /* 8 */
  test("a member cannot list the client directory", async () => {
    // 연락처가 들어 있다. 투영에는 이름만 실린다.
    await assertFails(getDocs(collection(dbFor(APP_MEMBER), "organizations", ORG_A, "clients")));
  });

  /* 9 */
  test("nobody writes a projection — not the owner, not anyone", async () => {
    /* 이 문서를 쓰는 것은 서버 트리거(Admin SDK)뿐이다. 앱 쪽에 쓰기를 한 칸이라도
       열면 그 경로로 들어온 값이 허용 목록을 거치지 않고, 그러면 이 문서가
       개인정보의 관문이라는 말이 거짓이 된다. */
    for (const userId of [users.owner, users.manager, users.instructor, users.staff, APP_MEMBER]) {
      await assertFails(setDoc(
        doc(dbFor(userId), "organizations", ORG_A, "memberViews", `view-by-${userId}`),
        projection({ clientId: `client-${userId}` }),
      ), `${userId} 가 투영을 만든다`);
      await assertFails(updateDoc(viewRef(userId), { remainingTotal: 999 }), `${userId} 가 투영을 고친다`);
      await assertFails(deleteDoc(viewRef(userId)), `${userId} 가 투영을 지운다`);
    }
  });

  /* 10 */
  test("nobody writes a link either — connecting is the server's job", async () => {
    for (const userId of [users.owner, users.manager, APP_MEMBER]) {
      await assertFails(setDoc(linkRef(userId, `link-by-${userId}`), link({ userId })), `${userId} 가 링크를 만든다`);
      await assertFails(updateDoc(linkRef(userId, APP_MEMBER), { clientId: "client-other" }), `${userId} 가 링크를 고친다`);
      await assertFails(deleteDoc(linkRef(userId, APP_MEMBER)), `${userId} 가 링크를 지운다`);
    }
  });

  /* 11 */
  test("a member cannot write to the sources the projection is built from", async () => {
    await assertFails(updateDoc(
      doc(dbFor(APP_MEMBER), "organizations", ORG_A, "clients", APP_MEMBER_CLIENT),
      { userId: "another-member" },
    ));
    await assertFails(updateDoc(
      doc(dbFor(APP_MEMBER), "organizations", ORG_A, "passes", PASS_A),
      { remainingCount: 99 },
    ));
  });

  /* 12 */
  test("a member cannot reach the centre's own records", async () => {
    await assertFails(getDocs(query(
      collection(dbFor(APP_MEMBER), "auditLogs"), where("organizationId", "==", ORG_A),
    )));
    await assertFails(getDocs(query(
      collection(dbFor(APP_MEMBER), "memberships"), where("organizationId", "==", ORG_A),
    )));
    await assertFails(getDocs(collection(
      dbFor(APP_MEMBER), "organizations", ORG_A, "instructorClientTotals",
    )));
  });

  /* 13 */
  test("signed out, all of it is closed", async () => {
    await assertFails(getDoc(viewRef(null)));
    await assertFails(getDoc(linkRef(null, APP_MEMBER)));
    await assertFails(getDocs(viewsOf(null)));
    await assertFails(setDoc(
      doc(dbFor(null), "organizations", ORG_A, "memberViews", "view-by-nobody"),
      projection(),
    ));
  });

  /* 14 — 회귀 */
  test("the existing doors are untouched", async () => {
    /* 회원 문을 내다가 강사 문을 막아도 아무도 모른다. 새 블록만 더했다는 것을
       여기서 한 번 더 확인한다. */
    await assertSucceeds(getDoc(doc(dbFor(users.instructor), "organizations", ORG_A, "passes", PASS_A)));
    await assertSucceeds(getDocs(collection(dbFor(users.owner), "organizations", ORG_A, "clients")));
    await assertSucceeds(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "clients", "client-member")));
  });

  /* 15 — 약속이 아니라 규칙이다 */
  test("the member role reads no centre data, membership document or not", () => {
    /* 전에는 이것이 뚫려 있었다. passes·ledger·products 의 read 가
       isActiveMember 만 보고 역할을 보지 않아서, role "member" 라도 소속 문서
       하나만 있으면 센터의 회원권과 원장을 전부 읽었다 -- 단가와 급여 판정까지.

       투영 설계는 "회원에게 memberships 를 만들지 않는다" 로 그것을 피하고
       있었는데, 그것은 규칙이 아니라 약속이었다. 이제 isCentreStaff 가 규칙으로
       막는다.

       users.member 는 role "member" 로 활성 소속 문서를 갖고 있다. 그래도 아무
       것도 읽지 못해야 한다. */
    const centreReads = [
      ["passes", () => getDoc(doc(dbFor(users.member), "organizations", ORG_A, "passes", PASS_A))],
      ["ledger", () => getDoc(doc(dbFor(users.member), "organizations", ORG_A, "passes", PASS_A, "ledger", "entry-issue"))],
      ["products", () => getDoc(doc(dbFor(users.member), "organizations", ORG_A, "products", PRODUCT_A))],
      ["organizations", () => getDoc(doc(dbFor(users.member), "organizations", ORG_A))],
      ["locations", () => getDocs(collection(dbFor(users.member), "organizations", ORG_A, "locations"))],
      ["lessons", () => getDocs(collection(dbFor(users.member), "organizations", ORG_A, "lessons"))],
      ["instructorClientTotals", () => getDocs(collection(dbFor(users.member), "organizations", ORG_A, "instructorClientTotals"))],
      ["clients 목록", () => getDocs(collection(dbFor(users.member), "organizations", ORG_A, "clients"))],
    ];
    return Promise.all(centreReads.map(([label, read]) => assertFails(read(), label)));
  });

  /* 16 */
  test("the member still reads the one client document that is theirs", () => {
    /* 좁히면서 이 문까지 닫으면 안 된다. clients get 의 본인 분기는 그대로
       열려 있어야 한다 -- 규칙 함수 isOwnClientDocument 가 기다리는 자리다. */
    return assertSucceeds(getDoc(doc(dbFor(users.member), "organizations", ORG_A, "clients", "client-member")));
  });
});

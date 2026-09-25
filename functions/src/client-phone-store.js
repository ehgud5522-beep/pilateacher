"use strict";

/**
 * 연락처 변경을 실제로 쓰는 곳. 판정은 client-phone.js 가 한다.
 *
 * ── 중복 판정은 연결 판정과 같은 함수를 쓴다 ──
 * `findClientsByPhone` 을 member-link-store 에서 그대로 가져온다. 따로 만들면
 * 언젠가 갈라지고, 갈라지는 날 "중복이 아니라고 해서 저장했는데 회원 앱은 두
 * 사람을 찾는" 상태가 된다. 같은 쿼리여야 같은 답이 나온다.
 *
 * ── 한 트랜잭션인 이유 ──
 * 검사와 쓰기 사이에 다른 변경이 끼면 같은 번호를 쓰는 회원이 둘이 된다.
 * Admin SDK 의 트랜잭션은 쿼리를 읽을 수 있어서, 중복 검사를 그 안에 넣는다.
 *
 * 다만 **연결 해제는 트랜잭션 밖**이다. memberLinks 는 조직 밖의 문서이고
 * 배치로 여러 문서를 건드린다 -- 한 트랜잭션에 묶으려면 그 셋을 전부 먼저
 * 읽어야 하는데, 그러면 잠그는 범위가 회원 하나에서 계정 하나로 넓어진다.
 * 순서로 푼다: **번호를 먼저 바꾸고 그다음 끊는다.** 중간에 멈추면 번호는
 * 새것인데 연결이 남아 있는 상태이고, 그때 회원 앱은 옛 번호로 로그인한
 * 계정에 새 번호의 회원을 보여준다 -- 그래서 끊기가 실패하면 그 사실을
 * 코드와 함께 올려 보낸다. 대표가 다시 누르면 끊기만 다시 돈다.
 */

const { createFirestoreMemberLinkPorts } = require("./member-link-store");
const { PHONE_EDIT, decidePhoneEdit, duplicateAnswer, kstDayKey } = require("./client-phone");

const text = (value) => String(value ?? "").trim();
const digitsOf = (value) => String(value ?? "").replace(/\D/g, "");

/** 감사에 남기는 이름. 규칙의 auditActions() 에는 넣지 않는다 -- 서버만 쓴다. */
const AUDIT_ACTION_PHONE_CHANGED = "member_phone_changed";

const phoneEditError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

function createFirestoreClientPhonePorts(dependencies) {
  const firestore = dependencies.firestore;
  const FieldValue = dependencies.FieldValue;
  const links = createFirestoreMemberLinkPorts({ firestore, FieldValue });

  const organizationRef = (organizationId) => firestore.collection("organizations").doc(organizationId);
  const clientRef = (organizationId, clientId) => organizationRef(organizationId).collection("clients").doc(clientId);
  const quotaRef = (organizationId, actorId, dayKey) => organizationRef(organizationId)
    .collection("phoneEditQuota").doc(`${actorId}_${dayKey}`);

  /** 이 회원의 회원권 전부. 옛 회원권에는 clientIds 가 없어 두 번 묻는다. */
  async function listPasses(organizationId, clientId) {
    const passes = organizationRef(organizationId).collection("passes");
    const [byAnchor, byList] = await Promise.all([
      passes.where("clientId", "==", clientId).get(),
      passes.where("clientIds", "array-contains", clientId).get(),
    ]);
    const found = new Map();
    for (const snapshot of [...byAnchor.docs, ...byList.docs]) {
      found.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
    }
    return [...found.values()];
  }

  /**
   * 번호를 바꾼다. 검사와 쓰기가 한 트랜잭션이다.
   *
   * @param {{
   *   organizationId: string, clientId: string, newPhone: string,
   *   actorId: string, actorRole: string, now?: Date,
   * }} input
   */
  async function changePhone(input) {
    const organizationId = text(input?.organizationId);
    const clientId = text(input?.clientId);
    const actorId = text(input?.actorId);
    const actorRole = text(input?.actorRole);
    const at = input?.now instanceof Date ? input.now : new Date();
    const dayKey = kstDayKey(at);

    /* 판정에 필요한 것 중 트랜잭션 밖에서 읽어도 되는 것. 회원권 목록은
       쿼리 둘이고, 담당이 방금 바뀌었다고 해서 번호 변경이 위험해지지는
       않는다 -- 잠글 값은 번호와 한도뿐이다. */
    const passes = await listPasses(organizationId, clientId);

    const result = await firestore.runTransaction(async (transaction) => {
      const clientSnapshot = await transaction.get(clientRef(organizationId, clientId));
      if (!clientSnapshot.exists) throw phoneEditError(PHONE_EDIT.NO_CLIENT);
      const client = { clientId: clientSnapshot.id, ...clientSnapshot.data() };

      const quotaSnapshot = await transaction.get(quotaRef(organizationId, actorId, dayKey));
      const usedToday = Number(quotaSnapshot.data()?.count) || 0;

      const allowed = decidePhoneEdit({
        role: actorRole, actorId, client, passes, newPhone: input?.newPhone, usedToday, now: at,
      });
      if (!allowed.ok) throw phoneEditError(allowed.code, { limit: allowed.limit });
      const phone = allowed.phone;

      /* 같은 센터에 그 번호를 쓰는 다른 회원이 있는가. 연결 함수와 같은
         쿼리다 -- 갈라지면 "중복이 아니라고 해서 저장했는데 회원 앱은 두
         사람을 찾는" 상태가 된다. */
      const holders = (await links.findClientsByPhone(organizationId, phone))
        .filter((item) => text(item.clientId) !== clientId);
      if (holders.length > 0) {
        throw phoneEditError(PHONE_EDIT.DUPLICATE, duplicateAnswer({ role: actorRole, owner: holders[0] }));
      }

      const previousPhone = digitsOf(client.phone);
      /* 이전 번호를 남긴다. 엑셀 재업로드가 이것을 보고 "이 번호는 ○○ 회원의
         예전 번호예요" 라고 막는다 -- 없으면 옛 엑셀이 같은 사람을 회원 둘로
         만든다. 전체 번호로 남긴다: 마스킹하면 비교할 것이 없다. */
      transaction.set(clientRef(organizationId, clientId), {
        phone,
        ...(previousPhone ? { previousPhones: FieldValue.arrayUnion(previousPhone) } : {}),
        updatedAt: at,
      }, { merge: true });

      /* 한도는 강사에게만 의미가 있지만 누구든 센다. 대표가 얼마나 바꿨는지도
         남는 편이 낫고, 세는 것과 막는 것은 다른 일이다. */
      transaction.set(quotaRef(organizationId, actorId, dayKey), {
        organizationId, actorId, dayKey, count: (usedToday || 0) + 1, updatedAt: at,
      }, { merge: true });

      /* 누가·언제·어느 회원. **번호는 넣지 않는다** -- 감사 항목에는 자유
         문장 칸이 하나도 없고, 마스킹했어도 번호는 번호다. 이전 번호와 새
         번호는 회원 문서가 들고 있고, 대표 화면이 둘을 이어 붙여 보여준다. */
      transaction.set(firestore.collection("auditLogs").doc(), {
        organizationId, actorId, actorRole,
        action: AUDIT_ACTION_PHONE_CHANGED,
        createdAt: at, clientId, targetId: clientId,
      });

      return { phone, previousPhone, userId: text(client.userId) };
    });

    /* 연결을 끊는다. 번호가 바뀐 계정은 더 이상 그 회원이 아니다 -- 남의
       번호로 남의 잔여를 보게 둘 수 없다. 투영도 함께 지워진다(removeLink).

       트랜잭션 밖이라 여기서 실패하면 번호는 새것인데 연결이 남는다. 숨기지
       않고 코드와 함께 올려 보낸다 -- 대표가 다시 누르면 끊기만 다시 돈다
       (번호가 이미 같아 판정이 phone_same 으로 멈추므로, 화면이 그때
       해제만 다시 부른다). */
    let unlinked = false;
    if (result.userId) {
      await links.removeLink({
        userId: result.userId, organizationId, clientId, at,
        audit: { organizationId, actorId, actorRole, clientId, targetId: clientId },
      });
      unlinked = true;
    }
    return { ...result, unlinked };
  }

  /**
   * 번호가 숫자 열한 자리가 아닌 회원 목록. **읽기만 한다.**
   *
   * 고치지 않는 이유가 있다. 하이픈이 섞인 번호는 대부분 그냥 철자 문제지만,
   * 개중에는 번호가 아예 틀린 것도 섞여 있다 -- 한꺼번에 정규화하면 틀린
   * 번호가 "정상" 이 되어 더 찾기 어려워진다. 대표가 목록을 보고 하나씩
   * 연락처 수정으로 고친다.
   */
  async function listMalformedPhones(organizationId) {
    const snapshot = await organizationRef(organizationId).collection("clients").get();
    return snapshot.docs
      .map((document) => ({ clientId: document.id, ...document.data() }))
      .filter((client) => {
        const digits = digitsOf(client.phone);
        return digits.length !== 11 || !digits.startsWith("010");
      })
      .map((client) => ({
        clientId: text(client.clientId),
        name: text(client.name),
        /* 저장된 그대로 보여준다. 여기서 다듬으면 무엇이 문제인지 안 보인다 --
           대표가 고쳐야 할 것이 바로 이 철자다. */
        phone: text(client.phone),
        status: text(client.status),
        linked: Boolean(text(client.userId)),
      }));
  }

  return { changePhone, listMalformedPhones, listPasses };
}

module.exports = {
  AUDIT_ACTION_PHONE_CHANGED,
  createFirestoreClientPhonePorts,
  phoneEditError,
};

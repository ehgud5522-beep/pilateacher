"use strict";
const { createSharingService } = require("./before-after-sharing");

async function notifyShare({ db, bucket, messaging }, shareId) {
  const ref = db.doc(`beforeAfterShares/${shareId}`);
  const initial = (await ref.get()).data();
  if (initial?.status !== "active" || initial.notificationStatus !== "pending") return;
  const service = createSharingService({ db, bucket });
  try { await service.authorizeShare(initial.memberUserId, shareId); } catch { return; }
  const consent = (await db.doc(initial.consentReference).get()).data();
  const settings = (await db.doc(`memberPush/${initial.memberUserId}`).get()).data();
  const tokens = consent?.notifications === true && settings?.prefs?.beforeAfter !== false
    ? Object.values(settings?.tokens || {}).map((t) => t.token).filter((t) => typeof t === "string").slice(0, 500) : [];
  const claimed = await db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data();
    if (s?.status !== "active" || s.notificationStatus !== "pending") return false;
    tx.update(ref, { notificationStatus: tokens.length ? "sending" : "skipped" }); return true;
  });
  if (!claimed || !tokens.length) return;
  try {
    await service.authorizeShare(initial.memberUserId, shareId);
    const result = await messaging.sendEachForMulticast({ tokens,
      notification: { title: "새로운 비포애프터 기록이 도착했어요.", body: "담당 선생님이 새로운 기록을 공유했습니다." },
      data: { kind: "beforeAfter", shareId, open: "beforeAfter" } });
    await ref.update({ notificationStatus: result.failureCount ? "partial-failure" : "sent" });
  } catch { await ref.update({ notificationStatus: "failed" }); }
  // No automatic resend after claiming: a crash may leave 'sending', but cannot duplicate a push.
}

async function eraseMemberShares(db, uid) {
  const shares = await db.collection("beforeAfterShares").where("memberUserId", "==", uid).get();
  for (const doc of shares.docs) await db.recursiveDelete(doc.ref);
  await db.recursiveDelete(db.doc(`memberPhotoConsents/${uid}`));
}
module.exports = { notifyShare, eraseMemberShares };

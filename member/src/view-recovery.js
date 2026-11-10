const transient = (code) => ["unavailable", "deadline-exceeded", "network-request-failed", "link_unavailable"].includes(String(code || "").replace(/^(functions|auth)\//, ""));
export const needsViewRecovery = (places) => places.some((item) => !item.view && (!item.errorCode || item.errorCode === "permission-denied"));

/** At most two repair calls. Never replace healthy branches with a failed branch. */
export async function recoverMemberViews({ places, repair, read, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!needsViewRecovery(places)) return places;
  let code = "member_view_not_ready";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let retry = false;
    try {
      const result = await repair();
      const failure = result?.views?.find((item) => item.outcome === "failed");
      code = failure?.code || "member_view_not_ready";
      retry = failure ? transient(code) : true;
    } catch (error) {
      code = error?.details?.code || error?.code || "member_view_recovery_failed";
      retry = transient(code);
    }
    const updated = await read();
    places = updated.map((item, index) => item.view ? item : places[index]?.view ? places[index] : item);
    if (!needsViewRecovery(places)) return places;
    if (!retry || attempt === 1) break;
    await sleep(2000);
  }
  return places.map((item) => item.view || (item.errorCode && item.errorCode !== "permission-denied") ? item : { ...item, errorCode: code });
}

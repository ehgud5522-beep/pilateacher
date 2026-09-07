const id = (value) => String(value ?? "").trim();

const scheduleMemberIds = (lesson) => [...new Set([
  lesson?.memberId,
  ...(Array.isArray(lesson?.memberIds) ? lesson.memberIds : []),
  ...(Array.isArray(lesson?.attendees) ? lesson.attendees.map((item) => item?.memberId) : []),
].map(id).filter(Boolean))];

const lessonHasMember = (lesson, memberId) => scheduleMemberIds(lesson).includes(id(memberId));

const occurrenceTime = (lesson) => {
  const date = String(lesson?.date || "");
  const time = String(lesson?.start || lesson?.time || "23:59");
  const parsed = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}`);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

/* status carries two different things: the membership state and the inactive
   flag. Deactivating therefore overwrites the membership state, so it is parked
   here first -- otherwise reactivating an ended member would quietly promote
   them back to active. */
export const MEMBERSHIP_STATUSES = Object.freeze(["active", "hold", "ended"]);

const membershipStatusOf = (value) => (MEMBERSHIP_STATUSES.includes(String(value || "")) ? String(value) : "active");

export function deactivateMemberRecord(member, now = new Date().toISOString()) {
  return {
    ...member,
    statusBeforeInactive: membershipStatusOf(member?.status),
    status: "inactive",
    inactiveAt: now,
  };
}

export function reactivateMemberRecord(member) {
  return {
    ...member,
    status: membershipStatusOf(member?.statusBeforeInactive),
    statusBeforeInactive: "",
    inactiveAt: "",
  };
}

export function inactiveMembers(members = []) {
  return (members || []).filter((member) => String(member?.status || "active") === "inactive");
}

export function deleteMemberData(db, memberId, now = Date.now()) {
  const target = id(memberId);
  const removedMember = (db?.members || []).find((member) => id(member?.id) === target) || null;
  const pastLessonIds = [];
  const futureLessonIds = [];
  const schedule = (db?.schedule || []).map((lesson) => {
    if (!lessonHasMember(lesson, target)) return lesson;
    if (occurrenceTime(lesson) < now) {
      pastLessonIds.push(id(lesson.id));
      return lesson;
    }
    futureLessonIds.push(id(lesson.id));
    const attendees = (lesson.attendees || []).filter((item) => id(item?.memberId) !== target);
    const memberIds = (lesson.memberIds || []).filter((value) => id(value) !== target);
    const nextMemberId = id(lesson.memberId) === target ? (memberIds[0] || attendees[0]?.memberId || undefined) : lesson.memberId;
    return { ...lesson, memberId: nextMemberId, memberIds, attendees, unlinkedMemberDeleted: true };
  });
  return {
    db: { ...db, members: (db?.members || []).filter((member) => id(member?.id) !== target), schedule },
    removedMember,
    pastLessonIds,
    futureLessonIds,
  };
}

export function visibleMembers(members = []) {
  return members.filter((member) => String(member?.status || "active") !== "inactive");
}

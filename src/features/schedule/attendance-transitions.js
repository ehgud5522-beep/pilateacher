const BALANCE_FIELDS = { "정규": "regular", regular: "regular", "서비스": "service", service: "service" };
const BALANCE_LABELS = { "정규": "정규", regular: "정규", "서비스": "서비스", service: "서비스" };

function restoreDeduction(members, memberId, deductFrom) {
  const field = BALANCE_FIELDS[deductFrom];
  if (!field) return members;
  return members.map((member) => member.id === memberId
    ? { ...member, [field]: Math.max(0, Number(member[field]) || 0) + 1 }
    : member);
}

function deductOne(members, memberId) {
  const member = members.find((item) => item.id === memberId);
  if (!member) return { members, deductFrom: null };
  if ((Number(member.regular) || 0) > 0) {
    return {
      members: members.map((item) => item.id === memberId ? { ...item, regular: Number(item.regular) - 1 } : item),
      deductFrom: "정규",
    };
  }
  if ((Number(member.service) || 0) > 0) {
    return {
      members: members.map((item) => item.id === memberId ? { ...item, service: Number(item.service) - 1 } : item),
      deductFrom: "서비스",
    };
  }
  return { members, deductFrom: null };
}

export function transitionAttendance({ members, attendees, memberIds, status }) {
  const targets = new Set((memberIds || []).filter(Boolean));
  const selected = (attendees || []).filter((attendee) => targets.has(attendee.memberId));
  if (!selected.length || selected.every((attendee) => attendee.status === status)) {
    return { changed: false, members, attendees, changes: [] };
  }

  let nextMembers = members;
  const changes = [];
  const nextAttendees = attendees.map((attendee) => {
    if (!targets.has(attendee.memberId) || attendee.status === status) return attendee;

    if (attendee.deductFrom) {
      nextMembers = restoreDeduction(nextMembers, attendee.memberId, attendee.deductFrom);
    }
    let deductFrom = null;
    if (status === "done") {
      const deduction = deductOne(nextMembers, attendee.memberId);
      nextMembers = deduction.members;
      deductFrom = deduction.deductFrom;
    }
    changes.push({
      memberId: attendee.memberId,
      previousStatus: attendee.status,
      status,
      restoredFrom: BALANCE_LABELS[attendee.deductFrom] || null,
      deductFrom,
    });
    return { ...attendee, status, deductFrom, noshowFee: null };
  });

  return { changed: true, members: nextMembers, attendees: nextAttendees, changes };
}

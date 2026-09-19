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

/**
 * 소속 모드에서는 기기 저장 잔여를 줄이지 않는다.
 *
 * 잔여의 원본이 조직 회원권으로 옮겨졌고, 그 숫자는 원장과 함께만 움직인다
 * (pass-repository 의 deductPass). 여기서 기기 쪽 숫자를 줄이면 두 숫자가 갈라
 * 지고, 갈라진 뒤에는 어느 것이 맞는지 아무도 모른다 -- 급여가 원장에서 나오므로
 * 기기 쪽을 줄인 회차는 아무에게도 지급되지 않는다.
 *
 * 그래서 출석은 상태만 바꾸고, 차감은 출석 체크 화면이 한다. blocked 로
 * 돌려주면 화면이 그쪽으로 안내한다 -- 조용히 0회 차감으로 넘어가면 강사는
 * 차감된 줄로 안다.
 *
 * @param {{ members?: Array<any>, attendees?: Array<any>, memberIds?: Array<string>, status?: string, organizationMode?: boolean }} input
 */
export function transitionAttendance({ members, attendees, memberIds, status, organizationMode = false }) {
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
    if (status === "done" && !organizationMode) {
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

  return {
    changed: true,
    members: nextMembers,
    attendees: nextAttendees,
    changes,
    // 상태는 바뀌었고 차감은 일어나지 않았다. 화면이 그 사실을 말해야 한다.
    blocked: organizationMode && status === "done",
  };
}

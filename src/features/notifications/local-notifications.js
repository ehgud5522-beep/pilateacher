import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export const LESSON_NOTIFICATION_CHANNEL_ID = "lesson-reminders";
export const LESSON_NOTIFICATION_KIND = "lesson_reminder";
export const LESSON_NOTIFICATION_WINDOW_DAYS = 7;
export const LESSON_NOTIFICATION_LIMIT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_MS = 10 * 60 * 1000;

let permissionRequestedThisSession = false;
let androidChannelReady = false;
let reconciliation = Promise.resolve();

const normalizedAttendees = (lesson) => {
  if (Array.isArray(lesson?.attendees) && lesson.attendees.length) {
    return lesson.attendees.filter((attendee) => attendee?.memberId);
  }
  if (Array.isArray(lesson?.memberIds)) {
    return lesson.memberIds.filter(Boolean).map((memberId) => ({ memberId, status: "booked" }));
  }
  return lesson?.memberId
    ? [{ memberId: lesson.memberId, status: lesson.status || "booked" }]
    : [];
};

const lessonStart = (lesson) => {
  if (!lesson?.date || !lesson?.start) return null;
  const value = new Date(`${lesson.date}T${lesson.start}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
};

const memberName = (members, memberId) => {
  const member = (Array.isArray(members) ? members : []).find((item) => item?.id === memberId);
  return String(member?.name || "회원").trim() || "회원";
};

const isEquipmentGroup = (lesson, attendees) => (
  !lesson?.personal
  && attendees.length === 0
  && (lesson?.type === "그룹" || lesson?.equip || Number(lesson?.groupCount) > 0)
);

export function notificationIdForLesson(lessonId) {
  const source = `lesson:${String(lessonId || "")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const id = hash >>> 1;
  return id || 1;
}

export function buildLessonNotificationPlan({
  schedule = [],
  members = [],
  now = new Date(),
  windowDays = LESSON_NOTIFICATION_WINDOW_DAYS,
  limit = LESSON_NOTIFICATION_LIMIT,
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const currentMs = current.getTime();
  if (!Number.isFinite(currentMs)) return [];
  const windowEndMs = currentMs + Math.max(0, Number(windowDays) || 0) * DAY_MS;

  return (Array.isArray(schedule) ? schedule : [])
    .flatMap((lesson) => {
      if (!lesson?.id || lesson.personal) return [];
      const startAt = lessonStart(lesson);
      if (!startAt || startAt.getTime() > windowEndMs) return [];
      const triggerAt = new Date(startAt.getTime() - REMINDER_MS);
      if (triggerAt.getTime() <= currentMs) return [];

      const attendees = normalizedAttendees(lesson);
      const equipmentGroup = isEquipmentGroup(lesson, attendees);
      if (equipmentGroup && (lesson.groupDone || lesson.groupCancelled)) return [];
      const booked = attendees.filter((attendee) => (attendee.status || "booked") === "booked");
      if (!equipmentGroup && booked.length === 0) return [];

      const group = equipmentGroup || lesson.type === "그룹" || booked.length > 1;
      const people = equipmentGroup
        ? Math.max(1, Number(lesson.groupCount) || Number(lesson.actualCount) || 1)
        : Math.max(1, booked.length);
      const time = String(lesson.start).slice(0, 5);
      const body = group
        ? `10분 뒤 그룹 수업 ${people}명 · ${time}`
        : `10분 뒤 ${memberName(members, booked[0]?.memberId)}님 수업 · ${time}`;

      return [{
        lessonId: String(lesson.id),
        id: notificationIdForLesson(lesson.id),
        triggerAt,
        notification: {
          id: notificationIdForLesson(lesson.id),
          title: "수업 알림",
          body,
          channelId: LESSON_NOTIFICATION_CHANNEL_ID,
          foreground: true,
          extra: { kind: LESSON_NOTIFICATION_KIND, lessonId: String(lesson.id), destination: "schedule" },
        },
      }];
    })
    .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
    .slice(0, Math.max(0, Number(limit) || 0));
}

const notificationExtra = (notification) => {
  if (notification?.extra && typeof notification.extra === "object") return notification.extra;
  if (typeof notification?.extra === "string") {
    try { return JSON.parse(notification.extra); } catch (error) { return {}; }
  }
  return {};
};

export function reconcileLessonNotificationPlan(pending = [], desired = []) {
  const cancel = (Array.isArray(pending) ? pending : [])
    .filter((notification) => notificationExtra(notification).kind === LESSON_NOTIFICATION_KIND)
    .map((notification) => ({ id: notification.id }));
  return { cancel, schedule: Array.isArray(desired) ? desired : [] };
}

const ensureAndroidChannel = async () => {
  if (Capacitor.getPlatform() !== "android" || androidChannelReady) return;
  await LocalNotifications.createChannel({
    id: LESSON_NOTIFICATION_CHANNEL_ID,
    name: "수업 알림",
    description: "예약된 수업 시작 10분 전 알림",
    importance: 4,
    visibility: 1,
    vibration: true,
  });
  androidChannelReady = true;
};

const requestDisplayPermissionIfNeeded = async () => {
  const current = await LocalNotifications.checkPermissions();
  if (current.display === "granted") return true;
  if ((current.display === "prompt" || current.display === "prompt-with-rationale") && !permissionRequestedThisSession) {
    permissionRequestedThisSession = true;
    const requested = await LocalNotifications.requestPermissions();
    return requested.display === "granted";
  }
  return false;
};

const cancelPendingLessonNotifications = async (pending) => {
  const { cancel } = reconcileLessonNotificationPlan(pending, []);
  if (cancel.length) await LocalNotifications.cancel({ notifications: cancel });
  return cancel.length;
};

const synchronizeLessonNotifications = async ({ schedule = [], members = [], now = new Date() } = {}) => {
  if (!Capacitor.isNativePlatform()) return { status: "skipped", reason: "web", scheduled: 0, cancelled: 0 };

  const desired = buildLessonNotificationPlan({ schedule, members, now });
  const pendingResult = await LocalNotifications.getPending();
  const cancelled = await cancelPendingLessonNotifications(pendingResult.notifications);
  if (!desired.length) return { status: "ready", scheduled: 0, cancelled, exact: true };

  const permissionGranted = await requestDisplayPermissionIfNeeded();
  if (!permissionGranted) return { status: "skipped", reason: "permission_denied", scheduled: 0, cancelled };
  await ensureAndroidChannel();

  let exact = true;
  if (Capacitor.getPlatform() === "android") {
    try {
      const status = await LocalNotifications.checkExactNotificationSetting();
      exact = status.exact_alarm === "granted";
    } catch (error) {
      exact = false;
    }
  }

  const notifications = desired.map(({ notification, triggerAt }) => ({
    ...notification,
    schedule: {
      at: triggerAt,
      allowWhileIdle: true,
      isExactNotification: exact,
      isExactMandatory: false,
    },
  }));
  const result = await LocalNotifications.schedule({ notifications });
  return {
    status: "ready",
    scheduled: desired.length,
    cancelled,
    exact: exact && !result.warning,
    approximateFallback: !exact || Boolean(result.warning),
    warningCode: result.warning?.code || null,
  };
};

export function syncLessonNotifications(options) {
  reconciliation = reconciliation
    .catch(() => undefined)
    .then(() => synchronizeLessonNotifications(options));
  return reconciliation;
}

export async function listenForLessonNotificationActions(onOpenSchedule) {
  if (!Capacitor.isNativePlatform()) return () => {};
  const listener = await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const extra = notificationExtra(action?.notification);
    if (extra.kind === LESSON_NOTIFICATION_KIND && typeof onOpenSchedule === "function") {
      onOpenSchedule({ lessonId: extra.lessonId || null });
    }
  });
  return () => listener.remove();
}

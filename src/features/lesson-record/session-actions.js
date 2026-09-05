export function invokeLessonSessionAction(handler, session) {
  if (typeof handler !== "function") return false;
  handler(session);
  return true;
}

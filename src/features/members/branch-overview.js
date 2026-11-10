import { scopedLocationIds } from "../../data/repositories/location-repository.js";
import { hasActivePassBalance, remainingCountOf } from "../../data/repositories/pass-repository.js";
import { passClientIds } from "../../data/schema/pass-clients.js";
import { isPassHeld, holdTime } from "../../../functions/shared/pass-hold.mjs";

const text = (value) => String(value ?? "").trim();
export const canViewBranchOverview = (viewer) => ["owner", "area_manager", "manager"].includes(viewer?.role);
export const overviewPhone = (value) => {
  const digits = text(value).replace(/\D/g, "");
  return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : text(value) || "번호 없음";
};

/** This view is deliberately strict: an unassigned manager never defaults to all branches. */
export function buildBranchOverview({ viewer = {}, clients = [], passes = [], instructors = [], locations = [], locationId = "", search = "", sort = "name", now = new Date() } = {}) {
  const allowed = canViewBranchOverview(viewer);
  const managed = scopedLocationIds(viewer);
  const missingScope = viewer.role === "manager" && !managed.length;
  const accepts = (id) => allowed && !missingScope && (viewer.role !== "manager" || managed.includes(text(id))) && (!locationId || text(id) === locationId);
  const branchChoices = locations.filter((item) => allowed && (viewer.role !== "manager" || managed.includes(text(item.id))));
  const names = new Map(instructors.map((item) => [text(item.userId), text(item.displayName) || "이름 미등록 강사"]));
  const groups = new Map();
  const group = (id) => {
    if (!groups.has(id)) groups.set(id, { id, name: id ? names.get(id) || "이전 담당 강사" : "담당 미지정", rows: [] });
    return groups.get(id);
  };
  for (const teacher of instructors) {
    if (teacher.status && teacher.status !== "active") continue;
    if (teacher.role && teacher.role !== "instructor") continue;
    if (scopedLocationIds(teacher).some(accepts)) group(text(teacher.userId));
  }
  const byClient = new Map();
  for (const pass of passes) {
    if (!accepts(pass.locationId) || pass.status === "cancelled") continue;
    for (const id of passClientIds(pass)) {
      if (!byClient.has(id)) byClient.set(id, []);
      byClient.get(id).push(pass);
    }
  }
  const query = text(search).toLocaleLowerCase().replace(/[\s-]/g, "");
  const foundClients = new Set();
  for (const client of clients) {
    if (!accepts(client.locationId) || client.archived || client.reviewDemo) continue;
    const mine = byClient.get(text(client.id)) || [];
    const live = mine.filter((pass) => hasActivePassBalance(pass, now));
    const latest = [...mine].sort((a, b) => (holdTime(b.createdAt) || 0) - (holdTime(a.createdAt) || 0))[0];
    const ids = [...new Set((live.length ? live : latest ? [latest] : []).map((pass) => text(pass.instructorId)))];
    if (!ids.length) ids.push("");
    for (const id of ids) {
      const assigned = live.filter((pass) => text(pass.instructorId) === id);
      const title = id ? names.get(id) || "이전 담당 강사" : "담당 미지정";
      const haystack = `${client.name || ""}${client.phone || ""}${title}`.toLocaleLowerCase().replace(/[\s-]/g, "");
      if (query && !haystack.includes(query)) continue;
      foundClients.add(client.id);
      group(id).rows.push({
        client, name: text(client.name) || "이름 미등록", phone: overviewPhone(client.phone),
        remaining: assigned.reduce((sum, pass) => sum + remainingCountOf(pass), 0),
        held: assigned.filter((pass) => isPassHeld(pass, now)).reduce((sum, pass) => sum + remainingCountOf(pass), 0),
        shared: assigned.some((pass) => passClientIds(pass).length > 1),
      });
    }
  }
  const result = [...groups.values()].filter((item) => !query || item.rows.length);
  for (const item of result) item.rows.sort((a, b) => (sort === "remaining" ? a.remaining - b.remaining : 0) || a.name.localeCompare(b.name, "ko") || a.phone.localeCompare(b.phone));
  result.sort((a, b) => (!a.id ? 1 : !b.id ? -1 : a.name.localeCompare(b.name, "ko")));
  return { allowed, missingScope, locations: branchChoices, groups: result, count: foundClients.size };
}

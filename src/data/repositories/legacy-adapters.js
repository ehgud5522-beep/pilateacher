import { ClientRepository, LessonRepository } from "./contracts.js";

/**
 * Thin adapters around existing callbacks. They intentionally do not reproduce
 * localStorage, IndexedDB, or users/{uid}/backup/latest behavior.
 */
export class LegacyClientRepository extends ClientRepository {
  constructor(callbacks) {
    super();
    this.callbacks = callbacks;
  }
  createClient(context, client) { return this.callbacks.createClient(context, client); }
  updateClient(context, client) { return this.callbacks.updateClient(context, client); }
  archiveClient(context, client) { return this.callbacks.archiveClient(context, client); }
  deleteClient(context, clientId) { return this.callbacks.deleteClient(context, clientId); }
  getClientById(context, clientId) { return this.callbacks.getClientById(context, clientId); }
  listClients(context) { return this.callbacks.listClients(context); }
  saveClientSnapshot(context, client) { return this.callbacks.saveClientSnapshot(context, client); }
}

export class LegacyLessonRepository extends LessonRepository {
  constructor(callbacks) {
    super();
    this.callbacks = callbacks;
  }
  createLesson(context, lesson) { return this.callbacks.createLesson(context, lesson); }
  updateLesson(context, lesson) { return this.callbacks.updateLesson(context, lesson); }
  changeLessonStatus(context, lessonId, status) { return this.callbacks.changeLessonStatus(context, lessonId, status); }
  saveAttendance(context, lessonId, attendance) { return this.callbacks.saveAttendance(context, lessonId, attendance); }
  saveRecordStatus(context, lessonId, status) { return this.callbacks.saveRecordStatus(context, lessonId, status); }
  getLessonById(context, lessonId) { return this.callbacks.getLessonById(context, lessonId); }
  listLessonsByRange(context, range) { return this.callbacks.listLessonsByRange(context, range); }
}

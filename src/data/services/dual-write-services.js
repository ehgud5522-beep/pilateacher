import { DUAL_WRITE_OPERATION } from "../schema/constants.js";

export class ClientDualWriteService {
  constructor({ coordinator, repository }) {
    this.coordinator = coordinator;
    this.repository = repository;
  }
  create(context, client, legacyWrite) {
    return this.run(context, client, DUAL_WRITE_OPERATION.CREATE, legacyWrite, () => this.repository.createClient(context, client));
  }
  update(context, client, legacyWrite) {
    return this.run(context, client, DUAL_WRITE_OPERATION.UPDATE, legacyWrite, () => this.repository.updateClient(context, client));
  }
  archive(context, client, legacyWrite) {
    return this.run(context, client, DUAL_WRITE_OPERATION.ARCHIVE, legacyWrite, () => this.repository.archiveClient(context, client));
  }
  run(context, client, operation, legacyWrite, newWrite) {
    return this.coordinator.execute({ context, entityType: "client", entityId: client.id, operation, legacyWrite, newWrite });
  }
}

export class LessonDualWriteService {
  constructor({ coordinator, repository }) {
    this.coordinator = coordinator;
    this.repository = repository;
  }
  create(context, lesson, legacyWrite) {
    return this.run(context, lesson.id, DUAL_WRITE_OPERATION.CREATE, legacyWrite, () => this.repository.createLesson(context, lesson));
  }
  update(context, lesson, legacyWrite) {
    return this.run(context, lesson.id, DUAL_WRITE_OPERATION.UPDATE, legacyWrite, () => this.repository.updateLesson(context, lesson));
  }
  changeStatus(context, lessonId, status, legacyWrite) {
    return this.run(context, lessonId, DUAL_WRITE_OPERATION.CHANGE_STATUS, legacyWrite, () => this.repository.changeLessonStatus(context, lessonId, status));
  }
  saveAttendance(context, lessonId, attendance, legacyWrite) {
    return this.run(context, lessonId, DUAL_WRITE_OPERATION.SAVE_ATTENDANCE, legacyWrite, () => this.repository.saveAttendance(context, lessonId, attendance));
  }
  saveRecordStatus(context, lessonId, status, legacyWrite) {
    return this.run(context, lessonId, DUAL_WRITE_OPERATION.SAVE_RECORD_STATUS, legacyWrite, () => this.repository.saveRecordStatus(context, lessonId, status));
  }
  run(context, entityId, operation, legacyWrite, newWrite) {
    return this.coordinator.execute({ context, entityType: "lesson", entityId, operation, legacyWrite, newWrite });
  }
}

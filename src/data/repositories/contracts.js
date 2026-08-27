/**
 * Runtime repository contracts. Implementations may target the legacy snapshot
 * or the additive Firestore structure; callers depend only on these methods.
 */
export class ClientRepository {
  createClient(_context, _client) { throw new Error("Not implemented"); }
  updateClient(_context, _client) { throw new Error("Not implemented"); }
  archiveClient(_context, _client) { throw new Error("Not implemented"); }
  deleteClient(_context, _clientId) { throw new Error("Not implemented"); }
  getClientById(_context, _clientId) { throw new Error("Not implemented"); }
  listClients(_context) { throw new Error("Not implemented"); }
  saveClientSnapshot(_context, _client) { throw new Error("Not implemented"); }
}

export class LessonRepository {
  createLesson(_context, _lesson) { throw new Error("Not implemented"); }
  updateLesson(_context, _lesson) { throw new Error("Not implemented"); }
  changeLessonStatus(_context, _lessonId, _status) { throw new Error("Not implemented"); }
  saveAttendance(_context, _lessonId, _attendance) { throw new Error("Not implemented"); }
  saveRecordStatus(_context, _lessonId, _status) { throw new Error("Not implemented"); }
  getLessonById(_context, _lessonId) { throw new Error("Not implemented"); }
  listLessonsByRange(_context, _range) { throw new Error("Not implemented"); }
}

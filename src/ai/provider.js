import { AI_OPERATIONS } from "./contracts.js";

export class AIProvider {
  constructor(providerId) {
    if (new.target === AIProvider) throw new TypeError("AIProvider is an interface and cannot be instantiated directly");
    this.providerId = providerId;
  }

  getStatus() {
    throw new Error("getStatus() must be implemented");
  }

  execute(_operation, _input, _options) {
    throw new Error("execute() must be implemented");
  }

  analyzeBody(input, options) {
    return this.execute(AI_OPERATIONS.ANALYZE_BODY, input, options);
  }

  summarizeVoice(input, options) {
    return this.execute(AI_OPERATIONS.SUMMARIZE_VOICE, input, options);
  }

  structureLessonRecord(input, options) {
    return this.execute(AI_OPERATIONS.STRUCTURE_LESSON_RECORD, input, options);
  }

  lessonRecordFromAudio(input, options) {
    return this.execute(AI_OPERATIONS.LESSON_RECORD_FROM_AUDIO, input, options);
  }

  // DEFER: sequence contracts remain for forward compatibility, but the
  // client exposes no callable recommendation path while the feature is off.

  generateReport(input, options) {
    return this.execute(AI_OPERATIONS.GENERATE_REPORT, input, options);
  }
}

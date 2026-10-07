/// <reference path="../pb_data/types.d.ts" />
// Exams a student wrote before the trainer existed, entered by the teacher with tools/exam_api.mjs.
// One row = one exam: per-task points (null = not solved), the numbers of tasks that were not in the variant, and the fixed test score entered by the teacher (no scale converts these).
// The student may read own rows; every write goes through the routes of pb_hooks/exams.js.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const rule = 'user = @request.auth.id || @request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "exam_history",
    listRule: rule, viewRule: rule, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "date", required: true, max: 10, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      { type: "text", name: "title", required: true, max: 80 },
      { type: "json", name: "scores", required: true, maxSize: 5000 },
      { type: "json", name: "na", maxSize: 1000 },
      { type: "number", name: "test", required: true, min: 0, max: 100, onlyInt: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_exhist_unique ON exam_history (user, date, title)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("exam_history"));
});

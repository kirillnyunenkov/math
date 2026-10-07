/// <reference path="../pb_data/types.d.ts" />
// Photos the teacher adds to the comment of a long task while checking an exam
// (a worked solution, a marked-up copy of the student's work). A collection of
// its own, so that nothing about the student's own photos changes. The student
// may read a row only once the exam is checked; writes go through the routes of
// pb_hooks/exams.js (the teacher's call on the existing photo routes).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const assignments = app.findCollectionByNameOrId("exam_assignments");
  const rule = '(user = @request.auth.id && assignment.checked > 0) || @request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "exam_feedback_photos",
    listRule: rule, viewRule: rule, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "relation", name: "assignment", required: true, collectionId: assignments.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "n", required: true, max: 8 },
      { type: "file", name: "file", required: true, maxSelect: 1, maxSize: 10485760, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_exfb_assignment ON exam_feedback_photos (assignment, n)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("exam_feedback_photos"));
});

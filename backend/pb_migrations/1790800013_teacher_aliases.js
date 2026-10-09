/// <reference path="../pb_data/types.d.ts" />
// The teacher's private name for a student. Only the teacher can read or write
// it: students never see it, and no student-facing route returns it.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "teacher_aliases",
    listRule: teacher, viewRule: teacher, createRule: teacher, updateRule: teacher, deleteRule: teacher,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "alias", required: true, max: 80 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_taliases_user ON teacher_aliases (user)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("teacher_aliases"));
});

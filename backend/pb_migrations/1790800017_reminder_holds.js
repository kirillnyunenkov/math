/// <reference path="../pb_data/types.d.ts" />
// The monthly mock reminder put off for a student (away, ill): the panel hides
// it until `until` (unix seconds, a Moscow midnight). Teacher-only, like aliases.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "reminder_holds",
    listRule: teacher, viewRule: teacher, createRule: teacher, updateRule: teacher, deleteRule: teacher,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "number", name: "until", required: true, onlyInt: true, min: 1 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_rholds_user ON reminder_holds (user)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("reminder_holds"));
});

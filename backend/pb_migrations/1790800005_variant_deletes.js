/// <reference path="../pb_data/types.d.ts" />
// The teacher can delete a single mock exam. History sync is add-only, so the
// deletion travels to the student's devices as a tombstone row.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "variant_deletes",
    listRule: 'user = @request.auth.id || ' + teacher, viewRule: 'user = @request.auth.id || ' + teacher,
    createRule: teacher, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "uid", required: true, max: 40 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_vdeletes_uid ON variant_deletes (user, uid)",
      "CREATE INDEX idx_vdeletes_created ON variant_deletes (user, created)"],
  }));
  const variants = app.findCollectionByNameOrId("variants");
  variants.deleteRule = teacher;
  app.save(variants);
}, (app) => {
  const variants = app.findCollectionByNameOrId("variants");
  variants.deleteRule = null;
  app.save(variants);
  app.delete(app.findCollectionByNameOrId("variant_deletes"));
});

/// <reference path="../pb_data/types.d.ts" />
// Append-only journal of student actions; the trainer's progress is a fold of it.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const own = 'user = @request.auth.id || @request.auth.role = "teacher"';
  const create = '@request.auth.id != "" && @request.auth.active = true && @request.body.user = @request.auth.id';
  app.save(new Collection({
    type: "base", name: "events",
    listRule: own, viewRule: own, createRule: create, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "uid", required: true, max: 40 },
      { type: "number", name: "ts", required: true, onlyInt: true },
      { type: "select", name: "kind", required: true, values: ["mark", "reset"], maxSelect: 1 },
      { type: "number", name: "n", onlyInt: true, min: 0, max: 20 },
      { type: "number", name: "pid", onlyInt: true, min: 0 },
      { type: "text", name: "status", max: 1, pattern: "^[gob]?$" },
      { type: "select", name: "source", values: ["check", "manual", "import"], maxSelect: 1 },
      { type: "text", name: "given", max: 200 },
      { type: "text", name: "device", max: 20 },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_events_uid ON events (user, uid)",
      "CREATE INDEX idx_events_created ON events (user, created)",
    ],
  }));
  const s = app.settings();
  s.batch.enabled = true;
  s.batch.maxRequests = 200;
  app.save(s);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("events"));
});

/// <reference path="../pb_data/types.d.ts" />
// Telegram profiles of people registered through the bot; `mine` marks the
// teacher's own students. Deliberately a separate collection: saving `users`
// would log every student out. Also makes rate limits count per visitor
// instead of treating everyone behind Caddy as one address.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const teacher = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "tg_profiles",
    listRule: teacher, viewRule: teacher, createRule: null, updateRule: teacher, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "tg_id", required: true, max: 20, pattern: "^[0-9]+$" },
      { type: "text", name: "username", max: 64 },
      { type: "text", name: "first_name", max: 80 },
      { type: "bool", name: "mine" },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_tgp_user ON tg_profiles (user)",
      "CREATE UNIQUE INDEX idx_tgp_tg ON tg_profiles (tg_id)",
    ],
  }));
  const s = app.settings();
  s.trustedProxy.headers = ["X-Forwarded-For"];
  s.trustedProxy.useLeftmostIP = false;
  app.save(s);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("tg_profiles"));
  const s = app.settings();
  s.trustedProxy.headers = [];
  app.save(s);
});

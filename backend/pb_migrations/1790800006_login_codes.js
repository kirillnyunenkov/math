/// <reference path="../pb_data/types.d.ts" />
// One-time sign-in codes: the bot shows a short code, the person types it on a
// device that has no Telegram. Closed to the API entirely; only the hooks in
// pb_hooks/tg.js read and write it. Guessing is capped per address.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base", name: "login_codes",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "code", required: true, max: 6, pattern: "^[0-9]{6}$" },
      { type: "number", name: "expires", required: true, onlyInt: true },   // unix seconds
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_lcodes_code ON login_codes (code)",
      "CREATE INDEX idx_lcodes_user ON login_codes (user)",
    ],
  }));
  const s = app.settings();
  s.rateLimits.rules = s.rateLimits.rules.concat([{ label: "POST /api/tg/code", maxRequests: 5, duration: 60 }]);
  app.save(s);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("login_codes"));
  const s = app.settings();
  s.rateLimits.rules = s.rateLimits.rules.filter((r) => r.label !== "POST /api/tg/code");
  app.save(s);
});

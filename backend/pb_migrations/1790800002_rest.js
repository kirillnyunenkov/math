/// <reference path="../pb_data/types.d.ts" />
// Mock-exam history, history clears, login links (teacher-only), rate limits.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const own = 'user = @request.auth.id || @request.auth.role = "teacher"';
  const create = '@request.auth.id != "" && @request.auth.active = true && @request.body.user = @request.auth.id';
  const userRel = { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true };
  const created = { type: "autodate", name: "created", onCreate: true, onUpdate: false };
  const num = (name) => ({ type: "number", name, onlyInt: true });

  app.save(new Collection({
    type: "base", name: "variants",
    listRule: own, viewRule: own, createRule: create, updateRule: null, deleteRule: null,
    fields: [userRel, { type: "text", name: "uid", required: true, max: 40 },
      { ...num("t"), required: true }, num("p"), num("s"), num("ms"), num("total"), num("m"),
      { type: "json", name: "q", maxSize: 20000 }, created],
    indexes: ["CREATE UNIQUE INDEX idx_variants_uid ON variants (user, uid)",
      "CREATE INDEX idx_variants_created ON variants (user, created)"],
  }));

  app.save(new Collection({
    type: "base", name: "variant_clears",
    listRule: own, viewRule: own, createRule: create, updateRule: null, deleteRule: null,
    fields: [userRel, { type: "text", name: "uid", required: true, max: 40 }, { ...num("ts"), required: true }, created],
    indexes: ["CREATE UNIQUE INDEX idx_vclears_uid ON variant_clears (user, uid)",
      "CREATE INDEX idx_vclears_created ON variant_clears (user, created)"],
  }));

  const teacher = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "links",
    listRule: teacher, viewRule: teacher, createRule: teacher, updateRule: teacher, deleteRule: teacher,
    fields: [userRel, { type: "text", name: "secret", required: true, max: 100 }, created],
    indexes: ["CREATE UNIQUE INDEX idx_links_user ON links (user)"],
  }));

  const s = app.settings();
  s.rateLimits.enabled = true;
  s.rateLimits.rules = [
    { label: "*:auth", maxRequests: 10, duration: 60 },
    { label: "/api/", maxRequests: 300, duration: 10 },
  ];
  app.save(s);
}, (app) => {
  for (const c of ["links", "variant_clears", "variants"]) app.delete(app.findCollectionByNameOrId(c));
});

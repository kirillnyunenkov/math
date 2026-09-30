/// <reference path="../pb_data/types.d.ts" />
// Deactivated students cannot log in (or refresh a session) at all.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authRule = "active = true";
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authRule = "";
  app.save(users);
});

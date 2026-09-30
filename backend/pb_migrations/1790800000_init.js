/// <reference path="../pb_data/types.d.ts" />
// Users of the EGE trainer: invited students and the teacher.
// Login is by link: identity = `login`, password = random secret from the link.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.getByName("email").required = false;
  users.fields.add(new TextField({ name: "login", required: true, min: 3, max: 40, pattern: "^[a-z0-9_-]+$" }));
  users.fields.add(new TextField({ name: "name", max: 80 }));
  users.fields.add(new SelectField({ name: "role", required: true, values: ["student", "teacher"], maxSelect: 1 }));
  users.fields.add(new BoolField({ name: "active" }));
  users.addIndex("idx_users_login", true, "login", "");
  users.passwordAuth.identityFields = ["login"];
  users.authToken.duration = 90 * 24 * 3600;
  users.listRule = 'id = @request.auth.id || @request.auth.role = "teacher"';
  users.viewRule = users.listRule;
  users.createRule = '@request.auth.role = "teacher"';
  users.updateRule = '@request.auth.role = "teacher"';
  users.deleteRule = null;
  users.manageRule = '@request.auth.role = "teacher"';
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  for (const f of ["login", "name", "role", "active"]) users.fields.removeByName(f);
  users.removeIndex("idx_users_login");
  users.passwordAuth.identityFields = ["email"];
  users.fields.getByName("email").required = true;
  app.save(users);
});

/// <reference path="../pb_data/types.d.ts" />
// One table of short one-time codes for two jobs: signing in on a device without
// Telegram (purpose empty) and binding a real Telegram to an invited account
// (purpose "link"). The sign-in endpoint ignores codes that have a purpose.
migrate((app) => {
  const c = app.findCollectionByNameOrId("login_codes");
  c.fields.add(new TextField({ name: "purpose", max: 10 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("login_codes");
  c.fields.removeByName("purpose");
  app.save(c);
});

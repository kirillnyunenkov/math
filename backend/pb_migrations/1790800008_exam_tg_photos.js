/// <reference path="../pb_data/types.d.ts" />
// Photos sent to the bot carry no task, so exam_photos.n becomes optional (empty
// = "sent to the bot"). exam_assignments.tg_group remembers the album id of the
// last bot photo: the bot answers once per album. `users` is not touched.
migrate((app) => {
  const photos = app.findCollectionByNameOrId("exam_photos");
  photos.fields.getByName("n").required = false;
  app.save(photos);
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.add(new TextField({ name: "tg_group", max: 40 }));
  app.save(asg);
}, (app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.removeByName("tg_group");
  app.save(asg);
  const photos = app.findCollectionByNameOrId("exam_photos");
  photos.fields.getByName("n").required = true;
  app.save(photos);
});

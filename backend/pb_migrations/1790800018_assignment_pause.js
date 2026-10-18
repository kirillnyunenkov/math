/// <reference path="../pb_data/types.d.ts" />
// exam_assignments.paused: the moment the teacher put a running exam on hold (unix
// seconds, 0 = not paused). A one-off exception, set for one assignment; the
// student's "resume" adds the pause to the duration and clears it.
migrate((app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.add(new NumberField({ name: "paused", onlyInt: true }));
  app.save(asg);
}, (app) => {
  const asg = app.findCollectionByNameOrId("exam_assignments");
  asg.fields.removeByName("paused");
  app.save(asg);
});

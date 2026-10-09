/// <reference path="../pb_data/types.d.ts" />
// exams.solution_url: a link to the teacher's own solutions of the exam. Only the teacher reads the exams
// collection (the student routes in pb_hooks/exams.js build their answers field by field), so the link is
// shown on the check page of the panel and nowhere else.
migrate((app) => {
  const exams = app.findCollectionByNameOrId("exams");
  exams.fields.add(new TextField({ name: "solution_url", max: 500 }));
  app.save(exams);
}, (app) => {
  const exams = app.findCollectionByNameOrId("exams");
  exams.fields.removeByName("solution_url");
  app.save(exams);
});

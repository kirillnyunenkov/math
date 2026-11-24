/// <reference path="../pb_data/types.d.ts" />
// Event numbers are stable topic identifiers. 21 is the restored derivative bank.
migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  events.fields.getByName("n").max = 21;
  app.save(events);
}, (app) => {
  // Preserve existing derivative events on rollback; lowering the maximum would
  // make retained records invalid when updated by administrative tools.
});

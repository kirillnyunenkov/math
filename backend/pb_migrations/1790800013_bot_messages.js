/// <reference path="../pb_data/types.d.ts" />
// Journal of everything the bot sent: one row per attempt to send a message.
// The teacher may read it; every write comes from tg.send in pb_hooks/tg.js.
// No link and no sign-in code is stored here (both are secrets), only the text
// as the person saw it with the code masked, and the label of the button.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const rule = '@request.auth.role = "teacher"';
  app.save(new Collection({
    type: "base", name: "bot_messages",
    listRule: rule, viewRule: rule, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "text", name: "chat", required: true, max: 20 },
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, cascadeDelete: false },   // empty for chats without a profile (the teacher)
      { type: "text", name: "text", max: 4096 },
      { type: "text", name: "label", max: 64 },
      { type: "bool", name: "ok" },
      { type: "number", name: "status", onlyInt: true },   // Telegram's answer; 0 = no answer at all
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_botmsg_created ON bot_messages (created)", "CREATE INDEX idx_botmsg_user ON bot_messages (user)"],
  }));
}, (app) => {
  app.delete(app.findCollectionByNameOrId("bot_messages"));
});

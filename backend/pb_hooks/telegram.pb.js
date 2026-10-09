/// <reference path="../pb_data/types.d.ts" />
// Telegram bot: registration and sign-in links. Logic lives in tg.js because
// PocketBase runs every handler in an isolated scope.
routerAdd("POST", "/api/tg/webhook", (e) => require(`${__hooks}/tg.js`).webhook(e));
routerAdd("POST", "/api/tg/code", (e) => require(`${__hooks}/tg.js`).claim(e));
routerAdd("GET", "/api/ege/leads", (e) => require(`${__hooks}/tg.js`).leads(e));
routerAdd("POST", "/api/ege/invite", (e) => require(`${__hooks}/tg.js`).invite(e));
routerAdd("POST", "/api/ege/name", (e) => require(`${__hooks}/tg.js`).setName(e));
routerAdd("GET", "/api/ege/tg-link", (e) => require(`${__hooks}/tg.js`).tgLinkStatus(e));
routerAdd("POST", "/api/ege/tg-link", (e) => require(`${__hooks}/tg.js`).tgLinkCode(e));

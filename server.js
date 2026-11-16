// ЗначокUA v2.4: Нижня панель, AI-опис товару, Подарункові бокси (фіксовані + конструктор), Розумне повідомлення коли зачинено
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

try {
  for (const l of fs.readFileSync(path.join(__dirname, "settings.env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BOT_API_URL = process.env.BOT_API_URL;
const SITE_KEY = process.env.SITE_KEY;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !BOT_API_URL || !SITE_KEY || /ВСТАВТЕ/.test(ADMIN_PASSWORD + BOT_API_URL + SITE_KEY)) {
  console.error("Відкрийте файл settings.env (або Environment на Render) та впишіть ADMIN_EMAIL, ADMIN_PASSWORD, BOT_API_URL і SITE_KEY");
  process.exit(1);
}

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data.json");

const defaultSchedule = () => ({
  1: { open: "09:00", close: "19:00", off: false },
  2: { open: "09:00", close: "19:00", off: false },
  3: { open: "09:00", close: "19:00", off: false },
  4: { open: "09:00", close: "19:00", off: false },
  5: { open: "09:00", close: "19:00", off: false },
  6: { open: "10:00", close: "17:00", off: false },
  0: { open: "10:00", close: "15:00", off: true }
});

let db = {
  meta: {},
  tickets: [],
  keys: {},
  staff: [],
  ads: [],
  promos: [],
  expenses: [],
  localOrders: [],
  hiddenOrders: [],
  settings: {
    shopName: "ЗначокUA",
    phone: "+380 XX XXX XX XX",
    openYear: "2026",
    open: 1,
    autoSchedule: 1,
    desc: "Яскраві значки з українським характером. Самовивіз — забирайте зручно у нас!",
    contacts: "Telegram бот: @znachok_ua_bot",
    pickupAddress: "Самовивіз (деталі узгоджуються після замовлення)",
    schedule: defaultSchedule()
  }
};

try {
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  Object.assign(db, loaded);
  if (!db.settings) db.settings = {};
  if (!db.settings.schedule) db.settings.schedule = defaultSchedule();
  if (db.settings.autoSchedule === undefined) db.settings.autoSchedule = 1;
  if (!db.settings.shopName) db.settings.shopName = "ЗначокUA";
  if (!db.settings.phone) db.settings.phone = "+380 XX XXX XX XX";
  if (!db.settings.openYear) db.settings.openYear = "2026";
  if (!Array.isArray(db.ads)) db.ads = [];
  if (!Array.isArray(db.promos)) db.promos = [];
  if (!Array.isArray(db.expenses)) db.expenses = [];
  if (!Array.isArray(db.staff)) db.staff = [];
  if (!Array.isArray(db.localOrders)) db.localOrders = [];
  if (!Array.isArray(db.hiddenOrders)) db.hiddenOrders = [];
} catch {}

const save = () => {
  fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db, null, 2));
  fs.renameSync(DB_FILE + ".tmp", DB_FILE);
};

const eq = (a, b) => crypto.timingSafeEqual(
  crypto.createHash("sha256").update(String(a)).digest(),
  crypto.createHash("sha256").update(String(b)).digest()
);

const nowStr = () => new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" });
const nickOf = s => String(s || "").trim().replace(/^@/, "").toLowerCase();
const d10 = s => String(s || "").replace(/\D/g, "").slice(-10);

function isShopOpenNow() {
  if (!db.settings.open) return false;
  if (!db.settings.autoSchedule) return !!db.settings.open;
  try {
    const kyivStr = new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" });
    const dt = new Date(kyivStr);
    const day = dt.getDay();
    const sch = (db.settings.schedule && db.settings.schedule[day]) || { open: "09:00", close: "19:00", off: false };
    if (sch.off) return false;
    const curMin = dt.getHours() * 60 + dt.getMinutes();
    const [oh, om] = String(sch.open || "09:00").split(":").map(Number);
    const [ch, cm] = String(sch.close || "19:00").split(":").map(Number);
    return curMin >= ((oh || 0) * 60 + (om || 0)) && curMin < ((ch || 0) * 60 + (cm || 0));
  } catch {
    return !!db.settings.open;
  }
}

/* Зв'язок із ботом (Google Apps Script) */
async function bot(action, data = {}) {
  const r = await fetch(BOT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ site_key: SITE_KEY, action, ...data }),
    redirect: "follow"
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error("Бот не відповів (відповідь скрипта: «" + t.replace(/\s+/g, " ").slice(0, 70) + "»). Перевірте BOT_API_URL, SITE_KEY і нове розгортання");
  }
  if (!j.ok) throw new Error(j.error || "Помилка бота");
  return j;
}

let pc = { t: 0, v: [] };
const products = async () => {
  if (Date.now() - pc.t < 15000) return pc.v;
  const r = await bot("products");
  pc = { t: Date.now(), v: r.products };
  return pc.v;
};

const withMeta = p => {
  const m = db.meta[p.id] || {};
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    on: p.on,
    inStock: m.inStock !== undefined ? !!m.inStock : true,
    itemType: m.itemType === "box" ? "box" : "product",
    boxMode: m.boxMode === "builder" ? "builder" : "fixed",
    boxMaxItems: Math.max(1, Math.min(20, +m.boxMaxItems || 3)),
    boxContents: String(m.boxContents || ""),
    boxPoolIds: Array.isArray(m.boxPoolIds) ? m.boxPoolIds : [],
    emoji: m.emoji || (m.itemType === "box" ? "🎁" : "⭐"),
    color: m.color || "#4f46e5",
    img: m.img || "",
    desc: m.desc || ""
  };
};

const IMG = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;

function isAllowedDesignUrl(rawUrl) {
  if (!rawUrl) return true;
  try {
    const u = new URL(rawUrl);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    const isPinterest = host === "pinterest.com" || host.endsWith(".pinterest.com") || host === "pin.it" || host.endsWith(".pinimg.com");
    const isImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(pathname);
    return isPinterest || isImageExt;
  } catch {
    return false;
  }
}

const cleanProducts = a => (Array.isArray(a) ? a : []).slice(0, 200).map(p => ({
  id: +p.id || Date.now(),
  name: String(p.name || "").slice(0, 80),
  desc: String(p.desc || "").slice(0, 800),
  price: Math.max(1, Math.round(+p.price || 0)),
  inStock: p.inStock !== undefined ? !!p.inStock : true,
  itemType: p.itemType === "box" ? "box" : "product",
  boxMode: p.boxMode === "builder" ? "builder" : "fixed",
  boxMaxItems: Math.max(1, Math.min(20, Math.round(+p.boxMaxItems || 3))),
  boxContents: String(p.boxContents || "").slice(0, 400),
  boxPoolIds: Array.isArray(p.boxPoolIds) ? p.boxPoolIds.map(Number).filter(Boolean).slice(0, 50) : [],
  emoji: String(p.emoji || (p.itemType === "box" ? "🎁" : "⭐")).slice(0, 8),
  color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#4f46e5",
  img: typeof p.img === "string" && p.img.length < 600000 && IMG.test(p.img) ? p.img : "",
  on: p.on ? 1 : 0
})).filter(p => p.name);

async function syncProducts(list) {
  const cur = (await bot("products")).products;
  const byId = new Map(cur.map(p => [p.id, p]));
  const seen = new Set();
  const out = [];
  for (const p of cleanProducts(list)) {
    let id = p.id;
    const c = byId.get(id);
    if (c) {
      if (c.price !== p.price) await bot("product_price", { id, price: p.price });
      if (!!c.on !== !!p.on) await bot("product_active", { id, on: p.on });
    } else {
      id = (await bot("product_add", { name: p.name, price: p.price })).id;
      if (!p.on) await bot("product_active", { id, on: 0 });
    }
    seen.add(id);
    db.meta[id] = {
      emoji: p.emoji,
      color: p.color,
      img: p.img,
      desc: p.desc,
      inStock: p.inStock,
      itemType: p.itemType,
      boxMode: p.boxMode,
      boxMaxItems: p.boxMaxItems,
      boxContents: p.boxContents,
      boxPoolIds: p.boxPoolIds
    };
    out.push(withMeta({ ...p, id }));
  }
  for (const c of cur) if (!seen.has(c.id) && c.on) await bot("product_active", { id: c.id, on: 0 });
  pc.t = 0;
  save();
  return out;
}

const STATUS_MAP = {
  new: "Нове",
  paid: "Оплачено",
  work: "В роботі",
  sent: "Готово до видачі",
  done: "Виконано",
  cancel: "Скасовано"
};

const orderView = o => {
  const skey = o.status_key || Object.keys(STATUS_MAP).find(k => STATUS_MAP[k] === o.status) || "new";
  return {
    id: o.id,
    name: o.full_name,
    tg: o.username,
    phone: o.phone || "",
    note: o.comment,
    items: [{ n: o.product, q: o.qty, p: Math.round(o.price / (o.qty || 1)) }],
    sum: o.price,
    status: 0,
    stext: o.status || STATUS_MAP[skey] || "Нове",
    skey: skey,
    date: o.created,
    log: []
  };
};

/* HTTP & Безпека */
const sessions = new Map();
const fails = new Map();
const dangerFails = new Map();
const tgCodes = new Map();

const ALLOWED_ROLES = [
  "badge_master",
  "order_manager",
  "admin",
  "deputy_admin",
  "staff_manager",
  "promo_manager",
  "ads_manager"
];

const hashPw = pw => {
  const salt = crypto.randomBytes(8).toString("hex");
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString("hex") };
};
const hashOk = (pw, s) => eq(crypto.scryptSync(String(pw), s.salt, 32).toString("hex"), s.hash);

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const body = req => new Promise((ok, no) => {
  let b = "";
  req.on("data", c => {
    b += c;
    if (b.length > 3e7) { no(new Error("big")); req.destroy(); }
  });
  req.on("end", () => {
    try { ok(b ? JSON.parse(b) : {}); } catch { no(new Error("bad json")); }
  });
});

const pub = () => ({
  shopName: db.settings.shopName || "ЗначокUA",
  phone: db.settings.phone || "+380 XX XXX XX XX",
  openYear: db.settings.openYear || "2026",
  open: isShopOpenNow() ? 1 : 0,
  manualOpen: db.settings.open ? 1 : 0,
  autoSchedule: db.settings.autoSchedule ? 1 : 0,
  schedule: db.settings.schedule || defaultSchedule(),
  desc: db.settings.desc,
  contacts: db.settings.contacts,
  pickupAddress: db.settings.pickupAddress || "Самовивіз (забирати у продавця)"
});

function genTgCode() {
  const p1 = String(Math.floor(10 + Math.random() * 90));
  const p2 = String(Math.floor(10 + Math.random() * 90));
  return `${p1}-${p2}`;
}

async function api(req, res, url) {
  const m = req.method, p = url.pathname;

  // 1. Публічні дані магазину
  if (m === "GET" && p === "/api/shop") {
    const prods = (await products()).filter(x => x.on).map(withMeta);
    const publicPromos = (db.promos || []).filter(pr => pr.active).map(pr => ({
      id: pr.id,
      title: pr.title,
      desc: pr.desc,
      code: pr.code || "",
      isGlobalDiscount: !pr.code,
      discountPercent: pr.discountPercent
    }));
    return json(res, 200, {
      products: prods,
      ads: db.ads || [],
      promos: publicPromos,
      settings: pub()
    });
  }

  // 2. Перевірка промокоду покупцем
  if (m === "POST" && p === "/api/promo/check") {
    const b = await body(req);
    const code = String(b.code || "").trim().toUpperCase();
    if (!code) return json(res, 400, { error: "Введіть промокод" });
    const found = (db.promos || []).find(pr => pr.active && pr.code && String(pr.code).toUpperCase() === code);
    if (!found) return json(res, 404, { error: "Промокод не знайдено або термін його дії закінчився" });
    return json(res, 200, {
      ok: true,
      code: found.code,
      title: found.title,
      discountPercent: found.discountPercent
    });
  }

  // 3. Відправка коду підтвердження в Telegram бот (@znachok_ua_bot)
  if (m === "POST" && p === "/api/tg/send-code") {
    const b = await body(req);
    const tg = nickOf(b.tg);
    if (!/^[a-z0-9_]{5,32}$/.test(tg)) {
      return json(res, 400, { error: "Вкажіть коректний Telegram username (наприклад @vadym)" });
    }
    const code = genTgCode();
    const expiresInMs = 60 * 1000;
    tgCodes.set(tg, { code, exp: Date.now() + expiresInMs });

    try {
      try {
        const r = await bot("send_code", { username: tg, code });
        if (r && r.fallback) {
          await bot("message", {
            username: tg,
            text: `🔐 Код підтвердження замовлення на сайті ${db.settings.shopName || "ЗначокUA"}: ${code}\n⏳ Дійсний рівно 1 хвилину!`
          });
        }
      } catch {
        await bot("message", {
          username: tg,
          text: `🔐 Код підтвердження замовлення на сайті ${db.settings.shopName || "ЗначокUA"}: ${code}\n⏳ Дійсний рівно 1 хвилину!`
        });
      }
      return json(res, 200, { ok: true, sentTo: "@" + tg, expiresInSec: 60 });
    } catch (e) {
      return json(res, 400, {
        error: "Не вдалося надіслати код. Переконайтеся, що ви запустили бота @znachok_ua_bot (/start).",
        needBotStart: true
      });
    }
  }

  // 4. Оформлення замовлення (дозволяє відкладене оформлення у неробочий час з вибором часу!)
  if (m === "POST" && p === "/api/orders") {
    const b = await body(req);
    const openNow = isShopOpenNow();
    const scheduledTime = String(b.scheduledTime || "").trim().slice(0, 60);

    if (!openNow && !scheduledTime) {
      return json(res, 400, {
        error: "Магазин зараз відпочиває. Оберіть зручний час для відправки замовлення.",
        closedModalRequired: true
      });
    }
    if (b.key && db.keys[b.key]) return json(res, 200, db.keys[b.key]);

    const fullName = String(b.name || "").trim();
    if (fullName.split(/\s+/).filter(Boolean).length < 2 || fullName.length < 4) {
      return json(res, 400, { error: "Вкажіть ім'я та прізвище в одному рядку" });
    }

    const contactType = b.contactType === "tg" ? "tg" : "phone";
    const tg = nickOf(b.tg);
    const phoneDigits = d10(b.phone);

    if (contactType === "tg") {
      if (!/^[a-z0-9_]{5,32}$/.test(tg)) {
        return json(res, 400, { error: "Вкажіть коректний Telegram username" });
      }
      const enteredCode = String(b.tgCode || "").trim().replace(/[^0-9-]/g, "");
      const savedCodeObj = tgCodes.get(tg);
      if (!savedCodeObj || savedCodeObj.exp < Date.now()) {
        return json(res, 400, { error: "Час дії коду (1 хв) вийшов! Новий код потрібно ввести повторно." });
      }
      if (enteredCode !== savedCodeObj.code) {
        return json(res, 400, { error: "Невірний код підтвердження. Перевірте повідомлення від @znachok_ua_bot." });
      }
      tgCodes.delete(tg);
    } else {
      if (phoneDigits.length < 10) {
        return json(res, 400, { error: "Вкажіть коректний номер телефону (10 цифр)" });
      }
    }

    const items = (b.items || []).slice(0, 30).filter(i => +i.q > 0);
    if (!items.length) return json(res, 400, { error: "Кошик порожній" });

    const designLink = String(b.designLink || "").trim().slice(0, 400);
    if (designLink && !isAllowedDesignUrl(designLink)) {
      return json(res, 400, { error: "Дозволено вказувати URL лише на фото (.jpg, .png, .webp) або з сайту pinterest.com!" });
    }

    const designFileName = String(b.designFileName || "").trim().slice(0, 120);
    const designFileData = typeof b.designFileData === "string" ? b.designFileData : "";
    if (designFileData && (!IMG.test(designFileData) || designFileData.length >= 2500000)) {
      return json(res, 400, { error: "Дозволено завантажувати лише фотографії (JPG, PNG, WEBP, GIF до 2 МБ)!" });
    }

    let discountPercent = 0;
    let appliedPromo = "";
    const globalDiscount = (db.promos || []).find(x => x.active && !x.code);
    if (globalDiscount) {
      discountPercent = Math.min(90, Math.max(1, +globalDiscount.discountPercent || 0));
      appliedPromo = globalDiscount.title;
    }
    if (b.promoCode) {
      const pr = (db.promos || []).find(x => x.active && x.code && String(x.code).toUpperCase() === String(b.promoCode).trim().toUpperCase());
      if (pr && (+pr.discountPercent || 0) >= discountPercent) {
        discountPercent = Math.min(90, Math.max(1, +pr.discountPercent || 0));
        appliedPromo = pr.code;
      }
    }

    const phoneFormatted = phoneDigits ? "+38" + phoneDigits : "";
    const comment = `Спосіб отримання: САМОВИВІЗ (забирати у продавця). Оплата: ${b.pay === "card" ? "переказ на картку" : "при отриманні"}.`
      + (scheduledTime ? ` ⏰ Замовлення у неробочий час — бажаний час: ${scheduledTime}.` : "")
      + (phoneFormatted ? ` Тел: ${phoneFormatted}.` : "")
      + (appliedPromo ? ` Знижка/Акція: ${appliedPromo} (-${discountPercent}%).` : "")
      + (designLink ? ` Посилання на фото: ${designLink}.` : "")
      + (designFileName ? ` Прикріплене фото: ${designFileName}.` : "")
      + (String(b.note || "").trim() ? ` Коментар: ${String(b.note).trim().slice(0, 300)}` : "");

    const botUsername = contactType === "tg" ? tg : ("phone_" + phoneDigits);
    const ids = [];
    let notified = false;

    for (const it of items) {
      const qty = Math.min(999, Math.floor(+it.q));
      const rawSum = (+it.price || 0) * qty;
      const finalSum = discountPercent > 0 ? Math.round(rawSum * (100 - discountPercent) / 100) : rawSum;
      const boxDetails = it.boxSummary ? ` [Склад боксу: ${String(it.boxSummary).slice(0, 200)}]` : "";

      const r = await bot("order", {
        product_id: +it.id,
        qty,
        username: botUsername,
        name: fullName.slice(0, 60),
        comment: comment + boxDetails,
        design: designLink || designFileName || ""
      });
      ids.push(r.id);
      notified = notified || r.notified;

      db.localOrders.push({
        id: r.id,
        name: fullName.slice(0, 60),
        tg: contactType === "tg" ? "@" + tg : "",
        phone: phoneFormatted,
        delivery: "Самовивіз",
        pay: b.pay === "card" ? "Переказ на картку" : "При отриманні",
        scheduledTime,
        promo: appliedPromo,
        discountPercent,
        designLink,
        designFileName,
        designFileData,
        note: (String(b.note || "").trim() + boxDetails).trim(),
        product: (it.name || ("Товар #" + it.id)) + boxDetails,
        qty,
        sum: finalSum,
        skey: "new",
        stext: scheduledTime ? `Заплановано (${scheduledTime})` : "Нове",
        date: nowStr()
      });
    }

    const out = { id: ids.join(", "), notified, scheduledTime };
    if (b.key) db.keys[b.key] = out;
    save();
    return json(res, 200, out);
  }

  // 5. Перевірка статусу замовлення
  if (m === "POST" && p === "/api/lookup") {
    const b = await body(req);
    const raw = String(b.phone || "").trim();
    const n = nickOf(raw);
    const ph = d10(raw);

    let botOrders = [];
    if (/^[a-z0-9_]{5,32}$/.test(n)) {
      try {
        const r = await bot("lookup", { username: n });
        botOrders = (r.orders || []).map(orderView);
      } catch {}
    } else if (ph.length >= 10) {
      try {
        const r = await bot("lookup", { username: "phone_" + ph });
        botOrders = (r.orders || []).map(orderView);
      } catch {}
    } else {
      return json(res, 400, { error: "Введіть нікнейм Telegram або номер телефону (10 цифр)" });
    }

    const localMatched = (db.localOrders || []).filter(lo => {
      if (db.hiddenOrders.includes(lo.id)) return false;
      if (ph.length >= 10 && d10(lo.phone) === ph) return true;
      if (n && nickOf(lo.tg) === n) return true;
      return false;
    }).map(lo => ({
      id: lo.id,
      items: [{ n: lo.product, q: lo.qty, p: Math.round(lo.sum / (lo.qty || 1)) }],
      sum: lo.sum,
      status: 0,
      stext: lo.stext,
      date: lo.date,
      log: []
    }));

    const seenIds = new Set(botOrders.map(x => String(x.id)));
    const combined = [
      ...botOrders.filter(x => !db.hiddenOrders.includes(x.id)).map(({ id, items, sum, stext, date }) => ({ id, items, sum, status: 0, stext, date, log: [] })),
      ...localMatched.filter(x => !seenIds.has(String(x.id)))
    ];

    return json(res, 200, { orders: combined });
  }

  // 6. Підтримка (тікети) — повертає статус магазину та автоматичну ввічливу відповідь, якщо зачинено
  if (m === "POST" && p === "/api/tickets") {
    const b = await body(req);
    const tg = nickOf(b.tg);
    const scheduledTime = String(b.scheduledTime || "").trim().slice(0, 60);
    if (tg.length < 4 || !String(b.text || "").trim()) {
      return json(res, 400, { error: "Вкажіть контакт (Telegram або телефон) і повідомлення" });
    }
    const openNow = isShopOpenNow();
    const fullText = String(b.text).slice(0, 900) + (scheduledTime ? `\n[⏰ Обраний клієнтом час для зв'язку/відправки: ${scheduledTime}]` : "");
    const t = { id: db.tickets.length + 1, tg, text: fullText, reply: "", date: nowStr() };
    db.tickets.push(t);
    save();
    await bot("support", { username: tg, text: t.text }).catch(() => {});
    return json(res, 200, { id: t.id, shopOpen: openNow });
  }

  // 7. Вхід у панель керування
  if (m === "POST" && p === "/api/login") {
    const ip = req.socket.remoteAddress || "unknown";
    const f = fails.get(ip) || { n: 0, t: 0 };
    if (f.n >= 5 && Date.now() - f.t < 6e5) {
      return json(res, 429, { error: "Забагато спроб входу. Зачекайте 10 хвилин" });
    }
    const b = await body(req);
    const em = String(b.email || "").toLowerCase().trim();
    const stf = (db.staff || []).find(x => x.email === em);
    let who = null;

    if (em === ADMIN_EMAIL && eq(b.password, ADMIN_PASSWORD)) {
      who = { role: "owner", name: "Вадим", email: em };
    } else if (stf && hashOk(b.password, stf)) {
      who = { role: stf.role, name: stf.name || em, email: em };
    }

    if (who) {
      fails.delete(ip);
      const t = crypto.randomBytes(24).toString("hex");
      sessions.set(t, { exp: Date.now() + 432e5, ...who });
      return json(res, 200, { token: t, role: who.role, name: who.name, email: who.email });
    }

    fails.set(ip, { n: f.n + 1, t: Date.now() });
    return json(res, 401, { error: "Невірний логін або пароль" });
  }

  // ЗАХИЩЕНІ МАРШРУТИ АДМІНПАНЕЛІ
  if (p.startsWith("/api/admin/")) {
    const t = (req.headers.authorization || "").slice(7);
    const ss = sessions.get(t);
    if (!ss || ss.exp < Date.now()) return json(res, 401, { error: "Сесія завершена. Увійдіть знову" });

    // Зміна статусів через сайт ЗАБОРОНЕНА
    const bk = p.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (m === "PUT" && bk) {
      return json(res, 403, { error: "Змінювати статуси замовлень через сайт заборонено. Використовуйте Telegram-бот." });
    }

    // Витрати
    if (p === "/api/admin/expenses" && m === "POST") {
      if (!["owner", "admin"].includes(ss.role)) {
        return json(res, 403, { error: "Немає прав на додавання витрат" });
      }
      const b = await body(req);
      const title = String(b.title || "").trim().slice(0, 80);
      const amount = Math.max(1, Math.round(+b.amount || 0));
      if (!title || !amount) return json(res, 400, { error: "Вкажіть назву та суму витрат" });
      db.expenses.unshift({ id: Date.now(), title, amount, date: nowStr() });
      save();
      return json(res, 200, { ok: 1 });
    }

    // Персонал
    if (p.startsWith("/api/admin/staff")) {
      if (!["owner", "admin", "staff_manager"].includes(ss.role)) {
        return json(res, 403, { error: "Доступ мають лише Власник, Адміністратор та Менеджер персоналу" });
      }
      if (m === "GET") {
        const list = [
          { email: ADMIN_EMAIL, role: "owner", name: "Власник (Головний)", tgUser: "", protected: true },
          ...(db.staff || []).map(x => ({ email: x.email, role: x.role, name: x.name, tgUser: x.tgUser || "", protected: false }))
        ];
        return json(res, 200, { staff: list });
      }
      if (m === "POST") {
        const b = await body(req);
        const em = String(b.email || "").toLowerCase().trim();
        const tgUser = String(b.tgUser || "").trim().slice(0, 60);
        if (em === ADMIN_EMAIL) {
          return json(res, 403, { error: "Неможливо змінювати обліковий запис Власника" });
        }
        const targetExisting = (db.staff || []).find(x => x.email === em);
        if (ss.role === "staff_manager") {
          if (b.role === "admin" || (targetExisting && targetExisting.role === "admin")) {
            return json(res, 403, { error: "Менеджер персоналу не може призначати або змінювати Адміністраторів" });
          }
        }

        if (!/^\S+@\S+\.\S+$/.test(em) || !ALLOWED_ROLES.includes(b.role)) {
          return json(res, 400, { error: "Вкажіть коректний email та оберіть роль працівника" });
        }
        if (!targetExisting && String(b.password || "").length < 4) {
          return json(res, 400, { error: "Придумайте пароль для працівника (мінімум 4 символи)" });
        }
        const pwData = String(b.password || "").length >= 4
          ? hashPw(String(b.password))
          : { salt: targetExisting.salt, hash: targetExisting.hash };

        db.staff = (db.staff || []).filter(x => x.email !== em);
        db.staff.push({
          email: em,
          name: String(b.name || "").trim().slice(0, 40) || em.split("@")[0],
          tgUser,
          role: b.role,
          ...pwData
        });
        save();
        return json(res, 200, { ok: 1 });
      }
      if (m === "DELETE") {
        const em = decodeURIComponent(p.split("/").pop()).toLowerCase().trim();
        if (em === ADMIN_EMAIL) {
          return json(res, 403, { error: "Неможливо видалити обліковий запис Власника" });
        }
        const targetExisting = (db.staff || []).find(x => x.email === em);
        if (ss.role === "staff_manager" && targetExisting && targetExisting.role === "admin") {
          return json(res, 403, { error: "Менеджер персоналу не може видаляти Адміністраторів" });
        }
        db.staff = (db.staff || []).filter(x => x.email !== em);
        save();
        return json(res, 200, { ok: 1 });
      }
    }

    // Акції та знижки
    if (p.startsWith("/api/admin/promos")) {
      if (!["owner", "admin", "deputy_admin", "promo_manager"].includes(ss.role)) {
        return json(res, 403, { error: "Немає доступу до керування акціями та знижками" });
      }
      if (m === "GET") {
        return json(res, 200, { promos: db.promos || [] });
      }
      if (m === "POST") {
        const b = await body(req);
        const title = String(b.title || "").trim().slice(0, 100);
        const desc = String(b.desc || "").trim().slice(0, 400);
        const code = String(b.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
        const discountPercent = Math.min(90, Math.max(1, Math.round(+b.discountPercent || 10)));
        if (!title) {
          return json(res, 400, { error: "Вкажіть назву знижки або акції" });
        }
        if (code) {
          db.promos = (db.promos || []).filter(x => x.code !== code);
        }
        const promo = {
          id: Date.now(),
          title,
          desc,
          code,
          discountPercent,
          active: true,
          authorEmail: ss.email,
          authorName: ss.name,
          created: nowStr()
        };
        db.promos.unshift(promo);
        save();
        return json(res, 200, { ok: 1, promo });
      }
      const prMatch = p.match(/^\/api\/admin\/promos\/(\d+)$/);
      if (prMatch) {
        const prId = +prMatch[1];
        const idx = (db.promos || []).findIndex(x => x.id === prId);
        if (idx === -1) return json(res, 404, { error: "Акцію не знайдено" });
        if (m === "PUT") {
          const b = await body(req);
          if (b.active !== undefined) db.promos[idx].active = !!b.active;
          save();
          return json(res, 200, { ok: 1 });
        }
        if (m === "DELETE") {
          db.promos.splice(idx, 1);
          save();
          return json(res, 200, { ok: 1 });
        }
      }
    }

    // Реклама
    if (p.startsWith("/api/admin/ads")) {
      if (!["owner", "admin", "deputy_admin", "ads_manager"].includes(ss.role)) {
        return json(res, 403, { error: "Немає доступу до керування рекламою" });
      }
      if (m === "GET") return json(res, 200, { ads: db.ads || [] });
      if (m === "POST") {
        const b = await body(req);
        const title = String(b.title || "").trim().slice(0, 100);
        const desc = String(b.desc || "").trim().slice(0, 600);
        const img = typeof b.img === "string" && b.img.length < 1500000 && IMG.test(b.img) ? b.img : "";
        if (!title || !desc) return json(res, 400, { error: "Вкажіть заголовок та опис реклами" });

        const ad = {
          id: Date.now(),
          title,
          desc,
          img,
          authorEmail: ss.email,
          authorName: ss.name,
          created: nowStr()
        };
        db.ads.unshift(ad);
        save();
        return json(res, 200, { ok: 1, ad });
      }
      const adMatch = p.match(/^\/api\/admin\/ads\/(\d+)$/);
      if (adMatch) {
        const adId = +adMatch[1];
        const idx = (db.ads || []).findIndex(a => a.id === adId);
        if (idx === -1) return json(res, 404, { error: "Оголошення не знайдено" });
        const target = db.ads[idx];

        if (ss.role === "ads_manager" && target.authorEmail !== ss.email) {
          return json(res, 403, { error: "Ви можете керувати лише власними рекламними оголошеннями" });
        }
        if (m === "PUT") {
          const b = await body(req);
          target.title = String(b.title || target.title).trim().slice(0, 100);
          target.desc = String(b.desc || target.desc).trim().slice(0, 600);
          if (b.img !== undefined) {
            target.img = typeof b.img === "string" && b.img.length < 1500000 && IMG.test(b.img) ? b.img : "";
          }
          save();
          return json(res, 200, { ok: 1, ad: target });
        }
        if (m === "DELETE") {
          db.ads.splice(idx, 1);
          save();
          return json(res, 200, { ok: 1 });
        }
      }
    }

    // Небезпечна зона
    if (p === "/api/admin/danger/status") {
      if (ss.role !== "owner") return json(res, 403, { error: "Доступ заборонено" });
      const rec = dangerFails.get(ss.email) || { n: 0, lockUntil: 0 };
      const rem = Math.max(0, rec.lockUntil - Date.now());
      return json(res, 200, { locked: rem > 0, remainingMs: rem, attempts: rec.n });
    }

    if (m === "POST" && p === "/api/admin/danger/wipe") {
      if (ss.role !== "owner") {
        return json(res, 403, { error: "Видаляти дані може виключно Власник" });
      }
      const rec = dangerFails.get(ss.email) || { n: 0, lockUntil: 0 };
      if (rec.lockUntil > Date.now()) {
        const sec = Math.ceil((rec.lockUntil - Date.now()) / 1000);
        return json(res, 429, {
          error: `Доступ до небезпечних дій заблоковано. Зачекайте ${Math.floor(sec / 60)} хв ${sec % 60} с.`,
          locked: true,
          remainingMs: rec.lockUntil - Date.now()
        });
      }

      const b = await body(req);
      if (!b.password || !eq(b.password, ADMIN_PASSWORD)) {
        rec.n = (rec.lockUntil > 0 && rec.lockUntil <= Date.now()) ? 1 : (rec.n + 1);
        rec.lockUntil = 0;
        if (rec.n >= 3) {
          rec.lockUntil = Date.now() + 10 * 60 * 1000;
          dangerFails.set(ss.email, rec);
          return json(res, 429, {
            error: "Пароль введено неправильно 3 рази. Доступ до небезпечних дій заблоковано на 10 хвилин.",
            locked: true,
            remainingMs: 10 * 60 * 1000
          });
        }
        dangerFails.set(ss.email, rec);
        return json(res, 401, {
          error: `Невірний пароль власника! Залишилось спроб: ${3 - rec.n}`,
          attempts: rec.n
        });
      }

      dangerFails.delete(ss.email);
      const target = String(b.target || "all");
      if (target === "orders" || target === "all") {
        try {
          const or = await bot("orders");
          const allIds = (or.orders || []).map(o => o.id);
          db.hiddenOrders = Array.from(new Set([...(db.hiddenOrders || []), ...allIds]));
        } catch {}
        db.localOrders = [];
        db.keys = {};
      }
      if (target === "tickets" || target === "all") db.tickets = [];
      if (target === "ads" || target === "all") db.ads = [];
      if (target === "promos" || target === "all") db.promos = [];
      if (target === "staff" || target === "all") db.staff = [];
      if (target === "expenses" || target === "all") db.expenses = [];
      save();
      return json(res, 200, { ok: 1, wiped: target });
    }

    // Стан адмінпанелі
    if (m === "GET" && p === "/api/admin/state") {
      const [pr, or] = await Promise.all([bot("products"), bot("orders")]);
      const hidden = new Set(db.hiddenOrders || []);
      const orders = (or.orders || [])
        .filter(o => !hidden.has(o.id))
        .map(o => {
          const v = orderView(o);
          const lo = (db.localOrders || []).find(x => +x.id === +o.id);
          if (lo) {
            if (lo.phone) v.phone = lo.phone;
            if (lo.designLink) v.designLink = lo.designLink;
            if (lo.designFileName) v.designFileName = lo.designFileName;
            if (lo.designFileData) v.designFileData = lo.designFileData;
            if (lo.promo) v.promo = `${lo.promo} (-${lo.discountPercent}%)`;
          }
          return v;
        });

      const validOrders = orders.filter(o => o.skey !== "cancel");
      const totalRevenue = validOrders.reduce((s, o) => s + (+o.sum || 0), 0);
      const totalExpenses = (db.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
      const netProfit = totalRevenue - totalExpenses;

      return json(res, 200, {
        products: (pr.products || []).map(withMeta),
        orders,
        tickets: db.tickets || [],
        ads: db.ads || [],
        promos: db.promos || [],
        expenses: db.expenses || [],
        finance: {
          revenue: totalRevenue,
          expenses: totalExpenses,
          profit: netProfit
        },
        role: ss.role,
        name: ss.name,
        email: ss.email,
        settings: { ...pub(), botOn: true, botName: "@znachok_ua_bot" }
      });
    }

    // Збереження налаштувань та товарів
    if (m === "PUT" && p === "/api/admin/sync") {
      if (!["owner", "admin", "deputy_admin", "badge_master"].includes(ss.role)) {
        return json(res, 403, { error: "Немає прав на зміну товарів чи налаштувань" });
      }
      const b = await body(req);
      const s = b.settings || {};

      if (["owner", "admin", "deputy_admin"].includes(ss.role) && Object.keys(s).length > 0) {
        let newSchedule = db.settings.schedule || defaultSchedule();
        if (s.schedule && typeof s.schedule === "object") {
          newSchedule = {};
          for (let d = 0; d <= 6; d++) {
            const item = s.schedule[d] || s.schedule[String(d)] || { open: "09:00", close: "19:00", off: false };
            newSchedule[d] = {
              open: /^\d{2}:\d{2}$/.test(item.open) ? item.open : "09:00",
              close: /^\d{2}:\d{2}$/.test(item.close) ? item.close : "19:00",
              off: !!item.off
            };
          }
        }

        db.settings = {
          shopName: String(s.shopName || db.settings.shopName || "ЗначокUA").slice(0, 60),
          phone: String(s.phone || db.settings.phone || "+380 XX XXX XX XX").slice(0, 32),
          openYear: String(s.openYear || db.settings.openYear || "2026").slice(0, 10),
          open: s.open ? 1 : 0,
          autoSchedule: s.autoSchedule !== undefined ? (s.autoSchedule ? 1 : 0) : (db.settings.autoSchedule ? 1 : 0),
          schedule: newSchedule,
          desc: String(s.desc || "").slice(0, 300),
          contacts: String(s.contacts || "").slice(0, 200),
          pickupAddress: String(s.pickupAddress || "Самовивіз (забирати у продавця)").slice(0, 200)
        };
      }

      let out = [];
      if (Array.isArray(b.products)) {
        out = await syncProducts(b.products);
      } else {
        save();
        out = (await products()).map(withMeta);
      }
      return json(res, 200, { ok: 1, products: out, settings: pub() });
    }

    // Відповідь на звернення підтримки
    let k;
    if (m === "PUT" && (k = p.match(/^\/api\/admin\/tickets\/(\d+)$/))) {
      if (!["owner", "admin", "deputy_admin"].includes(ss.role)) {
        return json(res, 403, { error: "Немає прав відповідати на звернення" });
      }
      const b = await body(req);
      const tk = db.tickets.find(t => t.id === +k[1]);
      if (!tk || !String(b.reply || "").trim()) return json(res, 400, { error: "Невірні дані" });
      tk.reply = String(b.reply).slice(0, 1000);
      save();
      await bot("message", { username: tk.tg, text: tk.reply }).catch(() => {});
      return json(res, 200, { ok: 1 });
    }
  }

  json(res, 404, { error: "Маршрут не знайдено" });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const f = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, ""));
    if (!f.startsWith(path.join(__dirname, "public")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      return json(res, 404, { error: "Файл не знайдено" });
    }
    const ext = path.extname(f).toLowerCase();
    const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      json(res, e.message && e.message.startsWith("Бот") ? 502 : 400, { error: e.message || "Помилка запиту" });
    }
  }
}).listen(PORT, () => console.log("ЗначокUA v2.4 запущено: http://localhost:" + PORT));

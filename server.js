// ЗначокUA v2.1: сайт, підключений до Google Apps Script-бота. Без залежностей, Node 18+.
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
  console.error("Відкрийте файл settings.env у блокноті та впишіть пароль, BOT_API_URL і SITE_KEY");
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
  localOrders: [],
  hiddenOrders: [],
  settings: {
    open: 1,
    autoSchedule: 1,
    desc: "Яскраві значки з українським характером.",
    contacts: "",
    schedule: defaultSchedule()
  }
};

try {
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  Object.assign(db, loaded);
  if (!db.settings) db.settings = {};
  if (!db.settings.schedule) db.settings.schedule = defaultSchedule();
  if (db.settings.autoSchedule === undefined) db.settings.autoSchedule = 1;
  if (!Array.isArray(db.ads)) db.ads = [];
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
    const day = dt.getDay(); // 0 = Sun, 1 = Mon ...
    const sch = (db.settings.schedule && db.settings.schedule[day]) || { open: "09:00", close: "19:00", off: false };
    if (sch.off) return false;
    const curMin = dt.getHours() * 60 + dt.getMinutes();
    const [oh, om] = String(sch.open || "09:00").split(":").map(Number);
    const [ch, cm] = String(sch.close || "19:00").split(":").map(Number);
    const openMin = (oh || 0) * 60 + (om || 0);
    const closeMin = (ch || 0) * 60 + (cm || 0);
    return curMin >= openMin && curMin < closeMin;
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
    emoji: m.emoji || "⭐",
    color: m.color || "#4b3df2",
    img: m.img || "",
    desc: m.desc || ""
  };
};

const IMG = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;

const cleanProducts = a => (Array.isArray(a) ? a : []).slice(0, 200).map(p => ({
  id: +p.id || Date.now(),
  name: String(p.name || "").slice(0, 60),
  desc: String(p.desc || "").slice(0, 600),
  price: Math.max(1, Math.round(+p.price || 0)),
  emoji: String(p.emoji || "⭐").slice(0, 8),
  color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#4b3df2",
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
    db.meta[id] = { emoji: p.emoji, color: p.color, img: p.img, desc: p.desc };
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
  sent: "Відправлено",
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
const dangerFails = new Map(); // Блокування небезпечної зони після 3 невдалих спроб
const ALLOWED_ROLES = ["admin", "deputy_admin", "ads_manager"];

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
  open: isShopOpenNow() ? 1 : 0,
  manualOpen: db.settings.open ? 1 : 0,
  autoSchedule: db.settings.autoSchedule ? 1 : 0,
  schedule: db.settings.schedule || defaultSchedule(),
  desc: db.settings.desc,
  contacts: db.settings.contacts
});

async function api(req, res, url) {
  const m = req.method, p = url.pathname;

  // Публічні дані магазину
  if (m === "GET" && p === "/api/shop") {
    const prods = (await products()).filter(x => x.on).map(withMeta);
    return json(res, 200, {
      products: prods,
      ads: db.ads || [],
      settings: pub()
    });
  }

  // Оформлення замовлення
  if (m === "POST" && p === "/api/orders") {
    const b = await body(req);
    if (!isShopOpenNow()) return json(res, 400, { error: "Магазин зараз зачинений. Перегляньте графік роботи." });
    if (b.key && db.keys[b.key]) return json(res, 200, db.keys[b.key]);

    const name = String(b.name || "").trim();
    if (name.length < 2) return json(res, 400, { error: "Вкажіть ваше ім’я" });

    const tg = nickOf(b.tg);
    const phoneDigits = d10(b.phone);

    if (tg && !/^[a-z0-9_]{5,32}$/.test(tg)) {
      return json(res, 400, { error: "Некоректний нікнейм Telegram (мінімум 5 символів латиницею, цифри або _)" });
    }
    if (!tg && phoneDigits.length < 10) {
      return json(res, 400, { error: "Вкажіть нікнейм Telegram або коректний номер телефону (10 цифр)" });
    }

    const city = String(b.city || "").trim().slice(0, 60);
    const addr = String(b.address || "").trim().slice(0, 150);
    if (city.length < 2 || addr.length < 1) {
      return json(res, 400, { error: "Вкажіть місто та відділення або поштомат Нової пошти" });
    }

    const items = (b.items || []).slice(0, 30).filter(i => +i.q > 0);
    if (!items.length) return json(res, 400, { error: "Кошик порожній" });

    const phoneFormatted = phoneDigits ? "+38" + phoneDigits : "";
    const comment = `Доставка: Нова пошта, ${city}, ${addr}. Оплата: ${b.pay === "card" ? "переказ на картку" : "при отриманні"}.`
      + (phoneFormatted ? ` Тел: ${phoneFormatted}.` : "")
      + (String(b.note || "").trim() ? ` Коментар: ${String(b.note).trim().slice(0, 300)}` : "");

    const botUsername = tg || ("phone_" + phoneDigits);
    const ids = [];
    let notified = false;

    for (const it of items) {
      const qty = Math.min(999, Math.floor(+it.q));
      const r = await bot("order", {
        product_id: +it.id,
        qty,
        username: botUsername,
        name: name.slice(0, 60),
        comment,
        design: String(b.design || "").trim()
      });
      ids.push(r.id);
      notified = notified || r.notified;

      // Зберігаємо локальну копію деталей для пошуку за телефоном та надійності статусів
      db.localOrders.push({
        id: r.id,
        name: name.slice(0, 60),
        tg: tg ? "@" + tg : "",
        phone: phoneFormatted,
        city,
        address: addr,
        pay: b.pay === "card" ? "Переказ на картку" : "При отриманні",
        note: String(b.note || "").trim(),
        product: it.name || ("Товар #" + it.id),
        qty,
        sum: (+it.price || 0) * qty,
        skey: "new",
        stext: "Нове",
        date: nowStr()
      });
    }

    const out = { id: ids.join(", "), notified };
    if (b.key) db.keys[b.key] = out;
    save();
    return json(res, 200, out);
  }

  // Перевірка статусу замовлення (за Telegram або номером телефону)
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

    // Доповнюємо локальними даними якщо є
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

  // Підтримка (тікети)
  if (m === "POST" && p === "/api/tickets") {
    const b = await body(req);
    const tg = nickOf(b.tg);
    if (tg.length < 4 || !String(b.text || "").trim()) {
      return json(res, 400, { error: "Вкажіть контакт (Telegram або телефон) і повідомлення" });
    }
    const t = { id: db.tickets.length + 1, tg, text: String(b.text).slice(0, 1000), reply: "", date: nowStr() };
    db.tickets.push(t);
    save();
    await bot("support", { username: tg, text: t.text }).catch(() => {});
    return json(res, 200, { id: t.id });
  }

  // Вхід у панель керування
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
      who = { role: "owner", name: "Власник", email: em };
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

  // Захищені маршрути адмінпанелі
  if (p.startsWith("/api/admin/")) {
    const t = (req.headers.authorization || "").slice(7);
    const ss = sessions.get(t);
    if (!ss || ss.exp < Date.now()) return json(res, 401, { error: "Сесія завершена. Увійдіть знову" });

    // 1. Зміна статусу замовлення (Власник, Адміністратор, Заступник адміністратора)
    const bk = p.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (m === "PUT" && bk) {
      if (!["owner", "admin", "deputy_admin"].includes(ss.role)) {
        return json(res, 403, { error: "Немає прав на зміну статусів замовлень" });
      }
      const orderId = +bk[1];
      const b = await body(req);
      const ns = String(b.status || "").trim();
      if (!STATUS_MAP[ns]) return json(res, 400, { error: "Невідомий статус замовлення" });

      try {
        await bot("status", { id: orderId, status: ns, by: ss.name });
      } catch (err) {
        // Якщо в Apps Script ще не додано case 'status', оновлюємо локально та повідомляємо зрозуміло
        const lo = (db.localOrders || []).find(x => +x.id === orderId);
        if (lo) {
          lo.skey = ns;
          lo.stext = STATUS_MAP[ns];
          save();
        }
        if (err.message && err.message.includes("action")) {
          return json(res, 400, { error: "Оновіть код бота (bot_patch_status.gs) у Google Apps Script для синхронізації статусів" });
        }
        throw err;
      }

      const lo = (db.localOrders || []).find(x => +x.id === orderId);
      if (lo) {
        lo.skey = ns;
        lo.stext = STATUS_MAP[ns];
      }
      save();
      return json(res, 200, { ok: 1, status: ns, stext: STATUS_MAP[ns] });
    }

    // 2. Керування працівниками
    if (p.startsWith("/api/admin/staff")) {
      if (!["owner", "admin"].includes(ss.role)) {
        return json(res, 403, { error: "Доступ мають лише Власник та Адміністратор" });
      }
      if (m === "GET") {
        const list = [
          { email: ADMIN_EMAIL, role: "owner", name: "Власник (Головний)", protected: true },
          ...(db.staff || []).map(x => ({ email: x.email, role: x.role, name: x.name, protected: false }))
        ];
        return json(res, 200, { staff: list });
      }
      if (m === "POST") {
        const b = await body(req);
        const em = String(b.email || "").toLowerCase().trim();
        if (em === ADMIN_EMAIL) {
          return json(res, 403, { error: "Неможливо змінювати обліковий запис Власника" });
        }
        if (!/^\S+@\S+\.\S+$/.test(em) || !ALLOWED_ROLES.includes(b.role)) {
          return json(res, 400, { error: "Вкажіть коректний email та роль працівника" });
        }
        const existing = (db.staff || []).find(x => x.email === em);
        if (!existing && String(b.password || "").length < 6) {
          return json(res, 400, { error: "Пароль для нового працівника має бути від 6 символів" });
        }
        const pwData = String(b.password || "").length >= 6
          ? hashPw(String(b.password))
          : { salt: existing.salt, hash: existing.hash };

        db.staff = (db.staff || []).filter(x => x.email !== em);
        db.staff.push({
          email: em,
          name: String(b.name || "").trim().slice(0, 40) || em.split("@")[0],
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
        db.staff = (db.staff || []).filter(x => x.email !== em);
        save();
        return json(res, 200, { ok: 1 });
      }
    }

    // 3. Рекламні оголошення (Власник, Адміністратор, Заступник, Менеджер реклами)
    if (p.startsWith("/api/admin/ads")) {
      if (!["owner", "admin", "deputy_admin", "ads_manager"].includes(ss.role)) {
        return json(res, 403, { error: "Немає доступу до керування рекламою" });
      }
      if (m === "GET") {
        return json(res, 200, { ads: db.ads || [] });
      }
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

        // Менеджер реклами може редагувати/видаляти лише власні оголошення
        if (ss.role === "ads_manager" && target.authorEmail !== ss.email) {
          return json(res, 403, { error: "Ви можете керувати лише власними рекламними оголошеннями" });
        }

        if (m === "PUT") {
          const b = await body(req);
          const title = String(b.title || target.title).trim().slice(0, 100);
          const desc = String(b.desc || target.desc).trim().slice(0, 600);
          if (!title || !desc) return json(res, 400, { error: "Заголовок і опис не можуть бути порожніми" });
          target.title = title;
          target.desc = desc;
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

    // 4. Небезпечна зона — видалення даних (ВИКЛЮЧНО ВЛАСНИК)
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
          rec.lockUntil = Date.now() + 10 * 60 * 1000; // 10 хвилин
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

      // Пароль вірний — скидаємо лічильник помилок
      dangerFails.delete(ss.email);

      const target = String(b.target || "all");
      if (target === "orders" || target === "all") {
        // Приховуємо поточні замовлення з бота та очищаємо локальні
        try {
          const or = await bot("orders");
          const allIds = (or.orders || []).map(o => o.id);
          db.hiddenOrders = Array.from(new Set([...(db.hiddenOrders || []), ...allIds]));
        } catch {}
        db.localOrders = [];
        db.keys = {};
      }
      if (target === "tickets" || target === "all") {
        db.tickets = [];
      }
      if (target === "ads" || target === "all") {
        db.ads = [];
      }
      save();
      return json(res, 200, { ok: 1, wiped: target });
    }

    // 5. Отримання повного стану для адмінпанелі
    if (m === "GET" && p === "/api/admin/state") {
      const [pr, or] = await Promise.all([bot("products"), bot("orders")]);
      const hidden = new Set(db.hiddenOrders || []);
      const orders = (or.orders || [])
        .filter(o => !hidden.has(o.id))
        .map(o => {
          const v = orderView(o);
          const lo = (db.localOrders || []).find(x => +x.id === +o.id);
          if (lo && lo.phone) v.phone = lo.phone;
          return v;
        });

      return json(res, 200, {
        products: (pr.products || []).map(withMeta),
        orders,
        tickets: db.tickets || [],
        ads: db.ads || [],
        role: ss.role,
        name: ss.name,
        email: ss.email,
        settings: { ...pub(), botOn: true, botName: "Google Apps Script" }
      });
    }

    // 6. Збереження налаштувань магазину, графіку та товарів
    if (m === "PUT" && p === "/api/admin/sync") {
      if (!["owner", "admin", "deputy_admin"].includes(ss.role)) {
        return json(res, 403, { error: "Немає прав на зміну налаштувань магазину" });
      }
      const b = await body(req);
      const s = b.settings || {};

      // Оновлюємо графік роботи якщо передано
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
        open: s.open ? 1 : 0,
        autoSchedule: s.autoSchedule !== undefined ? (s.autoSchedule ? 1 : 0) : (db.settings.autoSchedule ? 1 : 0),
        schedule: newSchedule,
        desc: String(s.desc || "").slice(0, 300),
        contacts: String(s.contacts || "").slice(0, 200)
      };

      let out = [];
      if (Array.isArray(b.products)) {
        out = await syncProducts(b.products);
      } else {
        save();
        out = (await products()).map(withMeta);
      }
      return json(res, 200, { ok: 1, products: out, settings: pub() });
    }

    // 7. Відповідь на тікет підтримки
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
}).listen(PORT, () => console.log("ЗначокUA v2.1 запущено: http://localhost:" + PORT));

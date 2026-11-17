require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID || '';

// Безпека та заголовки
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ліміт запитів для захисту від спаму
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', apiLimiter);

// Сховище в пам'яті / файлі
const DATA_FILE = path.join(__dirname, 'data.json');
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      products: [
        { id: 1, title: 'Значок "Котик-ЗСУ"', price: 85, category: 'Патріотичні', badge: 'Хіт', desc: 'Металевий пін 32 мм із захисним покриттям.' },
        { id: 2, title: 'Набір стікерів "Київський вайб"', price: 120, category: 'Стікери', badge: 'Новинка', desc: 'Вінілові водостійкі наліпки, 8 шт.' },
        { id: 3, title: 'Значок "Незламні"', price: 90, category: 'Патріотичні', badge: '', desc: 'Яскравий принт, надійна застібка-шпилька.' },
        { id: 4, title: 'Пін "Кібер-Шевченко"', price: 95, category: 'Арт', badge: 'Топ', desc: 'Лімітована серія для рюкзака чи худі.' }
      ],
      orders: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Завантаження зображень із очищенням EXIF-метаданих
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }
});

// 2FA коди через Telegram
const pendingCodes = new Map();

async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    return res.ok;
  } catch (e) {
    console.error('Telegram API error:', e.message);
    return false;
  }
}

// API: Отримати каталог
app.get('/api/products', (req, res) => {
  const data = loadData();
  res.json(data.products);
});

// API: Створити замовлення
app.post('/api/orders', async (req, res) => {
  const { customer, items, total, boxNote } = req.body;
  if (!customer || !customer.name || !customer.phone || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Заповніть обов’язкові поля замовлення' });
  }
  const data = loadData();
  const order = {
    id: 'ORD-' + Date.now().toString().slice(-6),
    createdAt: new Date().toISOString(),
    status: 'Нове',
    customer,
    items,
    boxNote: boxNote || '',
    total: Number(total) || 0
  };
  data.orders.unshift(order);
  saveData(data);

  const msg = `🛍 <b>Нове замовлення ${order.id}</b>\n👤 ${customer.name} (${customer.phone})\n🚚 Отримання: ${customer.delivery}\n💰 Сума: ${order.total} грн`;
  await sendTelegramMessage(OWNER_CHAT_ID, msg);

  res.status(201).json({ ok: true, orderId: order.id });
});

// API: Запит 2FA коду для входу в адмінку
app.post('/api/admin/request-code', async (req, res) => {
  const code = String(crypto.randomInt(100000, 999999));
  const sessionId = crypto.randomUUID();
  pendingCodes.set(sessionId, { code, expires: Date.now() + 5 * 60 * 1000 });
  const sent = await sendTelegramMessage(OWNER_CHAT_ID, `🔐 Код входу в адмін-панель ЗначокUA: <b>${code}</b>`);
  res.json({ sessionId, sent, hint: sent ? 'Код надіслано в Telegram' : 'Режим локальної розробки (використайте 000000 якщо BOT_TOKEN не задано)' });
});

// API: Перевірка 2FA коду
app.post('/api/admin/verify-code', (req, res) => {
  const { sessionId, code } = req.body;
  if (!BOT_TOKEN && code === '000000') {
    return res.json({ ok: true, token: 'dev-admin-token' });
  }
  const entry = pendingCodes.get(sessionId);
  if (!entry || entry.expires < Date.now() || entry.code !== String(code)) {
    return res.status(401).json({ error: 'Невірний або прострочений код' });
  }
  pendingCodes.delete(sessionId);
  res.json({ ok: true, token: crypto.randomBytes(24).toString('hex') });
});

// API: Завантаження фото без EXIF
app.post('/api/admin/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не завантажено' });
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.webp`;
  const outPath = path.join(uploadDir, filename);
  await sharp(req.file.buffer).rotate().resize(900, 900, { fit: 'inside' }).webp({ quality: 84 }).toFile(outPath);
  res.json({ ok: true, url: `/uploads/${filename}` });
});

// API: Експорт замовлень у CSV
app.get('/api/admin/export-csv', (req, res) => {
  const data = loadData();
  const header = 'ID,Дата,Клієнт,Телефон,Спосіб отримання,Сума (грн),Статус\n';
  const rows = data.orders.map(o =>
    `"${o.id}","${o.createdAt}","${o.customer.name}","${o.customer.phone}","${o.customer.delivery}",${o.total},"${o.status}"`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="znachokua-orders.csv"');
  res.send('\uFEFF' + header + rows);
});

app.listen(PORT, () => {
  console.log(`ЗначокUA сервер запущено на порту ${PORT}`);
});

const express = require('express');
const path = require('path');
const app = express();

// Вставте сюди ваш URL розгорнутого Google Apps Script Web App (/exec)
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/ВАШ_ID_СКРИПТА/exec';

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api', async (req, res) => {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      redirect: 'follow'
    });
    const text = await response.text();
    try {
      res.json(JSON.parse(text));
    } catch {
      res.status(502).json({ ok: false, error: 'Некоректна відповідь від Google Apps Script', raw: text.slice(0, 300) });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Помилка з\'єднання з сервером: ' + err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер ЗначокUA запущено: http://localhost:${PORT}`);
});

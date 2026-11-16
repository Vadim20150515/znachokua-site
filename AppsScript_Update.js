// ═══════════════════════════════════════════════════════════════════════════
// ОНОВЛЕНИЙ СЕРВЕРНИЙ КОД ДЛЯ GOOGLE APPS SCRIPT (V2.1)
// ═══════════════════════════════════════════════════════════════════════════

// 1. У об'єкт CONFIG на початку файлу додайте рядок:
//    DANGER_PASSWORD: '12-34',

// 2. У функції setup() додайте виклик:
//    siteStaffSheet_();

const SHEET_SITE_STAFF = 'Доступ_Сайт';
const SITE_STAFF_HEADERS = ['Email', 'Пароль', 'Роль', "Ім'я", 'TG_ID_або_Nick', 'Створено'];

function siteStaffSheet_() {
  return ensureSheet_(SHEET_SITE_STAFF, SITE_STAFF_HEADERS);
}

function readSiteStaff_() {
  const sh = siteStaffSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, SITE_STAFF_HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2,
      email: String(r[0] || '').trim().toLowerCase(),
      pass: String(r[1] || '').trim(),
      role: String(r[2] || '').trim(),
      name: String(r[3] || '').trim(),
      tg: String(r[4] || '').trim(),
    }))
    .filter((x) => x.email && x.pass);
}

// Вхід: працівники сайту (Email + Пароль) або власник (1-хвилинний код на Email і в Telegram)
function apiLoginStartV2_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const pass = String(req.pass || '').trim();

  const staffMember = readSiteStaff_().filter((s) => s.email === email && s.pass === pass)[0];
  if (staffMember) {
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    CacheService.getScriptCache().put('adm:tok:' + token, JSON.stringify({ email: email, role: staffMember.role, name: staffMember.name }), 21600);
    log_(0, staffMember.role, 'Вхід працівника на сайт', email);
    return { ok: true, direct_login: true, token: token, user: { email: email, role: staffMember.role, name: staffMember.name } };
  }

  if (adminEmails_().indexOf(email) < 0) {
    return { ok: false, error: 'Невірний Email або пароль.' };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  // Код діє рівно 60 секунд (1 хвилину)!
  CacheService.getScriptCache().put('adm:code:' + email, JSON.stringify({ code: code, tries: 0 }), 60);

  try {
    MailApp.sendEmail(email, 'Код входу в адмін-панель ЗначокUA (діє 1 хв)', 'Ваш код: ' + code + '\nДійсний рівно 60 секунд.');
  } catch (e) {}
  CONFIG.OWNER_IDS.forEach((id) => {
    send_(id, '🔐 <b>Код входу на сайт</b>: <code>' + code + '</code>\n⏳ Дійсний <b>1 хвилину</b>.');
  });
  return { ok: true, direct_login: false };
}

// Збір даних для діаграм (виручка, витрати, чистий дохід за 7 днів)
function getChartStats_() {
  const orders = allOrders_();
  const expenses = readExpenses_();
  const days = [];
  const incomeData = [];
  const expenseData = [];

  for (let i = 6; i >= 0; i--) {
    const dStr = Utilities.formatDate(new Date(Date.now() - i * 86400000), CONFIG.TIMEZONE, 'dd.MM.yyyy');
    days.push(dStr.slice(0, 5));
    const dayInc = orders.filter((o) => o.status === 'done' && o.updated.slice(0, 10) === dStr).reduce((s, o) => s + o.price, 0);
    const dayExp = expenses.filter((e) => e.date.slice(0, 10) === dStr).reduce((s, e) => s + e.amount, 0);
    incomeData.push(dayInc);
    expenseData.push(dayExp);
  }

  const totalInc = orders.filter((o) => o.status === 'done').reduce((s, o) => s + o.price, 0);
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    labels: days,
    income: incomeData,
    expenses: expenseData,
    total_revenue: totalInc,
    total_expenses: totalExp,
    net_profit: totalInc - totalExp
  };
}

// Додавання ролі працівника з сайту (Майстер значків / Менеджер замовлень)
function adminStaffAdd_(req) {
  const email = String(req.email || '').trim().toLowerCase();
  const name = cleanText_(req.name, 50);
  const tg = cleanText_(req.tg, 50);
  const pass = String(req.pass || '').trim();
  const role = String(req.role || '').trim();
  if (!email || !name || !pass || ['master', 'order_manager'].indexOf(role) < 0) {
    return { ok: false, error: 'Некоректні дані працівника' };
  }
  const sh = siteStaffSheet_();
  sh.appendRow([email, pass, role, name, tg, now_()]);
  log_(0, 'owner', 'Додано працівника сайту', email + ' (' + role + ')');
  return { ok: true };
}

// Виконання дій небезпечної зони (потребує пароль DANGER_PASSWORD)
function adminDangerExec_(req) {
  const expectedPass = String(CONFIG.DANGER_PASSWORD || '12-34');
  if (String(req.pass || '').trim() !== expectedPass) {
    return { ok: false, error: 'Невірний пароль небезпечної зони!' };
  }
  const act = String(req.action || '');
  const row = Number(req.row || 0);

  if (act === 'clear_orders') {
    const sh = ordersSheet_();
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    log_(0, 'owner', 'НЕБЕЗПЕЧНА ЗОНА: Очищено всі замовлення', '');
    return { ok: true };
  }
  if (act === 'reset_stats') {
    const stamp = now_();
    setProp_('STATS_RESET_KEY', String(key_(stamp)));
    setProp_('STATS_RESET_LABEL', stamp);
    log_(0, 'owner', 'НЕБЕЗПЕЧНА ЗОНА: Скинуто статистику', stamp);
    return { ok: true };
  }
  if (act === 'wipe_staff') {
    const sh = siteStaffSheet_();
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    log_(0, 'owner', 'НЕБЕЗПЕЧНА ЗОНА: Видалено весь персонал сайту', '');
    return { ok: true };
  }
  if (act === 'clear_promos') {
    const sh = promosSheet_();
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    log_(0, 'owner', 'НЕБЕЗПЕЧНА ЗОНА: Видалено всі знижки та акції', '');
    return { ok: true };
  }
  if (act === 'delete_product_row' && row >= 2) {
    productsSheet_().deleteRow(row);
    return { ok: true };
  }
  if (act === 'delete_promo_row' && row >= 2) {
    promosSheet_().deleteRow(row);
    return { ok: true };
  }
  if (act === 'delete_staff_row' && row >= 2) {
    siteStaffSheet_().deleteRow(row);
    return { ok: true };
  }
  return { ok: false, error: 'Невідома дія' };
}

// У handleAdminApi_(act, req, email):
// 1) ЗАБОРОНЯЄМО зміну статусів через сайт:
//    case 'admin_order_set': return { ok: false, error: 'Зміна статусів через сайт вимкнена. Використовуйте Telegram-бот.' };
// 2) У adminOverview_() додайте поле: charts: getChartStats_()
// 3) Додайте кейси:
//    case 'admin_staff_list': return { ok: true, staff: readSiteStaff_() };
//    case 'admin_staff_add': return adminStaffAdd_(req);
//    case 'admin_danger_exec': return adminDangerExec_(req);

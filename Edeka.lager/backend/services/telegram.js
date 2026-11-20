/**
 * ارسال گزارش به تلگرام — همان مکانیزم قبلی (ربات/کانال با Bot Token + Chat ID از .env)
 * بدون واتس‌اپ. این فایل عمداً ساده مانده تا فقط همین یک کار را به‌خوبی انجام دهد.
 */

// نام دسته/محصول/واحد از فرم "افزودن جدید" می‌آیند و هیچ محدودیت کاراکتری
// ندارند. اگر یکی از این‌ها کاراکتر ویژه‌ی Markdown تلگرام (_ * ` [) داشته
// باشد و escape نشود، تلگرام کل پیام را با خطای «entity ناقص» رد می‌کند —
// یعنی همه‌ی گزارش به‌خاطر یک نام محصول ارسال نمی‌شود، نه فقط همان خط.
const { roundStock } = require('../lib/validate');

const TELEGRAM_TIMEOUT_MS = 10000;

function escapeMarkdown(text) {
  return String(text ?? '').replace(/([_*`[])/g, '\\$1');
}

async function sendTelegram(text, chatId = null, options = {}) {
  const botToken  = process.env.TELEGRAM_BOT_TOKEN;
  const defaultId = process.env.TELEGRAM_CHAT_ID;
  const target    = chatId || defaultId;

  if (!botToken || !target) {
    throw new Error('Telegram nicht konfiguriert (.env fehlt: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : TELEGRAM_TIMEOUT_MS;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    target,
        text,
        parse_mode: 'Markdown'
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`Telegram-Zeitüberschreitung nach ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || `Telegram-Fehler (${res.status})`);
  }
  return data;
}

/**
 * متن گزارش تلگرام را از لیست محصولات زنده (Product[]) می‌سازد.
 * مصرف نسبت به yesterdayStock (پایه‌ی نیمه‌شب) حساب می‌شود — تجمعی از نیمه‌شب تا الان،
 * نه نسبت به گزارش قبلیِ همان روز.
 */
function buildTelegramText(products, options = {}) {
  const liveOnly = options && options.liveOnly === true;
  const now = new Date();
  const dateLabel = now.toLocaleDateString('de-DE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const timeLabel = now.toLocaleTimeString('de-DE');

  const totalStock    = roundStock(products.reduce((s, p) => s + (p.currentStock ?? 0), 0));
  const totalConsumed = roundStock(products.reduce(
    (s, p) => s + roundStock(Math.max(0, (p.yesterdayStock ?? 0) - (p.currentStock ?? 0))), 0
  ));

  const lines = [
    `🛒 *EDEKA Lagerbericht*`,
    `📅 ${dateLabel}`,
    `🕐 ${timeLabel} Uhr`,
    ``,
    `📦 Gesamtbestand: *${totalStock}*`
  ];
  if (!liveOnly) {
    lines.push(`📉 Verbrauch seit Mitternacht: *${totalConsumed}*`);
  }
  lines.push(``);

  const categories = [...new Set(products.map(p => p.category))];
  categories.forEach(cat => {
    lines.push(`*${escapeMarkdown(cat)}*`);
    products
      .filter(p => p.category === cat)
      .forEach(p => {
        const stock    = roundStock(p.currentStock ?? 0);
        const consumed = roundStock(Math.max(0, (p.yesterdayStock ?? 0) - (p.currentStock ?? 0)));
        const bioTag = p.isBio ? '🌱 ' : '';
        let line = `  ${escapeMarkdown(p.emoji || '📦')} ${bioTag}${escapeMarkdown(p.name)} (${escapeMarkdown(p.unit)}): *${stock}*`;
        if (!liveOnly && consumed > 0) line += ` (−${consumed})`;
        if (liveOnly && p.updatedByName) {
          line += ` _(${escapeMarkdown(p.updatedByName)})_`;
        }
        lines.push(line);
      });
    lines.push(``);
  });

  lines.push(`⏰ _Gesendet um ${timeLabel} Uhr_`);
  return lines.join('\n');
}

// Eingerichtet heißt: Bot-Token UND Standard-Chat sind gesetzt. Ohne beides ist
// Telegram absichtlich aus — das ist kein Fehler.
function telegramEingerichtet() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

module.exports = { sendTelegram, buildTelegramText, escapeMarkdown, telegramEingerichtet };

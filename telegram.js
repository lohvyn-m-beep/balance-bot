
const WEBHOOK_URL = "https://balance-bot-three.vercel.app/api/telegram";

const ACCOUNTS = [
  { id: "2768", name: "Грошовий рахунок", limit: 10000 },
  { id: "2769", name: "Грошовий рахунок", limit: 30000 },
  { id: "5346", name: "МЕНЕДЖЕРИ_Грошовий рахунок", limit: 5000 }
];

// Получение балансов с Oracle API
async function getAllBalances() {
  const apiUrl = process.env.ORACLE_API_URL;
  const apiSecret = process.env.ORACLE_API_SECRET;

  if (!apiUrl || !apiSecret) {
    throw new Error(
      "Не налаштовані ORACLE_API_URL або ORACLE_API_SECRET у Vercel"
    );
  }

  const response = await fetch(
    `${apiUrl.replace(/\/+$/, "")}/balances`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(60000)
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Oracle API HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Oracle API повернув некоректний JSON");
  }

  for (const account of ACCOUNTS) {
    if (
      !data?.[account.id] ||
      typeof data[account.id].balance !== "number" ||
      !Number.isFinite(data[account.id].balance)
    ) {
      throw new Error(
        `Немає коректного балансу рахунку ${account.id}`
      );
    }
  }

  return Object.fromEntries(
    ACCOUNTS.map(account => [
      account.id,
      data[account.id].balance
    ])
  );
}

// Форматирование денег
function formatMoney(value) {
  return Number(value).toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Формирование сообщения
function buildMessage(balances) {
  let message = "💰 <b>NG-CLUB — поточні дані</b>\n\n";

  for (const account of ACCOUNTS) {
    const balance = balances[account.id];

    message += `🏦 <b>${account.id} — ${account.name}</b>\n`;
    message += `💵 Баланс: <b>${formatMoney(balance)} грн</b>\n`;
    message += `📌 Ліміт: ${formatMoney(account.limit)} грн\n`;

    message += balance <= account.limit
      ? "🚨 <b>НИЖЧЕ ЛІМІТУ</b>\n"
      : "✅ Баланс вище ліміту\n";

    message += "\n";
  }

  return message;
}

// Telegram API
async function telegram(method, data) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN не налаштований");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram API error: ${result.description || response.status}`
    );
  }

  return result;
}

// Отправка балансов
async function sendBalance(chatId) {
  try {
    if (!chatId) {
      throw new Error("Не задано TELEGRAM_CHAT_ID");
    }

    console.log("Getting balances from Oracle API...");

    const balances = await getAllBalances();

    console.log(
      "Oracle balances received for accounts:",
      Object.keys(balances)
    );

    await telegram("sendMessage", {
      chat_id: chatId,
      text: buildMessage(balances),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🔄 Отримати поточні дані для всіх",
              callback_data: "get_all"
            }
          ]
        ]
      }
    });

    return balances;

  } catch (error) {
    console.error("BALANCE ERROR:", error);

    await telegram("sendMessage", {
      chat_id: chatId,
      text:
        "❌ <b>Не вдалося отримати дані NG-CLUB.</b>\n\n" +
        "Помилка: " +
        String(error.message).slice(0, 500),
      parse_mode: "HTML"
    });

    throw error;
  }
}

// Основной обработчик Vercel
export default async function handler(req, res) {
  try {

    // CRON: /api/telegram?cron=1
    if (
      req.method === "GET" &&
      req.query?.cron === "1"
    ) {
      console.log("CRON REQUEST");

      await sendBalance(process.env.TELEGRAM_CHAT_ID);

      return res.status(200).json({
        ok: true,
        message: "Баланс відправлено в Telegram"
      });
    }

    // Telegram webhook
    if (req.method === "POST") {
      const update = req.body;

      // Команда /start
      if (update?.message?.text === "/start") {
        await telegram("sendMessage", {
          chat_id: update.message.chat.id,
          text:
            "👋 <b>NG Club Balance</b>\n\n" +
            "Натисни кнопку нижче, щоб отримати актуальні дані з NG-CLUB.",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🔄 Отримати поточні дані для всіх",
                  callback_data: "get_all"
                }
              ]
            ]
          }
        });

        return res.status(200).json({ ok: true });
      }

      // Нажатие кнопки
      if (update?.callback_query) {
        const callback = update.callback_query;

        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Отримую актуальні дані..."
        });

        if (callback.data === "get_all") {
          await sendBalance(callback.message.chat.id);
        }

        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: true });
    }

    // Проверка и установка webhook
    if (req.method === "GET") {
      const setResult = await telegram("setWebhook", {
        url: WEBHOOK_URL
      });

      const infoResult = await telegram("getWebhookInfo", {});

      return res.status(200).json({
        ok: true,
        setWebhook: setResult,
        webhookInfo: infoResult
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("HANDLER ERROR:", error);

    return res.status(200).json({
      ok: false,
      error: error.message
    });
  }
}

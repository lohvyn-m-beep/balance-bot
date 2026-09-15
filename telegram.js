import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const NG_URL = "https://upc.ng-club.com/en/auth/login";
const WEBHOOK_URL =
  "https://balance-bot-three.vercel.app/api/telegram";

const LIMIT = 10000;

async function getBalances() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: {
      width: 1280,
      height: 900
    },
    executablePath: await chromium.executablePath(),
    headless: true
  });

  try {
    const page = await browser.newPage();

    // Відкриваємо NG-CLUB
    await page.goto(NG_URL, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    // Знаходимо поля логіну
    const inputs = await page.$$("input");

    let loginInput = null;
    let passwordInput = null;

    for (const input of inputs) {
      const type = await input.evaluate(el => el.type);

      if (type === "password") {
        passwordInput = input;
      } else if (
        !loginInput &&
        (type === "text" || type === "email")
      ) {
        loginInput = input;
      }
    }

    if (!loginInput || !passwordInput) {
      throw new Error("Не знайдено поля Login / Password");
    }

    loginInput.type(process.env.NG_CLUB_LOGIN);
    await passwordInput.type(process.env.NG_CLUB_PASSWORD);

    // Кнопка входу
    const submit =
      await page.$('button[type="submit"]') ||
      await page.$('input[type="submit"]');

    if (!submit) {
      throw new Error("Не знайдено кнопку входу");
    }

    await Promise.all([
      page
        .waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 30000
        })
        .catch(() => {}),
      submit.click()
    ]);

    // Даємо сторінці завантажити дані
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Всі числові значення
    const gridValues = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll(".grid_3")
      )
        .map(el => el.textContent.trim())
        .filter(Boolean)
        .map(text => {
          const match = text
            .replace(/\s/g, "")
            .match(/-?\d+(?:[.,]\d{1,2})?/);

          if (!match) return null;

          return {
            text,
            value: parseFloat(
              match[0].replace(",", ".")
            )
          };
        })
        .filter(Boolean);
    });

    // Шукаємо рахунок 2768
    const account2768 = await page.evaluate(() => {
      const all = Array.from(
        document.querySelectorAll("*")
      );

      const idElement = all.find(el => {
        const text = el.textContent?.trim();
        return text === "2768";
      });

      if (!idElement) return null;

      let parent = idElement;

      for (let i = 0; i < 6 && parent; i++) {
        const text = parent.innerText || "";

        if (
          text.includes("2768") &&
          (
            text.includes("Грошовий рахунок") ||
            text.includes("Cash") ||
            text.includes("Account")
          )
        ) {
          return text;
        }

        parent = parent.parentElement;
      }

      return (
        idElement.parentElement?.innerText ||
        null
      );
    });

    let balance2768 = null;

    if (account2768) {
      const numbers = account2768.match(
        /\d+(?:[.,]\d{1,2})?/g
      );

      if (numbers) {
        const parsed = numbers
          .map(n =>
            parseFloat(n.replace(",", "."))
          )
          .filter(n => !isNaN(n));

        // Виключаємо ID рахунку 2768
        const candidates = parsed.filter(
          n => n !== 2768
        );

        if (candidates.length) {
          balance2768 =
            candidates[candidates.length - 1];
        }
      }
    }

    return {
      balance2768,
      accountText: account2768,
      all: gridValues
    };

  } finally {
    await browser.close();
  }
}

function formatMoney(value) {
  return Number(value).toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function telegram(method, data) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN не налаштований"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    }
  );

  return response.json();
}

async function sendBalance(chatId) {
  try {
    const result = await getBalances();

    let message =
      "💰 <b>NG-CLUB — поточні дані</b>\n\n";

    if (result.balance2768 !== null) {
      const balance = result.balance2768;

      message +=
        `🏦 <b>2768 — Грошовий рахунок</b>\n` +
        `💵 Баланс: <b>${formatMoney(
          balance
        )} грн</b>\n`;

      if (balance <= LIMIT) {
        message +=
          `\n🚨 <b>УВАГА!</b>\n` +
          `Баланс нижче порогу ${formatMoney(
            LIMIT
          )} грн.`;
      } else {
        message +=
          `\n✅ Баланс вище порогу ${formatMoney(
            LIMIT
          )} грн.`;
      }
    } else {
      message +=
        "⚠️ Не вдалося однозначно визначити " +
        "баланс рахунку 2768.\n\n";

      message +=
        "Знайдені значення:\n";

      result.all.forEach((item, index) => {
        message +=
          `${index + 1}. ${item.text}\n`;
      });
    }

    const keyboard = {
      inline_keyboard: [
        [
          {
            text:
              "🔄 Отримати поточні дані для всіх",
            callback_data: "get_all"
          }
        ]
      ]
    };

    return await telegram("sendMessage", {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      reply_markup: keyboard
    });

  } catch (error) {
    console.error(
      "BALANCE ERROR:",
      error
    );

    return await telegram("sendMessage", {
      chat_id: chatId,
      text:
        "❌ <b>Не вдалося отримати дані " +
        "NG-CLUB.</b>\n\n" +
        "Помилка: " +
        String(error.message).slice(0, 500),
      parse_mode: "HTML"
    });
  }
}

export default async function handler(req, res) {
  try {

    // ========================================
    // GET — встановлення та перевірка webhook
    // ========================================

    if (req.method !== "POST") {

      const setResult = await telegram(
        "setWebhook",
        {
          url: WEBHOOK_URL
        }
      );

      const infoResult = await telegram(
        "getWebhookInfo",
        {}
      );

      return res.status(200).json({
        ok: true,
        setWebhook: setResult,
        webhookInfo: infoResult
      });
    }

    // ========================================
    // TELEGRAM UPDATE
    // ========================================

    const update = req.body;

    // ========================================
    // /start
    // ========================================

    if (
      update?.message?.text === "/start"
    ) {
      const chatId =
        update.message.chat.id;

      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          "👋 <b>NG Club Balance</b>\n\n" +
          "Натисни кнопку нижче, щоб " +
          "отримати актуальні дані " +
          "з NG-CLUB.",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "🔄 Отримати поточні дані " +
                  "для всіх",
                callback_data: "get_all"
              }
            ]
          ]
        }
      });

      return res.status(200).json({
        ok: true
      });
    }

    // ========================================
    // НАТИСКАННЯ КНОПКИ
    // ========================================

    if (update?.callback_query) {
      const callback =
        update.callback_query;

      await telegram(
        "answerCallbackQuery",
        {
          callback_query_id: callback.id,
          text:
            "Отримую актуальні дані..."
        }
      );

      if (
        callback.data === "get_all"
      ) {
        await sendBalance(
          callback.message.chat.id
        );
      }

      return res.status(200).json({
        ok: true
      });
    }

    // ========================================
    // Інші повідомлення
    // ========================================

    return res.status(200).json({
      ok: true
    });

  } catch (error) {

    console.error(
      "TELEGRAM HANDLER ERROR:",
      error
    );

    return res.status(200).json({
      ok: false,
      error: error.message
    });
  }
}

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

    console.log("Opening NG-CLUB...");

    await page.goto(NG_URL, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    // Знаходимо поля логіну
    const inputs = await page.$$("input");

    let loginInput = null;
    let passwordInput = null;

    for (const input of inputs) {
      const type = await input.evaluate(
        el => el.type
      );

      if (type === "password") {
        passwordInput = input;
      }

      if (
        !loginInput &&
        (type === "text" || type === "email")
      ) {
        loginInput = input;
      }
    }

    if (!loginInput || !passwordInput) {
      throw new Error(
        "Не знайдено поля Login / Password"
      );
    }

    // Вводимо логін
    await loginInput.type(
      process.env.NG_CLUB_LOGIN
    );

    // Вводимо пароль
    await passwordInput.type(
      process.env.NG_CLUB_PASSWORD
    );

    console.log("Login/password entered");

    // Кнопка входу
    const submit =
      await page.$(
        'button[type="submit"]'
      ) ||
      await page.$(
        'input[type="submit"]'
      );

    if (!submit) {
      throw new Error(
        "Не знайдено кнопку входу"
      );
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

    // Чекаємо завантаження особистого кабінету
    await new Promise(resolve =>
      setTimeout(resolve, 4000)
    );

    console.log(
      "Current URL:",
      page.url()
    );

    // Отримуємо весь видимий текст сторінки
    const pageText = await page.evaluate(() => {
      return document.body.innerText || "";
    });

    console.log(
      "PAGE TEXT:",
      pageText.slice(0, 12000)
    );

    // ----------------------------------------
    // ШУКАЄМО РАХУНОК 2768
    // ----------------------------------------

    const accountIndex =
      pageText.indexOf("2768");

    let accountText = null;
    let balance2768 = null;

    if (accountIndex !== -1) {
      const start = Math.max(
        0,
        accountIndex - 500
      );

      const end = Math.min(
        pageText.length,
        accountIndex + 1000
      );

      accountText =
        pageText.slice(start, end);

      console.log(
        "ACCOUNT 2768:",
        accountText
      );

      // Розбиваємо на рядки
      const lines = accountText
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

      const index = lines.findIndex(
        line =>
          line === "2768" ||
          line.includes("2768")
      );

      if (index !== -1) {

        // Беремо декілька рядків навколо рахунку
        const nearby = lines.slice(
          Math.max(0, index - 3),
          Math.min(
            lines.length,
            index + 10
          )
        );

        console.log(
          "NEARBY ACCOUNT LINES:",
          nearby
        );

        // Шукаємо числа з копійками
        const moneyValues = [];

        for (const line of nearby) {

          const matches =
            line.match(
              /-?\d[\d\s]*[.,]\d{1,2}/g
            );

          if (matches) {

            for (const value of matches) {

              const number =
                parseFloat(
                  value
                    .replace(/\s/g, "")
                    .replace(",", ".")
                );

              if (
                !isNaN(number) &&
                number !== 2768
              ) {
                moneyValues.push(number);
              }
            }
          }
        }

        if (moneyValues.length) {
          balance2768 =
            moneyValues[
              moneyValues.length - 1
            ];
        }
      }
    }

    // ----------------------------------------
    // ДОДАТКОВИЙ ПОШУК
    // ----------------------------------------

    if (balance2768 === null) {

      const cashIndex =
        pageText.indexOf(
          "Грошовий рахунок"
        );

      if (cashIndex !== -1) {

        const start = Math.max(
          0,
          cashIndex - 300
        );

        const end = Math.min(
          pageText.length,
          cashIndex + 800
        );

        const cashText =
          pageText.slice(start, end);

        console.log(
          "CASH ACCOUNT TEXT:",
          cashText
        );

        const matches =
          cashText.match(
            /-?\d[\d\s]*[.,]\d{1,2}/g
          );

        if (matches) {

          const values = matches
            .map(value =>
              parseFloat(
                value
                  .replace(/\s/g, "")
                  .replace(",", ".")
              )
            )
            .filter(
              value =>
                !isNaN(value) &&
                value !== 2768
            );

          if (values.length) {
            balance2768 =
              values[values.length - 1];
          }
        }
      }
    }

    // ----------------------------------------
    // ВСІ ЧИСЛА НА СТОРІНЦІ
    // ----------------------------------------

    const allNumbers =
      pageText.match(
        /-?\d[\d\s]*[.,]\d{1,2}/g
      ) || [];

    const all =
      allNumbers.map(value => ({
        text: value,
        value: parseFloat(
          value
            .replace(/\s/g, "")
            .replace(",", ".")
        )
      }));

    return {
      balance2768,
      accountText,
      all,
      pageUrl: page.url()
    };

  } finally {
    await browser.close();
  }
}

function formatMoney(value) {
  return Number(value).toLocaleString(
    "uk-UA",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
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

    const result =
      await getBalances();

    let message =
      "💰 <b>NG-CLUB — поточні дані</b>\n\n";

    if (
      result.balance2768 !== null
    ) {

      const balance =
        result.balance2768;

      message +=
        "🏦 <b>2768 — Грошовий рахунок</b>\n" +
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
        "⚠️ Не вдалося однозначно " +
        "визначити баланс рахунку 2768.\n\n";

      message +=
        "🔎 Знайдені числа:\n";

      result.all
        .slice(0, 30)
        .forEach((item, index) => {

          message +=
            `${index + 1}. ${item.text}\n`;
        });

      message +=
        "\n🌐 URL: " +
        result.pageUrl;
    }

    const keyboard = {
      inline_keyboard: [
        [
          {
            text:
              "🔄 Отримати поточні дані для всіх",
            callback_data:
              "get_all"
          }
        ]
      ]
    };

    return await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        reply_markup: keyboard
      }
    );

  } catch (error) {

    console.error(
      "BALANCE ERROR:",
      error
    );

    return await telegram(
      "sendMessage",
      {
        chat_id: chatId,
        text:
          "❌ <b>Не вдалося отримати " +
          "дані NG-CLUB.</b>\n\n" +
          "Помилка: " +
          String(error.message)
            .slice(0, 500),
        parse_mode: "HTML"
      }
    );
  }
}

export default async function handler(
  req,
  res
) {

  try {

    // ========================================
    // GET — webhook
    // ========================================

    if (req.method !== "POST") {

      const setResult =
        await telegram(
          "setWebhook",
          {
            url: WEBHOOK_URL
          }
        );

      const infoResult =
        await telegram(
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

      await telegram(
        "sendMessage",
        {
          chat_id: chatId,
          text:
            "👋 <b>NG Club Balance</b>\n\n" +
            "Натисни кнопку нижче, " +
            "щоб отримати актуальні " +
            "дані з NG-CLUB.",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "🔄 Отримати поточні " +
                    "дані для всіх",
                  callback_data:
                    "get_all"
                }
              ]
            ]
          }
        }
      );

      return res.status(200).json({
        ok: true
      });
    }

    // ========================================
    // КНОПКА
    // ========================================

    if (
      update?.callback_query
    ) {

      const callback =
        update.callback_query;

      await telegram(
        "answerCallbackQuery",
        {
          callback_query_id:
            callback.id,
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

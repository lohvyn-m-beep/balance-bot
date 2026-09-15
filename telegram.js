import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const NG_URL = "https://upc.ng-club.com/en/auth/login";
const WEBHOOK_URL =
  "https://balance-bot-three.vercel.app/api/telegram";

const ACCOUNTS = [
  {
    id: "2768",
    name: "Грошовий рахунок",
    limit: 10000,
    login: process.env.NG_CLUB_LOGIN,
    password: process.env.NG_CLUB_PASSWORD
  },
  {
    id: "2769",
    name: "Грошовий рахунок",
    limit: 30000,
    login: process.env.NG_CLUB_LOGIN_2,
    password: process.env.NG_CLUB_PASSWORD_2
  },
  {
    id: "5346",
    name: "МЕНЕДЖЕРИ_Грошовий рахунок",
    limit: 5000,
    login: process.env.NG_CLUB_LOGIN_2,
    password: process.env.NG_CLUB_PASSWORD_2
  }
];

async function loginToNgClub(login, password) {
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

    await page.goto(NG_URL, {
      waitUntil: "networkidle2",
      timeout: 30000
    });

    const inputs = await page.$$("input");

    let loginInput = null;
    let passwordInput = null;

    for (const input of inputs) {
      const type = await input.evaluate(el => el.type);

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
      throw new Error("Не знайдено поля Login / Password");
    }

    await loginInput.type(login);
    await passwordInput.type(password);

    const submit =
      await page.$('button[type="submit"]') ||
      await page.$('input[type="submit"]');

    if (!submit) {
      throw new Error("Не знайдено кнопку входу");
    }

    await Promise.all([
      page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 30000
      }).catch(() => {}),
      submit.click()
    ]);

    await new Promise(resolve => setTimeout(resolve, 4000));

    return { browser, page };

  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function readAccounts(page, accounts) {
  const pageText = await page.evaluate(() => {
    return document.body.innerText || "";
  });

  console.log("PAGE TEXT:", pageText.slice(0, 12000));

  const lines = pageText
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const results = {};

  for (const account of accounts) {
    let balance = null;

    const index = lines.findIndex(
      line => line === account.id || line.includes(account.id)
    );

    if (index !== -1) {
      const nearby = lines.slice(
        Math.max(0, index - 2),
        Math.min(lines.length, index + 12)
      );

      console.log(
        `ACCOUNT ${account.id}:`,
        nearby
      );

      const moneyValues = [];

      for (const line of nearby) {
        const matches =
          line.match(/-?\d[\d\s]*[.,]\d{1,2}/g);

        if (matches) {
          for (const value of matches) {
            const number = parseFloat(
              value.replace(/\s/g, "").replace(",", ".")
            );

            if (
              !isNaN(number) &&
              number !== Number(account.id)
            ) {
              moneyValues.push(number);
            }
          }
        }
      }

      if (moneyValues.length) {
        balance = moneyValues[moneyValues.length - 1];
      }
    }

    if (balance === null) {
      const nameIndex = pageText.indexOf(account.name);

      if (nameIndex !== -1) {
        const text = pageText.slice(
          Math.max(0, nameIndex - 200),
          Math.min(pageText.length, nameIndex + 800)
        );

        const matches =
          text.match(/-?\d[\d\s]*[.,]\d{1,2}/g);

        if (matches) {
          const values = matches
            .map(value =>
              parseFloat(
                value.replace(/\s/g, "").replace(",", ".")
              )
            )
            .filter(
              value =>
                !isNaN(value) &&
                value !== Number(account.id)
            );

          if (values.length) {
            balance = values[values.length - 1];
          }
        }
      }
    }

    results[account.id] = balance;
  }

  return results;
}

async function getBalancesForCabinet(login, password, accounts) {
  const { browser, page } =
    await loginToNgClub(login, password);

  try {
    return await readAccounts(page, accounts);
  } finally {
    await browser.close();
  }
}

async function getAllBalances() {
  const cabinet1 = ACCOUNTS.filter(
    account => account.id === "2768"
  );

  const cabinet2 = ACCOUNTS.filter(
    account =>
      account.id === "2769" ||
      account.id === "5346"
  );

  const result1 = await getBalancesForCabinet(
    process.env.NG_CLUB_LOGIN,
    process.env.NG_CLUB_PASSWORD,
    cabinet1
  );

  const result2 = await getBalancesForCabinet(
    process.env.NG_CLUB_LOGIN_2,
    process.env.NG_CLUB_PASSWORD_2,
    cabinet2
  );

  return {
    ...result1,
    ...result2
  };
}

function formatMoney(value) {
  return Number(value).toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function buildMessage(balances) {
  let message =
    "💰 <b>NG-CLUB — поточні дані</b>\n\n";

  for (const account of ACCOUNTS) {
    const balance = balances[account.id];

    message +=
      `🏦 <b>${account.id} — ${account.name}</b>\n`;

    if (balance === null || balance === undefined) {
      message += "⚠️ Баланс не визначено\n\n";
      continue;
    }

    message +=
      `💵 Баланс: <b>${formatMoney(balance)} грн</b>\n`;

    message +=
      `📌 Ліміт: ${formatMoney(account.limit)} грн\n`;

    if (balance <= account.limit) {
      message +=
        `🚨 <b>УВАГА! Нижче ліміту</b>\n`;
    } else {
      message += "✅ Баланс вище ліміту\n";
    }

    message += "\n";
  }

  return message;
}

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
      body: JSON.stringify(data)
    }
  );

  return response.json();
}

async function sendBalance(chatId) {
  try {
    const balances = await getAllBalances();

    const message = buildMessage(balances);

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: "🔄 Отримати поточні дані для всіх",
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
    console.error("BALANCE ERROR:", error);

    return await telegram("sendMessage", {
      chat_id: chatId,
      text:
        "❌ <b>Не вдалося отримати дані NG-CLUB.</b>\n\n" +
        "Помилка: " +
        String(error.message).slice(0, 500),
      parse_mode: "HTML"
    });
  }
}

function isCronRequest(req) {
  const auth = req.headers.authorization || "";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

  return auth === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  try {

    // Автоматична відправка за розкладом Vercel Cron
    if (req.method === "GET" && isCronRequest(req)) {
      const kyivHour = Number(
        new Intl.DateTimeFormat("uk-UA", {
          timeZone: "Europe/Kyiv",
          hour: "2-digit",
          hour12: false
        }).format(new Date())
      );

      if (kyivHour === 10 || kyivHour === 17) {
        await sendBalance(
          process.env.TELEGRAM_CHAT_ID
        );

        return res.status(200).json({
          ok: true,
          message: `Автоматична відправка о ${kyivHour}:00`
        });
      }

      return res.status(200).json({
        ok: true,
        message: "Не час автоматичної відправки"
      });
    }

    // Перевірка / встановлення Telegram webhook
    if (req.method !== "POST") {
      const setResult = await telegram("setWebhook", {
        url: WEBHOOK_URL
      });

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

    const update = req.body;

    // /start
    if (update?.message?.text === "/start") {
      const chatId = update.message.chat.id;

      await telegram("sendMessage", {
        chat_id: chatId,
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

      return res.status(200).json({
        ok: true
      });
    }

    // Кнопка
    if (update?.callback_query) {
      const callback = update.callback_query;

      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Отримую актуальні дані..."
      });

      if (callback.data === "get_all") {
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

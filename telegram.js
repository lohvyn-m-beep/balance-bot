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


// ==========================================
// ВХІД В NG-CLUB
// ==========================================

async function readAccounts(page, accounts) {
  const pageText = await page.evaluate(() => {
    return document.body.innerText || "";
  });

  console.log("PAGE TEXT:", pageText.slice(0, 15000));

  const lines = pageText
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const results = {};

  for (const account of accounts) {
    let balance = null;

    const index = lines.findIndex(
      line => line === account.id
    );

    if (index !== -1) {

      const nearby = lines.slice(
        index,
        Math.min(lines.length, index + 8)
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
              value
                .replace(/\s/g, "")
                .replace(",", ".")
            );

            if (!isNaN(number)) {
              moneyValues.push(number);
            }
          }
        }
      }

      console.log(
        `MONEY VALUES ${account.id}:`,
        moneyValues
      );

      /*
        Структура рахунку:

        ID
        Назва
        Кредит
        Баланс

        Тому після ID:
        перше число = кредит
        друге число = баланс
      */

      if (moneyValues.length >= 2) {
        balance = moneyValues[1];
      }
    }

    results[account.id] = balance;

    console.log(
      `BALANCE ${account.id}:`,
      balance
    );
  }

  return results;
}

  if (!login || !password) {
    throw new Error("Не задано логін або пароль NG-CLUB");
  }

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

    await loginInput.type(login);

    await passwordInput.type(password);

    console.log("Login/password entered");

    const submit =
      await page.$('button[type="submit"]') ||
      await page.$('input[type="submit"]');

    if (!submit) {
      throw new Error(
        "Не знайдено кнопку входу"
      );
    }

    await Promise.all([
      page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 30000
      }).catch(() => {}),

      submit.click()
    ]);

    await new Promise(resolve =>
      setTimeout(resolve, 4000)
    );

    console.log(
      "Logged in. Current URL:",
      page.url()
    );

    return {
      browser,
      page
    };

  } catch (error) {

    await browser.close();

    throw error;
  }
}


// ==========================================
// ЧИТАННЯ РАХУНКІВ
// ==========================================

async function readAccounts(page, accounts) {

  const rows = await page.$$eval(
    "tr",
    rows => {

      return rows.map(row => {

        const cells = Array.from(
          row.querySelectorAll("th, td")
        ).map(cell =>
          cell.innerText.trim()
        );

        return cells;
      });
    }
  );

  console.log(
    "TABLE ROWS:",
    JSON.stringify(rows)
  );

  const results = {};

  for (const account of accounts) {

    let balance = null;

    for (const row of rows) {

      if (!row.length) {
        continue;
      }

      const idCell =
        row[0].trim();

      if (idCell === account.id) {

        console.log(
          `FOUND ACCOUNT ${account.id}:`,
          row
        );

        /*
          Структура таблиці:

          ID
          НАЗВАНИЕ
          КРЕДИТ
          БАЛАНС

          Тому остання комірка
          є балансом.
        */

        const balanceText =
          row[row.length - 1];

        const parsed =
          parseFloat(
            balanceText
              .replace(/\s/g, "")
              .replace(",", ".")
          );

        if (!isNaN(parsed)) {

          balance = parsed;

        }

        break;
      }
    }

    results[account.id] =
      balance;

    console.log(
      `BALANCE ${account.id}:`,
      balance
    );
  }

  return results;
}


// ==========================================
// ОТРИМАННЯ РАХУНКІВ ОДНОГО КАБІНЕТУ
// ==========================================

async function getBalancesForCabinet(
  login,
  password,
  accounts
) {

  const {
    browser,
    page
  } = await loginToNgClub(
    login,
    password
  );

  try {

    const balances =
      await readAccounts(
        page,
        accounts
      );

    return balances;

  } finally {

    await browser.close();
  }
}


// ==========================================
// ОТРИМАННЯ ВСІХ 3 РАХУНКІВ
// ==========================================

async function getAllBalances() {

  /*
    Кабінет №1:

    NG_CLUB_LOGIN
    NG_CLUB_PASSWORD

    Рахунок:
    2768
  */

  const cabinet1 =
    ACCOUNTS.filter(
      account =>
        account.id === "2768"
    );


  /*
    Кабінет №2:

    NG_CLUB_LOGIN_2
    NG_CLUB_PASSWORD_2

    Рахунки:
    2769
    5346
  */

  const cabinet2 =
    ACCOUNTS.filter(
      account =>
        account.id === "2769" ||
        account.id === "5346"
    );


  const result1 =
    await getBalancesForCabinet(
      process.env.NG_CLUB_LOGIN,
      process.env.NG_CLUB_PASSWORD,
      cabinet1
    );


  const result2 =
    await getBalancesForCabinet(
      process.env.NG_CLUB_LOGIN_2,
      process.env.NG_CLUB_PASSWORD_2,
      cabinet2
    );


  return {
    ...result1,
    ...result2
  };
}


// ==========================================
// ФОРМАТУВАННЯ ГРОШЕЙ
// ==========================================

function formatMoney(value) {

  return Number(value).toLocaleString(
    "uk-UA",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );
}


// ==========================================
// ФОРМУВАННЯ ПОВІДОМЛЕННЯ
// ==========================================

function buildMessage(balances) {

  let message =
    "💰 <b>NG-CLUB — поточні дані</b>\n\n";


  for (const account of ACCOUNTS) {

    const balance =
      balances[account.id];


    message +=
      `🏦 <b>${account.id} — ${account.name}</b>\n`;


    if (
      balance === null ||
      balance === undefined
    ) {

      message +=
        "⚠️ Баланс не визначено\n\n";

      continue;
    }


    message +=
      `💵 Баланс: <b>${formatMoney(balance)} грн</b>\n`;


    message +=
      `📌 Ліміт: ${formatMoney(account.limit)} грн\n`;


    if (balance <= account.limit) {

      message +=
        "🚨 <b>УВАГА! Нижче ліміту</b>\n";

    } else {

      message +=
        "✅ Баланс вище ліміту\n";
    }


    message += "\n";
  }


  return message;
}


// ==========================================
// TELEGRAM API
// ==========================================

async function telegram(
  method,
  data
) {

  const token =
    process.env.TELEGRAM_BOT_TOKEN;


  if (!token) {

    throw new Error(
      "TELEGRAM_BOT_TOKEN не налаштований"
    );
  }


  const response =
    await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(data)
      }
    );


  return response.json();
}


// ==========================================
// ВІДПРАВКА БАЛАНСІВ
// ==========================================

async function sendBalance(chatId) {

  try {

    console.log(
      "Getting all balances..."
    );


    const balances =
      await getAllBalances();


    console.log(
      "ALL BALANCES:",
      balances
    );


    const message =
      buildMessage(balances);


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

        chat_id:
          chatId,

        text:
          message,

        parse_mode:
          "HTML",

        reply_markup:
          keyboard

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

        chat_id:
          chatId,

        text:
          "❌ <b>Не вдалося отримати дані NG-CLUB.</b>\n\n" +
          "Помилка: " +
          String(
            error.message
          ).slice(0, 500),

        parse_mode:
          "HTML"

      }
    );
  }
}


// ==========================================
// CRON
// ==========================================

function isCronRequest(req) {

  const auth =
    req.headers.authorization || "";

  const secret =
    process.env.CRON_SECRET;


  if (!secret) {

    return false;
  }


  return (
    auth ===
    `Bearer ${secret}`
  );
}


// ==========================================
// TELEGRAM WEBHOOK
// ==========================================

export default async function handler(
  req,
  res
) {

  try {

    /*
      Vercel Cron
    */

    if (
      req.method === "GET" &&
      isCronRequest(req)
    ) {

      await sendBalance(
        process.env.TELEGRAM_CHAT_ID
      );


      return res.status(200).json({

        ok: true,

        message:
          "Автоматична відправка виконана"

      });
    }


    /*
      Перевірка webhook
    */

    if (
      req.method !== "POST"
    ) {

      const setResult =
        await telegram(
          "setWebhook",
          {
            url:
              WEBHOOK_URL
          }
        );


      const infoResult =
        await telegram(
          "getWebhookInfo",
          {}
        );


      return res.status(200).json({

        ok: true,

        setWebhook:
          setResult,

        webhookInfo:
          infoResult

      });
    }


    /*
      Telegram update
    */

    const update =
      req.body;


    /*
      /start
    */

    if (
      update?.message?.text ===
      "/start"
    ) {

      const chatId =
        update.message.chat.id;


      await telegram(
        "sendMessage",
        {

          chat_id:
            chatId,

          text:
            "👋 <b>NG Club Balance</b>\n\n" +
            "Натисни кнопку нижче, щоб отримати актуальні дані з NG-CLUB.",

          parse_mode:
            "HTML",

          reply_markup: {

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

          }

        }
      );


      return res.status(200).json({
        ok: true
      });
    }


    /*
      Натискання кнопки
    */

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
        callback.data ===
        "get_all"
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

      error:
        error.message

    });
  }
}

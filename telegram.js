import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const NG_URL = "https://upc.ng-club.com/en/auth/login";

async function getBalances() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // Відкриваємо сторінку входу
    await page.goto(NG_URL, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Логін
    const loginInput = await page.$(
      'input[type="text"], input[type="email"], input:not([type])'
    );

    const passwordInput = await page.$('input[type="password"]');

    if (!loginInput || !passwordInput) {
      throw new Error("Не знайдено поля логіну або пароля");
    }

    await loginInput.type(process.env.NG_CLUB_LOGIN);
    await passwordInput.type(process.env.NG_CLUB_PASSWORD);

    // Натискаємо кнопку входу
    const submitButton = await page.$(
      'button[type="submit"], input[type="submit"], button'
    );

    if (submitButton) {
      await submitButton.click();
    } else {
      await passwordInput.press("Enter");
    }

    // Чекаємо після входу
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Збираємо текст сторінки
    const data = await page.evaluate(() => {
      const elements = [...document.querySelectorAll(".grid_3")];

      return elements
        .map((el) => ({
          text: el.innerText.trim(),
          value: el.innerText.trim().replace(/\s+/g, " "),
        }))
        .filter((x) => x.text);
    });

    return data;
  } finally {
    await browser.close();
  }
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  return response.json();
}

export default async function handler(req, res) {
  // Перевірка, що функція працює
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "NG Club Balance Bot is working",
    });
  }

  try {
    const update = req.body;

    if (!update) {
      return res.status(200).json({ ok: true });
    }

    // Звичайне повідомлення
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      if (text === "/start") {
        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "🤖 NG Club Balance Bot\n\n" +
            "Натисни кнопку, щоб отримати актуальні дані з NG-CLUB.",
          reply_markup: {
            keyboard: [
              [
                {
                  text: "ОТРИМАТИ ПОТОЧНІ ДАНІ ДЛЯ ВСІХ",
                },
              ],
            ],
            resize_keyboard: true,
          },
        });

        return res.status(200).json({ ok: true });
      }

      if (text === "ОТРИМАТИ ПОТОЧНІ ДАНІ ДЛЯ ВСІХ") {
        await telegram("sendMessage", {
          chat_id: chatId,
          text: "⏳ Отримую актуальні дані з NG-CLUB...",
        });

        const balances = await getBalances();

        let result = "📊 Актуальні дані NG-CLUB\n\n";

        if (!balances.length) {
          result += "⚠️ Дані не знайдені.";
        } else {
          result += balances
            .map((item) => `• ${item.value}`)
            .join("\n");
        }

        await telegram("sendMessage", {
          chat_id: chatId,
          text: result,
        });

        return res.status(200).json({ ok: true });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);

    if (update?.message?.chat?.id) {
      await telegram("sendMessage", {
        chat_id: update.message.chat.id,
        text:
          "❌ Помилка під час отримання даних.\n\n" +
          "Подивись логи Vercel для деталей.",
      });
    }

    return res.status(200).json({
      ok: false,
      error: error.message,
    });
  }
}

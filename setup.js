export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: "https://balance-bot-three.vercel.app/api/telegram"
      })
    }
  );

  const result = await response.json();

  return res.status(200).json(result);
}

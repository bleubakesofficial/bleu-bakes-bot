const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ORDERS_SHEET_ID = process.env.ORDERS_SHEET_ID;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

async function getMenuData() {
  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "A:E"
  });

  const rows = response.data.values || [];

  return rows
    .slice(1)
    .map(row => ({
      category: row[0] || "",
      subcategory: row[1] || "",
      item: row[2] || "",
      size: row[3] || "",
      price: row[4] || ""
    }));
}

function isGreeting(text) {
  const greetings = ["hi", "hello", "hey", "start"];
  return greetings.includes(text.toLowerCase().trim());
}

async function generateReply(phone, userMessage) {
  const menuData = await getMenuData();

  const menuText = menuData
    .map(
      item =>
        `${item.category} | ${item.subcategory} | ${item.item} | ${item.size} | ₹${item.price}`
    )
    .join("\n");

  const prompt = `
You are Bleu Bakes' senior bakery sales executive on WhatsApp.

MENU:
${menuText}

NEW CUSTOMER MESSAGE:
${userMessage}

RULES:

- Use previous conversation context.
- Never forget previously collected details.
- Never ask again for information already provided.
- Ask maximum 2 questions at a time.
- Sound human and conversational.
- Use attractive WhatsApp formatting.
- Never invent menu items.
- Never invent prices.
- Minimum order value ₹250.

CUSTOM CAKE FLOW:

Collect only missing details:

• Theme
• Reference image (optional)
• Date
• Time
• Weight
• Flavour
• Delivery/Pickup
• Address if delivery

If customer says:
"No image"
"No reference"
"You choose"

Then continue order without asking for image again.

Before asking next question,
briefly summarize collected details.

Keep replies short and professional.
`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
  });

  const result =
    await model.generateContent(prompt);

  const reply =
    result.response.text();

return reply;
}

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    let userText = "";

    if (message.text) {
      userText = message.text.body;
    }

    let reply = "";

    if (isGreeting(userText)) {
      reply = `👋 Welcome to Bleu Bakes!

Please choose an option:

🛒 Place a New Order
📦 Existing Order / Zomato Query
⭐ Share Feedback / Review
🎪 Event / Stall / Collaboration
👨‍🍳 Talk to Team`;
    } else {
      reply = await generateReply(
        from,
        userText
      );
    }

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: {
          body: reply.substring(0, 4096)
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.sendStatus(200);
  } catch (error) {
    console.error(
      error.response?.data || error.message
    );

    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log("Bleu Bakes Bot Running");
});

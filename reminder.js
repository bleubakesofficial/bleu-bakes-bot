const { google } = require("googleapis");
const axios = require("axios");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const REMINDER_SHEET_ID = process.env.REMINDER_SHEET_ID;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

async function run() {

  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client
  });

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: REMINDER_SHEET_ID,
      range: "A:E"
    });

  const rows = response.data.values || [];

  for (let i = 1; i < rows.length; i++) {

    const phone = rows[i][0];
    const state = rows[i][1];
    const timestamp = rows[i][2];
    const reminderType = rows[i][3];
    const reminderSent = rows[i][4];

    if (reminderSent === "yes") continue;

    const createdAt = new Date(timestamp);
    const now = new Date();

    const minutes =
      (now - createdAt) / (1000 * 60);

    let message = "";

    if (
      reminderType === "menu_browse" &&
      minutes >= 30
    ) {

      message =
`🎂 Looking for the perfect cake?

Our team can help you choose based on occasion, flavour and budget.

Just reply to continue your order.`;

    }

    if (
      reminderType === "custom_cake" &&
      minutes >= 60
    ) {

      message =
`🎂 We'd love to create your custom cake.

If you already have a theme or reference image, send it here and we'll help you with the rest.`;

    }

    if (!message) continue;

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: {
          body: message
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    await sheets.spreadsheets.values.update({
      spreadsheetId: REMINDER_SHEET_ID,
      range: `E${i + 1}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["yes"]]
      }
    });

    console.log(`Reminder sent to ${phone}`);

  }

}

run();

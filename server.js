const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ORDER_STATE_SHEET_ID = process.env.ORDER_STATE_SHEET_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ORDERS_SHEET_ID = process.env.ORDERS_SHEET_ID;
const FEEDBACK_SHEET_ID = process.env.FEEDBACK_SHEET_ID;

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

async function saveOrder(order) {
  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: ORDERS_SHEET_ID,
    range: "A:K",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        new Date().toISOString(),
        order.phone || "",
        order.name || "",
        order.items || "",
        order.weight || "",
        order.flavour || "",
        order.date || "",
        order.time || "",
        order.deliveryType || "",
        order.address || "",
        "NEW"
      ]]
    }
  });
}
async function getOrderState(phone) {
  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client
  });

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: ORDER_STATE_SHEET_ID,
      range: "A:C"
    });

  const rows =
    response.data.values || [];

  const row =
    rows.find(r => r[0] === phone);

  return row ? row[1] : "";
}
async function saveFeedback(
  phone,
  rating,
  source = "",
  feedback = ""
) {
  const client =
    await auth.getClient();

  const sheets =
    google.sheets({
      version: "v4",
      auth: client
    });

  await sheets.spreadsheets.values.append({
    spreadsheetId:
      FEEDBACK_SHEET_ID,
    range: "A:F",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        phone,
        rating,
        source,
        feedback,
        new Date().toISOString(),
        "completed"
      ]]
    }
  });
}
async function saveOrderState(
  phone,
  state
) {
  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client
  });

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: ORDER_STATE_SHEET_ID,
      range: "A:C"
    });

  const rows =
    response.data.values || [];

  const rowIndex =
    rows.findIndex(
      r => r[0] === phone
    );

  if (rowIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId:
        ORDER_STATE_SHEET_ID,
      range: "A:C",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          phone,
          state,
          new Date().toISOString()
        ]]
      }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId:
        ORDER_STATE_SHEET_ID,
      range: `A${rowIndex + 1}:C${rowIndex + 1}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          phone,
          state,
          new Date().toISOString()
        ]]
      }
    });
  }
}

async function generateReply(phone, userMessage) {
  const orderState =
  await getOrderState(phone);
  const menuData = await getMenuData();

  const menuText = menuData
    .map(
      item =>
        `${item.category} | ${item.subcategory} | ${item.item} | ${item.size} | ₹${item.price}`
    )
    .join("\n");
  
const currentDateTime =
  new Date().toLocaleString(
    "en-IN",
    {
      timeZone: "Asia/Kolkata"
    }
  );
  
  const prompt = `
You are Bleu Bakes' senior bakery sales executive on WhatsApp.

CURRENT DATE & TIME:
${currentDateTime}
CURRENT ORDER STATE:
${orderState}

MENU:
${menuText}

NEW CUSTOMER MESSAGE:
${userMessage}

Always maintain and update the current order state.

Return:

{
  "create_order": false,
  "orderState": "",
  "reply": ""
}
{
  "create_order": true,
  "orderState": "",
  ...
}

RULES:

* Reply in the same language used by the customer.

* If customer speaks Hindi, reply in Hindi.

* If customer speaks Hinglish, reply in Hinglish.

* If customer speaks English, reply in English.

* Ask maximum 2 questions at a time.

* Sound human and conversational.

* Use attractive WhatsApp formatting.

* Never invent menu items.

* Never invent prices.

* Minimum order value ₹250.

* If customer asks for the full menu, do NOT display every item at once.

Instead show categories:

🎂 Cakes
🍰 Pastries
🧁 Cupcakes
🫙 Jar Cakes
🍫 Brownies
🍮 Desserts
🍕 Pizza
🍝 Pasta & Garlic Bread
🍟 Snacks
🥤 Beverages

Then ask:

"Which category would you like to explore?"

CUSTOM CAKE FLOW:

Collect only missing details:

• Theme
• Reference Image (optional)
• Weight
• Flavour
• Date
• Time
• Delivery or Pickup

If Delivery:

Collect ALL of the following before confirmation:

• House/Flat Number
• Area/Sector
• Landmark
• Pincode

Do NOT ask for order confirmation until all required address details are collected.

Allowed delivery pincodes:

110040
110039
110036
110082
131028
131029

If pincode is outside the service area, reply:

"Currently we deliver only in North Delhi, Kundli, Rai Industrial Area and Rajiv Gandhi Education City."

If customer provides only a location name such as Kundli, Narela, Rohini, Sonipat, Delhi etc., do NOT treat it as a complete address.

Still collect:

• House/Flat Number
• Area/Sector
• Landmark
• Pincode

If customer says:

"No image"
"No reference"
"You choose"

Then continue without asking for an image again.

Before asking the next question:

* Briefly summarize collected details.
* Ask only for missing details.

Once all details are collected:

Show a complete order summary.

Then ask:

"Would you like to confirm this order?"

Do NOT create an order immediately after collecting details.

Only if customer explicitly says:

* Confirm
* Confirm Order
* Yes Confirm
* Place Order
* Book It

AND all required order details have already been collected,

then return:

{
  "create_order": true
}

If customer wants to talk to a person, immediately reply:

"Our team will be happy to assist you.

📞 Call/WhatsApp: +91XXXXXXXXXX

You can call us directly for immediate assistance during working hours."

If customer is confirming an order,
return JSON in this format:

{
 "create_order": true,
 "name": "",
 "items": "",
 "weight": "",
 "flavour": "",
 "date": "",
 "time": "",
 "deliveryType": "",
 "address": "",
 "reply": ""
}
IMPORTANT:

Return ONLY valid JSON.

Do NOT return markdown.
Do NOT return code blocks.
Do NOT return explanations.
Do NOT return text before JSON.
Do NOT return text after JSON.

Your entire response must be exactly one valid JSON object.

Otherwise return:

{
  "create_order": false,
  "orderState": "",
  "reply": ""
}
`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
  });

  let result;

try {
  result =
    await model.generateContent(prompt);
} catch (error) {
  return {
  create_order: false,
  orderState: "",
  reply:
`We're experiencing a temporary delay.

📞 For an immediate response, please call or WhatsApp us directly on +91XXXXXXXXXX.

Our team will be happy to assist you personally.`
};
}

  const text =
  result.response.text()
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

try {
  return JSON.parse(text);
} catch {
  return {
    create_order: false,
    orderState: "",
    reply: text
  };
}
}

app.post("/webhook", async (req, res) => {
  
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    console.log("Webhook hit");
    console.log("From:", from);

    let userText = "";

    if (message.text) {
  userText = message.text.body;
}

if (message.interactive?.button_reply) {
  userText =
    message.interactive.button_reply.id;
}

if (message.interactive?.list_reply) {
  userText =
    message.interactive.list_reply.id;
}
    let reply = "";

    if (isGreeting(userText)) {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: "👋 Welcome to Bleu Bakes!\n\nHow may we assist you today?"
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "orders_queries",
                title: "🛒 Orders"
              }
            },
            {
              type: "reply",
              reply: {
                id: "events",
                title: "🎪 Events"
              }
            },
            {
              type: "reply",
              reply: {
                id: "support",
                title: "💬 Support"
              }
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
 return res.sendStatus(200);
    } else {
     if (userText === "orders_queries") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🛒 Orders & Queries"
        },
        action: {
          button: "View Options",
          sections: [
            {
              title: "Orders",
              rows: [
                {
                  id: "new_order",
                  title: "Place a New Order"
                },
                {
                  id: "existing_order",
                  title: "Order / Zomato Query"
                }
              ]
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
       return res.sendStatus(200);
     }
 if (userText === "new_order") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🎂 What would you like to order?"
        },
        action: {
          button: "View Categories",
          sections: [
            {
              title: "Menu Categories",
              rows: [
                { id: "cakes", title: "🎂 Cakes" },
                { id: "pastries", title: "🍰 Pastries" },
                { id: "cupcakes", title: "🧁 Cupcakes" },
                { id: "jar_cakes", title: "🫙 Jar Cakes" },
                { id: "brownies", title: "🍫 Brownies" },
                { id: "desserts", title: "🍮 Desserts" },
                { id: "pizza", title: "🍕 Pizza" },
                { id: "pasta", title: "🍝 Pasta & Garlic Bread" },
                { id: "snacks", title: "🍟 Snacks" },
                { id: "beverages", title: "🥤 Beverages" }
              ]
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
return res.sendStatus(200);
 }
      if (userText === "existing_order") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "📦 Existing Order / Zomato Query"
        },
        action: {
          button: "View Options",
          sections: [
            {
              title: "Order Support",
              rows: [
                {
                  id: "order_update",
                  title: "Order Updates"
                },
                {
                  id: "modify_order",
                  title: "Modify Existing Order"
                },
                {
                  id: "zomato_issue",
                  title: "Zomato Order Issue"
                },
                {
                  id: "refund",
                  title: "Refund / Cancellation"
                },
                {
                  id: "talk_team",
                  title: "Talk to Team"
                }
              ]
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
return res.sendStatus(200);
      }
      if (userText === "order_update") {
reply =
`📦 Please share:

• Customer Name
• Mobile Number
• Order Date

Our team will provide an update on your order shortly.`;
}
      if (userText === "modify_order") {
reply =
`✏️ Please share:

• Order Number (if available)
• Changes required

Our team will review the request and assist you.`;
}
      if (userText === "zomato_issue") {
reply =
`🍽️ Please share your Zomato order details and issue.

Our team will try to assist, although order resolutions are subject to Zomato policies.`;
}
      if (userText === "refund") {
reply =
`📋 Please share:

• Order Number
• Reason for cancellation/refund request

Our team will review and contact you shortly.`;
}
     if (userText === "events") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🎪 Events & Collaborations"
        },
        action: {
          button: "View Options",
          sections: [
            {
              title: "Events",
              rows: [
                {
                  id: "society_stall",
                  title: "Society Stall"
                },
                {
                  id: "college_event",
                  title: "College Event"
                },
                {
                  id: "corporate_bulk",
                  title: "Corporate Bulk Order"
                },
                {
                  id: "collaboration",
                  title: "Collaboration"
                }
              ]
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
return res.sendStatus(200);
     }
      if (userText === "google_review") {
reply =
`⭐⭐⭐⭐⭐

Thank you for choosing Bleu Bakes.

We'd love your review:

YOUR_GOOGLE_REVIEW_LINK`;
return;
}
      if (userText === "instagram") {
reply =
`📸 Follow Bleu Bakes

YOUR_INSTAGRAM_LINK`;
return;
}
if (userText === "send_feedback") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text:
`⭐⭐⭐⭐⭐

Thank you for choosing Bleu Bakes!

How was your experience?`
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "loved_it",
                title: "😍 Loved It"
              }
            },
            {
              type: "reply",
              reply: {
                id: "good",
                title: "🙂 Good"
              }
            },
            {
              type: "reply",
              reply: {
                id: "could_be_better",
                title: "😕 Could Be Better"
              }
            }
          ]
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.sendStatus(200);
}

      if (userText === "loved_it") {

  await saveFeedback(
    from,
    "Loved It"
  );

  reply =
`😍 Thank you!

We're so happy you loved it.

⭐ Please leave us a Google Review:
YOUR_GOOGLE_REVIEW_LINK

📸 Follow us on Instagram:
YOUR_INSTAGRAM_LINK`;

}
      if (userText === "good") {

  await saveFeedback(
    from,
    "Good"
  );

  reply =
`🙂 Thank you!

What could we do to make your experience even better?`;

}

if (userText === "could_be_better") {

  await saveFeedback(
    from,
    "Could Be Better"
  );

  reply =
`😕 We're sorry we missed the mark.

Please tell us what went wrong so we can improve.`;

}
      
      if (userText === "talk_team") {
reply =
`👨‍🍳 Our team will be happy to assist you.

📞 Call / WhatsApp:
+91XXXXXXXXXX`;
return;
}
      if (userText === "feedback") {
reply =
`⭐ We'd love your feedback.

Please tell us about your experience with Bleu Bakes.`;
return;
}
      const aiResponse =
  await generateReply(
    from,
    userText
  );
     
if (aiResponse.orderState) {
  await saveOrderState(
    from,
    aiResponse.orderState
  );
}
if (aiResponse.create_order) {

  await saveOrder({
    phone: from,
    name: aiResponse.name,
    items: aiResponse.items,
    weight: aiResponse.weight,
    flavour: aiResponse.flavour,
    date: aiResponse.date,
    time: aiResponse.time,
    deliveryType:
      aiResponse.deliveryType,
    address:
      aiResponse.address
  });
await saveOrderState(
  from,
  ""
);
  reply =
    aiResponse.reply ||
    "🎉 Your order request has been received successfully. Our team will contact you shortly.";

} else {

  reply =
    aiResponse.reply ||
    "Thank you for contacting Bleu Bakes.";
}
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

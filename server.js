const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE;
const ORDER_STATE_SHEET_ID = process.env.ORDER_STATE_SHEET_ID;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ORDERS_SHEET_ID = process.env.ORDERS_SHEET_ID;
const FEEDBACK_SHEET_ID = process.env.FEEDBACK_SHEET_ID;
const selectedFlavours = {};
const afterHoursSent = {};
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
  console.log(
  "Current Order State:",
  orderState
);
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
 const rememberedFlavour =
  selectedFlavours[phone] || "";
  const prompt = `
You are Bleu Bakes' senior bakery sales executive on WhatsApp.
CURRENT DATE & TIME:
${currentDateTime}
CURRENT ORDER STATE:
${orderState}
SELECTED FLAVOUR:
${rememberedFlavour}
MENU:
${menuText}
NEW CUSTOMER MESSAGE:
${userMessage}

Always maintain and update the current order state.
Return:
{
  "create_order": false,
  "orderState": "Customer asked for menu",
  "reply": ""
}
{
  "create_order": true,
  "orderState": "Customer ordered 1kg Chocolate Truffle Cake for pickup on 25 June",
  ...
}
ORDER STATE RULES:
The orderState field must ALWAYS contain the latest customer context.

Examples:
"Customer wants a 1kg Chocolate Truffle Cake."
"Customer wants a Spiderman cake for 25 June."
"Customer selected delivery and provided pincode 110040."
"Waiting for flavour confirmation."

Never erase previously collected information.
Always keep all confirmed details in orderState and append new information.
If SELECTED FLAVOUR is not empty,
the customer has already chosen a flavour.
Never ask flavour again.
Use that flavour in the final order.

Example:
Customer wants 1kg Chocolate Truffle Cake
→ Customer wants 1kg Chocolate Truffle Cake for 25 June
→ Customer wants 1kg Chocolate Truffle Cake for 25 June pickup
→ Customer wants 1kg Chocolate Truffle Cake for 25 June pickup, waiting for confirmation

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
🎨 Custom Cakes
🎂 Cakes
🎁 Bento Cakes
🍰 Pastries & Cupcakes
🫙 Jar Cakes
🍫 Brownies
🍮 Desserts
🍕 Pizza & Pasta 🍝
🍟 Snacks
🥤 Beverages

Then ask:
"Which category would you like to explore?"

CUSTOM CAKE FLOW:

CUSTOM CAKE RULES:
• Minimum weight: 300 gm
• Maximum weight: Any weight

Pricing:
• Use Bento pricing for 300g custom cakes
• Use Cake pricing for 500g and above

CUSTOM CAKE PRICING RULES:
• Minimum custom cake weight: 300 gm
• Maximum custom cake weight: Any weight
• For 300g custom cakes use Bento pricing.
• For 500g and above use Cake pricing.

Every custom cake includes a mandatory ₹250 customisation charge.
Internally add ₹250 to the final cake price.
Required Time is mandatory.

Accept:
• Specific times (5 PM, 6:30 PM, 11 AM)
• Time periods (Morning, Afternoon, Evening, Night)
Do not display these examples unless customer specifically asks.

IMPORTANT:
Never show:
• ₹250 charge
• surcharge
• customisation fee
• calculations
• price breakdown
Only show the final payable amount.

Examples for internal understanding only:
500g Chocolate Truffle Cake ₹500
Custom version final price ₹750
300g Belgian Chocolate Bento ₹350
Custom version final price ₹600
Do NOT reveal these calculations to customers.

Collect only missing details:
• Theme
• Flavour
• Weight
• Reference Image (optional)
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
"Would you like to confirm this order?
Reply:
✅ Confirm Order
➕ Add More Items
❌ Cancel Order"
Do NOT create an order immediately after collecting details.

Only if customer explicitly says:
* Confirm
* Confirm Order
* Yes Confirm
* Place Order
* Book It
* Haan
* Han
* Ji
* Kar Do
* Order Kar Do
* Book Kar Do
* Confirm Kar Do
* Yes
AND all required order details have already been collected,

then return:
{
  "create_order": true
}
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

📞 For an immediate response, please call or WhatsApp us directly on +917988957953.

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
  const now = new Date();
const indiaHour = Number(
  now.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false
  })
);
const isAfterHours =
  indiaHour < 10 || indiaHour >= 22;
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) {
      return res.sendStatus(200);
    }
    const from = message.from;
    let reply = "";
    const currentState =
  await getOrderState(from);   
if (
  currentState &&
  currentState.includes("HUMAN_SUPPORT") &&
  from !== ADMIN_PHONE
) {
  console.log("BOT PAUSED FOR:", from);
  return res.sendStatus(200);
}
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
if (
  isAfterHours &&
  !afterHoursSent[from]
) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
`🌙 Thanks for reaching out to Bleu Bakes!
Our team is currently offline.
You can still place your order and share all details.
We will review everything and get back to you during working hours (10 AM – 10 PM). 😊`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  afterHoursSent[from] = true;
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
                },
                {
                  id: "feedback",
                  title: "⭐ Leave Feedback"
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
 await axios.post(
  `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
  {
    messaging_product: "whatsapp",
    to: from,
    type: "document",
    document: {
      link: "file:///Users/mayankkhatri/Downloads/Menu_BB.pdf",
      filename: "Bleu_Bakes_Menu.pdf"
    }
  },
  {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  }
);
  if (userText === "new_order") {
   await saveOrderState(from, "");
delete selectedFlavours[from];
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
         text:
`📖 View Our Menu Above

🎂 What would you like to order?`
        },
        action: {
          button: "View Categories",
          sections: [
            {
              title: "Menu Categories",
              rows: [
  { id: "custom_cake", title: "🎨 Custom Cakes" },
  { id: "cakes", title: "🎂 Cakes" },
  { id: "bento_cakes", title: "🎁 Bento Cakes", description: "300gm" },
  { id: "pastries_cupcakes", title: "🍰 Pastries & Cupcakes" },
  { id: "jar_cakes", title: "🫙 Jar Cakes" },
  { id: "brownies", title: "🍫 Brownies" },
  { id: "desserts", title: "🍮 Desserts" },
  { id: "pizza_pasta", title: "🍕 Pizza & Pasta 🍝" },
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
  title: "📦 Order Updates"
},
{
  id: "modify_order",
  title: "✏️ Modify Existing Order"
},
{
  id: "order_issue",
  title: "⚠️ Order Issues"
},
{
  id: "refund",
  title: "💰 Refund / Cancellation"
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
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: from,
type: "interactive",
interactive: {
type: "button",
body: {
text: "📦 Order Updates\n\nPlease select:"
},
action: {
buttons: [
{
type: "reply",
reply: {
id: "update_whatsapp",
title: "WhatsApp Order"
}
},
{
type: "reply",
reply: {
id: "update_zomato",
title: "Zomato Order"
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
     if (userText === "modify_order") {
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: from,
type: "interactive",
interactive: {
type: "button",
body: {
text: "✏️ Modify Order\n\nPlease select:"
},
action: {
buttons: [
{
type: "reply",
reply: {
id: "modify_whatsapp",
title: "WhatsApp Order"
}
},
{
type: "reply",
reply: {
id: "modify_zomato",
title: "Zomato Order"
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
      if (userText === "order_issue") {
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: from,
type: "interactive",
interactive: {
type: "button",
body: {
text: "⚠️ Order Issue\n\nPlease select:"
},
action: {
buttons: [
{
type: "reply",
reply: {
id: "issue_whatsapp",
title: "WhatsApp Order"
}
},
{
type: "reply",
reply: {
id: "issue_zomato",
title: "Zomato Order"
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
      if (userText === "refund") {
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: from,
type: "interactive",
interactive: {
type: "button",
body: {
text: "💰 Refund / Cancellation\n\nPlease select:"
},
action: {
buttons: [
{
type: "reply",
reply: {
id: "refund_whatsapp",
title: "WhatsApp Order"
}
},
{
type: "reply",
reply: {
id: "refund_zomato",
title: "Zomato Order"
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
      if (userText === "back_main") {
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
`👋 Welcome to Bleu Bakes!
How may we assist you today?`
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
                id: "talk_team",
                title: "👨‍🍳 Talk Team"
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
                },
                {
                  id: "other_event",
                  title: "Other Requirement"
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
  if (
  userText === "society_stall" ||
  userText === "college_event" ||
  userText === "corporate_bulk" ||
  userText === "collaboration" ||
  userText === "other_event"
) {
  await saveOrderState(
    from,
    `EVENT_LEAD|${userText}`
  );
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
`🎪 Let's plan something sweet!

Please share the following details:
👤 Name:
📞 Mobile Number:
📅 Date & Location:
🧁 Expected Guests / Quantity:
📝 Any Special Requirements:

Our team will review your requirement and contact you shortly.`
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
https://maps.app.goo.gl/53SxWmZxR2QRFncJA?g_st=ic`;
return;
}
      if (userText === "instagram") {
reply =
`📸 Follow Bleu Bakes
https://www.instagram.com/bleubakesofficial?igsh=MXhqMXN2OThqcHJtMg==`;
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
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: ADMIN_PHONE,
text: {
body:
`😍 NEW POSITIVE FEEDBACK
Customer:
${from}
Rating:
Loved It`
}
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
"Content-Type": "application/json"
}
}
);
  reply =
`😍 Thank you!
We're so happy you loved it.

⭐ Please leave us a Google Review:
https://maps.app.goo.gl/53SxWmZxR2QRFncJA?g_st=ic

📸 Follow us on Instagram:
https://www.instagram.com/bleubakesofficial?igsh=MXhqMXN2OThqcHJtMg==`;
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body: reply
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
     if (userText === "good") {
  await saveFeedback(
    from,
    "Good"
  );
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: ADMIN_PHONE,
text: {
body:
`🙂 CUSTOMER FEEDBACK
Customer:
${from}
Rating:
Good`
}
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
"Content-Type": "application/json"
}
}
);
  reply =
`🙂 Thank you!
What could we do to make your experience even better?`;
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body: reply
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
if (userText === "could_be_better") {
  await saveFeedback(
    from,
    "Could Be Better"
  );
  await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: ADMIN_PHONE,
text: {
body:
`😕 CUSTOMER ISSUE
Customer:
${from}
Rating:
Could Be Better
Waiting for customer comments.`
}
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
"Content-Type": "application/json"
}
}
);
  reply =
`😕 We're sorry we missed the mark.
Please tell us what went wrong so we can improve.`;
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body: reply
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
   if (userText === "update_whatsapp") {
await saveOrderState(
  from,
  "SUPPORT_UPDATE_WHATSAPP"
);
reply =
`📦 Order Update Request

Please share:
• Name
• Mobile Number
• Order Date
• Order Number`;

await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
if (userText === "update_zomato") {
await saveOrderState(
  from,
  "SUPPORT_UPDATE_ZOMATO"
);
reply =
`📦 Order Update Request

Please share:
• Name
• Mobile Number
• Zomato Order ID
• Order Date`;

await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
if (userText === "modify_whatsapp") {
await saveOrderState(
  from,
  "SUPPORT_MODIFY_WHATSAPP"
);
reply =
`✏️ Modify Order Request

Please share:
• Name
• Mobile Number
• Order Number
• Changes Required`;
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
if (userText === "modify_zomato") {
await saveOrderState(
  from,
  "SUPPORT_MODIFY_ZOMATO"
);
reply =
`✏️ Modify Order Request

Please share:
• Name
• Mobile Number
• Zomato Order ID
• Changes Required`;
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
if (userText === "refund_whatsapp") {
await saveOrderState(
  from,
  "SUPPORT_REFUND_WHATSAPP"
);
reply =
`💰 Refund / Cancellation Request

Please share:
• Name
• Mobile Number
• Order Number
• Reason for Refund / Cancellation`;
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
if (userText === "refund_zomato") {
await saveOrderState(
  from,
  "SUPPORT_REFUND_ZOMATO"
);
reply =
`💰 Refund / Cancellation Request

Please share:
• Name
• Mobile Number
• Zomato Order ID
• Reason for Refund / Cancellation`;
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
      if (userText === "issue_whatsapp") {
await saveOrderState(
  from,
  "SUPPORT_ISSUE_WHATSAPP"
);
reply =
`⚠️ Order Issue

Please share:
• Name
• Mobile Number
• Order Number
• Issue Details`;
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
if (userText === "issue_zomato") {
await saveOrderState(
  from,
  "SUPPORT_ISSUE_ZOMATO"
);
reply =`⚠️ Order Issue

Please share:
• Name
• Mobile Number
• Zomato Order ID
• Issue Details`;
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
  messaging_product: "whatsapp",
  to: from,
  text: {
    body: reply
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
    if (
  userText === "talk_team" ||
  userText?.toLowerCase() === "talk to team"
) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: ADMIN_PHONE,
      text: {
        body: `🔔 BLEU BAKES HUMAN SUPPORT REQUEST
Customer:
${from}
Requested: Talk To Team`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
`📞 Need assistance?
Our team has been notified and will contact you shortly.

For urgent support:
📱 +91 7988957953
Thank you for choosing Bleu Bakes ❤️`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  await saveOrderState(
    from,
    "HUMAN_SUPPORT"
  );
  return res.sendStatus(200);
}     
      if (userText === "1") {
  reply = `🍫 Brownie added to your order.
Anything else you'd like?`;
}
if (userText === "2") {
  reply = `🧁 Cupcake added to your order.
Anything else you'd like?`;
}
if (userText === "3") {
  reply = `🍰 Jar Cake added to your order.
Anything else you'd like?`;
}
if (userText === "4") {
  reply = `👍 No problem.
We'll continue with your order.`;
}
    if (userText === "feedback") {
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
We'd love your feedback!
How was your experience with Bleu Bakes?`
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
title: "😕 Improve"
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
      if (
  userText.startsWith("ready ")
) {
  const customerPhone =
    userText
      .replace("ready ", "")
      .trim();
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: customerPhone,
      text: {
        body:
`🎂 Your order is ready!
You may now collect your order from Bleu Bakes.
Thank you for choosing us ❤️`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  reply =
`✅ Ready notification sent to ${customerPhone}`;
  return;
}
      if (
  userText.startsWith("out ")
) {
  const customerPhone =
    userText
      .replace("out ", "")
      .trim();
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: customerPhone,
      text: {
        body:
`🚚 Good news!
Your order is on the way.
We'll see you soon ❤️`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  reply =
`✅ Out For Delivery notification sent to ${customerPhone}`;
  return;
}
      if (
  userText.startsWith("delivered ")
) {
  const customerPhone =
    userText
      .replace("delivered ", "")
      .trim();
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: customerPhone,
      text: {
        body:
`🎉 Your order has been delivered.
We hope you enjoy every bite!
Thank you for choosing Bleu Bakes ❤️`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  reply =
`✅ Delivered notification sent to ${customerPhone}`;
  return;
}
if (
  userText.startsWith("feedback ")
)
{
  const customerPhone =
    userText.replace("feedback ", "").trim();
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: customerPhone,
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
      if (userText === "custom_cake") {
await saveOrderState(from, "");
delete selectedFlavours[from];
reply =
`🎂 Custom Cakes

Please share:
• Theme
• Flavour
• Weight
• Reference Image (optional)
• Date
• Time
• Delivery or Pickup
Please share the details and we'll get started 😊`;
}
      if (userText === "cakes") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🎂 Select Cake Category"
        },
        action: {
          button: "View Cakes",
          sections: [{
            title: "Cake Categories",
            rows: [
              {
                id: "classic_cakes",
                title: "Classic Cakes",
                description: "500 gm | 1 kg"
              },
              {
                id: "chocolate_cakes",
                title: "Chocolate Cakes",
                description: "500 gm | 1 kg"
              },
              {
                id: "premium_cakes",
                title: "Premium Cakes",
                description: "500 gm | 1 kg"
              },
              {
                id: "fruit_cakes",
                title: "Fruit Cakes",
                description: "500 gm | 1 kg"
              }
            ]
          }]
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
      if (userText === "bento_cakes") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🎁 Select Bento Cake Category"
        },
        action: {
          button: "View Bento Cakes",
          sections: [{
            title: "Bento Categories",
            rows: [
              {
                id: "bento_classic",
                title: "Classic Bento",
                description: "300 gm"
              },
              {
                id: "bento_chocolate",
                title: "Chocolate Bento",
                description: "300 gm"
              },
              {
                id: "bento_premium",
                title: "Premium Bento",
                description: "300 gm"
              }
            ]
          }]
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
      if (userText === "classic_cakes") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🎂 Select Classic Cake Flavour"
        },
        action: {
          button: "View Flavours",
          sections: [{
            title: "Classic Cakes",
            description: "500 gm | 1 kg",
            rows: [
              { id: "chocolate_vanilla", title: "Chocolate Vanilla", description: "₹550 | ₹1000" },
              { id: "vanilla", title: "Vanilla", description: "₹350 | ₹700" },
              { id: "butter_scotch_caramel", title: "Butter Scotch Caramel", description: "₹550 | ₹1000" },
              { id: "red_velvet", title: "Red Velvet", description: "₹600 | ₹1100" },
              { id: "white_forest", title: "White Forest", description: "₹600 | ₹1100" }
            ]
          }]
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
if (userText === "chocolate_cakes") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🍫 Select Chocolate Cake Flavour"
        },
        action: {
          button: "View Flavours",
          sections: [{
            title: "Chocolate Cakes",
            description: "500 gm | 1 kg",
            rows: [
              { id: "chocolate_truffle", title: "Chocolate Truffle", description: "₹650 | ₹1200" },
              { id: "chocochip", title: "Chocochip", description: "₹600 | ₹1100" },
              { id: "chocolate_mousse", title: "Chocolate Mousse", description: "₹600 | ₹1100" },
              { id: "oreo", title: "Oreo", description: "₹550 | ₹1000" },
              { id: "kitkat", title: "KitKat", description: "₹550 | ₹1000" },
              { id: "dairy_milk", title: "Dairy Milk", description: "₹600 | ₹1100" }
            ]
          }]
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
if (userText === "premium_cakes") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "👑 Select Premium Cake Flavour"
        },
        action: {
          button: "View Flavours",
  sections: [
    {
      title: "Premium Cakes 1",
      description: "500 gm | 1 kg",
      rows: [
        {
          id: "belgian_chocolate",
          title: "Belgian Chocolate",
          description: "₹700 | ₹1300"
        },
        {
          id: "rasmalai",
          title: "Rasmalai",
          description: "₹700 | ₹1300"
        },
        {
          id: "rose_pista",
          title: "Rose Pista",
          description: "₹750 | ₹1400"
        },
        {
          id: "hazelnut_rocher",
          title: "Hazelnut Rocher",
          description: "₹950 | ₹1800"
        },
        {
          id: "tiramisu",
          title: "Tiramisu",
          description: "₹950 | ₹1800"
        },
        {
          id: "roll_up_chocolate",
          title: "Roll Up Chocolate",
          description: "₹650 | ₹1200"
        }
      ]
    },
    {
      title: "Premium Cakes 2",
      description: "500 gm | 1 kg",
      rows: [
        {
          id: "red_velvet_choco_truffle",
          title: "Red Velvet Choco",
          description: "₹650 | ₹1200"
        },
        {
          id: "rich_butterscotch_crunch",
          title: "Rich Butterscotch",
          description: "₹650 | ₹1200"
        },
        {
          id: "heart_shaped_red_velvet",
          title: "Heart Red Velvet",
          description: "₹750 | ₹1400"
        },
        {
          id: "chocolate_truffle_bomb",
          title: "Truffle Bomb",
          description: "₹750 | ₹1400"
        },
        {
          id: "lotus_biscoff",
          title: "Lotus Biscoff",
          description: "₹650 | ₹1200"
        },
        {
          id: "chocolate_mocha",
          title: "Chocolate Mocha",
          description: "₹700 | ₹1300"
        }
      ]
    }
  ]
}         
        }
      }
    ,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  return res.sendStatus(200);
}
if (userText === "fruit_cakes") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🍓 Select Fruit Cake Flavour"
        },
        action: {
          button: "View Flavours",
          sections: [{
            title: "Fruit Cakes",
            description: "500 gm | 1 kg",
            rows: [
              { id: "fresh_fruit", title: "Fresh Fruit",description: "₹650 | ₹1200" },
              { id: "blueberry_fruit", title: "Blueberry",description: "₹700 | ₹1300" },
              { id: "pineapple_fruit", title: "Pineapple",description: "₹450 | ₹900" }
            ]
          }]
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
      if (userText === "bento_classic") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🎁 Select Classic Bento Flavour"
        },
        action: {
          button: "View Flavours",
          sections: [{
            title: "Classic Bento Cakes",
            rows: [
              { id: "bento_butterscotch", title: "Butterscotch", description: "₹400" },
              { id: "bento_pineapple", title: "Pineapple", description: "₹400" },
              { id: "bento_red_velvet", title: "Red Velvet", description: "₹400" },
              { id: "bento_fresh_fruit", title: "Fresh Fruit", description: "₹450" },
              { id: "bento_chocolate_truffle", title: "Chocolate Truffle", description: "₹450" },
              { id: "bento_chocolate_vanilla", title: "Chocolate Vanilla", description: "₹450" }
            ]
          }]
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
if (userText === "bento_chocolate") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "🍫 Select Chocolate Bento Flavour"
        },
        action: {
          button: "View Flavours",
          sections: [{
            title: "Chocolate Bento Cakes",
            rows: [
              { id: "bento_chocochip", title: "Chocochip", description: "₹450" },
              { id: "bento_oreo", title: "Oreo", description: "₹450" },
              { id: "bento_kitkat", title: "KitKat", description: "₹450" },
              { id: "bento_dairymilk", title: "Dairy Milk", description: "₹500" }
            ]
          }]
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
if (userText === "bento_premium") {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: "👑 Select Premium Bento Flavour"
        },
        action: {
          button: "View Flavours",
          sections: [{
            title: "Premium Bento Cakes",
            rows: [
              { id: "bento_love_pearl", title: "Love & Pearl", description: "₹450" },
              { id: "bento_chocolate_mocha", title: "Chocolate Mocha", description: "₹550" },
              { id: "bento_lotus_biscoff", title: "Lotus Biscoff", description: "₹550" },
              { id: "bento_belgian_chocolate", title: "Belgian Chocolate", description: "₹550" }
            ]
          }]
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
      const flavourMap = {
  chocolate_vanilla: "Chocolate Vanilla",
  vanilla: "Vanilla",
  butter_scotch_caramel: "Butter Scotch Caramel",
  red_velvet: "Red Velvet",
  white_forest: "White Forest",
  chocolate_truffle: "Chocolate Truffle",
  chocochip: "Chocochip",
  chocolate_mousse: "Chocolate Mousse",
  oreo: "Oreo",
  kitkat: "KitKat",
  dairy_milk: "Dairy Milk",
  belgian_chocolate: "Belgian Chocolate",
  rasmalai: "Rasmalai",
  rose_pista: "Rose Pista",
  hazelnut_rocher: "Hazelnut Rocher",
  tiramisu: "Tiramisu",
  lotus_biscoff: "Lotus Biscoff",
  roll_up_chocolate: "Roll Up Chocolate",
  red_velvet_choco_truffle: "Red Velvet Choco Truffle",
  rich_butterscotch_crunch: "Rich Butterscotch Crunch",
  heart_shaped_red_velvet: "Heart Shaped Red Velvet",
  chocolate_truffle_bomb: "Chocolate Truffle Bomb",
  fresh_fruit: "Fresh Fruit",
  blueberry_fruit: "Blueberry",
  pineapple_fruit: "Pineapple",
  bento_butterscotch: "Butterscotch",
  bento_pineapple: "Pineapple",
  bento_red_velvet: "Red Velvet",
  bento_fresh_fruit: "Fresh Fruit",
  bento_chocolate_truffle: "Chocolate Truffle",
  bento_chocolate_vanilla: "Chocolate Vanilla",
  bento_chocochip: "Chocochip",
  bento_oreo: "Oreo",
  bento_kitkat: "KitKat",
  bento_dairymilk: "Dairy Milk",
  bento_love_pearl: "Love & Pearl",
  bento_chocolate_mocha: "Chocolate Mocha",
  bento_lotus_biscoff: "Lotus Biscoff",
  bento_belgian_chocolate: "Belgian Chocolate"
};
if (flavourMap[userText]) {
   const isBento =
  userText.startsWith("bento_");

await axios.post(
  `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
  {
    messaging_product: "whatsapp",
    to: from,
    text: {
      body: isBento
        ? `🎁 Selected Flavour: ${flavourMap[userText]}

Weight: 300 gm

Please share:
• Delivery or Pickup
• Required Date
• Required Time`
        : `🎂 Selected Flavour: ${flavourMap[userText]}

Please share:
• Weight
• Delivery or Pickup
• Required Date
• Required Time`
    }
  },
  {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  }
);
  selectedFlavours[from] =
  flavourMap[userText];
  return res.sendStatus(200);
}
      if (
  userText.startsWith("resume ")
) {

  const customerPhone =
    userText
      .replace("resume ", "")
      .trim();
  await saveOrderState(
    customerPhone,
    ""
  );
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
`✅ Bot resumed for ${customerPhone}`
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
  if (
  currentState &&
  currentState.startsWith("EVENT_LEAD")
) {
  const eventType =
    currentState.split("|")[1] || "";
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: ADMIN_PHONE,
      text: {
        body:
`🎪 NEW EVENT ENQUIRY
Type:
${eventType}
Customer:
${from}
Details:
${userText}`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  await saveOrderState(from, "");
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
`✅ Thank you.
Your event enquiry has been received and forwarded to our team.
A member of our team will contact you shortly. 🎪`
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
if (
  currentState &&
  currentState.startsWith("SUPPORT_")
) {
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: ADMIN_PHONE,
text: {
body:
`📞 CUSTOMER SUPPORT REQUEST
Type:
${currentState}
Customer:
${from}
Details:
${userText}`
}
},
{
headers: {
Authorization: `Bearer ${WHATSAPP_TOKEN}`,
"Content-Type": "application/json"
}
}
);
await saveOrderState(from, "");
await axios.post(
`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
{
messaging_product: "whatsapp",
to: from,
text: {
body:
`✅ Thank you.
Your request has been forwarded to our team.
We will contact you shortly.`
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
  if (
  userText &&
  ["hi","hello","hey","start","menu"].includes(
    userText.toLowerCase().trim()
  )
) {
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
`👋 Welcome to Bleu Bakes!
How may we assist you today?`
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
                id: "talk_team",
                title: "👨‍🍳 Talk Team"
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
      const aiResponse =
  await generateReply(
    from,
    userText
  ); 
if (
  aiResponse.orderState !== undefined
) {
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
  delete selectedFlavours[from];
  await axios.post(
  `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
  {
    messaging_product: "whatsapp",
    to: ADMIN_PHONE,
    text: {
      body:
`🎉 NEW ORDER RECEIVED
📱 Customer: ${from}
🍰 Item: ${aiResponse.items || "-"}
🎂 Flavour: ${aiResponse.flavour || "-"}
⚖️ Weight: ${aiResponse.weight || "-"}
📅 Date: ${aiResponse.date || "-"}
🕒 Time: ${aiResponse.time || "-"}
🚚 Delivery: ${aiResponse.deliveryType || "-"}
📍 Address: ${aiResponse.address || "-"}
Please check Orders Sheet.`
    }
  },
  {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  }
);
  let pickupNote = "";
if (
  aiResponse.deliveryType &&
  aiResponse.deliveryType
    .toLowerCase()
    .includes("pickup")
) {
  pickupNote = `

📍 Pickup Address
Bleu Bakes
Shop No.-18,
Dada Chatri Wali Market,
Near Shri Sidh Shani Mandir,
Sector B-2,
Narela, Delhi - 110036`;
}
  reply =
`${aiResponse.reply ||
"🎉 Your order request has been received successfully. Our team will contact you shortly."}
${pickupNote}
━━━━━━━━━━━━━━
🎁 Add something extra?

Reply:
1 = Brownie ₹110
2 = Cupcake ₹130
3 = Jar Cake ₹200
4 = No Thanks`;
} else {
  reply =
    aiResponse.reply ||
    "Thank you for contacting Bleu Bakes.";
}
    }
    if (!reply || !reply.trim()) {
  reply = "Thank you for contacting Bleu Bakes ❤️";
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

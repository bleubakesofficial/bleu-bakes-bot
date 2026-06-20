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

If customer explicitly asks:
"talk to human"
"talk to team"
"call me"
"human support"

Then reply:

"Please select Talk to Team from the menu."

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
    const currentState =
  await getOrderState(from);

if (
  currentState === "HUMAN_SUPPORT" &&
  from !== ADMIN_PHONE
) {
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
    id: "more_menu",
    title: "⚙️ More Menu"
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
  { id: "custom_cake", title: "🎨 Custom Cakes" },
  { id: "cakes", title: "🎂 Cakes" },
  { id: "bento_cakes", title: "🎁 Bento Cakes" },
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
      if (userText === "more_menu") {

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
`⚙️ More Menu

Please choose an option:`
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "support_menu",
                title: "💬 Support"
              }
            },
            {
              type: "reply",
              reply: {
                id: "source_menu",
                title: "📍 Found Us"
              }
            },
            {
              type: "reply",
              reply: {
                id: "back_main",
                title: "↩️ Back"
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
                id: "more_menu",
                title: "⚙️ More Menu"
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
      if (userText === "support_menu") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      type: "interactive",
     interactive: {
    type: "list",
        body: {
          text: "💬 Feedback & Support"
        },
        action: {
          button: "View Options",
          sections: [
            {
              title: "Support",
              rows: [
                {
                  id: "feedback",
                  title: "Leave Feedback"
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
      if (userText === "source_menu") {

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
"📍 How did you hear about Bleu Bakes?"
        },
        action: {
          button: "Select Source",
          sections: [
            {
              title: "Choose One",
              rows: [
                {
                  id: "src_instagram",
                  title: "Instagram"
                },
                {
                  id: "src_google",
                  title: "Google Maps"
                },
                {
                  id: "src_friend",
                  title: "Friend / Family"
                },
                {
                  id: "src_zomato",
                  title: "Zomato"
                },
                {
                  id: "src_other",
                  title: "Other"
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
  userText === "src_instagram" ||
  userText === "src_google" ||
  userText === "src_friend" ||
  userText === "src_zomato" ||
  userText === "src_other"
) {

  const sourceMap = {
    src_instagram: "Instagram",
    src_google: "Google Maps",
    src_friend: "Friend / Family",
    src_zomato: "Zomato",
    src_other: "Other"
  };

  await saveFeedback(
    from,
    "",
    sourceMap[userText],
    ""
  );

  reply =
`🎉 Thank you!

We've recorded:

📍 ${sourceMap[userText]}

This helps us understand where our customers discover Bleu Bakes.`;

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
      
     if (userText === "talk_team") {

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: ADMIN_PHONE,
      text: {
        body:
`🔔 Bleu Bakes Support Alert

Customer needs assistance.

📱 Phone:
${from}

💬 Message:
Talk to Team`
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
  reply =
`👨‍🍳 Our team has been notified.

We will get back to you shortly.

📞 For urgent assistance:
+91XXXXXXXXXX`;
}
      if (userText === "1") {

  reply =
`🍫 Brownie added to your order.

Anything else you'd like?`;

}

if (userText === "2") {

  reply =
`🧁 Cupcake added to your order.

Anything else you'd like?`;

}

if (userText === "3") {

  reply =
`🍰 Jar Cake added to your order.

Anything else you'd like?`;

}

if (userText === "4") {

  reply =
`👍 No problem.

We'll continue with your order.`;

}
      if (userText === "feedback") {
reply =
`⭐ We'd love your feedback.

Please tell us about your experience with Bleu Bakes.`;
return;
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
) {

  const customerPhone =
    userText
      .replace("feedback ", "")
      .trim();

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: customerPhone,
      text: {
        body: "send_feedback"
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
`✅ Feedback request sent to ${customerPhone}`;

  return;
}
      if (userText === "custom_cake") {

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
                title: "Classic Cakes"
              },
              {
                id: "chocolate_cakes",
                title: "Chocolate Cakes"
              },
              {
                id: "premium_cakes",
                title: "Premium Cakes"
              },
              {
                id: "fruit_cakes",
                title: "Fruit Cakes"
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
                title: "Classic Bento"
              },
              {
                id: "bento_chocolate",
                title: "Chocolate Bento"
              },
              {
                id: "bento_premium",
                title: "Premium Bento"
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
            rows: [
              { id: "chocolate_vanilla", title: "Chocolate Vanilla" },
              { id: "vanilla", title: "Vanilla" },
              { id: "butter_scotch_caramel", title: "Butter Scotch Caramel" },
              { id: "red_velvet", title: "Red Velvet" },
              { id: "white_forest", title: "White Forest" }
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
            rows: [
              { id: "chocolate_truffle", title: "Chocolate Truffle" },
              { id: "chocochip", title: "Chocochip" },
              { id: "chocolate_mousse", title: "Chocolate Mousse" },
              { id: "oreo", title: "Oreo" },
              { id: "kitkat", title: "KitKat" },
              { id: "dairy_milk", title: "Dairy Milk" }
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
      rows: [
        {
          id: "belgian_chocolate",
          title: "Belgian Chocolate"
        },
        {
          id: "rasmalai",
          title: "Rasmalai"
        },
        {
          id: "rose_pista",
          title: "Rose Pista"
        },
        {
          id: "hazelnut_rocher",
          title: "Hazelnut Rocher"
        },
        {
          id: "tiramisu",
          title: "Tiramisu"
        },
        {
          id: "roll_up_chocolate",
          title: "Roll Up Chocolate"
        }
      ]
    },
    {
      title: "Premium Cakes 2",
      rows: [
        {
          id: "red_velvet_choco_truffle",
          title: "Red Velvet Choco"
        },
        {
          id: "rich_butterscotch_crunch",
          title: "Rich Butterscotch"
        },
        {
          id: "heart_shaped_red_velvet",
          title: "Heart Red Velvet"
        },
        {
          id: "chocolate_truffle_bomb",
          title: "Truffle Bomb"
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
            rows: [
              { id: "fresh_fruit", title: "Fresh Fruit" },
              { id: "blueberry_fruit", title: "Blueberry" },
              { id: "pineapple_fruit", title: "Pineapple" }
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
              { id: "bento_butterscotch", title: "Butterscotch" },
              { id: "bento_pineapple", title: "Pineapple" },
              { id: "bento_red_velvet", title: "Red Velvet" },
              { id: "bento_fresh_fruit", title: "Fresh Fruit" },
              { id: "bento_chocolate_truffle", title: "Chocolate Truffle" },
              { id: "bento_chocolate_vanilla", title: "Chocolate Vanilla" }
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
              { id: "bento_chocochip", title: "Chocochip" },
              { id: "bento_oreo", title: "Oreo" },
              { id: "bento_kitkat", title: "KitKat" },
              { id: "bento_dairymilk", title: "Dairy Milk" }
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
              { id: "bento_love_pearl", title: "Love & Pearl" },
              { id: "bento_chocolate_mocha", title: "Chocolate Mocha" },
              { id: "bento_lotus_biscoff", title: "Lotus Biscoff" },
              { id: "bento_belgian_chocolate", title: "Belgian Chocolate" }
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

  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: {
        body:
`🎂 Selected Flavour: ${flavourMap[userText]}

Please share:

• Weight / Quantity
• Delivery or Pickup
• Required Date`
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
      
      const aiResponse =
  await generateReply(
    from,
    userText
  );
 console.log(
  "Gemini Order State:",
  aiResponse.orderState
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
  reply =
`${aiResponse.reply ||

"🎉 Your order request has been received successfully. Our team will contact you shortly."}

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

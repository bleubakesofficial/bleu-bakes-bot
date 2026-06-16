const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "bleubakes123";

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;

      await axios.post(
        `https://graph.facebook.com/v22.0/1107265895812974/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: "Hello from Bleu Bakes! 🍰"
          }
        },
        {
          headers: {
            Authorization: `Bearer EAAO6nSluVYUBRjXSZAy8C2wetRt5xHm0huzG7onNexZCqSRPZC8rmMN28ZA35KZCw4oGON80nm5qSDpcf1bsf6LMU8VlDUPFGpS5NZCqbWkGhAxqj7P5ENYZC9yixl1O0ua0yWgcJIk4r36L4ainmdx6sfwtAWgZCOlZCeqzHXqFYN9As15MdENGmePpVQ45YhfE4n5ZCutzMor4ZAJwZAS7yKj5czxyc6dmOnoBX6Ye5qSDRVRBDA7nNSqsJS7TSN6WR425F8KCTIJXYQ0IB2eOqZCqH`,
            "Content-Type": "application/json"
          }
        }
      );
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});

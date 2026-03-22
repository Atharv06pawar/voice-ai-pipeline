import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import http from "http";

dotenv.config();

// 🌐 HTTP SERVER (Render requirement)
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Voice AI server running 🚀");
});

const wss = new WebSocketServer({ server });

server.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

wss.on("connection", (client) => {
  console.log("🟢 Client connected");

  let lastFinalTranscript = "";

  const deepgramSocket = new WebSocket(
    "wss://api.deepgram.com/v1/listen?model=nova-2&encoding=linear16&sample_rate=16000&endpointing=300&punctuate=true&smart_format=true",
    {
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      },
    }
  );

  deepgramSocket.on("open", () => {
    console.log("🎤 Connected to Deepgram");
  });

  deepgramSocket.on("message", async (data) => {
    try {
      const response = JSON.parse(data);
      const transcript = response.channel?.alternatives[0]?.transcript;

      if (!transcript) return;

      // 🔹 Interim (optional debug)
      if (!response.is_final) return;

      // 🔹 Final transcript
      if (transcript !== lastFinalTranscript) {
        lastFinalTranscript = transcript;

        console.log("👤 User:", transcript);

        // 🔥 Send USER text to frontend
        client.send(JSON.stringify({ type: "user", text: transcript }));

        try {
          const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content:
                  "You are a strict fitness coach. Give short, powerful, direct answers.",
              },
              {
                role: "user",
                content: transcript,
              },
            ],
          });

          const reply = completion.choices[0].message.content;

          console.log("🤖 AI:", reply);

          // 🔥 Send AI reply to frontend
          client.send(JSON.stringify({ type: "ai", text: reply }));
        } catch (err) {
          console.error("Groq error:", err);
        }
      }
    } catch (err) {
      console.error("Deepgram parse error:", err);
    }
  });

  client.on("message", (audioChunk) => {
    if (deepgramSocket.readyState === WebSocket.OPEN) {
      deepgramSocket.send(audioChunk);
    }
  });

  client.on("close", () => {
    console.log("🔴 Client disconnected");
    deepgramSocket.close();
  });
});
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import say from "say";

dotenv.config();

// 🔊 STATE
let isSpeaking = false;
let isListening = true;

// 🔊 SPEAK FUNCTION
async function speak(text) {
  if (isSpeaking) return;

  isSpeaking = true;
  isListening = false; // ❗ STOP listening to avoid echo

  return new Promise((resolve) => {
    say.speak(text, undefined, 1.0, (err) => {
      if (err) {
        console.error("TTS error:", err);
      }

      isSpeaking = false;
      isListening = true; // ❗ RESUME listening
      resolve();
    });
  });
}

// 🔥 STOP FUNCTION (BARGE-IN SAFE)
function stopSpeaking() {
  if (isSpeaking) {
    say.stop();
    isSpeaking = false;
    isListening = true; // resume listening after stop
    console.log("🛑 AI interrupted");
  }
}

// ⚡ SERVER
const wss = new WebSocketServer({ port: 3000 });

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

wss.on("connection", (client) => {
  console.log("Client connected");

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
    console.log("Connected to Deepgram");
  });

  deepgramSocket.on("message", async (data) => {
    // ❗ Ignore mic input while AI is speaking (fix echo loop)
    if (!isListening) return;

    const response = JSON.parse(data);
    const transcript = response.channel?.alternatives[0]?.transcript;

    if (!transcript) return;

    // 🔥 BARGE-IN (only works when listening is enabled)
    if (!response.is_final && isSpeaking) {
      stopSpeaking();
    }

    // 🔹 Interim
    if (!response.is_final) {
      console.log("Interim:", transcript);
      return;
    }

    // 🔹 Final
    if (transcript !== lastFinalTranscript) {
      lastFinalTranscript = transcript;

      console.log("User:", transcript);

      try {
        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content:
                "You are a strict fitness coach. Give short, direct answers.",
            },
            {
              role: "user",
              content: transcript,
            },
          ],
        });

        const reply = completion.choices[0].message.content;

        console.log("AI:", reply);

        await speak(reply);
      } catch (err) {
        console.error("Groq error:", err);
      }
    }
  });

  client.on("message", (audioChunk) => {
    if (deepgramSocket.readyState === WebSocket.OPEN) {
      deepgramSocket.send(audioChunk);
    }
  });

  client.on("close", () => {
    deepgramSocket.close();
  });
});

console.log("Server running on ws://localhost:3000");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const mongoose = require("mongoose");
const ChatSession = require("./models/ChatSession");

const app = express();
app.use(cors());
app.use(express.json());

//Connect to MongoDB

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// In-memory store — each sessionId has its own conversation history
// const sessions = {};

const SYSTEM_PROMPT = `You are a senior software engineer mentor. 
Your student is an Angular developer learning AI integration.
Always explain things simply with short examples.
Keep answers under 5 sentences unless asked for more.`;

app.get("/", (req, res) => {
  res.json({
    message: "AI Answer Bot is running!",
  });
});

// Start a session  — now saved to MongoDB
app.post("/chat/start", async (req, res) => {
  const sessionId = Date.now().toString(); // simple unique ID

  const session = new ChatSession({ sessionId, messages: [] });
  await session.save();

  //   sessions[sessionId] = []; // empty history
  console.log(`Session started and saved: ${sessionId}`);
  res.json({
    sessionId,
    message: "Session started!",
  });
});

//Chat — loads history from MongoDB, saves back to MongoDB

app.post("/chat/:sessionId/message", async (req, res) => {
  const { sessionId } = req.params;
  const { question } = req.body;

  // Check session exists
  //   if (!sessions[sessionId]) {
  //     return res
  //       .status(404)
  //       .json({ error: "Session not found. Start a new session first" });
  //   }
  if (!question) {
    return res.status(400).json({ error: "Please send a question" });
  }

  const session = await ChatSession.findOne({ sessionId });

  // Add user message to history
  //   sessions[sessionId].push({ role: "user", content: question });

  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found. Start a new session first" });
  }

  session.messages.push({ role: "user", content: question });

  //   console.log(
  //     `\nSession ${sessionId} — history length: ${sessions[sessionId].length}`,
  //   );
  console.log(
    `Session ${sessionId} — history length: ${session.messages.length}`,
  );

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-3-haiku",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            // ...sessions[sessionId],
            ...session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ],
        }),
      },
    );

    // const data = await response.json();
    // const answer = data.choices[0].message.content;

    const data = await response.json();

    console.log("AI RAW RESPONSE:", JSON.stringify(data, null, 2));

    if (!data.choices || !data.choices[0]) {
      return res.status(500).json({
        error: "AI did not return valid response",
        full: data,
      });
    }

    const answer = data.choices[0].message.content;
    // Add AI reply and save to MongoDB
    // sessions[sessionId].push({ role: "assistant", content: answer });
    session.messages.push({ role: "assistant", content: answer });
    await session.save();

    res.json({ sessionId, question, answer });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Get history from MongoDB

app.get("/chat/:sessionId/history", async (req, res) => {
  const { sessionId } = req.params;

  //   if (!sessions[sessionId]) {
  //     return res.status(404).json({
  //       error: "Session not found",
  //     });
  //   }

  const session = await ChatSession.findOne({ sessionId });

  if (!session) {
    return res.status(404).json({ error: "Session not found " });
  }

  //   res.json({ sessionId, history: sessions[sessionId] });

  res.json({ sessionId, history: session.messages });
});

app.post("/ask", async (req, res) => {
  console.log("/ask route hit");

  const { question } = req.body;

  if (!question) {
    return res
      .status(400)
      .json({ error: "Please send a question in the body" });
  }

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-3-haiku",
          messages: [
            {
              role: "system",
              content: `You are a senior software engineer mentor. 
Your student is an Angular developer learning AI integration.
Always explain things simply with short examples.
Keep answers under 5 sentences unless asked for more.`,
            },
            { role: "user", content: question },
          ],
        }),
      },
    );

    const data = await response.json();

    console.log("Full API response:", JSON.stringify(data, null, 2));

    const answer = data?.choices?.[0]?.message?.content;

    if (!answer) {
      return res.status(500).json({ error: "Invalid AI response" });
    }

    res.json({ question, answer });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/chat/:sessionId/stream", async (req, res) => {
  const { sessionId } = req.params;
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: "Please send a question" });
  }

  // Load session from MongoDB
  const session = await ChatSession.findOne({ sessionId });

  if (!session) {
    return res.status(400).json({ error: "Session not found" });
  }

  // Add user message to history
  session.messages.push({ role: "user", content: question });

  // Set SSE headers — this keeps connection open
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*"); 
  res.flushHeaders();

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "anthropic/claude-3-haiku",
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...session.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ],
        }),
      },
    );

    let fullAnswer = "";

    // Read the stream chunk by chunk
    for await (const chunk of response.body) {
      const lines = Buffer.from(chunk)
        .toString()
        .split("\n")
        .filter((line) => line.startsWith("data: "));

      for (const line of lines) {
        const data = line.replace("data: ", "");

        // [DONE] means stream is finished
        if (data === "[DONE]") {
          // Save full answer to MongoDB
          session.messages.push({ role: "assistant", content: fullAnswer });
          await session.save();

          // Tell Angular we're done
          res.write(`data: [DONE]\n\n`);
          res.end();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices[0]?.delta?.content || "";

          if (token) {
            fullAnswer += token;
            // Send each token to Angular immediately
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (e) {
          // skip malformed chunks
        }
      }
    }
  } catch (error) {
    console.error("Streaming error:", error);
    res.write(`data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`);
    res.end();
  }
});
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log("SERVER ACTUALLY LISTENING ON PORT:", PORT);
});

server.on("error", (err) => {
  console.error("SERVER ERROR:", err);
});

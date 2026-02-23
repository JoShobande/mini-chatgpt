import "dotenv/config";
import express from "express";
import { mockAuth } from "./middleware/mockAuth";
import { conversationsRouter } from "./routes/conversations";

const app = express();

app.use(express.json());
app.use(mockAuth);
// app.use("/v1/conversations", conversationsRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, userId: _req.userId });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

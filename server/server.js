import express from "express";
import lnRoutes from "./routes/lnmarkets.js";
import supabaseRoutes from "./routes/supabase.js";
import { initBot } from "../bot/bot.js";

const app = express();
const PORT = 3000;

app.use(express.json());

app.use("/lnmarkets", lnRoutes);
app.use("/supabase", supabaseRoutes);

// Inicializa o bot ao iniciar o servidor
initBot();

app.get("/", (req, res) => {
  res.json({ message: "🚀 Servidor Express rodando com sucesso!" });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
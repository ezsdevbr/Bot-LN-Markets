import { Router } from "express";
import { createSupabaseClient } from '../connect_supabase.js';

const router = Router();
const supabase = createSupabaseClient();

router.get("/triggers", async (req, res) => {
  try {
    const { data, error } = await supabase.from("trigger").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Erro ao buscar triggers:", error);
    res.status(500).json({ error: "Erro ao buscar triggers" });
  }
});

router.post('/add_log', async (req, res) => {
  console.log('Received log data:', req.body);
  const {data, error} = await supabase
    .from('log')
    .insert(req.body);
  res.json(data);
});

export default router;
import { Router } from "express";
import { createSupabaseClient } from '../connect_supabase.js';

const router = Router();
const supabase = createSupabaseClient();

router.get("/triggers", async (req, res) => {
  const { data, error } = await supabase.from("trigger").select("*");
  if (error) throw error;
  res.json(data);
});

router.post('/add_log', async (req, res) => {
  const {data, error} = await supabase
    .from('log')
    .insert(req.body);
  res.json(data);
});

router.post('/add_trades', async (req, res) => {
    const {data, error} = await supabase
      .from('trades')
      .insert(req.body);

    if (error) {
      console.error('Erro ao inserir trades:', error);
      return res.status(500).json({ error: 'Erro ao inserir trades' });
    }
    res.json(data);
});

router.delete('/delete_trades', async (req, res) => {
    const { data, error } = await supabase
      .from('trades')
      .delete()
      .neq('id', 0); // Deleta todas as linhas

    if (error) {
      console.error('Erro ao limpar trades:', error);
      return res.status(500).json({ error: 'Erro ao limpar trades' });
    }
    res.json(data);
});

router.put('/update_trigger_status/:triggerId', async (req, res) => {
    const { triggerId } = req.params;
    const { trigger_status, trigger_ln_trade_id } = req.body;
    console.log(req.body);
    console.log(req.params);

    const { data, error } = await supabase
        .from('trigger')
        .update({ 
          'trigger_status': trigger_status, 
          'trigger_ln_trade_id': trigger_ln_trade_id
        })
        .eq('trigger_id', triggerId)
        .select()
        .single();

    if (error) {
        console.error('Erro ao atualizar status do trigger:', error);
        return res.status(500).json({ error: 'Erro ao atualizar status do trigger' });
    }
    res.json(data);
});

export default router;
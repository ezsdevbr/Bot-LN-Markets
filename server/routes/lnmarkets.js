import { Router } from "express";
import { createLnMarketsClient } from '../connect_lnmarkets.js';

const router = Router();

router.get("/get_user", async (req, res) => {
  const client = createLnMarketsClient();
  const lnResponse = await client.userGet();
  res.json(lnResponse);
});

router.get("/get_ticker", async (req, res) => {
  const client = createLnMarketsClient();
  const lnResponse = await client.futuresGetTicker({ symbol: "BTCUSD" });
  res.json(lnResponse);
});

router.get("/get_trades", async (req, res) => {
  const { type } = req.query;
  const client = createLnMarketsClient();
  const trades = await client.futuresGetTrades({ type, limit: 1000 });
  res.json(trades);
});

router.post("/add_trade", async (req, res) => {
    const client = createLnMarketsClient();
    const lnResponse = await client.futuresNewTrade(req.body);
    res.json(lnResponse);
});

router.post("/add_margin/:tradeId", async (req, res) => {
  const { tradeId } = req.params;
  const { margin } = req.body;
  const client = createLnMarketsClient();
  const lnResponse = await client.futuresAddMarginTrade({ id: tradeId, amount: margin });
  res.json(lnResponse);
});

// Rota para atualizar takeprofit de um trade
router.put('/update_takeprofit/:tradeId', async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { newTakeProfit } = req.body;

    const client = createLnMarketsClient();
    
    const updateData = {
      id: tradeId,
      type: 'takeprofit',
      value: newTakeProfit
    };
    
    console.log('Dados enviados para a API:', updateData);
    
    const response = await client.futuresUpdateTrade(updateData);
    console.log('Resposta da API:', response);
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Erro detalhado na rota /ln/update_takeprofit:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      tradeId,
      newTakeProfit
    });
    
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message
    });
  }
});

export default router;
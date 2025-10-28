let btcPrice;
let triggers = [];
let runningTrades = [];
let closedTrades = [];
let currentStrategy = ''; // Padrão

let lnFailsRequests = 0;

let user = null;

const baseUrl = 'http://localhost:3000';

export async function initBot() {
    console.log('Iniciando bot...');
    
    try {
        await getUser();

        await getTicker();

        await getTriggers();

        await getTrades();

        await checkClosedTrades();

        await updateTakeProfit();

        await protectMargin();

        setInterval(async () => {
            await getTicker();
            await openTrade();
            if (lnFailsRequests >= 5) {
                await flashCrashProtection();
            }
        }, 1000);

        setInterval(async () => {
            await getTriggers();
        }, 30000);
    } catch (error) {
        console.error('Erro na inicialização do bot:', error.message);
        initBot();
    }
}

// Função para buscar o preço atual do BTC em USD
async function getTicker() {
    try {
        const routeResponse = await fetch(`${baseUrl}/lnmarkets/get_ticker`, {
            signal: AbortSignal.timeout(10000)
        });

        if (routeResponse.status === 200) {
            await addLog(routeResponse.status, `Ticker solicitado com sucesso`, 'futuresGetTicker');
            const ticker = await routeResponse.json();
            btcPrice = Number(ticker.lastPrice);

            console.log('Preço do BTC atualizado:', btcPrice);
            lnFailsRequests = 0;
        } else {
            lnFailsRequests++;
            console.error(`Erro HTTP ${routeResponse.status}: ${routeResponse.statusText}`);
            await addLog(routeResponse.status, `Falha ao solicitar ticker`, 'futuresGetTicker');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar ticker:', error);
        await addLog(1, `Falha no backend ao solicitar ticker`, null, error);
    }
}

// Função para buscar dados do usuário
async function getUser() {
    try {
        const routeResponse = await fetch(`${baseUrl}/lnmarkets/get_user`, {
            signal: AbortSignal.timeout(10000)
        });

        if (routeResponse.status === 200) {
            user = await routeResponse.json();
            await addLog(routeResponse.status, `Usuário solicitado com sucesso`, 'getUser');
        } else {
            user = null;
            await addLog(routeResponse.status, `Falha ao solicitar usuário`, 'getUser');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar usuário:', error);
        user = null;
        await addLog(1, `Falha no backend ao solicitar usuário`, 'getUser', error);
    }
}

// Função para buscar os triggers salvos por perfis no Supabase
async function getTriggers() {
    const response = await fetch(`${baseUrl}/supabase/triggers`, {
        signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
        triggers = await response.json();
        console.log('Triggers solicitados com sucesso');
    } else {
        console.error(`Erro ao buscar triggers: ${response.status} ${response.statusText}`);
    }
}

// Função para buscar trades fechados e abertos
async function getTrades() {
    try {
        const closedTradesResponse = await fetch(`${baseUrl}/lnmarkets/get_trades?type=closed`, {
            signal: AbortSignal.timeout(10000)
        });

        if (closedTradesResponse.status === 200) {
            closedTrades = await closedTradesResponse.json();
            console.log('Trades fechados solicitados com sucesso');
            await addLog(closedTradesResponse.status, `Trades fechados solicitados com sucesso`, 'futuresGetTrades');

            await saveTradesInSupabase();
        } else {
            console.error(`Erro ao buscar trades fechados: ${closedTradesResponse.status} ${closedTradesResponse.statusText}`);
            await addLog(closedTradesResponse.status, `Falha ao solicitar trades fechados`, 'futuresGetTrades');
        }

        const openTradesResponse = await fetch(`${baseUrl}/lnmarkets/get_trades?type=running`, {
            signal: AbortSignal.timeout(10000)
        });

        if (openTradesResponse.status === 200) {
            runningTrades = await openTradesResponse.json();
            console.log('Trades abertos solicitados com sucesso');
            await addLog(openTradesResponse.status, `Trades abertos solicitados com sucesso`, 'futuresGetTrades');
        } else {
            console.error(`Erro ao buscar trades abertos: ${openTradesResponse.status} ${openTradesResponse.statusText}`);
            await addLog(openTradesResponse.status, `Falha ao solicitar trades abertos`, 'futuresGetTrades');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar trades:', error);
        await addLog(1, `Falha no backend ao solicitar trades`, 'futuresGetTrades', error);
    }
}

// Função para salvar trades fechados no Supabase
async function saveTradesInSupabase() {
    try {
        const deleteTradesResponse = await fetch(`${baseUrl}/supabase/delete_trades`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(10000)
        });

        let trades = [];

        if (deleteTradesResponse.status === 200) {
            closedTrades.forEach(trade => {
                if (trade.canceled != true) {
                    trades.push(trade);
                }
            });

            const addTradesResponse = await fetch(`${baseUrl}/supabase/add_trades`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(trades)
            });

            if (addTradesResponse.ok) {
                console.log('Trades fechados salvos com sucesso no Supabase.');
            } else {
                console.error(`Erro ao salvar trades fechados no Supabase.`);
            }
        }
    } catch (error) {
        console.error('Falha no backend ao salvar trades fechados no Supabase:', error);
    }
}

// BOT
    // Abertura de trades
    async function openTrade() {
        console.log('🔍 Iniciando verificação para abertura de trades...');
        try {
            await getTicker();

            for (const trigger of triggers) {
                try {
                    const { trigger_status, trigger_price, trigger_strategy, trigger_type, trigger_side, trigger_leverage, trigger_quantity, trigger_takeprofit, trigger_id } = trigger;

                    if (trigger_status !== 'waiting' || Math.abs(btcPrice - trigger_price) > 20) continue;

                    console.log(`🚀 Abrindo trade para trigger ${trigger_id} | Preço gatilho: ${trigger_price} | BTC: ${btcPrice}`);

                    const newTrade = {
                        type: trigger_type,
                        side: trigger_side,
                        leverage: Number(trigger_leverage),
                        quantity: Number(trigger_quantity),
                        price: Number(btcPrice),
                        ...(trigger_strategy === "takeProfit" && { takeprofit: Math.round(Number(trigger_takeprofit)) })
                    };

                    const addTradeResponse = await fetch(`${baseUrl}/lnmarkets/add_trade`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newTrade),
                        signal: AbortSignal.timeout(15000)
                    });

                    if (addTradeResponse.status != 200) {
                        console.warn(`⚠️ Falha ao criar trade: ${addTradeResponse.status}`);
                        await addLog(addTradeResponse.status, `Falha ao criar trade`, 'futuresNewTrade');
                        continue;
                    }

                    const newTradeData = await addTradeResponse.json();
                    console.log('✅ Trade criado com sucesso:', newTradeData);

                    await addLog(addTradeResponse.status, `Trade criado com sucesso. Preço de entrada: ${newTrade.price}`, 'futuresNewTrade');

                    const updateRes = await fetch(`${baseUrl}/supabase/update_trigger_status/${trigger_id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            trigger_status: 'open', 
                            trigger_ln_trade_id: newTradeData.id 
                        }),
                        signal: AbortSignal.timeout(10000)
                    });

                    console.log('🔄 Status do gatilho atualizado:', await updateRes.json());
                } catch (err) {
                    console.error(`❌ Erro ao processar trigger: ${trigger.trigger_id}`, err);
                    await addLog('error', `Erro ao processar trigger ${trigger.trigger_id}`, err.message);
                    // Continua o loop mesmo com erro
                }
            }

            await getTrades();
            await getTriggers();
        } catch (error) {
            console.error('💥 Erro geral ao abrir trades:', error);
            await addLog('error', 'Falha geral no openTrade', error.message);
        }
    }

    // Checagem de trades fechados para atualizar status dos triggers
    // Essa função verifica se algum trade que está "open" no Firestore foi fechado na LN, e atualiza o status do trigger para "waiting" novamente
    async function checkClosedTrades() {
        try {
            const openTriggers = triggers.filter(trigger => trigger.trigger_status === 'open');
        
            if (openTriggers.length > 0) {
                for (const trigger of openTriggers) {
                    if (closedTrades.some(trade => trade.id === trigger.trigger_ln_trade_id)) {
                        await fetch(`${baseUrl}/supabase/update_trigger_status/${trigger.trigger_id}`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                trigger_status: 'waiting',
                                trigger_ln_trade_id: null
                            }),
                            signal: AbortSignal.timeout(10000)
                        });

                        console.log(`Trade ${trigger.trigger_price} foi fechado. Atualizando trigger ${trigger.trigger_id}.`);
                    }
                }
                
                await getTrades();
                await getTriggers();
            }
        } catch (error) {
            console.error('Falha no backend ao verificar trades fechados:', error.message);
            await addLog(1, `Falha no backend ao verificar trades fechados`, null, error);
        }
    }

    // Atualização de TakeProfit para cobrir taxas de funding cost
    async function updateTakeProfit() {
        try {
            for (const runningTrade of runningTrades) {
                if (runningTrade.takeprofit != 0 && runningTrade.sum_carry_fees >= 0) {

                    if (!(Math.abs(newTakeProfit - runningTrade.takeprofit) < 0.1) || runningTrade.takeprofit == newTakeProfit) {
                        const updateResponse = await fetch(`${baseUrl}/lnmarkets/update_takeprofit/${runningTrade.id}`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                newTakeProfit: Number(newTakeProfit)
                            }),
                            signal: AbortSignal.timeout(15000)
                        });
                    }
                }
            }
        } catch (error) {
            return;
        }
    }

    // Proteção de margem
    async function protectMargin() {
        for (const trade of runningTrades) {
            if (btcPrice > trade.liquidation && (btcPrice - trade.liquidation) <= (btcPrice * 0.07)) {
                // 1. Definir preço de liquidação desejado (10% abaixo)
                const targetLiquidation = btcPrice * 0.9;

                // 2. Calcular alavancagem necessária para ter esse liquidation
                const targetLeverage = 1 / (1 - targetLiquidation / trade.price);

                // 3. Margem necessária (em USD)
                const requiredMarginUsd = trade.quantity / targetLeverage;

                // 4. Converter USD → satoshis
                const usdPerSat = trade.price / 1e8; // 1 sat em USD
                const requiredMarginSats = requiredMarginUsd / usdPerSat;

                // 5. Calcular quanto adicionar
                const marginToAdd = requiredMarginSats - trade.margin;

                const addMarginResponse = await fetch(`${baseUrl}/lnmarkets/add_margin/${trade.id}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        margin: Number(marginToAdd.toFixed(0))
                    })
                });

                if (addMarginResponse.status === 200) {
                    console.log(`Margem adicionada com sucesso ao trade ${trade.id}`);
                    await addLog(addMarginResponse.status, `Margem adicionada com sucesso ao trade ${trade.id}`, 'futuresAddMarginTrade');

                    await getTrades();
                    await getUser();
                } else {
                    console.error(`Falha ao adicionar margem ao trade ${trade.id}`);
                    await addLog(addMarginResponse.status, `Falha ao adicionar margem de ${marginToAdd.toFixed(0)} sats ao trade ${trade.id}. Saldo disponivel: ${user.balance} sats`, 'futuresAddMarginTrade');
                }
            }
        };
    }

//Sistema anti-flash-crash LNMarkets
async function flashCrashProtection() {
    console.warn('Múltiplas falhas de requisição detectadas. Executando proteção contra flash crash.');

    // Lógica de proteção contra flash crash
    // Por exemplo, pausar operações ou ajustar parâmetros de negociação
}

// Função para adicionar logs no Supabase
async function addLog(lnStatusError, message, lnAction, backendError = null) {
    try {
        const userUid = user?.uid || null;
        
        switch (lnStatusError) {
            case 200:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': userUid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_error': 'OK. The request was successful.',
                        'log_message': message,
                     })
                });
                break;
            case 400:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Bad request. Your request is invalid.',
                     })
                });
                break;
            case 401:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Unauthorized. Your API key is wrong or you don’t have access to the requested resource.',
                     })
                });
                break;
            case 403:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Internal server error',
                     })
                });
                break;
            case 404:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Not found.',
                     })
                });
                break;
            case 405:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Method Not Allowed. You tried to access a resource with an invalid method.',
                     })
                });
                break;            
            case 418:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'I’m a teapot.',
                     })
                });
                break;            
            case 429:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Too many requests. Your connection is being rate limited.',
                     })
                });
                break;  
            case 500:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Internal server error',
                     })
                });
                break;          
            case 503:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user.uid,
                        'log_ln_status_error': lnStatusError,
                        'log_action': lnAction,
                        'log_message': message,
                        'log_error': 'Service unavailable. We’re temporarily offline for maintenance. Please try again later.',
                     })
                });
                break;
            default:
                await fetch(`${baseUrl}/supabase/add_log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        'log_ln_user_uid': user?.uid || null,
                        'log_ln_status_error': lnStatusError,
                        'log_error': backendError ? backendError.message : 'Unknown error',
                        'log_message': "Erro no backend. Verifique os logs"
                     })
                });
                break;
        }
    } catch (error) {
        console.error('Erro ao adicionar log no Supabase:', error);
    }
}
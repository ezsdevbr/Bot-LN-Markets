let btcPrice;
let triggers = [];
let runningTrades = [];
let openTrades = [];
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

        // LMarkets
        setInterval(async () => {
            await getTicker();
            await openTrade();
            await protectMargin();
            if (lnFailsRequests >= 5) {
                await flashCrashProtection();
            }
        }, 3000); // 3 segundos

        setInterval(async () => {
            await checkClosedTrades();
        }, 120000); // 2 minutos

        // Supabase
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
    console.log('🔍 Buscando ticker do BTC...');
    try {
        const routeResponse = await fetch(`${baseUrl}/lnmarkets/get_ticker`, {
            signal: AbortSignal.timeout(10000)
        });

        if (routeResponse.status === 200) {
            const ticker = await routeResponse.json();
            btcPrice = Number(ticker.lastPrice);

            console.log('✅ Ticker solicitado com sucesso. Preço do BTC atualizado:', btcPrice);
            lnFailsRequests = 0;
        } else {
            lnFailsRequests++;
            console.error(`Erro HTTP ${routeResponse.status}: ${routeResponse.statusText}`);
            await addLog(routeResponse.status, `Falha ao solicitar ticker`, 'futuresGetTicker');
            console.log('❌ Falha ao solicitar ticker');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar ticker:', error);
        await addLog(1, `Falha no backend ao solicitar ticker`, null, error);
    }
}

// Função para buscar dados do usuário
async function getUser() {
    console.log('🔍 Buscando dados do usuário...');
    try {
        const routeResponse = await fetch(`${baseUrl}/lnmarkets/get_user`, {
            signal: AbortSignal.timeout(10000)
        });

        if (routeResponse.status === 200) {
            user = await routeResponse.json();
            await addLog(routeResponse.status, `Usuário solicitado com sucesso`, 'getUser');
            console.log('✅ Usuário solicitado com sucesso:');
        } else {
            await addLog(routeResponse.status, `Falha ao solicitar usuário`, 'getUser');
            console.log('❌ Falha ao solicitar usuário');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar usuário:', error);
        await addLog(1, `Falha no backend ao solicitar usuário`, 'getUser', error);
    }
}

// Função para buscar os triggers salvos por perfis no Supabase
async function getTriggers() {
    console.log('🔍 Buscando triggers no Supabase...');
    const response = await fetch(`${baseUrl}/supabase/triggers`, {
        signal: AbortSignal.timeout(15000)
    });

    if (response.ok) {
        triggers = await response.json();
        console.log('✅ Triggers solicitados com sucesso');
    } else {
        console.error(`Erro ao buscar triggers: ${response.status} ${response.statusText}`);
        console.log('❌ Falha ao solicitar triggers');
    }
}

// Função para buscar trades fechados e abertos
async function getTrades() {
    console.log('🔍 Buscando trades no LNMarkets...');
    try {
        const closedTradesResponse = await fetch(`${baseUrl}/lnmarkets/get_trades?type=closed`, {
            signal: AbortSignal.timeout(10000)
        });

        if (closedTradesResponse.status === 200) {
            closedTrades = await closedTradesResponse.json();
            await addLog(closedTradesResponse.status, `Trades fechados solicitados com sucesso`, 'futuresGetTrades');
            console.log('✅ Trades fechados solicitados com sucesso');

            await saveTradesInSupabase();
        } else {
            console.error(`Erro ao buscar trades fechados: ${closedTradesResponse.status} ${closedTradesResponse.statusText}`);
            await addLog(closedTradesResponse.status, `Falha ao solicitar trades fechados`, 'futuresGetTrades');
            console.log('❌ Falha ao solicitar trades fechados');
        }

        // Pequeno delay entre requisições para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

        const runningTradesResponse = await fetch(`${baseUrl}/lnmarkets/get_trades?type=running`, {
            signal: AbortSignal.timeout(10000)
        });

        if (runningTradesResponse.status === 200) {
            runningTrades = await runningTradesResponse.json();
            await addLog(runningTradesResponse.status, `Trades abertos solicitados com sucesso`, 'futuresGetTrades');
            console.log('✅ Trades abertos solicitados com sucesso');
        } else {
            console.error(`Erro ao buscar trades abertos: ${runningTradesResponse.status} ${runningTradesResponse.statusText}`);
            await addLog(runningTradesResponse.status, `Falha ao solicitar trades abertos`, 'futuresGetTrades');
            console.log('❌ Falha ao solicitar trades abertos');
        }

        // Pequeno delay entre requisições para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

        const openTradesResponse = await fetch(`${baseUrl}/lnmarkets/get_trades?type=open`, {
            signal: AbortSignal.timeout(10000)
        });

        if (openTradesResponse.status === 200) {
            openTrades = await openTradesResponse.json();
            await addLog(runningTradesResponse.status, `Trades abertos solicitados com sucesso`, 'futuresGetTrades');
            console.log('✅ Trades abertos solicitados com sucesso');
        } else {
            console.error(`Erro ao buscar trades abertos: ${openTradesResponse.status} ${openTradesResponse.statusText}`);
            await addLog(openTradesResponse.status, `Falha ao solicitar trades abertos`, 'futuresGetTrades');
            console.log('❌ Falha ao solicitar trades abertos');
        }
    } catch (error) {
        console.error('❌ Falha no backend ao solicitar trades:', error);
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
                console.log('✅ Trades fechados salvos com sucesso no Supabase.');
            } else {
                console.error(`❌ Erro ao salvar trades fechados no Supabase.`);
            }
        }
    } catch (error) {
        console.error('❌ Falha no backend ao salvar trades fechados no Supabase:', error);
    }
}

// BOT
    // Abertura de trades
    async function openTrade() {
        console.log('🔍 Iniciando verificação para abertura de trades...');
        
        // Filtra apenas triggers com status "waiting" antes do loop
        const waitingTriggers = triggers.filter(trigger => trigger.trigger_status === "waiting");
        
        if (waitingTriggers.length === 0) {
            console.log('📋 Nenhum trigger aguardando para ser executado.');
            return;
        }
        
        for (const trigger of waitingTriggers) {
            try {
                const { trigger_status, trigger_price, trigger_strategy, trigger_type, trigger_side, trigger_leverage, trigger_quantity, trigger_takeprofit, trigger_id } = trigger;

                // Dupla verificação do status (redundante mas seguro)
                if (trigger_status === "waiting" && Math.abs(btcPrice - trigger_price) <= 10) {
                    console.log(`🚀 Abrindo trade para trigger ${trigger_id} | Preço gatilho: ${trigger_price} | BTC: ${btcPrice}`);

                    // Atualiza o status ANTES de criar o trade para evitar duplicação
                    const updateStatusFirst = await fetch(`${baseUrl}/supabase/update_trigger_status/${trigger_id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            trigger_status: 'processing'
                        }),
                        signal: AbortSignal.timeout(10000)
                    });

                    if (updateStatusFirst.status !== 200) {
                        console.warn(`⚠️ Falha ao atualizar status do trigger ${trigger_id} para processing`);
                        continue;
                    }

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
                        
                        // Reverte status para "waiting" em caso de falha
                        await fetch(`${baseUrl}/supabase/update_trigger_status/${trigger_id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                trigger_status: 'waiting'
                            }),
                            signal: AbortSignal.timeout(10000)
                        });
                        continue;
                    }

                    const newTradeData = await addTradeResponse.json();
                    console.log(`✅ Trade criado com sucesso: ${trigger.trigger_price}`);

                    await addLog(addTradeResponse.status, `Trade criado com sucesso. Preço de entrada: ${btcPrice}`, 'futuresNewTrade');

                    // Atualiza para "open" com o ID do trade
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
                    
                    await getTrades();
                    await getUser();
                    await getTriggers();
                }
            } catch (err) {
                console.error(`❌ Erro ao processar trigger: ${trigger.trigger_id}`, err);
                await addLog('error', `Erro ao processar trigger ${trigger.trigger_id}`, err.message);
                
                // Reverte status para "waiting" em caso de erro
                try {
                    await fetch(`${baseUrl}/supabase/update_trigger_status/${trigger.trigger_id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            trigger_status: 'waiting',
                            trigger_ln_trade_id: null
                        }),
                        signal: AbortSignal.timeout(10000)
                    });
                } catch (revertError) {
                    console.error(`❌ Erro ao reverter status do trigger ${trigger.trigger_id}:`, revertError);
                }
            }
        }

        // Pequeno delay entre requisições para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Checagem de trades fechados para atualizar status dos triggers
    // Essa função verifica se algum trade que está "open" no Firestore foi fechado na LN, e atualiza o status do trigger para "waiting" novamente
    async function checkClosedTrades() {
        console.log('🔍 Verificando trades fechados para atualizar triggers...');
        try {
            const openTriggers = triggers.filter(trigger => trigger.trigger_status === 'open');

            let tradesToCheck = [...runningTrades, ...openTrades];

            console.log(tradesToCheck.length)
        
            if (openTriggers.length > 0) {
                for (const trigger of openTriggers) {
                    if (tradesToCheck.some(trade => trade.id === trigger.trigger_ln_trade_id)) {
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

                        await getTrades();
                        console.log(`✅ Trade ${trigger.trigger_price} foi fechado. Atualizando trigger ${trigger.trigger_id}.`);
                    }
                }

                await getUser();
                await getTriggers();
            }
        } catch (error) {
            console.error('❌ Falha no backend ao verificar trades fechados:', error.message);
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
        console.log('🔍 Iniciando verificação de proteção de margem...');
        try {
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
                        console.log(`✅ Margem adicionada com sucesso ao trade ${trade.id}`);
                        await addLog(addMarginResponse.status, `Margem adicionada com sucesso ao trade ${trade.id}`, 'futuresAddMarginTrade');

                        await getTrades();  
                    } else {
                        console.error(`❌ Falha ao adicionar margem ao trade ${trade.id}`);
                        await addLog(addMarginResponse.status, `Falha ao adicionar margem de ${marginToAdd.toFixed(0)} sats ao trade ${trade.id}. Saldo disponivel: ${user.balance} sats`, 'futuresAddMarginTrade');
                    }

                    // Pequeno delay entre requisições para evitar rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            };
        } catch (error) {
            await addLog('error', 'Falha geral no protectMargin', error.message);
            console.error('💥 Erro geral na proteção de margem:', error);
        }

        await getUser();
    }

// Sistema anti-flash-crash LNMarkets
// Em caso de múltiplas falhas de requisição, distribui o saldo disponível em adição de margem proporcionalmente entre os trades em execução
async function flashCrashProtection() {
    console.warn('⚡ Múltiplas falhas de requisição detectadas. Executando proteção contra flash crash.');
    await addLog(12, 'Múltiplas falhas de requisição detectadas. Executando proteção contra flash crash.', 'flashCrashProtection');

    try {
        let balance = 10000;
        
        if (!runningTrades || runningTrades.length === 0) {
            console.log('⚠️ Nenhum trade em execução para proteger.');
            return;
        }

        // 1. Calcular margem total de todos os trades
        const totalMargin = runningTrades.reduce((sum, trade) => sum + trade.margin, 0);
        
        console.log(`💰 Saldo disponível: ${balance} sats`);
        console.log(`📊 Margem total dos trades: ${totalMargin} sats`);
        console.log(`🔢 Número de trades: ${runningTrades.length}`);

        // 2. Distribuir saldo proporcionalmente para cada trade
        for (const trade of runningTrades) {
            try {
                // Calcula a proporção do trade em relação ao total
                const proportion = trade.margin / totalMargin;
                
                // Calcula a margem adicional proporcional
                const additionalMargin = Math.floor(balance * proportion);

                console.log(`🛡️ Trade ${trade.id}: Margem atual ${trade.margin} sats (${(proportion * 100).toFixed(1)}%) → Adicionando ${additionalMargin} sats`);

                const addMarginResponse = await fetch(`${baseUrl}/lnmarkets/add_margin/${trade.id}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        margin: Number(additionalMargin.toFixed(0))
                    }),
                    signal: AbortSignal.timeout(2000)
                });

                if (addMarginResponse.status === 200) {
                    console.log(`✅ Margem adicionada com sucesso ao trade ${trade.id}: ${additionalMargin} sats`);
                    await addLog(200, `Flash crash protection: ${additionalMargin} sats adicionados ao trade ${trade.id}`, 'flashCrashProtection');
                } else {
                    console.error(`❌ Erro ao adicionar margem ao trade ${trade.id}: ${addMarginResponse.status}`);
                    await addLog(addMarginResponse.status, `Falha ao adicionar margem de ${additionalMargin.toFixed(0)} sats ao trade ${trade.id}. Saldo disponivel: ${user.balance} sats`, 'futuresAddMarginTrade');
                }

                // Pequeno delay entre requisições para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (tradeError) {
                console.error(`❌ Erro ao processar trade ${trade.id}:`, tradeError);
                await addLog('error', `Erro na proteção flash crash do trade ${trade.id}: ${tradeError.message}`, 'flashCrashProtection');
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        await getTrades();
        await getUser();
        
        console.log('🛡️ Proteção contra flash crash concluída');
    } catch (error) {
        console.error('💥 Erro na proteção contra flash crash:', error);
        await addLog('error', `Erro geral na proteção flash crash: ${error.message}`, 'flashCrashProtection');
    }
}

// Função para adicionar logs no Supabase
async function addLog(lnStatusError, message, lnAction, backendError = null) {
    try {
        const userUid = user?.uid || null;
        
        const errorMessages = {
            12: "Running antiFlashCrashProtection",
            200: 'OK. The request was successful.',
            400: 'Bad request. Your request is invalid.',
            401: "Unauthorized. Your API key is wrong or you don't have access to the requested resource.",
            403: 'Internal server error',
            404: 'Not found.',
            405: 'Method Not Allowed. You tried to access a resource with an invalid method.',
            418: "I'm a teapot.",
            429: 'Too many requests. Your connection is being rate limited.',
            500: 'Internal server error',
            503: "Service unavailable. We're temporarily offline for maintenance. Please try again later."
        };

        const logData = {
            'log_ln_user_uid': userUid,
            'log_ln_status_error': lnStatusError,
            'log_action': lnAction,
            'log_message': message,
            'log_error': errorMessages[lnStatusError] || (backendError ? backendError.message : 'Unknown error')
        };

        await fetch(`${baseUrl}/supabase/add_log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logData)
        });
    } catch (error) {
        console.error('Erro ao adicionar log no Supabase:', error);
    }
}
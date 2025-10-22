let btcPrice;
let triggers = [];
let openTrades = [];
let currentStrategy = ''; // Padrão

let user = null;

const baseUrl = 'http://localhost:3000';

export async function initBot() {
    console.log('Iniciando bot...');
    
    try {
        setInterval(async () => {
            await getTriggers()
            await getUser();
        }, 10000);
    } catch (error) {
        console.error('Erro na inicialização do bot:', error.message);
        return;
    }
}

// Função para buscar o preço atual do BTC em USD
async function getTicker() {
    try {
        const routeResponse = await fetch(`${baseUrl}/ln/get_ticker`, {
            signal: AbortSignal.timeout(10000)
        });

        if (routeResponse.status === 200) {
            await addLog(routeResponse.status, `Ticker solicitado com sucesso`, 'futuresGetTicker');
            const ticker = await routeResponse.json();
            btcPrice = Number(ticker.lastPrice);
        } else {
            await addLog(routeResponse.status, `Falha ao solicitar ticker`, 'futuresGetTicker');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar ticker:', error);
        await addLog(1, `Falha no backend ao solicitar ticker`, null, error);
    }
}

// Função para buscar os triggers salvos por perfis no Firestore
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

// Função para buscar dados do usuário
async function getUser() {
    try {
        const routeResponse = await fetch(`${baseUrl}/lnmarkets/get_user`, {
            signal: AbortSignal.timeout(10000)
        });

        if (routeResponse.ok) {
            const userData = await routeResponse.json();
            console.log('Usuário solicitado com sucesso');
            user = userData;
            await addLog(routeResponse.status, `Usuário solicitado com sucesso`, 'getUser');
        } else {
            console.error(`Erro HTTP ${routeResponse.status}: ${routeResponse.statusText}`);
            user = null;
            await addLog(routeResponse.status, `Falha ao solicitar usuário`, 'getUser');
        }
    } catch (error) {
        console.error('Falha no backend ao solicitar usuário:', error);
        user = null;
        //await addLog(1, `Falha no backend ao solicitar usuário`, 'getUser', error);
    }
}

// BOT
    // Abertura de trades
    async function openTrade() {
        try {
            console.log('BTC Price:', btcPrice);
            console.log('Verificando triggers para abrir trades...');
            
            for (const trigger of triggers) {
                if (trigger.trigger_status === 'waiting' && Math.abs(btcPrice - trigger.trigger_price) <= 20) {
                    console.log(`Abrindo trade para trigger ${trigger.id} com preço de gatilho ${trigger.trigger_price} e preço atual do BTC ${btcPrice}`);
                    const newTrade = {
                        type: trigger.trigger_type,
                        side: trigger.trigger_side,
                        leverage: Number(trigger.trigger_leverage),
                        quantity: Number(trigger.trigger_quantity),
                        price: Number(trigger.trigger_price),
                        takeprofit: Math.round(Number(trigger.trigger_takeProfit))
                    };

                    const routeResponse = await fetch(`${baseUrl}/ln/add_trade`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(newTrade),
                        signal: AbortSignal.timeout(15000)  
                    });

                    if (routeResponse.status === 200) {
                        console.log('Trade criado com sucesso:', newTrade);
                        await addLog(routeResponse.status, `Trade criado com sucesso. Preço de entrada: ${newTrade.price}`, 'futuresNewTrade');
                        const newTradeData = await routeResponse.json();

                        const updateResponse = await fetch(`${baseUrl}/firebase/update_trigger_status/${trigger.id}`, {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                trigger_status: 'open',
                                ln_trade_id: newTradeData.id
                            }),
                            signal: AbortSignal.timeout(10000)
                        });
                        console.log(await updateResponse.json());
                    } else {
                        await addLog(routeResponse.status, `Falha ao criar trade`, 'futuresNewTrade');
                    }
                    console.log(`Trade criado para trigger ${trigger.id}`);
                }
            }

            await getTriggers();
        } catch (error) {
            console.error('Falha no backend ao adicionar trades:', error);
            await addLog(`Falha no backend ao adicionar trades`, null, error);
        }
    }

    // Checagem de trades fechados para atualizar status dos triggers
    // Essa função verifica se algum trade que está "open" no Firestore foi fechado na LN, e atualiza o status do trigger para "waiting" novamente
    async function checkClosedTrades() {
        try {
            const openTriggers = triggers.filter(trigger => trigger.trigger_status === 'open');
            
            if (openTriggers.length > 0) {
                const routeResponse = await fetch(`${baseUrl}/lnmarkets/get_trades?type=closed`, {
                    signal: AbortSignal.timeout(10000)
                });

                if (routeResponse.status === 200) {
                    console.log('Trades fechados buscados com sucesso.');
                    await addLog(routeResponse.status, `Sucesso ao solicitar trades fechados`, 'futuresGetTrades');
                    openTrades = await routeResponse.json();
                    for (const trigger of openTriggers) {
                        if (openTrades.some(trade => trade.id === trigger.ln_trade_id)) {
                            await fetch(`${baseUrl}/firebase/update_trigger_status/${trigger.id}`, {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    trigger_status: 'waiting',
                                    ln_trade_id: ''
                                }),
                                signal: AbortSignal.timeout(10000)
                            });

                            console.log(`Trade ${trigger.ln_trade_id} foi fechado. Atualizando trigger ${trigger.id}.`);
                        }
                    }
                    await getTriggers();
                } else {
                    await addLog(routeResponse.status, `Falha ao solicitar trades fechados`, 'futuresGetTrades');
                }
            };
        } catch (error) {
            console.error('Falha no backend ao verificar trades fechados:', error.message);
            await addLog(1, `Falha no backend ao verificar trades fechados`, null, error);
        }
    }

    // Atualização de TakeProfit para cobrir taxas de funding cost
    async function updateTakeProfit() {
        try {
            const response = await fetch(`${baseUrl}/ln/get_trades?type=closed`, {
                signal: AbortSignal.timeout(15000)
            });

            if (response.status !== 200) {
                log = 'Log da função takeProfitStrategy. Erro ao buscar trades abertos.';
                console.error('Erro ao buscar trades abertos:', response.status);
                return;
            }

            openTrades = await response.json();
            
/*             for (const openTrade of openTrades) {
                if (openTrade.takeprofit != 0 && openTrade.sum_carry_fees >= 0) {
                    const fundingCostUsd = ((openTrade.sum_carry_fees / 1e8) * btcPrice).toFixed(2);
                    const feesPercentageToQuantity = ((fundingCostUsd / openTrade.quantity) * 100).toFixed(2);
                    const newTakeProfit = Number(openTrade.takeprofit + ((feesPercentageToQuantity / 100) * openTrade.takeprofit)).toFixed(0);

                    if (!(Math.abs(newTakeProfit - openTrade.takeprofit) < 0.1) || openTrade.takeprofit == newTakeProfit) {
                        const updateResponse = await fetch(`${baseUrl}/ln/update_takeprofit/${openTrade.id}`, {
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
            } */
        } catch (error) {
            return;
        }

/*         try {
            for (const trigger of triggers) {
                if (trigger.strategy === 'takeProfit') {
                    const response = await fetch(`${baseUrl}/ln/get_trades?type=running`, {
                        signal: AbortSignal.timeout(15000)
                    });

                    if (response.status !== 200) {
                        log = 'Função takeProfitStrategy executada. Erro ao buscar trades abertos.';
                        console.error('Erro ao buscar trades abertos:', response.status);
                        return;
                    }

                    openTrades = await response.json();
                    
                    if (openTrades.length > 0) {
                        for (const openTrade of openTrades) {
                            const fundingCost = openTrade.sum_carry_fees;
                            const takeprofit = openTrade.takeprofit;

                            if (fundingCost >= 0 && takeprofit !== 0) {
                                const fundingCostUsd = fundingCost / 1e8 * btcPrice;
                                const initialTakeProfit = openTrade.price * 1.007;
                                const newTakeProfit = initialTakeProfit + (fundingCostUsd / openTrade.quantity) * initialTakeProfit;

                                if (!Math.abs(newTakeProfit - openTrade.takeprofit) < 0.1 || takeprofit == newTakeProfit) {
                                    await fetch(`${baseUrl}/ln/update_takeprofit/${openTrade.id}`, {
                                        method: 'PUT',
                                        headers: {
                                            'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                            newTakeProfit: Number(newTakeProfit.toFixed(0))
                                        }),
                                        signal: AbortSignal.timeout(15000)
                                    });
                                }
                            }
                        }
                        log = 'Log da função takeProfitStrategy. TakeProfit atualizado para todos os trades abertos.';
                    } else {
                        log = 'Log da função takeProfitStrategy. Nenhum trade aberto encontrado.';
                    }
                }
            };
        } catch (error) {
            log = `Log da função takeProfitStrategy. Erro na execução da função. ${error.message}`;
            return;
        } */

        console.log(log);
    }
    
/*     async function stopGainStrategy() {
        console.log('Executando função stopGainStrategy...');
        let log = '';
    } */
// Proteção de margem
/* async function protectMargin() {
    const res = await fetch(`http://localhost:3000/ln/get_trades?type=running`);
    const trades = await res.json();

    trades.forEach(async trade => {
        // Se o preço do BTC estiver a 4000 dólares do preço de liquidação, adicionar 10000 sats de margem
        if (Math.abs(btcPrice - trade.liquidation) <= 2000) {
            console.log(`BTC está a 4000 dólares do preço de liquidação do trade ${trade.id}. Adicionando 10000 sats de margem.`);
            const response = await fetch(`http://localhost:3000/ln/add_margin/${trade.id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    margin: 5000
                })
            });

            console.log(`Resposta da adição de margem para o trade ${trade.id}:`, response);
        }
    });
} */

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
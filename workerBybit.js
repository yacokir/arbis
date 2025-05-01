const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');

const { codigosDePar } = workerData;
const constSeparadorParaFormarPar = "";
const par = codigosDePar[0] + constSeparadorParaFormarPar + codigosDePar[1];

const bybitWsUrl = 'wss://stream.bybit.com/v5/public/spot';
const pingInterval = 20000;

function formatTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function connectBybitWebSocket() {
  const ws = new WebSocket(bybitWsUrl);

  ws.on('open', () => {
    console.log(`[Worker Bybit] Conectado ao WebSocket para ${par}`);
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`orderbook.1.${par}`],
    }));

    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, pingInterval);
  });

  let lastBid = null;
  let lastBidAmount = null;
  let lastAsk = null;
  let lastAskAmount = null;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      const bid = data.data?.b?.[0] || null;
      const ask = data.data?.a?.[0] || null;
      const currentTime = formatTime(new Date());

      if (bid || ask) {
        const bidPrice = bid ? bid[0] : null;
        const bidAmount = bid ? bid[1] : null;
        const askPrice = ask ? ask[0] : null;
        const askAmount = ask ? ask[1] : null;

        if (bidPrice && (bidPrice !== lastBid || bidAmount !== lastBidAmount)) {
          parentPort.postMessage({ 
            exchange: 'Bybit', 
            par, 
            bid: bidPrice, 
            bidAmount: bidAmount, 
            bidTime: currentTime 
          });
          lastBid = bidPrice;
          lastBidAmount = bidAmount;
        }

        if (askPrice && (askPrice !== lastAsk || askAmount !== lastAskAmount)) {
          parentPort.postMessage({ 
            exchange: 'Bybit', 
            par, 
            ask: askPrice, 
            askAmount: askAmount, 
            askTime: currentTime 
          });
          lastAsk = askPrice;
          lastAskAmount = askAmount;
        }
      }
    } catch (err) {
      console.error(`[Worker Bybit] Erro ao processar dados para ${par}:`, err);
    }
  });

  ws.on('error', (err) => console.error(`[Worker Bybit] Erro no WebSocket para ${par}:`, err));
  ws.on('close', () => {
    console.log(`[Worker Bybit] WebSocket desconectado para ${par}. Tentando reconectar...`);
    clearInterval(pingInterval);
    setTimeout(connectBybitWebSocket, 5000);
  });
}

connectBybitWebSocket();
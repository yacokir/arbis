const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');

const { codigosDePar } = workerData;
const constSeparadorParaFormarPar = "-";
const par = codigosDePar[0] + constSeparadorParaFormarPar + codigosDePar[1];

const okxWsUrl = 'wss://ws.okx.com:8443/ws/v5/public';
const pingInterval = 20000;

function formatTime(ts) {
  const date = new Date(parseInt(ts));
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function connectOKXWebSocket() {
  const ws = new WebSocket(okxWsUrl);

  ws.on('open', () => {
    console.log(`[Worker OKX] Conectado ao WebSocket para ${par}`);
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [{ channel: 'bbo-tbt', instId: par }]
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
      if (data.data && data.data[0]) {
        const bidPrice = data.data[0].bids && data.data[0].bids[0] ? data.data[0].bids[0][0] : null;
        const bidAmount = data.data[0].bids && data.data[0].bids[0] ? data.data[0].bids[0][1] : null;
        const askPrice = data.data[0].asks && data.data[0].asks[0] ? data.data[0].asks[0][0] : null;
        const askAmount = data.data[0].asks && data.data[0].asks[0] ? data.data[0].asks[0][1] : null;
        const currentTime = formatTime(data.data[0].ts);

        if (bidPrice && (bidPrice !== lastBid || bidAmount !== lastBidAmount)) {
          parentPort.postMessage({ 
            exchange: 'OKX', 
            par: codigosDePar[0] + codigosDePar[1], 
            bid: bidPrice, 
            bidAmount: bidAmount, 
            bidTime: currentTime 
          });
          lastBid = bidPrice;
          lastBidAmount = bidAmount;
        }
        if (askPrice && (askPrice !== lastAsk || askAmount !== lastAskAmount)) {
          parentPort.postMessage({ 
            exchange: 'OKX', 
            par: codigosDePar[0] + codigosDePar[1], 
            ask: askPrice, 
            askAmount: askAmount, 
            askTime: currentTime 
          });
          lastAsk = askPrice;
          lastAskAmount = askAmount;
        }
      }
    } catch (err) {
      console.error(`[Worker OKX] Erro ao processar dados para ${par}:`, err);
    }
  });

  ws.on('error', (err) => console.error(`[Worker OKX] Erro no WebSocket para ${par}:`, err));
  ws.on('close', () => {
    console.log(`[Worker OKX] WebSocket desconectado para ${par}. Tentando reconectar...`);
    clearInterval(pingInterval);
    setTimeout(connectOKXWebSocket, 5000);
  });
}

connectOKXWebSocket();
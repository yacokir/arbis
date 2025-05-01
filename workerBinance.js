/*const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');

const { codigosDePar } = workerData;
const constSeparadorParaFormarPar = "";
const par = codigosDePar[0] + constSeparadorParaFormarPar + codigosDePar[1];

const binanceWsUrl = 'wss://stream.binance.com:9443/ws';
const pingInterval = 20000;

function formatTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function connectBinanceWebSocket() {
  const ws = new WebSocket(binanceWsUrl);

  ws.on('open', () => {
    console.log(`[Worker Binance] Conectado ao WebSocket para ${par}`);
    ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: [`${par.toLowerCase()}@bookTicker`], // bookTicker dá bid/ask em tempo real
      id: 1
    }));

    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: Date.now() }));
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
      if (data.s && data.b && data.a) { // Checa se é um update do bookTicker
        const bidPrice = data.b || null;
        const bidAmount = data.B || null;
        const askPrice = data.a || null;
        const askAmount = data.A || null;
        const currentTime = formatTime(new Date());

        if (bidPrice && (bidPrice !== lastBid || bidAmount !== lastBidAmount)) {
          parentPort.postMessage({ 
            exchange: 'Binance', 
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
            exchange: 'Binance', 
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
      console.error(`[Worker Binance] Erro ao processar dados para ${par}:`, err);
    }
  });

  ws.on('error', (err) => console.error(`[Worker Binance] Erro no WebSocket para ${par}:`, err));
  ws.on('close', () => {
    console.log(`[Worker Binance] WebSocket desconectado para ${par}. Tentando reconectar...`);
    clearInterval(pingInterval);
    setTimeout(connectBinanceWebSocket, 5000);
  });
}

connectBinanceWebSocket();
*/
const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');

const { codigosDePar } = workerData;
const constSeparadorParaFormarPar = "";
const par = codigosDePar[0] + constSeparadorParaFormarPar + codigosDePar[1];

const binanceWsUrl = 'wss://stream.binance.com:9443/ws';

function formatTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function connectBinanceWebSocket() {
  const ws = new WebSocket(binanceWsUrl);

  ws.on('open', () => {
    console.log(`[Worker Binance] Conectado ao WebSocket para ${par} às ${formatTime(new Date())}`);
    ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: [`${par.toLowerCase()}@bookTicker`],
      id: 1
    }));
  });

  ws.on('ping', () => {
    // Removido o console.log para pings nativos
  });

  let lastBid = null;
  let lastBidAmount = null;
  let lastAsk = null;
  let lastAskAmount = null;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.s && data.b && data.a) {
        const bidPrice = data.b || null;
        const bidAmount = data.B || null;
        const askPrice = data.a || null;
        const askAmount = data.A || null;
        const currentTime = formatTime(new Date());

        if (bidPrice && (bidPrice !== lastBid || bidAmount !== lastBidAmount)) {
          parentPort.postMessage({ 
            exchange: 'Binance', 
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
            exchange: 'Binance', 
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
      console.error(`[Worker Binance] Erro ao processar dados para ${par} às ${formatTime(new Date())}:`, err);
    }
  });

  ws.on('error', (err) => {
    console.error(`[Worker Binance] Erro no WebSocket para ${par} às ${formatTime(new Date())}:`, err);
  });

  ws.on('close', (code, reason) => {
    console.log(`[Worker Binance] WebSocket desconectado para ${par} às ${formatTime(new Date())}. Código: ${code}, Motivo: ${reason || 'Nenhum motivo fornecido'}. Tentando reconectar...`);
    setTimeout(connectBinanceWebSocket, 1000);
  });
}

connectBinanceWebSocket();
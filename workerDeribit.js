const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');

const { codigosDePar } = workerData;
const constSeparadorParaFormarPar = "_";
const par = codigosDePar[0] + constSeparadorParaFormarPar + codigosDePar[1];
const parFormatado = codigosDePar[0] + codigosDePar[1];

const deribitWsUrl = 'wss://www.deribit.com/ws/api/v2';

function formatTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function connectDeribitWebSocket() {
  const ws = new WebSocket(deribitWsUrl);

  ws.on('open', () => {
    console.log(`[Worker Deribit] Conectado ao WebSocket para ${par}`);
    const subscribeMessage = {
      jsonrpc: '2.0',
      method: 'public/subscribe',
      params: { channels: [`book.${par}.none.10.100ms`] },
      id: 1,
    };
    ws.send(JSON.stringify(subscribeMessage));
  });

  let lastBid = null;
  let lastBidAmount = null;
  let lastAsk = null;
  let lastAskAmount = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.result && Array.isArray(message.result)) {
        console.log(`[Worker Deribit] Inscrição confirmada para ${par}`);
        return;
      }

      if (message.params && message.params.channel === `book.${par}.none.10.100ms`) {
        const orderBook = message.params.data;
        const bid = orderBook.bids.length > 0 ? orderBook.bids[0][0] : null;
        const bidAmount = orderBook.bids.length > 0 ? orderBook.bids[0][1] : null;
        const ask = orderBook.asks.length > 0 ? orderBook.asks[0][0] : null;
        const askAmount = orderBook.asks.length > 0 ? orderBook.asks[0][1] : null;
        const currentTime = formatTime(new Date());

        if (bid !== null && (bid !== lastBid || bidAmount !== lastBidAmount)) {
          parentPort.postMessage({ exchange: 'Deribit', par: parFormatado, bid, bidAmount, bidTime: currentTime });
          lastBid = bid;
          lastBidAmount = bidAmount;
        }
        if (ask !== null && (ask !== lastAsk || askAmount !== lastAskAmount)) {
          parentPort.postMessage({ exchange: 'Deribit', par: parFormatado, ask, askAmount, askTime: currentTime });
          lastAsk = ask;
          lastAskAmount = askAmount;
        }
      }
    } catch (err) {
      console.error(`[Worker Deribit] Erro ao processar dados para ${par}:`, err);
      process.exit(1); // Sai se o par não for suportado ou houver erro grave
    }
  });

  ws.on('error', (err) => console.error(`[Worker Deribit] Erro no WebSocket para ${par}:`, err));
  ws.on('close', () => {
    console.log(`[Worker Deribit] WebSocket desconectado para ${par}. Tentando reconectar...`);
    setTimeout(connectDeribitWebSocket, 5000);
  });
}

connectDeribitWebSocket();
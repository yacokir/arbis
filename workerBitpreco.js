/*const { Socket } = require('phoenix-channels');
const { parentPort, workerData } = require('worker_threads');

const { codigosDePar } = workerData;
const par = codigosDePar[0] + "-" + codigosDePar[1];
const parFormatado = codigosDePar[0] + codigosDePar[1];
const SOCKET_URL = 'wss://websocket.bitpreco.com';
const pingInterval = 5000;

function formatTime(utimestamp) {
  // O utimestamp vem como "2025-02-27 13:14:33.672618"
  // Vamos pegar até os milissegundos (ignorar microsegundos por enquanto)
  const [datePart, timePart] = utimestamp.split(' ');
  const [seconds, millis] = timePart.split('.');
  const millisFormatted = millis.slice(0, 3).padStart(3, '0'); // Pega só os 3 primeiros dígitos (ms)
  return `${datePart} ${seconds}.${millisFormatted}`;
}

function connectBitprecoSocket() {
  const socket = new Socket(`${SOCKET_URL}/orderbook/socket`);
  socket.connect();

  const channel = socket.channel(`orderbook:${par}`, {});

  channel.join()
    .receive('ok', () => console.log(`[Worker bitpreco] Conectado ao tópico orderbook:${par}`))
    .receive('error', () => {
      console.error(`[Worker bitpreco] Erro ao conectar ao tópico ${par}. Par não suportado?`);
      process.exit(1);
    });

  let lastBidPrice = null;
  let lastBidAmount = null;
  let lastAskPrice = null;
  let lastAskAmount = null;

  channel.on('snapshot', (payload) => processOrderbookUpdate(payload));
  channel.on('update', (payload) => processOrderbookUpdate(payload));

  function processOrderbookUpdate(payload) {
    const bestBid = payload.bids && payload.bids[0];
    const bestAsk = payload.asks && payload.asks[0];
    const currentTime = formatTime(payload.utimestamp); // Usa o utimestamp do payload

    if (bestBid && bestAsk) {
      const bidPrice = bestBid.price;
      const bidAmount = bestBid.amount;
      const askPrice = bestAsk.price;
      const askAmount = bestAsk.amount;

      if (bidPrice !== lastBidPrice || bidAmount !== lastBidAmount) {
        parentPort.postMessage({ 
          exchange: 'bitpreco', 
          par: parFormatado, 
          bid: bidPrice, 
          bidAmount: bidAmount, 
          bidTime: currentTime 
        });
        lastBidPrice = bidPrice;
        lastBidAmount = bidAmount;
      }
      if (askPrice !== lastAskPrice || askAmount !== lastAskAmount) {
        parentPort.postMessage({ 
          exchange: 'bitpreco', 
          par: parFormatado, 
          ask: askPrice, 
          askAmount: askAmount, 
          askTime: currentTime 
        });
        lastAskPrice = askPrice;
        lastAskAmount = askAmount;
      }
    }
  }

  setInterval(() => {
    if (socket.isConnected()) {
      channel.push('ping', {})
        .receive('ok', () => console.log(`[Worker bitpreco] Ping enviado e confirmado para ${par}`))
        .receive('error', () => console.error(`[Worker bitpreco] Erro no ping para ${par}`));
    }
  }, pingInterval);

  socket.onClose(() => {
    console.log(`[Worker bitpreco] WebSocket desconectado para ${par}. Tentando reconectar...`);
    setTimeout(connectBitprecoSocket, 1000);
  });
  socket.onError((error) => console.error(`[Worker bitpreco] Erro no WebSocket para ${par}:`, error));
}

connectBitprecoSocket();
*/

const { Socket } = require('phoenix-channels');
const { parentPort, workerData } = require('worker_threads');

const { codigosDePar } = workerData;
const par = codigosDePar[0] + "-" + codigosDePar[1];
const parFormatado = codigosDePar[0] + codigosDePar[1];
const SOCKET_URL = 'wss://websocket.bitpreco.com';

function formatTime(utimestamp) {
  // O utimestamp vem como "2025-02-27 13:14:33.672618"
  // Pega até os milissegundos (ignora microsegundos)
  const [datePart, timePart] = utimestamp.split(' ');
  const [seconds, millis] = timePart.split('.');
  const millisFormatted = millis.slice(0, 3).padStart(3, '0');
  return `${datePart} ${seconds}.${millisFormatted}`;
}

function connectBitprecoSocket() {
  const socket = new Socket(`${SOCKET_URL}/orderbook/socket`, { timeout: 60000 }); // Timeout de 60s pra maior estabilidade

  socket.onOpen(() => {
    console.log(`[Worker bitpreco] Conexão WebSocket estabelecida às ${new Date().toISOString()}`);
  });

  socket.connect();

  const channel = socket.channel(`orderbook:${par}`, {});

  channel.join()
    .receive('ok', () => console.log(`[Worker bitpreco] Conectado ao tópico orderbook:${par} às ${new Date().toISOString()}`))
    .receive('error', () => {
      console.error(`[Worker bitpreco] Erro ao conectar ao tópico ${par} às ${new Date().toISOString()}. Par não suportado?`);
      process.exit(1);
    });

  let lastBidPrice = null;
  let lastBidAmount = null;
  let lastAskPrice = null;
  let lastAskAmount = null;

  channel.on('snapshot', (payload) => processOrderbookUpdate(payload));
  channel.on('update', (payload) => processOrderbookUpdate(payload));

  function processOrderbookUpdate(payload) {
    const bestBid = payload.bids && payload.bids[0];
    const bestAsk = payload.asks && payload.asks[0];
    const currentTime = formatTime(payload.utimestamp); // Usa o utimestamp do payload

    if (bestBid && bestAsk) {
      const bidPrice = bestBid.price;
      const bidAmount = bestBid.amount;
      const askPrice = bestAsk.price;
      const askAmount = bestAsk.amount;

      if (bidPrice !== lastBidPrice || bidAmount !== lastBidAmount) {
        parentPort.postMessage({ 
          exchange: 'bitpreco', 
          par: parFormatado, 
          bid: bidPrice, 
          bidAmount: bidAmount, 
          bidTime: currentTime 
        });
        lastBidPrice = bidPrice;
        lastBidAmount = bidAmount;
      }
      if (askPrice !== lastAskPrice || askAmount !== lastAskAmount) {
        parentPort.postMessage({ 
          exchange: 'bitpreco', 
          par: parFormatado, 
          ask: askPrice, 
          askAmount: askAmount, 
          askTime: currentTime 
        });
        lastAskPrice = askPrice;
        lastAskAmount = askAmount;
      }
    }
  }

  socket.onClose(() => {
    console.log(`[Worker bitpreco] WebSocket desconectado para ${par} às ${new Date().toISOString()}. Tentando reconectar...`);
    setTimeout(connectBitprecoSocket, 1000); // Reconecta em 1 segundo
  });

  socket.onError((error) => console.error(`[Worker bitpreco] Erro no WebSocket para ${par} às ${new Date().toISOString()}:`, error));
}

connectBitprecoSocket();

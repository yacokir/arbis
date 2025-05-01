"use strict";
const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');
const crypto = require('crypto');

// Cores ANSI para logs
const GREEN = '\x1b[32m';
const BROWN = '\x1b[33m';
const RESET = '\x1b[0m';

// Credenciais da Binance
const { apiKey, apiSecret } = workerData;

// Validação das credenciais
if (!apiKey || !apiSecret) {
  console.error('[workerExecBinance] Erro: Credenciais incompletas no workerData:', workerData);
  throw new Error('Credenciais da Binance não fornecidas corretamente');
}

// Função para formatar objetos nos logs
function formatObject(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)": "([^"]+)"/g, `"$1": ${GREEN}"$2"${RESET}`)
    .replace(/"([^"]+)": (\d+(.\d+)?)/g, `"$1": ${BROWN}$2${RESET}`)
    .replace(/"([^"]+)": null/g, `"$1": null`);
}

// Função para assinar a mensagem com Ed25519
async function signMessage(message) {
  const secretBuffer = Buffer.from(apiSecret, 'base64');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    secretBuffer,
    { name: 'Ed25519' },
    false,
    ['sign']
  );
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    encoder.encode(message)
  );
  return Buffer.from(signature).toString('base64');
}

// Função de log com timestamps
let t0;
function logMessage(channel, message) {
  const abs = Date.now();
  const t = t0 ? abs - t0 : 0;
  console.log(`[workerExecBinance - ${channel}] [abs=${abs} t=${t}] ${message}`);
}

let ws;
let portToCoord;

// Mapeamento da ordem para o formato da Binance
function mapOrderToBinance(order) {
  const orderParams = {
    symbol: order.symbol,
    side: order.side.toUpperCase(),
    type: order.type.toUpperCase(),
    quantity: order.amount
  };
  if (order.type.toLowerCase() !== 'market' && order.price != null) {
    orderParams.price = order.price;
  }
  if (order.type.toLowerCase() === 'market') {
    if (order.timeInForce != null) {
      orderParams.timeInForce = order.timeInForce;
    }
  } else {
    orderParams.timeInForce = order.timeInForce != null ? order.timeInForce : 'GTC';
  }
  return orderParams;
}

// Conecta ao WebSocket da Binance
async function connectBinanceWebSocket() {
  ws = new WebSocket('wss://ws-api.binance.com:443/ws-api/v3');

  ws.on('open', async () => {
    logMessage('Conexão', 'Conectado ao WebSocket trade API da Binance.');
    const timestamp = Date.now();
    const params = `apiKey=${apiKey}&timestamp=${timestamp}`;
    const signature = await signMessage(params);

    const authRequest = {
      id: 1,
      method: 'session.logon',
      params: {
        apiKey: apiKey,
        timestamp: timestamp,
        signature: signature
      }
    };

    ws.send(JSON.stringify(authRequest));
  });

  ws.on('ping', (data) => {
    logMessage('Conexão', `Recebido ping do servidor: ${data}`);
    ws.pong(data);
    logMessage('Conexão', `Enviado pong para o servidor: ${data}`);
  });

  ws.on('pong', (data) => {
    // logMessage('Conexão', `Recebido pong do servidor: ${data}`);
    if (!portToCoord.sentConexoesProntas) {
      portToCoord.sentConexoesProntas = true;
      portToCoord.postMessage({ type: 'conexoesProntas' });
    // logMessage('Conexão', 'Conexão confirmada, enviando conexoesProntas ao coordenador.');
    }
  });

  ws.on('message', (data) => {
    //logMessage('WebSocket', `Mensagem bruta recebida: ${data}`);
    let msg;
    try {
      msg = JSON.parse(data);
      // logMessage('Geral', `Mensagem parseada:\n${formatObject(msg)}`);
      logMessage('Geral', `Resultado Conexao: ${msg.status}`);
    } catch (e) {
      logMessage('Erro', `Erro ao parsear mensagem: ${e.message}`);
      portToCoord.postMessage({ type: 'error', message: `Erro ao parsear mensagem: ${e.message}` });
      return;
    }

    if (msg.id === 1 && msg.status === 200) {
      // logMessage('Conexão', 'Autenticado com sucesso.');
      ws.ping('initial-ping');
      // logMessage('Conexão', 'Enviado ping inicial: initial-ping');
    }

    if (msg.id === 2) {
      const abs = Date.now();
      const t = t0 ? abs - t0 : 0;
      if (msg.status !== 200) {
        // logMessage('Postagem', `Ordem ** rejected **. Erro: ${msg.error.code} - ${msg.error.msg}`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Postagem',
          orderId: currentOrderId || 'unknown',
          status: 'rejected',
          symbol: 'unknown',
          errorCode: msg.error.code,
          errorMsg: msg.error.msg,
          abs,
          t
        });
      } else if (msg.status === 200) {
        logMessage('Postagem', `Ordem aceita: ${msg.result.orderId}`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Postagem',
          orderId: currentOrderId || 'unknown',
          status: 'accepted',
          symbol: msg.result.symbol,
          abs,
          t
        });

        const status = msg.result.status.toUpperCase();
        let mappedStatus = status === 'FILLED' ? 'filled' :
                          status === 'NEW' ? 'live' :
                          status === 'EXPIRED' ? 'cancelled' : status.toLowerCase();
        logMessage('Ordens', `Status da ordem: ** ${mappedStatus} **`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Ordens',
          orderId: currentOrderId || 'unknown',
          status: mappedStatus,
          symbol: msg.result.symbol,
          avgPx: msg.result.executedQty ? (parseFloat(msg.result.cummulativeQuoteQty) / parseFloat(msg.result.executedQty)).toFixed(2) : null,
          fillSz: msg.result.executedQty || null,
          cancelSource: mappedStatus === 'cancelled' ? 'expired' : null,
          abs,
          t
        });
      }
    }
  });

  ws.on('error', (err) => {
    logMessage('Erro', `Erro no WebSocket: ${err.message}`);
    portToCoord.postMessage({ type: 'error', message: `Erro no WebSocket: ${err.message}` });
  });

  ws.on('close', () => {
    logMessage('Conexão', 'WebSocket desconectado. Tentando reconectar em 5s...');
    setTimeout(connectBinanceWebSocket, 5000);
  });
}

// Variável para armazenar o orderId atual
let currentOrderId;

// Inicialização e recebimento de ordens
parentPort.on('message', (msg) => {
  if (msg.type === 'init') {
    portToCoord = msg.port;
    portToCoord.sentConexoesProntas = false;
    logMessage('Geral', 'Inicializando workerExecBinance.');
    t0 = Date.now();
    connectBinanceWebSocket();
    
    portToCoord.on('message', (portMsg) => {
      // logMessage('Debug', `Mensagem recebida em portToCoord: ${JSON.stringify(portMsg)}`);
      if (portMsg.type === 'executeOrder') {
        try {
          currentOrderId = portMsg.orderId;
          t0 = portMsg.t0 || Date.now();
          // logMessage('Geral', `Recebida ordem (orderId: ${portMsg.orderId}):\n${formatObject(portMsg.order)}`);

          const timestamp = Date.now();
          const mappedOrder = mapOrderToBinance(portMsg.order);
          const orderRequest = {
            id: 2,
            method: 'order.place',
            params: {
              ...mappedOrder,
              timestamp: timestamp
            }
          };

          logMessage('Postagem', `Enviando ordem:\n${formatObject(orderRequest)}`);
          ws.send(JSON.stringify(orderRequest));
        } catch (error) {
          logMessage('Erro', `Erro ao processar executeOrder: ${error.message}`);
          portToCoord.postMessage({ type: 'error', message: `Erro ao processar executeOrder: ${error.message}` });
        }
      } else {
        logMessage('Debug', `Mensagem inesperada em portToCoord: ${JSON.stringify(portMsg)}`);
      }
    });
  } else {
    logMessage('Debug', `Mensagem inesperada recebida no parentPort: ${JSON.stringify(msg)}`);
  }
});
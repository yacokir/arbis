"use strict";
const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');
const crypto = require('crypto');

// Cores ANSI para logs
const GREEN = '\x1b[32m';
const BROWN = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// Credenciais da Bybit
const { bybitApiKey, bybitApiSecret } = workerData;

// Validação das credenciais
if (!bybitApiKey || !bybitApiSecret) {
  console.error('[workerExecBybit] Erro: Credenciais incompletas no workerData:', workerData);
  throw new Error('Credenciais da Bybit não fornecidas corretamente');
}

// Mapa para correlacionar IDs
const orderIdMap = new Map();

// Contador para numerar mensagens do WebSocket de ordens
let orderMessageCounter = 0;

// Configuração da Bybit
const exchanges = {
  Bybit: {
    tradeWsUrl: 'wss://stream.bybit.com/v5/trade',
    orderWsUrl: 'wss://stream.bybit.com/v5/private',
    formatOrder: (order) => {
      const now = new Date();
      const hhmmssSSS = now.toISOString().slice(11, 23).replace(/[:.]/g, '');
      const timestamp = Date.now().toString();
      let orderType;
      if (order.type === 'limit' && order.timeInForce?.toLowerCase() === 'ioc') {
        orderType = 'Limit';
      } else if (order.type === 'limit' && !order.timeInForce) {
        orderType = 'Limit';
      } else if (order.type === 'market' && !order.timeInForce) {
        orderType = 'Market';
      } else {
        throw new Error(`Tipo inválido: ${order.type}/${order.timeInForce}`);
      }
      const params = {
        category: 'spot',
        symbol: order.symbol,
        side: order.side.charAt(0).toUpperCase() + order.side.slice(1).toLowerCase(),
        orderType,
        isLeverage: '1',
        qty: order.amount,
        timestamp,
      };
      if (orderType === 'Limit') {
        params.price = order.price;
        if (order.timeInForce?.toLowerCase() === 'ioc') {
          params.timeInForce = 'IOC';
        }
      }
      return {
        id: `ORD${hhmmssSSS}`,
        header: {
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-RECV-WINDOW": "2000"
        },
        op: 'order.create',
        args: [params],
      };
    },
    parseStatus: (msg, channel) => {
      if (channel === 'trade') {
        return msg.retCode === 0 ? 'accepted' : 'rejected';
      } else if (channel === 'orders') {
        return msg.orderStatus === 'Filled' ? 'filled' :
               msg.orderStatus === 'Cancelled' ? 'cancelled' :
               msg.orderStatus === 'New' ? 'live' : 'unknown';
      }
    },
  },
};

// Função para formatar objetos nos logs
function formatObject(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)": "([^"]+)"/g, `"$1": ${GREEN}"$2"${RESET}`)
    .replace(/"([^"]+)": (\d+(.\d+)?)/g, `"$1": ${BROWN}$2${RESET}`)
    .replace(/"([^"]+)": null/g, `"$1": null`);
}

// Função de log com timestamps
let t0;
function logMessage(channel, message) {
  const abs = Date.now();
  const t = t0 ? abs - t0 : 0;
  console.log(`[workerExecBybit - ${channel}] [abs=${abs} t=${t}] ${message}`);
}

// Gera assinatura HMAC-SHA256 para autenticação do WebSocket
function generateBybitSignature(expires) {
  const prehashString = `GET/realtime${expires}`;
  return crypto.createHmac('sha256', bybitApiSecret).update(prehashString).digest('hex');
}

let tradeWs;
let orderWs;
let portToCoord;

function startPingIntervalTrade() {
  return setInterval(() => {
    if (tradeWs && tradeWs.readyState === WebSocket.OPEN) {
      tradeWs.ping();
      logMessage('Ping', 'Enviado ping ao Trade WebSocket Bybit.');
    }
  }, 20000);
}

function startPingIntervalOrder() {
  return setInterval(() => {
    if (orderWs && orderWs.readyState === WebSocket.OPEN) {
      orderWs.ping();
      logMessage('Ping', 'Enviado ping ao Order WebSocket Bybit.');
    }
  }, 20000);
}

function clearPingIntervalTrade(intervalId) {
  clearInterval(intervalId);
  logMessage('Ping', 'Intervalo de ping do Trade WebSocket Bybit encerrado.');
}

function clearPingIntervalOrder(intervalId) {
  clearInterval(intervalId);
  logMessage('Ping', 'Intervalo de ping do Order WebSocket Bybit encerrado.');
}

function connectTradeWebSocket() {
  tradeWs = new WebSocket(exchanges.Bybit.tradeWsUrl);
  const pingIntervalTrade = startPingIntervalTrade();
  tradeWs.on('open', () => {
    logMessage('Conexão', 'Conectado ao Trade WebSocket da Bybit.');
    const expires = (Date.now() + 10000).toString();
    const signature = generateBybitSignature(expires);
    tradeWs.send(JSON.stringify({
      op: 'auth',
      args: [bybitApiKey, expires, signature],
    }));
    logMessage('Conexão', `Enviada solicitação de autenticação (Trade):\n${formatObject({ op: 'auth', args: [bybitApiKey, expires, signature] })}`);
  });
  tradeWs.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
      logMessage('Debug', `Mensagem parseada (Trade):\n${formatObject(msg)}`);
    } catch (e) {
      logMessage('Erro', `Erro ao parsear mensagem (Trade): ${e.message}`);
      portToCoord.postMessage({ type: 'error', message: `Erro ao parsear mensagem (Trade): ${e.message}` });
      return;
    }
    if (msg.op === 'order.create') {
      const abs = Date.now();
      const t = t0 ? abs - t0 : 0;
      const status = exchanges.Bybit.parseStatus(msg, 'trade');
      const sentOrder = [...orderIdMap.entries()].find(([_, id]) => id.startsWith('ORD'));
      const clientOrderId = sentOrder ? sentOrder[0] : null;
      if (msg.retCode === 0 && msg.data?.orderId) {
        if (clientOrderId) {
          orderIdMap.set(clientOrderId, msg.data.orderId);
          logMessage('Postagem', `Postagem: ${status} para ${msg.data.orderId} (clientOrderId: ${clientOrderId})`);
          portToCoord.postMessage({
            type: 'orderStatus',
            channel: 'Postagem',
            orderId: clientOrderId,
            status,
            instId: msg.data.symbol,
            abs,
            t,
          });
        } else {
          logMessage('Postagem', `Erro: Nenhum clientOrderId encontrado para atualizar com orderId: ${msg.data.orderId}`);
          portToCoord.postMessage({ type: 'error', message: `Nenhum clientOrderId encontrado para orderId: ${msg.data.orderId}` });
        }
      } else {
        logMessage('Postagem', `Postagem rejeitada: ${msg.retMsg}`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Postagem',
          orderId: clientOrderId || 'unknown',
          status,
          instId: msg.args?.[0]?.symbol || 'unknown',
          errorCode: msg.retCode,
          errorMsg: msg.retMsg,
          abs,
          t,
        });
      }
    }
  });
  tradeWs.on('ping', () => {
    logMessage('Ping', 'Recebido ping do servidor Bybit (Trade).');
  });
  tradeWs.on('pong', () => {
    logMessage('Ping', 'Recebido pong do WebSocket Bybit (Trade).');
  });
  tradeWs.on('close', () => {
    clearPingIntervalTrade(pingIntervalTrade);
    logMessage('Conexão', 'Trade WebSocket fechado. Reconectando em 5s...');
    setTimeout(connectTradeWebSocket, 5000);
  });
  tradeWs.on('error', (err) => {
    logMessage('Erro', `Erro no Trade WebSocket: ${err.message}`);
    portToCoord.postMessage({ type: 'error', message: `Erro no Trade WebSocket: ${err.message}` });
  });
}

function connectOrderWebSocket() {
  orderWs = new WebSocket(exchanges.Bybit.orderWsUrl);
  const pingIntervalOrder = startPingIntervalOrder();
  orderWs.on('open', () => {
    logMessage('Conexão', 'Conectado ao Order WebSocket da Bybit.');
    const expires = (Date.now() + 10000).toString();
    const signature = generateBybitSignature(expires);
    orderWs.send(JSON.stringify({
      op: 'auth',
      args: [bybitApiKey, expires, signature],
    }));
    logMessage('Conexão', `Enviada solicitação de autenticação (Order):\n${formatObject({ op: 'auth', args: [bybitApiKey, expires, signature] })}`);
  });
  orderWs.on('message', (data) => {
    orderMessageCounter++;
    let msg;
    try {
      msg = JSON.parse(data);
      logMessage('Debug', `Mensagem parseada (Order) [Mensagem ${orderMessageCounter}]:\n${formatObject(msg)}`);
    } catch (e) {
      logMessage('Erro', `Erro ao parsear mensagem (Order): ${e.message}`);
      portToCoord.postMessage({ type: 'error', message: `Erro ao parsear mensagem (Order): ${e.message}` });
      return;
    }
    if (msg.op === 'auth' && msg.success) {
      logMessage('Conexão', 'Autenticado com sucesso no Order WebSocket.');
      orderWs.send(JSON.stringify({
        op: 'subscribe',
        args: ['order'],
      }));
      logMessage('Conexão', 'Enviada solicitação de subscrição ao canal order.');
    }
    if (msg.op === 'subscribe' && msg.success) {
      logMessage('Conexão', 'Subscrito ao canal order com sucesso.');
      portToCoord.postMessage({ type: 'conexoesProntas' });
    }
    if (msg.topic === 'order' && msg.data?.length > 0) {
      const abs = Date.now();
      const t = t0 ? abs - t0 : 0;
      msg.data.forEach((order) => {
        const status = exchanges.Bybit.parseStatus(order, 'orders');
        const clientOrderId = [...orderIdMap.entries()].find(([_, id]) => id === order.orderId)?.[0];
        if (!clientOrderId) {
          logMessage('Ordens', `Nenhum clientOrderId encontrado para orderId: ${order.orderId}`);
          portToCoord.postMessage({ type: 'error', message: `Nenhum clientOrderId encontrado para orderId: ${order.orderId}` });
          return;
        }
        logMessage('Ordens', `Ordem: ${status} para ${order.orderId} (clientOrderId: ${clientOrderId})`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Ordens',
          orderId: clientOrderId,
          status,
          instId: order.symbol,
          avgPx: order.avgPrice || null,
          fillSz: order.cumExecQty || null,
          cancelSource: order.rejectReason || null,
          abs,
          t,
        });
      });
    }
  });
  orderWs.on('ping', () => {
    logMessage('Ping', 'Recebido ping do servidor Bybit (Order).');
  });
  orderWs.on('pong', () => {
    logMessage('Ping', 'Recebido pong do WebSocket Bybit (Order).');
  });
  orderWs.on('close', () => {
    clearPingIntervalOrder(pingIntervalOrder);
    logMessage('Conexão', 'Order WebSocket fechado. Reconectando em 5s...');
    setTimeout(connectOrderWebSocket, 5000);
  });
  orderWs.on('error', (err) => {
    logMessage('Erro', `Erro no Order WebSocket: ${err.message}`);
    portToCoord.postMessage({ type: 'error', message: `Erro no Order WebSocket: ${err.message}` });
  });
}

function sendOrder(order, clientOrderId) {
  try {
    const formattedOrder = exchanges.Bybit.formatOrder(order);
    orderIdMap.set(clientOrderId, formattedOrder.id);
    logMessage('Postagem', `Enviando (clientOrderId: ${clientOrderId}):\n${formatObject(formattedOrder)}`);
    tradeWs.send(JSON.stringify(formattedOrder));
    logMessage('Debug', `Ordem enviada para o Trade WebSocket:\n${formatObject(formattedOrder)}`);
  } catch (error) {
    logMessage('Erro', `Erro ao enviar ordem (clientOrderId: ${clientOrderId}): ${error.message}`);
    portToCoord.postMessage({ type: 'error', message: `Erro ao enviar ordem: ${error.message}` });
  }
}

// Inicialização e recebimento de ordens
parentPort.on('message', (msg) => {
  logMessage('Debug', `Mensagem recebida do coordenador no parentPort:\n${formatObject(msg)}`);
  if (msg.type === 'init') {
    portToCoord = msg.port;
    logMessage('Geral', 'Inicializando workerExecBybit.');
    try {
      connectTradeWebSocket();
      connectOrderWebSocket();
    } catch (error) {
      logMessage('Erro', `Erro ao inicializar WebSockets: ${error.message}`);
      portToCoord.postMessage({ type: 'error', message: `Erro ao inicializar WebSockets: ${error.message}` });
    }
    portToCoord.on('message', (portMsg) => {
      logMessage('Debug', `Mensagem recebida em portToCoord:\n${formatObject(portMsg)}`);
      if (portMsg.type === 'executeOrder') {
        try {
          t0 = portMsg.t0 || Date.now();
          logMessage('Geral', `Recebida ordem (clientOrderId: ${portMsg.orderId}):\n${formatObject(portMsg.order)}`);
          sendOrder(portMsg.order, portMsg.orderId);
        } catch (error) {
          logMessage('Erro', `Erro ao processar executeOrder: ${error.message}`);
          portToCoord.postMessage({ type: 'error', message: `Erro ao processar executeOrder: ${error.message}` });
        }
      }
    });
  }
});
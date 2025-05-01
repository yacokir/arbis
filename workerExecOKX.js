"use strict";
const { parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');
const crypto = require('crypto');

// Cores ANSI para logs
const GREEN = '\x1b[32m';
const BROWN = '\x1b[33m';
const RESET = '\x1b[0m';

// Credenciais da OKX
const { okxApiKey, okxApiSecret, okxPassphrase } = workerData;

// Validação das credenciais
if (!okxApiKey || !okxApiSecret || !okxPassphrase) {
  console.error('[workerExecOKX] Erro: Credenciais incompletas no workerData:', workerData);
  throw new Error('Credenciais da OKX não fornecidas corretamente');
}

// Mapa para correlacionar IDs
const orderIdMap = new Map();

// Configuração da OKX
const exchanges = {
  OKX: {
    wsUrl: 'wss://ws.okx.com:8443/ws/v5/private',
    formatOrder: (order) => {
      const now = new Date();
      const hhmmssSSS = now.toISOString().slice(11, 23).replace(/[:.]/g, '');
      let ordType;
      if (order.type === 'limit' && order.timeInForce?.toLowerCase() === 'ioc') {
        ordType = 'ioc';
      } else if (order.type === 'limit' && !order.timeInForce) {
        ordType = 'limit';
      } else if (order.type === 'market' && !order.timeInForce) {
        ordType = 'market';
      } else {
        throw new Error(`Tipo inválido: ${order.type}/${order.timeInForce}`);
      }
      const orderArgs = {
        instId: order.symbol.replace(/(.+)(USDT|BRL)/, '$1-$2'),
        side: order.side,
        ordType,
        sz: order.amount,
        tdMode: 'cash'
      };
      if (ordType === 'market') orderArgs.tgtCcy = 'base_ccy';
      else if (ordType === 'limit' || ordType === 'ioc') orderArgs.px = order.price;
      return {
        id: `ORD${hhmmssSSS}`,
        op: 'order',
        args: [orderArgs]
      };
    },
    parseStatus: (msg, channel) => {
      if (channel === 'trade') return msg.code === '0' ? 'accepted' : 'rejected';
      else if (channel === 'orders') {
        return msg.state === 'filled' ? 'filled' : msg.state === 'canceled' ? 'cancelled' : 'live';
      }
    }
  }
};

// Função para formatar objetos
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
  console.log(`[workerExecOKX - ${channel}] [abs=${abs} t=${t}] ${message}`);
}

// Gera assinatura para autenticação
function generateOKXSignature(timestamp, method, path, body) {
  const prehashString = timestamp + method + path + (body || '');
  return crypto.createHmac('sha256', okxApiSecret).update(prehashString).digest('base64');
}

let ws;
let portToCoord;
let pingInterval;

// Conecta ao WebSocket da OKX
function connectOKXWebSocket() {
  ws = new WebSocket(exchanges.OKX.wsUrl);

  ws.on('open', () => {
    //logMessage('Conexão', 'Conectado ao WebSocket da OKX.');
    const timestamp = (Date.now() / 1000).toString();
    const sign = generateOKXSignature(timestamp, 'GET', '/users/self/verify', '');
    ws.send(JSON.stringify({
      op: 'login',
      args: [{ apiKey: okxApiKey, passphrase: okxPassphrase, timestamp, sign }]
    }));
    startPingInterval();
  });

  ws.on('message', (data) => {
    // logMessage('WebSocket', `Mensagem bruta recebida: ${data}`);
    if (data.toString() === 'pong') {
      logMessage('Conexão', 'Recebido pong do WebSocket OKX');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data);
      //logMessage('Geral', `Mensagem parseada:\n${formatObject(msg)}`);
    } catch (e) {
      logMessage('Erro', `Erro ao parsear mensagem: ${e.message}`);
      portToCoord.postMessage({ type: 'error', message: `Erro ao parsear mensagem: ${e.message}` });
      return;
    }

    if (msg.event === 'login' && msg.code === '0') {
      logMessage('Conexão', 'Autenticado com sucesso.');
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [
          { channel: 'orders', instType: 'SPOT', instId: 'BTC-USDT' },
          { channel: 'orders', instType: 'SPOT', instId: 'BTC-BRL' },
          { channel: 'orders', instType: 'SPOT', instId: 'USDT-BRL' }
        ]
      }));
    }

    if (msg.event === 'subscribe' && msg.arg?.channel === 'orders') {
      if (msg.arg.instId === 'USDT-BRL') {
        logMessage('Conexão', 'Subscrito ao canal orders com sucesso.');
        portToCoord.postMessage({ type: 'conexoesProntas' });
      }
    }

    if (msg.op === 'order') {
      const abs = Date.now();
      const t = t0 ? abs - t0 : 0;
      const status = exchanges.OKX.parseStatus(msg, 'trade');
      if (msg.data && msg.data.length > 0) {
        const orderData = msg.data[0];
        const clientOrderId = [...orderIdMap.entries()].find(([_, ids]) => ids.id === msg.id)?.[0];
        if (clientOrderId && orderData.ordId) {
          orderIdMap.set(clientOrderId, { id: msg.id, ordId: orderData.ordId });
        }
        logMessage('Postagem', `** ${status} ** ${orderData.instId} - Motivo: ${orderData.sMsg || 'Desconhecido'}`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Postagem',
          orderId: clientOrderId,
          status,
          instId: orderData.instId,
          errorCode: msg.code !== '0' ? msg.code : null,
          errorMsg: msg.code !== '0' ? msg.msg : null,
          sMsg: orderData.sMsg || null,
          abs,
          t
        });
      }
    }

    if (msg.arg?.channel === 'orders' && msg.data?.length > 0) {
      const abs = Date.now();
      const t = t0 ? abs - t0 : 0;
      msg.data.forEach(order => {
        const status = exchanges.OKX.parseStatus(order, 'orders');
        const clientOrderId = [...orderIdMap.entries()].find(([_, ids]) => ids.ordId === order.ordId)?.[0];
        logMessage('Ordens', `Ordem: ** ${status} ** para ${order.ordId}`);
        portToCoord.postMessage({
          type: 'orderStatus',
          channel: 'Ordens',
          orderId: clientOrderId,
          status,
          instId: order.instId,
          avgPx: order.avgPx || null,
          fillSz: order.fillSz || null,
          cancelSource: order.cancelSource || null,
          abs,
          t
        });
      });
    }
  });

  ws.on('ping', () => {
    logMessage('Conexão', 'Recebido ping do servidor OKX');
    ws.pong();
  });

  ws.on('pong', () => {
    logMessage('Conexão', 'Recebido pong do WebSocket OKX');
  });

  ws.on('close', () => {
    logMessage('Conexão', 'WebSocket OKX fechado. Reconectando em 5s...');
    clearPingInterval();
    setTimeout(connectOKXWebSocket, 5000);
  });

  ws.on('error', (err) => {
    logMessage('Erro', `Erro no WebSocket: ${err.message}`);
    portToCoord.postMessage({ type: 'error', message: `Erro no WebSocket: ${err.message}` });
  });
}

// Função para manter a conexão viva com pings
function startPingInterval() {
  clearPingInterval();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.ping();
      logMessage('Geral', 'Enviado ping ao WebSocket OKX');
    }
  }, 15000);
}

function clearPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// Envia ordem à OKX
function sendOrder(order, clientOrderId) {
  try {
    const formattedOrder = exchanges.OKX.formatOrder(order);
    orderIdMap.set(clientOrderId, { id: formattedOrder.id, ordId: null });
    logMessage('Postagem', `Enviando (clientOrderId: ${clientOrderId}):\n${formatObject(formattedOrder)}`);
    ws.send(JSON.stringify(formattedOrder));
  } catch (error) {
    logMessage('Erro', `Erro ao enviar ordem (clientOrderId: ${clientOrderId}): ${error.message}`);
    portToCoord.postMessage({ type: 'error', message: `Erro ao enviar ordem: ${error.message}` });
  }
}

// Inicialização
parentPort.on('message', (msg) => {
  //logMessage('Debug', `Mensagem recebida do coordenador no parentPort: ${JSON.stringify(msg)}`);
  if (msg.type === 'init') {
    portToCoord = msg.port;
    // logMessage('Geral', 'Inicializando workerExecOKX.');
    // logMessage('Debug', 'Configurando listener para portToCoord');
    try {
      connectOKXWebSocket();
    } catch (error) {
      logMessage('Erro', `Erro ao inicializar WebSocket: ${error.message}`);
      portToCoord.postMessage({ type: 'error', message: `Erro ao inicializar WebSocket: ${error.message}` });
    }
    portToCoord.on('message', (portMsg) => {
      //logMessage('Debug', `Mensagem recebida em portToCoord: ${JSON.stringify(portMsg)}`);
      if (portMsg.type === 'executeOrder') {
        try {
          t0 = portMsg.t0 || Date.now();
          // logMessage('Geral', `Recebida ordem (clientOrderId: ${portMsg.orderId}):\n${formatObject(portMsg.order)}`);
          sendOrder(portMsg.order, portMsg.orderId);
        } catch (error) {
          logMessage('Erro', `Erro ao processar executeOrder: ${error.message}`);
          portToCoord.postMessage({ type: 'error', message: `Erro ao processar executeOrder: ${error.message}` });
        }
      } else {
        logMessage('Debug', `Mensagem inesperada em portToCoord: ${JSON.stringify(portMsg)}`);
      }
    });
  } else {
    logMessage('Debug', `Mensagem inesperada no parentPort: ${JSON.stringify(msg)}`);
  }
});
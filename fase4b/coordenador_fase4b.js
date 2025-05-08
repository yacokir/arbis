"use strict";
const { Worker, MessageChannel, parentPort } = require("worker_threads");
const fs = require('fs');
const path = require('path');

const GREEN = "\x1b[32m";
const BROWN = "\x1b[33m";
const RESET = "\x1b[0m";

const logFile = path.join(__dirname, '..', 'saida.txt');
const phaseLogDir = 'C:\\Users\\Yaco\\Desktop\\Cryptos\\ARBIS\\logs';
const phaseLogFile = path.join(phaseLogDir, 'fase4b.log');
if (!fs.existsSync(phaseLogDir)) {
  fs.mkdirSync(phaseLogDir, { recursive: true });
}

function log(message, phaseLog = false, color = RESET) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  fs.appendFileSync(logFile, `${logMessage}\n`);
  if (phaseLog) {
    fs.appendFileSync(phaseLogFile, `${logMessage}\n`);
  }
  console.log(`${color}${logMessage}${RESET}`);
}

const { port1: portToOKX, port2: portToCoordOKX } = new MessageChannel();
const { port1: portToBybit, port2: portToCoordBybit } = new MessageChannel();
const { port1: portToBinance, port2: portToCoordBinance } = new MessageChannel();

const ports = {
  OKX: portToCoordOKX,
  Bybit: portToCoordBybit,
  Binance: portToCoordBinance,
};

let t0;
let t1Filled = false;
let t1PendingOrderId = null;
let timeoutId = null;
let aborted = false;
let resultMatrix = [];
let completedOperations = new Set();
let currentOperacoes = [];

function formatObject(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/"([^"]+)": "([^"]+)"/g, `"$1": ${GREEN}"$2"${RESET}`)
    .replace(/"([^"]+)": (\d+(.\d+)?)/g, `"$1": ${BROWN}$2${RESET}`)
    .replace(/"([^"]+)": null/g, `"$1": null`);
}

function initializeResultMatrix(operacoes) {
  resultMatrix = [
    { T: "T1", exchange: "---", symbol: "---", side: "---", type: "---", amount: "---", askPrice: "---", execPrice: "---", tif: "---", result: "---", timeToStatus: "---", reason: "---" },
    { T: "T2", exchange: "---", symbol: "---", side: "---", type: "---", amount: "---", askPrice: "---", execPrice: "---", tif: "---", result: "---", timeToStatus: "---", reason: "---" },
    { T: "T3", exchange: "---", symbol: "---", side: "---", type: "---", amount: "---", askPrice: "---", execPrice: "---", tif: "---", result: "---", timeToStatus: "---", reason: "---" },
  ];
  operacoes.forEach((op, index) => {
    if (index < 3) {
      resultMatrix[index] = {
        T: `T${index + 1}`,
        exchange: op.exchange || "---",
        symbol: op.symbol || "---",
        side: op.side || "---",
        type: op.type || "---",
        amount: op.amount || "---",
        askPrice: op.price || "---",
        execPrice: "---",
        tif: op.timeInForce || "---",
        result: "---",
        timeToStatus: "---",
        reason: "---",
      };
    }
  });
}

function displayResultTable() {
  const header = ["T", "Exchange", "Par", "Side", "Type", "Amount", "Askd.Price", "Exec.Price", "TIF", "Result", "Time(ms)", "Reason"];
  const rows = resultMatrix.map(row => [
    row.T,
    row.exchange,
    row.symbol,
    row.side,
    row.type,
    row.amount,
    row.askPrice,
    row.execPrice,
    row.tif,
    row.result,
    row.timeToStatus,
    row.reason,
  ]);

  const colWidths = header.map((_, i) => 
    Math.max(header[i].length, ...rows.map(row => String(row[i]).length))
  );

  const formatRow = (row) => row.map((cell, i) => String(cell).padEnd(colWidths[i])).join(" | ");

  log(`Resultado | Tabela de Resultados da Arbitragem:`, false);
  console.log(formatRow(header));
  console.log(colWidths.map(w => "-".repeat(w)).join("-+-"));
  rows.forEach(row => console.log(formatRow(row)));
  console.log("");

  log(`Resultado | Enviando resultMatrix ao mainheap <==================================`, true);
  parentPort.postMessage({ type: 'arbitrageResult', resultMatrix });
}

function logMessage(channel, message) {
  const abs = Date.now();
  const t = t0 ? abs - t0 : 0;
  log(`[coordenador - ${channel}] [abs=${abs} t=${t}] ${message}`);
}

function sendOrderToWorker(order, operationIndex) {
  const now = new Date();
  const hhmmssSSS = now.toISOString().slice(11, 23).replace(/[:.]/g, "");
  const orderId = `CLI-T${operationIndex + 1}-${hhmmssSSS}`;
  const port = ports[order.exchange];
  logMessage("Postagem", `Enviando ordem T${operationIndex + 1} (${order.symbol}) para ${order.exchange}:\n${formatObject(order)} <==================================`);
  try {
    t0 = t0 || Date.now();
    port.postMessage({ type: "executeOrder", order, orderId, t0 });
  } catch (error) {
    logMessage("Erro", `Falha ao enviar ordem T${operationIndex + 1} para ${order.exchange}: ${error.message} <==================================`);
    throw error;
  }
  port.on("messageerror", (err) => {
    logMessage("Erro", `Erro ao enviar mensagem para ${order.exchange}: ${err.message} <==================================`);
  });
  return orderId;
}

let conexoesProntas = { Binance: false, OKX: false, Bybit: false };

function handleWorkerMessage(msg, exchange) {
  if (msg.type === "conexoesProntas") {
    conexoesProntas[exchange] = true;
    log(`Worker ${exchange} pronto. Estado: ${JSON.stringify(conexoesProntas)} <==================================`, true);
    parentPort.postMessage({ type: "conexoesProntas", exchange });
    if (Object.values(conexoesProntas).every(p => p)) {
      log(`Todos os workers prontos. Notificando mainheap via parentPort <==================================`, true);
      parentPort.postMessage({ type: "allWorkersReady" });
    }
  } else if (msg.type === "orderStatus" && !aborted) {
    const channel = msg.channel || "Geral";
    logMessage(channel, `Status recebido de ${exchange} para ordem ${msg.orderId}:\n${formatObject(msg)} <==================================`);

    if (!msg.orderId) {
      logMessage("Erro", `Mensagem de status inválida de ${exchange}: orderId não fornecido <==================================`);
      return;
    }

    const operationIndex = parseInt(msg.orderId.split('-')[1].replace('T', '')) - 1;
    const timeToStatus = msg.t || (msg.abs - t0);
    const reason = (msg.status === "rejected") 
      ? (msg.errorMsg || msg.sMsg || msg.errorCode || "N/A") 
      : (msg.status === "cancelled") 
      ? (msg.cancelSource || "N/A") 
      : "---";

    if (msg.orderId === t1PendingOrderId && msg.channel === "Postagem") {
      if (msg.status === "rejected") {
        logMessage("Postagem", `T1 rejeitada (par: ${msg.instId || msg.symbol}). Erro: ${msg.errorCode || "N/A"} - ${msg.errorMsg || msg.sMsg || "N/A"}. Abortando <==================================`);
        resultMatrix[0].result = "rejected";
        resultMatrix[0].timeToStatus = timeToStatus;
        resultMatrix[0].reason = reason;
        resultMatrix[1].result = "aborted";
        resultMatrix[1].timeToStatus = timeToStatus;
        resultMatrix[1].reason = "T1 Failed";
        resultMatrix[2].result = "aborted";
        resultMatrix[2].timeToStatus = timeToStatus;
        resultMatrix[2].reason = "T1 Failed";
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        aborted = true;
        displayResultTable();
        return;
      } else if (msg.status === "accepted") {
        logMessage("Postagem", `T1 aceita (par: ${msg.instId || msg.symbol}). Aguardando status <==================================`);
        resultMatrix[0].result = "accepted";
      }
    }

    if (msg.orderId === t1PendingOrderId && msg.channel === "Ordens") {
      if (msg.status === "live" || msg.status === "NEW") {
        logMessage("Ordens", `T1 no mercado (par: ${msg.instId || msg.symbol}). Aguardando preenchimento ou cancelamento <==================================`);
        resultMatrix[0].result = "live";
        resultMatrix[0].timeToStatus = timeToStatus;
        resultMatrix[0].reason = reason;
      } else if (msg.status === "filled") {
        t1Filled = true;
        logMessage("Ordens", `T1 preenchida (par: ${msg.instId || msg.symbol}). executedPrice=${msg.avgPx || "N/A"}, amount=${msg.fillSz || "N/A"}. Disparando T2/T3 <==================================`);
        resultMatrix[0].result = "filled";
        resultMatrix[0].execPrice = msg.avgPx || "---";
        resultMatrix[0].timeToStatus = timeToStatus;
        resultMatrix[0].reason = reason;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (currentOperacoes[1]) sendOrderToWorker(currentOperacoes[1], 1);
        if (currentOperacoes[2]) sendOrderToWorker(currentOperacoes[2], 2);
      } else if (msg.status === "cancelled") {
        logMessage("Ordens", `T1 cancelada (par: ${msg.instId || msg.symbol}). cancelSource=${msg.cancelSource || "N/A"}. Abortando <==================================`);
        resultMatrix[0].result = "cancelled";
        resultMatrix[0].timeToStatus = timeToStatus;
        resultMatrix[0].reason = reason;
        resultMatrix[1].result = "aborted";
        resultMatrix[1].timeToStatus = timeToStatus;
        resultMatrix[1].reason = "T1 Failed";
        resultMatrix[2].result = "aborted";
        resultMatrix[2].timeToStatus = timeToStatus;
        resultMatrix[2].reason = "T1 Failed";
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        aborted = true;
        displayResultTable();
      }
    } else if (msg.orderId !== t1PendingOrderId) {
      if (msg.channel === "Postagem" && msg.status === "rejected") {
        logMessage("Postagem", `T${operationIndex + 1} rejeitada (par: ${msg.instId || msg.symbol}). Erro: ${msg.errorCode || "N/A"} - ${msg.errorMsg || msg.sMsg || "N/A"} <==================================`);
        resultMatrix[operationIndex].result = "rejected";
        resultMatrix[operationIndex].timeToStatus = timeToStatus;
        resultMatrix[operationIndex].reason = reason;
        completedOperations.add(operationIndex);
      } else if (msg.channel === "Ordens") {
        logMessage("Ordens", `Status de T${operationIndex + 1}: ${msg.status} (par: ${msg.instId || msg.symbol}) <==================================`);
        resultMatrix[operationIndex].result = msg.status;
        resultMatrix[operationIndex].execPrice = msg.avgPx || "---";
        resultMatrix[operationIndex].timeToStatus = timeToStatus;
        resultMatrix[operationIndex].reason = reason;
        completedOperations.add(operationIndex);
      }
      const expectedOperations = currentOperacoes.length - 1;
      if (completedOperations.size >= expectedOperations && t1Filled) {
        displayResultTable();
        completedOperations.clear();
      }
    }
  } else if (msg.type === "error") {
    logMessage("Erro", `Erro reportado por ${exchange}: ${msg.message} <==================================`);
  }
}

function initializeBinance() {
  logMessage("Geral", `Inicializando Binance <==================================`);
  const workerExecBinance = new Worker("../workerExecBinance.js", {
    workerData: {
      apiKey: "nYZcNg7kBZfDAGuKpSOceL1h1YUMzSSwRGZut3KUy32KdpYPB0JKi1TV8liqvkVQ",
      apiSecret: "MC4CAQAwBQYDK2VwBCIEICtYrvoheU+SozG67W4syoWymQ7Z2bTkgvd+IDypO3AM",
    },
  });
  workerExecBinance.on('error', (err) => log(`Erro no workerExecBinance: ${err.message} <==================================`, true));
  workerExecBinance.postMessage({ type: "init", port: portToBinance }, [portToBinance]);
  portToCoordBinance.on("message", (msg) => handleWorkerMessage(msg, "Binance"));
}

function initializeOKX() {
  logMessage("Geral", `Inicializando OKX <==================================`);
  const workerExecOKX = new Worker("../workerExecOKX.js", {
    workerData: {
      okxApiKey: "ac0bc774-1bad-4da2-83f9-55b8eebb697d",
      okxApiSecret: "4AD9EBBD4A8EEB6526F31B9527545ADC",
      okxPassphrase: "Aa@066466646",
    },
  });
  workerExecOKX.on('error', (err) => log(`Erro no workerExecOKX: ${err.message} <==================================`, true));
  workerExecOKX.postMessage({ type: "init", port: portToOKX }, [portToOKX]);
  portToCoordOKX.on("message", (msg) => handleWorkerMessage(msg, "OKX"));
}

function initializeBybit() {
  logMessage("Geral", `Inicializando Bybit <==================================`);
  const workerExecBybit = new Worker("../workerExecBybit.js", {
    workerData: {
      bybitApiKey: "XpwpuEFptlUXRpU95x",
      bybitApiSecret: "F2KliOjdVJGvjY3mZW0jtIwwgf8gRESuC6Wb",
    },
  });
  workerExecBybit.on('error', (err) => log(`Erro no workerExecBybit: ${err.message} <==================================`, true));
  workerExecBybit.postMessage({ type: "init", port: portToBybit }, [portToBybit]);
  portToCoordBybit.on("message", (msg) => handleWorkerMessage(msg, "Bybit"));
}

function startArbitrage(operacoes) {
  currentOperacoes = operacoes;
  t0 = Date.now();
  aborted = false;
  t1Filled = false;
  completedOperations.clear();
  logMessage("Geral", `Iniciando arbitragem com ${operacoes.length} ordens:\n${formatObject(operacoes)} <==================================`);
  initializeResultMatrix(operacoes);
  if (operacoes[0]) {
    logMessage("Geral", `Preparando envio de T1 para ${operacoes[0].exchange}:\n${formatObject(operacoes[0])} <==================================`);
    try {
      t1PendingOrderId = sendOrderToWorker(operacoes[0], 0);
      timeoutId = setTimeout(() => {
        if (!t1Filled && !aborted) {
          logMessage("Geral", `Timeout de 3s para T1. Abortando <==================================`);
          resultMatrix[0].result = "timeout";
          resultMatrix[0].timeToStatus = 3000;
          resultMatrix[0].reason = "Timeout";
          resultMatrix[1].result = "aborted";
          resultMatrix[1].timeToStatus = 3000;
          resultMatrix[1].reason = "T1 Failed";
          resultMatrix[2].result = "aborted";
          resultMatrix[2].timeToStatus = 3000;
          resultMatrix[2].reason = "T1 Failed";
          aborted = true;
          timeoutId = null;
          displayResultTable();
        }
      }, 3000);
    } catch (error) {
      logMessage("Erro", `Erro ao enviar T1: ${error.message} <==================================`);
      resultMatrix[0].result = "error";
      resultMatrix[0].timeToStatus = Date.now() - t0;
      resultMatrix[0].reason = error.message;
      resultMatrix[1].result = "aborted";
      resultMatrix[1].timeToStatus = Date.now() - t0;
      resultMatrix[1].reason = "T1 Failed";
      resultMatrix[2].result = "aborted";
      resultMatrix[2].timeToStatus = Date.now() - t0;
      resultMatrix[2].reason = "T1 Failed";
      aborted = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      displayResultTable();
    }
  } else {
    logMessage("Geral", `Nenhuma T1 encontrada <==================================`);
    resultMatrix[0].result = "error";
    resultMatrix[0].timeToStatus = Date.now() - t0;
    resultMatrix[0].reason = "No T1";
    resultMatrix[1].result = "aborted";
    resultMatrix[1].timeToStatus = Date.now() - t0;
    resultMatrix[1].reason = "T1 Failed";
    resultMatrix[2].result = "aborted";
    resultMatrix[2].timeToStatus = Date.now() - t0;
    resultMatrix[2].reason = "T1 Failed";
    aborted = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    displayResultTable();
  }
}

parentPort.on('message', (msg) => {
  if (msg.type === 'ping') {
    log(`Ping recebido, pong enviado ao mainheap via parentPort <==================================`, true, BROWN);
    parentPort.postMessage({ type: 'pong' });
  } else if (msg.type === 'executeArbitrage') {
    const { operacoes, t0 } = msg;
    log(`Matriz dinâmica recebida com ${operacoes.length} ordens: ${formatObject(operacoes)} <==================================`, true, GREEN);
    log(`Confirmando recebimento da matriz ao mainheap <==================================`, true);
    parentPort.postMessage({ 
      type: 'matrixReceived', 
      message: `Matriz com ${operacoes.length} ordens recebida em ${Date.now() - t0}ms`
    });
    startArbitrage(operacoes);
  }
});

log(`Coordenador Fase 4b iniciado <==================================`, true, GREEN);

initializeBinance();
initializeOKX();
initializeBybit();
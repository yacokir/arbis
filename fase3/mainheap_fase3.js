"use strict";
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const Heap = require('heap');

const argv = yargs
  .command('$0 <criptoDaArbitragem> <dolarDaArbitragem> <moedaDaArbitragem>', 'Executa arbitragem com os dados fornecidos', (yargs) => {
    yargs
      .positional('criptoDaArbitragem', { describe: 'Criptomoeda usada na arbitragem', type: 'string' })
      .positional('dolarDaArbitragem', { describe: 'Tipo de dólar usado na arbitragem (USDT, USDC, etc.)', type: 'string' })
      .positional('moedaDaArbitragem', { describe: 'Moeda usada para conversão na arbitragem', type: 'string' });
  })
  .help()
  .argv;

const gatilho = 0.0010;
const valorMinimoArbitragem = 100;
const cripto = argv.criptoDaArbitragem.toUpperCase();
const dolar = argv.dolarDaArbitragem.toUpperCase();
const moeda = argv.moedaDaArbitragem.toUpperCase();
const startDate = new Date();
const dateStr = `${String(startDate.getDate()).padStart(2, '0')}-${String(startDate.getHours()).padStart(2, '0')}-${String(startDate.getMinutes()).padStart(2, '0')}-${String(startDate.getSeconds()).padStart(2, '0')}`;
const arbLogFile = `Arbs${cripto}${dolar}${moeda}-${dateStr}.txt`;
const csvHeader = "Time,ProfitTrigger,MinAmountUSD,PotentialProfitUSD,SIDE T1,EXCHANGE T1,BID T1,ASK T1,BID AMT T1,ASK AMT T1,SIDE T2,EXCHANGE T2,BID T2,ASK T2,BID AMT T2,ASK AMT T2,SIDE T3,EXCHANGE T3,BID T3,ASK T3,BID AMT T3,ASK AMT T3\n";
if (!fs.existsSync(arbLogFile)) fs.writeFileSync(arbLogFile, csvHeader);

const codigosFormaPares = [[cripto, dolar], [cripto, moeda], [dolar, moeda]];
const exchanges = [
  { exchange: 'Binance', fees: 0.001, venderPode: true, comprarPode: true },
  { exchange: 'Bybit', fees: 0.001, venderPode: true, comprarPode: true },
  { exchange: 'OKX', fees: 0.001, venderPode: true, comprarPode: true }
];

const cotacoes = {
  Binance: {
    [cripto + dolar]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [cripto + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [dolar + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' }
  },
  Bybit: {
    [cripto + dolar]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [cripto + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [dolar + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' }
  },
  OKX: {
    [cripto + dolar]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [cripto + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [dolar + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' }
  }
};

const bests = {
  [cripto + dolar]: {
    "bid": { preco: 0, amount: 0, time: 'Date.now()', exchange: "" },
    "ask": { preco: Infinity, amount: 0, time: 'Date.now()', exchange: "" }
  },
  [cripto + moeda]: {
    "bid": { preco: 0, amount: 0, time: 'Date.now()', exchange: "" },
    "ask": { preco: Infinity, amount: 0, time: 'Date.now()', exchange: "" }
  },
  [dolar + moeda]: {
    "bid": { preco: 0, amount: 0, time: 'Date.now()', exchange: "" },
    "ask": { preco: Infinity, amount: 0, time: 'Date.now()', exchange: "" }
  }
};

const previousBests = {
  [cripto + dolar]: { bid: { preco: 0 }, ask: { preco: Infinity } },
  [cripto + moeda]: { bid: { preco: 0 }, ask: { preco: Infinity } },
  [dolar + moeda]: { bid: { preco: 0 }, ask: { preco: Infinity } }
};

const bidHeaps = {};
const askHeaps = {};
let isArbitragePaused = false;

codigosFormaPares.forEach(([c1, c2]) => {
  const par = c1 + c2;
  bidHeaps[par] = new Heap((a, b) => b.preco - a.preco);
  askHeaps[par] = new Heap((a, b) => a.preco - b.preco);
});

function formatTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function updateBests(exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime) {
  let bidChanged = false;
  let askChanged = false;
  let bestBid = bidHeaps[par].peek() || { preco: 0, amount: 0, time: formatTime(new Date()), exchange: "" };
  let bestAsk = askHeaps[par].peek() || { preco: Infinity, amount: 0, time: formatTime(new Date()), exchange: "" };

  if (bid !== null && bid !== undefined) {
    const bidEntry = { preco: Number(bid), amount: Number(bidAmount), time: bidTime, exchange };
    let heapArray = bidHeaps[par].toArray();
    const existingIndex = heapArray.findIndex(e => e.exchange === exchange);
    if (existingIndex !== -1) heapArray.splice(existingIndex, 1);
    if (Number(bidAmount) > 0) {
      heapArray.push(bidEntry);
    }
    bidHeaps[par] = new Heap((a, b) => b.preco - a.preco);
    heapArray.filter(entry => entry.amount > 0).forEach(item => bidHeaps[par].push(item));
    
    bestBid = bidHeaps[par].peek() || { preco: 0, amount: 0, time: formatTime(new Date()), exchange: "" };
    if (bests[par].bid.preco !== bestBid.preco || bests[par].bid.exchange !== bestBid.exchange) bidChanged = true;
    bests[par].bid = { 
      preco: bestBid.preco, 
      amount: bestBid.amount, 
      time: cotacoes[bestBid.exchange] && cotacoes[bestBid.exchange][par] ? cotacoes[bestBid.exchange][par].bidTime : formatTime(new Date()), 
      exchange: bestBid.exchange 
    };
  }
  if (ask !== null && ask !== undefined) {
    const askEntry = { preco: Number(ask), amount: Number(askAmount), time: askTime, exchange };
    let heapArray = askHeaps[par].toArray();
    const existingIndex = heapArray.findIndex(e => e.exchange === exchange);
    if (existingIndex !== -1) heapArray.splice(existingIndex, 1);
    if (Number(askAmount) > 0) {
      heapArray.push(askEntry);
    }
    askHeaps[par] = new Heap((a, b) => a.preco - b.preco);
    heapArray.filter(entry => entry.amount > 0).forEach(item => askHeaps[par].push(item));
    
    bestAsk = askHeaps[par].peek() || { preco: Infinity, amount: 0, time: formatTime(new Date()), exchange: "" };
    if (bests[par].ask.preco !== bestAsk.preco || bests[par].ask.exchange !== bestAsk.exchange) askChanged = true;
    bests[par].ask = { 
      preco: bestAsk.preco, 
      amount: bestAsk.amount, 
      time: cotacoes[bestAsk.exchange] && cotacoes[bestAsk.exchange][par] ? cotacoes[bestAsk.exchange][par].askTime : formatTime(new Date()), 
      exchange: bestAsk.exchange 
    };
  }
  if (bestBid.exchange && cotacoes[bestBid.exchange] && cotacoes[bestBid.exchange][par] && 
      (cotacoes[bestBid.exchange][par].bid !== String(bestBid.preco) || cotacoes[bestBid.exchange][par].bidAmount === '0')) {
    bidHeaps[par] = new Heap((a, b) => b.preco - a.preco);
    exchanges.forEach(({ exchange }) => {
      const cotacao = cotacoes[exchange][par];
      if (Number(cotacao.bidAmount) > 0 && cotacao.bid !== '0') {
        bidHeaps[par].push({ preco: Number(cotacao.bid), amount: Number(cotacao.bidAmount), time: cotacao.bidTime, exchange });
      }
    });
    const newBestBid = bidHeaps[par].peek() || { preco: 0, amount: 0, time: formatTime(new Date()), exchange: "" };
    bests[par].bid = { 
      preco: newBestBid.preco, 
      amount: newBestBid.amount, 
      time: cotacoes[newBestBid.exchange] && cotacoes[newBestBid.exchange][par] ? cotacoes[newBestBid.exchange][par].bidTime : formatTime(new Date()), 
      exchange: newBestBid.exchange 
    };
    bidChanged = true;
  }
  if (bestAsk.exchange && cotacoes[bestAsk.exchange] && cotacoes[bestAsk.exchange][par] && 
      (cotacoes[bestAsk.exchange][par].ask !== String(bestAsk.preco) || cotacoes[bestAsk.exchange][par].askAmount === '0')) {
    askHeaps[par] = new Heap((a, b) => a.preco - b.preco);
    exchanges.forEach(({ exchange }) => {
      const cotacao = cotacoes[exchange][par];
      if (Number(cotacao.askAmount) > 0 && cotacao.ask !== '9007199254740991') {
        askHeaps[par].push({ preco: Number(cotacao.ask), amount: Number(cotacao.askAmount), time: cotacao.askTime, exchange });
      }
    });
    const newBestAsk = askHeaps[par].peek() || { preco: Infinity, amount: 0, time: formatTime(new Date()), exchange: "" };
    bests[par].ask = { 
      preco: newBestAsk.preco, 
      amount: newBestAsk.amount, 
      time: cotacoes[newBestAsk.exchange] && cotacoes[newBestAsk.exchange][par] ? cotacoes[newBestAsk.exchange][par].askTime : formatTime(new Date()), 
      exchange: newBestAsk.exchange 
    };
    askChanged = true;
  }
  if ((bidChanged || askChanged) && !isArbitragePaused) {
    previousBests[par].bid.preco = bests[par].bid.preco;
    previousBests[par].ask.preco = bests[par].ask.preco;
    testaArbitragens();
  }
}

function atribuirCotacaoExchange(exchange, par, bid = null, bidAmount = null, bidTime = null, ask = null, askAmount = null, askTime = null) {
  if (!cotacoes[exchange][par]) {
    cotacoes[exchange][par] = { bid: null, bidAmount: null, bidTime: null, ask: null, askAmount: null, askTime: null };
  }
  const dolarMoedaPar = dolar + moeda;
  const criptoDolarPar = cripto + dolar;
  const criptoMoedaPar = cripto + moeda;
  if (bid !== null && bidAmount !== null) {
    let isValidBid = false;
    if (par === dolarMoedaPar) {
      isValidBid = Number(bidAmount) > 100;
    } else if (par === criptoDolarPar) {
      isValidBid = (Number(bidAmount) * Number(bid)) > 100;
    } else if (par === criptoMoedaPar) {
      let btcusdtPrice = bests[criptoDolarPar].ask.preco;
      if (!btcusdtPrice || btcusdtPrice === Infinity) {
        btcusdtPrice = Number(bid) / (bests[dolarMoedaPar].ask.preco || 5);
      }
      isValidBid = (Number(bidAmount) * btcusdtPrice) > 100;
    }
    if (isValidBid && cotacoes[exchange][par].bid !== bid) {
      cotacoes[exchange][par].bid = bid;
      cotacoes[exchange][par].bidAmount = bidAmount;
      cotacoes[exchange][par].bidTime = bidTime;
    } else {
      cotacoes[exchange][par].bid = '0';
      cotacoes[exchange][par].bidAmount = '0';
      cotacoes[exchange][par].bidTime = formatTime(new Date());
    }
  }
  if (ask !== null && askAmount !== null) {
    let isValidAsk = false;
    if (par === dolarMoedaPar) {
      isValidAsk = Number(askAmount) > 100;
    } else if (par === criptoDolarPar) {
      isValidAsk = (Number(askAmount) * Number(ask)) > 100;
    } else if (par === criptoMoedaPar) {
      let btcusdtPrice = bests[criptoDolarPar].bid.preco;
      if (!btcusdtPrice || btcusdtPrice === 0) {
        btcusdtPrice = Number(ask) / (bests[dolarMoedaPar].bid.preco || 5);
      }
      isValidAsk = (Number(askAmount) * btcusdtPrice) > 100;
    }
    if (isValidAsk && cotacoes[exchange][par].ask !== ask) {
      cotacoes[exchange][par].ask = ask;
      cotacoes[exchange][par].askAmount = askAmount;
      cotacoes[exchange][par].askTime = askTime;
    } else {
      cotacoes[exchange][par].ask = '9007199254740991';
      cotacoes[exchange][par].askAmount = '0';
      cotacoes[exchange][par].askTime = formatTime(new Date());
    }
  }
  updateBests(exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime);
}

function inicializarWorkers(codigosFormaPares) {
  exchanges.forEach(({ exchange }) => {  
    codigosFormaPares.forEach((codigosDePar) => {
      const par = codigosDePar[0] + codigosDePar[1];
      const workerPath = `../worker${exchange}.js`;
      try {
        if (fs.existsSync(path.resolve(__dirname, workerPath))) {
          const worker = new Worker(workerPath, { workerData: { codigosDePar } });
          worker.on('message', (mensagem) => {
            const { exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime } = mensagem;
            atribuirCotacaoExchange(exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime);
          });
          worker.on('error', (err) => console.error(`Erro no Worker para ${exchange} - ${par}: ${err.message}`));
          worker.on('exit', (code) => { if (code !== 0) console.error(`Worker para ${exchange} - ${par} saiu com código ${code}`); });
        } else {
          console.error(`Arquivo ${workerPath} não encontrado para ${exchange} - ${par}`);
        }
      } catch (err) {
        console.error(`Erro ao inicializar worker para ${exchange} - ${par}: ${err.message}`);
      }
    });
  });
}

function testaArbitragens() {
  const time = formatTime(new Date());
  const vendeDomesticamente = (bests[cripto + moeda].bid.preco / (bests[dolar + moeda].ask.preco * bests[cripto + dolar].ask.preco) - 1).toFixed(5);
  const compraDomesticamente = (bests[cripto + dolar].bid.preco * bests[dolar + moeda].bid.preco / bests[cripto + moeda].ask.preco - 1).toFixed(5);
  if (vendeDomesticamente > gatilho || compraDomesticamente > gatilho) {
    const separator = '==================== ARBITRAGEM DETECTADA ====================';
    const outputConsole = [];
    const outputFile = [];
    const csvLines = [];
    const snapshotCotacoes = JSON.stringify(cotacoes, null, 2);
    const snapshotBests = JSON.stringify(bests, null, 2);
    outputConsole.push(separator);
    outputConsole.push(`${time} --- ${cripto} VD: ${vendeDomesticamente} CD: ${compraDomesticamente}`);
    let profitTrigger = 0;
    if (vendeDomesticamente > gatilho && compraDomesticamente > gatilho) {
      profitTrigger = Math.max(Number(vendeDomesticamente), Number(compraDomesticamente));
    } else if (vendeDomesticamente > gatilho) {
      profitTrigger = Number(vendeDomesticamente);
    } else if (compraDomesticamente > gatilho) {
      profitTrigger = Number(compraDomesticamente);
    }
    if (vendeDomesticamente > gatilho) {
      outputConsole.push(`   SELL, ${bests[cripto + moeda].bid.exchange}, ${cripto + moeda}, LIMIT, Preço: ${bests[cripto + moeda].bid.preco}, Amount: ${bests[cripto + moeda].bid.amount}`);
      outputConsole.push(`   BUY, ${bests[dolar + moeda].ask.exchange}, ${dolar + moeda}, MARKET, Preço: ${bests[dolar + moeda].ask.preco}, Amount: ${bests[dolar + moeda].ask.amount}`);
      outputConsole.push(`   BUY, ${bests[cripto + dolar].ask.exchange}, ${cripto + dolar}, MARKET, Preço: ${bests[cripto + dolar].ask.preco}, Amount: ${bests[cripto + dolar].ask.amount}`);
      const t1AmountUSD = bests[cripto + moeda].bid.amount * bests[cripto + dolar].ask.preco || 0;
      const t2AmountUSD = bests[dolar + moeda].ask.amount || 0;
      const t3AmountUSD = bests[cripto + dolar].ask.amount * bests[cripto + dolar].ask.preco || 0;
      const minAmountUSD = Math.min(t1AmountUSD, t2AmountUSD, t3AmountUSD);
      const potentialProfitUSD = profitTrigger * minAmountUSD;
      const csvLine = `${time},${profitTrigger},${minAmountUSD},${potentialProfitUSD},SELL,${bests[cripto + moeda].bid.exchange},${bests[cripto + moeda].bid.preco},${bests[cripto + moeda].ask.preco},${bests[cripto + moeda].bid.amount},${bests[cripto + moeda].ask.amount},BUY,${bests[dolar + moeda].ask.exchange},${bests[dolar + moeda].bid.preco},${bests[dolar + moeda].ask.preco},${bests[dolar + moeda].bid.amount},${bests[dolar + moeda].ask.amount},BUY,${bests[cripto + dolar].ask.exchange},${bests[cripto + dolar].bid.preco},${bests[cripto + dolar].ask.preco},${bests[cripto + dolar].bid.amount},${bests[cripto + dolar].ask.amount}`;
      csvLines.push(csvLine);
    }
    if (compraDomesticamente > gatilho) {
      outputConsole.push(`   BUY, ${bests[cripto + moeda].ask.exchange}, ${cripto + moeda}, LIMIT, Preço: ${bests[cripto + moeda].ask.preco}, Amount: ${bests[cripto + moeda].ask.amount}`);
      outputConsole.push(`   SELL, ${bests[dolar + moeda].bid.exchange}, ${dolar + moeda}, MARKET, Preço: ${bests[dolar + moeda].bid.preco}, Amount: ${bests[dolar + moeda].bid.amount}`);
      outputConsole.push(`   SELL, ${bests[cripto + dolar].bid.exchange}, ${cripto + dolar}, MARKET, Preço: ${bests[cripto + dolar].bid.preco}, Amount: ${bests[cripto + dolar].bid.amount}`);
      const t1AmountUSD = bests[cripto + moeda].ask.amount * bests[cripto + dolar].bid.preco || 0;
      const t2AmountUSD = bests[dolar + moeda].bid.amount || 0;
      const t3AmountUSD = bests[cripto + dolar].bid.amount * bests[cripto + dolar].bid.preco || 0;
      const minAmountUSD = Math.min(t1AmountUSD, t2AmountUSD, t3AmountUSD);
      const potentialProfitUSD = profitTrigger * minAmountUSD;
      const csvLine = `${time},${profitTrigger},${minAmountUSD},${potentialProfitUSD},BUY,${bests[cripto + moeda].ask.exchange},${bests[cripto + moeda].bid.preco},${bests[cripto + moeda].ask.preco},${bests[cripto + moeda].bid.amount},${bests[cripto + moeda].ask.amount},SELL,${bests[dolar + moeda].bid.exchange},${bests[dolar + moeda].bid.preco},${bests[dolar + moeda].ask.preco},${bests[dolar + moeda].bid.amount},${bests[dolar + moeda].ask.amount},SELL,${bests[cripto + dolar].bid.exchange},${bests[cripto + dolar].bid.preco},${bests[cripto + dolar].ask.preco},${bests[cripto + dolar].bid.amount},${bests[cripto + dolar].ask.amount}`;
      csvLines.push(csvLine);
    }
    outputConsole.forEach(line => console.log(line));
    if (csvLines.length > 0) {
      process.stdout.write('\x07');
      isArbitragePaused = true;
      fs.appendFileSync(arbLogFile, csvLines.join('\n') + '\n');
      outputFile.push(separator);
      outputFile.push('SNAPSHOT COTACOES:');
      outputFile.push(snapshotCotacoes);
      outputFile.push('SNAPSHOT BESTS:');
      outputFile.push(snapshotBests);
      outputFile.push(separator);
      registrarNoLog(outputFile.join('\n') + '\n');
      setTimeout(() => {
        isArbitragePaused = false;
        console.log(`[Arbitragem] Testes retomados às ${formatTime(new Date())}`);
      }, 30000);
    }
  }
}

function registrarNoLog(output) {
  fs.appendFileSync('saida.txt', output, (err) => {
    if (err) console.error('Erro ao gravar em saida.txt:', err);
  });
}

inicializarWorkers(codigosFormaPares);

fs.writeFileSync('saida.txt', '', (err) => {
  if (err) console.error('Erro ao inicializar saida.txt:', err);
});

const logFile = path.join(__dirname, '..', 'saida.txt');
const phaseLogDir = 'C:\\Users\\Yaco\\Desktop\\Cryptos\\ARBIS\\logs';
const phaseLogFile = path.join(phaseLogDir, 'fase3.log');
if (!fs.existsSync(phaseLogDir)) {
  fs.mkdirSync(phaseLogDir, { recursive: true });
}

function log(message, phaseLog = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  fs.appendFileSync(logFile, `${logMessage}\n`);
  if (phaseLog) {
    fs.appendFileSync(phaseLogFile, `${logMessage}\n`);
  }
  console.log(logMessage);
}

const coordenador = new Worker('./coordenador_fase3.js');
let secondMatrixSent = false;
let conexoesProntas = { Binance: false, OKX: false, Bybit: false };

coordenador.on('message', (msg) => {
  if (msg.type === 'pong') {
    log(`Pong recebido do coordenador <==================================`, true);
  } else if (msg.type === 'matrixReceived') {
    log(`Coordenador confirmou recebimento: ${msg.message} <==================================`, true);
  } else if (msg.type === 'arbitrageResult') {
    log(`Tabela de resultados recebida do coordenador:\n${JSON.stringify(msg.resultMatrix, null, 2)} <==================================`, true);
    if (!secondMatrixSent) {
      secondMatrixSent = true;
      log(`Resultado da primeira matriz recebido. Agendando segunda matriz simulada (2 ordens) em 60s <==================================`, true);
      setTimeout(() => {
        log(`Executando setTimeout para enviar matriz simulada com 2 ordens <==================================`, true);
        coordenador.postMessage({ type: 'executeArbitrage', operacoes: mockMatrix2, t0: Date.now() });
        log(`Enviada matriz simulada com 2 ordens: ${JSON.stringify(mockMatrix2)} <==================================`, true);
      }, 60000);
    }
  } else if (msg.type === 'conexoesProntas') {
    conexoesProntas[msg.exchange] = true;
    log(`Worker ${msg.exchange} pronto. Estado das conexões: ${JSON.stringify(conexoesProntas)} <==================================`, true);
    if (Object.values(conexoesProntas).every(p => p)) {
      log(`Todos os workers prontos. Agendando envio da primeira matriz simulada (3 ordens) em 1s <==================================`, true);
      setTimeout(() => {
        log(`Executando setTimeout para enviar matriz simulada com 3 ordens <==================================`, true);
        coordenador.postMessage({ type: 'executeArbitrage', operacoes: mockMatrix3, t0: Date.now() });
        log(`Enviada matriz simulada com 3 ordens: ${JSON.stringify(mockMatrix3)} <==================================`, true);
      }, 1000);
    }
  }
});

coordenador.on('error', (err) => {
  log(`Erro no coordenador: ${err.message} <==================================`, true);
});

coordenador.on('exit', (code) => {
  log(`Coordenador terminou com código ${code} <==================================`, true);
});

const mockMatrix3 = [
  { exchange: 'Bybit', symbol: 'BTCUSDT', side: 'sell', type: 'limit', amount: '0', price: '95000', timeInForce: 'IOC' },
  { exchange: 'OKX', symbol: 'BTCBRL', side: 'buy', type: 'market', amount: '0.0001', price: null, timeInForce: null },
  { exchange: 'Binance', symbol: 'USDTBRL', side: 'sell', type: 'market', amount: '10', price: null, timeInForce: null }
];

const mockMatrix2 = [
  { exchange: 'Bybit', symbol: 'BTCUSDT', side: 'sell', type: 'limit', amount: '0', price: '95000', timeInForce: 'IOC' },
  { exchange: 'OKX', symbol: 'BTCBRL', side: 'buy', type: 'market', amount: '0.0001', price: null, timeInForce: null }
];

coordenador.postMessage({ type: 'ping' });
log('MainHeap Fase 3 iniciado, ping enviado ao coordenador <==================================', true);

setInterval(() => {
  const time = formatTime(new Date());
  console.log(`--- ${time} ---`);
  const snapshotCotacoes = JSON.stringify(cotacoes, null, 2);
  const snapshotBests = JSON.stringify(bests, null, 2);
  const snapshotOutput = [
    `=== SNAPSHOT ${time} ===`,
    'COTACOES:',
    snapshotCotacoes,
    'BESTS:',
    snapshotBests,
    '===================='
  ].join('\n') + '\n';
  registrarNoLog(snapshotOutput);
}, 30000);
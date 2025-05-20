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

const gatilho = 0.00030;
const valorMinimoArbitragem = 100;
const cripto = argv.criptoDaArbitragem.toUpperCase();
const dolar = argv.dolarDaArbitragem.toUpperCase();
const moeda = argv.moedaDaArbitragem.toUpperCase();
const startDate = new Date();
const dateStr = `${String(startDate.getDate()).padStart(2, '0')}-${String(startDate.getHours()).padStart(2, '0')}-${String(startDate.getMinutes()).padStart(2, '0')}-${String(startDate.getSeconds()).padStart(2, '0')}`;
const logDir = path.join(__dirname, 'logs');
const arbLogFile = path.join(logDir, `Arbs${cripto}${dolar}${moeda}-${dateStr}.txt`);
const csvHeader = "Time,ProfitTrigger,MinAmountUSD,PotentialProfitUSD,SIDE T1,EXCHANGE T1,BID T1,ASK T1,BID AMT T1,ASK AMT T1,SIDE T2,EXCHANGE T2,BID T2,ASK T2,BID AMT T2,ASK AMT T2,SIDE T3,EXCHANGE T3,BID T3,ASK T3,BID AMT T3,ASK AMT T3\n";
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
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
  let bestBid = bidHeaps[par].peek() || { preco: -9007199254740991, amount: 0, time: formatTime(new Date()), exchange: "" };
  let bestAsk = askHeaps[par].peek() || { preco: Infinity, amount: 0, time: formatTime(new Date()), exchange: "" };

  if (bid !== null && bid !== undefined) {
    const bidEntry = { preco: Number(bid), amount: Number(bidAmount), time: bidTime, exchange };
    let heapArray = bidHeaps[par].toArray();
    const existingIndex = heapArray.findIndex(e => e.exchange === exchange);
    if (existingIndex !== -1) heapArray.splice(existingIndex, 1);
    if (Number(bidAmount) > 0 && bid !== '0' && bid !== '-9007199254740991') {
      heapArray.push(bidEntry);
    }
    bidHeaps[par] = new Heap((a, b) => b.preco - a.preco);
    heapArray.filter(entry => entry.amount > 0).forEach(item => bidHeaps[par].push(item));
    
    bestBid = bidHeaps[par].peek() || { preco: -9007199254740991, amount: 0, time: formatTime(new Date()), exchange: "" };
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
    if (Number(askAmount) > 0 && ask !== '9007199254740991') {
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
      if (Number(cotacao.bidAmount) > 0 && cotacao.bid !== '0' && cotacao.bid !== '-9007199254740991') {
        bidHeaps[par].push({ preco: Number(cotacao.bid), amount: Number(cotacao.bidAmount), time: cotacao.bidTime, exchange });
      }
    });
    const newBestBid = bidHeaps[par].peek() || { preco: -9007199254740991, amount: 0, time: formatTime(new Date()), exchange: "" };
    bests[par].bid = { 
      preco: newBestBid.preco, 
      amount: newBestBid.amount, 
      time: cotacoes[newBestBid.exchange] && cotacoes[newBestBid.exchange][par] ? cotacoes[newBestBid.exchange][par].bidTime : formatTime(new Date()), 
      exchange: newBestBid.exchange 
    };
    bidChanged = true;
  }
  if (bestAsk.exchange && cotacoes[bestAsk.exchange] && cotacoes[bestAsk.exchange][par] && 
      (cotacoes[bestAsk.exchange][par].ask !== String(bestBid.preco) || cotacoes[bestAsk.exchange][par].askAmount === '0')) {
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
      isValidBid = Number(bidAmount) > valorMinimoArbitragem;
    } else if (par === criptoDolarPar) {
      isValidBid = (Number(bidAmount) * Number(bid)) > valorMinimoArbitragem;
    } else if (par === criptoMoedaPar) {
      let btcusdtPrice = bests[criptoDolarPar].ask.preco;
      if (!btcusdtPrice || btcusdtPrice === Infinity) {
        btcusdtPrice = Number(bid) / (bests[dolarMoedaPar].ask.preco || 5);
      }
      isValidBid = (Number(bidAmount) * btcusdtPrice) > valorMinimoArbitragem;
    }
    if (isValidBid && cotacoes[exchange][par].bid !== bid) {
      cotacoes[exchange][par].bid = bid;
      cotacoes[exchange][par].bidAmount = bidAmount;
      cotacoes[exchange][par].bidTime = bidTime;
    } else {
      cotacoes[exchange][par].bid = '-9007199254740991';
      cotacoes[exchange][par].bidAmount = '0';
      cotacoes[exchange][par].bidTime = formatTime(new Date());
    }
  }
  if (ask !== null && askAmount !== null) {
    let isValidAsk = false;
    if (par === dolarMoedaPar) {
      isValidAsk = Number(askAmount) > valorMinimoArbitragem;
    } else if (par === criptoDolarPar) {
      isValidAsk = (Number(askAmount) * Number(ask)) > valorMinimoArbitragem;
    } else if (par === criptoMoedaPar) {
      let btcusdtPrice = bests[criptoDolarPar].bid.preco;
      if (!btcusdtPrice || btcusdtPrice === 0) {
        btcusdtPrice = Number(ask) / (bests[dolarMoedaPar].bid.preco || 5);
      }
      isValidAsk = (Number(askAmount) * btcusdtPrice) > valorMinimoArbitragem;
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
      const workerPath = path.resolve(__dirname, `../worker${exchange}.js`);
      try {
        if (fs.existsSync(workerPath)) {
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

function construirMatriz(vendeDomesticamente, compraDomesticamente, cotacoesUsadas) {
  const matriz = [];
  
  // Determinar estratégia (VD ou CD)
  const isVD = vendeDomesticamente > gatilho;
  const isCD = compraDomesticamente > gatilho;
  if (!isVD && !isCD) {
    console.log(`Nenhuma matriz gerada: vendeDomesticamente=${vendeDomesticamente}, compraDomesticamente=${compraDomesticamente}, gatilho=${gatilho}`);
    return matriz;
  }

  // Mapear cotações para operações com tempos
  const operacoes = [
    {
      symbol: cripto + dolar,
      preco: isVD ? bests[cripto + dolar].ask.preco : bests[cripto + dolar].bid.preco,
      time: isVD ? bests[cripto + dolar].ask.time : bests[cripto + dolar].bid.time,
      exchange: isVD ? bests[cripto + dolar].ask.exchange : bests[cripto + dolar].bid.exchange,
      side: isVD ? 'buy' : 'sell',
      type: 'market',
      timeInForce: null
    },
    {
      symbol: cripto + moeda,
      preco: isVD ? bests[cripto + moeda].bid.preco : bests[cripto + moeda].ask.preco,
      time: isVD ? bests[cripto + moeda].bid.time : bests[cripto + moeda].ask.time,
      exchange: isVD ? bests[cripto + moeda].bid.exchange : bests[cripto + moeda].ask.exchange,
      side: isVD ? 'sell' : 'buy',
      type: 'limit',
      timeInForce: 'IOC'
    },
    {
      symbol: dolar + moeda,
      preco: isVD ? bests[dolar + moeda].ask.preco : bests[dolar + moeda].bid.preco,
      time: isVD ? bests[dolar + moeda].ask.time : bests[dolar + moeda].bid.time,
      exchange: isVD ? bests[dolar + moeda].ask.exchange : bests[dolar + moeda].bid.exchange,
      side: isVD ? 'buy' : 'sell',
      type: 'market',
      timeInForce: null
    }
  ];

  // Ordenar operações por tempo (mais recente para mais antigo)
  operacoes.sort((a, b) => new Date(b.time) - new Date(a.time));

  // Calcular amounts
  let amountCriptoDolar, amountCriptoMoeda, amountDolarMoeda;
  if (isVD) {
    amountCriptoDolar = (valorMinimoArbitragem / bests[cripto + dolar].ask.preco).toFixed(8);
    amountCriptoMoeda = amountCriptoDolar;
    amountDolarMoeda = valorMinimoArbitragem.toFixed(2);
  } else {
    amountCriptoDolar = (valorMinimoArbitragem / bests[cripto + dolar].bid.preco).toFixed(8);
    amountCriptoMoeda = amountCriptoDolar;
    amountDolarMoeda = valorMinimoArbitragem.toFixed(2);
  }

  // Atribuir amounts às operações com base no symbol
  operacoes.forEach((op, index) => {
    let amount;
    if (op.symbol === cripto + dolar) {
      amount = amountCriptoDolar;
    } else if (op.symbol === cripto + moeda) {
      amount = amountCriptoMoeda;
    } else if (op.symbol === dolar + moeda) {
      amount = amountDolarMoeda;
    }

    // Ajustar T1 (primeira operação) para limit/IOC com prefixo "* "
    const isT1 = index === 0;
    matriz.push({
      exchange: op.exchange,
      symbol: op.symbol,
      side: op.side,
      type: isT1 ? 'limit' : 'market',
      amount: isT1 ? `* ${amount}` : amount,
      price: isT1 ? op.preco.toString() : null,
      timeInForce: isT1 ? 'IOC' : null
    });
  });

  console.log(`Matriz de operações gerada: ${JSON.stringify(matriz, null, 2)}`);
  return matriz;
}

function testaArbitragens() {
  if (!Object.values(conexoesProntas).every(p => p)) {
    console.log(`[Arbitragem] Teste ignorado às ${formatTime(new Date())}: Conexões incompletas (${JSON.stringify(conexoesProntas)})`);
    return;
  }
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
    
    // Definir cotações usadas para a estratégia ativa
    const cotacoesUsadas = [];
    if (vendeDomesticamente > gatilho) {
      cotacoesUsadas.push({
        symbol: cripto + moeda,
        preco: bests[cripto + moeda].bid.preco,
        time: bests[cripto + moeda].bid.time,
        exchange: bests[cripto + moeda].bid.exchange,
        side: 'sell'
      });
      cotacoesUsadas.push({
        symbol: dolar + moeda,
        preco: bests[dolar + moeda].ask.preco,
        time: bests[dolar + moeda].ask.time,
        exchange: bests[dolar + moeda].ask.exchange,
        side: 'buy'
      });
      cotacoesUsadas.push({
        symbol: cripto + dolar,
        preco: bests[cripto + dolar].ask.preco,
        time: bests[cripto + dolar].ask.time,
        exchange: bests[cripto + dolar].ask.exchange,
        side: 'buy'
      });
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
      cotacoesUsadas.push({
        symbol: cripto + moeda,
        preco: bests[cripto + moeda].ask.preco,
        time: bests[cripto + moeda].ask.time,
        exchange: bests[cripto + moeda].ask.exchange,
        side: 'buy'
      });
      cotacoesUsadas.push({
        symbol: dolar + moeda,
        preco: bests[dolar + moeda].bid.preco,
        time: bests[dolar + moeda].bid.time,
        exchange: bests[dolar + moeda].bid.exchange,
        side: 'sell'
      });
      cotacoesUsadas.push({
        symbol: cripto + dolar,
        preco: bests[cripto + dolar].bid.preco,
        time: bests[cripto + dolar].bid.time,
        exchange: bests[cripto + dolar].bid.exchange,
        side: 'sell'
      });
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
      isArbitragePaused = true;
      fs.appendFileSync(arbLogFile, csvLines.join('\n') + '\n');
      outputFile.push(separator);
      outputFile.push('SNAPSHOT COTACOES:');
      outputFile.push(snapshotCotacoes);
      outputFile.push('SNAPSHOT BESTS:');
      outputFile.push(snapshotBests);
      outputFile.push(separator);
      registrarNoLog(outputFile.join('\n') + '\n');
      const matrizReal = construirMatriz(vendeDomesticamente, compraDomesticamente, cotacoesUsadas);
      // Novo teste: Verificar se todos os amounts são positivos
      const hasValidAmounts = matrizReal.every(op => Number(op.amount.replace('* ', '')) > 0);
      if (matrizReal.length > 0 && hasValidAmounts) {
        coordenador.postMessage({ type: 'executeArbitrage', operacoes: matrizReal, t0: Date.now() });
        log(`Enviada matriz real com ${matrizReal.length} ordens após detecção: ${JSON.stringify(matrizReal)} <==================================`, true);
      } else {
        log(`Matriz descartada às ${formatTime(new Date())}: amounts inválidos ou matriz vazia`, true);
      }
      setTimeout(() => {
        isArbitragePaused = false;
        console.log(`[Arbitragem] Testes retomados às ${formatTime(new Date())}`);
      }, 30000);
    }
  }
}

function registrarNoLog(output) {
  fs.appendFileSync(phaseLogFile, output, (err) => {
    if (err) console.error('Erro ao gravar em fase4c.log:', err);
  });
}

inicializarWorkers(codigosFormaPares);

const phaseLogDir = path.join(__dirname, 'logs');
if (!fs.existsSync(phaseLogDir)) {
  fs.mkdirSync(phaseLogDir, { recursive: true });
}
const phaseLogFile = path.join(phaseLogDir, 'fase4c.log');

function log(message, phaseLog = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  if (phaseLog) {
    fs.appendFileSync(phaseLogFile, `${logMessage}\n`);
  }
  console.log(logMessage);
}

const coordenador = new Worker('./coordenador_fase4c.js');
let conexoesProntas = { Binance: false, OKX: false, Bybit: false };

coordenador.on('message', (msg) => {
  if (msg.type === 'pong') {
    log(`Pong recebido do coordenador <==================================`, true);
  } else if (msg.type === 'matrixReceived') {
    log(`Coordenador confirmou recebimento: ${msg.message} <==================================`, true);
  } else if (msg.type === 'arbitrageResult') {
    log(`Tabela de resultados recebida do coordenador:\n${JSON.stringify(msg.resultMatrix, null, 2)} <==================================`, true);
  } else if (msg.type === 'conexoesProntas') {
    conexoesProntas[msg.exchange] = true;
    log(`Worker ${msg.exchange} pronto. Estado das conexões: ${JSON.stringify(conexoesProntas)} <==================================`, true);
    if (Object.values(conexoesProntas).every(p => p)) {
      log(`Todos os workers prontos. Iniciando testagem de arbitragens <==================================`, true);
    }
  }
});

coordenador.on('error', (err) => {
  log(`Erro no coordenador: ${err.message} <==================================`, true);
});

coordenador.on('exit', (code) => {
  log(`Coordenador terminou com código ${code} <==================================`, true);
});

coordenador.postMessage({ type: 'ping' });
log('MainHeap Fase 4c iniciado, ping enviado ao coordenador <==================================', true);
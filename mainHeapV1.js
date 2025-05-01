const { Worker } = require('worker_threads');
const fs = require('fs');
const yargs = require('yargs');
const Heap = require('heap');
const path = require('path');

const argv = yargs
  .command('$0 <criptoDaArbitragem> <dolarDaArbitragem> <moedaDaArbitragem>', 'Executa arbitragem com os dados fornecidos', (yargs) => {
    yargs
      .positional('criptoDaArbitragem', { describe: 'Criptomoeda usada na arbitragem', type: 'string' })
      .positional('dolarDaArbitragem', { describe: 'Tipo de dólar usado na arbitragem (USDT, USDC, etc.)', type: 'string' })
      .positional('moedaDaArbitragem', { describe: 'Moeda usada para conversão na arbitragem', type: 'string' });
  })
  .help()
  .argv;

const gatilho = 0.00105;
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
  { exchange: 'Bybit', fees: 0.001, venderPode: true, comprarPode: true },
  { exchange: 'Binance', fees: 0.001, venderPode: true, comprarPode: true },
  { exchange: 'Deribit', fees: 0.001, venderPode: true, comprarPode: true },
  { exchange: 'bitpreco', fees: 0.001, venderPode: true, comprarPode: true },
  { exchange: 'OKX', fees: 0.001, venderPode: true, comprarPode: true }
];

const cotacoes = {
  Bybit: {
    [cripto + dolar]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [cripto + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [dolar + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' }
  },
  Binance: {
    [cripto + dolar]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [cripto + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [dolar + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' }
  },
  Deribit: {
    [cripto + dolar]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [cripto + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' },
    [dolar + moeda]: { bid: '0', bidAmount: '0', bidTime: 'Date.now()', ask: '9007199254740991', askAmount: '0', askTime: 'Date.now()' }
  },
  bitpreco: {
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
const inconsistencies = [];
let isArbitragePaused = false;

// Métricas globais
let updateCountTotal = 0;
let updateTimeTotal = 0;
let arbitrageCountTotal = 0;
const latencyStatsTotal = exchanges.reduce((acc, { exchange }) => ({
  ...acc,
  [exchange]: { sum: 0, count: 0, max: 0 }
}), {});

// Métricas dos últimos 30s
let updateCountWindow = 0;
let updateTimeWindow = 0;
let arbitrageCountWindow = 0;
const latencyStatsWindow = exchanges.reduce((acc, { exchange }) => ({
  ...acc,
  [exchange]: { sum: 0, count: 0, max: 0 }
}), {});

codigosFormaPares.forEach(([c1, c2]) => {
  const par = c1 + c2;
  bidHeaps[par] = new Heap((a, b) => b.preco - a.preco);
  askHeaps[par] = new Heap((a, b) => a.preco - b.preco);
});

function formatTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function parseTime(timeStr) {
  const [datePart, timePart] = timeStr.split(' ');
  const [seconds, millis] = timePart.split('.');
  return new Date(`${datePart}T${seconds}.${millis}Z`).getTime();
}

function verifyHeap(heap, par, isBidHeap) {
  const heapArray = heap.toArray();
  for (let i = 0; i < heapArray.length; i++) {
    const left = 2 * i + 1;
    const right = 2 * i + 2;

    if (isBidHeap) {
      if (left < heapArray.length && heapArray[i].preco < heapArray[left].preco) {
        inconsistencies.push({
          type: 'HeapPropertyViolation',
          heapType: 'bid',
          par,
          index: i,
          parentPreco: heapArray[i].preco,
          leftChildPreco: heapArray[left].preco,
          timestamp: formatTime(new Date()),
        });
      }
      if (right < heapArray.length && heapArray[i].preco < heapArray[right].preco) {
        inconsistencies.push({
          type: 'HeapPropertyViolation',
          heapType: 'bid',
          par,
          index: i,
          parentPreco: heapArray[i].preco,
          rightChildPreco: heapArray[right].preco,
          timestamp: formatTime(new Date()),
        });
      }
    } else {
      if (left < heapArray.length && heapArray[i].preco > heapArray[left].preco) {
        inconsistencies.push({
          type: 'HeapPropertyViolation',
          heapType: 'ask',
          par,
          index: i,
          parentPreco: heapArray[i].preco,
          leftChildPreco: heapArray[left].preco,
          timestamp: formatTime(new Date()),
        });
      }
      if (right < heapArray.length && heapArray[i].preco > heapArray[right].preco) {
        inconsistencies.push({
          type: 'HeapPropertyViolation',
          heapType: 'ask',
          par,
          index: i,
          parentPreco: heapArray[i].preco,
          rightChildPreco: heapArray[right].preco,
          timestamp: formatTime(new Date()),
        });
      }
    }
  }
}

function reconstructHeap(par, type) {
  const heap = type === 'bid' ? bidHeaps[par] : askHeaps[par];
  heap.clear();
  for (const { exchange } of exchanges) {
    const cotacao = cotacoes[exchange][par];
    if (cotacao && Number(cotacao[type === 'bid' ? 'bidAmount' : 'askAmount']) > 0) {
      heap.push({
        preco: Number(cotacao[type === 'bid' ? 'bid' : 'ask']),
        amount: Number(cotacao[type === 'bid' ? 'bidAmount' : 'askAmount']),
        time: cotacao[type === 'bid' ? 'bidTime' : 'askTime'],
        exchange: exchange
      });
    }
  }
}

function updateBests(exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime) {
  const startTime = performance.now();
  const now = Date.now();
  const maxAge = 1000; // Delta de tempo (1s)
  let bidChanged = false;
  let askChanged = false;

  // Atualização incremental
  if (bid !== null && bid !== undefined && Number(bidAmount) > 0) {
    const bidEntry = { preco: Number(bid), amount: Number(bidAmount), time: bidTime, exchange };
    let heapArray = bidHeaps[par].toArray();
    const existingIndex = heapArray.findIndex(e => e.exchange === exchange);
    if (existingIndex !== -1) heapArray.splice(existingIndex, 1);
    heapArray.push(bidEntry);
    bidHeaps[par] = new Heap((a, b) => b.preco - a.preco);
    heapArray.forEach(item => bidHeaps[par].push(item));
  }

  if (ask !== null && ask !== undefined && Number(askAmount) > 0) {
    const askEntry = { preco: Number(ask), amount: Number(askAmount), time: askTime, exchange };
    let heapArray = askHeaps[par].toArray();
    const existingIndex = heapArray.findIndex(e => e.exchange === exchange);
    if (existingIndex !== -1) heapArray.splice(existingIndex, 1);
    heapArray.push(askEntry);
    askHeaps[par] = new Heap((a, b) => a.preco - b.preco);
    heapArray.forEach(item => askHeaps[par].push(item));
  }

  // Validação seletiva do melhor preço
  let bestBid = bidHeaps[par].peek() || { preco: 0, amount: 0, time: formatTime(new Date(now)), exchange: '' };
  let bestAsk = askHeaps[par].peek() || { preco: Infinity, amount: 0, time: formatTime(new Date(now)), exchange: '' };

  // Verificar incongruência para bid
  if (bestBid.amount > 0 && bestBid.exchange) {
    const cotacao = cotacoes[bestBid.exchange][par];
    if (!cotacao || cotacao.bid !== String(bestBid.preco) || Number(cotacao.bidAmount) === 0 || now - parseTime(bestBid.time) > maxAge) {
      reconstructHeap(par, 'bid');
      bestBid = bidHeaps[par].peek() || { preco: 0, amount: 0, time: formatTime(new Date(now)), exchange: '' };
    }
  }

  // Verificar incongruência para ask
  if (bestAsk.amount > 0 && bestAsk.exchange) {
    const cotacao = cotacoes[bestAsk.exchange][par];
    if (!cotacao || cotacao.ask !== String(bestAsk.preco) || Number(cotacao.askAmount) === 0 || now - parseTime(bestAsk.time) > maxAge) {
      reconstructHeap(par, 'ask');
      bestAsk = askHeaps[par].peek() || { preco: Infinity, amount: 0, time: formatTime(new Date(now)), exchange: '' };
    }
  }

  // Atualizar bests
  if (bests[par].bid.preco !== bestBid.preco || bests[par].bid.exchange !== bestBid.exchange) bidChanged = true;
  if (bests[par].ask.preco !== bestAsk.preco || bests[par].ask.exchange !== bestAsk.exchange) askChanged = true;
  bests[par].bid = {
    preco: bestBid.preco,
    amount: bestBid.amount,
    time: cotacoes[bestBid.exchange] && cotacoes[bestBid.exchange][par] ? cotacoes[bestBid.exchange][par].bidTime : formatTime(new Date(now)),
    exchange: bestBid.exchange
  };
  bests[par].ask = {
    preco: bestAsk.preco,
    amount: bestAsk.amount,
    time: cotacoes[bestAsk.exchange] && cotacoes[bestAsk.exchange][par] ? cotacoes[bestAsk.exchange][par].askTime : formatTime(new Date(now)),
    exchange: bestAsk.exchange
  };

  verifyHeap(bidHeaps[par], par, true);
  verifyHeap(askHeaps[par], par, false);

  if ((bidChanged || askChanged) && !isArbitragePaused) {
    previousBests[par].bid.preco = bests[par].bid.preco;
    previousBests[par].ask.preco = bests[par].ask.preco;
    updateCountTotal++;
    updateCountWindow++;
    testaArbitragens();
  }

  const endTime = performance.now();
  updateTimeTotal += (endTime - startTime);
  updateTimeWindow += (endTime - startTime);
}

function atribuirCotacaoExchange(exchange, par, bid = null, bidAmount = null, bidTime = null, ask = null, askAmount = null, askTime = null) {
  const startTime = performance.now();
  const currentTime = new Date().getTime();

  // Calcular latência
  if (bidTime) {
    const latency = currentTime - parseTime(bidTime);
    latencyStatsTotal[exchange].sum += latency;
    latencyStatsTotal[exchange].count++;
    latencyStatsTotal[exchange].max = Math.max(latencyStatsTotal[exchange].max, latency);
    latencyStatsWindow[exchange].sum += latency;
    latencyStatsWindow[exchange].count++;
    latencyStatsWindow[exchange].max = Math.max(latencyStatsWindow[exchange].max, latency);
  }
  if (askTime && askTime !== bidTime) {
    const latency = currentTime - parseTime(askTime);
    latencyStatsTotal[exchange].sum += latency;
    latencyStatsTotal[exchange].count++;
    latencyStatsTotal[exchange].max = Math.max(latencyStatsTotal[exchange].max, latency);
    latencyStatsWindow[exchange].sum += latency;
    latencyStatsWindow[exchange].count++;
    latencyStatsWindow[exchange].max = Math.max(latencyStatsWindow[exchange].max, latency);
  }

  if (!cotacoes[exchange][par]) {
    cotacoes[exchange][par] = { bid: null, bidAmount: null, bidTime: null, ask: null, askAmount: null, askTime: null };
  }

  if (bid !== null && bidAmount !== null) {
    if (isNaN(bid) || bid <= 0 || isNaN(bidAmount) || bidAmount < 0 || !bidTime) {
      inconsistencies.push({
        type: 'InvalidBidData',
        exchange,
        par,
        bid,
        bidAmount,
        bidTime,
        timestamp: formatTime(new Date()),
      });
      cotacoes[exchange][par].bid = '0';
      cotacoes[exchange][par].bidAmount = '0';
      cotacoes[exchange][par].bidTime = formatTime(new Date());
    } else {
      let isValidBid = false;
      const dolarMoedaPar = dolar + moeda;
      const criptoDolarPar = cripto + dolar;
      const criptoMoedaPar = cripto + moeda;

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
  }

  if (ask !== null && askAmount !== null) {
    if (isNaN(ask) || ask <= 0 || isNaN(askAmount) || askAmount < 0 || !askTime) {
      inconsistencies.push({
        type: 'InvalidAskData',
        exchange,
        par,
        ask,
        askAmount,
        askTime,
        timestamp: formatTime(new Date()),
      });
      cotacoes[exchange][par].ask = '9007199254740991';
      cotacoes[exchange][par].askAmount = '0';
      cotacoes[exchange][par].askTime = formatTime(new Date());
    } else {
      let isValidAsk = false;
      const dolarMoedaPar = dolar + moeda;
      const criptoDolarPar = cripto + dolar;
      const criptoMoedaPar = cripto + moeda;

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
  }

  updateBests(exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime);

  const endTime = performance.now();
  updateTimeTotal += (endTime - startTime);
  updateTimeWindow += (endTime - startTime);
}

function inicializarWorkers(codigosFormaPares) {
  const workers = [];
  exchanges.forEach(({ exchange }) => {
    codigosFormaPares.forEach((codigosDePar) => {
      const workerPath = path.join(__dirname, `worker${exchange}.js`);
      const worker = new Worker(workerPath, { workerData: { codigosDePar } });
      worker.on('message', (mensagem) => {
        const { exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime } = mensagem;
        atribuirCotacaoExchange(exchange, par, bid, bidAmount, bidTime, ask, askAmount, askTime);
      });
      worker.on('error', (err) => console.error(`Erro no Worker para ${exchange} - ${codigosDePar}:`, err));
      worker.on('exit', (code) => { if (code !== 0) console.error(`Worker para ${exchange} - ${codigosDePar} saiu com código ${code}`); });
      workers.push(worker);
    });
  });
  return workers;
}

function testaArbitragens() {
  const time = formatTime(new Date());
  const vendeDomesticamente = (bests[cripto + moeda].bid.preco / (bests[dolar + moeda].ask.preco * bests[cripto + dolar].ask.preco) - 1).toFixed(5);
  const compraDomesticamente = (bests[cripto + dolar].bid.preco * bests[dolar + moeda].bid.preco / bests[cripto + moeda].ask.preco - 1).toFixed(5);
  console.log(`[Arbitragem] ${time} - VD: ${vendeDomesticamente}, CD: ${compraDomesticamente}`);

  if (vendeDomesticamente > gatilho || compraDomesticamente > gatilho) {
    arbitrageCountTotal++;
    arbitrageCountWindow++;
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

    outputConsole.push(separator);
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
      outputFile.push('INCONSISTENCIES:');
      outputFile.push(JSON.stringify(inconsistencies.slice(-50), null, 2));
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
  fs.appendFileSync('saidaV1.txt', output, (err) => {
    if (err) console.error('Erro ao gravar em saidaV1.txt:', err);
  });
}

function getPerformanceMetrics() {
  const runtime = (Date.now() - startDate.getTime()) / 1000; // em segundos
  const heapSizes = {};
  codigosFormaPares.forEach(([c1, c2]) => {
    const par = c1 + c2;
    heapSizes[par] = {
      bidHeapSize: bidHeaps[par].size(),
      askHeapSize: askHeaps[par].size(),
    };
  });

  const avgUpdateTimeTotal = updateCountTotal > 0 ? (updateTimeTotal / updateCountTotal).toFixed(3) : 0;
  const avgUpdateTimeWindow = updateCountWindow > 0 ? (updateTimeWindow / updateCountWindow).toFixed(3) : 0;
  const updateRateTotal = runtime > 0 ? (updateCountTotal / runtime).toFixed(2) : 0;
  const updateRateWindow = updateCountWindow > 0 ? (updateCountWindow / 30).toFixed(2) : 0;

  const latencyMetrics = {};
  exchanges.forEach(({ exchange }) => {
    latencyMetrics[exchange] = {
      avgLatency: {
        window: latencyStatsWindow[exchange].count > 0 ? (latencyStatsWindow[exchange].sum / latencyStatsWindow[exchange].count).toFixed(2) : 0,
        total: latencyStatsTotal[exchange].count > 0 ? (latencyStatsTotal[exchange].sum / latencyStatsTotal[exchange].count).toFixed(2) : 0
      },
      maxLatency: {
        window: latencyStatsWindow[exchange].max.toFixed(2),
        total: latencyStatsTotal[exchange].max.toFixed(2)
      }
    };
  });

  return {
    heapSizes: Object.keys(heapSizes).reduce((acc, par) => ({
      ...acc,
      [par]: {
        bidHeapSize: `${heapSizes[par].bidHeapSize} - ${heapSizes[par].bidHeapSize}`,
        askHeapSize: `${heapSizes[par].askHeapSize} - ${heapSizes[par].askHeapSize}`
      }
    }), {}),
    avgUpdateTime: `${avgUpdateTimeWindow}ms - ${avgUpdateTimeTotal}ms`,
    updateRate: `${updateRateWindow}/s - ${updateRateTotal}/s`,
    inconsistencyCount: `${inconsistencies.length - inconsistencies.length} - ${inconsistencies.length}`,
    arbitrageCount: `${arbitrageCountWindow} - ${arbitrageCountTotal}`,
    latency: latencyMetrics,
    runtime: `${runtime.toFixed(2)}s`,
    timestamp: formatTime(new Date())
  };
}

function resetWindowMetrics() {
  updateCountWindow = 0;
  updateTimeWindow = 0;
  arbitrageCountWindow = 0;
  exchanges.forEach(({ exchange }) => {
    latencyStatsWindow[exchange].sum = 0;
    latencyStatsWindow[exchange].count = 0;
    latencyStatsWindow[exchange].max = 0;
  });
}

const workers = inicializarWorkers(codigosFormaPares);

fs.writeFileSync('saidaV1.txt', '', (err) => {
  if (err) console.error('Erro ao inicializar saidaV1.txt:', err);
});

const intervalId = setInterval(() => {
  const time = formatTime(new Date());
  console.log(`--- ${time} ---`);
  const snapshotCotacoes = JSON.stringify(cotacoes, null, 2);
  const snapshotBests = JSON.stringify(bests, null, 2);
  const snapshotMetrics = JSON.stringify(getPerformanceMetrics(), null, 2);
  const snapshotOutput = [
    `=== SNAPSHOT ${time} ===`,
    'COTACOES:',
    snapshotCotacoes,
    'BESTS:',
    snapshotBests,
    'METRICS:',
    snapshotMetrics,
    'INCONSISTENCIES:',
    JSON.stringify(inconsistencies.slice(-50), null, 2),
    '===================='
  ].join('\n') + '\n';
  registrarNoLog(snapshotOutput);
  resetWindowMetrics();
}, 30000);

// Parar após 30 minutos (1800 segundos)
setTimeout(() => {
  console.log(`[Final] Métricas finais às ${formatTime(new Date())}`);
  console.log(JSON.stringify(getPerformanceMetrics(), null, 2));
  workers.forEach(worker => worker.terminate());
  clearInterval(intervalId);
}, 1800 * 1000);
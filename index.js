'use strict';

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const express = require('express');
const cors    = require('cors');

// Load .env if present
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf-8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const PORT    = Number(process.env.PORT) || 3300;
const API_KEY = (process.env.GROQ_API_KEY || '').trim();

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are Jubi, the AI assistant for Jubilee Trader — an autonomous algorithmic paper trading platform built in Node.js.

ABOUT JUBILEE TRADER
- 11 autonomous AI agents running 24/7, scanning 19 instruments across Forex, Crypto, Commodities, and Indices
- Paper trading only — no real money is ever at risk. ~$55,000 paper balance
- Strategy: JT-S003 "EMA Pullback v1.2 — Dynamic Regime Management" (active since May 2026)
- Subscription: $49/month Pro tier. NY LLC.

ACTIVE STRATEGY — JT-S003 (EMA Pullback v1.2)
The system runs a 3-gate entry filter before any trade fires:
  Gate 1 — H4 Regime: ADX confirms a trending market. Classifies each instrument as TREND / RANGE / BREAKOUT and routes it to the correct strategy card.
  Gate 2 — H1 Close Confirmation: The last fully-closed H1 bar must close above EMA(20) for longs, below for shorts. Prevents entries on forming candles.
  Gate 3 — M15 Five-Corner Score: Scores 5 technical conditions (EMA alignment, ADX strength, RSI momentum, price structure, candlestick pattern). Minimum score required before entry fires.

Two entry setups:
  - EMA Pullback: price retraces into the EMA zone on H1 after a confirmed trend move
  - BB Squeeze: Bollinger Band compression followed by a directional breakout

PROFIT PROTECTION LADDER
  Level 1 — Breakeven: SL moves to entry at 1.0x risk in profit
  Level 2 — Partial Close: 50% of position closed at 1.5x risk
  Level 3 — Trailing Stop: Activates at 2.0x risk
  Level 4 — Portfolio Lock: When total unrealized P&L exceeds $100, all winning SLs tighten to protect 60% of gain

INSTRUMENTS SCANNED (19 total, every 5 minutes)
  Forex (9): EURUSD, GBPUSD, AUDUSD, USDCAD, USDJPY, NZDUSD, EURJPY, USDCHF, GBPJPY
  Crypto (5): BTC-USD, ETH-USD, SOL-USD, BNB-USD, XRP-USD
  Commodities (2): XAUUSD (Gold), USOIL (Crude Oil)
  Indices (3): US500 (S&P 500), US100 (Nasdaq), DE40 (DAX)

THE 11 AGENTS
  1. CEO Agent, 2. Execution Agent, 3. Risk Agent
  4. FX Analyst (every 30 min), 5. Crypto Analyst (every 20 min), 6. Commodity Analyst (every 45 min)
  7. Research Agent, 8. Backtest Agent, 9. Cost Agent
  10. Lenny (Compliance, every 2 hours), 11. System Health Monitor

STRATEGY CARDS (9 cards, 3 per asset class)
  Conservative: BE 0.8R, Partial 1.0R, Trail 1.2R
  Standard:     BE 1.0R, Partial 1.5R, Trail 2.0R
  Aggressive:   BE 1.5R, Partial 2.0R, Trail 2.5R

PAPER PERFORMANCE (91 trades, May 2026)
  50.5% win rate, Profit Factor 1.60, Net +$6,241

ACCESS: Pro subscription $49/month. Click "Get Access" on the site.

RESPONSE RULES
- Be specific — use real numbers, agent names, gate names from this prompt
- Trader-friendly tone, explain the "why" not just the "what"
- Paper trading only — no live broker connected
- Redirect off-topic questions back to Jubilee Trader`;

// ── Groq REST call (non-streaming, reliable) ─────────────────────────────────
function callGroq(messages) {
  return new Promise((resolve, reject) => {
    // Drop empty / malformed turns and keep history short to conserve tokens
    const clean = messages
      .filter(m => m && typeof m.content === 'string' && m.content.trim())
      .slice(-6);

    const body = JSON.stringify({
      model:      'llama-3.1-8b-instant',
      max_tokens: 500,
      stream:     false,
      messages:   [{ role: 'system', content: SYSTEM }, ...clean],
    });

    const options = {
      hostname: 'api.groq.com',
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Authorization':  `Bearer ${API_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(json.error?.message || `Groq ${res.statusCode}`));
          } else {
            resolve(json.choices[0].message.content);
          }
        } catch (e) {
          reject(new Error('Invalid response from Groq'));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));

app.post('/api/chat', async (req, res) => {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  }

  try {
    const text = await callGroq(msgs.slice(-20));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('[chat-agent]', err.message);
    if (/rate limit|tokens per day|TPD/i.test(err.message)) {
      return res
        .status(429)
        .send("Jubi has hit today's free message limit — please try again later or check back tomorrow.");
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, key: API_KEY ? 'set' : 'missing' }));

app.listen(PORT, () => console.log(`Jubi chat agent -> http://localhost:${PORT}`));

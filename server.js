/**
 * 🛡️ TRUTH-GUARD AI: 2026 ELITE EDITION
 * ---------------------------------------
 * TARGET: r/newsnepal289 (Strict)
 * MODEL: Llama 3.3 70B (Via Groq)
 * PROTECTION: Rate-Limit Queue & Auto-Retry
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Groq = require('groq-sdk');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
const PORT = 3000;
const cache = new NodeCache({ stdTTL: 300 }); // Cache for 5 mins

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

// 🇳🇵 NEPAL ELITE SOURCES (Expanded)
const TRUSTED_DOMAINS = [
    'ekantipur.com', 'kathmandupost.com', 'thehimalayantimes.com',
    'setopati.com', 'onlinekhabar.com', 'ratopati.com',
    'nayapatrikadaily.com', 'annapurnapost.com', 'reuters.com'
].join(',');

// --- UTILS: QUEUE & DELAY ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🛡️ SAFE GENERATOR: Handles 429 Errors with Retries
async function generateSafe(messages, retries = 3) {
    try {
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile", // Best for JSON
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        if (retries > 0 && error.status === 429) {
            console.log(`⚠️ Rate limit hit. Pausing 3s...`);
            await sleep(3000);
            return generateSafe(messages, retries - 1);
        }
        console.error("❌ AI Error:", error.message);
        return null;
    }
}

// 🕵️ CONTEXT FETCH (NewsAPI)
async function getVerifiedContext(headline) {
    if (!process.env.NEWS_API_KEY) return "API_KEY_MISSING";
    
    // Clean headline: remove special chars, keep first 6 words
    const query = headline.replace(/[^\w\s]/gi, '').split(' ').slice(0, 6).join(' ');

    try {
        const res = await axios.get(`https://newsapi.org/v2/everything`, {
            params: {
                q: query,
                domains: TRUSTED_DOMAINS,
                sortBy: 'relevancy',
                pageSize: 2,
                apiKey: process.env.NEWS_API_KEY
            }
        });
        
        if (!res.data.articles?.length) return "NO_MATCHING_SOURCES";
        return res.data.articles.map(a => `[${a.source.name}] ${a.title}`).join(' | ');
    } catch (e) { return "SEARCH_FAILED"; }
}

// --- MAIN ENDPOINT ---
app.get('/api/verify-news', async (req, res) => {
    try {
        const TARGET_SUB = 'newsnepal289';
        console.log(`📡 Connecting to r/${TARGET_SUB}...`);

        // 1. Fetch from Reddit (Strict User-Agent to avoid blocking)
        let redditRes;
        try {
            redditRes = await axios.get(`https://www.reddit.com/r/${TARGET_SUB}/hot.json?limit=10`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
            });
        } catch (e) {
            return res.status(404).json({ error: `r/${TARGET_SUB} not found or private.` });
        }

        const rawPosts = redditRes.data.data.children;
        if (!rawPosts.length) return res.json([]);

        // Filter valid posts
        const posts = rawPosts
            .filter(p => !p.data.stickied && p.data.title.length > 10)
            .map(p => ({ title: p.data.title, url: p.data.url }));

        const results = [];

        // 2. PROCESS QUEUE (One by One to save Rate Limits)
        for (const post of posts) {
            console.log(`🔍 Analyzing: "${post.title.substring(0, 15)}..."`);
            
            // Step A: Get Context
            const context = await getVerifiedContext(post.title);
            
            // Step B: AI Analysis
            const messages = [
                {
                    role: "system",
                    content: "You are a Nepali News Verification AI. Output JSON only."
                },
                {
                    role: "user",
                    content: `
                    ANALYZE CLAIM: "${post.title}"
                    VERIFIED CONTEXT: "${context}"

                    RULES:
                    1. If CONTEXT is "NO_MATCHING_SOURCES", likely "Unverified" or "Fake".
                    2. Detect Propaganda (Nationalist bait, Fear mongering).
                    3. Score Truth (0-100) and Propaganda (0-100).

                    RETURN JSON:
                    {
                      "verdict": "Real" | "Fake" | "Misleading" | "Unverified",
                      "truthScore": 0-100,
                      "propaganda_score": 0-100,
                      "category": "Politics" | "Social" | "Economy",
                      "explanation": "Short reason.",
                      "news_type": "Reddit"
                    }
                    `
                }
            ];

            const analysis = await generateSafe(messages);
            
            if (analysis) {
                results.push({ claim: post.title, url: post.url, ...analysis });
            }

            // CRITICAL: Throttle request to 1 per second for Groq Free Tier
            await sleep(1200);
        }

        res.json(results);

    } catch (error) {
        console.error("🔥 Server Error:", error.message);
        res.status(500).json([]);
    }
});

// Chat Agent
app.post('/api/chat-agent', async (req, res) => {
    try {
        const reply = await generateSafe([
            { role: "system", content: "You are TruthGuard Nepal." },
            { role: "user", content: req.body.message }
        ]);
        res.json({ reply: reply?.explanation || "System busy." });
    } catch (e) { res.status(500).json({ reply: "Error." }); }
});

app.listen(PORT, () => console.log(`🚀 NEPAL GUARD LIVE: http://localhost:${PORT}`));
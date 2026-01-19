/**
 * 🛡️ TRUTH-GUARD AI: 2026 MONGODB EDITION (FIXED)
 * ---------------------------------------
 * STRATEGY: Strict Separation of Global vs Local News in DB
 */

import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import Parser from 'rss-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import mongoose from 'mongoose';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new Parser();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://sohail:7867@cluster0.ukqw7tb.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- MONGOOSE SCHEMA ---
const ArticleSchema = new mongoose.Schema({
  title: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  source: String,
  verdict: String,
  truthScore: Number,
  propaganda_score: Number,
  explanation: String,
  category: String, // 'Global' or 'Local'
  image_keywords: String,
  createdAt: { type: Date, default: Date.now }
});

const Article = mongoose.model('Article', ArticleSchema);

app.use(cors());
app.use(express.json());

const TRUSTED_DOMAINS = 'ekantipur.com,kathmandupost.com,thehimalayantimes.com,setopati.com,reuters.com';

const GLOBAL_SOURCES = [
    { name: "The Onion", url: "https://www.theonion.com/rss", type: "Satire" },
    { name: "Daily Mail", url: "https://www.dailymail.co.uk/news/index.rss", type: "Sensationalist" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- UTILS ---

async function generateSafe(messages, retries = 3) {
    try {
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.1-8b-instant",
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        if (retries > 0 && error.status === 429) {
            console.log(`⚠️ Groq Rate Limit. Cooling down 1s...`);
            await sleep(1000);
            return generateSafe(messages, retries - 1);
        }
        return null;
    }
}

async function getVerifiedContext(headline, isGlobal = false) {
    if (!process.env.NEWS_API_KEY) return "API_KEY_MISSING";
    const query = headline.replace(/[^\w\s]/gi, '').split(' ').slice(0, 5).join(' ');
    const domains = isGlobal ? 'reuters.com,bbc.com,apnews.com,bloomberg.com' : TRUSTED_DOMAINS;

    try {
        const res = await axios.get(`https://newsapi.org/v2/everything`, {
            params: { q: query, domains: domains, pageSize: 1, apiKey: process.env.NEWS_API_KEY }
        });
        if (!res.data.articles?.length) return "NO_MATCHING_SOURCES";
        return res.data.articles.map(a => `[${a.source.name}] ${a.title}`).join(' | ');
    } catch (e) { return "SEARCH_UNAVAILABLE"; }
}

// 🛡️ BATCH PROCESSOR WITH DB CHECK
async function processBatchWithDB(items, batchSize, processFn) {
    const results = [];
    const newItems = [];
    
    // 1. Filter out items already in DB
    for (const item of items) {
        const exists = await Article.findOne({ title: item.title });
        if (!exists) {
            newItems.push(item);
        }
    }

    if (newItems.length === 0) return [];

    console.log(`⚡ Processing ${newItems.length} new articles...`);

    // 2. Process only new items
    for (let i = 0; i < newItems.length; i += batchSize) {
        const batch = newItems.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(item => processFn(item)));
        
        for (const res of batchResults) {
            if (res) {
                try {
                    await Article.create({
                        title: res.title || res.claim,
                        url: res.url,
                        source: res.source,
                        verdict: res.verdict,
                        truthScore: res.truthScore,
                        propaganda_score: res.propaganda_score,
                        explanation: res.explanation,
                        category: res.category, // This will be 'Global' or 'Local'
                        image_keywords: res.image_keywords
                    });
                    results.push(res);
                } catch (dbErr) {
                    console.error("DB Save Error:", dbErr.message);
                }
            }
        }
        if (i + batchSize < newItems.length) await sleep(500); 
    }
    return results;
}

// --- 🇳🇵 NEPAL ENDPOINT ---
app.get('/api/verify-news', async (req, res) => {
    try {
        // 1. Fetch DB Data FIRST (Instant Load)
        const dbArticles = await Article.find({ category: { $ne: 'Global' } })
                                        .sort({ createdAt: -1 })
                                        .limit(20);
        
        // If we have data, return it immediately to make UI fast
        // We will trigger scraping in background, or just return what we have
        // To keep it simple for now, we return DB data + trigger scrape if DB is empty-ish
        if (dbArticles.length > 5) {
             res.json(dbArticles);
             // Optional: Trigger background scrape here without awaiting
             return; 
        }

        // If DB is empty, scrape synchronously
        let posts = [];
        let sourceUsed = "RSS Live";
        const TARGETS = ['newsnepal289', 'nepalsocial', 'nepal'];
        
        for (const sub of TARGETS) {
            try {
                const feed = await parser.parseURL(`https://www.reddit.com/r/${sub}/new.rss`);
                if (feed.items.length > 0) {
                    posts = feed.items.map(item => ({ title: item.title, url: item.link }));
                    sourceUsed = `r/${sub}`;
                    break;
                }
            } catch (e) {}
        }

        if (posts.length > 0) {
             await processBatchWithDB(posts, 3, async (post) => {
                const context = await getVerifiedContext(post.title, false);
                const analysis = await generateSafe([
                    { role: "system", content: "You are TruthGuard AI. Output JSON." },
                    { role: "user", content: `ANALYZE: "${post.title}"\nCONTEXT: "${context}"\nJSON: { "verdict": "Real"|"Fake"|"Unverified", "truthScore": 0-100, "propaganda_score": 0-100, "explanation": "Short reason.", "category": "Local", "image_keywords": "visual keywords" }` }
                ]);
                return analysis ? { ...post, ...analysis, source: sourceUsed } : null;
            });
        }

        // Fetch again after scrape
        const finalArticles = await Article.find({ category: { $ne: 'Global' } }).sort({ createdAt: -1 }).limit(20);
        res.json(finalArticles);

    } catch (error) { 
        res.status(500).json([]); 
    }
});

// --- 🌍 GLOBAL ENDPOINT ---
app.get('/api/global-news', async (req, res) => {
    try {
        // 1. Fetch Global DB Data FIRST
        const dbGlobal = await Article.find({ category: 'Global' }).sort({ createdAt: -1 }).limit(20);
        
        if (dbGlobal.length > 5) {
            res.json(dbGlobal);
            return;
        }

        let allPosts = [];
        for (const source of GLOBAL_SOURCES) {
            try {
                const feed = await parser.parseURL(source.url);
                allPosts.push(...feed.items.slice(0, 5).map(i => ({ title: i.title, url: i.link, source: source.name })));
            } catch (e) { console.log(`Skipping ${source.name}`); }
        }

        await processBatchWithDB(allPosts, 3, async (post) => {
            const context = await getVerifiedContext(post.title, true);
            const analysis = await generateSafe([
                { role: "system", content: "Satire Detector. Output JSON." },
                { role: "user", content: `
                    CLAIM: "${post.title}"
                    SOURCE: "${post.source}"
                    VERIFIED FACTS: "${context}"
                    JSON: { "verdict": "Real"|"Fake"|"Satire", "truthScore": 0-100, "propaganda_score": 0-100, "explanation": "Why?", "category": "Global", "image_keywords": "visual keywords" }` 
                }
            ]);
            return analysis ? { ...post, ...analysis, source_unreliable: post.source } : null;
        });

        const finalGlobal = await Article.find({ category: 'Global' }).sort({ createdAt: -1 }).limit(20);
        res.json(finalGlobal);

    } catch (error) { res.status(500).json([]); }
});

app.post('/api/chat-agent', async (req, res) => {
    const reply = await generateSafe([{ role: "user", content: req.body.message }]);
    res.json({ reply: reply?.explanation || "System busy." });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 NEPAL GUARD LIVE ON PORT ${PORT}`));

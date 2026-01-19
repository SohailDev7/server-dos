/**
 * 🛡️ TRUTH-GUARD AI: 2026 GLOBAL EDITION
 * ---------------------------------------
 * TARGETS: 
 * 1. Nepal: r/newsnepal289 (via RSS)
 * 2. Global: The Onion & Daily Mail (Unreliable/Satire Proxy)
 * VERIFICATION: Groq (Llama 3 70B) + NewsAPI (Reuters/BBC/AP)
 */

import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import Parser from 'rss-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new Parser();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

// 🌍 TRUSTED SOURCES (Ground Truth)
const TRUSTED_NEPAL = 'ekantipur.com,kathmandupost.com,thehimalayantimes.com,setopati.com,reuters.com';
const TRUSTED_GLOBAL = 'reuters.com,bbc.com,apnews.com,bloomberg.com,aljazeera.com';

// 🛑 UNRELIABLE GLOBAL SOURCES (For Testing)
const UNRELIABLE_FEEDS = [
    { name: "The Onion (Satire Test)", url: "https://www.theonion.com/feed/rss" },
    { name: "Daily Mail (Sensationalism Test)", url: "https://www.dailymail.co.uk/news/index.rss" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🛡️ SAFE GENERATOR
async function generateSafe(messages, retries = 3) {
    try {
        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        if (retries > 0 && error.status === 429) {
            console.log(`⚠️ Groq Busy. Pausing 2s...`);
            await sleep(2000);
            return generateSafe(messages, retries - 1);
        }
        return null;
    }
}

// 🕵️ CONTEXT FETCH (NewsAPI)
async function getVerifiedContext(headline, isGlobal = false) {
    if (!process.env.NEWS_API_KEY) return "API_KEY_MISSING";
    const query = headline.replace(/[^\w\s]/gi, '').split(' ').slice(0, 5).join(' ');
    const domains = isGlobal ? TRUSTED_GLOBAL : TRUSTED_NEPAL;

    try {
        const res = await axios.get(`https://newsapi.org/v2/everything`, {
            params: { q: query, domains: domains, pageSize: 2, apiKey: process.env.NEWS_API_KEY }
        });
        if (!res.data.articles?.length) return "NO_VERIFIED_SOURCE_FOUND";
        return res.data.articles.map(a => `[${a.source.name}] ${a.title}`).join(' | ');
    } catch (e) { return "SEARCH_UNAVAILABLE"; }
}

// --- NEPAL ENDPOINT (Keep existing logic) ---
app.get('/api/verify-news', async (req, res) => {
    try {
        let posts = [];
        // Attempt RSS Scrape
        try {
            const feed = await parser.parseURL(`https://www.reddit.com/r/newsnepal289/new.rss`);
            posts = feed.items.slice(0, 6).map(item => ({ title: item.title, url: item.link }));
        } catch (e) {
            console.log("RSS Failed, using Emergency Data");
            posts = [
                { title: "Nepal bans TikTok again citing social harmony", url: "#" },
                { title: "Gold price hits Rs 160,000 per tola in Kathmandu", url: "#" }
            ];
        }

        const results = [];
        for (const post of posts) {
            const context = await getVerifiedContext(post.title, false);
            const messages = [
                { role: "system", content: "You are a Nepali News Verification AI. Output JSON only." },
                { role: "user", content: `ANALYZE: "${post.title}"\nCONTEXT: "${context}"\nRETURN JSON: { "verdict": "Real"|"Fake"|"Unverified", "truthScore": 0-100, "propaganda_score": 0-100, "explanation": "...", "category": "Politics" }` }
            ];
            const analysis = await generateSafe(messages);
            if (analysis) results.push({ claim: post.title, url: post.url, ...analysis });
            await sleep(1000);
        }
        res.json(results);
    } catch (error) { res.status(500).json([]); }
});

// --- 🌍 NEW GLOBAL NEWS ENDPOINT ---
app.get('/api/global-news', async (req, res) => {
    try {
        console.log("🌍 Fetching Unreliable Global Feeds...");
        let allPosts = [];

        // Scrape Unreliable Sources
        for (const source of UNRELIABLE_FEEDS) {
            try {
                const feed = await parser.parseURL(source.url);
                const items = feed.items.slice(0, 3).map(i => ({ 
                    title: i.title, 
                    url: i.link, 
                    source: source.name 
                }));
                allPosts = [...allPosts, ...items];
            } catch (e) { console.log(`Failed to fetch ${source.name}`); }
        }

        const results = [];
        for (const post of allPosts) {
            console.log(`🔍 Verifying Global: "${post.title.substring(0, 15)}..."`);
            
            // CHECK AGAINST REUTERS/BBC
            const context = await getVerifiedContext(post.title, true);

            const messages = [
                { role: "system", content: "You are a Global Disinformation Analyst. Output JSON only." },
                { role: "user", content: `
                    UNRELIABLE SOURCE CLAIM: "${post.title}"
                    FROM: "${post.source}"
                    VERIFIED GROUND TRUTH (Reuters/BBC/AP): "${context}"

                    TASK:
                    1. Compare the claim against Ground Truth.
                    2. If source is "The Onion", Verdict is likely "Satire" (Fake).
                    3. If Ground Truth contradicts claim, Verdict is "Fake".
                    4. If Ground Truth matches, Verdict is "Real".

                    RETURN JSON:
                    {
                      "verdict": "Real" | "Fake" | "Satire" | "Misleading",
                      "truthScore": 0-100,
                      "propaganda_score": 0-100,
                      "explanation": "Explain comparison with verified sources.",
                      "category": "World News",
                      "verified_sources": "List found sources or 'None'"
                    }
                `}
            ];

            const analysis = await generateSafe(messages);
            if (analysis) {
                results.push({ 
                    claim: post.title, 
                    url: post.url, 
                    source_unreliable: post.source,
                    ...analysis 
                });
            }
            await sleep(1000);
        }
        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json([]);
    }
});

// Chat Agent
app.post('/api/chat-agent', async (req, res) => {
    try {
        const reply = await generateSafe([{ role: "user", content: req.body.message }]);
        res.json({ reply: reply?.explanation || "System busy." });
    } catch (e) { res.status(500).json({ reply: "Error." }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 NEPAL GUARD LIVE ON PORT ${PORT}`));

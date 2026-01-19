/**
 * 🛡️ TRUTH-GUARD AI: 2026 RSS EDITION
 * ---------------------------------------
 * STRATEGY: RSS Feeds (Bypasses API Key/OAuth requirements)
 * TARGET: r/newsnepal289, r/nepalsocial
 */

import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import Parser from 'rss-parser'; // 🆕 RSS Parser
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios'; // Keep axios for NewsAPI

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new Parser();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(cors());
app.use(express.json());

const TRUSTED_DOMAINS = 'ekantipur.com,kathmandupost.com,thehimalayantimes.com,setopati.com,reuters.com';

// 🚨 EMERGENCY DATA (If even RSS fails)
const EMERGENCY_HEADLINES = [
    { title: "Nepal bans TikTok again citing social harmony", link: "https://reddit.com/r/nepal" },
    { title: "Gold price hits Rs 160,000 per tola in Kathmandu", link: "https://reddit.com/r/nepal" },
    { title: "Balen Shah announces ban on Indian vehicles in Kathmandu", link: "https://reddit.com/r/nepal" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🛡️ SAFE GENERATOR (Groq)
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

// 🕵️ NEWS API CONTEXT
async function getVerifiedContext(headline) {
    if (!process.env.NEWS_API_KEY) return "API_KEY_MISSING";
    const query = headline.replace(/[^\w\s]/gi, '').split(' ').slice(0, 5).join(' ');
    try {
        const res = await axios.get(`https://newsapi.org/v2/everything`, {
            params: { q: query, domains: TRUSTED_DOMAINS, pageSize: 2, apiKey: process.env.NEWS_API_KEY }
        });
        if (!res.data.articles?.length) return "NO_DIRECT_MATCH";
        return res.data.articles.map(a => `[${a.source.name}] ${a.title}`).join(' | ');
    } catch (e) { return "SEARCH_UNAVAILABLE"; }
}

// --- MAIN ENDPOINT ---
app.get('/api/verify-news', async (req, res) => {
    try {
        let posts = [];
        let sourceUsed = "RSS Live";

        // 1. ATTEMPT RSS SCRAPE (Much harder to block)
        const TARGETS = ['newsnepal289', 'nepalsocial', 'nepal'];
        
        for (const sub of TARGETS) {
            try {
                console.log(`📡 Fetching RSS: r/${sub}...`);
                // Note the .rss extension here
                const feed = await parser.parseURL(`https://www.reddit.com/r/${sub}/new.rss`);
                
                if (feed.items.length > 0) {
                    posts = feed.items
                        .slice(0, 8) // Take top 8
                        .map(item => ({ title: item.title, url: item.link }));
                    sourceUsed = `r/${sub}`;
                    console.log(`✅ Success with r/${sub}`);
                    break;
                }
            } catch (e) {
                console.log(`⚠️ RSS r/${sub} failed: ${e.message}`);
            }
        }

        // 2. FALLBACK TO SNAPSHOT
        if (posts.length === 0) {
            console.log("🚨 RSS BLOCKED. USING EMERGENCY DATA.");
            posts = EMERGENCY_HEADLINES;
            sourceUsed = "Emergency Snapshot";
        }

        const results = [];

        // 3. PROCESS WITH AI
        for (const post of posts) {
            console.log(`🔍 Processing: "${post.title.substring(0, 15)}..."`);
            const context = await getVerifiedContext(post.title);
            
            const messages = [
                { role: "system", content: "You are a Nepali News Verification AI. Output JSON only." },
                { role: "user", content: `ANALYZE CLAIM: "${post.title}"\nCONTEXT: "${context}"\nRETURN JSON: { "verdict": "Real"|"Fake"|"Unverified", "truthScore": 0-100, "propaganda_score": 0-100, "explanation": "...", "category": "Politics" }` }
            ];

            const analysis = await generateSafe(messages);
            if (analysis) {
                results.push({ claim: post.title, url: post.url, ...analysis });
            }
            await sleep(1000); // Be polite to Groq
        }

        res.json(results);

    } catch (error) {
        console.error("🔥 Fatal Error:", error.message);
        res.status(500).json([]);
    }
});

app.post('/api/chat-agent', async (req, res) => {
    try {
        const reply = await generateSafe([{ role: "user", content: req.body.message }]);
        res.json({ reply: reply?.explanation || "System busy." });
    } catch (e) { res.status(500).json({ reply: "Error." }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 NEPAL GUARD LIVE ON PORT ${PORT}`));

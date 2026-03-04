require('dotenv').config();
const admin = require('firebase-admin');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://auramusic-hrz-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const parser = new Parser();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const BOT_AVATAR = "https://api.dicebear.com/7.x/bottts/svg?seed=AuraOracle&backgroundColor=050505,06b6d4&colors=cyan";

// Feed combinati: Mondo, Tecnologia e Musica
const RSS_FEEDS = [
    'http://feeds.bbci.co.uk/news/world/rss.xml', // Mondo / Conflitti / Geopolitica
    'https://www.nme.com/news/music/feed',        // Musica
    'http://feeds.bbci.co.uk/news/technology/rss.xml' // Tech
];

async function getAlreadyPostedLinks() {
    const postedLinks = new Set();
    try {
        const snapshot = await db.ref('posts').orderByChild('authorId').equalTo('aura-ai-bot').limitToLast(100).once('value');
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                if (child.val().sourceLink) postedLinks.add(child.val().sourceLink);
            });
        }
    } catch (error) { console.error("Errore recupero post:", error); }
    return postedLinks;
}

async function generatePostText(title, snippet) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
            Sei 'Aura Oracle', l'IA onnisciente dell'app Aura. Devi dare una notizia agli utenti.
            Titolo: "${title}". Dettagli: "${snippet}".
            
            Scrivi un post social di 2 o 3 frasi. Sii imparziale ma accattivante. 
            Metti sempre una domanda alla fine per stimolare il dibattito e usa 2 o 3 emoji.
            
            DEVI RESTITUIRE UN OGGETTO JSON CON QUESTA ESATTA STRUTTURA:
            {
              "category": "Bolla categoria (es: 🌍 Mondo, ⚔️ Geopolitica, 🎵 Musica, 💻 Tech)",
              "translations": {
                "en": "Testo in inglese...",
                "it": "Testo in italiano...",
                "es": "Testo in spagnolo...",
                "de": "Testo in tedesco...",
                "ro": "Testo in rumeno...",
                "ar": "Testo in arabo..."
              }
            }
            Non aggiungere markdown, scrivi solo il JSON puro.
        `;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text();
        
        const jsonStart = rawText.indexOf('{');
        const jsonEnd = rawText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) rawText = rawText.substring(jsonStart, jsonEnd + 1);
        
        return JSON.parse(rawText);
        
    } catch (error) {
        console.error("Errore generazione AI, uso fallback:", error);
        return {
            category: "📰 Ultime Notizie",
            translations: {
                "en": `🔥 Breaking: ${title}\nWhat are your thoughts?`,
                "it": `🔥 Ultima ora: ${title}\nVoi cosa ne pensate?`,
                "es": `🔥 Última hora: ${title}\n¿Qué opinan?`,
                "de": `🔥 Eilmeldung: ${title}\nWas denkt ihr?`,
                "ro": `🔥 Breaking news: ${title}\nCe părere aveți?`,
                "ar": `🔥 عاجل: ${title}\nما رأيكم؟`
            }
        };
    }
}

async function fetchAndPostNews() {
    console.log("Avvio Aura Oracle Bot (Mondo & Musica)...");
    try {
        const postedLinks = await getAlreadyPostedLinks();
        
        let articleToPost = null;
        
        // Cerca la notizia più recente non ancora pubblicata tra tutti i feed
        for (const feedUrl of RSS_FEEDS) {
            const feed = await parser.parseURL(feedUrl);
            for (const item of feed.items) {
                if (!postedLinks.has(item.link)) {
                    articleToPost = item;
                    break;
                }
            }
            if (articleToPost) break; // Trovata! Esci dai cicli.
        }

        if (!articleToPost) {
            console.log("Nessuna nuova notizia trovata in tutto il mondo. Termino.");
            process.exit(0);
        }

        console.log(`Generazione post per: ${articleToPost.title}`);
        
        // Riceviamo il JSON strutturato da Gemini
        const aiData = await generatePostText(articleToPost.title, articleToPost.contentSnippet || "");

        const postData = {
            authorId: "aura-ai-bot",
            authorName: "Aura Info",
            authorPic: BOT_AVATAR,
            // Salviamo le traduzioni come stringa per mantenere la compatibilità
            text: JSON.stringify(aiData.translations),
            // Salviamo la nuova categoria a bolla!
            category: aiData.category, 
            timestamp: Date.now(),
            type: "text",
            sourceLink: articleToPost.link
        };

        const newPostRef = db.ref('posts').push();
        await newPostRef.set({ id: newPostRef.key, ...postData });
        console.log(`✅ Nuovo post pubblicato! Categoria: ${aiData.category}`);
        process.exit(0);

    } catch (error) {
        console.error("❌ Errore critico:", error);
        process.exit(1);
    }
}

fetchAndPostNews();

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

async function getAlreadyPostedLinks() {
    const postedLinks = new Set();
    try {
        const snapshot = await db.ref('posts').orderByChild('authorId').equalTo('aura-ai-bot').limitToLast(50).once('value');
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
            Sei 'Aura Oracle', un giornalista musicale esperto e l'intelligenza artificiale dell'app Aura.
            Hai questa notizia: "${title}". I dettagli aggiuntivi sono: "${snippet}".
            
            Se i dettagli sono vuoti o brevi, usa la tua conoscenza per scrivere un breve post (max 3 frasi) spiegando il contesto della notizia in modo accattivante.
            Chiudi sempre il post con una domanda rivolta alla community per farli commentare. Usa 2 o 3 emoji.
            
            DEVI TRADURRE IL POST e restituirmi ESATTAMENTE un oggetto JSON valido con queste chiavi: "en", "it", "es", "de", "ro", "ar".
            NON aggiungere markdown, NON aggiungere la scritta \`\`\`json. Solo le parentesi graffe e il contenuto.
        `;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text();
        
        // Pulisce eventuali markdown inseriti per sbaglio da Gemini
        rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        return rawText; // Questo ora è un JSON in formato stringa!
        
    } catch (error) {
        console.error("Errore generazione AI:", error);
        // Fallback JSON in caso di errore
        return JSON.stringify({
            "en": `🔥 Breaking: ${title}\nWhat do you think?`,
            "it": `🔥 Ultime news: ${title}\nCosa ne pensate?`,
            "es": `🔥 Últimas noticias: ${title}\n¿Qué opinan?`,
            "de": `🔥 Aktuelle News: ${title}\nWas denkt ihr?`,
            "ro": `🔥 Știri de ultimă oră: ${title}\nCe părere aveți?`,
            "ar": `🔥 أخبار عاجلة: ${title}\nما رأيكم؟`
        });
    }
}

async function fetchAndPostNews() {
    console.log("Avvio Aura Oracle Bot...");
    try {
        const postedLinks = await getAlreadyPostedLinks();
        // NME è un feed eccellente e ricco di contenuti per la musica
        const feed = await parser.parseURL('https://www.nme.com/news/music/feed');
        
        let articleToPost = null;
        for (const item of feed.items) {
            if (!postedLinks.has(item.link)) {
                articleToPost = item;
                break;
            }
        }

        if (!articleToPost) {
            console.log("Nessuna nuova notizia. Termino.");
            process.exit(0);
        }

        console.log(`Generazione post per: ${articleToPost.title}`);
        const postContentJSON = await generatePostText(articleToPost.title, articleToPost.contentSnippet || "");

        const postData = {
            authorId: "aura-ai-bot",
            authorName: "Aura Oracle",
            // Logo generativo ad alta risoluzione in stile "Bot Sci-Fi"
            authorPic: "https://api.dicebear.com/7.x/bottts/svg?seed=Aura&backgroundColor=050505,06b6d4&colors=cyan",
            text: postContentJSON, // Salviamo la stringa JSON con tutte le lingue
            timestamp: Date.now(),
            type: "text",
            sourceLink: articleToPost.link
        };

        const newPostRef = db.ref('posts').push();
        await newPostRef.set({ id: newPostRef.key, ...postData });
        console.log("✅ Post pubblicato con successo!");
        process.exit(0);

    } catch (error) {
        console.error("❌ Errore critico:", error);
        process.exit(1);
    }
}

fetchAndPostNews();

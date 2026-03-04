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

// Immagine sicura e pulita per il Bot (Funzionante al 100%)
const BOT_AVATAR = "https://api.dicebear.com/7.x/bottts/svg?seed=AuraOracle";

// 1. Funzione per forzare l'AI a scrivere bene e in JSON
async function generatePostText(title, snippet) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
            Sei 'Aura Oracle', un brillante giornalista musicale.
            Titolo notizia: "${title}". Dettagli: "${snippet}".
            
            IGNORA i dettagli se sono vuoti. Scrivi tu un post di 2 o 3 frasi ricche e interessanti su questa notizia, come se stessi parlando a dei fan di musica. Metti sempre una domanda alla fine e usa 2 o 3 emoji.
            
            DEVI TRADURRE IL POST IN PIU' LINGUE E RESTITUIRE SOLO E UNICAMENTE UN OGGETTO JSON. 
            Non aggiungere markdown, non scrivere \`\`\`json. Scrivi solo il dizionario, in questo esatto formato:
            {
              "en": "Testo in inglese...",
              "it": "Testo in italiano...",
              "es": "Testo in spagnolo...",
              "de": "Testo in tedesco...",
              "ro": "Testo in rumeno...",
              "ar": "Testo in arabo..."
            }
        `;

        const result = await model.generateContent(prompt);
        let rawText = result.response.text();
        
        // Pulizia forzata: estrae solo la parte tra parentesi graffe per evitare errori di parsing
        const jsonStart = rawText.indexOf('{');
        const jsonEnd = rawText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            rawText = rawText.substring(jsonStart, jsonEnd + 1);
        }
        
        // Verifica che il JSON non sia rotto
        JSON.parse(rawText);
        return rawText;
        
    } catch (error) {
        console.error("Errore generazione AI, uso fallback:", error);
        return JSON.stringify({
            "en": `🔥 Exciting news: ${title}\nWhat are your thoughts on this?`,
            "it": `🔥 Notizia pazzesca: ${title}\nVoi cosa ne pensate? Fammelo sapere!`,
            "es": `🔥 Noticia increíble: ${title}\n¿Qué opinan de esto?`,
            "de": `🔥 Spannende Neuigkeiten: ${title}\nWas denkt ihr darüber?`,
            "ro": `🔥 Știri incredibile: ${title}\nCe părere aveți?`,
            "ar": `🔥 أخبار مثيرة: ${title}\nما رأيكم في هذا؟`
        });
    }
}

// 2. Funzione magica per AGGIORNARE I VECCHI POST già pubblicati
async function fixOldPosts() {
    console.log("Ricerca di vecchi post da aggiornare e tradurre...");
    const snapshot = await db.ref('posts').orderByChild('authorId').equalTo('aura-ai-bot').once('value');
    
    if (!snapshot.exists()) return;

    const posts = snapshot.val();
    const updates = {};
    
    for (const key in posts) {
        const post = posts[key];
        
        // Se la foto è sbagliata, la prepariamo per l'aggiornamento
        if (post.authorPic !== BOT_AVATAR) {
            updates[`${key}/authorPic`] = BOT_AVATAR;
        }

        // Se il testo non inizia con "{" significa che non è JSON o è sporco di markdown
        if (!post.text || !post.text.trim().startsWith('{')) {
            console.log(`Correggo e traduco il vecchio post: ${post.text.substring(0, 30)}...`);
            
            // Facciamo riscrivere la vecchia notizia in modo corretto
            const fixedJsonText = await generatePostText(post.text, "Migliora questo testo e traducilo nel formato richiesto.");
            updates[`${key}/text`] = fixedJsonText;
            
            // Pausa di 3 secondi tra un post e l'altro per non farci bloccare da Gemini
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    if (Object.keys(updates).length > 0) {
        await db.ref('posts').update(updates);
        console.log("✅ Tutti i vecchi post sono stati aggiornati, tradotti e la foto è stata sistemata!");
    } else {
        console.log("I vecchi post sono già perfetti.");
    }
}

// 3. Logica Principale
async function fetchAndPostNews() {
    console.log("Avvio Aura Oracle Bot...");
    try {
        // SISTEMIAMO IL PASSATO PRIMA DI GUARDARE AL FUTURO
        await fixOldPosts();

        // Controllo link già pubblicati
        const postedLinks = new Set();
        const snapshot = await db.ref('posts').orderByChild('authorId').equalTo('aura-ai-bot').limitToLast(50).once('value');
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                if (child.val().sourceLink) postedLinks.add(child.val().sourceLink);
            });
        }

        // Leggiamo nuove notizie
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

        console.log(`Generazione nuovo post per: ${articleToPost.title}`);
        const postContentJSON = await generatePostText(articleToPost.title, articleToPost.contentSnippet || "");

        const postData = {
            authorId: "aura-ai-bot",
            authorName: "Aura V16",
            authorPic: BOT_AVATAR,
            text: postContentJSON,
            timestamp: Date.now(),
            type: "text",
            sourceLink: articleToPost.link
        };

        const newPostRef = db.ref('posts').push();
        await newPostRef.set({ id: newPostRef.key, ...postData });
        console.log("✅ Nuovo post generato e pubblicato con successo!");
        process.exit(0);

    } catch (error) {
        console.error("❌ Errore critico:", error);
        process.exit(1);
    }
}

fetchAndPostNews();

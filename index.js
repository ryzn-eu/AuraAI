require('dotenv').config();
const admin = require('firebase-admin');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Inizializzazione sicura tramite Variabili d'Ambiente (GitHub Secrets)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // L'URL del tuo database letto dal tuo progetto Aura
  databaseURL: "https://auramusic-hrz-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const parser = new Parser();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. Funzione per leggere la "memoria" da Firebase
async function getAlreadyPostedLinks() {
    const postedLinks = new Set();
    try {
        console.log("Controllo i post precedenti su Firebase...");
        // Peschiamo gli ultimi 50 post del bot per vedere cosa ha già pubblicato
        const snapshot = await db.ref('posts')
            .orderByChild('authorId')
            .equalTo('aura-ai-bot')
            .limitToLast(50)
            .once('value');

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const post = child.val();
                if (post.sourceLink) {
                    postedLinks.add(post.sourceLink);
                }
            });
        }
    } catch (error) {
        console.error("Errore nel recupero dei post precedenti:", error);
    }
    return postedLinks;
}

// 3. Generazione testo con Google Gemini
async function generatePostText(title, snippet, link) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
            Sei 'Aura Oracle', l'intelligenza artificiale ufficiale dell'app musicale Aura.
            Devi creare un breve post social (massimo 2-3 frasi) in italiano partendo da questa notizia musicale.
            Usa un tono informale, accattivante e fai una domanda alla community alla fine per stimolare i commenti.
            Aggiungi emoji pertinenti. Alla fine del testo, vai a capo e scrivi "Fonte: " seguito dal link.
            
            Notizia: ${title}
            Dettagli: ${snippet}
            Link: ${link}
        `;

        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error("Errore durante la generazione AI:", error);
        return `🔥 Ultime news: ${title}\nCosa ne pensate?\nFonte: ${link}`;
    }
}

// 4. Logica principale
async function fetchAndPostNews() {
    console.log(`[${new Date().toLocaleTimeString()}] Avvio Aura Oracle Bot...`);
    
    try {
        // Recuperiamo i link già postati
        const postedLinks = await getAlreadyPostedLinks();
        
        // Leggiamo un feed RSS musicale (Es: Consequence of Sound)
        const feed = await parser.parseURL('https://consequence.net/category/music/feed/');
        
        if (feed.items.length === 0) {
            console.log("Nessuna notizia trovata nel feed.");
            process.exit(0);
        }

        // Cerchiamo la prima notizia che NON è presente in Firebase
        let articleToPost = null;
        for (const item of feed.items) {
            if (!postedLinks.has(item.link)) {
                articleToPost = item;
                break; // Trovata la prima novità, fermiamo il ciclo
            }
        }

        if (!articleToPost) {
            console.log("Tutte le notizie recenti sono già state pubblicate. Nessuna azione necessaria.");
            process.exit(0); // Chiude lo script correttamente per GitHub Actions
        }

        console.log(`Novità trovata: ${articleToPost.title}`);
        
        // Chiediamo all'AI di formulare il post
        const postContent = await generatePostText(
            articleToPost.title, 
            articleToPost.contentSnippet || "", 
            articleToPost.link
        );

        // Prepariamo i dati per Firebase, aggiungendo "sourceLink" come memoria per il futuro
        const postData = {
            authorId: "aura-ai-bot",
            authorName: "Aura Oracle",
            authorPic: "https://i.imgur.com/8q3k3Hk.png", // Inserisci qui il logo della tua AI
            text: postContent,
            timestamp: Date.now(),
            type: "text",
            sourceLink: articleToPost.link // <--- Fondamentale per la memoria!
        };

        // Scriviamo nel nodo 'posts' del tuo Realtime Database
        const newPostRef = db.ref('posts').push();
        await newPostRef.set({ id: newPostRef.key, ...postData });
        
        console.log("✅ Nuovo post pubblicato con successo dall'AI nel feed di Aura!");
        process.exit(0); // Chiude l'istanza con successo

    } catch (error) {
        console.error("❌ Errore critico durante il processo:", error);
        process.exit(1); // Segnala a GitHub che c'è stato un errore
    }
}

fetchAndPostNews();

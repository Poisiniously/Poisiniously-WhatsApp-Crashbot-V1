äconst { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // Modul zum Lesen von Dateien

const PREFIX = '€'; 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Bot ist online und einsatzbereit!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || "";

        if (!text.startsWith(PREFIX)) return;

        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ==================== BEFEHLS-LOGIK ====================
        
        // 1. Das dynamische Menü (lädt aus commands.json)
        if (command === 'menu' || command === 'hilfe' || command === 'help') {
            try {
                // commands.json einlesen und in ein JavaScript-Objekt umwandeln
                const commandsData = JSON.parse(fs.readFileSync('./commands.json', 'utf8'));
                
                let menuText = `*⚙️ POISINIOUSLY BOT MENÜ* ⚙️\n\n` +
                               `Hier ist eine Übersicht aller verfügbaren Befehle. Nutze das Präfix *${PREFIX}* vor jedem Befehl.\n\n`;

                // Schleife durch alle Befehle in der JSON-Datei
                for (const cmd in commandsData) {
                    const info = commandsData[cmd];
                    menuText += `• \`${PREFIX}${info.usage}\` - ${info.description}\n`;
                }

                await sock.sendMessage(from, { text: menuText });
            } catch (error) {
                console.error("Fehler beim Laden der commands.json:", error);
                await sock.sendMessage(from, { text: '❌ Fehler: Die Befehlsliste konnte nicht geladen werden.' });
            }
        }

       // 2. Ping-Befehl mit echter Zeitmessung
        if (command === 'ping') {
            const timestamp = Date.now(); // Aktuelle Zeit in Millisekunden speichern
            
            // Erste Nachricht senden
            const pingMsg = await sock.sendMessage(from, { text: '🏓 *Pong...*' });
            
            // Differenz berechnen (aktuelle Zeit minus Startzeit)
            const latency = Date.now() - timestamp; 

            // Die gesendete Nachricht mit dem echten Ping-Wert aktualisieren (editieren)
            await sock.sendMessage(from, { 
                text: `🏓 *Pong!*\n\n• *Verzögerung:* \`${latency}ms\``,
                edit: pingMsg.key
            });
        }}

        // 3. JID-Befehl (User-ID auslesen)
        if (command === 'jid') {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;

            if (!mentioned || mentioned.length === 0) {
                await sock.sendMessage(from, { text: `⚠️ Bitte markiere einen Nutzer!\nBeispiel: *${PREFIX}jid @Nutzer*` });
                return;
            }

            const targetJid = mentioned[0];
            const responseText = `🆔 *User-JID extrahiert:*\n\n• *Benutzer:* @${targetJid.split('@')[0]}\n• *ID:* \`${targetJid}\``;

            await sock.sendMessage(from, { 
                text: responseText,
                mentions: [targetJid]
            });
        }

        // 4. GJID-Befehl (Gruppen-ID auslesen)
        if (command === 'gjid') {
            if (!from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ Dieser Befehl kann nur innerhalb von Gruppen-Chats verwendet werden.' });
                return;
            }

            const responseText = `👥 *Gruppen-JID extrahiert:*\n\n• *ID:* \`${from}\``;
            await sock.sendMessage(from, { text: responseText });
        }

        // 5. Runtime-Befehl (Laufzeit)
        if (command === 'runtime') {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            
            await sock.sendMessage(from, { text: `⏱️ *Aktuelle Bot-Laufzeit:* ${hours}h ${minutes}m ${seconds}s` });
        }
        // 6. Hidetag-Befehl (Heimliches Erwähnen aller Gruppenmitglieder)
        if (command === 'hidetag') {
            // 1. Prüfen, ob der Befehl in einer Gruppe genutzt wurde
            if (!from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ Dieser Befehl kann nur in Gruppen verwendet werden!' });
                return;
            }

            // 2. Den Text herausfiltern, den der Nutzer mitschicken will
            const messageText = args.join(' ');
            if (!messageText) {
                await sock.sendMessage(from, { text: `⚠️ Bitte gib eine Nachricht an!\nBeispiel: *${PREFIX}hidetag Hallo zusammen!*` });
                return;
            }

            try {
                // 3. Gruppen-Metadaten vom Server abrufen (um die Mitglieder-Liste zu bekommen)
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;

                // 4. Ein Array mit den JIDs aller Mitglieder erstellen
                const jids = participants.map(p => p.id);

                // 5. Die Nachricht senden und das JID-Array im 'mentions'-Feld mitschicken
                await sock.sendMessage(from, { 
                    text: messageText, 
                    mentions: jids 
                });

            } catch (error) {
                console.error("Fehler beim Hidetag:", error);
                await sock.sendMessage(from, { text: '❌ Fehler beim Abrufen der Gruppenmitglieder. Ist der Bot in der Gruppe?' });
            }
            const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
// const sharp = require('sharp'); // REMOVE THE COMMENT TO ACTIVATE THIS! You need to 'npm install sharp' first.

// The designated command prefix
const PREFIX = '€'; 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                : true;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Bot is online and ready!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || "";

        if (!text.startsWith(PREFIX)) return;

        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ==================== BEFEHLS-LOGIK ====================
        
        // 1. The Dynamic Menu (loads from commands.json)
        if (command === 'menu' || command === 'hilfe' || command === 'help') {
            // (Keep your existing Menu logic here, adding the 'sticker' entry manually for now)
            try {
                const commandsData = JSON.parse(fs.readFileSync('./commands.json', 'utf8'));
                let menuText = `*⚙️ POISINIOUSLY BOT MENÜ* ⚙️\n\n` +
                               `Hier ist eine Übersicht aller verfügbaren Befehle. Nutze das Präfix *${PREFIX}* vor jedem Befehl.\n\n`;
                for (const cmd in commandsData) {
                    const info = commandsData[cmd];
                    menuText += `• \`${PREFIX}${info.usage}\` - ${info.description}\n`;
                }
                await sock.sendMessage(from, { text: menuText });
            } catch (error) {
                console.error("Error loading commands.json:", error);
                await sock.sendMessage(from, { text: '❌ Fehler: Die Befehlsliste konnte nicht geladen werden.' });
            }
        }

        // 2. STICKER-MAKER
        if (command === 'sticker' || command === 's' || command === 'stiker') {
            // Check if activated
            // if (typeof sharp === 'undefined') {
            //     return await sock.sendMessage(from, { text: '⚠️ Die Sticker-Funktion ist serverseitig noch nicht konfiguriert (installiere "sharp").' });
            // }

            try {
                // a. Detect if user is replying (quoted) to an image or has one attached to the message
                const isReplyImage = !!msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const isAttachedImage = !!msg.message.imageMessage;
                let targetMessage = null;

                if (isAttachedImage) {
                    targetMessage = msg;
                } else if (isReplyImage) {
                    targetMessage = msg.message.extendedTextMessage.contextInfo;
                } else {
                    return await sock.sendMessage(from, { text: `⚠️ Bitte sende ein Bild mit ${PREFIX}sticker oder antworte auf ein Bild!` });
                }

                // b. Download the original image content (as a buffer)
                const imageContent = isReplyImage 
                    ? targetMessage.quotedMessage.imageMessage 
                    : targetMessage.imageMessage;
                
                const buffer = await sock.downloadMediaMessage({ 
                    message: { imageMessage: imageContent },
                    key: targetMessage.key
                });

                // c. Process the image into a clean, optimized sticker (WEBP format)
                // d. Note: Activation required below.
                // const stickerBuffer = await sharp(buffer)
                //     .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }) // Square, transparent padding
                //     .webp({ quality: 80 }) // Efficient compression
                //     .toBuffer();

                // e. Send the sticker (with empty/invisible title)
                // d. To activate, uncomment these three lines below and comment out lines above.
                // await sock.sendMessage(from, { 
                //     sticker: stickerBuffer,
                //     packname: '\u200B', // Invisible Unicode character (Clean title)
                //     author: '\u200B' // Invisible Unicode character (Clean author)
                // });

                // (Placeholder for inactivated state)
                await sock.sendMessage(from, { text: '🛠️ Sticker-Funktion erkannt! Um sie zu aktivieren, muss der Code in index.js angepasst und die Bibliothek "sharp" installiert werden.' });

            } catch (error) {
                console.error("Sticker process error:", error);
                await sock.sendMessage(from, { text: '❌ Ein Fehler ist bei der Sticker-Erstellung aufgetreten.' });
            }
        }
        // Ganz oben in deiner index.js zu den anderen require-Statements packen:
// const { parsePhoneNumberFromString } = require('libphonenumber-js');

        // 7. Ultimativer Profile-Befehl (Erkennung aller weltweiten Vorwahlen)
        if (command === 'profile' || command === 'profil') {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
            const targetJid = (mentioned && mentioned.length > 0) ? mentioned[0] : msg.key.participant || msg.key.remoteJid;

            try {
                // 1. Profilbild-URL abrufen
                let profilePicUrl;
                try {
                    profilePicUrl = await sock.profilePictureUrl(targetJid, 'image');
                } catch {
                    profilePicUrl = null;
                }

                // 2. Admin-Status prüfen
                let adminStatus = "❌ Kein Admin";
                if (from.endsWith('@g.us')) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const isTargetAdmin = groupMetadata.participants.find(p => p.id === targetJid)?.admin;
                    
                    if (isTargetAdmin === 'admin') {
                        adminStatus = "👑 Gruppen-Admin";
                    } else if (isTargetAdmin === 'superadmin') {
                        adminStatus = "🛡️ Gruppen-Ersteller (Superadmin)";
                    }
                } else {
                    adminStatus = "💬 Privater Chat";
                }

                // 3. Weltweite Vorwahl mit libphonenumber-js analysieren
                const cleanNumber = targetJid.split('@')[0];
                let country = "🌍 Unbekanntes Land";
                
                try {
                    // Wir hängen ein '+' voran, damit die Bibliothek die Nummer als internationale Nummer erkennt
                    const phoneNumber = parsePhoneNumberFromString('+' + cleanNumber);
                    if (phoneNumber && phoneNumber.country) {
                        const countryCode = phoneNumber.country; // Gibt z.B. "DE", "US", "BR" aus
                        
                        // Generiert das passende Flaggen-Emoji aus dem ISO-Code (z.B. "DE" -> 🇩🇪)
                        const flagEmoji = countryCode
                            .toUpperCase()
                            .replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
                        
                        // Wandelt den Ländercode in einen lesbaren deutschen Namen um (für die wichtigsten Länder)
                        const regionNames = new Intl.DisplayNames(['de'], { type: 'region' });
                        const countryName = regionNames.of(countryCode) || countryCode;

                        country = `${flagEmoji} ${countryName} (+${phoneNumber.countryCallingCode})`;
                    }
                } catch (e) {
                    console.error("Fehler bei der Vorwahl-Analyse:", e);
                }

                // 4. Text formatieren
                const infoText = `👤 *NUTZER-PROFIL:*\n\n` +
                                 `• *Nummer:* @${cleanNumber}\n` +
                                 `• *Herkunft:* ${country}\n` +
                                 `• *Status:* ${adminStatus}\n` +
                                 `• *JID:* \`${targetJid}\``;

                // 5. Nachricht senden
                if (profilePicUrl) {
                    await sock.sendMessage(from, { 
                        image: { url: profilePicUrl }, 
                        caption: infoText,
                        mentions: [targetJid]
                    });
                } else {
                    await sock.sendMessage(from, { 
                        text: `🖼️ _Kein Profilbild verfügbar_\n\n` + infoText,
                        mentions: [targetJid]
                    });
                }

            } catch (error) {
                console.error("Fehler beim Abrufen des Profils:", error);
                await sock.sendMessage(from, { text: '❌ Fehler beim Laden der Profil-Informationen.' });
            }
        }
    });
}

connectToWhatsApp();
        
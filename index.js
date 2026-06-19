const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, getDevice } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { parsePhoneNumberFromString } = require('libphonenumber-js'); // Für den Profile-Befehl
// const sharp = require('sharp'); // Aktivieren, sobald 'npm install sharp' ausgeführt wurde

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
        
        // 1. Das dynamische Menü
        if (command === 'menu' || command === 'hilfe' || command === 'help') {
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
                console.error("Fehler beim Laden der commands.json:", error);
                await sock.sendMessage(from, { text: '❌ Fehler: Die Befehlsliste konnte nicht geladen werden.' });
            }
        }

        // 2. Ping-Befehl
        if (command === 'ping') {
            const timestamp = Date.now();
            const pingMsg = await sock.sendMessage(from, { text: '🏓 *Pong...*' });
            const latency = Date.now() - timestamp; 

            await sock.sendMessage(from, { 
                text: `🏓 *Pong!*\n\n• *Verzögerung:* \`${latency}ms\``,
                edit: pingMsg.key
            });
        }

        // 3. JID-Befehl
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

        // 4. GJID-Befehl
        if (command === 'gjid') {
            if (!from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ Dieser Befehl kann nur innerhalb von Gruppen-Chats verwendet werden.' });
                return;
            }

            const responseText = `👥 *Gruppen-JID extrahiert:*\n\n• *ID:* \`${from}\``;
            await sock.sendMessage(from, { text: responseText });
        }

        // 5. Runtime-Befehl
        if (command === 'runtime') {
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            
            await sock.sendMessage(from, { text: `⏱️ *Aktuelle Bot-Laufzeit:* ${hours}h ${minutes}m ${seconds}s` });
        }

        // 6. Hidetag-Befehl
        if (command === 'hidetag') {
            if (!from.endsWith('@g.us')) {
                await sock.sendMessage(from, { text: '❌ Dieser Befehl kann nur in Gruppen verwendet werden!' });
                return;
            }

            const messageText = args.join(' ');
            if (!messageText) {
                await sock.sendMessage(from, { text: `⚠️ Bitte gib eine Nachricht an!\nBeispiel: *${PREFIX}hidetag Hallo zusammen!*` });
                return;
            }

            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;
                const jids = participants.map(p => p.id);

                await sock.sendMessage(from, { 
                    text: messageText, 
                    mentions: jids 
                });
            } catch (error) {
                console.error("Fehler beim Hidetag:", error);
                await sock.sendMessage(from, { text: '❌ Fehler beim Abrufen der Gruppenmitglieder.' });
            }
        }

        // 7. Sticker-Maker Placeholder
        if (command === 'sticker' || command === 's' || command === 'stiker') {
            try {
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

                // Placeholder-Hinweis (aktivierbar via 'sharp')
                await sock.sendMessage(from, { text: '🛠️ Sticker-Funktion erkannt! Um sie zu aktivieren, muss der Code in index.js angepasst und die Bibliothek "sharp" installiert werden.' });

            } catch (error) {
                console.error("Sticker-Fehler:", error);
                await sock.sendMessage(from, { text: '❌ Ein Fehler ist bei der Sticker-Erstellung aufgetreten.' });
            }
        }

        // 8. Profile-Befehl mit automatischer Flaggen-Erkennung
        if (command === 'profile' || command === 'profil') {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
            const targetJid = (mentioned && mentioned.length > 0) ? mentioned[0] : msg.key.participant || msg.key.remoteJid;

            try {
                let profilePicUrl;
                try {
                    profilePicUrl = await sock.profilePictureUrl(targetJid, 'image');
                } catch {
                    profilePicUrl = null;
                }

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

                const cleanNumber = targetJid.split('@')[0];
                let country = "🌍 Unbekanntes Land";
                
                try {
                    const phoneNumber = parsePhoneNumberFromString('+' + cleanNumber);
                    if (phoneNumber && phoneNumber.country) {
                        const countryCode = phoneNumber.country;
                        
                        const flagEmoji = countryCode
                            .toUpperCase()
                            .replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
                        
                        const regionNames = new Intl.DisplayNames(['de'], { type: 'region' });
                        const countryName = regionNames.of(countryCode) || countryCode;

                        country = `${flagEmoji} ${countryName} (+${phoneNumber.countryCallingCode})`;
                    }
                } catch (e) {
                    console.error("Fehler bei der Vorwahl-Analyse:", e);
                }

                const infoText = `👤 *NUTZER-PROFIL:*\n\n` +
                                 `• *Nummer:* @${cleanNumber}\n` +
                                 `• *Herkunft:* ${country}\n` +
                                 `• *Status:* ${adminStatus}\n` +
                                 `• *JID:* \`${targetJid}\``;

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

        // 9. Checkdevice-Befehl (Multi-Latenz-Messung)
        if (command === 'checkdevice') {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
            const targetJid = (mentioned && mentioned.length > 0) ? mentioned[0] : msg.key.participant || msg.key.remoteJid;

            try {
                const baseMsg = await sock.sendMessage(targetJid, { text: '🔄 Analysiere Verbindung...' });
                
                const pings = 5;
                const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
                const sendTimes = {};
                const delays = [];

                await sock.sendMessage(from, { text: `⏳ Starte Multi-Ping-Analyse (${pings} Testsignale) für @${targetJid.split('@')[0]}...`, mentions: [targetJid] });

                const multiReceiptListener = async (receipts) => {
                    for (const receipt of receipts) {
                        if (receipt.jid === targetJid && receipt.ack === 2) {
                            if (receipt.ids) {
                                for (const id of receipt.ids) {
                                    if (sendTimes[id] && !sendTimes[id].received) {
                                        sendTimes[id].received = Date.now();
                                        const singleDelay = sendTimes[id].received - sendTimes[id].sent;
                                        delays.push(singleDelay);
                                        
                                        if (delays.length === pings) {
                                            sock.ev.off('messages.update', multiReceiptListener);
                                            finalizeAnalysis(delays, from, targetJid, sock);
                                        }
                                    }
                                }
                            }
                        }
                    }
                };

                sock.ev.on('messages.update', multiReceiptListener);

                for (let i = 0; i < pings; i++) {
                    const reactMsg = await sock.sendMessage(targetJid, {
                        react: { text: emojis[i], key: baseMsg.key }
                    });
                    
                    sendTimes[reactMsg.key.id] = {
                        sent: Date.now(),
                        received: null
                    };

                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                setTimeout(() => {
                    if (delays.length < pings) {
                        sock.ev.off('messages.update', multiReceiptListener);
                        if (delays.length > 0) {
                            finalizeAnalysis(delays, from, targetJid, sock, true);
                        } else {
                            sock.sendMessage(from, { text: '❌ Analyse abgebrochen. Das Zielgerät hat nicht rechtzeitig geantwortet.' });
                        }
                    }
                }, 10000);

            } catch (error) {
                console.error("Fehler beim Multi-Ping:", error);
            }
        }
    });
}

// Global deklarierte Hilfsfunktion für die Latenz-Auswertung
async function finalizeAnalysis(delays, from, targetJid, sock, incomplete = false) {
    const sum = delays.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / delays.length);

    const min = Math.min(...delays);
    const max = Math.max(...delays);
    const variance = max - min;

    let verdict = "📱 Hohe Wahrscheinlichkeit für direktes Smartphone";
    if (average > 450 || variance > 300) {
        verdict = "💻 Erhöhte Tendenz zu WhatsApp Web / PC (oder instabilem Mobilfunk)";
    }

    const statusText = incomplete ? "⚠️ *Analyse unvollständig (Timeout), Teil-Auswertung:*\n\n" : "📊 *ERGEBNIS DER MULTI-LATENZ-ANALYSE:*\n\n";

    await sock.sendMessage(from, {
        text: statusText +
               `• *Ziel:* @${targetJid.split('@')[0]}\n` +
               `• *Erfolgreiche Pings:* \`${delays.length}\`\n` +
               `• *Durchschnitts-Latenz:* \`${average} ms\`\n` +
               `• *Schwankung (Min/Max):* \`${min} ms\` bis \`${max} ms\`\n\n` +
               `• *Einschätzung:* ${verdict}`,
        mentions: [targetJid]
        // 10. Native Geräte-Erkennung (Zitieren-Methode)
        if (command === 'device') {
            // Wir prüfen, ob auf eine Nachricht geantwortet wurde
            const quotedMsgId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
            const targetJid = msg.message.extendedTextMessage?.contextInfo?.participant;

            if (!quotedMsgId) {
                await sock.sendMessage(from, { text: `⚠️ Bitte antworte (zitiere) auf eine Nachricht der Person mit *${PREFIX}device*, um das Gerät zu ermitteln!` });
                return;
            }

            try {
                // Baileys native Funktion liest den Hash der Message-ID aus
                const deviceType = getDevice(quotedMsgId);
                
                let deviceName = "❓ Unbekanntes Gerät";
                let icon = "📱";

                // Auswertung des Fingerabdrucks
                if (deviceType === 'android') { 
                    deviceName = "Android Smartphone"; 
                    icon = "🤖"; 
                } else if (deviceType === 'web') { 
                    deviceName = "WhatsApp Web / Desktop"; 
                    icon = "💻"; 
                } else if (deviceType === 'ios') { 
                    deviceName = "Apple iOS (iPhone)"; 
                    icon = "🍎"; 
                } else if (deviceType === 'baileys' || deviceType === 'bot') { 
                    deviceName = "Bot / Skript (Baileys o.ä.)"; 
                    icon = "⚙️"; 
                }

                const replyText = `${icon} *NATIVE GERÄTE-ANALYSE* ${icon}\n\n` +
                                  `• *Nutzer:* @${targetJid.split('@')[0]}\n` +
                                  `• *Erkanntes Gerät:* \`${deviceName}\`\n` +
                                  `• *System-Typ:* \`${deviceType}\``;

                await sock.sendMessage(from, { 
                    text: replyText, 
                    mentions: [targetJid] 
                });

            } catch (error) {
                console.error("Fehler bei der Geräte-Erkennung:", error);
                await sock.sendMessage(from, { text: '❌ Fehler beim Auslesen der Metadaten.' });
            }
        }
        // 11. Ban-Checker (Prüft, ob eine Nummer auf WhatsApp existiert/gebannt wurde)
        if (command === 'bancheck' || command === 'checkban') {
            let targetNumber = args[0];

            // Wenn keine Nummer mitgegeben wurde, aber auf eine Nachricht geantwortet wurde
            const quotedJid = msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!targetNumber && quotedJid) {
                targetNumber = quotedJid.split('@')[0];
            }

            if (!targetNumber) {
                await sock.sendMessage(from, { 
                    text: `⚠️ Bitte gib eine Nummer an oder antworte auf die Nachricht von jemandem!\nBeispiel: *${PREFIX}bancheck 4917612345678*` 
                });
                return;
            }

            // Bereinige die Nummer (entferne +, Leerzeichen, Striche)
            let cleanNumber = targetNumber.replace(/[^0-9]/g, '');

            // Falls jemand die Nummer mit "00" statt "+" eingibt
            if (cleanNumber.startsWith('00')) {
                cleanNumber = cleanNumber.substring(2);
            }

            await sock.sendMessage(from, { text: `🔍 Prüfe Server-Status für Nummer: \`+${cleanNumber}\`...` });

            try {
                // Baileys eigene Funktion, um die Existenz auf den WA-Servern zu prüfen
                const [result] = await sock.onWhatsApp(cleanNumber);

                if (result && result.exists) {
                    // Die Nummer existiert auf WhatsApp -> Also NICHT gebannt
                    const jid = result.jid;
                    
                    // Wir versuchen das Land herauszufinden für schönere Infos
                    let countryStr = "";
                    try {
                        const phoneNumber = parsePhoneNumberFromString('+' + cleanNumber);
                        if (phoneNumber && phoneNumber.country) {
                            const countryCode = phoneNumber.country;
                            const flagEmoji = countryCode.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
                            const regionNames = new Intl.DisplayNames(['de'], { type: 'region' });
                            countryStr = `\n• *Herkunft:* ${flagEmoji} ${regionNames.of(countryCode)}`;
                        }
                    } catch (_) {}

                    await sock.sendMessage(from, {
                        text: `✅ *STATUS: AKTIV*\n\n• *Nummer:* \`+${cleanNumber}\`\n• *WhatsApp JID:* \`${jid}\`${countryStr}\n\nℹ️ Diese Nummer ist ganz normal auf WhatsApp registriert und aktuell *nicht* gebannt.`
                    });
                } else {
                    // Die Nummer existiert NICHT auf den WhatsApp Servern
                    await sock.sendMessage(from, {
                        text: `❌ *STATUS: GEBANNT / INAKTIV*\n\n• *Nummer:* \`+${cleanNumber}\`\n\n🚨 *Achtung:* Diese Nummer existiert aktuell nicht auf den WhatsApp-Servern. Wenn diese Nummer vor kurzem noch aktiv war, wurde sie höchstwahrscheinlich **von WhatsApp permanent oder temporär gebannt** (oder der Account wurde gelöscht).`
                    });
                }

            } catch (error) {
                console.error("Fehler beim Ban-Check:", error);
                await sock.sendMessage(from, { text: '❌ Fehler bei der Server-Abfrage. Bitte stelle sicher, dass die Nummer das richtige Format hat (z.B. 49176...).' });
            }
        }
    });
}

connectToWhatsApp();
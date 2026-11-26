const https = require('https');

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, email, phone, cpf, trackingCode, address, city, state } = body || {};

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        const apiKey = process.env.BREVO_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'BREVO_API_KEY is not configured in environment' });
        }
        const cleanName = (name || 'Cliente').trim();
        const cleanCode = trackingCode || 'VRD-842918-BR';
        const cleanAddress = address || `${city || 'São Paulo'} - ${state || 'SP'}`;
        const cleanCity = city || 'São Paulo';
        const cleanState = state || 'SP';

        // 1. Create or Update Contact in Brevo List 15 (Verde Para Todos - Cadastros)
        const contactPayload = JSON.stringify({
            email: email.trim().toLowerCase(),
            attributes: {
                NOME: cleanName,
                TRACKING_CODE: cleanCode,
                ADDRESS: cleanAddress,
                CITY: cleanCity,
                STATE: cleanState,
                CPF: (cpf || '').replace(/\D/g, '')
            },
            listIds: [15],
            updateEnabled: true
        });

        await new Promise((resolve) => {
            const contactReq = https.request({
                hostname: 'api.brevo.com',
                port: 443,
                path: '/v3/contacts',
                method: 'POST',
                headers: {
                    'api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(contactPayload)
                }
            }, (cRes) => {
                cRes.on('data', () => {});
                cRes.on('end', () => resolve(true));
            });

            contactReq.on('error', () => resolve(false));
            contactReq.write(contactPayload);
            contactReq.end();
        });

        // 2. Send Transactional Email (Template 33: Pedido Criado)
        const emailPayload = JSON.stringify({
            templateId: 33,
            to: [{ email: email.trim().toLowerCase(), name: cleanName }],
            params: {
                NAME: cleanName,
                TRACKING_CODE: cleanCode,
                ADDRESS: cleanAddress,
                CITY: cleanCity,
                STATE: cleanState
            }
        });

        const sendResult = await new Promise((resolve) => {
            const emailReq = https.request({
                hostname: 'api.brevo.com',
                port: 443,
                path: '/v3/smtp/email',
                method: 'POST',
                headers: {
                    'api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(emailPayload)
                }
            }, (eRes) => {
                let data = '';
                eRes.on('data', chunk => data += chunk);
                eRes.on('end', () => {
                    try {
                        resolve({ statusCode: eRes.statusCode, data: JSON.parse(data) });
                    } catch(e) {
                        resolve({ statusCode: eRes.statusCode, raw: data });
                    }
                });
            });

            emailReq.on('error', (err) => resolve({ error: err.message }));
            emailReq.write(emailPayload);
            emailReq.end();
        });

        // 3. Trigger Pushcut Notification to Admin's phone
        try {
            const pushcutPayload = JSON.stringify({
                title: `🌱 Novo Pedido: ${cleanName}`,
                text: `📍 ${cleanCity}/${cleanState} • 📦 ${cleanCode}\n📱 Tel: ${phone || 'Sem telefone'}\n✉️ ${email}`
            });

            await new Promise((resolve) => {
                const pReq = https.request({
                    hostname: 'api.pushcut.io',
                    port: 443,
                    path: '/K1TZkL2GM2OjtKHRpac5Y/notifications/MinhaNotifica%C3%A7%C3%A3o',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(pushcutPayload)
                    }
                }, (pRes) => {
                    pRes.on('data', () => {});
                    pRes.on('end', () => resolve(true));
                });
                pReq.on('error', (err) => {
                    console.warn('Pushcut trigger error:', err.message);
                    resolve(false);
                });
                pReq.write(pushcutPayload);
                pReq.end();
            });
        } catch (pushErr) {
            console.warn('Pushcut notification error:', pushErr);
        }

        // 4. Meta Conversions API 2.0 (CAPI) - Purchase Event on Order Created
        let metaCapiResult = null;
        try {
            const fbPixelId = process.env.FB_PIXEL_ID || '1176179324850189';
            const fbAccessToken = process.env.FB_ACCESS_TOKEN;

            if (fbAccessToken) {
                const crypto = require('crypto');
                const hash = (val) => {
                    if (!val) return undefined;
                    return crypto.createHash('sha256').update(String(val).trim().toLowerCase()).digest('hex');
                };

                const nameParts = cleanName.split(' ');
                const fn = hash(nameParts[0]);
                const ln = hash(nameParts.slice(1).join(' ') || nameParts[0]);
                const em = hash(email);
                
                let rawPhone = (phone || '').replace(/\D/g, '');
                if (rawPhone.length >= 10 && !rawPhone.startsWith('55')) {
                    rawPhone = '55' + rawPhone;
                }
                const ph = rawPhone ? hash(rawPhone) : undefined;
                const ct = hash(cleanCity);
                const st = hash(cleanState);
                const zp = body.cep ? hash(body.cep.replace(/\D/g, '')) : undefined;
                const country = hash('br');

                const clientIp = req.headers['x-forwarded-for'] 
                    ? req.headers['x-forwarded-for'].split(',')[0].trim() 
                    : (req.socket ? req.socket.remoteAddress : undefined);
                const userAgent = req.headers['user-agent'] || undefined;

                // Extract _fbp and _fbc
                let fbp = body.fbp;
                let fbc = body.fbc;
                if (!fbp || !fbc) {
                    const cookieHeader = req.headers.cookie || '';
                    if (!fbp) {
                        const mFbp = cookieHeader.match(/(?:^|;\s*)_fbp=([^;]+)/);
                        if (mFbp) fbp = mFbp[1];
                    }
                    if (!fbc) {
                        const mFbc = cookieHeader.match(/(?:^|;\s*)_fbc=([^;]+)/);
                        if (mFbc) fbc = mFbc[1];
                    }
                }

                const capiEventId = body.eventId || `order_${cleanCode}`;
                const eventSourceUrl = body.eventSourceUrl || 'https://verdeparatodos.online';

                const capiUserData = {
                    client_ip_address: clientIp,
                    client_user_agent: userAgent
                };
                if (em) capiUserData.em = [em];
                if (ph) capiUserData.ph = [ph];
                if (fn) capiUserData.fn = [fn];
                if (ln) capiUserData.ln = [ln];
                if (ct) capiUserData.ct = [ct];
                if (st) capiUserData.st = [st];
                if (zp) capiUserData.zp = [zp];
                if (country) capiUserData.country = [country];
                if (fbp) capiUserData.fbp = fbp;
                if (fbc) capiUserData.fbc = fbc;

                const capiPayload = JSON.stringify({
                    data: [
                        {
                            event_name: 'Purchase',
                            event_time: Math.floor(Date.now() / 1000),
                            event_id: capiEventId,
                            event_source_url: eventSourceUrl,
                            action_source: 'website',
                            user_data: capiUserData,
                            custom_data: {
                                currency: 'BRL',
                                value: 0.00,
                                content_name: 'Muda Costela de Adão - Doação',
                                content_type: 'product',
                                order_id: cleanCode
                            }
                        }
                    ],
                    access_token: fbAccessToken
                });

                metaCapiResult = await new Promise((resolve) => {
                    const fbReq = https.request({
                        hostname: 'graph.facebook.com',
                        port: 443,
                        path: `/v19.0/${fbPixelId}/events`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(capiPayload)
                        }
                    }, (fbRes) => {
                        let data = '';
                        fbRes.on('data', chunk => data += chunk);
                        fbRes.on('end', () => {
                            try {
                                resolve({ statusCode: fbRes.statusCode, data: JSON.parse(data) });
                            } catch(e) {
                                resolve({ statusCode: fbRes.statusCode, raw: data });
                            }
                        });
                    });
                    fbReq.on('error', (err) => {
                        console.warn('Meta CAPI request error:', err.message);
                        resolve({ error: err.message });
                    });
                    fbReq.write(capiPayload);
                    fbReq.end();
                });
            }
        } catch (capiErr) {
            console.warn('Meta CAPI trigger exception:', capiErr);
        }

        return res.status(200).json({
            success: true,
            contactSaved: true,
            emailSent: sendResult.statusCode === 201 || sendResult.statusCode === 200,
            pushcutNotified: true,
            metaCapi: metaCapiResult,
            result: sendResult
        });

    } catch (err) {
        console.error('Error in brevo-sync:', err);
        return res.status(500).json({ error: err.message });
    }
};

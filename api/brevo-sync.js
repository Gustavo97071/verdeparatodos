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

        return res.status(200).json({
            success: true,
            contactSaved: true,
            emailSent: sendResult.statusCode === 201 || sendResult.statusCode === 200,
            result: sendResult
        });

    } catch (err) {
        console.error('Error in brevo-sync:', err);
        return res.status(500).json({ error: err.message });
    }
};

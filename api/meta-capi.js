const https = require('https');
const crypto = require('crypto');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
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
        const fbPixelId = process.env.FB_PIXEL_ID || '1176179324850189';
        const fbAccessToken = process.env.FB_ACCESS_TOKEN;

        if (!fbAccessToken) {
            return res.status(500).json({ error: 'FB_ACCESS_TOKEN is not configured' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { event_name, event_id, event_source_url, user_data = {}, custom_data = {} } = body || {};

        const hash = (val) => {
            if (!val) return undefined;
            return crypto.createHash('sha256').update(String(val).trim().toLowerCase()).digest('hex');
        };

        const clientIp = req.headers['x-forwarded-for'] 
            ? req.headers['x-forwarded-for'].split(',')[0].trim() 
            : (req.socket ? req.socket.remoteAddress : undefined);
        const userAgent = req.headers['user-agent'] || undefined;

        let cleanPhone = (user_data.phone || '').replace(/\D/g, '');
        if (cleanPhone.length >= 10 && !cleanPhone.startsWith('55')) {
            cleanPhone = '55' + cleanPhone;
        }

        const nameParts = (user_data.name || '').trim().split(' ');
        const fn = hash(nameParts[0]);
        const ln = hash(nameParts.slice(1).join(' ') || nameParts[0]);

        const processedUserData = {
            client_ip_address: clientIp,
            client_user_agent: userAgent
        };

        if (user_data.email) processedUserData.em = [hash(user_data.email)];
        if (cleanPhone) processedUserData.ph = [hash(cleanPhone)];
        if (fn) processedUserData.fn = [fn];
        if (ln) processedUserData.ln = [ln];
        if (user_data.city) processedUserData.ct = [hash(user_data.city)];
        if (user_data.state) processedUserData.st = [hash(user_data.state)];
        if (user_data.cep) processedUserData.zp = [hash(user_data.cep.replace(/\D/g, ''))];
        processedUserData.country = [hash('br')];

        if (user_data.fbp) processedUserData.fbp = user_data.fbp;
        if (user_data.fbc) processedUserData.fbc = user_data.fbc;

        const capiPayload = JSON.stringify({
            data: [
                {
                    event_name: event_name || 'Purchase',
                    event_time: Math.floor(Date.now() / 1000),
                    event_id: event_id || `evt_${Date.now()}`,
                    event_source_url: event_source_url || 'https://verdeparatodos.online',
                    action_source: 'website',
                    user_data: processedUserData,
                    custom_data: {
                        currency: 'BRL',
                        value: custom_data.value !== undefined ? custom_data.value : 0.00,
                        content_name: custom_data.content_name || 'Muda Costela de Adão - Doação',
                        content_type: 'product',
                        ...custom_data
                    }
                }
            ],
            access_token: fbAccessToken
        });

        const sendResult = await new Promise((resolve) => {
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
            fbReq.on('error', (err) => resolve({ error: err.message }));
            fbReq.write(capiPayload);
            fbReq.end();
        });

        return res.status(200).json({
            success: sendResult.statusCode === 200,
            result: sendResult
        });
    } catch (err) {
        console.error('Error in meta-capi:', err);
        return res.status(500).json({ error: err.message });
    }
};

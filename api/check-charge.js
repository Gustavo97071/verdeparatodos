const https = require('https');

module.exports = async (req, res) => {
    // CORS headers
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

    const id = req.query.id || req.query.correlationID || (req.body && req.body.id);
    if (!id) {
        return res.status(400).json({ error: 'Missing charge id or correlationID' });
    }

    const appId = process.env.WOOVI_APP_ID || "Q2xpZW50X0lkXzUyZWNmNGI4LWY3NDctNDRlYy04NGM1LWM4OTBiN2MzOTg1YjpDbGllbnRfU2VjcmV0X2haTFJiZ0kydHpESDF5cm1uUU9WSlhJa2lrcHEySXZVaFZ5NE03MTVYVVk9";
    const cleanId = encodeURIComponent(id.replace(/[^a-zA-Z0-9_-]/g, ''));

    try {
        const wooviStatus = await new Promise((resolve) => {
            const openPixReq = https.request({
                hostname: 'api.openpix.com.br',
                port: 443,
                path: `/api/v1/charge/${cleanId}`,
                method: 'GET',
                headers: {
                    'Authorization': appId,
                    'Accept': 'application/json'
                }
            }, (wooviRes) => {
                let data = '';
                wooviRes.on('data', chunk => data += chunk);
                wooviRes.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        resolve(null);
                    }
                });
            });

            openPixReq.on('error', () => resolve(null));
            openPixReq.end();
        });

        if (wooviStatus && wooviStatus.charge) {
            const status = wooviStatus.charge.status;
            return res.status(200).json({
                paid: status === 'COMPLETED',
                status: status
            });
        }

        return res.status(200).json({
            paid: false,
            status: 'WAITING_PAYMENT'
        });

    } catch (err) {
        console.error("Error checking charge:", err);
        return res.status(200).json({ paid: false, status: 'WAITING_PAYMENT' });
    }
};

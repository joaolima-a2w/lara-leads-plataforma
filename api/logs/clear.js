// POST /api/logs/clear
const sandboxStore = require('../../sandboxStore');
const { handleCors } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        await sandboxStore.clearLogs();
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[api/logs/clear] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};

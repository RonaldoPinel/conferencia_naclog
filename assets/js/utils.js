function formatMoeda(v) {
  if (!v && v !== 0) return '—';
  const n = parseFloat(v.toString().replace(',', '.'));
  if (isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseBR(v) {
  if (!v && v !== 0) return 0;
  const s = v.toString().trim();
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

function formatData(v) {
  if (!v) return '—';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.split('T')[0].split('-');
    return `${d}/${m}/${y}`;
  }
  return v;
}

async function fetchComRetry(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      return await res.json();
    } catch (e) {
      if (i === tentativas - 1) return null;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

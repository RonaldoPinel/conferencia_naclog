/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const PROXY    = 'https://api-naclog.onrender.com';
const CONF_API = 'https://SEU_DOMINIO_ACQUAHOST.com.br/api'; // ← alterar após deploy

/* ============================================================
   ESTADO
   ============================================================ */
let _loggedIn       = false;
let _romaneios      = [];
let _confId         = null;
let _confStatus     = null;
let _itensLocais    = {};   // { codigo: { qtd_conferida, observacao } }
let _salvoTimer     = null;

/* ============================================================
   TEMA
   ============================================================ */
(function initTheme() {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = t === 'dark' ? '☀' : '☾';
})();

function toggleTheme() {
  const atual = document.documentElement.getAttribute('data-theme');
  const novo  = atual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novo);
  localStorage.setItem('theme', novo);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = novo === 'dark' ? '☀' : '☾';
}

/* ============================================================
   LOGIN (reutiliza sessão do app principal)
   ============================================================ */
(async function login() {
  const el = document.getElementById('jwt-status');
  try {
    const res = await fetch(`${PROXY}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const d   = await res.json();
    if (d.ok) {
      _loggedIn = true;
      el.textContent = 'Token ativo';
      el.className   = 'jwt-status ok';
    } else {
      el.textContent = 'Falha no login';
      el.className   = 'jwt-status erro';
    }
  } catch {
    el.textContent = 'Erro de conexão';
    el.className   = 'jwt-status erro';
  }
})();

/* ============================================================
   DATA PADRÃO — hoje
   ============================================================ */
(function setDataPadrao() {
  const hoje = new Date().toISOString().slice(0, 10);
  document.getElementById('dataInicial').value = hoje;
  document.getElementById('dataFinal').value   = hoje;
})();

/* ============================================================
   BUSCAR ROMANEIOS
   ============================================================ */
async function buscarRomaneios() {
  if (!_loggedIn) { alert('Aguarde a conexão com o servidor.'); return; }

  const di = document.getElementById('dataInicial').value.trim();
  const df = document.getElementById('dataFinal').value.trim();
  if (!di || !df) { alert('Preencha as datas.'); return; }

  const btn = document.getElementById('btn-buscar');
  btn.disabled = true;
  btn.textContent = 'Buscando...';

  esconderConferencia();
  setMainContent('<div class="vazio" style="text-align:center;padding:40px 0">Buscando romaneios...</div>');

  try {
    const res  = await fetch(`${PROXY}/romaneios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataInicial: di, dataFinal: df, pesqRomaneios: 'lsAberto', pesqNumero: '' }),
    });
    const json = await res.json();
    const raw  = json.data?.data || json.data;

    function extrair(obj) {
      if (!obj || typeof obj !== 'object') return [];
      if (Array.isArray(obj)) return obj;
      const vals = Object.values(obj);
      if (vals.length > 0 && vals[0]?.id_log_romaneios !== undefined) return vals;
      return vals.flatMap(g => extrair(g));
    }

    _romaneios = extrair(raw).filter(r => r?.id_log_romaneios);

    if (!_romaneios.length) {
      setMainContent('<div class="vazio" style="text-align:center;padding:40px 0">Nenhum romaneio encontrado no período.</div>');
      return;
    }

    renderListaRomaneios(_romaneios);

  } catch (e) {
    setMainContent(`<div class="vazio" style="text-align:center;padding:40px 0;color:var(--red)">Erro: ${e.message}</div>`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Buscar Romaneios';
  }
}

/* ============================================================
   LISTA DE ROMANEIOS
   ============================================================ */
function renderListaRomaneios(lista) {
  const html = `
    <div style="margin-bottom:12px;font-size:12px;color:var(--txt2)">${lista.length} romaneio(s) encontrado(s). Clique para conferir.</div>
    ${lista.map(r => `
      <div class="conf-list-item" onclick="abrirConferencia(${r.id_log_romaneios})">
        <div class="conf-list-left">
          <span class="conf-list-title">Romaneio #${r.id_log_romaneios}</span>
          <span class="conf-list-sub">${formatData(r.data_saida) || '—'}  ·  Placa: ${r.placa || '—'}  ·  ${r.nome || '—'}</span>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="color:var(--txt3)">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </div>
    `).join('')}
  `;
  setMainContent(html);
}

/* ============================================================
   ABRIR CONFERÊNCIA DE UM ROMANEIO
   ============================================================ */
async function abrirConferencia(idRomaneio) {
  const rom = _romaneios.find(r => r.id_log_romaneios == idRomaneio);

  document.getElementById('main-content').style.display = 'none';
  document.getElementById('filtros').style.display      = 'none';

  const tela = document.getElementById('tela-conferencia');
  tela.style.display = 'block';

  // Info bar
  document.getElementById('conf-info-bar').innerHTML = `
    <span><strong>Romaneio #${idRomaneio}</strong></span>
    <span>Data: <strong>${formatData(rom?.data_saida) || '—'}</strong></span>
    <span>Placa: <strong>${rom?.placa || '—'}</strong></span>
    <span>Motorista: <strong>${rom?.nome || '—'}</strong></span>
  `;

  document.getElementById('conf-progress-bar').innerHTML = '';
  document.getElementById('conf-erros-nfe').innerHTML    = '';
  document.getElementById('conf-acoes').innerHTML        = '';
  document.getElementById('conf-corpo').innerHTML        = `
    <div class="loading-sefaz">
      <div class="spinner"></div>
      <span>Verificando conferências existentes...</span>
    </div>`;

  try {
    // 1. Verifica se já existe conferência para este romaneio
    const confRes  = await fetch(`${CONF_API}/conferencias?id_romaneio=${idRomaneio}`);
    const confJson = await confRes.json();
    const confs    = (confJson.data || []).filter(c => c.status === 'em_andamento');

    if (confs.length > 0) {
      // Já existe — carrega direto do banco
      await carregarConferenciaExistente(confs[0].id, rom);
      return;
    }

    // 2. Busca chaves NF-e do romaneio
    setLoadingMsg('Buscando notas fiscais do romaneio...');
    const detRes  = await fetch(`${PROXY}/romaneio/${idRomaneio}`);
    const detJson = await detRes.json();
    const det     = detJson?.data ?? detJson ?? {};
    const lancamentos = det.lancamentos;

    if (!lancamentos) {
      setCorpo('<div class="vazio" style="text-align:center;padding:40px 0">Nenhuma NF-e encontrada neste romaneio.</div>');
      renderAcoes(idRomaneio, rom, null, []);
      return;
    }

    const nfes   = Object.values(lancamentos).filter(n => n && typeof n === 'object');
    const chaves = nfes.map(n => n.chavenfe).filter(c => c && String(c).replace(/\D/g, '').length === 44);

    if (!chaves.length) {
      setCorpo('<div class="vazio" style="text-align:center;padding:40px 0">Nenhuma chave de NF-e válida encontrada.</div>');
      renderAcoes(idRomaneio, rom, null, []);
      return;
    }

    // 3. Consulta SEFAZ via PHP
    setLoadingMsg(`Consultando ${chaves.length} NF-e(s) na SEFAZ... (pode levar alguns segundos)`);
    const nfeRes  = await fetch(`${CONF_API}/nfe/itens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chaves }),
    });
    const nfeJson = await nfeRes.json();

    if (!nfeJson.success) {
      throw new Error(nfeJson.erro || 'Erro ao consultar SEFAZ.');
    }

    const itens = nfeJson.itens  || [];
    const erros = nfeJson.erros  || [];

    if (erros.length > 0) {
      renderErrosNFe(erros);
    }

    if (!itens.length) {
      setCorpo('<div class="vazio" style="text-align:center;padding:40px 0">Nenhum item retornado pela SEFAZ.</div>');
      renderAcoes(idRomaneio, rom, null, []);
      return;
    }

    // 4. Cria conferência no banco
    const criarRes  = await fetch(`${CONF_API}/conferencias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_romaneio:     idRomaneio,
        data_saida:      rom?.data_saida || null,
        placa:           rom?.placa      || null,
        motorista:       rom?.nome       || null,
        transportadora:  null,
        itens,
      }),
    });
    const criarJson = await criarRes.json();

    if (!criarJson.success) {
      throw new Error(criarJson.erro || 'Erro ao criar conferência.');
    }

    _confId     = criarJson.id;
    _confStatus = 'em_andamento';
    _itensLocais = {};

    renderTabelaConferencia(itens);
    renderProgressBar(itens);
    renderAcoes(idRomaneio, rom, criarJson.id, itens);

  } catch (e) {
    setCorpo(`<div class="vazio" style="text-align:center;padding:40px 0;color:var(--red)">Erro: ${e.message}</div>`);
    renderAcoesVoltar();
  }
}

/* ============================================================
   CARREGA CONFERÊNCIA EXISTENTE (do banco)
   ============================================================ */
async function carregarConferenciaExistente(id, rom) {
  setLoadingMsg('Carregando conferência salva...');

  const res  = await fetch(`${CONF_API}/conferencias/${id}`);
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.erro || 'Erro ao carregar conferência.');
  }

  const conf  = json.data;
  const itens = conf.itens || [];

  _confId     = conf.id;
  _confStatus = conf.status;
  _itensLocais = {};

  // Pré-popula estado local com o que já está salvo
  itens.forEach(item => {
    if (item.qtd_conferida !== null) {
      _itensLocais[item.codigo_produto] = {
        qtd_conferida: item.qtd_conferida,
        observacao:    item.observacao || '',
      };
    }
  });

  // Converte formato do banco para formato da tabela
  const itensView = itens.map(i => ({
    codigo:    i.codigo_produto,
    descricao: i.descricao,
    ncm:       i.ncm,
    unidade:   i.unidade,
    qtd_total: parseFloat(i.qtd_esperada),
    status_salvo: i.status,
    qtd_conferida_salva: i.qtd_conferida,
    observacao_salva: i.observacao,
  }));

  renderTabelaConferencia(itensView);
  renderProgressBar(itens);
  renderAcoes(conf.id_romaneio, rom, conf.id, itensView);

  if (_confStatus === 'finalizada') {
    document.getElementById('conf-acoes').innerHTML +=
      '<span style="font-size:12px;color:var(--txt2);align-self:center">Esta conferência está finalizada (somente leitura).</span>';
    // Desabilita inputs
    document.querySelectorAll('.conf-input, .conf-obs').forEach(el => el.disabled = true);
  }
}

/* ============================================================
   RENDER — TABELA DE CONFERÊNCIA
   ============================================================ */
function renderTabelaConferencia(itens) {
  const linhas = itens.map(item => {
    const cod         = item.codigo;
    const local       = _itensLocais[cod];
    const qtdConf     = local?.qtd_conferida ?? (item.qtd_conferida_salva ?? '');
    const obs         = local?.observacao    ?? (item.observacao_salva    ?? '');
    const status      = calcularStatus(item.qtd_total, qtdConf);
    const inputClass  = qtdConf !== '' ? status : '';

    return `
      <tr id="row-${cod}">
        <td class="cod">${esc(cod)}</td>
        <td>${esc(item.descricao || '—')}</td>
        <td style="font-size:11px;color:var(--txt3)">${esc(item.ncm || '—')}</td>
        <td style="font-size:11px;color:var(--txt2)">${esc(item.unidade || '—')}</td>
        <td class="num">${fmtQtd(item.qtd_total)}</td>
        <td class="num">
          <input
            class="conf-input ${inputClass}"
            type="number"
            step="0.001"
            min="0"
            value="${qtdConf}"
            data-cod="${esc(cod)}"
            data-esp="${item.qtd_total}"
            onchange="onQtdChange(this)"
            onkeyup="onQtdChange(this)"
            ${_confStatus === 'finalizada' ? 'disabled' : ''}
          />
        </td>
        <td id="status-${cod}"><span class="status-dot dot-${status}"></span>${labelStatus(status)}</td>
        <td>
          <input
            class="conf-obs"
            type="text"
            placeholder="Observação..."
            value="${esc(obs)}"
            data-cod="${esc(cod)}"
            onchange="onObsChange(this)"
            ${_confStatus === 'finalizada' ? 'disabled' : ''}
          />
        </td>
      </tr>`;
  }).join('');

  setCorpo(`
    <div class="conf-tabela-wrap">
      <table class="conf-tab">
        <thead>
          <tr>
            <th>Código</th>
            <th>Descrição</th>
            <th>NCM</th>
            <th>Unid.</th>
            <th class="num">Qtd Esperada</th>
            <th class="num">Qtd Conferida</th>
            <th>Status</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `);
}

/* ============================================================
   EVENTOS DE INPUT
   ============================================================ */
function onQtdChange(input) {
  const cod    = input.dataset.cod;
  const qtdEsp = parseFloat(input.dataset.esp);
  const valor  = input.value.trim();

  if (!_itensLocais[cod]) _itensLocais[cod] = { qtd_conferida: '', observacao: '' };
  _itensLocais[cod].qtd_conferida = valor;

  const status = calcularStatus(qtdEsp, valor);
  input.className = `conf-input ${valor !== '' ? status : ''}`;

  const cell = document.getElementById(`status-${cod}`);
  if (cell) cell.innerHTML = `<span class="status-dot dot-${status}"></span>${labelStatus(status)}`;

  agendarSalvamento();
  atualizarProgressBar();
}

function onObsChange(input) {
  const cod = input.dataset.cod;
  if (!_itensLocais[cod]) _itensLocais[cod] = { qtd_conferida: '', observacao: '' };
  _itensLocais[cod].observacao = input.value;
  agendarSalvamento();
}

/* ============================================================
   SALVAR — com debounce de 1.5s
   ============================================================ */
function agendarSalvamento() {
  clearTimeout(_salvoTimer);
  _salvoTimer = setTimeout(salvarItens, 1500);
}

async function salvarItens() {
  if (!_confId || _confStatus === 'finalizada') return;

  const itens = Object.entries(_itensLocais).map(([cod, v]) => ({
    codigo:        cod,
    qtd_conferida: v.qtd_conferida !== '' ? v.qtd_conferida : null,
    observacao:    v.observacao    || null,
  }));

  if (!itens.length) return;

  try {
    const res  = await fetch(`${CONF_API}/conferencias/${_confId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itens }),
    });
    const json = await res.json();
    if (!json.success) console.error('Erro ao salvar:', json.erro);
  } catch (e) {
    console.error('Erro de rede ao salvar:', e.message);
  }
}

/* ============================================================
   FINALIZAR CONFERÊNCIA
   ============================================================ */
async function finalizarConferencia() {
  if (!_confId) return;

  const pendentes = document.querySelectorAll('.conf-input').length -
    [...document.querySelectorAll('.conf-input')].filter(i => i.value.trim() !== '').length;

  if (pendentes > 0) {
    if (!confirm(`Ainda há ${pendentes} item(s) sem contagem. Deseja finalizar mesmo assim?`)) return;
  }

  // Garante que está salvo antes de finalizar
  clearTimeout(_salvoTimer);
  await salvarItens();

  try {
    const res  = await fetch(`${CONF_API}/conferencias/${_confId}/finalizar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();

    if (json.success) {
      _confStatus = 'finalizada';
      document.querySelectorAll('.conf-input, .conf-obs').forEach(el => el.disabled = true);
      const btn = document.getElementById('btn-finalizar');
      if (btn) {
        btn.disabled    = true;
        btn.textContent = 'Finalizada';
        btn.className   = 'btn-ghost';
      }
      alert('Conferência finalizada com sucesso!');
    } else {
      alert('Erro ao finalizar: ' + json.erro);
    }
  } catch (e) {
    alert('Erro de rede: ' + e.message);
  }
}

/* ============================================================
   PROGRESS BAR
   ============================================================ */
function renderProgressBar(itens) {
  atualizarProgressBar(itens);
}

function atualizarProgressBar(itens) {
  const inputs  = [...document.querySelectorAll('.conf-input')];
  if (!inputs.length) return;

  const total        = inputs.length;
  const conferidos   = inputs.filter(i => i.value.trim() !== '').length;
  const divergencias = inputs.filter(i => i.classList.contains('divergencia')).length;
  const pendentes    = total - conferidos;

  document.getElementById('conf-progress-bar').innerHTML = `
    <span style="color:var(--txt2)">Progresso:</span>
    <span class="conf-badge ok">${conferidos} conferido(s)</span>
    <span class="conf-badge divergencia">${divergencias} divergência(s)</span>
    <span class="conf-badge pendente">${pendentes} pendente(s)</span>
    <span style="color:var(--txt3);font-size:11px">${total} produto(s) no total</span>
  `;
}

/* ============================================================
   AÇÕES (botões do rodapé)
   ============================================================ */
function renderAcoes(idRomaneio, rom, confId, itens) {
  document.getElementById('conf-acoes').innerHTML = `
    <button class="btn-ghost" onclick="voltarParaLista()">← Voltar</button>
    <button class="btn-primary" onclick="salvarItens()">Salvar</button>
    ${_confStatus !== 'finalizada'
      ? `<button class="btn-success" id="btn-finalizar" onclick="finalizarConferencia()">Finalizar Conferência</button>`
      : '<span style="font-size:12px;color:var(--txt2);align-self:center">Conferência finalizada</span>'
    }
  `;
}

function renderAcoesVoltar() {
  document.getElementById('conf-acoes').innerHTML = `
    <button class="btn-ghost" onclick="voltarParaLista()">← Voltar</button>
  `;
}

/* ============================================================
   ERROS DE NF-e
   ============================================================ */
function renderErrosNFe(erros) {
  document.getElementById('conf-erros-nfe').innerHTML = `
    <details class="erros-nfe">
      <summary>${erros.length} NF-e(s) com erro na consulta SEFAZ</summary>
      <ul>${erros.map(e => `<li><strong>${e.chave}</strong>: ${esc(e.erro)}</li>`).join('')}</ul>
    </details>
  `;
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function voltarParaLista() {
  document.getElementById('tela-conferencia').style.display = 'none';
  document.getElementById('main-content').style.display     = 'block';
  document.getElementById('filtros').style.display          = 'flex';
  _confId     = null;
  _confStatus = null;
  _itensLocais = {};
}

function esconderConferencia() {
  document.getElementById('tela-conferencia').style.display = 'none';
  document.getElementById('main-content').style.display     = 'block';
}

/* ============================================================
   HELPERS
   ============================================================ */
function setMainContent(html) {
  document.getElementById('main-content').innerHTML = html;
}

function setCorpo(html) {
  document.getElementById('conf-corpo').innerHTML = html;
}

function setLoadingMsg(msg) {
  setCorpo(`<div class="loading-sefaz"><div class="spinner"></div><span>${msg}</span></div>`);
}

function calcularStatus(qtdEsp, qtdConf) {
  if (qtdConf === '' || qtdConf === null || qtdConf === undefined) return 'pendente';
  const diff = Math.abs(parseFloat(qtdConf) - parseFloat(qtdEsp));
  return diff < 0.0001 ? 'ok' : 'divergencia';
}

function labelStatus(status) {
  return { pendente: 'Pendente', ok: 'OK', divergencia: 'Divergência' }[status] ?? status;
}

function fmtQtd(v) {
  return parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
}

function formatData(str) {
  if (!str) return '';
  const d = new Date(str.includes('T') ? str : str + 'T00:00:00');
  if (isNaN(d)) return str;
  return d.toLocaleDateString('pt-BR');
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* =====================================================================
   RUA FINANCE — lógica (sem acesso a DOM)
   ===================================================================== */
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESES_CURTOS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

const TIPOS = {
  entrada:   { nome: 'Entrada (receita)',      curto: 'Entrada' },
  saida_pj:  { nome: 'Saída da empresa (PJ)',  curto: 'Saída PJ' },
  saida_pf:  { nome: 'Saída pessoal (PF)',     curto: 'Saída PF' },
  prolabore: { nome: 'Pró-labore',             curto: 'Pró-labore' }
};
const CAT_TIPOS = {
  receita:     'Receitas',
  pj_variavel: 'Custos variáveis (PJ)',
  pj_fixo:     'Custos fixos (PJ)',
  imposto:     'Imposto (DAS)',
  pf:          'Gastos pessoais (PF)'
};
const CATS_POR_TIPO_LANC = {
  entrada: ['receita'],
  saida_pj: ['pj_variavel', 'pj_fixo', 'imposto'],
  saida_pf: ['pf'],
  prolabore: []
};

const CATS_PADRAO = [
  { id: 'r_frete',   nome: 'Fretes e entregas',        tipo: 'receita',     palavras: ['frete','entrega','corrida','motoboy','diaria'] },
  { id: 'r_briggs',  nome: 'Briggs',                   tipo: 'receita',     palavras: ['briggs'] },
  { id: 'r_outros',  nome: 'Outras receitas',          tipo: 'receita',     palavras: [] },
  { id: 'v_comb',    nome: 'Combustível',              tipo: 'pj_variavel', palavras: ['gasolina','etanol','alcool','diesel','combustivel','abasteci','abastecimento','posto'] },
  { id: 'v_manut',   nome: 'Manutenção',               tipo: 'pj_variavel', palavras: ['mecanico','oficina','manutencao','oleo','pneu','peca','pecas','revisao','freio','corrente','relacao','conserto','bateria','vela'] },
  { id: 'v_pedagio', nome: 'Pedágio e estacionamento', tipo: 'pj_variavel', palavras: ['pedagio','estacionamento','zona azul'] },
  { id: 'v_alim',    nome: 'Alimentação no trabalho',  tipo: 'pj_variavel', palavras: ['almoco','lanche','marmita','janta','cafe'] },
  { id: 'v_lav',     nome: 'Lavagem',                  tipo: 'pj_variavel', palavras: ['lavagem','lava rapido'] },
  { id: 'v_outros',  nome: 'Outros custos variáveis',  tipo: 'pj_variavel', palavras: [] },
  { id: 'f_contador',nome: 'Contador',                 tipo: 'pj_fixo',     palavras: ['contador','contabilidade'] },
  { id: 'f_seguro',  nome: 'Seguro',                   tipo: 'pj_fixo',     palavras: ['seguro'] },
  { id: 'f_parcela', nome: 'Parcela do veículo',       tipo: 'pj_fixo',     palavras: ['parcela','financiamento','prestacao','consorcio'] },
  { id: 'f_internet',nome: 'Internet e telefone',      tipo: 'pj_fixo',     palavras: ['internet','celular','telefone','plano'] },
  { id: 'f_ipva',    nome: 'IPVA e licenciamento',     tipo: 'pj_fixo',     palavras: ['ipva','licenciamento','dpvat'] },
  { id: 'f_outros',  nome: 'Outros custos fixos',      tipo: 'pj_fixo',     palavras: [] },
  { id: 'i_das',     nome: 'Imposto (DAS)',            tipo: 'imposto',     palavras: ['das','imposto','simples nacional','darf'] },
  { id: 'p_mercado', nome: 'Mercado',                  tipo: 'pf',          palavras: ['mercado','supermercado','feira','padaria'] },
  { id: 'p_moradia', nome: 'Moradia',                  tipo: 'pf',          palavras: ['aluguel','luz','agua','condominio','gas'] },
  { id: 'p_saude',   nome: 'Saúde',                    tipo: 'pf',          palavras: ['farmacia','remedio','medico','dentista','plano de saude'] },
  { id: 'p_lazer',   nome: 'Lazer',                    tipo: 'pf',          palavras: ['lazer','cinema','restaurante','churrasco','pizza','ifood'] },
  { id: 'p_transp',  nome: 'Transporte pessoal',       tipo: 'pf',          palavras: ['uber','onibus','passagem'] },
  { id: 'p_educ',    nome: 'Educação',                 tipo: 'pf',          palavras: ['escola','curso','faculdade'] },
  { id: 'p_outros',  nome: 'Outros gastos pessoais',   tipo: 'pf',          palavras: [] }
];

/* ---------- utilitários ---------- */
function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pad(n) { return String(n).padStart(2, '0'); }
function isoDe(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hojeISO() { return isoDe(new Date()); }
function mesAtual() { return hojeISO().slice(0, 7); }
function somaMes(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
function addDias(iso, n) { const [y, m, d] = iso.split('-').map(Number); return isoDe(new Date(y, m - 1, d + n)); }
function nomeMes(ym) { const [y, m] = ym.split('-').map(Number); return MESES[m - 1] + ' ' + y; }
function nomeMesCurto(ym) { const m = Number(ym.split('-')[1]); return MESES_CURTOS[m - 1]; }
function fmtData(iso) { const p = iso.split('-'); return p[2] + '/' + p[1]; }
function rotuloDia(iso) { const [y, m, d] = iso.split('-').map(Number); return DIAS_SEM[new Date(y, m - 1, d).getDay()] + ', ' + pad(d) + ' ' + MESES_CURTOS[m - 1]; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function r2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

const _brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function brl(v) { v = r2(v || 0); if (Object.is(v, -0)) v = 0; return _brl.format(v); }
function pct(v, dec) { return isFinite(v) ? (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: dec == null ? 1 : dec }) + '%' : '—'; }
function pctDe(a, b, dec) { return b > 0 ? pct(a / b, dec) : '—'; }
function sinal(v) { return v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : 'mut'; }

function parseBR(s) {
  s = String(s == null ? '' : s).trim().replace(/[R$\s]/gi, '');
  if (!s) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+([.,]\d+)?$/.test(s)) return parseFloat(s.replace(',', '.'));
  return NaN;
}
function numParaInput(v) { return String(r2(v)).replace('.', ','); }

/* ---------- interpretação de frases (voz ou texto) ---------- */
const NUM_U = new Map(Object.entries({ zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 }));
const NUM_D = new Map(Object.entries({ vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 }));
const NUM_C = new Map(Object.entries({ cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 }));
const ehNumPalavra = w => NUM_U.has(w) || NUM_D.has(w) || NUM_C.has(w);
const valNumPalavra = w => NUM_U.has(w) ? NUM_U.get(w) : NUM_D.has(w) ? NUM_D.get(w) : NUM_C.get(w);

function lerNumeroPalavras(tk, i) {
  let total = 0, atual = 0, usou = false, j = i;
  while (j < tk.length) {
    const w = tk[j];
    if (ehNumPalavra(w)) { atual += valNumPalavra(w); usou = true; j++; }
    else if (w === 'mil') { total += (atual || 1) * 1000; atual = 0; usou = true; j++; }
    else if (w === 'e' && usou && j + 1 < tk.length && ehNumPalavra(tk[j + 1])) { j++; }
    else break;
  }
  return usou ? { val: total + atual, next: j } : null;
}

function acharValor(t) {
  t = t.replace(/r\$\s*/g, ' rs ');
  const tk = t.replace(/[^a-z0-9.,\s]/g, ' ').split(/\s+/).filter(Boolean).map(w => w.replace(/[.,]+$/, '')).filter(Boolean);
  const MOEDA = /^(reais|real|pila|pilas|conto|contos)$/;
  const cands = [];
  for (let i = 0; i < tk.length; i++) {
    let val = null, fim = i;
    const ehDigito = /^\d[\d.,]*$/.test(tk[i]);
    if (ehDigito) {
      val = parseBR(tk[i]); fim = i + 1;
      if (isNaN(val)) continue;
      if (tk[fim] === 'mil') {
        val *= 1000; fim++;
        if (tk[fim] === 'e' && /^\d{1,3}$/.test(tk[fim + 1] || '') && !/^centavos?$/.test(tk[fim + 2] || '')) { val += Number(tk[fim + 1]); fim += 2; }
      }
    } else {
      const r = lerNumeroPalavras(tk, i);
      if (r) { val = r.val; fim = r.next; }
    }
    if (val == null) continue;
    const marca = tk[i - 1] === 'rs' || MOEDA.test(tk[fim] || '');
    let j = fim;
    if (/^(reais|real)$/.test(tk[j] || '')) j++;
    if (tk[j] === 'e') {
      let c = null, k = j + 1;
      if (/^\d{1,2}$/.test(tk[k] || '')) { c = Number(tk[k]); k++; }
      else { const r2_ = lerNumeroPalavras(tk, k); if (r2_) { c = r2_.val; k = r2_.next; } }
      if (c != null && /^centavos?$/.test(tk[k] || '')) { val += c / 100; fim = k + 1; }
    }
    if (!marca && val <= 2 && !ehDigito) { i = fim - 1; continue; }
    cands.push({ val, marca, pos: i });
    i = fim - 1;
  }
  if (!cands.length) return null;
  cands.sort((a, b) => (Number(b.marca) - Number(a.marca)) || (b.val - a.val));
  return r2(cands[0].val);
}

function extrairData(t, hoje) {
  hoje = hoje || hojeISO();
  let m;
  if ((m = t.match(/\banteontem\b/))) return { data: addDias(hoje, -2), resto: t.replace(m[0], ' ') };
  if ((m = t.match(/\bontem\b/))) return { data: addDias(hoje, -1), resto: t.replace(m[0], ' ') };
  const valida = (a, mes, d) => { const dt = new Date(a, mes - 1, d); return dt.getFullYear() === a && dt.getMonth() === mes - 1 && dt.getDate() === d; };
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const d = +m[1], mes = +m[2]; let a = m[3] ? +m[3] : +hoje.slice(0, 4); if (a < 100) a += 2000;
    if (valida(a, mes, d)) return { data: a + '-' + pad(mes) + '-' + pad(d), resto: t.replace(m[0], ' ') };
  }
  const nomes = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  if ((m = t.match(/\bdia (\d{1,2})(?: de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))?/))) {
    const d = +m[1]; const a = +hoje.slice(0, 4); const mes = m[2] ? nomes.indexOf(m[2]) + 1 : +hoje.slice(5, 7);
    if (valida(a, mes, d)) return { data: a + '-' + pad(mes) + '-' + pad(d), resto: t.replace(m[0], ' ') };
  }
  if ((m = t.match(/\bhoje\b/))) return { data: hoje, resto: t.replace(m[0], ' ') };
  return { data: hoje, resto: t };
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function melhorCat(t, cats, tiposPermitidos) {
  let melhor = null, score = 0;
  for (const c of cats) {
    if (tiposPermitidos && tiposPermitidos.length && !tiposPermitidos.includes(c.tipo)) continue;
    if (tiposPermitidos && !tiposPermitidos.length) continue;
    const kws = (c.palavras || []).map(norm).filter(Boolean);
    const nome = norm(c.nome);
    if (nome.length >= 3) kws.push(nome);
    for (const kw of kws) {
      if (new RegExp('(?:^|[^a-z0-9])' + escRe(kw)).test(t) && kw.length > score) { melhor = c; score = kw.length; }
    }
  }
  return melhor;
}
function catSugerida(texto, tipoLanc, cats) {
  if (!texto || tipoLanc === 'prolabore') return null;
  return melhorCat(norm(texto), cats, CATS_POR_TIPO_LANC[tipoLanc]);
}

function classificar(texto, cats, hoje) {
  const original = String(texto || '').trim();
  let t = norm(original);
  const d = extrairData(t, hoje);
  const valor = acharValor(d.resto);
  t = d.resto;
  let tipo = null, generico = null;
  const RE_PL = /pro-?\s?labore|prolabore|retirada|retirei|retirar/;
  const RE_PF = /\b(pessoal|pf|particular|pra mim|para mim|minha casa|em casa)\b/;
  const RE_E = /\b(recebi|ganhei|faturei|vendi|recebimento|receita)\b/;
  const RE_S = /\b(paguei|gastei|comprei|abasteci|troquei|consertei|pago|despesa|gasto|saida|custou|custo)\b/;
  const RE_EW = /\b(entrada|venda|frete|cliente pagou|entrou)\b/;
  if (RE_PL.test(t)) tipo = 'prolabore';
  else if (RE_PF.test(t)) tipo = 'saida_pf';
  else {
    const se = RE_E.exec(t), ss = RE_S.exec(t);
    if (se && (!ss || se.index < ss.index)) tipo = 'entrada';
    else if (ss) generico = 'saida';
    else if (RE_EW.test(t)) generico = 'entrada';
  }
  let permitidos;
  if (tipo === 'entrada' || generico === 'entrada') permitidos = ['receita'];
  else if (tipo === 'saida_pf') permitidos = ['pf'];
  else if (tipo === 'prolabore') permitidos = [];
  else if (generico === 'saida') permitidos = ['pj_variavel', 'pj_fixo', 'imposto', 'pf'];
  else permitidos = null;
  const cat = melhorCat(t, cats, permitidos);
  if (!tipo) {
    if (cat) tipo = cat.tipo === 'receita' ? 'entrada' : cat.tipo === 'pf' ? 'saida_pf' : 'saida_pj';
    else tipo = generico === 'entrada' ? 'entrada' : 'saida_pj';
  }
  let desc = original.replace(/[.!?]+$/, '');
  desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  return { tipo, valor, cat: cat ? cat.id : '', data: d.data, desc };
}

/* ---------- cálculos ---------- */
function mapaCats(db) { const m = {}; db.cats.forEach(c => { m[c.id] = c; }); return m; }

function statusFixos(db, lsMes, ym) {
  const ls = lsMes.filter(l => l.tipo === 'saida_pj');
  const grupos = {};
  db.fixos.filter(f => (f.criado || '0000-00') <= ym).forEach(f => {
    const k = f.cat || ('f:' + f.id);
    (grupos[k] = grupos[k] || { plan: 0, itens: [] });
    grupos[k].plan += f.valor; grupos[k].itens.push(f);
  });
  let pend = 0; const status = {};
  for (const k in grupos) {
    const g = grupos[k]; const ids = g.itens.map(f => f.id);
    const porCat = k.startsWith('f:') ? 0 : soma(ls.filter(l => l.cat === k), l => l.valor);
    const ligados = soma(ls.filter(l => ids.includes(l.fixoId) && (k.startsWith('f:') || l.cat !== k)), l => l.valor);
    const pago = porCat + ligados;
    const faltando = Math.max(0, g.plan - pago);
    pend += faltando;
    g.itens.forEach(f => { status[f.id] = ls.some(l => l.fixoId === f.id) || pago >= g.plan - 0.005 ? 'pago' : 'pendente'; });
  }
  return { pend: r2(pend), status };
}

function calcular(db, ym) {
  const ls = db.lanc.filter(l => l.data.slice(0, 7) === ym);
  return calcularLista(db, ls, ym);
}

function getMeta(db, ym) {
  if (db.metas[ym]) return { fat: db.metas[ym].fat || 0, sobra: db.metas[ym].sobra || 0, herdada: false };
  const ks = Object.keys(db.metas).filter(k => k < ym).sort();
  if (ks.length) { const m = db.metas[ks[ks.length - 1]]; return { fat: m.fat || 0, sobra: m.sobra || 0, herdada: true }; }
  return { fat: 0, sobra: 0, herdada: false };
}
function calcContador(db, ym) {
  const ids = db.cats.filter(c => norm(c.nome).includes('contador')).map(c => c.id);
  const ls = db.lanc.filter(l => l.data.slice(0, 7) === ym && l.tipo === 'saida_pj' && ids.includes(l.cat));
  const pago = soma(ls, l => l.valor);
  const plan = soma(db.fixos.filter(f => ids.includes(f.cat) && (f.criado || '0000-00') <= ym), f => f.valor);
  return { pago: r2(pago), pend: r2(Math.max(0, plan - pago)) };
}



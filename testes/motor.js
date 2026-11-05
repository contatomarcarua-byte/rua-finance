/* =====================================================================
   RUA FINANCE — motor financeiro (núcleo compartilhado CPF / CNPJ / Híbrido)
   Sem acesso a DOM. Valores somados em centavos inteiros (sem erro de ponto flutuante).
   ===================================================================== */
const NATUREZAS = { prolabore: 'Pró-labore', distribuicao: 'Distribuição de lucros', reembolso: 'Reembolso', emprestimo: 'Empréstimo entre partes relacionadas', outras: 'Outras transferências' };
const NATUREZA_RENDA_PF = ['prolabore', 'distribuicao'];
const CONTA_TIPOS = { corrente: 'Conta corrente', carteira: 'Carteira (dinheiro)', reserva: 'Reserva / poupança' };
const SAUDE_PADRAO = { reservaMesesPF: 6, reservaMesesPJ: 3, compSaudavel: 50, compAtencao: 70, compRisco: 90, margemSaudavel: 10 };
const NIVEIS = ['saudavel', 'atencao', 'risco', 'critica'];
const NIVEL_NOME = { saudavel: 'Saudável', atencao: 'Atenção', risco: 'Risco', critica: 'Crítica', indefinida: 'Indefinida' };

const cent = v => Math.round((Number(v) || 0) * 100);
function soma(arr, f) { let c = 0; for (const x of arr) c += cent(f ? f(x) : x); return c / 100; }
const inEscopo = (per, esc) => esc === 'ambos' || (esc === 'pj' && per === 'PJ') || (esc === 'pf' && per === 'PF');
function diffDias(a, b) { const f = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((f(b) - f(a)) / 864e5); }
function ultimoDiaMes(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function dataNoMes(ym, dia) { return ym + '-' + pad(Math.min(Math.max(1, Number(dia) || 1), ultimoDiaMes(ym))); }

/* ---------- banco de dados e migração ---------- */
function novoDb() {
  const hoje = hojeISO();
  return {
    v: 2, lanc: [], fixos: [], metas: {}, recorr: [], agenda: [], log: [], exemplo: false,
    cats: CATS_PADRAO.map(c => ({ ...c, palavras: [...c.palavras], essencial: !(c.tipo === 'pf' && /lazer/.test(norm(c.nome))) })),
    contas: [
      { id: 'c_pj', nome: 'Conta da empresa', perfil: 'PJ', tipo: 'corrente', saldoIni: 0, ativa: true, criadoEm: hoje },
      { id: 'c_pf', nome: 'Carteira pessoal', perfil: 'PF', tipo: 'carteira', saldoIni: 0, ativa: true, criadoEm: hoje }
    ],
    config: { aliquota: 6, tema: 'auto', voiceAuto: false, ultimoBackup: null, perfil: 'hibrido', prolaborePlanejado: 0, saude: { ...SAUDE_PADRAO } }
  };
}
function migrarDb(d) {
  const p = novoDb();
  d = d || {};
  const velho = !d.v || d.v < 2 || !Array.isArray(d.contas) || !d.contas.length;
  const db = {
    ...p, ...d,
    config: { ...p.config, ...(d.config || {}) },
    lanc: Array.isArray(d.lanc) ? d.lanc.map(x => ({ ...x })) : [],
    cats: Array.isArray(d.cats) && d.cats.length ? d.cats.map(c => ({ ...c })) : p.cats,
    fixos: Array.isArray(d.fixos) ? d.fixos : [],
    metas: d.metas && typeof d.metas === 'object' ? d.metas : {},
    contas: Array.isArray(d.contas) && d.contas.length ? d.contas : p.contas,
    recorr: Array.isArray(d.recorr) ? d.recorr : [],
    agenda: Array.isArray(d.agenda) ? d.agenda : [],
    log: Array.isArray(d.log) ? d.log : []
  };
  db.config.saude = { ...SAUDE_PADRAO, ...(db.config.saude || {}) };
  db.cats.forEach(c => { if (c.essencial === undefined) c.essencial = !(c.tipo === 'pf' && /lazer/.test(norm(c.nome))); });
  if (velho) {
    const hoje = hojeISO();
    db.contas = [
      { id: 'c_pj', nome: 'Conta da empresa', perfil: 'PJ', tipo: 'corrente', saldoIni: r2(Number(db.config.saldoIniPJ) || 0), ativa: true, criadoEm: hoje },
      { id: 'c_pf', nome: 'Carteira pessoal', perfil: 'PF', tipo: 'carteira', saldoIni: r2(Number(db.config.saldoIniPF) || 0), ativa: true, criadoEm: hoje }
    ];
    db.lanc = db.lanc.map(l => {
      if (l.tipo === 'prolabore') return { ...l, tipo: 'transf', natureza: 'prolabore', conta: 'c_pj', contaDest: 'c_pf' };
      if (l.tipo === 'saida_pf') return { ...l, conta: 'c_pf' };
      return { ...l, conta: 'c_pj' };
    });
    db.log.push({ ts: Date.now(), acao: 'Migração', detalhe: 'Dados convertidos para o modelo com contas (v2). ' + db.lanc.length + ' lançamentos preservados.' });
  }
  db.v = 2;
  return db;
}

/* ---------- contas ---------- */
function contaPorId(db, id) { return db.contas.find(c => c.id === id) || null; }
function contasDo(db, perfil) { return db.contas.filter(c => c.ativa !== false && (!perfil || c.perfil === perfil)); }
function contaPadrao(db, perfil) { const cs = contasDo(db, perfil); return cs.find(c => c.tipo !== 'reserva') || cs[0] || null; }
function contaDoLanc(db, l) {
  if (l.conta && contaPorId(db, l.conta)) return l.conta;
  const c = contaPadrao(db, l.tipo === 'saida_pf' ? 'PF' : 'PJ') || db.contas[0];
  return c ? c.id : null;
}
function perfilLanc(db, l) { const c = contaPorId(db, contaDoLanc(db, l)); return c ? c.perfil : (l.tipo === 'saida_pf' ? 'PF' : 'PJ'); }
function perfilDest(db, l) { const c = contaPorId(db, l.contaDest); return c ? c.perfil : null; }
function sentidoTransf(db, l) { const o = perfilLanc(db, l), d = perfilDest(db, l); return o === d ? 'interna' : (o === 'PJ' ? 'pj_pf' : 'pf_pj'); }

function saldoConta(db, id, ate) {
  const c = contaPorId(db, id); if (!c) return 0;
  let s = cent(c.saldoIni);
  for (const l of db.lanc) {
    if (ate && l.data > ate) continue;
    const v = cent(l.valor);
    if (l.tipo === 'transf') { if (contaDoLanc(db, l) === id) s -= v; if (l.contaDest === id) s += v; }
    else if (contaDoLanc(db, l) === id) s += l.tipo === 'entrada' ? v : -v;
  }
  return s / 100;
}
function saldos(db, ate) {
  const r = { pj: 0, pf: 0, pjLivre: 0, pfLivre: 0, reservaPJ: 0, reservaPF: 0, porConta: {} };
  for (const c of db.contas) {
    const s = cent(saldoConta(db, c.id, ate)); r.porConta[c.id] = s / 100;
    const k = c.perfil === 'PJ' ? 'pj' : 'pf';
    r[k] += s;
    if (c.tipo === 'reserva') r[k === 'pj' ? 'reservaPJ' : 'reservaPF'] += s; else r[k + 'Livre'] += s;
  }
  ['pj', 'pf', 'pjLivre', 'pfLivre', 'reservaPJ', 'reservaPF'].forEach(k => { r[k] = r[k] / 100; });
  r.total = r2(r.pj + r.pf);
  return r;
}
function saldoEscopo(db, esc, ate) {
  const s = saldos(db, ate);
  return esc === 'pj' ? { livre: s.pjLivre, reserva: s.reservaPJ, total: s.pj } : esc === 'pf' ? { livre: s.pfLivre, reserva: s.reservaPF, total: s.pf } : { livre: r2(s.pjLivre + s.pfLivre), reserva: r2(s.reservaPJ + s.reservaPF), total: s.total };
}

/* ---------- validação e criação de lançamentos (inclui a ponte CPF↔CNPJ) ---------- */
function validarLanc(db, l) {
  if (!(cent(l.valor) > 0)) return 'Informe um valor maior que zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data || '')) return 'Escolha a data do lançamento.';
  if (l.tipo === 'transf') {
    if (!l.conta || !l.contaDest || !contaPorId(db, l.conta) || !contaPorId(db, l.contaDest)) return 'Escolha a conta de origem e a de destino.';
    if (l.conta === l.contaDest) return 'Origem e destino precisam ser contas diferentes.';
    if (perfilLanc(db, l) !== perfilDest(db, l) && !NATUREZAS[l.natureza]) return 'Classifique a natureza da transferência.';
    return null;
  }
  if (!l.conta || !contaPorId(db, l.conta)) return 'Escolha a conta.';
  const per = contaPorId(db, l.conta).perfil;
  if (l.tipo === 'saida_pj' && per !== 'PJ') return 'Saída da empresa precisa sair de uma conta da empresa.';
  if (l.tipo === 'saida_pf' && per !== 'PF') return 'Saída pessoal precisa sair de uma conta pessoal.';
  return null;
}
function criarLanc(db, l) {
  const erro = validarLanc(db, l);
  if (erro) return { ok: false, erro };
  const reg = { ...l, id: l.id || uid(), valor: r2(l.valor), criadoEm: l.criadoEm || Date.now() };
  if (reg.tipo === 'transf' && perfilLanc(db, reg) === perfilDest(db, reg)) delete reg.natureza;
  db.lanc.push(reg);
  return { ok: true, lanc: reg };
}

/* ---------- cálculo mensal (empresa) ---------- */
function calcularLista(db, ls, ym) {
  const aliq = (db.config.aliquota || 0) / 100;
  const cm = mapaCats(db);
  let fat = 0, variaveis = 0, fixosPagos = 0, dasPago = 0, prolabore = 0, pf = 0, rendaPF = 0, distribuicao = 0, retirado = 0, aportes = 0, cruzadas = 0, saidasPJ = 0, rendaPFTransf = 0;
  for (const l of ls) {
    const v = cent(l.valor);
    if (l.tipo === 'entrada') { if (perfilLanc(db, l) === 'PJ') fat += v; else rendaPF += v; }
    else if (l.tipo === 'saida_pf') pf += v;
    else if (l.tipo === 'saida_pj') {
      saidasPJ += v;
      const t = (cm[l.cat] || {}).tipo;
      if (t === 'imposto') dasPago += v;
      else if (t === 'pj_fixo' || l.fixoId) fixosPagos += v;
      else variaveis += v;
    } else if (l.tipo === 'transf') {
      const o = perfilLanc(db, l), d = perfilDest(db, l);
      if (o && d && o !== d) {
        cruzadas += v;
        if (o === 'PJ') {
          retirado += v;
          if (l.natureza === 'prolabore') prolabore += v;
          else if (l.natureza === 'distribuicao') distribuicao += v;
          if (NATUREZA_RENDA_PF.includes(l.natureza)) rendaPFTransf += v;
        } else aportes += v;
      }
    }
  }
  fat /= 100; variaveis /= 100; fixosPagos /= 100; dasPago /= 100; prolabore /= 100; pf /= 100; rendaPF /= 100; distribuicao /= 100; retirado /= 100; aportes /= 100; cruzadas /= 100; saidasPJ /= 100; rendaPFTransf /= 100;
  let fixosPend = 0;
  if (ym && (ls.length > 0 || ym === mesAtual())) fixosPend = statusFixos(db, ls, ym).pend;
  const imposto = r2(fat * aliq);
  const custosFixos = r2(fixosPagos + fixosPend);
  const sobra = r2(fat - imposto - variaveis - custosFixos - prolabore);
  const mc = r2(fat - variaveis - imposto);
  const mcPct = fat > 0 ? mc / fat : NaN;
  const pe = mcPct > 0 ? custosFixos / mcPct : NaN;
  const pePL = mcPct > 0 ? (custosFixos + prolabore) / mcPct : NaN;
  const lucroOp = r2(sobra + prolabore);
  return {
    fat: r2(fat), imposto, variaveis: r2(variaveis), fixosPagos: r2(fixosPagos), fixosPend: r2(fixosPend), custosFixos, prolabore: r2(prolabore), pf: r2(pf), dasPago: r2(dasPago),
    custosMes: r2(variaveis + custosFixos), sobra, sobraAntes: lucroOp, lucroOp, margem: fat > 0 ? sobra / fat : NaN, margemOp: fat > 0 ? lucroOp / fat : NaN,
    mc, mcPct, pe: isNaN(pe) ? NaN : r2(pe), pePL: isNaN(pePL) ? NaN : r2(pePL),
    rendaPF: r2(rendaPF), rendaPFTransf: r2(rendaPFTransf), distribuicao: r2(distribuicao), retirado: r2(retirado), aportes: r2(aportes), cruzadas: r2(cruzadas), saidasPJ: r2(saidasPJ), n: ls.length
  };
}

/* totais de caixa por perfil (inclui movimentos da ponte) para a tela de Fluxo de caixa */
function totaisPeriodo(db, ls) {
  let eJ = 0, sJ = 0, eF = 0, sF = 0, ret = 0, apo = 0, interna = 0;
  for (const l of ls) {
    const v = cent(l.valor);
    if (l.tipo === 'entrada') { if (perfilLanc(db, l) === 'PJ') eJ += v; else eF += v; }
    else if (l.tipo === 'saida_pj') sJ += v;
    else if (l.tipo === 'saida_pf') sF += v;
    else if (l.tipo === 'transf') { const s = sentidoTransf(db, l); if (s === 'pj_pf') ret += v; else if (s === 'pf_pj') apo += v; else interna += v; }
  }
  const d = x => x / 100;
  return { entradasPJ: d(eJ), saidasPJ: d(sJ), entradasPF: d(eF), saidasPF: d(sF), retiradas: d(ret), aportes: d(apo), internas: d(interna),
    resPJ: d(eJ - sJ - ret + apo), resPF: d(eF - sF + ret - apo) };
}

/* ---------- fluxo de um período, sem transferências internas ---------- */
const essencialCat = (cm, l) => { const c = cm[l.cat]; return !c || c.essencial !== false; };
function fluxoPeriodo(db, de, ate, esc) {
  const cm = mapaCats(db);
  let ent = 0, sai = 0, ess = 0, ret = 0;
  for (const l of db.lanc) {
    if (l.data < de || l.data > ate) continue;
    const v = cent(l.valor);
    if (l.tipo === 'entrada') { if (inEscopo(perfilLanc(db, l), esc)) ent += v; }
    else if (l.tipo === 'saida_pj' || l.tipo === 'saida_pf') {
      if (inEscopo(perfilLanc(db, l), esc)) { sai += v; if (essencialCat(cm, l)) ess += v; }
    } else if (l.tipo === 'transf') {
      const s = sentidoTransf(db, l);
      if (s === 'pj_pf') {
        if (esc === 'pf' && NATUREZA_RENDA_PF.includes(l.natureza)) ent += v;
        if (esc === 'pj' && l.natureza === 'prolabore') ret += v;
      }
    }
  }
  return { entradas: ent / 100, saidas: sai / 100, essenciais: ess / 100, retiradas: ret / 100, resultado: (ent - sai) / 100 };
}
function primeiroLanc(db) { return db.lanc.reduce((m, l) => (!m || l.data < m ? l.data : m), null); }

/* ---------- agenda e recorrências ---------- */
function ocorrenciasRecorr(r, ate) {
  const out = [];
  if (r.ativa === false || !r.inicio) return out;
  const lim = r.parcelas > 0 ? r.parcelas : Infinity, fim = r.fim || '9999-12-31';
  let n = 0;
  if (r.freq === 'semanal') {
    let d = r.inicio;
    while (d <= ate && d <= fim && n < lim && out.length < 400) { out.push({ n: ++n, data: d }); d = addDias(d, 7); }
  } else {
    const passo = r.freq === 'anual' ? 12 : 1;
    const dia = r.freq === 'anual' ? Number(r.inicio.slice(8)) : (Number(r.dia) || Number(r.inicio.slice(8)));
    let ym = r.inicio.slice(0, 7), guarda = 0;
    while (n < lim && guarda++ < 1200) {
      const data = dataNoMes(ym, dia);
      if (data > ate || data > fim) break;
      if (data >= r.inicio) out.push({ n: ++n, data });
      ym = somaMes(ym, passo);
    }
  }
  return out;
}
function materializar(db, hoje, horizonte) {
  const ate = addDias(hoje, horizonte || 90), corte = addDias(hoje, -35);
  let criados = 0;
  for (const r of db.recorr) {
    for (const o of ocorrenciasRecorr(r, ate)) {
      if (o.data < corte) continue;
      if (db.agenda.some(a => a.recorrId === r.id && a.venc === o.data)) continue;
      db.agenda.push({ id: uid(), tipo: r.tipo, perfil: r.perfil, desc: r.desc + (r.parcelas > 0 ? ' (' + o.n + '/' + r.parcelas + ')' : ''), valor: r.valor, venc: o.data, cat: r.cat || '', status: 'aberto', recorrId: r.id, criadoEm: hoje });
      criados++;
    }
  }
  return criados;
}
function pagarAgenda(db, id, conta, data) {
  const a = db.agenda.find(x => x.id === id);
  if (!a || a.status !== 'aberto') return { ok: false, erro: 'Esta conta não está em aberto.' };
  const c = contaPorId(db, conta);
  if (!c || c.perfil !== a.perfil) return { ok: false, erro: 'Escolha uma conta ' + (a.perfil === 'PJ' ? 'da empresa.' : 'pessoal.') };
  const r = criarLanc(db, { tipo: a.tipo === 'receber' ? 'entrada' : (a.perfil === 'PJ' ? 'saida_pj' : 'saida_pf'), valor: a.valor, data, desc: a.desc, cat: a.cat || '', conta, agendaId: a.id });
  if (!r.ok) return r;
  a.status = 'pago'; a.lancId = r.lanc.id; a.pagoEm = data;
  return { ok: true, lanc: r.lanc };
}
function desfazerPagamento(db, id) {
  const a = db.agenda.find(x => x.id === id);
  if (!a || a.status !== 'pago') return false;
  db.lanc = db.lanc.filter(l => l.id !== a.lancId);
  a.status = 'aberto'; delete a.lancId; delete a.pagoEm;
  return true;
}

/* ---------- compromissos futuros e previsão ---------- */
function compromissos(db, de, ate, esc) {
  const out = [];
  for (const a of db.agenda) {
    if (a.status !== 'aberto' || !inEscopo(a.perfil, esc) || a.venc > ate) continue;
    const vencida = a.venc < de;
    out.push({ data: vencida ? de : a.venc, valor: a.tipo === 'receber' ? a.valor : -a.valor, perfil: a.perfil, origem: 'agenda', desc: a.desc, ref: a.id, vencida, venc: a.venc });
  }
  if (inEscopo('PJ', esc)) {
    let ym = de.slice(0, 7);
    while (ym <= ate.slice(0, 7)) {
      const atual = ym === de.slice(0, 7);
      const st = atual ? statusFixos(db, db.lanc.filter(l => l.data.slice(0, 7) === ym), ym) : null;
      for (const f of db.fixos) {
        if ((f.criado || '0000-00') > ym) continue;
        if (atual && st.status[f.id] !== 'pendente') continue;
        const dt = dataNoMes(ym, f.dia || 1);
        if (dt > ate) continue;
        const vencida = dt < de;
        out.push({ data: vencida ? de : dt, valor: -f.valor, perfil: 'PJ', origem: 'fixo', desc: f.nome, ref: f.id, vencida, venc: dt });
      }
      ym = somaMes(ym, 1);
    }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}
function previsaoSaldo(db, hoje, dias, esc) {
  const ate = addDias(hoje, dias), comps = compromissos(db, hoje, ate, esc);
  const base = cent(saldoEscopo(db, esc, hoje).livre);
  let acc = base, minimo = { data: hoje, saldo: base / 100 }, negativoEm = null, ent = 0, sai = 0;
  const pontos = [];
  for (let i = 0; i <= dias; i++) {
    const d = addDias(hoje, i);
    for (const c of comps) if (c.data === d) { const v = cent(c.valor); acc += v; if (v > 0) ent += v; else sai += -v; }
    pontos.push({ data: d, saldo: acc / 100 });
    if (acc / 100 < minimo.saldo) minimo = { data: d, saldo: acc / 100 };
    if (acc < 0 && !negativoEm) negativoEm = d;
  }
  return { base: base / 100, pontos, minimo, final: acc / 100, negativoEm, entradas: ent / 100, saidas: sai / 100, comps };
}
function ritmoDiario(db, hoje, esc) {
  const prim = primeiroLanc(db); if (!prim) return null;
  const dias = diffDias(prim, hoje) + 1; if (dias < 30) return null;
  const janela = Math.min(90, dias), de = addDias(hoje, -(janela - 1)), cm = mapaCats(db);
  let e = 0, s = 0;
  for (const l of db.lanc) {
    if (l.data < de || l.data > hoje || l.agendaId || l.fixoId || l.tipo === 'transf' || !inEscopo(perfilLanc(db, l), esc)) continue;
    const t = (cm[l.cat] || {}).tipo; if (t === 'pj_fixo' || t === 'imposto') continue;
    if (l.tipo === 'entrada') e += cent(l.valor); else s += cent(l.valor);
  }
  return { entradaDia: e / 100 / janela, saidaDia: s / 100 / janela, janela };
}
function fechamentoMes(db, hoje, esc) {
  const ym = hoje.slice(0, 7), resta = diffDias(hoje, dataNoMes(ym, 31));
  const p = previsaoSaldo(db, hoje, resta, esc), r = ritmoDiario(db, hoje, esc);
  const estimado = r ? r2(p.final + (r.entradaDia - r.saidaDia) * resta) : null;
  return { base: p.base, comprometido: p.final, estimado, resta, entradasPrev: p.entradas, saidasPrev: p.saidas, ritmo: r, negativoEm: p.negativoEm };
}

/* ---------- runway e reserva ---------- */
function queimaMensal(db, hoje, esc) {
  const prim = primeiroLanc(db); if (!prim) return null;
  const dias = diffDias(prim, hoje) + 1; if (dias < 14) return null;
  const janela = Math.min(90, dias), f = fluxoPeriodo(db, addDias(hoje, -(janela - 1)), hoje, esc), fator = 30 / janela;
  return { essenciais: r2((f.essenciais + (esc === 'pj' ? f.retiradas : 0)) * fator), saidas: r2((f.saidas + (esc === 'pj' ? f.retiradas : 0)) * fator), entradas: r2(f.entradas * fator), janela, curto: janela < 60 };
}
function runway(db, hoje, esc) {
  const q = queimaMensal(db, hoje, esc), s = saldoEscopo(db, esc, hoje);
  if (!q || q.essenciais <= 0) return { meses: null, recursos: s.total, motivo: 'Ainda não há histórico de despesas suficiente (mínimo de 14 dias de lançamentos).' };
  const recursos = Math.max(0, s.total), burn = r2(q.saidas - q.entradas);
  return { meses: recursos / q.essenciais, dias: Math.round(recursos / q.essenciais * 30), mesesLiq: burn > 0 ? recursos / burn : Infinity, burnLiquido: burn, recursos, queima: q.essenciais, curto: q.curto };
}
function reservaMeses(db, hoje, esc) {
  const q = queimaMensal(db, hoje, esc), s = saldoEscopo(db, esc, hoje);
  const temConta = db.contas.some(c => c.tipo === 'reserva' && c.ativa !== false && inEscopo(c.perfil, esc));
  if (!temConta) return { sem: true, motivo: 'Nenhuma conta do tipo Reserva cadastrada.' };
  if (!q || q.essenciais <= 0) return { sem: true, reserva: s.reserva, motivo: 'Sem histórico de despesas para calcular os meses.' };
  return { sem: false, reserva: s.reserva, meses: s.reserva / q.essenciais, queima: q.essenciais };
}

/* ---------- confiança dos dados ---------- */
function confianca(db, hoje, esc) {
  const fatores = []; let pts = 0;
  const add = (ok, parcial, txt) => { pts += ok ? 1 : (parcial ? 0.5 : 0); fatores.push({ ok, parcial: !ok && !!parcial, txt }); };
  const prim = primeiroLanc(db), ult = db.lanc.reduce((m, l) => (!m || l.data > m ? l.data : m), null);
  const hist = prim ? diffDias(prim, hoje) + 1 : 0;
  add(hist >= 60, hist >= 30, hist >= 60 ? 'Histórico de ' + hist + ' dias.' : 'Histórico curto (' + hist + ' dias). Com 60 dias ou mais as previsões ficam mais confiáveis.');
  const rec = ult ? diffDias(ult, hoje) : 999;
  add(rec <= 7, rec <= 15, rec <= 7 ? 'Lançamentos recentes (último há ' + rec + ' dia(s)).' : 'Sem lançamentos recentes. Registre suas últimas movimentações.');
  const dist = new Set(db.lanc.filter(l => l.data >= addDias(hoje, -29) && l.data <= hoje).map(l => l.data)).size;
  add(dist >= 8, dist >= 4, dist >= 8 ? 'Boa frequência de registros (' + dist + ' dias com movimento nos últimos 30).' : 'Poucos dias com registros nos últimos 30 (' + dist + ').');
  const cs = db.contas.filter(c => c.ativa !== false && inEscopo(c.perfil, esc));
  const conf = cs.some(c => c.confirmadoEm && diffDias(c.confirmadoEm, hoje) <= 30);
  add(conf, cs.some(c => c.confirmadoEm), conf ? 'Saldo de conta conferido nos últimos 30 dias.' : 'Confira o saldo das contas com o do banco (Contas → editar → saldo atual).');
  const rec90 = db.lanc.filter(l => l.data >= addDias(hoje, -89) && l.tipo !== 'transf');
  const comCat = rec90.filter(l => l.cat).length, pcat = rec90.length ? comCat / rec90.length : 0;
  add(pcat >= 0.8 && rec90.length > 0, pcat >= 0.5, rec90.length ? Math.round(pcat * 100) + '% dos lançamentos têm categoria.' : 'Nenhum lançamento para avaliar categorias.');
  const comp = db.agenda.some(a => a.status === 'aberto') || db.recorr.length > 0 || db.fixos.length > 0;
  add(comp, false, comp ? 'Há compromissos futuros cadastrados.' : 'Cadastre contas a pagar/receber ou recorrências para previsões completas.');
  const nivel = pts >= 5 ? 'alta' : pts >= 3 ? 'moderada' : 'baixa';
  return { nivel, pontos: pts, total: fatores.length, fatores };
}

/* ---------- saúde financeira (critérios transparentes e configuráveis) ---------- */
const piorNivel = lst => lst.reduce((m, n) => (NIVEIS.indexOf(n) > NIVEIS.indexOf(m) ? n : m), 'saudavel');
function saudeEscopo(db, hoje, esc) {
  const cfg = { ...SAUDE_PADRAO, ...(db.config.saude || {}) }, criterios = [];
  const rw = runway(db, hoje, esc), meta = esc === 'pj' ? cfg.reservaMesesPJ : cfg.reservaMesesPF;
  if (rw.meses != null) {
    const m = rw.meses, n = m >= meta ? 'saudavel' : m >= meta / 2 ? 'atencao' : m >= 1 ? 'risco' : 'critica';
    criterios.push({ id: 'cobertura', nome: 'Cobertura das despesas essenciais', valor: m.toFixed(1).replace('.', ',') + ' meses', limite: 'Saudável a partir de ' + meta + ' meses; atenção a partir de ' + (meta / 2).toString().replace('.', ',') + '; risco a partir de 1', nivel: n });
  }
  const f30 = fluxoPeriodo(db, addDias(hoje, -29), hoje, esc);
  if (f30.entradas > 0 || f30.saidas > 0) {
    const marg = f30.entradas > 0 ? (f30.entradas - f30.saidas) / f30.entradas : -1;
    const n = f30.entradas <= 0 ? 'critica' : marg * 100 >= cfg.margemSaudavel ? 'saudavel' : marg >= 0 ? 'atencao' : marg >= -0.1 ? 'risco' : 'critica';
    criterios.push({ id: 'resultado', nome: 'Resultado dos últimos 30 dias', valor: f30.entradas > 0 ? (marg * 100).toFixed(1).replace('.', ',') + '% das entradas' : 'sem entradas', limite: 'Saudável a partir de ' + cfg.margemSaudavel + '% de sobra; atenção até 0%; risco até -10%', nivel: n });
  }
  if (esc === 'pf' && f30.entradas > 0) {
    const c = f30.essenciais / f30.entradas * 100, n = c <= cfg.compSaudavel ? 'saudavel' : c <= cfg.compAtencao ? 'atencao' : c <= cfg.compRisco ? 'risco' : 'critica';
    criterios.push({ id: 'comprometimento', nome: 'Comprometimento da renda com despesas essenciais', valor: c.toFixed(0) + '%', limite: 'Saudável até ' + cfg.compSaudavel + '%; atenção até ' + cfg.compAtencao + '%; risco até ' + cfg.compRisco + '%', nivel: n });
  }
  const pv = previsaoSaldo(db, hoje, 30, esc);
  if (pv.comps.length > 0 || pv.base !== 0) {
    const n = !pv.negativoEm ? 'saudavel' : diffDias(hoje, pv.negativoEm) <= 7 ? 'critica' : 'risco';
    criterios.push({ id: 'previsao', nome: 'Saldo previsto nos próximos 30 dias', valor: pv.negativoEm ? 'negativo em ' + fmtData(pv.negativoEm) : 'sem saldo negativo previsto', limite: 'Risco se ficar negativo; crítico se for em até 7 dias', nivel: n });
  }
  return criterios;
}
function saudeFinanceira(db, hoje, esc) {
  const conf = confianca(db, hoje, esc);
  let criterios = [];
  if (esc === 'ambos') {
    saudeEscopo(db, hoje, 'pf').forEach(c => criterios.push({ ...c, nome: 'Pessoal: ' + c.nome }));
    saudeEscopo(db, hoje, 'pj').forEach(c => criterios.push({ ...c, nome: 'Empresa: ' + c.nome }));
  } else criterios = saudeEscopo(db, hoje, esc);
  if (criterios.length < 2) return { nivel: 'indefinida', criterios, confianca: conf, motivo: 'Dados insuficientes: são necessários pelo menos 2 critérios calculáveis. Continue registrando suas movimentações.' };
  if (conf.nivel === 'baixa') return { nivel: 'indefinida', criterios, confianca: conf, motivo: 'A confiança dos dados está baixa, então não vamos dar um diagnóstico definitivo. Veja abaixo como melhorar.' };
  return { nivel: piorNivel(criterios.map(c => c.nivel)), criterios, confianca: conf, motivo: 'A situação geral é a do pior critério avaliado.' };
}

/* ---------- alertas e próxima ação (sempre com motivo e dados usados) ---------- */
function alertas(db, hoje, esc) {
  const out = [], ym = hoje.slice(0, 7), cfg = db.config;
  const sl = saldoEscopo(db, esc, hoje).livre;
  const pv30 = previsaoSaldo(db, hoje, 30, esc);
  const venc = compromissos(db, hoje, addDias(hoje, 0), esc).filter(c => c.vencida && c.valor < 0);
  if (venc.length) { const t = soma(venc, c => -c.valor); out.push({ id: 'vencidas', nivel: 'risco', titulo: venc.length + (venc.length === 1 ? ' conta vencida' : ' contas vencidas') + ' (' + brl(t) + ')', motivo: 'Há contas com vencimento anterior a hoje e ainda em aberto, o que pode gerar juros e multas.', dados: venc.slice(0, 5).map(c => c.desc + ': ' + brl(-c.valor) + ' (venceu em ' + fmtData(c.venc) + ')') }); }
  if (pv30.negativoEm) out.push({ id: 'negativo', nivel: diffDias(hoje, pv30.negativoEm) <= 7 ? 'risco' : 'atencao', titulo: 'Seu saldo pode ficar negativo em ' + fmtData(pv30.negativoEm), motivo: 'Somando o saldo disponível de hoje aos compromissos cadastrados, o saldo previsto cai abaixo de zero.', dados: ['Saldo disponível hoje: ' + brl(pv30.base), 'Menor saldo previsto: ' + brl(pv30.minimo.saldo) + ' em ' + fmtData(pv30.minimo.data), 'Considera apenas compromissos cadastrados (contas a pagar/receber, recorrências e custos fixos).'] });
  const c7 = compromissos(db, hoje, addDias(hoje, 7), esc).filter(c => c.valor < 0), sai7 = soma(c7, c => -c.valor);
  if (sai7 > 0) out.push({ id: 'sete', nivel: sai7 > Math.max(sl, 0) ? 'risco' : sai7 > Math.max(sl, 0) * 0.5 ? 'atencao' : 'info', titulo: 'Você tem ' + brl(sai7) + ' a pagar nos próximos 7 dias', motivo: sai7 > Math.max(sl, 0) ? 'O valor dos compromissos é maior que o dinheiro disponível hoje.' : 'Compromissos da semana somados ao saldo disponível de hoje (' + brl(sl) + ').', dados: c7.slice(0, 6).map(c => c.desc + ': ' + brl(-c.valor) + ' em ' + fmtData(c.data)) });
  if (hoje.slice(8) >= '07') {
    const prev = somaMes(ym, -1), diaCorte = Math.min(Number(hoje.slice(8)), ultimoDiaMes(prev));
    const a = fluxoPeriodo(db, ym + '-01', hoje, esc).saidas, b = fluxoPeriodo(db, prev + '-01', prev + '-' + pad(diaCorte), esc).saidas;
    if (b > 0 && a > b * 1.15) out.push({ id: 'despesas', nivel: 'atencao', titulo: 'Suas despesas estão ' + Math.round((a / b - 1) * 100) + '% acima do mês passado', motivo: 'Comparação do período de 1º a ' + pad(diaCorte) + ' deste mês com o mesmo período do mês anterior.', dados: ['Este mês: ' + brl(a), 'Mês anterior (mesmo período): ' + brl(b)] });
  }
  if (esc !== 'pj') {
    const rm = reservaMeses(db, hoje, 'pf'), meta = (cfg.saude || SAUDE_PADRAO).reservaMesesPF || SAUDE_PADRAO.reservaMesesPF;
    if (!rm.sem && rm.meses < meta) out.push({ id: 'reserva', nivel: rm.meses < 1 ? 'risco' : 'atencao', titulo: 'Sua reserva está abaixo da meta', motivo: 'A reserva pessoal cobre ' + rm.meses.toFixed(1).replace('.', ',') + ' mês(es) de despesas essenciais e a meta cadastrada é de ' + meta + '.', dados: ['Reserva: ' + brl(rm.reserva), 'Despesas essenciais mensais (média): ' + brl(rm.queima), 'Faltam ' + brl(Math.max(0, meta * rm.queima - rm.reserva)) + ' para a meta.'] });
  }
  if (esc !== 'pf') {
    const m1 = calcular(db, somaMes(ym, -1)), m2 = calcular(db, somaMes(ym, -2));
    if (m2.fat > 0 && m1.fat > m2.fat * 1.05 && m1.margemOp < m2.margemOp - 0.03) out.push({ id: 'margem', nivel: 'atencao', titulo: 'Seu faturamento subiu, mas a margem caiu', motivo: 'Comparação entre os dois últimos meses fechados: mais receita, porém menor lucro operacional proporcional.', dados: ['Faturamento: ' + brl(m2.fat) + ' → ' + brl(m1.fat), 'Margem operacional: ' + pct(m2.margemOp) + ' → ' + pct(m1.margemOp)] });
    const plan = Number(cfg.prolaborePlanejado) || 0, cur = calcular(db, ym);
    if (plan > 0 && cur.retirado > plan) out.push({ id: 'retirada', nivel: 'atencao', titulo: 'As retiradas da empresa passaram do planejado', motivo: 'O valor planejado de retiradas mensais cadastrado nos Ajustes foi ultrapassado neste mês.', dados: ['Retirado no mês: ' + brl(cur.retirado), 'Planejado: ' + brl(plan)] });
  }
  const ordem = { risco: 0, atencao: 1, info: 2 };
  return out.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}
function proximaAcao(db, hoje, esc) {
  const al = alertas(db, hoje, esc), sl = saldoEscopo(db, esc, hoje).livre;
  const por = id => al.find(a => a.id === id);
  if (!db.lanc.length && !db.agenda.length) return { titulo: 'Comece conferindo o saldo das suas contas', texto: 'Informe quanto você tem hoje em cada conta e faça o primeiro lançamento. Com isso o app já consegue calcular seu saldo disponível.', motivo: 'Ainda não há movimentações nem contas a pagar cadastradas, então não existem dados para diagnóstico.', ir: 'contas', rotulo: 'Ver minhas contas' };
  const v = por('vencidas'); if (v) return { titulo: 'Resolva as contas vencidas', texto: v.titulo + '. Pague ou renegocie para evitar juros.', motivo: v.motivo, dados: v.dados, ir: 'agenda', rotulo: 'Abrir contas a pagar' };
  const n = por('negativo'); if (n) return { titulo: 'Evite o saldo negativo', texto: n.titulo + '. Antecipe uma entrada ou adie uma despesa que não seja essencial.', motivo: n.motivo, dados: n.dados, ir: 'analises', rotulo: 'Ver previsão' };
  const s = por('sete'); if (s) return { titulo: esc === 'pj' || esc === 'ambos' ? 'Preserve o dinheiro dos próximos pagamentos' : 'Reserve o dinheiro dos próximos pagamentos', texto: 'Você possui ' + brl(soma(compromissos(db, hoje, addDias(hoje, 7), esc).filter(c => c.valor < 0), c => -c.valor)) + ' em contas a pagar nos próximos sete dias' + (esc !== 'pf' ? '. Preserve esse valor antes de realizar novas retiradas.' : '. Evite gastos novos até quitá-las.'), motivo: s.motivo, dados: s.dados, ir: 'agenda', rotulo: 'Ver o que vence' };
  const r = por('reserva'); if (r) return { titulo: 'Fortaleça sua reserva', texto: r.titulo + '.', motivo: r.motivo, dados: r.dados, ir: 'lancar', rotulo: 'Registrar transferência' };
  const t = por('retirada'); if (t) return { titulo: 'Segure as retiradas neste mês', texto: t.titulo + '.', motivo: t.motivo, dados: t.dados, ir: 'analises', rotulo: 'Ver análises' };
  const prox = compromissos(db, hoje, addDias(hoje, 30), esc).filter(c => c.valor < 0)[0];
  return { titulo: 'Tudo em dia por enquanto', texto: prox ? 'Nenhuma ação urgente. O próximo pagamento é ' + prox.desc + ' (' + brl(-prox.valor) + ') em ' + fmtData(prox.data) + '.' : 'Nenhuma ação urgente. Continue registrando suas movimentações.', motivo: 'Não há contas vencidas, saldo negativo previsto nem compromissos acima do saldo disponível.', ir: 'analises', rotulo: 'Ver diagnóstico' };
}

/* ---------- painel por perfil ---------- */
function painel(db, hoje, esc) {
  const ym = hoje.slice(0, 7), c = calcular(db, ym), s = saldos(db, hoje), cards = [];
  const mesFlux = e => fluxoPeriodo(db, ym + '-01', ym + '-31', e);
  const compBlock = () => {
    const f = mesFlux('pf');
    return f.entradas > 0 ? f.essenciais / f.entradas : null;
  };
  const pf = () => {
    const rm = reservaMeses(db, hoje, 'pf'), f = mesFlux('pf');
    cards.push({ g: 'Pessoal', k: 'Patrimônio líquido', v: s.pf, fmt: 'brl', s: 'Soma das contas pessoais cadastradas. Não inclui bens nem dívidas não cadastradas.' });
    cards.push({ g: 'Pessoal', k: 'Saldo disponível', v: s.pfLivre, fmt: 'brl', s: 'Contas correntes e carteiras, sem a reserva.' });
    cards.push({ g: 'Pessoal', k: 'Resultado do mês', v: f.entradas || f.saidas ? f.resultado : null, fmt: 'brl', s: f.entradas || f.saidas ? 'Entradas − saídas pessoais do mês.' : 'Sem movimentos pessoais no mês.' });
    cards.push({ g: 'Pessoal', k: 'Comprometimento de renda', v: compBlock(), fmt: 'pct', s: compBlock() == null ? 'Sem renda registrada no mês.' : 'Despesas essenciais ÷ renda do mês.' });
    cards.push({ g: 'Pessoal', k: 'Reserva de emergência', v: rm.sem ? null : rm.meses, fmt: 'meses', s: rm.sem ? rm.motivo : 'Reserva ÷ despesas essenciais mensais (média).' });
  };
  const pj = () => {
    const rw = runway(db, hoje, 'pj'), tp = totaisPeriodo(db, db.lanc.filter(l => l.data.slice(0, 7) === ym));
    const a30 = soma(compromissos(db, hoje, addDias(hoje, 30), 'pj').filter(x => x.valor > 0), x => x.valor), p30 = soma(compromissos(db, hoje, addDias(hoje, 30), 'pj').filter(x => x.valor < 0), x => -x.valor);
    cards.push({ g: 'Empresa', k: 'Faturamento', v: c.fat, fmt: 'brl', s: 'Entradas da empresa no mês. Não é lucro nem saldo.' });
    cards.push({ g: 'Empresa', k: 'Lucro operacional', v: c.fat > 0 ? c.lucroOp : null, fmt: 'brl', s: c.fat > 0 ? 'Faturamento − imposto estimado − custos variáveis e fixos.' : 'Sem faturamento no mês.' });
    cards.push({ g: 'Empresa', k: 'Fluxo de caixa', v: tp.resPJ, fmt: 'brl', s: 'Variação do caixa da empresa no mês (inclui retiradas).' });
    cards.push({ g: 'Empresa', k: 'Margem operacional', v: c.fat > 0 ? c.margemOp : null, fmt: 'pct', s: c.fat > 0 ? 'Lucro operacional ÷ faturamento.' : 'Sem faturamento no mês.' });
    cards.push({ g: 'Empresa', k: 'Capital de giro', v: r2(s.pjLivre + a30 - p30), fmt: 'brl', s: 'Saldo livre + a receber − a pagar nos próximos 30 dias.' });
    cards.push({ g: 'Empresa', k: 'Runway da empresa', v: rw.meses, fmt: 'meses', s: rw.meses == null ? rw.motivo : 'Recursos ÷ despesas essenciais e retiradas mensais.' });
  };
  if (esc === 'pf') pf(); else if (esc === 'pj') pj(); else {
    pf(); pj();
    const rc = reservaMeses(db, hoje, 'ambos'), q = queimaMensal(db, hoje, 'ambos'), dep = c.rendaPFTransf + c.rendaPF > 0 ? c.rendaPFTransf / (c.rendaPFTransf + c.rendaPF) : null;
    cards.push({ g: 'Integrado', k: 'Total retirado da empresa', v: c.retirado, fmt: 'brl', s: 'Transferências da empresa para o CPF no mês, de qualquer natureza.' });
    cards.push({ g: 'Integrado', k: 'Transferido entre CPF e CNPJ', v: c.cruzadas, fmt: 'brl', s: 'Soma dos dois sentidos no mês. Não entra como receita nem despesa.' });
    cards.push({ g: 'Integrado', k: 'Dependência pessoal da empresa', v: dep, fmt: 'pct', s: dep == null ? 'Sem renda pessoal registrada no mês.' : 'Parte da renda pessoal que veio da empresa (pró-labore e lucros).' });
    cards.push({ g: 'Integrado', k: 'Reserva consolidada', v: rc.sem ? null : rc.meses, fmt: 'meses', s: rc.sem ? rc.motivo : 'Reservas de CPF + CNPJ ÷ despesas essenciais combinadas.' });
    const sf = saudeFinanceira(db, hoje, 'ambos');
    cards.push({ g: 'Integrado', k: 'Saúde financeira integrada', v: sf.nivel, fmt: 'nivel', s: sf.motivo });
  }
  return cards;
}

/* ---------- lançamento inteligente (voz/texto) ---------- */
function classificarV2(texto, db, esc) {
  const r = classificar(texto, db.cats), t = norm(texto);
  let tipo = r.tipo, cat = r.cat, natureza = '', conta = '', contaDest = '';
  if (/distribuicao de lucro|dividendo|retirada de lucro/.test(t)) { tipo = 'prolabore'; natureza = 'distribuicao'; }
  else if (tipo === 'prolabore') natureza = 'prolabore';
  if (tipo === 'saida_pf' && /\b(recebi|ganhei)\b/.test(t)) { tipo = 'entrada'; }
  if (tipo === 'prolabore') {
    tipo = 'transf'; cat = '';
    const o = contaPadrao(db, 'PJ'), d = contaPadrao(db, 'PF');
    conta = o ? o.id : ''; contaDest = d ? d.id : '';
  } else {
    if (esc === 'pf' && tipo === 'saida_pj') { tipo = 'saida_pf'; cat = ''; }
    if (esc === 'pj' && tipo === 'saida_pf') { tipo = 'saida_pj'; cat = ''; }
    const per = tipo === 'saida_pf' ? 'PF' : tipo === 'saida_pj' ? 'PJ' : (esc === 'pf' || /salario|pessoal/.test(t) ? 'PF' : 'PJ');
    const c = contaPadrao(db, per) || contaPadrao(db, per === 'PF' ? 'PJ' : 'PF');
    conta = c ? c.id : '';
  }
  return { tipo, valor: r.valor, cat, data: r.data, desc: r.desc, natureza, conta, contaDest };
}

if (typeof module !== 'undefined') {
  module.exports = { novoDb, migrarDb, criarLanc, validarLanc, saldos, saldoConta, calcularLista, totaisPeriodo, fluxoPeriodo, materializar, ocorrenciasRecorr, pagarAgenda, desfazerPagamento, compromissos, previsaoSaldo, fechamentoMes, runway, reservaMeses, confianca, saudeFinanceira, alertas, proximaAcao, painel, classificarV2, soma, cent };
}

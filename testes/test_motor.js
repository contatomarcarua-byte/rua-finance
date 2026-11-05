const H='2026-11-15';
const novo=()=>{const d=migrarDb(novoDb());return d};
const L=(db,o)=>{const r=criarLanc(db,o);if(!r.ok)throw new Error(r.erro);return r.lanc};

t('precisão em centavos',()=>{ eq(soma([0.1,0.2]),0.3,'0.1+0.2'); eq(soma(Array(1000).fill(0.1)),100,'1000x0.1'); eq(soma([19.99,19.99,19.99]),59.97,'3x19.99'); });

t('migração v1→v2 preserva dados e saldos',()=>{
  const v1={lanc:[
    {id:'a',tipo:'entrada',valor:5000,data:'2026-10-05',desc:'Frete',cat:'r_frete'},
    {id:'b',tipo:'saida_pj',valor:800,data:'2026-10-06',desc:'Gasolina',cat:'v_comb'},
    {id:'c',tipo:'saida_pj',valor:250,data:'2026-10-07',desc:'Contador',cat:'f_contador',fixoId:'x'},
    {id:'d',tipo:'prolabore',valor:2000,data:'2026-10-08',desc:'PL'},
    {id:'e',tipo:'saida_pf',valor:300,data:'2026-10-09',desc:'Mercado',cat:'p_mercado'}],
    cats:CATS_PADRAO,fixos:[{id:'x',nome:'Contador',valor:250,cat:'f_contador',criado:'2026-01'}],metas:{'2026-10':{fat:6000,sobra:1000}},
    config:{aliquota:6,saldoIniPJ:1500,saldoIniPF:200,tema:'dark',voiceAuto:true}};
  const m=migrarDb(JSON.parse(JSON.stringify(v1)));
  eq(m.v,2,'versão'); eq(m.lanc.length,5,'qtd'); eq(m.lanc.map(l=>l.id),['a','b','c','d','e'],'ids');
  eq(m.lanc[3].tipo,'transf','prolabore→transf'); eq(m.lanc[3].natureza,'prolabore','natureza');
  const s=saldos(m,'2026-12-31');
  eq(s.pj,1500+5000-800-250-2000,'saldo PJ igual ao modelo antigo'); eq(s.pf,200+2000-300,'saldo PF igual ao antigo');
  eq(m.config.tema,'dark','config preservada'); eq(m.config.voiceAuto,true,'voz preservada'); eq(m.metas['2026-10'].fat,6000,'metas'); eq(m.fixos.length,1,'fixos');
  const c=calcular(m,'2026-10');
  // fórmula antiga: 5000 - imposto(300) - variáveis(800) - fixos(250 pagos; sem pendência) - prolabore(2000)
  eq(c.fat,5000,'fat'); eq(c.imposto,300,'imposto'); eq(c.sobra,5000-300-800-250-2000,'sobra igual ao antigo'); eq(c.prolabore,2000,'prolabore'); eq(c.pf,300,'pf');
  const m2=migrarDb(JSON.parse(JSON.stringify(m))); eq(m2.lanc.length,5,'idempotente'); eq(m2.contas.length,2,'sem contas duplicadas');
  eq(m.log.length,1,'log de migração');
});

t('ponte CPF↔CNPJ: nada é inflado nem duplicado',()=>{
  const db=novo(); db.contas[0].saldoIni=10000; db.contas[1].saldoIni=500;
  L(db,{tipo:'entrada',valor:8000,data:'2026-11-03',conta:'c_pj',cat:'r_frete'});
  L(db,{tipo:'saida_pj',valor:1000,data:'2026-11-04',conta:'c_pj',cat:'v_comb'});
  const antes=saldos(db,H), cA=calcular(db,'2026-11'), fA=fluxoPeriodo(db,'2026-11-01','2026-11-30','ambos');
  L(db,{tipo:'transf',valor:3000,data:'2026-11-05',conta:'c_pj',contaDest:'c_pf',natureza:'prolabore'});
  const dep=saldos(db,H), c=calcular(db,'2026-11');
  eq(dep.total,antes.total,'total consolidado inalterado'); eq(dep.pj,antes.pj-3000,'PJ −3000'); eq(dep.pf,antes.pf+3000,'PF +3000');
  eq(c.fat,cA.fat,'faturamento inalterado'); eq(c.prolabore,3000,'pró-labore'); eq(c.sobra,cA.sobra-3000,'sobra desconta pró-labore');
  const fB=fluxoPeriodo(db,'2026-11-01','2026-11-30','ambos'); eq(fB.entradas,fA.entradas,'entradas consolidadas'); eq(fB.saidas,fA.saidas,'saídas consolidadas');
  eq(fluxoPeriodo(db,'2026-11-01','2026-11-30','pf').entradas,3000,'renda PF inclui pró-labore'); eq(c.rendaPF,0,'não é entrada pessoal');
  L(db,{tipo:'transf',valor:1000,data:'2026-11-06',conta:'c_pj',contaDest:'c_pf',natureza:'reembolso'});
  const c2=calcular(db,'2026-11'); eq(c2.sobra,c.sobra,'reembolso não altera sobra'); eq(c2.retirado,4000,'retirado soma tudo'); eq(c2.cruzadas,4000,'cruzadas');
  eq(fluxoPeriodo(db,'2026-11-01','2026-11-30','pf').entradas,3000,'reembolso não é renda pessoal');
  L(db,{tipo:'transf',valor:2000,data:'2026-11-07',conta:'c_pj',contaDest:'c_pf',natureza:'distribuicao'});
  const c3=calcular(db,'2026-11'); eq(c3.sobra,c.sobra,'distribuição de lucros não é despesa'); eq(c3.distribuicao,2000,'distribuição'); eq(fluxoPeriodo(db,'2026-11-01','2026-11-30','pf').entradas,5000,'distribuição é renda pessoal');
  L(db,{tipo:'transf',valor:700,data:'2026-11-08',conta:'c_pf',contaDest:'c_pj',natureza:'emprestimo'});
  const c4=calcular(db,'2026-11'); eq(c4.aportes,700,'aporte PF→PJ'); eq(c4.fat,8000,'aporte não vira faturamento'); eq(saldos(db,H).total,antes.total,'total ainda igual');
  db.contas.push({id:'c_res',nome:'Reserva',perfil:'PJ',tipo:'reserva',saldoIni:0,ativa:true});
  L(db,{tipo:'transf',valor:500,data:'2026-11-09',conta:'c_pj',contaDest:'c_res'});
  eq(saldos(db,H).total,antes.total,'transferência interna não altera total'); eq(calcular(db,'2026-11').sobra,c4.sobra,'interna não altera sobra'); eq(saldos(db,H).reservaPJ,500,'reserva PJ');
});

t('validações',()=>{
  const db=novo();
  eq(criarLanc(db,{tipo:'entrada',valor:0,data:'2026-11-01',conta:'c_pj'}).ok,false,'valor zero');
  eq(criarLanc(db,{tipo:'entrada',valor:10,data:'',conta:'c_pj'}).ok,false,'sem data');
  eq(criarLanc(db,{tipo:'transf',valor:10,data:'2026-11-01',conta:'c_pj',contaDest:'c_pj',natureza:'prolabore'}).erro,'Origem e destino precisam ser contas diferentes.','mesma conta');
  eq(criarLanc(db,{tipo:'transf',valor:10,data:'2026-11-01',conta:'c_pj',contaDest:'c_pf'}).ok,false,'sem natureza');
  eq(criarLanc(db,{tipo:'saida_pj',valor:10,data:'2026-11-01',conta:'c_pf'}).ok,false,'saída PJ em conta PF');
  eq(criarLanc(db,{tipo:'saida_pf',valor:10,data:'2026-11-01',conta:'c_pj'}).ok,false,'saída PF em conta PJ');
  eq(criarLanc(db,{tipo:'entrada',valor:10,data:'2026-11-01',conta:'nao'}).ok,false,'conta inexistente');
  eq(db.lanc.length,0,'nada gravado nos erros');
});

t('recorrências',()=>{
  const r={id:'r1',desc:'Aluguel',valor:1000,tipo:'pagar',perfil:'PF',freq:'mensal',dia:31,inicio:'2026-01-31',ativa:true};
  const o=ocorrenciasRecorr(r,'2026-04-30'); eq(o.map(x=>x.data),['2026-01-31','2026-02-28','2026-03-31','2026-04-30'],'dia 31 ajusta ao fim do mês');
  eq(ocorrenciasRecorr({...r,parcelas:3},'2027-12-31').length,3,'3 parcelas');
  eq(ocorrenciasRecorr({...r,freq:'semanal',inicio:'2026-11-02'},'2026-11-30').map(x=>x.data),['2026-11-02','2026-11-09','2026-11-16','2026-11-23','2026-11-30'],'semanal');
  eq(ocorrenciasRecorr({...r,freq:'anual',inicio:'2024-02-29'},'2026-12-31').map(x=>x.data),['2024-02-29','2025-02-28','2026-02-28'],'anual 29/02');
  eq(ocorrenciasRecorr({...r,fim:'2026-02-28'},'2026-12-31').length,2,'respeita data final');
  eq(ocorrenciasRecorr({...r,ativa:false},'2026-12-31').length,0,'inativa');
  const db=novo(); db.recorr.push({...r,inicio:'2026-11-05',dia:5});
  const n1=materializar(db,H,90), n2=materializar(db,H,90); eq(n1>=3,true,'gera ocorrências'); eq(n2,0,'idempotente'); eq(db.agenda.every(a=>a.status==='aberto'),true,'abertas');
  const alvo=db.agenda[0]; alvo.status='cancelado'; eq(materializar(db,H,90),0,'cancelada não regenera');
  const dp=novo(); dp.recorr.push({id:'p',desc:'Notebook',valor:300,tipo:'pagar',perfil:'PF',freq:'mensal',inicio:'2026-11-10',parcelas:4,ativa:true});
  materializar(dp,H,365); eq(dp.agenda.length,4,'parcelamento gera só 4'); eq(dp.agenda[3].desc,'Notebook (4/4)','rótulo da parcela');
});

t('agenda: pagar e desfazer',()=>{
  const db=novo(); db.contas[1].saldoIni=1000;
  db.agenda.push({id:'g1',tipo:'pagar',perfil:'PF',desc:'Internet',valor:120,venc:'2026-11-20',cat:'',status:'aberto'});
  eq(pagarAgenda(db,'g1','c_pj','2026-11-15').ok,false,'conta de perfil errado');
  const r=pagarAgenda(db,'g1','c_pf','2026-11-15'); eq(r.ok,true,'pagou'); eq(saldos(db,H).pf,880,'saldo cai'); eq(db.agenda[0].status,'pago','status');
  eq(pagarAgenda(db,'g1','c_pf','2026-11-15').ok,false,'não paga duas vezes'); eq(db.lanc.length,1,'um lançamento só');
  eq(desfazerPagamento(db,'g1'),true,'desfaz'); eq(saldos(db,H).pf,1000,'saldo volta'); eq(db.lanc.length,0,'lanç removido'); eq(db.agenda[0].status,'aberto','reabre');
});

t('previsão, vencidas e fechamento do mês',()=>{
  const db=novo(); db.contas[1].saldoIni=1000;
  db.agenda.push({id:'a1',tipo:'pagar',perfil:'PF',desc:'Aluguel',valor:1500,venc:'2026-11-20',status:'aberto'});
  db.agenda.push({id:'a2',tipo:'receber',perfil:'PF',desc:'Freela',valor:800,venc:'2026-11-25',status:'aberto'});
  db.agenda.push({id:'a3',tipo:'pagar',perfil:'PF',desc:'Luz atrasada',valor:90,venc:'2026-11-10',status:'aberto'});
  const p=previsaoSaldo(db,H,30,'pf');
  eq(p.base,1000,'base'); eq(p.pontos[0].saldo,910,'vencida conta como hoje'); eq(p.negativoEm,'2026-11-20','negativo no aluguel'); eq(p.minimo.saldo,-590,'mínimo'); eq(p.final,210,'final');
  const f=fechamentoMes(db,H,'pf'); eq(f.resta,15,'dias restantes'); eq(f.comprometido,210,'fechamento comprometido'); eq(f.estimado,null,'sem histórico: sem estimativa');
  eq(previsaoSaldo(db,H,3,'pf').negativoEm,null,'em 3 dias ainda positivo'); eq(previsaoSaldo(db,H,7,'pf').negativoEm,'2026-11-20','em 7 dias já negativo');
  eq(previsaoSaldo(db,H,30,'pj').comps.length,0,'escopo PJ não vê itens PF');
  const al=alertas(db,H,'pf'); eq(al.some(a=>a.id==='vencidas'),true,'alerta de vencidas'); eq(al.some(a=>a.id==='negativo'),true,'alerta de negativo');
  eq(al.every(a=>a.motivo&&a.motivo.length>10&&a.dados),true,'todo alerta traz motivo e dados');
  const pa=proximaAcao(db,H,'pf'); eq(pa.ir,'agenda','próxima ação: vencidas primeiro'); eq(!!pa.motivo,true,'tem motivo');
  db.fixos.push({id:'f1',nome:'Contador',valor:250,dia:10,cat:'f_contador',criado:'2026-01'});
  const pj=previsaoSaldo(db,H,45,'pj'); eq(pj.comps.filter(c=>c.origem==='fixo').length,2,'fixo pendente do mês + dez'); eq(pj.comps[0].vencida,true,'fixo atrasado');
});

// histórico de 90 dias para runway/saúde
const hist=(db,o)=>{ // gera lançamentos diários
  for(let i=0;i<o.dias;i++){ const d=addDias(H,-i);
    if(i%3===0&&o.entrada) L(db,{tipo:'entrada',valor:o.entrada,data:d,conta:o.contaE||'c_pf',cat:o.catE||''});
    if(i%2===0&&o.saida) L(db,{tipo:'saida_pf',valor:o.saida,data:d,conta:'c_pf',cat:'p_mercado'}); } };
t('runway, reserva e saúde financeira',()=>{
  const db=novo(); hist(db,{dias:90,entrada:300,saida:100}); // 30 entradas de 300 = 9000 ; 45 saídas de 100 = 4500 em 90d
  db.contas[1].saldoIni=2000; db.contas.push({id:'rv',nome:'Reserva',perfil:'PF',tipo:'reserva',saldoIni:0,ativa:true});
  L(db,{tipo:'transf',valor:1500,data:H,conta:'c_pf',contaDest:'rv'});
  const q=queimaMensal(db,H,'pf'); const esp=Math.round(4500/89*30*100)/100; eq(q.essenciais,esp,'queima essencial: 4500 em 89 dias (primeiro lançamento há 88 dias)');
  const s=saldos(db,H); const rw=runway(db,H,'pf'); eq(rw.recursos,s.pf,'recursos = saldo PF'); eq(+rw.meses.toFixed(3),+(s.pf/esp).toFixed(3),'meses de runway'); eq(rw.mesesLiq,Infinity,'sem queima líquida');
  const rm=reservaMeses(db,H,'pf'); eq(rm.sem,false,'tem reserva'); eq(rm.reserva,1500,'reserva'); eq(+rm.meses.toFixed(3),+(1500/esp).toFixed(3),'meses de reserva');
  const al=alertas(db,H,'pf'); eq(al.find(a=>a.id==='reserva').nivel,'risco','reserva < 1 mês → risco');
  const sf=saudeFinanceira(db,H,'pf'); eq(sf.criterios.length>=3,true,'critérios'); eq(sf.criterios.every(c=>c.limite&&c.valor),true,'transparência: valor e limite');
  eq(['saudavel','atencao','risco','critica','indefinida'].includes(sf.nivel),true,'nível válido');
  db.config.saude.reservaMesesPF=0.5; const al2=alertas(db,H,'pf'); eq(al2.some(a=>a.id==='reserva'),false,'meta configurável');
});
t('saúde: limites configuráveis e pior critério domina',()=>{
  const db=novo(); hist(db,{dias:90,entrada:300,saida:100}); db.contas[1].saldoIni=20000;
  db.lanc.forEach(l=>{l.cat=l.cat||'r_outros'}); // categorizado
  db.contas[1].confirmadoEm=H;
  const a=saudeFinanceira(db,H,'pf'); eq(a.confianca.nivel!=='baixa',true,'confiança suficiente'); 
  const comp=a.criterios.find(c=>c.id==='comprometimento'); eq(comp.nivel,'saudavel','comprometimento 1500/3000=50% ≤50');
  db.config.saude.compSaudavel=40; eq(saudeFinanceira(db,H,'pf').criterios.find(c=>c.id==='comprometimento').nivel,'atencao','limite editável muda o nível');
  db.config.saude.compSaudavel=50;
  const rr=saudeFinanceira(db,H,'pf'); const pior=['saudavel','atencao','risco','critica'].reduce((m,n)=>rr.criterios.some(c=>c.nivel===n)?n:m,'saudavel'); eq(rr.nivel,pior,'nível geral = pior critério');
});
t('dados insuficientes: não diagnostica',()=>{
  const db=novo(); L(db,{tipo:'entrada',valor:100,data:H,conta:'c_pf'});
  const sf=saudeFinanceira(db,H,'pf'); eq(sf.nivel,'indefinida','poucos dados → indefinida'); eq(sf.confianca.nivel,'baixa','confiança baixa');
  eq(runway(db,H,'pf').meses,null,'runway não calculado'); eq(reservaMeses(db,H,'pf').sem,true,'reserva sem conta');
  const v=novo(); eq(saudeFinanceira(v,H,'ambos').nivel,'indefinida','banco vazio');
  eq(proximaAcao(v,H,'pf').ir,'contas','onboarding quando vazio'); eq(fechamentoMes(v,H,'pf').estimado,null,'sem estimativa');
  eq(painel(v,H,'pf').find(c=>c.k==='Comprometimento de renda').v,null,'indicador sem dados = null (não inventa)');
});
t('confiança dos dados',()=>{
  const db=novo(); hist(db,{dias:90,entrada:300,saida:100,catE:'r_frete'}); db.contas[1].confirmadoEm=H; db.agenda.push({id:'z',tipo:'pagar',perfil:'PF',desc:'x',valor:1,venc:'2026-12-01',status:'aberto'});
  const c=confianca(db,H,'pf'); eq(c.nivel,'alta','alta confiança'); eq(c.fatores.length,6,'6 fatores');
  const b=novo(); L(b,{tipo:'entrada',valor:1,data:addDias(H,-40),conta:'c_pf'}); eq(confianca(b,H,'pf').nivel,'baixa','sem recência/saldo/categoria');
});
t('alertas: despesas e margem',()=>{
  const db=novo(); // mês anterior: saídas 1000 até dia 15; este mês: 1180 até dia 15 (+18%)
  L(db,{tipo:'saida_pf',valor:1000,data:'2026-10-10',conta:'c_pf'}); L(db,{tipo:'saida_pf',valor:1180,data:'2026-11-10',conta:'c_pf'});
  const a=alertas(db,H,'pf').find(x=>x.id==='despesas'); eq(!!a,true,'alerta despesas'); eq(a.titulo.includes('18%'),true,'18%');
  const e=novo(); L(e,{tipo:'entrada',valor:10000,data:'2026-09-05',conta:'c_pj'}); L(e,{tipo:'saida_pj',valor:3000,data:'2026-09-06',conta:'c_pj',cat:'v_comb'});
  L(e,{tipo:'entrada',valor:12000,data:'2026-10-05',conta:'c_pj'}); L(e,{tipo:'saida_pj',valor:6000,data:'2026-10-06',conta:'c_pj',cat:'v_comb'});
  eq(alertas(e,H,'pj').some(x=>x.id==='margem'),true,'faturamento↑ margem↓');
  e.config.prolaborePlanejado=2000; L(e,{tipo:'transf',valor:2500,data:'2026-11-05',conta:'c_pj',contaDest:'c_pf',natureza:'prolabore'});
  eq(alertas(e,H,'pj').some(x=>x.id==='retirada'),true,'retirada acima do planejado'); e.config.prolaborePlanejado=0; eq(alertas(e,H,'pj').some(x=>x.id==='retirada'),false,'sem planejamento não alerta');
});
t('painel híbrido e dependência',()=>{
  const db=novo(); L(db,{tipo:'entrada',valor:10000,data:'2026-11-03',conta:'c_pj',cat:'r_frete'}); L(db,{tipo:'transf',valor:3000,data:'2026-11-05',conta:'c_pj',contaDest:'c_pf',natureza:'prolabore'}); L(db,{tipo:'entrada',valor:1000,data:'2026-11-06',conta:'c_pf'});
  const p=painel(db,H,'ambos'), g=k=>p.find(c=>c.k===k);
  eq(g('Faturamento').v,10000,'faturamento só PJ'); eq(g('Total retirado da empresa').v,3000,'retirado'); eq(g('Transferido entre CPF e CNPJ').v,3000,'transferido');
  eq(+g('Dependência pessoal da empresa').v.toFixed(2),0.75,'dependência 3000/(3000+1000)'); eq(g('Patrimônio líquido').v,saldos(db,H).pf,'patrimônio');
  eq(p.filter(c=>c.g==='Integrado').length,5,'5 integrados'); eq(painel(db,H,'pf').every(c=>c.g==='Pessoal'),true,'CPF só pessoal'); eq(painel(db,H,'pj').every(c=>c.g==='Empresa'),true,'CNPJ só empresa');
  eq(totaisPeriodo(db,db.lanc).retiradas,3000,'caixa: retiradas'); eq(totaisPeriodo(db,db.lanc).resPJ,10000-3000,'caixa PJ'); eq(totaisPeriodo(db,db.lanc).resPF,1000+3000,'caixa PF');
});
t('lançamento inteligente (voz) com contas e perfis',()=>{
  const db=novo();
  let r=classificarV2('gastei 80 reais de combustível',db,'ambos'); eq([r.tipo,r.valor,r.cat,r.conta],['saida_pj',80,'v_comb','c_pj'],'combustível PJ');
  r=classificarV2('recebi 350 de um cliente',db,'ambos'); eq([r.tipo,r.valor,r.conta],['entrada',350,'c_pj'],'entrada PJ');
  r=classificarV2('recebi 3000 de salário',db,'ambos'); eq([r.tipo,r.conta],['entrada','c_pf'],'salário vai para PF');
  r=classificarV2('retirei 3000 de pró-labore',db,'ambos'); eq([r.tipo,r.natureza,r.conta,r.contaDest],['transf','prolabore','c_pj','c_pf'],'pró-labore vira transferência');
  r=classificarV2('distribuição de lucros 5000',db,'ambos'); eq([r.tipo,r.natureza],['transf','distribuicao'],'distribuição');
  r=classificarV2('gastei 80 de gasolina',db,'pf'); eq([r.tipo,r.conta],['saida_pf','c_pf'],'modo CPF mantém tudo pessoal');
  r=classificarV2('gastei 30 no mercado',db,'pj'); eq(r.tipo,'saida_pj','modo CNPJ mantém tudo na empresa');
  r=classificarV2('gastei algo',db,'ambos'); eq(r.valor,null,'sem valor: não inventa');
});

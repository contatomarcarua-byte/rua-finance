const vm=require('vm'),fs=require('fs');
const run=f=>vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});
run('logic_base.js'); run('motor.js');
global.__ok=0;global.__bad=0;
global.eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b)||(typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<0.005);if(ok)__ok++;else{__bad++;console.log('  FALHOU',m,'=>',JSON.stringify(a),'esperado',JSON.stringify(b));}};
global.t=(n,f)=>{try{f();console.log('OK  ',n)}catch(e){__bad++;console.log('ERRO',n,e.message,e.stack.split('\n')[1])}};
run(process.argv[2]);
console.log(`\n${__ok} verificações ok, ${__bad} falhas`);process.exit(__bad?1:0);

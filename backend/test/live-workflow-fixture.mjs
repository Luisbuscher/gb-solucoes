import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
dotenv.config({quiet:true});
const base=process.env.APP_URL||'http://localhost:3000',stateFile=path.resolve('../docs/qa/live-workflow.json');
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Esta verificação só pode usar o ambiente local.');
let cookie='',csrf='';
async function api(route,method='GET',body){const res=await fetch(base+'/api'+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{'X-CSRF-Token':csrf,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const data=await res.json();assert.ok(res.ok,JSON.stringify({route,status:res.status,message:data.message}));if(data.csrf)csrf=data.csrf;return data;}
await api('/auth/session');await api('/auth/login','POST',{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD});
const name='Validação temporária dos novos fluxos',email='qa-workflow@example.test';
if(process.argv.includes('--create')){
 const existing=(await api('/admin/clientes')).find(c=>c.name===name);if(existing)throw new Error('Uma fixture já existe; conclua a limpeza antes de criar outra.');
 const {id}=await api('/admin/clientes','POST',{name,email,legal_name:name,cnpj:'12.345.678/0001-95',type:'MEI',activity:'servicos',partners:0,since_month:'2026-01',opening_month:'2026-01',plan:'MEI Growth',amount:'290.00',effective:'2026-01',city:'Porto Alegre',state:'RS'});
 const order=await api('/admin/pedidos','POST',{client_id:id,service_code:'consultoria',details:'Registro temporário para validar movimentação do quadro.',amount:'120.00'});
 await api('/admin/clientes/'+id+'/faturamentos','POST',{month:'2026-11',amount:'5200.30'});
 await fs.mkdir(path.dirname(stateFile),{recursive:true});await fs.writeFile(stateFile,JSON.stringify({clientId:id,orderId:order.id,name,email}));console.log('Fixture temporária criada sem gerar usuários ou enviar e-mails.');
}else if(process.argv.includes('--cleanup')){
 const state=JSON.parse(await fs.readFile(stateFile,'utf8'));const client=await api('/admin/clientes/'+state.clientId);assert.equal(client.name,name);assert.equal(client.email,email);await api('/admin/clientes/'+state.clientId,'DELETE',{confirmation:'EXCLUIR'});await fs.unlink(stateFile);console.log('Fixture e seus dados vinculados removidos.');
}else throw new Error('Use --create ou --cleanup.');
await api('/auth/logout','POST');

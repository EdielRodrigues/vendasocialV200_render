const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const app=express(),PORT=process.env.PORT||3000;
const DATA_FILE=process.env.DATA_FILE||path.join(__dirname,'data.json');
const origins=process.env.ALLOWED_ORIGIN?process.env.ALLOWED_ORIGIN.split(',').map(s=>s.trim()):true;
app.use(cors({origin:origins}));app.use(express.json({limit:'1mb'}));
const empty={products:[],campaigns:[],leads:[],sales:[],settings:{minRoas:2,minSpend:50,noConversionSpend:30}};
function read(){try{if(fs.existsSync(DATA_FILE))return {...empty,...JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}}catch(e){console.error('Erro ao ler dados:',e.message)}return JSON.parse(JSON.stringify(empty))}
let db=read();
function save(){fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});const tmp=DATA_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DATA_FILE)}
function str(v,n=180){return String(v??'').trim().slice(0,n)}
function n(v){let x=Number(v);return Number.isFinite(x)&&x>=0?x:0}
function fmt(v){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v)}
function recom(){const s=db.settings||empty.settings,out=[];for(const c of db.campaigns){let spend=n(c.spend),rev=n(c.revenue),conv=n(c.conversions),roas=spend?rev/spend:0;if(spend>=n(s.noConversionSpend)&&conv===0)out.push({priority:'ATENÇÃO',title:c.name+': gasto sem conversões',message:`Investimento de ${fmt(spend)} e nenhuma conversão registrada. Confira rastreamento, público, oferta e página antes de ampliar o gasto.`});if(spend>=n(s.minSpend)&&roas<n(s.minRoas))out.push({priority:'OTIMIZAÇÃO',title:c.name+': ROAS abaixo da meta',message:`ROAS de ${roas.toFixed(2)}x, abaixo da meta de ${n(s.minRoas).toFixed(2)}x. Compare criativos, custo por conversão e margem.`});if(conv>0&&n(c.clicks)>0&&conv/n(c.clicks)>.15)out.push({priority:'DESTAQUE',title:c.name+': taxa de conversão alta',message:`Taxa registrada de ${(conv/n(c.clicks)*100).toFixed(1)}%. Identifique o que funciona antes de escalar.`})}if(!db.campaigns.length)out.push({priority:'COMECE AQUI',title:'Cadastre sua primeira campanha',message:'Informe investimento, receita, cliques e conversões para receber recomendações.'});return out.slice(0,15)}
app.get('/health',(req,res)=>res.json({online:true,service:'VendaSocial API',version:'11.0.0',timestamp:new Date().toISOString()}));

// Proteção obrigatória dos dados. Configure ADMIN_API_KEY no Render.
const ADMIN_API_KEY=process.env.ADMIN_API_KEY||'';
app.use('/api',(req,res,next)=>{
 if(!ADMIN_API_KEY)return res.status(503).json({error:'Configure ADMIN_API_KEY no Render antes de acessar dados.'});
 const supplied=req.get('X-Admin-Key')||'';
 const x=Buffer.from(supplied),y=Buffer.from(ADMIN_API_KEY);
 if(x.length!==y.length||!crypto.timingSafeEqual(x,y))return res.status(401).json({error:'Chave de acesso inválida. Informe a chave em Conexões.'});
 next();
});
const providerSettings={
 meta:{name:'Facebook e Instagram',required:['META_APP_ID','META_APP_SECRET','META_ACCESS_TOKEN','META_AD_ACCOUNT_ID']},
 tiktok:{name:'TikTok Ads',required:['TIKTOK_APP_ID','TIKTOK_APP_SECRET','TIKTOK_ACCESS_TOKEN','TIKTOK_ADVERTISER_ID']}
};
function providerState(k){const p=providerSettings[k];return {provider:k,name:p.name,configured:p.required.every(v=>!!process.env[v]),missing:p.required.filter(v=>!process.env[v]),connected:false,syncEnabled:false,mode:'Aguardando autorização OAuth e integração oficial',lastSync:null}}
app.get('/api/integrations',(req,res)=>res.json(Object.keys(providerSettings).map(providerState)));
app.get('/api/integrations/:provider',(req,res)=>{if(!providerSettings[req.params.provider])return res.status(404).json({error:'Plataforma não suportada'});res.json(providerState(req.params.provider))});
app.post('/api/integrations/:provider/sync',(req,res)=>{if(!providerSettings[req.params.provider])return res.status(404).json({error:'Plataforma não suportada'});res.status(501).json({error:'Sincronização real ainda não ativada. É necessário implementar OAuth, permissões e chamadas oficiais da plataforma. Nenhum dado foi sincronizado.'})});
// Acesso de redes sociais: não simular OAuth ou publicação sem credenciais e permissões.
app.post('/api/social/connect/:provider',(req,res)=>{
 const p=req.params.provider;
 if(!['facebook','instagram','tiktok'].includes(p))return res.status(404).json({error:'Rede não suportada'});
 res.status(409).json({error:'Conexão oficial ainda não configurada. É necessário cadastrar o aplicativo, callback OAuth e permissões de publicação no Meta for Developers ou TikTok for Developers. Nenhuma conta foi conectada.'});
});
app.get('/api/social/status',(req,res)=>res.json({facebook:{connected:false},instagram:{connected:false},tiktok:{connected:false}}));
app.post('/api/social/publish',(req,res)=>{
 const product=db.products.find(p=>p.id===req.body?.productId);
 if(!product)return res.status(404).json({error:'Produto não encontrado'});
 if(!product.buyUrl)return res.status(400).json({error:'Produto sem link de compra'});
 res.status(409).json({error:'Publicação não enviada: conecte e autorize uma conta oficial primeiro. Use Compartilhar enquanto a integração é configurada.'});
});
app.get('/api/export',(req,res)=>res.json({version:10,exportedAt:new Date().toISOString(),data:db}));

app.get('/api/dashboard',(req,res)=>{let spend=db.campaigns.reduce((a,c)=>a+n(c.spend),0),campaignRev=db.campaigns.reduce((a,c)=>a+n(c.revenue),0),salesRev=db.sales.reduce((a,s)=>a+n(s.amount),0);res.json({dashboard:{totalSales:db.sales.length,revenue:salesRev,attributedRevenue:campaignRev,adSpend:spend,roas:spend?campaignRev/spend:0,recommendations:recom(),weeklySales:Array.from({length:7},(_,i)=>{const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-(6-i));return db.sales.filter(s=>{const dt=new Date(s.createdAt);return dt>=day&&dt<new Date(day.getTime()+86400000)}).reduce((v,s)=>v+n(s.amount),0)})}})});
function validate(type,b){let o={id:crypto.randomUUID(),createdAt:new Date().toISOString()};if(type==='products'){o.name=str(b.name);o.price=n(b.price);o.stock=n(b.stock);o.buyUrl=str(b.buyUrl,2048);if(o.buyUrl){try{const u=new URL(o.buyUrl);if(!['https:','http:'].includes(u.protocol))throw Error()}catch{throw Error('Link de compra inválido: use https://')}}if(!o.name)throw Error('Informe o nome do produto')}if(type==='campaigns'){o.name=str(b.name);o.channel=str(b.channel,50)||'Outro';o.status=str(b.status,40)||'Rascunho';o.spend=n(b.spend);o.revenue=n(b.revenue);o.clicks=n(b.clicks);o.conversions=n(b.conversions);if(!o.name)throw Error('Informe o nome da campanha')}if(type==='leads'){o.name=str(b.name);o.contact=str(b.contact);o.source=str(b.source,100);o.status=str(b.status,50)||'Novo';if(!o.name)throw Error('Informe o nome do lead')}if(type==='sales'){o.product=str(b.product);o.amount=n(b.amount);o.customer=str(b.customer);o.status=str(b.status,50)||'Registrada';if(!o.product)throw Error('Informe o produto')}return o}
for(const type of ['products','campaigns','leads','sales']){
 app.get('/api/'+type,(req,res)=>res.json(db[type].map(c=>type==='campaigns'?{...c,roas:n(c.spend)?n(c.revenue)/n(c.spend):0}:c)));
 app.post('/api/'+type,(req,res)=>{try{const o=validate(type,req.body||{});db[type].push(o);try{save()}catch(e){db[type].pop();throw Error('Não foi possível persistir os dados. Confira DATA_FILE e permissões.')}res.status(201).json(o)}catch(e){res.status(400).json({error:e.message||'Dados inválidos'})}});
 app.delete('/api/'+type+'/:id',(req,res)=>{let i=db[type].findIndex(o=>o.id===req.params.id);if(i<0)return res.status(404).json({error:'Registro não encontrado'});let old=db[type].splice(i,1)[0];try{save();res.json({ok:true})}catch(e){db[type].splice(i,0,old);res.status(500).json({error:'Não foi possível persistir a exclusão'})}});
}
for(const type of ['products','leads','sales']){
 app.put('/api/'+type+'/:id',(req,res)=>{let i=db[type].findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'Registro não encontrado'});try{let old=db[type][i];let updated=validate(type,{...old,...req.body});updated.id=old.id;updated.createdAt=old.createdAt;db[type][i]=updated;try{save()}catch(e){db[type][i]=old;throw e}res.json(updated)}catch(e){res.status(400).json({error:e.message})}});
}
app.put('/api/campaigns/:id',(req,res)=>{let i=db.campaigns.findIndex(c=>c.id===req.params.id);if(i<0)return res.status(404).json({error:'Campanha não encontrada'});try{let old=db.campaigns[i],b=req.body||{};let updated={...old,name:str(b.name??old.name),channel:str(b.channel??old.channel,50),status:str(b.status??old.status,40),spend:n(b.spend??old.spend),revenue:n(b.revenue??old.revenue),clicks:n(b.clicks??old.clicks),conversions:n(b.conversions??old.conversions)};if(!updated.name)throw Error('Informe o nome da campanha');db.campaigns[i]=updated;try{save()}catch(e){db.campaigns[i]=old;throw Error('Não foi possível salvar a campanha')}res.json({...updated,roas:updated.spend?updated.revenue/updated.spend:0})}catch(e){res.status(400).json({error:e.message||'Dados inválidos'})}});
app.get('/api/settings',(req,res)=>res.json(db.settings||empty.settings));
app.put('/api/settings',(req,res)=>{let b=req.body||{};const old=db.settings;db.settings={minRoas:n(b.minRoas),minSpend:n(b.minSpend),noConversionSpend:n(b.noConversionSpend)};try{save();res.json(db.settings)}catch(e){db.settings=old;res.status(500).json({error:'Não foi possível salvar as regras'})}});
app.use((err,req,res,next)=>{console.error(err);res.status(400).json({error:'Requisição inválida'})});
app.listen(PORT,()=>console.log(`VendaSocial API V10 rodando na porta ${PORT}`));

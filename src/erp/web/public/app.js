'use strict';
const $ = id => document.getElementById(id);
const operations = { product:'新增商品',supplier:'新增供应商',customer:'新增客户',warehouse:'新增仓库',product_details:'完善商品资料',pack_unit:'定义包装单位',purchase_receipt:'采购入库',sales_order:'新建销售订单',change_sales_order:'修改销售订单',cancel_sales_order:'取消销售订单',delivery:'确认交货',delivery_and_receipt:'交货并收款',settlement:'收款 / 付款',allocated_settlement:'指定核销分配',reversal:'关联冲销',return:'原单退货',quarantine_return:'隔离接收退货',resolve_quarantine:'处置隔离退货',return_refund:'确认退款',stocktake:'记录盘点',resolve_stocktake:'处理盘点差异',transfer:'仓库调拨',loss:'报损',followup_decision:'处理待办' };
const labels = { name:'名称',stockUnit:'库存单位',productId:'商品',supplierId:'供应商',customerId:'客户',warehouseId:'仓库',destinationId:'目标仓库',partyId:'往来方',originId:'原始单据',orderId:'销售订单',stocktakeId:'盘点单',quarantineId:'隔离单',obligationId:'应收 / 应付单',id:'编号',expectedRevision:'当前修订号',expectedVersion:'当前版本',unit:'单位',quantity:'数量',amountCents:'金额（分）',dueDate:'到期日期',lines:'商品明细',packVersion:'包装版本',earliestProductionDate:'最早生产日期',aliases:'别名',specification:'规格',barcode:'条码',shelfLifeDays:'保质期天数',stockUnits:'换算库存单位',numerator:'分子',denominator:'分母',orderLineIndex:'原订单行号（从 0 开始）',lineIndex:'原单行号（从 0 开始）',kind:'类别',condition:'商品状态',reason:'原因',status:'状态',until:'下次提醒时间（含时区）',physicalQuantity:'实盘数量',outcome:'处理方式',openingUnitCostCents:'盘盈单位成本（分）',sourceId:'补录来源单据',allocations:'核销分配',excessCents:'余款（分）',excessKind:'余款类别',delivery:'交货明细',products:'商品资料',warehouses:'仓库',customers:'客户',suppliers:'供应商',stock:'库存',purchases:'采购单',orders:'销售订单',deliveries:'交货单',payables:'应付',receivables:'应收',settlements:'收付款',returns:'退货单',quarantines:'隔离库存',refunds:'退款',stocktakes:'盘点',inventory:'库存操作',followups:'待办',expiry:'保质期管理估计',audit:'业务审计',security:'安全审计',projection:'预计单据',changes:'影响范围',before:'变更前',after:'变更后',validationFindings:'校验结果',valueCents:'库存价值（分）',costCents:'成本（分）',totalCents:'总额（分）',openCents:'未结金额（分）',grossProfitCents:'经营毛利（分）',currency:'币种',postedAt:'过账时间',actorId:'操作员',channel:'渠道',confirmationId:'确认编号',operationId:'操作编号',action:'动作',recordId:'记录编号',recordedAt:'记录时间',revision:'修订号',stockQuantity:'库存单位数量',conversion:'单位换算',managedExpiryDate:'管理估计到期日',expiryBasis:'日期依据',provisional:'资料待完善',packs:'包装版本',document:'单据',version:'版本',summary:'影响摘要',result:'处理结果' };
const words = { customer_receipt:'客户收款',supplier_payment:'供应商付款',customer_advance:'客户预收',supplier_prepayment:'供应商预付',sale:'销售',purchase:'采购',settlement:'结算',saleable:'可售',damaged:'破损',unknown:'待确定',linked_return:'关联原单',return_to_sender:'退回送货方',confirmed_loss:'确认损失',adjustment:'差异调整',restored_source:'补录来源交易',resolved:'已处理',deferred:'延后',ignored:'忽略',pending:'待确认',posted:'已过账',cancelled:'已取消',invalidated:'已失效',open:'未完成',operational_estimate:'管理估计值' };
Object.assign(labels, operations, { evidence:'关联证据', detail:'待办详情', missingFields:'缺失资料', responsibleOperator:'负责人', createdAt:'创建时间', updatedAt:'更新时间', remindAt:'提醒时间', sourceActive:'来源仍待处理', counterparties:'往来方', quarantine:'隔离库存', at:'时间', user:'操作员', draftVersion:'草稿版本', conversationId:'工作区', receiptId:'采购单', deliveryId:'交货单', lossCents:'损失（分）', ledgerQuantity:'账面数量', ledgerValueCents:'账面价值（分）', difference:'盘点差异', orderRevision:'订单版本' });
Object.assign(words, operations, { incomplete_product:'商品资料待完善', missing_purchase_order:'待补采购订单', web:'网页', enroll_credential:'注册凭据', sign_in:'登录', begin_recovery:'开始账户恢复', recover_credential:'替换恢复凭据', reauthenticate:'重新验证', revoke_sessions:'撤销会话' });
let schemas = {}, overview = {}, version = 0, readForm, pendingRequest, busy = false;
const node = (tag, text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); return e; };
function message(text) { $('notice').textContent = text; }
async function api(path, data) {
  if (!navigator.onLine) throw new Error('当前离线，请恢复网络后重试。业务数据不会离线提交。');
  const response = await fetch('/api' + path, { credentials:'same-origin', cache:'no-store', ...(data === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }) });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.reason || value.message || value.error); error.status = response.status; throw error; }
  return value;
}
async function run(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { message(e.message); if (e.status === 401) locked(); } finally { busy = false; } }
function locked() { clearSecrets(); $('workspace').hidden = true; $('login').hidden = false; $('identity').textContent = '请使用通行密钥登录'; overview = {}; $('recordList').replaceChildren(); $('impact').replaceChildren(); $('credentials').replaceChildren(); $('fields').replaceChildren(); pendingRequest = undefined; $('retry').hidden = true; }
function secrets(result) { const value = result.recoveryCodes || result.grant; if (value) { $('secretText').textContent = Array.isArray(value) ? value.join('\n') : value; $('secrets').hidden = false; } }
function clearSecrets() { $('secretText').textContent = ''; $('secrets').hidden = true; }
async function authenticate(mode) {
  const options = await api('/auth/' + mode + '/options', {});
  const credential = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON:options });
  await api('/auth/' + mode + '/verify', { credential }); await refresh(); message('Passkey 验证成功。');
}
async function register(grant) {
  const options = await api('/auth/register/options', grant ? { grant } : {});
  const credential = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON:options });
  const result = await api('/auth/register/verify', { credential }); secrets(result); await refresh(); message('注册完成。请保存恢复码并添加备用凭据。');
}
function renderValue(value, expand = false) {
  if (value === null || value === undefined) return node('span','—');
  if (typeof value !== 'object') return node('span', words[value] || labels[value] || (typeof value === 'boolean' ? (value ? '是':'否') : value));
  if (value.numerator !== undefined && value.denominator !== undefined) return node('span', value.denominator === '1' ? value.numerator : value.numerator + ' / ' + value.denominator);
  if (Array.isArray(value)) { const div = node('div'); if (!value.length) return node('span','无'); value.forEach((item,i) => { const d = node('details'), title = item?.name || (item?.action ? (words[item.action] || item.action) + ' · ' + (item.recordedAt || item.at || '') : item?.id) || `第 ${i+1} 项`; d.open=expand; d.append(node('summary',title), renderValue(item,expand)); div.append(d); }); return div; }
  const list = node('dl'); list.className='record';
  for (const [key,v] of Object.entries(value)) {
    const dt=node('dt',labels[key] || key), dd=node('dd');
    // Omit empty impact categories; all actual before/after changes remain visible.
    const shown=key==='changes' ? Object.fromEntries(Object.entries(v).filter(([,x])=>x.before.length || x.after.length)) : v;
    dd.append(renderValue(shown,expand));list.append(dt,dd);
  }
  return list;
}
function references(key) {
  const sources = { productId:['products'],supplierId:['suppliers'],customerId:['customers'],warehouseId:['warehouses'],destinationId:['warehouses'],partyId:['customers','suppliers'],orderId:['orders'],stocktakeId:['stocktakes'],quarantineId:['quarantines'],originId:['purchases','deliveries','settlements'],sourceId:['purchases','deliveries','returns'],id:['followups'],obligationId:['payables','receivables'] };
  return (sources[key] || []).flatMap(k => overview[k] || []);
}
function field(schema, key, parent, optional = false) {
  const box = node('fieldset'), legend = node('legend',labels[key] || key); box.append(legend); parent.append(box);
  let enabled;
  const target = node('div');
  if (optional) { const l = node('label','填写此可选项'); l.className='optional'; enabled = node('input'); enabled.type='checkbox'; l.prepend(enabled); box.append(l); target.hidden=true; enabled.onchange=() => {target.hidden=!enabled.checked;}; }
  box.append(target);
  let read;
  if (schema.anyOf) {
    const choices = schema.anyOf, select = node('select'); select.setAttribute('aria-label',labels[key] || key); target.append(select);
    choices.forEach((choice,i) => { const v = choice.const ?? choice.properties?.kind?.const ?? (choice.type === 'null' ? '不设置' : '填写'); const o=node('option',words[v] || v); o.value=i; select.append(o); });
    const child=node('div'); target.append(child); let get;
    const update=() => { child.replaceChildren(); const choice=choices[Number(select.value)]; get='const' in choice ? ()=>choice.const : field(choice,key,child); };
    select.onchange=update; update(); read=() => get();
  } else if ('const' in schema) { target.append(node('span',words[schema.const] || schema.const)); read=() => schema.const;
  } else if (schema.type === 'null') { read=() => null;
  } else if (schema.type === 'object') {
    const getters=Object.entries(schema.properties).map(([k,s]) => [k,field(s,k,target,!(schema.required || []).includes(k))]);
    read=() => Object.fromEntries(getters.map(([k,get]) => [k,get()]).filter(([,v]) => v !== undefined));
  } else if (schema.type === 'array') {
    const items=node('div'), add=node('button','添加一项'); add.type='button'; target.append(items,add); const rows=[];
    const insert=() => { if(rows.length >= (schema.maxItems || 500)) return; const row=node('div'); row.className='item'; const get=field(schema.items,key,row); const del=node('button','移除此项'); del.type='button'; row.append(del); const entry={row,get}; rows.push(entry); items.append(row); del.onclick=()=>{ if(rows.length > (schema.minItems || 0)) { rows.splice(rows.indexOf(entry),1); row.remove(); } }; };
    add.onclick=insert; for(let i=0;i<(schema.minItems || 0);i++)insert(); read=()=>rows.map(x=>x.get());
  } else {
    const refs=references(key), input=node(refs.length ? 'select' : 'input');
    input.setAttribute('aria-label', labels[key] || key);
    if (refs.length) { input.append(node('option','请选择')); input.firstChild.value=''; refs.forEach(r=>{const id=r.id || r.receiptId || r.deliveryId; const option=node('option',(r.name || r.kind || '') + ' · ' + id);option.value=id;input.append(option);}); }
    else { input.type=schema.type==='integer'?'number':'text'; if(schema.minimum!==undefined)input.min=schema.minimum;if(schema.maximum!==undefined)input.max=schema.maximum;if(schema.maxLength)input.maxLength=schema.maxLength; if(schema.type==='integer') input.step=1; }
    target.append(input); read=()=>{if(input.value==='')throw new Error('请填写：'+(labels[key]||key)); return schema.type==='integer'?Number(input.value):input.value;};
  }
  return ()=>optional && !enabled.checked ? undefined : read();
}
function renderForm() { $('fields').replaceChildren(); readForm=field(schemas[$('operation').value],$('operation').value,$('fields')); }
function renderDraft(draft) {
  version=draft?.version || 0; $('draftStatus').textContent=draft ? `第 ${version} 版 · ${words[draft.status] || draft.status}` : '暂无草稿';
  $('impact').replaceChildren(...(draft ? [renderValue(draft.summary,true)] : []));
  $('confirm').disabled=draft?.status!=='pending'; $('cancel').disabled=draft?.status!=='pending';
}
async function refresh() {
  const me=await api('/me'); $('identity').textContent=me.user.name; $('login').hidden=true; $('workspace').hidden=false;
  [schemas,overview]=await Promise.all([api('/forms'),api('/overview')]);
  if (!$('operation').options.length) { for(const key of Object.keys(schemas)){const option=node('option',operations[key]||key);option.value=key;$('operation').append(option);} }
  renderForm(); renderDraft(await api('/draft'));
  if (!$('recordKind').options.length) { for(const key of Object.keys(overview)){const option=node('option',labels[key]||key);option.value=key;$('recordKind').append(option);} }
  showRecords(); $('credentials').replaceChildren();
  for (const credential of me.credentials) { const row=node('div'), button=node('button','撤销并退出所有设备'); row.append(node('p',credential.id),button); button.onclick=()=>run(async()=>{await api('/admin/remove-credential',{id:credential.id});locked();message('凭据已撤销，请重新登录。');});$('credentials').append(row); }
}
function showRecords() { $('recordList').replaceChildren(renderValue(overview[$('recordKind').value])); }
async function sendDraft(action) {
  if (!pendingRequest) pendingRequest={eventId:crypto.randomUUID(),action};
  $('retry').hidden=true; $('confirm').disabled=true; $('cancel').disabled=true;
  try {
    const reply=await api('/draft',pendingRequest); pendingRequest=undefined;
    if(reply.status==='draft'){renderDraft(reply.draft);message('请逐项核对影响范围，再确认过账。');}
    else { await refresh(); message(reply.status==='posted'?'已过账。':'草稿已取消。'); }
  } catch(e) {
    if(e.status && e.status !== 503) { pendingRequest=undefined; if(e.status!==401) renderDraft(await api('/draft')); }
    else $('retry').hidden=false;
    throw e;
  }
}
$('businessForm').onsubmit=e=>{e.preventDefault();run(async()=>{if(pendingRequest)throw new Error('请先重试上一次请求，确定提交结果。');await sendDraft({action:'propose',expectedVersion:version,command:{kind:$('operation').value,input:readForm()}});});};
$('confirm').onclick=()=>run(()=>sendDraft({action:'confirm',expectedVersion:version}));$('cancel').onclick=()=>run(()=>sendDraft({action:'cancel',expectedVersion:version}));$('retry').onclick=()=>run(()=>sendDraft());
$('signin').onclick=()=>run(()=>authenticate('login'));$('reauth').onclick=()=>run(()=>authenticate('reauth'));
$('enroll').onclick=()=>run(async()=>{const value=$('grant').value;$('grant').value='';if(!value)throw new Error('请输入一次性注册凭证');await register(value);});
$('recover').onclick=()=>run(async()=>{const code=$('recovery').value;$('recovery').value='';const result=await api('/auth/recover',{code});$('grant').value=result.grant;message('恢复码已消费。若注册取消，可用首次启用区域继续注册。');await register(result.grant);$('grant').value='';});
$('backup').onclick=()=>run(()=>register());$('codes').onclick=()=>run(async()=>secrets(await api('/admin/recovery-codes',{})));
$('invite').onclick=()=>run(async()=>secrets(await api('/admin/invite',{name:$('operatorName').value})));
$('revoke').onclick=()=>run(async()=>{await api('/admin/revoke-sessions',{});clearSecrets();locked();message('已退出所有设备。');});
$('logout').onclick=()=>run(async()=>{await api('/logout',{});clearSecrets();locked();message('已退出。');});
$('refresh').onclick=()=>run(async()=>{if(pendingRequest)throw new Error('请先重试上一次请求');await refresh();message('已刷新。');});
$('hideSecrets').onclick=clearSecrets;$('operation').onchange=renderForm;$('recordKind').onchange=showRecords;
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{for(const id of ['operate','records','security'])$(id).hidden=id!==button.dataset.tab;});
window.addEventListener('offline',()=>message('当前离线。停止提交业务，联网后可重试。'));
window.addEventListener('pagehide',clearSecrets);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
run(async()=>{try{await refresh();message('欢迎回来。');}catch(e){locked();if(e.status!==401)throw e;}});

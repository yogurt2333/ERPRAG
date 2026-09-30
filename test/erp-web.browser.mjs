// Optional real-browser acceptance: PLAYWRIGHT_MODULE may point to an installed playwright ESM entry.
// Requires Chromium and openssl; only synthetic data and an ephemeral self-signed localhost certificate.
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createErpWeb } from '../src/erp/web/server.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = mkdtempSync(join(tmpdir(), 'erp-browser-'));
let app, browser, tls;
try {
  execFileSync(process.env.OPENSSL || 'openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),
    '-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], { stdio:'ignore' });
  tls = createServer({ key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem')) }, (req,res)=>app.server.emit('request',req,res));
  tls.listen(0,'127.0.0.1'); await once(tls,'listening');
  const origin=`https://localhost:${tls.address().port}`;
  app=createErpWeb(join(dir,'db.sqlite'),origin);
  const originalDirectory=process.cwd();
  try {
    // Chromium on Windows may write debug.log in its inherited working directory.
    process.chdir(dir);
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  } finally { process.chdir(originalDirectory); }
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}}), page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.goto(origin);await page.locator('#login').waitFor({state:'visible'});
  await page.getByText('首次启用 / 接受邀请',{exact:true}).click();
  await page.locator('#grant').fill(app.auth.bootstrap('浏览器测试员'));await page.locator('#enroll').click();
  await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('注册完成'));
  assert.equal(await page.locator('#secretText').textContent().then(x=>x.split('\n').length),8);
  await page.locator('#hideSecrets').click();
  async function operate(kind, values) {
    await page.locator('#operation').selectOption(kind);
    for(const [label,value] of Object.entries(values)) {
      const input=page.locator('#fields').getByLabel(label,{exact:true});
      if(await input.evaluate(e=>e.tagName)==='SELECT') await input.selectOption(value); else await input.fill(value);
    }
    await page.getByRole('button',{name:'生成影响预览',exact:true}).click();
    await page.waitForFunction(()=>!document.getElementById('confirm').disabled);
    await page.locator('#confirm').click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent==='已过账。');
  }
  await operate('product',{'名称':'测试饮料','库存单位':'瓶'});
  await operate('supplier',{'名称':'测试供货方'});await operate('customer',{'名称':'测试客户'});await operate('warehouse',{'名称':'测试主仓'});
  const p=app.erp.listMasters('product')[0].id,s=app.erp.listMasters('supplier')[0].id,w=app.erp.listMasters('warehouse')[0].id,c=app.erp.listMasters('customer')[0].id;
  await operate('purchase_receipt',{'供应商':s,'仓库':w,'商品':p,'单位':'瓶','数量':'10','金额（分）':'1000'});
  await operate('sales_order',{'客户':c,'仓库':w,'商品':p,'单位':'瓶','数量':'2','金额（分）':'400'});
  const order=app.erp.listSalesOrders()[0].id;
  await operate('delivery',{'销售订单':order,'当前修订号':'1','原订单行号（从 0 开始）':'0','数量':'2','金额（分）':'400'});
  await operate('settlement',{'往来方':c,'金额（分）':'400'});
  const delivery=app.erp.listDeliveries()[0].id;
  await operate('return',{'原始单据':delivery,'原单行号（从 0 开始）':'0','分子':'1','分母':'1','原因':'客户退回一瓶'});
  await operate('loss',{'商品':p,'仓库':w,'分子':'1','分母':'1','原因':'破损'});
  await operate('followup_decision',{'编号':app.erp.listFollowups().find(f=>f.status==='open').id,'原因':'已核对记录'});
  assert.equal(app.erp.getStock(p,w).quantity.numerator,'8');
  await page.locator('[data-tab="records"]').click();await page.locator('#recordKind').selectOption('audit');
  mkdirSync(resolve('artifacts'),{recursive:true});await page.screenshot({path:resolve('artifacts/erp-web-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('[data-tab="operate"]').click();
  await page.screenshot({path:resolve('artifacts/erp-web-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page must not overflow');
  await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});
  await page.locator('#signin').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('notice').textContent==='Passkey 验证成功。');
  await context.setOffline(true);await page.locator('#refresh').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('离线'));
  assert.deepEqual(errors,[]);console.log('Browser acceptance passed: virtual Passkey enrollment/login; draft workflows for product, purchase, sale, settlement, return, loss, follow-up; mobile layout; offline refusal.');
} finally {
  await browser?.close();tls?.closeAllConnections();tls?.close();app?.close();rmSync(dir,{recursive:true,force:true});
}

'use strict';
const API_BASE = 'https://padma.cosmonika.com';
const AUTH_URL = API_BASE + '/auth.php';

const API = {
  base: API_BASE + '/api.php',
  token: null,
  loadToken(){ try{ this.token = localStorage.getItem('padma_token') || null; }catch(e){ this.token=null; } },
  saveToken(t){ this.token=t; try{ localStorage.setItem('padma_token', t); }catch(e){} },
  clearToken(){ this.token=null; try{ localStorage.removeItem('padma_token'); }catch(e){} },

  async call(endpoint, data, opts){
    opts = opts || {};
    const url = this.base + '?endpoint=' + encodeURIComponent(endpoint);
    const headers = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    let body;
    if (opts.form && data instanceof FormData) body = data;
    else if (opts.method === 'GET') body = null;
    else { headers['Content-Type']='application/json'; body = JSON.stringify(data||{}); }

    let res;
    try { res = await fetch(url, { method: opts.method||'POST', headers, body, credentials:'omit' }); }
    catch(e){ throw new Error('Network error — check your connection'); }

    if (res.status === 401) { this.clearToken(); Auth.showOverlay(); throw new Error('Session expired. Please log in again.'); }
    let json; try { json = await res.json(); } catch(e){ throw new Error('Invalid server response'); }
    if (!json || json.ok !== true) throw new Error((json && json.message) || 'Request failed');
    return json.data;
  },

  bootstrap(){ return this.call('bootstrap', {}); },
  crud(entity, op, id, data){ return this.call('crud', {entity, op, id, data: data||{}}); },
  saveSale(sale){ return this.call('sale.create', {sale}); },
  cancelSale(id){ return this.call('sale.cancel', {id}); },
  savePurchase(purchase){ return this.call('purchase.create', {purchase}); },
  purchasePayment(id, amount, method, reference){ return this.call('purchase.payment', {id, amount, method, reference}); },
  attendanceBulk(records){ return this.call('attendance.bulk', {records}); },
  payrollGenerate(month, year, recoverAdvances){ return this.call('payroll.generate', {month, year, recoverAdvances: recoverAdvances||[]}); },
  payrollPay(id){ return this.call('payroll.pay', {id}); },
  updateSettings(shop, settings){ return this.call('settings.update', {shop: shop||{}, settings: settings||{}}); },
  upload(file, purpose){ const fd = new FormData(); fd.append('file', file); fd.append('purpose', purpose||'logo'); return this.call('upload', fd, {form:true}); },
  syncChanges(since){ return this.call('sync.changes', {since}); },
  exportAll(){ return this.call('export', {}); },
};

const Auth = {
  overlay: null,
  init(){
    this.overlay = document.getElementById('auth-overlay');
    const form = document.getElementById('auth-form');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); this.handleLogin(); });
    const reg = document.getElementById('auth-register-btn');
    if (reg) reg.addEventListener('click', () => this.openRegister());
    const f = document.getElementById('auth-forgot');
    if (f) f.addEventListener('click', e => { e.preventDefault(); this.handleForgot(); });
  },
  async handleLogin(){
    const sid = document.getElementById('auth-shopid').value.trim();
    const em  = document.getElementById('auth-email').value.trim();
    const pw  = document.getElementById('auth-pass').value;
    const err = document.getElementById('auth-err'); err.textContent = '';
    const btn = document.getElementById('auth-login-btn');
    if (!sid || !em || !pw){ err.textContent='Please fill all fields'; return; }
    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Signing in...';
    try {
      const r = await fetch(AUTH_URL + '?action=login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({shop_id:sid, email:em, password:pw}) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || 'Login failed');
      API.saveToken(j.data.token);
      document.getElementById('auth-shopid').value='';
      document.getElementById('auth-email').value='';
      document.getElementById('auth-pass').value='';
      await window.bootApp();
    } catch(e){ err.textContent = e.message; btn.disabled=false; btn.textContent=orig; }
  },
  async handleForgot(){
    const sid = prompt('Enter your Shop ID (e.g. PAD-100001):'); if (!sid) return;
    const em = prompt('Enter the registered email:'); if (!em) return;
    try {
      const r = await fetch(AUTH_URL + '?action=forgot', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({shop_id:sid.trim(), email:em.trim()}) });
      const j = await r.json();
      alert(j.ok ? j.data.message : (j.message || 'Request failed'));
    } catch(e){ alert('Network error'); }
  },
  async logout(){
    try { await fetch(AUTH_URL + '?action=logout', {method:'POST', headers:{'Authorization':'Bearer '+(API.token||'')}}); } catch(e){}
    API.clearToken();
    if (window.__padma_sync_timer){ clearInterval(window.__padma_sync_timer); window.__padma_sync_timer = null; }
    this.showOverlay();
    if (window.Store) Store.data = window.DEFAULTS ? window.DEFAULTS() : {};
    const c = document.getElementById('page-content'); if (c) c.innerHTML='';
    const n = document.getElementById('nav'); if (n) n.innerHTML='';
  },
  showOverlay(){ const el = document.getElementById('auth-overlay'); if (el) el.style.display='flex'; document.body.style.overflow='hidden'; },
  hideOverlay(){ const el = document.getElementById('auth-overlay'); if (el) el.style.display='none'; document.body.style.overflow=''; },

  openRegister(){
    const m = document.getElementById('reg-modal'); if (m) m.style.display='flex';
    this._resetReg(); this._bindReg();
  },
  closeRegister(){ const m = document.getElementById('reg-modal'); if (m) m.style.display='none'; },
  _resetReg(){
    document.getElementById('reg-step1').style.display='';
    document.getElementById('reg-step2').style.display='none';
    document.getElementById('reg-shopid').value='';
    document.getElementById('reg-pass1').value='';
    document.getElementById('reg-pass2').value='';
    document.getElementById('reg-err').textContent='';
    document.getElementById('reg-info').textContent='';
    document.querySelectorAll('.reg-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'have'));
    document.getElementById('reg-panel-have').style.display='';
    document.getElementById('reg-panel-buy').style.display='none';
  },
  _bindReg(){
    document.querySelectorAll('.reg-tab').forEach(t => {
      t.onclick = () => {
        document.querySelectorAll('.reg-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.getElementById('reg-panel-have').style.display = t.dataset.tab==='have'?'':'none';
        document.getElementById('reg-panel-buy').style.display  = t.dataset.tab==='buy'?'':'none';
      };
    });
    document.getElementById('reg-close').onclick = () => this.closeRegister();
    document.getElementById('reg-backdrop').onclick = () => this.closeRegister();
    document.getElementById('reg-continue').onclick = async () => {
      const sid = document.getElementById('reg-shopid').value.trim();
      const err = document.getElementById('reg-err'); err.textContent='';
      if (!sid){ err.textContent='Enter your Shop ID'; return; }
      try {
        const r = await fetch(AUTH_URL + '?action=check-shop', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({shop_id: sid})});
        const j = await r.json();
        if (!j.ok) throw new Error(j.message || 'Invalid Shop ID');
        if (j.data.has_password) { err.textContent = 'Password already set. Use login or Forgot password.'; return; }
        document.getElementById('reg-info').textContent = 'Shop: '+j.data.shop_name+' · Email: '+j.data.email_masked+' · Mobile: '+j.data.mobile_masked;
        document.getElementById('reg-step1').style.display='none';
        document.getElementById('reg-step2').style.display='';
        document.getElementById('reg-step2').dataset.shopId = sid;
        document.getElementById('reg-pass1').focus();
      } catch(e){ err.textContent = e.message; }
    };
    document.getElementById('reg-save').onclick = async () => {
      const s2 = document.getElementById('reg-step2'); const sid = s2.dataset.shopId;
      const p1 = document.getElementById('reg-pass1').value, p2 = document.getElementById('reg-pass2').value;
      const err = document.getElementById('reg-err'); err.textContent='';
      if (p1.length < 8){ err.textContent='Password must be at least 8 characters'; return; }
      if (p1 !== p2){ err.textContent='Passwords do not match'; return; }
      try {
        const r = await fetch(AUTH_URL + '?action=set-password', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({shop_id: sid, password:p1, password2:p2})});
        const j = await r.json();
        if (!j.ok) throw new Error(j.message || 'Failed');
        this.closeRegister();
        document.getElementById('auth-shopid').value = sid;
        document.getElementById('auth-pass').focus();
        alert('Password set. You can now log in.');
      } catch(e){ err.textContent = e.message; }
    };
  },
};

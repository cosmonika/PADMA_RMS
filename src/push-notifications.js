'use strict';

/**
 * PADMA RMS — Local Notifications (no Firebase, no server push)
 *
 * - Requests Android notification permission once on first launch
 * - Exposes window.PadmaNotify(title, body, data) for the app to call
 * - Listens for app-visible events (via polling of Store.data) and fires
 *   notifications for:
 *     • New sales (from sync)
 *     • Low stock items
 *     • Overdue tasks
 *
 * Runs ONLY inside the Android app (Capacitor native).
 * Does nothing on the web version.
 */

(function () {
  const isNative = window.Capacitor &&
                   window.Capacitor.isNativePlatform &&
                   window.Capacitor.isNativePlatform();
  if (!isNative) return;

  const LN = window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if (!LN) {
    console.warn('[notify] LocalNotifications plugin not available');
    return;
  }

  // ---- Permission ----
  async function ensurePermission() {
    try {
      const perm = await LN.checkPermissions();
      if (perm.display === 'granted') return true;
      const req = await LN.requestPermissions();
      return req.display === 'granted';
    } catch (e) {
      console.warn('[notify] permission check failed:', e.message);
      return false;
    }
  }

  // ---- Track which events we've already notified ----
  // Stored in localStorage so notifications don't repeat on every reload.
  function seen(key) {
    try {
      const raw = localStorage.getItem('padma_seen_' + key);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function markSeen(key, ids) {
    const m = {};
    ids.forEach(id => { m[id] = Date.now(); });
    // Keep only last 500 seen ids per bucket
    const arr = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 500);
    const trimmed = Object.fromEntries(arr);
    try { localStorage.setItem('padma_seen_' + key, JSON.stringify(trimmed)); } catch (e) {}
  }
  function isNew(key, id) {
    const s = seen(key);
    return !s[id];
  }

  // Convert a string to a stable positive 31-bit integer (Android notification id)
  function hashId(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    // Force into [1 .. 2^31-1] — Android rejects ids outside signed-int32
    return (h & 0x7fffffff) || 1;
  }

  // Small util (mirrors the one in index.html, safe to duplicate here)
  function money(n) {
    const num = Number(n || 0);
    const sym = (window.Store && Store.data && Store.data.shop && Store.data.shop.currencySymbol) || '₹';
    return sym + num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // ---- Notify one alert ----
  async function notify(id, title, body, data) {
    try {
      await LN.schedule({
        notifications: [{
          id: id,
          title: title,
          body: body,
          smallIcon: 'ic_stat_icon_config_sample',
          iconColor: '#6366f1',
          schedule: { at: new Date(Date.now() + 100) },
          extra: data || {},
          channelId: 'padma_default',
        }],
      });
    } catch (e) {
      console.warn('[notify] schedule failed:', e.message);
    }
  }

  // ---- Create Android channel (needed for Android 8+) ----
  async function ensureChannel() {
    try {
      await LN.createChannel({
        id: 'padma_default',
        name: 'PADMA Alerts',
        description: 'Sales, stock, and task notifications',
        importance: 4,       // HIGH
        visibility: 1,       // PUBLIC
        vibration: true,
        lights: true,
        lightColor: '#6366f1',
      });
    } catch (e) {
      // Channel already exists or older Android — not fatal
    }
  }

  // ---- Scan for new alerts ----
  function scanAndNotify() {
    if (!window.Store || !Store.data) return;
    const D = Store.data;

    // 1. New sales
    const seenSales = seen('sales');
    const newSales = (D.sales || []).filter(s => s.invoiceNo && !seenSales[s.id]);
    newSales.slice(0, 3).forEach(s => {
      notify(
        hashId('sale_' + s.id),
        'New Sale  ' + s.invoiceNo,
        (s.customerName || 'Walk-in') + '  ' + money(s.total),
        { route: 'sales', id: s.id }
      );
    });
    if (newSales.length) markSeen('sales', newSales.map(s => s.id));

    // 2. Low stock
    const seenLow = seen('lowstock');
    const lowItems = (D.products || []).filter(p =>
      p.status !== 'archived' &&
      Number(p.stock || 0) <= Number(p.minStock || 0) &&
      !seenLow[p.id]
    );
    lowItems.slice(0, 3).forEach(p => {
      notify(
        hashId('low_' + p.id),
        'Low Stock',
        p.name + '  ' + (p.stock || 0) + ' left',
        { route: 'inventory', id: p.id }
      );
    });
    if (lowItems.length) markSeen('lowstock', lowItems.map(p => p.id));

    // 3. Overdue tasks
    const today = new Date().toISOString().slice(0, 10);
    const seenTasks = seen('tasks');
    const overdue = (D.tasks || []).filter(t =>
      t.status !== 'Completed' &&
      t.status !== 'Cancelled' &&
      t.dueDate && t.dueDate < today &&
      !seenTasks[t.id]
    );
    overdue.slice(0, 3).forEach(t => {
      notify(
        hashId('task_' + t.id),
        'Task Overdue',
        t.title,
        { route: 'tasks', id: t.id }
      );
    });
    if (overdue.length) markSeen('tasks', overdue.map(t => t.id));
  }

  // ---- Handle taps ----
  LN.addListener('localNotificationActionPerformed', (ev) => {
    const data = (ev.notification && ev.notification.extra) || {};
    if (data.route && typeof window.navigate === 'function') {
      window.navigate(data.route);
    }
  });

  // ---- Boot ----
  async function boot() {
    const ok = await ensurePermission();
    if (!ok) {
      console.warn('[notify] notification permission denied by user');
      return;
    }
    await ensureChannel();

    // Expose a helper so other parts of the app can trigger notifications
    window.PadmaNotify = notify;

    // First scan after the app loads data
    setTimeout(scanAndNotify, 3000);

    // Re-scan every 30 seconds (matches the app's sync loop)
    setInterval(scanAndNotify, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

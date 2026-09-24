/* global chrome, tikTokFollowing */
const endpoint = 'http://127.0.0.1:4318/api/tiktok/bridge/';
const clientId = crypto.randomUUID();
const tokenInput = document.getElementById('token');
const agentStatus = document.getElementById('agent-status');
const connectButton = document.getElementById('connect');
const stopButton = document.getElementById('stop');
tokenInput.value = localStorage.getItem('hiwell-bridge-token') || '';
let enabled = false;
let polling = false;
let busy = false;
let commandId = null;
let tabId = null;
let pendingResult = null;
let token = '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(route, data) {
  const response = await fetch(endpoint + route, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'X-Hiwell-Extension': chrome.runtime.id,
    },
    body: JSON.stringify({ ...data, clientId }),
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || 'Yerel uygulamaya ulaşılamadı.');
  return value;
}
function ensure(id) {
  if (!enabled || commandId !== id)
    throw new Error('İş durduruldu veya bağlantı kesildi.');
}
async function navigate(url, id) {
  ensure(id);
  if (tabId === null) {
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
  } else {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https:\/\/(www\.)?tiktok\.com\//.test(tab.url || ''))
      throw new Error(
        'Agent sekmesi değiştirildi. Agent’ı durdurup yeniden bağlayın.',
      );
    await chrome.tabs.update(tabId, { url, active: true });
  }
  for (let n = 0; n < 60; n++) {
    ensure(id);
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      await wait(2500);
      ensure(id);
      return;
    }
    await wait(500);
  }
  throw new Error('TikTok sayfası yüklenemedi.');
}
// Self-contained: executed in TikTok's isolated content-script world.
function pageState(scroll) {
  const text = document.body.innerText;
  const restricted =
    /too many attempts|too many requests|maximum.*attempt|çok fazla (istek|deneme)/i.test(
      text,
    );
  const captcha = [
    ...document.querySelectorAll('[id*="captcha"], iframe[src*="captcha"]'),
  ].some((e) => e.getBoundingClientRect().height > 0);
  const blocked =
    restricted ||
    captcha ||
    /\/login|\/challenge/.test(location.pathname) ||
    /verify to continue|drag the slider|complete the puzzle|log in to search/i.test(
      text,
    );
  if (blocked)
    return {
      blocked,
      restricted,
      error: restricted
        ? 'TikTok istek kısıtı gösteriyor.'
        : 'TikTok giriş veya doğrulama istiyor. Normal Chrome’da kontrol edin.',
    };
  if (scroll) window.scrollTo(0, document.body.scrollHeight);
  const main =
    document.querySelector('main') || document.querySelector('[role="main"]');
  const users = [];
  // Search content only; avoid the signed-in user's navigation/profile links.
  for (const link of (
    main || document.querySelector('[data-e2e="search-user-container"]')
  )?.querySelectorAll('a[href]') || []) {
    try {
      const u = new URL(link.href);
      if (
        ['www.tiktok.com', 'tiktok.com'].includes(u.hostname) &&
        /^\/@[a-zA-Z0-9._]{2,24}\/?$/.test(u.pathname)
      )
        users.push(u.pathname.slice(2).replace(/\/$/, '').toLowerCase());
    } catch {}
  }
  return { users: [...new Set(users)].slice(0, 5000) };
}
async function state(scroll = false) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: pageState,
    args: [scroll],
  });
  return r.result;
}
async function execute(command) {
  const id = command.id;
  if (['following', 'following-next'].includes(command.kind)) {
    const expected =
      'https://www.tiktok.com/@' + encodeURIComponent(command.handle);
    if (command.kind === 'following') await navigate(expected, id);
    else {
      ensure(id);
      const tab = tabId !== null && (await chrome.tabs.get(tabId));
      if (!tab || new URL(tab.url).pathname !== '/@' + command.handle)
        throw new Error('Kaynak profil sekmesi değişti; tarama durduruldu.');
    }
    ensure(id);
    const guard = await state();
    if (guard.blocked) return guard;
    const [step] = await chrome.scripting.executeScript({
      target: { tabId },
      func: tikTokFollowing,
      args: [command.kind === 'following' ? 'open' : 'scroll'],
    });
    if (step.result.error) return { error: step.result.error };
    if (step.result.complete) return { result: step.result };
    await wait(2500);
    ensure(id);
    const nextGuard = await state();
    if (nextGuard.blocked) return nextGuard;
    let [list] = await chrome.scripting.executeScript({
      target: { tabId },
      func: tikTokFollowing,
      args: ['read'],
    });
    if (list.result.switched) {
      await wait(2000);
      ensure(id);
      [list] = await chrome.scripting.executeScript({
        target: { tabId },
        func: tikTokFollowing,
        args: ['read'],
      });
    }
    if (list.result.error) return { error: list.result.error };
    return { result: list.result };
  }
  if (!['search', 'search-next'].includes(command.kind))
    throw new Error(
      'Bu eklenti yalnızca kullanıcı listesi toplar. Uygulama ve eklentiyi birlikte güncelleyin.',
    );
  const url =
    'https://www.tiktok.com/search/user?q=' + encodeURIComponent(command.term);
  if (command.kind !== 'search-next') await navigate(url, id);
  else {
    ensure(id);
    const tab = tabId !== null && (await chrome.tabs.get(tabId));
    if (
      !tab ||
      !tab.url?.startsWith('https://www.tiktok.com/search/user') ||
      new URL(tab.url).searchParams.get('q') !== command.term
    )
      throw new Error('Arama sekmesi değişti; iş durduruldu.');
    const before = await state(true);
    if (before.blocked) return before;
    await wait(2500);
  }
  ensure(id);
  const result = await state();
  if (result.blocked) return result;
  return { result };
}
async function tick() {
  if (!enabled || polling) return;
  polling = true;
  try {
    if (pendingResult) {
      const completed = pendingResult;
      await api('result', completed);
      pendingResult = null;
      if (completed.blocked || completed.restricted) {
        enabled = false;
        commandId = null;
        connectButton.disabled = false;
        stopButton.disabled = true;
        agentStatus.textContent =
          completed.error +
          ' İş durduruldu. TikTok’u kontrol ettikten sonra yeniden bağlanın.';
        return;
      }
    }
    const { command } = await api('poll', {});
    if (!command) {
      commandId = null;
      if (!busy)
        agentStatus.textContent = 'Bağlı · Kuyruktan TikTok işi bekleniyor.';
      return;
    }
    if (pendingResult?.id === command.id) return;
    if (busy) {
      if (command.id !== commandId) commandId = null;
      return;
    }
    commandId = command.id;
    busy = true;
    agentStatus.textContent =
      command.kind === 'profile'
        ? '@' + command.handle + ' inceleniyor…'
        : 'TikTok araması: ' + command.term;
    void execute(command)
      .then((result) => {
        if (enabled && commandId === command.id)
          pendingResult = { ...result, id: command.id };
      })
      .catch((e) => {
        if (enabled && commandId === command.id)
          pendingResult = { id: command.id, error: e.message, blocked: true };
      })
      .finally(() => {
        busy = false;
      });
  } catch (e) {
    agentStatus.textContent =
      e.message + ' Bağlantıyı kontrol edip yeniden bağlanın.';
    enabled = false;
    commandId = null;
    connectButton.disabled = false;
    stopButton.disabled = true;
  } finally {
    polling = false;
  }
}
connectButton.addEventListener('click', async () => {
  if (busy || polling) return;
  token = tokenInput.value.trim();
  if (!token) {
    agentStatus.textContent = 'Eşleştirme anahtarını girin.';
    return;
  }
  localStorage.setItem('hiwell-bridge-token', token);
  pendingResult = null;
  enabled = true;
  connectButton.disabled = true;
  stopButton.disabled = false;
  await tick();
});
stopButton.addEventListener('click', async () => {
  enabled = false;
  commandId = null;
  pendingResult = null;
  try {
    await api('disconnect', {});
  } catch {}
  if (tabId !== null) {
    try {
      await chrome.tabs.remove(tabId);
    } catch {}
    tabId = null;
  }
  connectButton.disabled = false;
  stopButton.disabled = true;
  agentStatus.textContent =
    'Agent durduruldu. Kaydedilen sonuçlar Hiwell’de korunur.';
});
setInterval(() => {
  void tick();
}, 2000);

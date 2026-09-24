'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
type Account = {
  id: string;
  username: string;
  enabled: boolean;
  status: string;
  proxyServer?: string;
  proxyUsername?: string;
  proxyConfigured: boolean;
  dailyLimit?: number;
  scannedToday?: number;
  persona?: string;
};
type State = {
  accounts: Account[];
  activeId: string | null;
  autoSwitch: boolean;
  events: { at: string; username: string; message: string }[];
};
export function InstagramAccountsPanel() {
  const [state, setState] = useState<State>({
    accounts: [],
    activeId: null,
    autoSwitch: false,
    events: [],
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [id, setId] = useState('');
  const [proxyServer, setProxyServer] = useState('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');
  const [persona, setPersona] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [proxyTestMessage, setProxyTestMessage] = useState('');
  const [proxyTesting, setProxyTesting] = useState(false);
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [generatedImages, setGeneratedImages] = useState<
    Record<string, string>
  >({});
  const [generateError, setGenerateError] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const r = await fetch('/api/instagram/accounts');
        if (!r.ok) return;
        const s = (await r.json()) as State;
        if (live) setState(s);
      } catch {}
    };
    void read();
    const timer = setInterval(() => void read(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function save(input: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/instagram/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const s = (await r.json()) as State & { error?: string };
      if (!r.ok) throw new Error(s.error);
      setState(s);
      setPassword('');
      setId('');
      setUsername('');
      setProxyServer('');
      setProxyUsername('');
      setProxyPassword('');
      setDailyLimit('');
      setPersona('');
      setMessage('Kaydedildi.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generatePostFor(accountId: string) {
    setGenerating((g) => ({ ...g, [accountId]: true }));
    setGenerateError((g) => ({ ...g, [accountId]: '' }));
    try {
      const r = await fetch(
        `/api/instagram/accounts/${accountId}/generate-post`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const data = (await r.json()) as { image?: string; error?: string };
      if (!r.ok) throw new Error(data.error);
      setGeneratedImages((g) => ({ ...g, [accountId]: data.image || '' }));
    } catch (e) {
      setGenerateError((g) => ({ ...g, [accountId]: (e as Error).message }));
    } finally {
      setGenerating((g) => ({ ...g, [accountId]: false }));
    }
  }
  async function testProxy() {
    setProxyTesting(true);
    setProxyTestMessage('');
    try {
      const r = await fetch('/api/instagram/accounts/test-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: proxyServer,
          username: proxyUsername || undefined,
          password: proxyPassword || undefined,
        }),
      });
      const s = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) throw new Error(s.error);
      setProxyTestMessage('Proxy çalışıyor, Instagram’a ulaşıldı.');
    } catch (e) {
      setProxyTestMessage((e as Error).message);
    } finally {
      setProxyTesting(false);
    }
  }
  return (
    <section className="panel sender-panel">
      <h3>Instagram oturum hesapları</h3>
      <p>
        Şifreler ana Mac’te şifrelenerek saklanır; her hesap ayrı tarayıcı
        oturumu kullanır. İlk girişte 2FA veya CAPTCHA için ana Mac’te işlem
        gerekebilir.
      </p>
      <Input
        aria-label="Instagram hesap kullanıcı adı"
        placeholder="Instagram kullanıcı adı"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Input
        aria-label="Instagram hesap şifresi"
        type="password"
        autoComplete="new-password"
        placeholder={id ? 'Şifre (boşsa değişmez)' : 'Şifre'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <h4>Proxy (isteğe bağlı, hesap başına sabit IP)</h4>
      <p className="field-hint">
        Her hesabı ayrı bir sabit proxy’ye bağlamak, hesapların aynı IP’den
        görünmesini ve tek IP’nin istek yükünü kaldırmasını önler.
        Dönen/rotasyonlu proxy önerilmez; oturum boyunca IP sabit kalmalı.
      </p>
      <Input
        aria-label="Proxy adresi"
        placeholder="http://host:port veya socks5://host:port"
        value={proxyServer}
        onChange={(e) => setProxyServer(e.target.value)}
      />
      <Input
        aria-label="Proxy kullanıcı adı"
        placeholder="Proxy kullanıcı adı (opsiyonel)"
        value={proxyUsername}
        onChange={(e) => setProxyUsername(e.target.value)}
      />
      <Input
        aria-label="Proxy şifresi"
        type="password"
        autoComplete="new-password"
        placeholder={id ? 'Proxy şifresi (boşsa değişmez)' : 'Proxy şifresi'}
        value={proxyPassword}
        onChange={(e) => setProxyPassword(e.target.value)}
      />
      <Button
        variant="outline"
        disabled={proxyTesting || !proxyServer.trim()}
        onClick={() => void testProxy()}
      >
        {proxyTesting ? 'Test ediliyor…' : 'Proxy’yi test et'}
      </Button>
      <h4>Günlük profil sınırı (isteğe bağlı)</h4>
      <p className="field-hint">
        Bu hesap günde bu kadar profil taradıktan sonra, aşağıdaki otomatik
        hesap değiştirme açıksa sıradaki uygun hesaba geçilir. Boş bırakılırsa
        sınır uygulanmaz.
      </p>
      <Input
        aria-label="Günlük profil sınırı"
        type="number"
        min={1}
        max={100000}
        placeholder="Örn. 1000 (opsiyonel)"
        value={dailyLimit}
        onChange={(e) => setDailyLimit(e.target.value)}
      />
      <h4>Persona (isteğe bağlı, post üretimi için)</h4>
      <p className="field-hint">
        Bu hesabın tarzını/kişiliğini kısaca anlat (örn. “kahve ve seyahat seven
        bir kadın”). “Post üret” düğmesi, Gemini ile bu tarzda sıradan bir
        görsel üretir — paylaşım otomatik yapılmaz, sen elle (Instagram
        penceresinden, aynı proxy üzerinden) paylaşırsın.
      </p>
      <Textarea
        aria-label="Hesap personası"
        placeholder="Örn. kahve ve seyahat seven bir kadın"
        value={persona}
        onChange={(e) => setPersona(e.target.value)}
      />
      {proxyTestMessage && <output>{proxyTestMessage}</output>}
      <Button
        disabled={busy || !username || (!id && !password)}
        onClick={() =>
          void save({
            id: id || undefined,
            username,
            password,
            proxyServer,
            proxyUsername,
            proxyPassword,
            persona,
            dailyLimit: dailyLimit === '' ? null : Number(dailyLimit),
          })
        }
      >
        {id ? 'Hesabı güncelle' : 'Hesap ekle'}
      </Button>
      <label>
        <input
          type="checkbox"
          checked={state.autoSwitch}
          disabled={busy}
          onChange={(e) =>
            void save({ action: 'options', autoSwitch: e.target.checked })
          }
        />{' '}
        Oturum sahibi hesabın askıya alındığı açıkça bildirilirse veya günlük
        profil sınırına ulaşılırsa sıradaki kullanılabilir hesaba geç
      </label>
      <small>
        Genel işlem/IP kısıtında ve doğrulama ekranında hesap değiştirilmez.
        Yeni hesap da kısıtlanabilir; kesintisiz çalışma garantisi yoktur.
        Askıya alınmış veya günlük sınırına ulaşmış hesap sırada atlanır.
      </small>
      {state.accounts.map((a) => (
        <div key={a.id}>
          <strong>@{a.username}</strong> ·{' '}
          {state.activeId === a.id ? 'Aktif · ' : ''}
          {a.status === 'suspended'
            ? 'Askıya alındı'
            : a.enabled
              ? 'Kullanılabilir'
              : 'Kapalı'}{' '}
          · {a.proxyServer ? `Proxy: ${a.proxyServer}` : 'Proxy yok'} ·{' '}
          {a.dailyLimit
            ? `Bugün: ${a.scannedToday || 0}/${a.dailyLimit}`
            : 'Günlük sınır yok'}{' '}
          <Button
            disabled={busy || a.status === 'suspended' || !a.enabled}
            onClick={() => void save({ action: 'switch', id: a.id })}
          >
            Seç
          </Button>{' '}
          <Button
            disabled={busy}
            onClick={() => {
              setId(a.id);
              setUsername(a.username);
              setPassword('');
              setProxyServer(a.proxyServer || '');
              setProxyUsername(a.proxyUsername || '');
              setProxyPassword('');
              setProxyTestMessage('');
              setDailyLimit(a.dailyLimit ? String(a.dailyLimit) : '');
              setPersona(a.persona || '');
            }}
          >
            Düzenle
          </Button>{' '}
          <Button
            variant="outline"
            disabled={!!generating[a.id]}
            onClick={() => void generatePostFor(a.id)}
          >
            {generating[a.id] ? 'Üretiliyor…' : 'Post üret'}
          </Button>{' '}
          <Button
            disabled={busy}
            onClick={() =>
              void save({ id: a.id, username: a.username, enabled: !a.enabled })
            }
          >
            {a.enabled ? 'Devre dışı bırak' : 'Etkinleştir'}
          </Button>{' '}
          {a.proxyServer && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void save({
                  id: a.id,
                  username: a.username,
                  proxyServer: '',
                })
              }
            >
              Proxy’yi kaldır
            </Button>
          )}{' '}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (
                !confirm(
                  `@${a.username} hesabını tamamen silmek istediğinize emin misiniz? Kayıtlı şifre, proxy bilgisi ve oturum kalıcı olarak silinir; bu işlem geri alınamaz.`,
                )
              )
                return;
              void save({ action: 'delete', id: a.id });
            }}
          >
            Sil
          </Button>
          {generateError[a.id] && (
            <output className="row-warning">{generateError[a.id]}</output>
          )}
          {generatedImages[a.id] && (
            <div>
              <Image
                src={generatedImages[a.id]}
                alt={`@${a.username} için üretilen post`}
                width={240}
                height={240}
                unoptimized
                style={{ maxWidth: 240, height: 'auto', display: 'block' }}
              />
              <a
                href={generatedImages[a.id]}
                download={`${a.username}-post.png`}
              >
                İndir
              </a>
            </div>
          )}
        </div>
      ))}
      {message && <output>{message}</output>}
      <details>
        <summary>Hesap geçiş kayıtları</summary>
        {state.events.map((e, i) => (
          <p key={i}>
            {new Date(e.at).toLocaleString('tr-TR')} · @{e.username}:{' '}
            {e.message}
          </p>
        ))}
      </details>
    </section>
  );
}

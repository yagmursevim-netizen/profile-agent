'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { InstagramAccountsPanel } from '@/components/instagram-accounts';
export function ConnectionSettings() {
  const [config, setConfig] = useState({
    openaiConfigured: false,
    geminiConfigured: false,
    sendgridConfigured: false,
    gmailConfigured: false,
    openaiModel: 'gpt-5-mini',
    fromEmail: 'hello@hiwellapp.com',
    fromName: 'Hiwell',
    fameFollowerThreshold: 100000,
    minFollowerThreshold: 0,
    titlePrefixes: 'dr,dyt,psk,av,prof',
    excludedUsernames: '',
    genderExclude: 'erkek',
    autoAssess: false,
    autoAssessLimit: 100,
    restBreakEnabled: false,
    restBreakEveryMinutes: 60,
    restBreakDurationMinutes: 15,
    accountSwitchEnabled: false,
    accountSwitchMinMinutes: 20,
    accountSwitchMaxMinutes: 40,
  });
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [sendgridKey, setSendgridKey] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedSender, setSavedSender] = useState('');
  const [testRecipient, setTestRecipient] = useState(
    'gani.somuncu@hiwellapp.com',
  );
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState('');
  const [notifyTestBusy, setNotifyTestBusy] = useState(false);
  const [notifyTestResult, setNotifyTestResult] = useState<{
    status: string;
    message: string;
  } | null>(null);
  const [testResult, setTestResult] = useState<{
    status: string;
    message: string;
    email: string;
    fromEmail: string;
    attemptedAt: string;
  } | null>(null);
  const senderDirty =
    !!sendgridKey ||
    savedSender !== JSON.stringify([config.fromEmail, config.fromName]);
  useEffect(() => {
    let live = true;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((v) => {
        if (live) {
          const value = v as typeof config;
          setConfig(value);
          setSavedSender(JSON.stringify([value.fromEmail, value.fromName]));
        }
      })
      .catch(() => {
        if (live) setMessage('Bağlantı ayarları okunamadı.');
      });
    fetch('/api/settings/test-email')
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as { latest: typeof testResult };
        if (live) setTestResult(data.latest);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          openaiKey,
          geminiKey,
          sendgridKey,
          gmailAppPassword,
        }),
      });
      const data = (await r.json()) as typeof config & { error?: string };
      if (!r.ok) throw new Error(data.error);
      setConfig(data);
      setSavedSender(JSON.stringify([data.fromEmail, data.fromName]));
      setOpenaiKey('');
      setGeminiKey('');
      setSendgridKey('');
      setGmailAppPassword('');
      setMessage('Ayarlar bu bilgisayara kaydedildi.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendNotificationTest() {
    setNotifyTestBusy(true);
    setNotifyTestResult(null);
    try {
      const response = await fetch('/api/settings/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = (await response.json()) as {
        status: string;
        message: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Test başlatılamadı.');
      setNotifyTestResult(data);
    } catch (e) {
      setNotifyTestResult({ status: 'failed', message: (e as Error).message });
    } finally {
      setNotifyTestBusy(false);
    }
  }
  async function sendTest(event: { preventDefault: () => void }) {
    event.preventDefault();
    setTestBusy(true);
    setTestError('');
    try {
      const response = await fetch('/api/settings/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testRecipient,
          requestId: crypto.randomUUID(),
        }),
      });
      const data = (await response.json()) as NonNullable<typeof testResult> & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Test başlatılamadı.');
      setTestResult(data);
    } catch (e) {
      setTestError(
        `${(e as Error).message} Sonuç belirsizse tekrar göndermeden önce posta kutusunu kontrol edin.`,
      );
    } finally {
      setTestBusy(false);
    }
  }
  return (
    <div className="settings-section credential-settings">
      <InstagramAccountsPanel />
      <h3>OpenAI & SendGrid</h3>
      <p>
        Anahtarlar yalnızca bu bilgisayardaki sunucuda saklanır. Boş
        bıraktığınız anahtar değişmez. İsterseniz .env dosyasını da
        kullanabilirsiniz.
      </p>
      <label htmlFor="openai-key">
        OpenAI API key {config.openaiConfigured ? '· Ayarlı' : '· Ayarlı değil'}
      </label>
      <Input
        id="openai-key"
        type="password"
        autoComplete="new-password"
        value={openaiKey}
        onChange={(e) => setOpenaiKey(e.target.value)}
        placeholder={
          config.openaiConfigured ? 'Yeni anahtar ile değiştir' : 'sk-…'
        }
      />
      <label htmlFor="openai-model">OpenAI modeli</label>
      <Input
        id="openai-model"
        value={config.openaiModel}
        onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })}
      />
      <p className="field-hint">
        OpenAI düğmesi seçili profillerin bio ve sayısal bilgilerini API’ye
        gönderir. Aşağıda açmadığın sürece tarama sırasında AI otomatik
        çalışmaz.
      </p>
      <label htmlFor="gemini-key">
        Gemini API key {config.geminiConfigured ? '· Ayarlı' : '· Ayarlı değil'}
      </label>
      <Input
        id="gemini-key"
        type="password"
        autoComplete="new-password"
        value={geminiKey}
        onChange={(e) => setGeminiKey(e.target.value)}
        placeholder={
          config.geminiConfigured ? 'Yeni anahtar ile değiştir' : 'AIza…'
        }
      />
      <p className="field-hint">
        Instagram hesap panelindeki “Post üret” düğmesi için kullanılır; hesabın
        persona açıklamasına göre paylaşılabilir, sıradan bir görsel üretir
        (elle paylaşman için).
      </p>
      <h3>Aday filtreleme</h3>
      <p>
        Takip listesi taranırken, profil ziyareti öncesi uygulanan eleme
        kuralları. Bu ayarlar tüm taramalarda geçerli olur.
      </p>
      <label htmlFor="fame-threshold">Ünlü sayılacak takipçi eşiği</label>
      <Input
        id="fame-threshold"
        type="number"
        min={1}
        value={config.fameFollowerThreshold}
        onChange={(e) =>
          setConfig({
            ...config,
            fameFollowerThreshold: Number(e.target.value) || 0,
          })
        }
      />
      <p className="field-hint">
        Bu sayının üzerinde takipçisi olan hesaplar “ünlü” sayılıp elenir
        (mümkünse profil ziyaretinden önce, takip listesindeki önizleme
        kartından okunan takipçi sayısıyla).
      </p>
      <label htmlFor="min-followers">Minimum takipçi eşiği</label>
      <Input
        id="min-followers"
        type="number"
        min={0}
        value={config.minFollowerThreshold}
        onChange={(e) =>
          setConfig({
            ...config,
            minFollowerThreshold: Number(e.target.value) || 0,
          })
        }
      />
      <p className="field-hint">
        Bu sayının altında takipçisi olan hesaplar da elenir (aynı önizleme
        kartından okunan takipçi sayısıyla, profil ziyaretinden önce). 0
        bırakılırsa alt sınır uygulanmaz.
      </p>
      <label htmlFor="title-prefixes">
        Elenecek unvan önekleri (virgülle ayrılmış)
      </label>
      <Input
        id="title-prefixes"
        value={config.titlePrefixes}
        onChange={(e) =>
          setConfig({ ...config, titlePrefixes: e.target.value })
        }
        placeholder="dr,dyt,psk,av,prof"
      />
      <p className="field-hint">
        Görünen adı bu öneklerden biriyle (nokta veya boşlukla ayrılmış)
        başlayan hesaplar hiç değerlendirilmez. Örn. “Dr. Ayşe”, “Prof. Dr.
        Zeynep”.
      </p>
      <label htmlFor="excluded-usernames">
        Hariç tutulacak kullanıcılar (virgül veya satır sonuyla ayrılmış)
      </label>
      <Textarea
        id="excluded-usernames"
        className="account-input"
        value={config.excludedUsernames}
        onChange={(e) =>
          setConfig({ ...config, excludedUsernames: e.target.value })
        }
        placeholder={'@kullaniciadi\nbaska.kullanici'}
      />
      <p className="field-hint">
        Bu listedeki kullanıcı adları, takip listesi taramasında profil hiç
        ziyaret edilmeden atlanır (“Elenen adaylar” altında görünür). Kaynak
        hesap olarak veya doğrudan hesap listesiyle taranan profilleri
        etkilemez.
      </p>
      <label htmlFor="gender-exclude">Cinsiyet elemesi</label>
      <select
        id="gender-exclude"
        value={config.genderExclude}
        onChange={(e) =>
          setConfig({ ...config, genderExclude: e.target.value })
        }
      >
        <option value="kapalı">Kapalı (cinsiyete göre eleme yok)</option>
        <option value="erkek">Erkek görünenleri ele</option>
        <option value="kadın">Kadın görünenleri ele</option>
      </select>
      <p className="field-hint">
        AI, adayın fotoğrafına ve adına bakarak (kesin olmayan) bir cinsiyet
        tahmini yapar; “belirsiz” tahminler hiçbir zaman elenmez, sadece net bir
        tahmin bu kurala uyarsa eleme uygulanır.
      </p>
      <h3>Otomatik AI değerlendirmesi</h3>
      <p>
        Açıksa, email veya iş birliği için DM sinyali bulunan profiller tarama
        sırasında otomatik olarak “Uygun aday / İncelenmeli / Uygun değil”
        değerlendirmesinden geçer — ayrıca elle “Uygunluğu değerlendir” demen
        gerekmez.
      </p>
      <label htmlFor="auto-assess">
        <input
          id="auto-assess"
          type="checkbox"
          checked={config.autoAssess}
          onChange={(e) =>
            setConfig({ ...config, autoAssess: e.target.checked })
          }
        />{' '}
        Tarama sırasında otomatik değerlendir
      </label>
      <label htmlFor="auto-assess-limit">
        Tarama başına en fazla otomatik değerlendirme
      </label>
      <Input
        id="auto-assess-limit"
        type="number"
        min={0}
        max={5000}
        disabled={!config.autoAssess}
        value={config.autoAssessLimit}
        onChange={(e) =>
          setConfig({
            ...config,
            autoAssessLimit: Number(e.target.value) || 0,
          })
        }
      />
      <p className="field-hint">
        Bu sınıra ulaşınca, o taramada kalan uygun profiller otomatik
        değerlendirilmez — istersen sonradan elle “Uygunluğu değerlendir” ile
        tamamlarsın. Sınır her tarama için ayrı sayılır.
      </p>
      <h3>Dinlenme molaları</h3>
      <p>
        Saatlerce hiç durmadan çalışan bir hesap, ara sıra duran bir hesaptan
        daha az insansı görünür. Açarsan, tarama belirli aralıklarla kendini
        durdurup mola verir, sonra kaldığı yerden devam eder.
      </p>
      <label htmlFor="rest-break-enabled">
        <input
          id="rest-break-enabled"
          type="checkbox"
          checked={config.restBreakEnabled}
          onChange={(e) =>
            setConfig({ ...config, restBreakEnabled: e.target.checked })
          }
        />{' '}
        Dinlenme molaları aktif
      </label>
      <label htmlFor="rest-break-every">Kaç dakikada bir mola</label>
      <Input
        id="rest-break-every"
        type="number"
        min={5}
        max={1440}
        disabled={!config.restBreakEnabled}
        value={config.restBreakEveryMinutes}
        onChange={(e) =>
          setConfig({
            ...config,
            restBreakEveryMinutes: Number(e.target.value) || 5,
          })
        }
      />
      <label htmlFor="rest-break-duration">Mola kaç dakika sürsün</label>
      <Input
        id="rest-break-duration"
        type="number"
        min={1}
        max={720}
        disabled={!config.restBreakEnabled}
        value={config.restBreakDurationMinutes}
        onChange={(e) =>
          setConfig({
            ...config,
            restBreakDurationMinutes: Number(e.target.value) || 1,
          })
        }
      />
      <p className="field-hint">
        Örn. 60 dakikada bir 15 dakika mola: tarama bir saat aktif çalışır,
        sonra 15 dakika durur, sonra otomatik devam eder. Mola sırasında
        “Durdur” yine anında çalışır.
      </p>
      <h3>Hesap rotasyonu</h3>
      <p>
        Dinlenme molalarına alternatif: taramayı durdurmak yerine, belirli
        aralıklarla otomatik olarak tanımlı başka bir Instagram hesabına geçer
        ve aynı adayla kaldığı yerden devam eder — bekleme olmaz. Yalnızca
        Instagram taramalarında ve birden fazla hesap tanımlıysa çalışır.
      </p>
      <label htmlFor="account-switch-enabled">
        <input
          id="account-switch-enabled"
          type="checkbox"
          checked={config.accountSwitchEnabled}
          onChange={(e) =>
            setConfig({ ...config, accountSwitchEnabled: e.target.checked })
          }
        />{' '}
        Hesap rotasyonu aktif
      </label>
      <label htmlFor="account-switch-min">En az kaç dakikada bir (dk)</label>
      <Input
        id="account-switch-min"
        type="number"
        min={1}
        max={1440}
        disabled={!config.accountSwitchEnabled}
        value={config.accountSwitchMinMinutes}
        onChange={(e) =>
          setConfig({
            ...config,
            accountSwitchMinMinutes: Number(e.target.value) || 1,
          })
        }
      />
      <label htmlFor="account-switch-max">En çok kaç dakikada bir (dk)</label>
      <Input
        id="account-switch-max"
        type="number"
        min={1}
        max={1440}
        disabled={!config.accountSwitchEnabled}
        value={config.accountSwitchMaxMinutes}
        onChange={(e) =>
          setConfig({
            ...config,
            accountSwitchMaxMinutes: Number(e.target.value) || 1,
          })
        }
      />
      <p className="field-hint">
        Her seferinde bu iki sayı arasında rastgele bir süre seçilir (örn. 20-40
        dk arası) — sabit bir aralık olmadığı için her taramada farklı
        zamanlarda geçiş olur. Kullanılamayan (askıya alınmış, kısıtlı, devre
        dışı) hesaplar rotasyona hiç girmez.
      </p>
      <p className="field-hint">
        Sunucu çökmesi veya Instagram/TikTok kısıtı oluştuğunda
        yagmur.sevim@hiwellapp.com ve ysevimyagmur@gmail.com adreslerine
        ysevimyagmur@gmail.com üzerinden (Gmail’in kendi sunucusuyla) bir
        bildirim gönderilir (adaylara gönderilen mailler bunun dışında, SendGrid
        ile devam eder).{' '}
        {config.gmailConfigured
          ? 'Uygulama şifresi ayarlı; gönderim sonucu tarama ekranında görünür.'
          : 'Uygulama şifresi ayarlı değil; bildirim maili henüz gönderilemez.'}
      </p>
      <label htmlFor="gmail-app-password">
        Gmail uygulama şifresi{' '}
        {config.gmailConfigured ? '· Ayarlı' : '· Ayarlı değil'}
      </label>
      <Input
        id="gmail-app-password"
        type="password"
        autoComplete="new-password"
        value={gmailAppPassword}
        onChange={(e) => setGmailAppPassword(e.target.value)}
        placeholder={
          config.gmailConfigured
            ? 'Yeni şifre ile değiştir'
            : 'abcd efgh ijkl mnop'
        }
      />
      <p className="field-hint">
        ysevimyagmur@gmail.com hesabında önce 2 Adımlı Doğrulama açık olmalı;
        sonra myaccount.google.com/apppasswords üzerinden “Uygulama şifreleri”
        ile 16 haneli bir şifre oluşturulur (Gmail hesap şifresi değil, ayrı bir
        şifredir).
      </p>
      <Button
        type="button"
        disabled={notifyTestBusy || !config.gmailConfigured}
        onClick={() => void sendNotificationTest()}
      >
        {notifyTestBusy
          ? 'Bildirim testi gönderiliyor…'
          : 'Bildirim testi gönder'}
      </Button>
      {notifyTestResult && (
        <p
          role="alert"
          className={
            notifyTestResult.status === 'accepted'
              ? 'notice success'
              : notifyTestResult.status === 'unknown'
                ? 'notice warning'
                : 'notice error'
          }
        >
          {notifyTestResult.message}
        </p>
      )}
      <label htmlFor="sendgrid-key">
        SendGrid bearer token{' '}
        {config.sendgridConfigured ? '· Ayarlı' : '· Ayarlı değil'}
      </label>
      <Input
        id="sendgrid-key"
        type="password"
        autoComplete="new-password"
        value={sendgridKey}
        onChange={(e) => setSendgridKey(e.target.value)}
        placeholder={
          config.sendgridConfigured ? 'Yeni token ile değiştir' : 'SG.…'
        }
      />
      <label htmlFor="sender-email">
        Gönderen email (SendGrid’de doğrulanmış)
      </label>
      <Input
        id="sender-email"
        type="email"
        value={config.fromEmail}
        onChange={(e) => setConfig({ ...config, fromEmail: e.target.value })}
      />
      <label htmlFor="sender-name">Gönderen adı</label>
      <Input
        id="sender-name"
        value={config.fromName}
        onChange={(e) => setConfig({ ...config, fromName: e.target.value })}
      />
      <Button className="primary" disabled={busy || testBusy} onClick={save}>
        {busy ? 'Kaydediliyor…' : 'Bağlantı ayarlarını kaydet'}
      </Button>
      {message && <p role="alert">{message}</p>}
      <form className="test-email-form" onSubmit={sendTest}>
        <h3>Test emaili gönder</h3>
        <p>
          Gönderen: {config.fromName} &lt;{config.fromEmail}&gt;
        </p>
        <label htmlFor="test-email-recipient">Test alıcısı</label>
        <Input
          id="test-email-recipient"
          type="email"
          required
          maxLength={254}
          value={testRecipient}
          onChange={(e) => setTestRecipient(e.target.value)}
          disabled={testBusy}
        />
        <p className="field-hint">
          Konu: Hiwell Partner Studio · Test emaili. Gönderilen mesaj yalnızca
          bağlantı testi metnini içerir.
        </p>
        {senderDirty && (
          <p className="row-warning">
            Değiştirdiğiniz SendGrid token veya gönderen bilgilerini önce
            kaydedin.
          </p>
        )}
        {!config.sendgridConfigured && (
          <p className="row-warning">
            Test için önce SendGrid token bilgisini kaydedin.
          </p>
        )}
        <Button
          type="submit"
          className="primary"
          disabled={
            busy || testBusy || senderDirty || !config.sendgridConfigured
          }
        >
          {testBusy ? 'Test emaili gönderiliyor…' : 'Test emaili gönder'}
        </Button>
        {testError && (
          <p role="alert" className="notice error">
            {testError}
          </p>
        )}
        {testResult && (
          <div
            className={
              testResult.status === 'accepted'
                ? 'notice success'
                : 'notice warning'
            }
            role="alert"
          >
            <div>
              <strong>Son test · {testResult.email}</strong>
              <p>{testResult.message}</p>
              <small>
                {new Date(testResult.attemptedAt).toLocaleString('tr-TR')} ·{' '}
                {testResult.fromEmail}
              </small>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

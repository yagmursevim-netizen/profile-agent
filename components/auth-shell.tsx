'use client';
import Image from 'next/image';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export type AppUser = {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'member';
  disabled: boolean;
  mustChangePassword: boolean;
  mailIdentity: { personalEmail: string; senderEmails: string[] };
};
async function authRequest(path: string, data?: unknown) {
  const res = await fetch(
    '/api/' + path,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const value = (await res.json()) as {
    error?: string;
    user: AppUser | null;
    users: AppUser[];
    temporaryPassword?: string;
  };
  if (!res.ok) throw new Error(value.error || 'İşlem tamamlanamadı.');
  return value;
}
export function AuthShell({
  children,
}: {
  children: (user: AppUser, controls: ReactNode) => ReactNode;
}) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const data = await authRequest('auth/me');
        if (live) {
          setUser(data.user);
          setLoading(false);
        }
      } catch {
        if (live) {
          setUser(null);
          setLoading(false);
          setError('Yerel servise ulaşılamadı.');
        }
      }
    };
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function logout() {
    setBusy(true);
    try {
      await authRequest('auth/logout', {});
      setUser(null);
      setChange(false);
      setUsersOpen(false);
      setPassword('');
      setNewPassword('');
      setRepeat('');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (user) {
        if (newPassword !== repeat)
          throw new Error('Yeni şifreler eşleşmiyor.');
        await authRequest('auth/password', {
          currentPassword: password,
          password: newPassword,
        });
        setUser(null);
        setChange(false);
        setNewPassword('');
        setRepeat('');
        setError('Şifreniz değişti. Yeni şifrenizle giriş yapın.');
      } else {
        const data = await authRequest('auth/login', { username, password });
        setUser(data.user);
      }
      setPassword('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="auth-page">
        <p>Çalışma alanı açılıyor…</p>
      </main>
    );
  if (!user || user.mustChangePassword || change)
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Image
            src="/hiwell-logo.jpg"
            alt="Hiwell"
            width={142}
            height={60}
            unoptimized
          />
          <p className="eyebrow">PARTNER STUDIO</p>
          <h1>{user ? 'Şifrenizi değiştirin' : 'Çalışma alanına giriş'}</h1>
          <p>
            {user
              ? `${user.name}, devam etmek için size ait bir şifre belirleyin.`
              : 'Size tanımlanan kullanıcı adı ve şifreyle giriş yapın.'}
          </p>
          <form onSubmit={submit}>
            {!user && (
              <>
                <label htmlFor="app-username">Kullanıcı adı</label>
                <Input
                  id="app-username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </>
            )}
            <label htmlFor="app-password">
              {user ? 'Mevcut / geçici şifre' : 'Şifre'}
            </label>
            <Input
              id="app-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {user && (
              <>
                <label htmlFor="app-new-password">
                  Yeni şifre · en az 12 karakter
                </label>
                <Input
                  id="app-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <label htmlFor="app-repeat">Yeni şifre tekrar</label>
                <Input
                  id="app-repeat"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </>
            )}
            {error && <p role="alert">{error}</p>}
            <Button className="primary" disabled={busy} type="submit">
              {busy ? 'Bekleyin…' : user ? 'Şifreyi değiştir' : 'Giriş yap'}
            </Button>
            {user && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void logout()}
              >
                Çıkış yap
              </Button>
            )}
          </form>
        </section>
      </main>
    );
  return (
    <>
      {children(
        user,
        <div className="user-controls">
          <span>
            {user.name} · {user.role === 'admin' ? 'Admin' : 'Ekip'}
          </span>
          {user.role === 'admin' && (
            <Button variant="outline" onClick={() => setUsersOpen(true)}>
              Kullanıcılar
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setPassword('');
              setError('');
              setChange(true);
            }}
          >
            Şifrem
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void logout()}>
            Çıkış
          </Button>
        </div>,
      )}
      {user.role === 'admin' && (
        <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
          <DialogContent className="settings-dialog">
            <DialogTitle>Kullanıcı yönetimi</DialogTitle>
            <DialogDescription>
              Tek admin hesabı vardır. Ekip üyeleri tarama, AI ve email çalışma
              alanını kullanır; bağlantı ayarlarına erişemez.
            </DialogDescription>
            {usersOpen && <UserManagement />}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
function UserManagement() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [emailUser, setEmailUser] = useState<AppUser | null>(null);
  const [personalEmail, setPersonalEmail] = useState('');
  const [senderEmails, setSenderEmails] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void authRequest('users')
      .then((d) => {
        if (live) setUsers(d.users);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function act(data: object) {
    setBusy(true);
    setMessage('');
    setSecret('');
    try {
      const result = await authRequest('users', data);
      if (result.temporaryPassword)
        setSecret(`${result.user?.username}: ${result.temporaryPassword}`);
      const list = await authRequest('users');
      setUsers(list.users);
      setMessage('Kullanıcı kaydedildi.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="user-management">
      {users.map((u) => (
        <article key={u.id}>
          <div>
            <strong>{u.name}</strong>
            <small>
              @{u.username} ·{' '}
              {u.role === 'admin'
                ? 'Admin'
                : u.disabled
                  ? 'Devre dışı'
                  : 'Ekip üyesi'}
              {u.mustChangePassword ? ' · İlk giriş bekleniyor' : ''}
            </small>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEmailUser(u);
              setPersonalEmail(u.mailIdentity?.personalEmail || '');
              setSenderEmails(
                (u.mailIdentity?.senderEmails || [])
                  .filter((e) => e !== u.mailIdentity?.personalEmail)
                  .join('\n'),
              );
            }}
          >
            Email adresleri
          </Button>
          {u.role !== 'admin' && (
            <div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act({ action: 'reset', id: u.id })}
              >
                Geçici şifre oluştur
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void act({ action: 'toggle', id: u.id })}
              >
                {u.disabled ? 'Etkinleştir' : 'Devre dışı bırak'}
              </Button>
            </div>
          )}
        </article>
      ))}
      {emailUser && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act({
              action: 'email',
              id: emailUser.id,
              personalEmail,
              senderEmails: senderEmails
                .split(/[\n,;]+/)
                .map((e) => e.trim())
                .filter(Boolean),
            });
          }}
        >
          <h3>{emailUser.name} · Email adresleri</h3>
          <label htmlFor="personal-email">
            Kişisel email · Yanıtlar her zaman buraya gelir
          </label>
          <Input
            id="personal-email"
            type="email"
            value={personalEmail}
            onChange={(e) => setPersonalEmail(e.target.value)}
          />
          <label htmlFor="sender-emails">
            Ek gönderen adresleri · Her satıra bir adres
          </label>
          <Textarea
            id="sender-emails"
            rows={3}
            value={senderEmails}
            onChange={(e) => setSenderEmails(e.target.value)}
          />
          <p>
            Kişisel adres de gönderen seçeneklerine eklenir. Gönderen
            adreslerinin SendGrid üzerinden gönderime uygun olması gerekir.
          </p>
          <Button type="submit" className="primary" disabled={busy}>
            Email adreslerini kaydet
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setEmailUser(null)}
          >
            Kapat
          </Button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act({ action: 'create', username, name });
        }}
      >
        <h3>Yeni ekip üyesi</h3>
        <label htmlFor="member-name">Ad soyad</label>
        <Input
          id="member-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
        />
        <label htmlFor="member-username">
          Kullanıcı adı · Türkçe karakter kullanmayın
        </label>
        <Input
          id="member-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          pattern="[a-z0-9._\-]{3,40}"
          required
        />
        <Button className="primary" disabled={busy} type="submit">
          Kullanıcı oluştur
        </Button>
      </form>
      {message && <output>{message}</output>}
      {secret && (
        <div className="temporary-password">
          <strong>Geçici giriş bilgisi</strong>
          <code>{secret}</code>
          <p>
            Yalnızca bu işlemde gösterilir. İlgili kişiye güvenli şekilde
            iletin; ilk girişte değiştirilecektir.
          </p>
          <Button variant="outline" onClick={() => setSecret('')}>
            Gizle
          </Button>
        </div>
      )}
    </div>
  );
}

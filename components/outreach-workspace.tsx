'use client';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Send, Eye, Plus, Mail, FileText, Pencil } from 'lucide-react';
type Template = { id: string; name: string; subject: string; body: string };
type Contact = {
  id: string;
  senderName?: string;
  fromEmail?: string;
  username: string;
  platform?: string;
  name: string;
  email: string;
  emailOptions: string[];
  dmForCollaboration?: boolean;
  dmEvidence?: string | null;
  photoUrl?: string | null;
  language?: string | null;
  bio?: string | null;
  templateId: string | null;
  status: string;
  error: string | null;
  demo?: boolean;
};
// Instagram's CDN URLs expire and can reject cross-origin browser requests;
// proxying through our server fetches and caches them, matching the same
// approach used for the main scan results table.
const photoProxy = (url: string) => `/api/photo?u=${encodeURIComponent(url)}`;
type History = {
  id: string;
  email: string;
  name: string;
  status: string;
  actorName: string;
  fromEmail?: string;
  date?: string;
  source: string;
  recordedByName?: string;
};
type Store = {
  history?: History[];
  contacts: Contact[];
  templates: Template[];
  sending: boolean;
  mailIdentity?: { personalEmail: string; senderEmails: string[] };
};
type Preview = {
  id: string;
  fromEmail: string;
  replyTo: string;
  fromName: string;
  canSend: boolean;
  messages: {
    id: string;
    name: string;
    username: string;
    email: string;
    subject: string;
    body: string;
    templateName: string;
    demo?: boolean;
  }[];
};
const statusNames: Record<string, string> = {
  suppressed: 'Tekrar gönderim engellendi',
  imported: 'Daha önce gönderildi (beyan)',
  queued: 'Kuyrukta',
  draft: 'Taslak',
  sending: 'Gönderiliyor',
  accepted: 'SendGrid kabul etti',
  failed: 'Başarısız',
  unknown: 'Sonuç belirsiz',
};
async function request<T>(route: string, data?: unknown): Promise<T> {
  const r = await fetch(
    '/api/outreach' + route,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const value = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(value.error || 'İşlem başarısız.');
  return value;
}
function TemplateChoice({
  value,
  templates,
  onChange,
  disabled = false,
}: {
  value: string | null;
  templates: Template[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? ''}
      onValueChange={(v) => v && onChange(v)}
      items={[
        { value: '', label: 'Şablon seçin' },
        ...templates.map((t) => ({ value: t.id, label: t.name })),
      ]}
    >
      <SelectTrigger
        aria-label="Email şablonu"
        disabled={disabled}
        className="choice"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">Şablon seçin</SelectItem>
        {templates.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function OutreachWorkspace({
  view,
  onTemplates,
}: {
  view: 'email' | 'templates';
  onTemplates: () => void;
}) {
  const [store, setStore] = useState<Store>({
    contacts: [],
    templates: [],
    sending: false,
  });
  const [historyEmail, setHistoryEmail] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [selectedFrom, setSelectedFrom] = useState('');
  const senderEmails = store.mailIdentity?.senderEmails || [];
  const fromEmail = senderEmails.includes(selectedFrom)
    ? selectedFrom
    : senderEmails[0] || '';
  const [checked, setChecked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [batchTemplate, setBatchTemplate] = useState('');
  const [amount, setAmount] = useState('30');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editor, setEditor] = useState<Partial<Template> | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStore(await request<Store>(''));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  const rows = store.contacts.filter(
    (c) =>
      (channel === 'all' ||
        (channel === 'dm' ? !!c.dmForCollaboration : !!c.email)) &&
      (languageFilter === 'all' ||
        (languageFilter === 'tr'
          ? c.language === 'Türkçe'
          : c.language !== 'Türkçe')) &&
      `${c.name} ${c.username} ${c.email}`
        .toLocaleLowerCase('tr')
        .includes(query.toLocaleLowerCase('tr')),
  );
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const ids = checked.filter((id) => store.contacts.some((c) => c.id === id));
  const editable = (c: Contact) => ['draft', 'failed'].includes(c.status);
  const toggle = (id: string, on: boolean) =>
    setChecked((old) =>
      on ? [...new Set([...old, id])] : old.filter((x) => x !== id),
    );
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importContacts(data: unknown) {
    setImportIssues([]);
    const result = await request<{
      added: number;
      skipped: string[];
      rejected: string[];
    }>('/import', data);
    setNotice(
      `${result.added} kişi eklendi. ${result.skipped.length} tekrar, ${result.rejected.length} geçersiz satır atlandı.`,
    );
    setImportIssues([...result.rejected, ...result.skipped]);
    if (result.added) {
      setNewName('');
      setNewEmail('');
    }
  }
  const locked = busy || store.sending;
  return (
    <section className="outreach-workspace">
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && <output className="notice success">{notice}</output>}
      {view === 'email' ? (
        <>
          <div className="results-heading panel">
            <div>
              <h2>
                <Mail size={19} />
                Email & DM listesi{' '}
                <span className="count-badge">{store.contacts.length}</span>
              </h2>
              <p>
                Email adaylarına ayrı email gönderilir. DM adayları için profil
                bağlantısını kullanın; uygulama DM göndermez.
              </p>
            </div>
            <Button
              variant="outline"
              className="secondary"
              onClick={onTemplates}
            >
              <FileText size={16} />
              Şablonları yönet
            </Button>
          </div>
          <div className="panel sender-panel">
            <h3>Daha önce gönderilenler / gönderim geçmişi</h3>
            <p>
              Buraya eklenen adreslere hiçbir kullanıcı tekrar email gönderemez.
              İçe aktarılan eski gönderimlerin göndereni ve tarihi bilinmiyor
              olarak kalır. Başlamış bir gönderim geri alınamaz.
            </p>
            <Input
              aria-label="Daha önce email gönderilen adres"
              placeholder="Daha önce gönderilen email"
              value={historyEmail}
              onChange={(e) => setHistoryEmail(e.target.value)}
            />
            <Button
              disabled={busy || !historyEmail.trim()}
              onClick={() =>
                void act(async () => {
                  const r = await request<{
                    added: number;
                    rejected: string[];
                  }>('/suppress', { mode: 'manual', email: historyEmail });
                  setNotice(
                    `${r.added} adres tekrar gönderime kapatıldı. ${r.rejected.join(' ')}`,
                  );
                  setHistoryEmail('');
                  setPreview(null);
                })
              }
            >
              Daha önce gönderildi olarak ekle
            </Button>
            <label htmlFor="sent-csv">
              Eski gönderim listesini yükle (email, isteğe bağlı isim; en fazla
              500 satır)
            </label>
            <Input
              id="sent-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void act(async () => {
                  if (file.size > 1024 * 1024)
                    throw new Error('En fazla 1 MB.');
                  const r = await request<{
                    added: number;
                    skipped: number;
                    rejected: string[];
                  }>('/suppress', { mode: 'csv', csv: await file.text() });
                  setNotice(
                    `${r.added} adres engellendi; ${r.skipped} tekrar atlandı.`,
                  );
                  setImportIssues(r.rejected);
                  setPreview(null);
                });
              }}
            />
            <div>
              <a
                download="email-gecmisi.csv"
                href="/api/outreach/history-export?format=csv"
              >
                Gönderilenleri CSV indir
              </a>{' '}
              ·{' '}
              <a
                download="email-gecmisi.xlsx"
                href="/api/outreach/history-export?format=xlsx"
              >
                Gönderilenleri Excel indir
              </a>
            </div>
            <small>
              Çıktıda kabul edilenler, içe aktarılanlar ve tekrar gönderilmeyen
              belirsiz sonuçlar ayrı durumlarıyla yer alır. Kabul, teslim edildi
              anlamına gelmez.
            </small>
            <Input
              aria-label="Gönderim geçmişinde ara"
              placeholder="Email veya gönderen kullanıcı ara"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
            <details>
              <summary>
                Gönderim geçmişini göster ({store.history?.length || 0})
              </summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Alıcı',
                      'Durum',
                      'Gönderen kullanıcı',
                      'Gönderen adres',
                      'Tarih',
                      'Kaynak',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(store.history || [])
                    .filter((h) =>
                      `${h.email} ${h.actorName}`
                        .toLocaleLowerCase('tr')
                        .includes(historyQuery.toLocaleLowerCase('tr')),
                    )
                    .map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{h.email}</TableCell>
                        <TableCell>
                          {statusNames[h.status] || h.status}
                        </TableCell>
                        <TableCell>{h.actorName}</TableCell>
                        <TableCell>{h.fromEmail || 'Bilinmiyor'}</TableCell>
                        <TableCell>
                          {h.date
                            ? new Date(h.date).toLocaleString('tr-TR')
                            : 'Bilinmiyor'}
                        </TableCell>
                        <TableCell>
                          {h.source}
                          {h.recordedByName
                            ? ` · Ekleyen: ${h.recordedByName}`
                            : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </details>
          </div>
          <div className="panel sender-panel">
            <h3>Email listesine kişi ekle</h3>
            <p>
              İsim isteğe bağlıdır; şablonlardaki isim alanını doldurur. Eklenen
              kişiler taslak olarak kaydedilir.
            </p>
            <Input
              aria-label="Eklenecek kişinin adı"
              placeholder="Ad soyad (isteğe bağlı)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={200}
              disabled={locked}
            />
            <Input
              aria-label="Eklenecek email adresi"
              type="email"
              placeholder="Email adresi"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              maxLength={254}
              disabled={locked}
            />
            <Button
              disabled={locked || !newEmail.trim()}
              onClick={() =>
                void act(() =>
                  importContacts({
                    mode: 'manual',
                    name: newName,
                    email: newEmail,
                  }),
                )
              }
            >
              <Plus size={16} />
              Kişi ekle
            </Button>
            <label htmlFor="contacts-csv">
              CSV ile toplu ekle (en fazla 500 kişi / 1 MB)
            </label>
            <small>
              Başlıklar: email ve isteğe bağlı isim. Virgül veya noktalı virgül
              kullanılabilir. Tekrar eden adresler atlanır.
            </small>
            <Input
              id="contacts-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={locked}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void act(async () => {
                  if (file.size > 1024 * 1024)
                    throw new Error('CSV en fazla 1 MB olabilir.');
                  await importContacts({ mode: 'csv', csv: await file.text() });
                });
              }}
            />
            <a
              download="email-listesi-ornek.csv"
              href={
                'data:text/csv;charset=utf-8,' +
                encodeURIComponent(
                  '\uFEFFisim,email\nÖrnek Kişi,ornek@example.com\n',
                )
              }
            >
              Örnek CSV indir
            </a>
            {importIssues.length > 0 && (
              <details>
                <summary>Atlanan satırlar ({importIssues.length})</summary>
                <ul>
                  {importIssues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="panel sender-panel">
            <label htmlFor="outreach-sender">Gönderen email adresi</label>
            <Select
              value={fromEmail || null}
              onValueChange={(value) => setSelectedFrom(value || '')}
              disabled={locked || !senderEmails.length}
            >
              <SelectTrigger id="outreach-sender">
                <SelectValue placeholder="Gönderen adresi tanımlanmamış" />
              </SelectTrigger>
              <SelectContent>
                {senderEmails.map((email) => (
                  <SelectItem key={email} value={email}>
                    {email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p>
              Yanıt adresi (Reply-To):{' '}
              <strong>
                {store.mailIdentity?.personalEmail || 'Tanımlanmamış'}
              </strong>
            </p>
            {!senderEmails.length && (
              <p>
                Admin, Kullanıcılar → Email adresleri bölümünden adres
                tanımlayabilir.
              </p>
            )}
          </div>
          <div className="panel outreach-table">
            <div className="bulk-toolbar">
              <Input
                aria-label="Email listesinde ara"
                placeholder="İsim, kullanıcı veya email ara"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
              <div className="template-select">
                <Select
                  value={channel}
                  onValueChange={(v) => {
                    if (v) {
                      setChannel(v);
                      setChecked([]);
                      setPage(1);
                    }
                  }}
                  items={[
                    { value: 'all', label: 'Tüm iletişim kanalları' },
                    { value: 'email', label: 'Email bulunanlar' },
                    { value: 'dm', label: 'DM ile iş birliği' },
                  ]}
                >
                  <SelectTrigger
                    aria-label="İletişim kanalı"
                    className="choice"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm iletişim kanalları</SelectItem>
                    <SelectItem value="email">Email bulunanlar</SelectItem>
                    <SelectItem value="dm">DM ile iş birliği</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="template-select">
                <Select
                  value={languageFilter}
                  onValueChange={(v) => {
                    if (v) {
                      setLanguageFilter(v);
                      setChecked([]);
                      setPage(1);
                    }
                  }}
                  items={[
                    { value: 'all', label: 'Tüm diller' },
                    { value: 'tr', label: 'Yalnızca Türkçe' },
                    { value: 'other', label: 'Türkçe olmayan/bilinmeyen' },
                  ]}
                >
                  <SelectTrigger aria-label="Dil filtresi" className="choice">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm diller</SelectItem>
                    <SelectItem value="tr">Yalnızca Türkçe</SelectItem>
                    <SelectItem value="other">
                      Türkçe olmayan/bilinmeyen
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span>{ids.length} kişi seçili</span>
              <Input
                aria-label="Seçilecek kişi sayısı"
                type="number"
                min={1}
                max={500}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="amount-input"
              />
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  const n = Number(amount);
                  if (!Number.isInteger(n) || n < 1 || n > 500) {
                    setError('1–500 kişi seçin.');
                    return;
                  }
                  setChecked(
                    rows
                      .filter((c) => editable(c) && !!c.email && !c.templateId)
                      .slice(0, n)
                      .map((c) => c.id),
                  );
                }}
              >
                Sıradaki şablonsuzları seç
              </Button>
              <Button variant="ghost" onClick={() => setChecked([])}>
                Seçimi temizle
              </Button>
            </div>
            <div className="bulk-toolbar">
              <div className="template-select">
                <TemplateChoice
                  value={batchTemplate}
                  templates={store.templates}
                  onChange={setBatchTemplate}
                  disabled={locked}
                />
              </div>
              <Button
                className="primary"
                disabled={locked || !ids.length || !batchTemplate}
                onClick={() =>
                  act(async () => {
                    await request('/assign', {
                      ids,
                      templateId: batchTemplate,
                    });
                    setChecked([]);
                    setNotice('Seçili kişilere şablon atandı.');
                  })
                }
              >
                Seçilenlere şablon ata
              </Button>
              <Button
                variant="outline"
                disabled={busy || !ids.length || !fromEmail}
                onClick={() =>
                  act(async () => {
                    setPreview(
                      await request<Preview>('/preview', { ids, fromEmail }),
                    );
                  })
                }
              >
                <Eye size={16} />
                Önizle ve gönder
              </Button>
              <Button
                variant="ghost"
                disabled={locked || !ids.length}
                onClick={() =>
                  act(async () => {
                    await request('/archive', { ids });
                    setChecked([]);
                    setNotice(
                      'Seçili kişiler listeden çıkarıldı; gönderim geçmişi korundu.',
                    );
                  })
                }
              >
                Listeden çıkar
              </Button>
            </div>
            {store.sending && (
              <output className="notice warning">
                Gönderim sürüyor. Kabul edilen kayıtlar tekrar gönderilmez.
              </output>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox
                      aria-label="Görünen email kayıtlarını seç"
                      checked={
                        rows.length > 0 && rows.every((c) => ids.includes(c.id))
                      }
                      onCheckedChange={(v) =>
                        setChecked(v ? rows.map((c) => c.id) : [])
                      }
                    />
                  </TableHead>
                  <TableHead>Kişi / Hitap adı</TableHead>
                  <TableHead>Bio</TableHead>
                  <TableHead>İletişim</TableHead>
                  <TableHead>Şablon</TableHead>
                  <TableHead>Gönderim durumu</TableHead>
                  <TableHead>İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={`${c.username} seç`}
                        checked={ids.includes(c.id)}
                        onCheckedChange={(v) => toggle(c.id, v)}
                      />
                    </TableCell>
                    <TableCell>
                      <a
                        className="profile-link"
                        href={
                          c.platform === 'tiktok'
                            ? `https://www.tiktok.com/@${c.username}`
                            : `https://www.instagram.com/${c.username}/`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.photoUrl ? (
                          <Image
                            src={photoProxy(c.photoUrl)}
                            alt={c.username}
                            width={34}
                            height={34}
                            unoptimized
                            className="avatar-photo"
                          />
                        ) : (
                          <span className="avatar">
                            {c.username.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            @{c.username}
                            {c.demo ? ' · Örnek veri' : ''}
                            {c.language && ` · ${c.language}`}
                          </small>
                        </span>
                      </a>
                    </TableCell>
                    <TableCell>
                      {c.bio ? (
                        <p className="bio-cell" title={c.bio}>
                          {c.bio}
                        </p>
                      ) : (
                        <span className="null-value">null</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.email || (
                        <span className="dm-badge">Email yok · DM adayı</span>
                      )}
                      {c.dmForCollaboration && (
                        <small title={c.dmEvidence || ''}>
                          İş birliği için DM:{' '}
                          {c.dmEvidence || 'Profilde beyan edilmiş'}
                        </small>
                      )}
                      {c.dmForCollaboration && (
                        <a
                          className="single-ai"
                          href={
                            c.platform === 'tiktok'
                              ? `https://www.tiktok.com/@${c.username}`
                              : `https://www.instagram.com/${c.username}/`
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {c.platform === 'tiktok' ? 'TikTok' : 'Instagram'}{' '}
                          profilini aç ↗
                        </a>
                      )}
                      <small>
                        {c.emailOptions.length > 1
                          ? 'Birden fazla adres var; Düzenle ile seçin.'
                          : ''}
                      </small>
                    </TableCell>
                    <TableCell>
                      <TemplateChoice
                        value={c.templateId}
                        templates={store.templates}
                        disabled={locked || !editable(c) || !c.email}
                        onChange={(v) =>
                          act(async () => {
                            await request('/assign', {
                              ids: [c.id],
                              templateId: v,
                            });
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <span
                        className={`verdict ${c.status === 'accepted' ? 'yes' : c.status === 'failed' || c.status === 'unknown' ? 'review' : ''}`}
                      >
                        {!c.email
                          ? 'DM · Manuel iletişim'
                          : statusNames[c.status]}
                      </span>
                      {c.senderName && (
                        <small>
                          Gönderen: {c.senderName} · {c.fromEmail}
                        </small>
                      )}
                      {c.error && (
                        <small className="row-warning">{c.error}</small>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={locked || !editable(c)}
                        onClick={() => setContact({ ...c })}
                      >
                        <Pencil size={14} />
                        Düzenle
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={
                          busy ||
                          !fromEmail ||
                          !editable(c) ||
                          !c.templateId ||
                          !c.email
                        }
                        onClick={() =>
                          act(async () => {
                            setPreview(
                              await request<Preview>('/preview', {
                                ids: [c.id],
                                fromEmail,
                              }),
                            );
                          })
                        }
                      >
                        <Eye size={14} />
                        Önizle
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!!rows.length && (
              <div className="table-footer">
                <span>
                  {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, rows.length)} /{' '}
                  {rows.length} kişi
                </span>
                <div className="pagination">
                  <label className="page-size">
                    Sayfada
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      {[25, 50, 100, 250, 500].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Önceki
                  </Button>
                  <span>
                    {currentPage} / {pages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={currentPage >= pages}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            )}
            {!rows.length && (
              <div className="empty-state">
                <Mail size={28} />
                <h3>İletişim listesi boş</h3>
                <p>
                  Keşif tablosunda profilleri seçip “İletişim listesine ekle”
                  düğmesini kullanın.
                </p>
              </div>
            )}
            <p className="outreach-footnote">
              “SendGrid kabul etti” teslim edildi anlamına gelmez. Sonucu
              belirsiz gönderimler otomatik tekrarlanmaz.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="results-heading panel">
            <div>
              <h2>
                <FileText size={19} />
                Email şablonları
              </h2>
              <p>
                İsim için {'{{isim}}'}, ilk kelime için {'{{ad}}'}, kullanıcı
                adı için {'{{kullanici_adi}}'} kullanın.
              </p>
            </div>
            <Button
              className="primary"
              disabled={locked}
              onClick={() =>
                setEditor({
                  name: '',
                  subject: 'Hiwell iş birliği daveti',
                  body: 'Merhaba {{isim}},\n\nHiwell affiliate kampanyamız için sizinle bir iş birliği görüşmek isteriz. İlgilenirseniz detayları paylaşmaktan memnuniyet duyarız.\n\nSevgiler,\nHiwell Ekibi',
                })
              }
            >
              <Plus size={16} />
              Şablon ekle
            </Button>
          </div>
          <div className="template-grid">
            {store.templates.map((t) => (
              <article className="panel template-card" key={t.id}>
                <h3>{t.name}</h3>
                <strong>{t.subject}</strong>
                <p>{t.body}</p>
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => setEditor({ ...t })}
                >
                  <Pencil size={14} />
                  Düzenle
                </Button>
              </article>
            ))}
          </div>
          {!store.templates.length && (
            <div className="panel empty-state">
              <FileText size={30} />
              <h3>İlk email şablonunuzu ekleyin</h3>
              <p>
                Şablon adı, konu ve mesajı kaydedip listedeki kişilere atayın.
              </p>
            </div>
          )}
        </>
      )}
      <Dialog open={!!editor} onOpenChange={(v) => !v && setEditor(null)}>
        <DialogContent className="mail-dialog">
          <DialogTitle>
            {editor?.id ? 'Şablonu düzenle' : 'Yeni şablon'}
          </DialogTitle>
          <DialogDescription>
            {
              'Alanlar: {{isim}}, {{ad}}, {{kullanici_adi}}, {{email}}. Profil adı yoksa kullanıcı adı kullanılır; listede hitap adını değiştirebilirsiniz.'
            }
          </DialogDescription>
          <label htmlFor="template-name">Şablon adı</label>
          <Input
            id="template-name"
            value={editor?.name ?? ''}
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
          />
          <label htmlFor="template-subject">Konu</label>
          <Input
            id="template-subject"
            value={editor?.subject ?? ''}
            onChange={(e) => setEditor({ ...editor, subject: e.target.value })}
          />
          <label htmlFor="template-body">Email metni</label>
          <Textarea
            id="template-body"
            rows={10}
            value={editor?.body ?? ''}
            onChange={(e) => setEditor({ ...editor, body: e.target.value })}
          />
          {error && (
            <p role="alert" className="row-warning">
              {error}
            </p>
          )}
          <Button
            className="primary"
            disabled={locked}
            onClick={() =>
              act(async () => {
                await request('/templates', editor);
                setEditor(null);
                setNotice('Şablon kaydedildi.');
              })
            }
          >
            Şablonu kaydet
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!contact} onOpenChange={(v) => !v && setContact(null)}>
        <DialogContent className="mail-dialog">
          <DialogTitle>Alıcıyı düzenle</DialogTitle>
          <DialogDescription>
            Hitap adı şablondaki isim alanını doldurur. DM adaylarında email boş
            kalabilir; adres eklerseniz email gönderimi de kullanılabilir.
          </DialogDescription>
          <label htmlFor="contact-name">Hitap adı</label>
          <Input
            id="contact-name"
            value={contact?.name ?? ''}
            onChange={(e) =>
              contact && setContact({ ...contact, name: e.target.value })
            }
          />
          <label htmlFor="contact-email">Email</label>
          <Input
            id="contact-email"
            type="email"
            list="contact-addresses"
            value={contact?.email ?? ''}
            onChange={(e) =>
              contact && setContact({ ...contact, email: e.target.value })
            }
          />
          <datalist id="contact-addresses">
            {contact?.emailOptions.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </datalist>
          {error && (
            <p role="alert" className="row-warning">
              {error}
            </p>
          )}
          <Button
            className="primary"
            disabled={locked}
            onClick={() =>
              act(async () => {
                await request('/edit', contact);
                setContact(null);
              })
            }
          >
            Alıcıyı kaydet
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(v) => !v && !busy && setPreview(null)}
      >
        <DialogContent className="mail-preview-dialog">
          <DialogTitle>
            {preview?.messages.length} email · Gönderim önizlemesi
          </DialogTitle>
          <DialogDescription>
            {preview?.fromName} &lt;{preview?.fromEmail}&gt; adresinden, yanıt
            adresi {preview?.replyTo} olacak şekilde, aşağıdaki alıcılara ayrı
            ayrı gönderilecek.
          </DialogDescription>
          <div className="preview-messages">
            {preview?.messages.map((m) => (
              <article key={m.id}>
                <span>
                  {m.name} &lt;{m.email}&gt; · {m.templateName}
                  {m.demo ? ' · Örnek veri' : ''}
                </span>
                <h3>{m.subject}</h3>
                <p>{m.body}</p>
              </article>
            ))}
          </div>
          {!preview?.canSend && (
            <p className="notice warning">
              Gerçek gönderim için SendGrid token ayarlı olmalı ve liste örnek
              kayıt içermemeli.
            </p>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <Button
            className="primary"
            disabled={busy || !preview?.canSend}
            onClick={() =>
              act(async () => {
                await request<{ queued: boolean; taskId: string }>('/send', {
                  previewId: preview?.id,
                  fromEmail: preview?.fromEmail,
                });
                setPreview(null);
                setChecked([]);
                setNotice(
                  'Email gönderimi kuyruğa alındı. Kuyruk & Performans ekranından takip edin.',
                );
              })
            }
          >
            <Send size={16} />
            {busy
              ? 'Gönderiliyor…'
              : `${preview?.messages.length ?? 0} emaili gönderim kuyruğuna ekle`}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

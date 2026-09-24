'use client';

import Image from 'next/image';
import { selectProfiles } from '@/lib/profile-list.mjs';
import { AuthShell, type AppUser } from '@/components/auth-shell';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  FileSpreadsheet,
  Camera as Instagram,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Play,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Users,
  X,
  Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ConnectionSettings } from '@/components/connection-settings';
import { TikTokConnection } from '@/components/tiktok-connection';
import { TeamWorkspace } from '@/components/team-workspace';
import { OutreachWorkspace } from '@/components/outreach-workspace';

type Profile = {
  username: string;
  platform?: string;
  fullName?: string;
  dmForCollaboration?: boolean;
  dmEvidence?: string | null;
  language?: string;
  languageEvidence?: string;
  gender?: string;
  genderEvidence?: string | null;
  email: string | null;
  followers: number | null;
  following: number | null;
  private: boolean | null;
  bio: string | null;
  bioSource?: string;
  bioLink?: string | null;
  searchEvidence?: { text: string; source: string; url: string };
  reused?: boolean;
  collectedAt?: string;
  error?: string | null;
  aiError?: string | null;
  note?: string | null;
  ai: { verdict: string; reason: string; model?: string } | null;
  photoUrl?: string | null;
};
type ExcludedCandidate = {
  username: string;
  fullName: string | null;
  photoUrl: string | null;
  reason: string;
  source?:
    | 'title'
    | 'private'
    | 'fame'
    | 'min'
    | 'ai-person'
    | 'ai-gender'
    | 'previously-rejected';
};
const excludedFilterLabels: Record<string, string> = {
  title: 'Unvan öneki',
  private: 'Kilitli hesap',
  fame: 'Çok takipçili',
  min: 'Az takipçili',
  'ai-person': 'Gerçek kişi değil (AI)',
  'ai-gender': 'Cinsiyet (AI)',
  'previously-rejected': 'Daha önce uygun değil',
};
type Job = {
  id: string;
  sources: string[];
  discoveredUsers?: string[];
  excludedCandidates?: Record<string, ExcludedCandidate>;
  platform?: string;
  mode: string;
  market?: string;
  ownerId?: string;
  ownerName?: string;
  status: string;
  message: string;
  rows: Profile[];
  done: number;
  total: number;
  warnings: string[];
  createdAt: string;
  restrictionNotification?: { status: string; message?: string };
  demo?: boolean;
};
type Summary = Omit<Job, 'rows'> & { count: number };
type Status = {
  loggedIn: boolean;
  browserOpen: boolean;
  tiktokBrowserOpen?: boolean;
  tiktokBridge?: { connected: boolean; paired: boolean };
  networkOrigin?: string | null;
  models: string[];
  activeJob: string | null;
  queuedCount?: number;
  openaiConfigured?: boolean;
  openaiModel?: string;
  restrictedUntil?: number;
  restrictionActive?: boolean;
};
const num = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('tr-TR');
// Instagram's own CDN URLs expire and can reject cross-origin browser
// requests; proxying through our server (see /api/photo) fetches and caches
// them server-side instead, so the avatar doesn't show a broken-image icon.
const photoProxy = (url: string) => `/api/photo?u=${encodeURIComponent(url)}`;
const statusLabel: Record<string, string> = {
  queued: 'Kuyrukta bekliyor',
  running: 'Devam ediyor',
  stopping: 'Durduruluyor',
  completed: 'Tamamlandı',
  partial: 'Notlarla tamamlandı',
  blocked: 'Oturum kontrolü gerekli',
  failed: 'Tamamlanamadı',
  cancelled: 'Durduruldu',
  interrupted: 'Yarıda kaldı',
};
async function api<T = { ok: boolean }>(
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  if (!response.ok) {
    const b = await response
      .json()
      .catch(() => ({ error: 'Yerel servis yanıt vermiyor.' }));
    throw new Error((b as { error: string }).error);
  }
  return response.json() as Promise<T>;
}
function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(v)}
      items={options}
    >
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem value={o.value} key={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Home() {
  return (
    <AuthShell>
      {(user, controls) => (
        <Workspace key={user.id} user={user} userControls={controls} />
      )}
    </AuthShell>
  );
}
function Workspace({
  user,
  userControls,
}: {
  user: AppUser;
  userControls: ReactNode;
}) {
  const [status, setStatus] = useState<Status>({
    loggedIn: false,
    browserOpen: false,
    models: [],
    activeJob: null,
  });
  const [connected, setConnected] = useState(false);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('manual');
  const [text, setText] = useState('');
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [keywords, setKeywords] = useState('');
  const [mode, setMode] = useState('following');
  const [market, setMarket] = useState('tr');
  const [limit, setLimit] = useState('5000');
  const [model, setModel] = useState('openai');
  const [workspace, setWorkspace] = useState('discover');
  const [chosen, setChosen] = useState<{ jobId: string; handles: string[] }>({
    jobId: '',
    handles: [],
  });
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [emailOnly, setEmailOnly] = useState(false);
  const [dmOnly, setDmOnly] = useState(false);
  const [publicOnly, setPublicOnly] = useState(false);
  const [minFollowers, setMinFollowers] = useState('');
  const [maxFollowers, setMaxFollowers] = useState('');
  const [sort, setSort] = useState('original');
  const [fit, setFit] = useState<Set<string>>(new Set());
  const toggleFit = (key: string) =>
    setFit((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [excludedFilters, setExcludedFilters] = useState<Set<string>>(
    new Set(),
  );
  const [paging, setPaging] = useState({ key: '', page: 1 });
  const [pageSize, setPageSize] = useState(25);
  const [detail, setDetail] = useState<Profile | null>(null);
  const [analyzedBatch, setAnalyzedBatch] = useState<string[]>([]);
  const [aiReport, setAiReport] = useState<{
    total: number;
    breakdown: { verdict: string; count: number; example: string | null }[];
    failed: number;
  } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!aiReport) return;
    const timer = setTimeout(() => setAiReport(null), 12000);
    return () => clearTimeout(timer);
  }, [aiReport]);
  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        api<Status>('/status'),
        api<Summary[]>('/jobs'),
      ]);
      setStatus(s);
      setSummaries(list);
      setConnected(true);
      if (!selected && list.length) setSelected(list[0].id);
    } catch {
      setConnected(false);
    }
  }, [selected]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let current = true;
    const load = async () => {
      try {
        const data = await api<Job>(`/jobs/${selected}`);
        if (current) setJob(data);
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [selected]);
  const rows = useMemo(() => job?.rows ?? [], [job]);
  const verdictCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = r.ai?.verdict ?? 'Değerlendirilmedi';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rows]);
  const excluded = useMemo(() => {
    const entries = Object.values(job?.excludedCandidates ?? {});
    const counts: Record<string, number> = {};
    for (const c of entries)
      counts[c.source ?? 'other'] = (counts[c.source ?? 'other'] ?? 0) + 1;
    return { entries, counts };
  }, [job]);
  const visibleExcluded =
    excludedFilters.size === 0
      ? excluded.entries
      : excluded.entries.filter((c) =>
          excludedFilters.has(c.source ?? 'other'),
        );
  const toggleExcludedFilter = (key: string) =>
    setExcludedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  useEffect(() => {
    if (!job || !analyzedBatch.length) return;
    // Deferred like the status-polling refresh() above, so the derived
    // setState calls don't run synchronously inside the effect body.
    const timer = setTimeout(() => {
      if (job.message === 'AI değerlendirmesi tamamlandı.') {
        const batch = job.rows.filter((r) =>
          analyzedBatch.includes(r.username),
        );
        const groups = new Map<
          string,
          { count: number; example: string | null }
        >();
        let failed = 0;
        for (const r of batch) {
          if (!r.ai) {
            failed++;
            continue;
          }
          const g = groups.get(r.ai.verdict) ?? { count: 0, example: null };
          g.count++;
          if (!g.example) g.example = r.ai.reason;
          groups.set(r.ai.verdict, g);
        }
        setAiReport({
          total: batch.length,
          failed,
          breakdown: [...groups.entries()].map(([verdict, g]) => ({
            verdict,
            ...g,
          })),
        });
        setAnalyzedBatch([]);
      } else if (['failed', 'cancelled'].includes(job.status)) {
        setAnalyzedBatch([]);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [job, analyzedBatch]);
  const filters = useMemo(
    () => ({
      q: search,
      emailOnly,
      dmOnly,
      publicOnly,
      minFollowers,
      maxFollowers,
      sort,
      fit: [...fit],
    }),
    [
      search,
      emailOnly,
      dmOnly,
      publicOnly,
      minFollowers,
      maxFollowers,
      sort,
      fit,
    ],
  );
  const filtered = useMemo(
    () => selectProfiles(rows, filters),
    [rows, filters],
  );
  const filterKey = JSON.stringify({ ...filters, selected });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (update: (p: number) => number) =>
    setPaging({ key: filterKey, page: update(page) });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const running = job?.status === 'running' || job?.status === 'stopping';
  const execute = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const start = () =>
    execute('start', async () => {
      const j = await api<Job>('/jobs', {
        text: mode === 'search' ? keywords : tab === 'csv' ? csv : text,
        platform,
        csv: mode !== 'search' && tab === 'csv',
        mode,
        market,
        limit: Number(limit),
        model: null,
      });
      setJob(j);
      setSelected(j.id);
      setNotice(
        'İş kuyruğa eklendi. Sıranızı Kuyruk & Performans ekranından takip edebilirsiniz.',
      );
    });
  const download = async (format: string) =>
    execute('export', async () => {
      const response = await fetch(`/api/jobs/${job?.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, filters }),
      });
      if (!response.ok)
        throw new Error(((await response.json()) as { error: string }).error);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `hiwell-affiliate${job?.demo ? '-ornek' : ''}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const readCsv = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2_000_000) throw new Error('CSV en fazla 2 MB olabilir.');
      const content = await file.text();
      await api('/parse', { text: content, csv: true, platform });
      setCsv(content);
      setFilename(file.name);
    } catch (e) {
      setCsv('');
      setFilename('');
      setError((e as Error).message);
    }
  };
  const picked = chosen.jobId === job?.id ? chosen.handles : [];
  const pick = (handles: string[]) =>
    setChosen({ jobId: job?.id ?? '', handles: [...new Set(handles)] });
  const analyze = (handles: string[]) => {
    if (model === 'openai' && !status.openaiConfigured) {
      setSettings(true);
      return;
    }
    return execute('analyze', async () => {
      setAiReport(null);
      await api(`/jobs/${job?.id}/analyze`, {
        provider: model === 'openai' ? 'openai' : 'ollama',
        model,
        usernames: handles,
      });
      setAnalyzedBatch(handles);
    });
  };
  const rescreenExcluded = () =>
    execute('rescreen', async () => {
      await api(`/jobs/${job?.id}/rescreen-excluded`, {});
      setNotice(
        'Elenen adaylar yeniden taranıyor; İş günlüğü sekmesinden takip edebilirsiniz.',
      );
    });
  const restoreExcluded = (username: string) =>
    execute('restore-' + username, async () => {
      await api(`/jobs/${job?.id}/restore-excluded`, { username });
      setNotice(
        `@${username} listeye eklendi; "Devam et" ile taramayı sürdürünce ziyaret edilecek.`,
      );
    });
  const markNotSuitable = (username: string) =>
    execute('not-suitable-' + username, async () => {
      await api(`/jobs/${job?.id}/mark-verdict`, {
        usernames: [username],
        verdict: 'Uygun değil',
      });
    });
  const markSelectedSuitable = () =>
    execute('mark-suitable', async () => {
      const result = await api<{ marked: number }>(
        `/jobs/${job?.id}/mark-verdict`,
        { usernames: picked, verdict: 'Uygun aday' },
      );
      setNotice(`${result.marked} profil "Uygun aday" olarak işaretlendi.`);
    });
  const addToEmail = () =>
    execute('addEmail', async () => {
      const result = await api<{ added: number; skipped: string[] }>(
        '/outreach/add',
        { jobId: job?.id, usernames: picked },
      );
      setNotice(
        `${result.added} kişi iletişim listesine eklendi. ${result.skipped.length} kayıt atlandı.${result.skipped.length ? ' ' + result.skipped.slice(0, 5).join(' ') : ''}`,
      );
    });
  const stats = [
    {
      label: 'İncelenen hesap',
      value: rows.length,
      icon: Users,
      sub: 'Bu taramadaki profiller',
    },
    {
      label: 'Email bulunan',
      value: rows.filter((r) => r.email).length,
      icon: Mail,
      sub: 'Bio içinde paylaşılan adresler',
    },
    {
      label: 'Açık hesap',
      value: rows.filter((r) => r.private === false).length,
      icon: LockKeyhole,
      sub: 'Hesap durumu doğrulanan',
    },
    {
      label: 'Uygun aday',
      value: rows.filter((r) => r.ai?.verdict === 'Uygun aday').length,
      icon: Sparkles,
      sub: 'AI ön değerlendirmesine göre',
    },
  ];
  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">
          <Image
            unoptimized
            className="brand-logo"
            src="/hiwell-logo.jpg"
            alt="Hiwell"
            width={778}
            height={328}
          />
        </span>
        <div className="brand-divider" />
        <span className="product-name">Partner Studio</span>
        <div className="topbar-right">
          {userControls}
          <span className="local-badge">
            <span />
            Yerel çalışma alanı
          </span>
          <Button
            variant="outline"
            className="secondary"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={16} />
            Bağlantılar
          </Button>
        </div>
      </header>
      <main className="workspace">
        <div className="breadcrumb">
          Çalışma alanı <span>/</span> <strong>Partner keşfi</strong>
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">HIWELL AFFILIATE MARKETING</div>
            <h1>
              Doğru iş birliklerini keşfedin<span>.</span>
            </h1>
            <p>
              Instagram ve TikTok profillerini inceleyin, adayları filtreleyin
              ve listenizi oluşturun.
            </p>
          </div>
          <Button
            variant="ghost"
            className="help-button"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={17} />
            Nasıl çalışır?
          </Button>
        </div>
        <Tabs
          value={workspace}
          onValueChange={(v) => setWorkspace(String(v))}
          className="workspace-tabs"
        >
          <TabsList variant="line">
            <TabsTrigger value="discover">Partner keşfi</TabsTrigger>
            <TabsTrigger value="email">Email & DM listesi</TabsTrigger>
            <TabsTrigger value="templates">Şablonlar</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="team">
              İş günlüğü ({status.queuedCount || 0})
            </TabsTrigger>
          </TabsList>
          {notice && (
            <output className="notice success">
              {notice}
              <button
                aria-label="Bildirimi kapat"
                onClick={() => setNotice('')}
              >
                <X size={16} />
              </button>
            </output>
          )}
          {aiReport && (
            <div className="notice success ai-report" role="alert">
              <div>
                <strong>
                  Uygunluk değerlendirmesi tamamlandı · {aiReport.total} profil
                </strong>
                <ul>
                  {aiReport.breakdown.map((b) => (
                    <li key={b.verdict}>
                      <strong>
                        {b.count} {b.verdict}
                      </strong>
                      {b.example && <span> — örnek: “{b.example}”</span>}
                    </li>
                  ))}
                  {aiReport.failed > 0 && (
                    <li>
                      <strong>{aiReport.failed} AI hatası</strong>
                      <span> — bu profiller değerlendirilemedi.</span>
                    </li>
                  )}
                </ul>
              </div>
              <button
                aria-label="Raporu kapat"
                onClick={() => setAiReport(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <TabsContent value="team">
            <TeamWorkspace user={user} view="log" />
          </TabsContent>
          <TabsContent value="dashboard">
            <TeamWorkspace user={user} view="dashboard" />
          </TabsContent>
          <TabsContent value="discover">
            {!connected && (
              <output className="notice warning">
                Yerel servise bağlanılıyor. Bağlantı kurulmazsa uygulamayı{' '}
                <code>npm run dev</code> ile başlatın.
              </output>
            )}
            {error && (
              <div className="notice error" role="alert">
                <span>{error}</span>
                <button onClick={() => setError('')} aria-label="Uyarıyı kapat">
                  <X size={17} />
                </button>
              </div>
            )}
            <section className="setup-grid" aria-label="Yeni tarama">
              <div className="input-card panel">
                <div className="card-title">
                  <div className="section-icon">
                    <Instagram size={19} />
                  </div>
                  <h2>Yeni bir keşif başlatın</h2>
                  <span className="step">01 / KAYNAK</span>
                </div>
                <div className="field platform-field">
                  <span className="field-label">Platform</span>
                  <Choice
                    label="Platform"
                    value={platform}
                    onChange={(value) => {
                      setPlatform(value);
                      setMode('following');
                      setText('');
                      setCsv('');
                      setFilename('');
                      setTab('manual');
                    }}
                    options={[
                      { value: 'instagram', label: 'Instagram' },
                      { value: 'tiktok', label: 'TikTok' },
                    ]}
                  />
                </div>
                {platform === 'tiktok' && (
                  <div className="panel sender-panel">
                    <h3>TikTok profili aktar · Chrome eklentisi</h3>
                    <p>
                      Normal Chrome’da profili açın. Eklentiden indirdiğiniz
                      JSON dosyasını burada seçin. Ayrı TikTok girişi gerekmez.
                    </p>
                    <label htmlFor="tiktok-import">
                      Hiwell aktarım dosyası (.json)
                    </label>
                    <Input
                      id="tiktok-import"
                      type="file"
                      accept=".json,application/json"
                      disabled={!!busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void execute('tiktok-import', async () => {
                          if (file.size > 100000)
                            throw new Error(
                              'Aktarım dosyası en fazla 100 KB olabilir.',
                            );
                          const data = JSON.parse(await file.text());
                          const result = await api<{
                            job: Job;
                            reused: boolean;
                          }>('/tiktok/import', data);
                          setJob(result.job);
                          setSelected(result.job.id);
                          if (result.reused)
                            setError(
                              'Bu TikTok profili zaten kayıtlı; mevcut tarama açıldı.',
                            );
                        });
                      }}
                    />
                    <p className="field-hint">
                      İsteğe bağlı tek profil aktarımıdır. Toplu tarama için
                      Chrome agent’ı bağlayıp aşağıdan iş başlatın.
                    </p>
                  </div>
                )}
                {mode === 'search' ? (
                  <div className="field">
                    <label htmlFor="keywords">TikTok hesap araması</label>
                    <Textarea
                      id="keywords"
                      className="account-input"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder={'psikolog\nwellness\nyoga'}
                    />
                    <p className="field-hint">
                      Her satıra bir anahtar kelime veya ifade yazın. En fazla
                      20 arama.
                    </p>
                  </div>
                ) : (
                  <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                    <TabsList variant="line" className="source-tabs">
                      <TabsTrigger value="manual">
                        Kullanıcı adı ekle
                      </TabsTrigger>
                      <TabsTrigger value="csv">
                        <FileSpreadsheet />
                        CSV yükle
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="manual">
                      <label className="sr-only" htmlFor="accounts">
                        Kaynak hesaplar
                      </label>
                      <Textarea
                        id="accounts"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={
                          platform === 'tiktok'
                            ? '@kullaniciadi\ntiktok.com/@kullaniciadi'
                            : '@kullaniciadi\ninstagram.com/kullaniciadi'
                        }
                        className="account-input"
                      />
                      <p className="field-hint">
                        Birden fazla hesabı yeni satır veya virgülle ayırın.
                      </p>
                    </TabsContent>
                    <TabsContent value="csv">
                      <label className="upload-zone">
                        <FileSpreadsheet size={25} />
                        <strong>
                          {filename ||
                            'CSV dosyanızı seçin veya buraya bırakın'}
                        </strong>
                        <span>username veya url sütunu · En fazla 2 MB</span>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          onChange={(e) => void readCsv(e.target.files?.[0])}
                        />
                      </label>
                      <a
                        className="template-link"
                        href="/ornek-kullanicilar.csv"
                        download
                      >
                        Örnek CSV şablonunu indir <ArrowDownToLine size={13} />
                      </a>
                    </TabsContent>
                  </Tabs>
                )}
                <div className="scan-controls">
                  <div className="field grow">
                    <span className="field-label">Tarama türü</span>
                    <Choice
                      label="Tarama türü"
                      value={mode}
                      onChange={setMode}
                      options={
                        platform === 'tiktok'
                          ? [
                              {
                                value: 'following',
                                label: 'Takip ettikleri hesapları incele',
                              },
                              {
                                value: 'search',
                                label: 'Anahtar kelimeyle hesap ara',
                              },
                              {
                                value: 'profiles',
                                label: 'Girilen hesapları doğrudan incele',
                              },
                            ]
                          : [
                              {
                                value: 'following',
                                label: 'Takip ettikleri hesapları incele',
                              },
                              {
                                value: 'profiles',
                                label: 'Girilen hesapları doğrudan incele',
                              },
                            ]
                      }
                    />
                  </div>
                  <div className="field grow">
                    <span className="field-label">Hedef pazar</span>
                    <Choice
                      label="Hedef pazar"
                      value={market}
                      onChange={setMarket}
                      options={[
                        { value: 'tr', label: 'Türkiye' },
                        { value: 'other', label: 'Türkiye dışı (AB vb.)' },
                      ]}
                    />
                    <p className="field-hint">
                      Ünvan öneki eleme (dr, av, prof vb.) yalnızca Türkiye
                      pazarında uygulanır.
                    </p>
                  </div>
                  <div className="field limit-field">
                    <label htmlFor="limit">Kaynak başına sınır</label>
                    <Input
                      id="limit"
                      type="number"
                      min={1}
                      max={5000}
                      value={limit}
                      disabled={mode === 'profiles'}
                      onChange={(e) => setLimit(e.target.value)}
                    />
                  </div>
                  <Button
                    className="primary scan-button"
                    disabled={
                      !!busy ||
                      !connected ||
                      !(
                        mode === 'search'
                          ? keywords
                          : tab === 'csv'
                            ? csv
                            : text
                      ).trim()
                    }
                    onClick={start}
                  >
                    {busy === 'start' ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <Play size={15} />
                    )}
                    Taramayı kuyruğa ekle
                  </Button>
                </div>
              </div>
              <aside className="campaign-card">
                <div className="campaign-top">
                  <span className="campaign-label">
                    <Sparkles size={15} />
                    AKILLI ÖN DEĞERLENDİRME
                  </span>
                  <span className="mini-label">HIWELL</span>
                </div>
                <h2>
                  Bir sonraki
                  <br />
                  iyi iş birliğiniz.
                </h2>
                <p>
                  Açık profil bilgilerini, Hiwell kampanyası için anlamlı bir
                  aday listesine dönüştürün.
                </p>
                <div className="campaign-bottom">
                  <span>
                    <span
                      className={`connection-dot ${status.models.length ? 'online' : ''}`}
                    />
                    {model === 'openai'
                      ? status.openaiConfigured
                        ? 'OpenAI hazır'
                        : 'OpenAI anahtarı gerekli'
                      : 'Yerel AI seçili'}
                  </span>
                  <button
                    onClick={() => setSettings(true)}
                    aria-label="AI bağlantısını ayarla"
                  >
                    <ArrowUpRight size={20} />
                  </button>
                </div>
              </aside>
            </section>
            {platform === 'tiktok' ? (
              <div className="session-strip">
                <span>
                  TikTok ·{' '}
                  {status.tiktokBridge?.connected
                    ? 'Chrome agent bağlı'
                    : 'Chrome agent bağlı değil; ana bilgisayarda eklentinin Agent ekranını açın'}
                </span>
                <Button variant="ghost" onClick={() => setSettings(true)}>
                  Eklenti bağlantısı
                </Button>
              </div>
            ) : (
              <div className="session-strip">
                <span>
                  <span
                    className={`connection-dot ${status.loggedIn ? 'online' : ''}`}
                  />
                  {status.loggedIn
                    ? 'Instagram oturumu bağlı'
                    : status.browserOpen
                      ? 'Instagram penceresinde girişinizi tamamlayın'
                      : 'Instagram oturumu gerekli'}
                </span>
                {!status.loggedIn && (
                  <button
                    disabled={!!busy || !!status.activeJob}
                    onClick={() =>
                      execute('login', async () => {
                        await api('/login', {});
                      })
                    }
                  >
                    {busy === 'login'
                      ? 'Pencere açılıyor…'
                      : 'Instagram’a bağlan'}
                    <ArrowRight size={14} />
                  </button>
                )}
                <span className="session-note">
                  Sonuçlar bu bilgisayarda saklanır.
                </span>
              </div>
            )}
            <section className="stats-grid" aria-label="Tarama özeti">
              {stats.map(({ label, value, icon: Icon, sub }) => (
                <div className="stat" key={label}>
                  <div className="stat-label">
                    {label}
                    <Icon size={17} />
                  </div>
                  <div className="stat-value">
                    {num(value)}
                    <span>{label === 'Uygun aday' ? 'aday' : 'hesap'}</span>
                  </div>
                  <p>{sub}</p>
                </div>
              ))}
            </section>
            <section className="results panel">
              <div className="results-heading">
                <div>
                  <h2>
                    Keşfedilen profiller{' '}
                    <span className="count-badge">{filtered.length}</span>
                  </h2>
                  <p>
                    {job?.demo
                      ? 'Örnek veri · Gerçek hesap veya gerçek iş birliği değerlendirmesi içermez.'
                      : 'Kampanyanız için potansiyel iş ortakları.'}
                  </p>
                </div>
                <div className="export-buttons">
                  {!!job?.discoveredUsers?.length && (
                    <a
                      className="template-link"
                      href={'/api/jobs/' + job.id + '/usernames'}
                      download
                    >
                      Kullanıcı adları CSV ({job.discoveredUsers.length})
                    </a>
                  )}
                  <Button
                    variant="outline"
                    className="secondary"
                    disabled={!rows.length || !!busy}
                    onClick={() => download('csv')}
                  >
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    className="secondary"
                    disabled={!rows.length || !!busy}
                    onClick={() => download('xlsx')}
                  >
                    <ArrowDownToLine size={16} />
                    Excel indir
                  </Button>
                </div>
              </div>
              <div className="filters">
                <div className="search-field">
                  <Search size={17} />
                  <Input
                    aria-label="Profillerde ara"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Kullanıcı, email veya bio ara"
                  />
                </div>
                <div className="filter-divider" />
                <label className="check-label" htmlFor="email-only">
                  <Checkbox
                    id="email-only"
                    checked={emailOnly}
                    onCheckedChange={(v) => {
                      setEmailOnly(v);
                      if (v) setDmOnly(false);
                    }}
                  />
                  Email bulunanlar
                </label>
                <label className="check-label" htmlFor="dm-only">
                  <Checkbox
                    id="dm-only"
                    checked={dmOnly}
                    onCheckedChange={(v) => {
                      setDmOnly(v);
                      if (v) setEmailOnly(false);
                    }}
                  />
                  DM ile iş birliği
                </label>
                <label className="check-label" htmlFor="public-only">
                  <Checkbox
                    id="public-only"
                    checked={publicOnly}
                    onCheckedChange={setPublicOnly}
                  />
                  Yalnızca açık hesaplar
                </label>
                <div className="min-followers">
                  <Users size={16} />
                  <Input
                    aria-label="En az takipçi sayısı"
                    type="number"
                    min="0"
                    placeholder="Min. takipçi"
                    value={minFollowers}
                    onChange={(e) => setMinFollowers(e.target.value)}
                  />
                </div>
                <div className="min-followers">
                  <Input
                    aria-label="En fazla takipçi sayısı"
                    type="number"
                    min="0"
                    placeholder="Maks. takipçi"
                    value={maxFollowers}
                    onChange={(e) => setMaxFollowers(e.target.value)}
                  />
                </div>
                <Choice
                  label="Partner sıralaması"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'original', label: 'Tarama sırası' },
                    { value: 'followers:desc', label: 'Takipçi: çoktan aza' },
                    { value: 'followers:asc', label: 'Takipçi: azdan çoğa' },
                    {
                      value: 'following:desc',
                      label: 'Takip edilen: çoktan aza',
                    },
                    {
                      value: 'following:asc',
                      label: 'Takip edilen: azdan çoğa',
                    },
                    { value: 'username:asc', label: 'Kullanıcı adı: A–Z' },
                    { value: 'username:desc', label: 'Kullanıcı adı: Z–A' },
                    { value: 'collectedAt:desc', label: 'En yeni kayıtlar' },
                    { value: 'collectedAt:asc', label: 'En eski kayıtlar' },
                  ]}
                />
                {minFollowers !== '' &&
                  maxFollowers !== '' &&
                  Number(minFollowers) > Number(maxFollowers) && (
                    <span role="alert">
                      Minimum takipçi, maksimumdan büyük olamaz.
                    </span>
                  )}
                {!!rows.length && (
                  <div className="excluded-filters verdict-filters">
                    <button
                      className={fit.size === 0 ? 'active' : ''}
                      onClick={() => setFit(new Set())}
                    >
                      Tümü ({rows.length})
                    </button>
                    {[
                      ['Uygun aday', 'Uygun aday'],
                      ['İncelenmeli', 'İncelenmeli'],
                      ['Uygun değil', 'Uygun değil'],
                      ['Değerlendirilmedi', '__unassessed__'],
                    ].map(
                      ([label, value]) =>
                        !!verdictCounts[label] && (
                          <button
                            key={value}
                            className={fit.has(value) ? 'active' : ''}
                            onClick={() => toggleFit(value)}
                          >
                            {label} ({verdictCounts[label]})
                          </button>
                        ),
                    )}
                  </div>
                )}
                {(search ||
                  emailOnly ||
                  dmOnly ||
                  publicOnly ||
                  minFollowers ||
                  maxFollowers ||
                  sort !== 'original' ||
                  fit.size > 0) && (
                  <button
                    className="reset-filter"
                    aria-label="Filtreleri temizle"
                    onClick={() => {
                      setSearch('');
                      setEmailOnly(false);
                      setDmOnly(false);
                      setPublicOnly(false);
                      setMinFollowers('');
                      setMaxFollowers('');
                      setSort('original');
                      setFit(new Set());
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {job && (
                <div className="job-progress" aria-live="polite">
                  <div>
                    <span className={`job-state ${running ? 'active' : ''}`}>
                      {running && <LoaderCircle size={14} className="spin" />}
                      {statusLabel[job.status] || job.status}
                    </span>
                    <span>{job.message}</span>
                    {job.warnings
                      .filter(
                        (w) =>
                          w.includes('takipçisi var') ||
                          w.includes('hesap takip ediyor') ||
                          w.includes('5.000 farklı'),
                      )
                      .map((w, i) => (
                        <span key={i} className="notice warning" role="alert">
                          {w}
                        </span>
                      ))}
                    {job.restrictionNotification && (
                      <span className="row-warning">
                        {job.restrictionNotification.status === 'sending'
                          ? 'Kısıt emaili gönderiliyor…'
                          : job.restrictionNotification.message}
                      </span>
                    )}
                    {running &&
                      (user.role === 'admin' || job.ownerId === user.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={job.status === 'stopping'}
                          onClick={() =>
                            execute('stop', async () => {
                              await api(`/jobs/${job.id}/stop`, {});
                            })
                          }
                        >
                          <Square size={12} />
                          Durdur
                        </Button>
                      )}
                  </div>
                  {running && (
                    <Progress
                      value={job.total ? (job.done / job.total) * 100 : 0}
                      className="h-1 mt-3"
                    />
                  )}
                </div>
              )}
              <div className="bulk-toolbar profile-bulk">
                <span>{picked.length} profil seçili</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pick(filtered.map((r) => r.username))}
                  disabled={!filtered.length}
                >
                  Tüm filtrelenenleri seç
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => pick([])}
                  disabled={!picked.length}
                >
                  Seçimi temizle
                </Button>
                <Button
                  variant="outline"
                  disabled={!picked.length || !!busy}
                  onClick={addToEmail}
                >
                  <Mail size={15} />
                  İletişim listesine ekle
                </Button>
                <Button
                  className="primary"
                  disabled={!picked.length || !!busy || job?.demo}
                  onClick={() => analyze(picked)}
                >
                  <Sparkles size={15} />
                  Seçilenlerin uygunluğunu değerlendir
                </Button>
                <Button
                  variant="outline"
                  disabled={!picked.length || !!busy}
                  onClick={markSelectedSuitable}
                >
                  <Check size={15} />
                  Seçilenleri uygun aday olarak işaretle
                </Button>
              </div>
              <Table className="profile-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Checkbox
                        aria-label="Bu sayfadaki profilleri seç"
                        checked={
                          visible.length > 0 &&
                          visible.every((r) => picked.includes(r.username))
                        }
                        onCheckedChange={(v) =>
                          pick(
                            v
                              ? [...picked, ...visible.map((r) => r.username)]
                              : picked.filter(
                                  (u) => !visible.some((r) => r.username === u),
                                ),
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>Kullanıcı adı</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="numeric">Takipçi</TableHead>
                    <TableHead className="numeric">Takip edilen</TableHead>
                    <TableHead>Hesap durumu</TableHead>
                    <TableHead>Bio dili</TableHead>
                    <TableHead>Cinsiyet beyanı</TableHead>
                    <TableHead>Bio tam metin</TableHead>
                    <TableHead>
                      <span className="ai-column">
                        <Sparkles size={14} />
                        İş birliği değerlendirmesi
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => (
                    <TableRow key={r.username}>
                      <TableCell>
                        <Checkbox
                          aria-label={`${r.username} profilini seç`}
                          checked={picked.includes(r.username)}
                          onCheckedChange={(v) =>
                            pick(
                              v
                                ? [...picked, r.username]
                                : picked.filter((u) => u !== r.username),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <a
                          className="profile-link"
                          href={
                            r.platform === 'tiktok'
                              ? `https://www.tiktok.com/@${r.username}`
                              : `https://www.instagram.com/${r.username}/`
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.photoUrl ? (
                            <Image
                              src={photoProxy(r.photoUrl)}
                              alt={r.username}
                              width={34}
                              height={34}
                              unoptimized
                              referrerPolicy="no-referrer"
                              className="avatar-photo"
                            />
                          ) : (
                            <span className="avatar">
                              {r.username.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                          <span>
                            <strong>{r.username}</strong>
                            <small>
                              {r.platform === 'tiktok' ? 'TikTok' : 'Instagram'}{' '}
                              · {r.fullName || 'Profil'}
                            </small>
                          </span>
                          <ArrowUpRight size={13} />
                        </a>
                      </TableCell>
                      <TableCell>
                        {r.email ? (
                          <span className="email-value">{r.email}</span>
                        ) : (
                          <span className="null-value">null</span>
                        )}
                        {r.reused && (
                          <small className="signal-note">
                            Kayıttan ·{' '}
                            {r.collectedAt
                              ? new Date(r.collectedAt).toLocaleDateString(
                                  'tr-TR',
                                )
                              : 'Önceki tarama'}
                          </small>
                        )}
                        {r.dmForCollaboration && (
                          <span className="dm-badge" title={r.dmEvidence ?? ''}>
                            İş birliği için DM
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="numeric number">
                        {num(r.followers)}
                      </TableCell>
                      <TableCell className="numeric number">
                        {num(r.following)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`account-state ${r.private === false ? 'public' : ''}`}
                        >
                          {r.private === false ? (
                            <span className="tiny-dot" />
                          ) : (
                            <LockKeyhole size={12} />
                          )}{' '}
                          {r.private === null
                            ? 'Bilinmiyor'
                            : r.private
                              ? 'Kilitli'
                              : 'Açık'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span title={r.languageEvidence}>
                          {r.language || 'Bilinmiyor'}
                        </span>
                        <small className="signal-note">Bio metnine göre</small>
                      </TableCell>
                      <TableCell>
                        <span
                          title={
                            r.genderEvidence ||
                            'Profilde açık beyan bulunamadı.'
                          }
                        >
                          {r.gender || 'Bilinmiyor'}
                        </span>
                        <small className="signal-note">
                          Yalnızca açık beyan
                        </small>
                      </TableCell>
                      <TableCell>
                        <button
                          className="bio-preview"
                          onClick={() => setDetail(r)}
                        >
                          {r.bio ?? 'Bio okunamadı'}
                          <span>
                            Tam metni gör <ArrowUpRight size={11} />
                          </span>
                        </button>
                        {r.bioSource && (
                          <small className="signal-note">{r.bioSource}</small>
                        )}
                        {r.bioLink && (
                          <a href={r.bioLink} target="_blank" rel="noreferrer">
                            Bio bağlantısı
                          </a>
                        )}
                        {r.searchEvidence && (
                          <details>
                            <summary>Google özeti (doğrulanmadı)</summary>
                            <p>{r.searchEvidence.text}</p>
                          </details>
                        )}
                        {r.error && (
                          <span className="row-warning">Eksik veri</span>
                        )}
                        {r.note && (
                          <span className="row-note" title={r.note}>
                            {r.note}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.ai ? (
                          <button
                            className="ai-preview"
                            onClick={() => setDetail(r)}
                          >
                            <span
                              className={`verdict ${r.ai.verdict === 'Uygun aday' ? 'yes' : r.ai.verdict === 'Uygun değil' ? 'no' : 'review'}`}
                            >
                              {r.ai.verdict === 'Uygun aday' && (
                                <Check size={12} />
                              )}{' '}
                              {r.ai.verdict}
                            </span>
                            <p>{r.ai.reason}</p>
                          </button>
                        ) : (
                          <span className="unassessed">
                            {r.aiError
                              ? 'AI bağlantısı başarısız'
                              : 'Değerlendirilmedi'}
                          </span>
                        )}
                        {r.ai?.verdict === 'İncelenmeli' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="single-ai"
                            disabled={!!busy || job?.demo}
                            onClick={() => markNotSuitable(r.username)}
                          >
                            <X size={13} />
                            Uygun değil olarak işaretle
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="single-ai"
                          disabled={!!busy || job?.demo}
                          onClick={() => analyze([r.username])}
                        >
                          <Sparkles size={13} />
                          Uygunluğu değerlendir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!visible.length && (
                <div className="empty-state">
                  <div className="empty-icon">
                    {rows.length ? (
                      <SlidersHorizontal size={27} />
                    ) : (
                      <Users size={28} />
                    )}
                  </div>
                  <h3>
                    {rows.length
                      ? 'Bu filtrelere uygun profil bulunamadı'
                      : 'İlk aday listeniz burada başlayacak'}
                  </h3>
                  <p>
                    {rows.length
                      ? 'Filtreleri genişleterek daha fazla profil görüntüleyin.'
                      : 'Platform seçip hesap ekleyin, TikTok’ta arama yapın veya CSV yükleyin.'}
                  </p>
                  {!rows.length && !running && (
                    <button
                      disabled={!!busy || !!status.activeJob}
                      onClick={() =>
                        execute('demo', async () => {
                          const j = await api<Job>('/demo', {});
                          setJob(j);
                          setSelected(j.id);
                        })
                      }
                    >
                      Örnek sonuçları keşfet <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              )}
              <div className="table-footer">
                <span>
                  {filtered.length
                    ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filtered.length)} / ${filtered.length} profil`
                    : '0 profil'}
                  <span className="footer-dot">·</span>İndirmeye tüm
                  filtrelenmiş sonuçlar dahil edilir
                </span>
                <div className="pagination">
                  <label className="page-size">
                    Sayfada
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
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
                    onClick={() => setPage((p) => p - 1)}
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
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Sonraki
                  </Button>
                </div>
              </div>
            </section>
            <div className="bottom-row">
              <div className="history">
                <span>Tarama geçmişi</span>
                <Choice
                  label="Tarama geçmişi"
                  value={selected}
                  onChange={(v) => {
                    setSelected(v);
                    setJob(null);
                  }}
                  options={
                    summaries.length
                      ? summaries.map((s) => ({
                          value: s.id,
                          label: `${s.platform === 'tiktok' ? 'TikTok · ' : 'Instagram · '}${s.demo ? 'Örnek · ' : ''}${s.sources
                            .slice(0, 2)
                            .map((x) => '@' + x)
                            .join(
                              ', ',
                            )} · ${new Date(s.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
                        }))
                      : [{ value: '', label: 'Henüz tarama yok' }]
                  }
                />
              </div>
              {job && rows.length > 0 && (
                <Button
                  variant="ghost"
                  disabled={!filtered.length || !!busy || job.demo}
                  onClick={() => analyze(filtered.map((r) => r.username))}
                >
                  <Sparkles size={15} />
                  Filtrelenenlerin uygunluğunu değerlendir ({filtered.length})
                </Button>
              )}
            </div>
            {job && job.warnings.length > 0 && (
              <details className="scan-notes">
                <summary>Tarama notları ({job.warnings.length})</summary>
                {job.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            {job && !!Object.keys(job.excludedCandidates ?? {}).length && (
              <details className="excluded-candidates">
                <summary>
                  Elenen adaylar (
                  {Object.keys(job.excludedCandidates ?? {}).length})
                </summary>
                {(() => {
                  const aiExcludedCount =
                    (excluded.counts['ai-person'] ?? 0) +
                    (excluded.counts['ai-gender'] ?? 0);
                  return (
                    !!aiExcludedCount && (
                      <div className="excluded-actions">
                        <p className="field-hint">
                          AI tarafından “gerçek kişi/cinsiyet” kontrolünde
                          elenen {aiExcludedCount} aday var. Fotoğraf önceliği
                          düzeltmesinden sonra bunları Instagram’a tekrar
                          gitmeden, kayıtlı verilerle yeniden tarayabilirsiniz.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy || job.demo}
                          onClick={rescreenExcluded}
                        >
                          <Sparkles size={13} />
                          Elenenleri yeniden tara ({aiExcludedCount})
                        </Button>
                      </div>
                    )
                  );
                })()}
                <div className="excluded-filters">
                  <button
                    className={excludedFilters.size === 0 ? 'active' : ''}
                    onClick={() => setExcludedFilters(new Set())}
                  >
                    Tümü ({excluded.entries.length})
                  </button>
                  {Object.entries(excludedFilterLabels).map(
                    ([key, label]) =>
                      !!excluded.counts[key] && (
                        <button
                          key={key}
                          className={excludedFilters.has(key) ? 'active' : ''}
                          onClick={() => toggleExcludedFilter(key)}
                        >
                          {label} ({excluded.counts[key]})
                        </button>
                      ),
                  )}
                </div>
                {excludedFilters.size > 1 && (
                  <p className="field-hint">
                    Seçili {excludedFilters.size} sebepten{' '}
                    <strong>herhangi biriyle</strong> elenenler gösteriliyor.
                  </p>
                )}
                <ul>
                  {visibleExcluded.map((c) => (
                    <li key={c.username}>
                      {c.photoUrl ? (
                        <Image
                          src={photoProxy(c.photoUrl)}
                          alt={c.username}
                          width={28}
                          height={28}
                          unoptimized
                          referrerPolicy="no-referrer"
                          className="avatar-photo excluded-avatar"
                        />
                      ) : (
                        <span className="avatar excluded-avatar">
                          {c.username.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="excluded-name">
                        <a
                          href={`https://www.instagram.com/${c.username}/`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <strong>@{c.username}</strong>
                        </a>
                        {c.fullName && <small>{c.fullName}</small>}
                      </span>
                      <span className="excluded-reason">{c.reason}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!busy || job.demo}
                        onClick={() => restoreExcluded(c.username)}
                      >
                        Listeye ekle
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <footer className="workspace-footer">
              <span>
                hiwell <span> / </span> Partner Studio
              </span>
              <span>
                <Monitor size={13} />
                Local workspace
              </span>
            </footer>
          </TabsContent>
          <TabsContent value="email">
            <OutreachWorkspace
              view="email"
              onTemplates={() => setWorkspace('templates')}
            />
          </TabsContent>
          <TabsContent value="templates">
            <OutreachWorkspace
              view="templates"
              onTemplates={() => setWorkspace('templates')}
            />
          </TabsContent>
        </Tabs>
      </main>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="settings-dialog">
          <DialogTitle>Bağlantılar</DialogTitle>
          {status.networkOrigin && (
            <p className="notice success">
              Ortak ağ adresi:{' '}
              <a href={status.networkOrigin}>{status.networkOrigin}</a>.
              Instagram giriş penceresi ana bilgisayarda açılır.
            </p>
          )}
          {!!status.restrictedUntil && status.restrictionActive && (
            <p className="notice warning">
              Instagram kısıtı nedeniyle yeni taramalar{' '}
              {new Date(status.restrictedUntil).toLocaleString('tr-TR')}{' '}
              tarihine kadar bekletiliyor. Bu süre kısıtın kalktığı anlamına
              gelmez.
            </p>
          )}
          <DialogDescription>
            Instagram, OpenAI ve email gönderim bağlantılarınızı ayarlayın.
          </DialogDescription>
          <div className="settings-section">
            <h3>
              <Instagram size={18} />
              Instagram
            </h3>
            <p>
              Instagram oturumunu admin açar. Giriş, Instagram penceresinde
              yapılır. Oturum bu bilgisayarda saklanır. Doğrulama istenirse aynı
              pencerede tamamlayın.
            </p>
            <Button
              className="primary"
              disabled={user.role !== 'admin' || !!busy || !!status.activeJob}
              onClick={() =>
                execute('login', async () => {
                  await api('/login', {});
                })
              }
            >
              {busy === 'login' ? 'Açılıyor…' : 'Instagram penceresini aç'}
            </Button>
            <p className="connection-text">
              {status.loggedIn
                ? 'Oturum bağlı'
                : status.browserOpen
                  ? 'Giriş bekleniyor'
                  : 'Oturum bağlı değil'}
            </p>
          </div>
          {user.role === 'admin' ? (
            <>
              {' '}
              <TikTokConnection
                connected={!!status.tiktokBridge?.connected}
                paired={!!status.tiktokBridge?.paired}
              />
              <ConnectionSettings />{' '}
            </>
          ) : (
            <p className="field-hint">
              Bağlantı anahtarları yalnızca admin tarafından yönetilir.
            </p>
          )}
          <div className="settings-section">
            <h3>
              <Sparkles size={18} />
              Değerlendirme sağlayıcısı
            </h3>
            <p>
              OpenAI veya yüklü bir Ollama modeli seçin. Değerlendirme yalnızca
              değerlendirme düğmesine basınca çalışır.
            </p>
            <Choice
              label="AI sağlayıcısı ve modeli"
              value={model}
              onChange={setModel}
              options={[
                { value: 'openai', label: 'OpenAI (API key)' },
                ...status.models.map((m) => ({ value: m, label: m })),
              ]}
            />
            {model !== 'openai' && !status.models.length && (
              <p className="field-hint">
                Ollama çalışmıyor veya yüklü model yok. Ollama’yı başlatıp bir
                model kurduğunuzda burada görünür.
              </p>
            )}
            <p className="field-hint">
              Sonuçlar bir ön değerlendirmedir; kampanya onayı için insan
              incelemesi gerekir.
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="settings-dialog">
          <DialogTitle>Keşiften aday listesine</DialogTitle>
          <DialogDescription>Üç adımda tarama başlatın.</DialogDescription>
          <ol className="help-steps">
            <li>
              <strong>Instagram’a bağlanın</strong>
              <p>
                Bağlantılar bölümünden tarayıcıyı açın ve kendi hesabınızla
                giriş yapın.
              </p>
            </li>
            <li>
              <strong>Kaynakları ekleyin</strong>
              <p>
                Kullanıcı adlarını veya CSV’yi girin. Takip listelerini tarayın
                ya da girilen profilleri doğrudan inceleyin. Tekrarlanan
                hesaplar birleştirilir.
              </p>
            </li>
            <li>
              <strong>Filtreleyin ve indirin</strong>
              <p>
                Email, minimum takipçi, hesap durumu ve iş birliği
                değerlendirmesine göre daraltın. Excel (.xlsx) ve CSV,
                filtrelenmiş listenin tamamını içerir.
              </p>
            </li>
          </ol>
          <p className="field-hint">
            Yalnızca oturumunuzun erişebildiği bilgiler okunur. Instagram
            listeyi sınırlayabilir; eksik bilgiler ve kısmi taramalar açıkça
            işaretlenir. Kilitli hesapların içeriklerine erişim aşılmaz.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="profile-dialog">
          <DialogTitle>@{detail?.username}</DialogTitle>
          <DialogDescription>
            Bio ve kampanya ön değerlendirmesi
          </DialogDescription>
          <h3>Profil bilgileri</h3>
          <p className="full-bio">
            Dil: {detail?.language || 'Bilinmiyor'}
            <br />
            {detail?.languageEvidence}
            <br />
            Cinsiyet: {detail?.gender || 'Bilinmiyor'}
            <br />
            {detail?.genderEvidence || 'Açık beyan bulunamadı.'}
            {detail?.dmForCollaboration && (
              <>
                <br />
                İş birliği için DM: {detail.dmEvidence}
              </>
            )}
          </p>
          <h3>Bio tam metin</h3>
          <p className="full-bio">{detail?.bio ?? 'null'}</p>
          <h3>İş birliği değerlendirmesi</h3>
          <p className="full-bio">
            {detail?.ai
              ? `${detail.ai.verdict}: ${detail.ai.reason}`
              : 'Değerlendirilmedi'}
          </p>
          {detail?.ai?.model && (
            <p className="field-hint">Model: {detail.ai.model}</p>
          )}
          {(detail?.error || detail?.aiError) && (
            <p className="notice warning">
              {detail.error} {detail.aiError}
            </p>
          )}
          <a
            className="template-link"
            target="_blank"
            rel="noreferrer"
            href={
              detail?.platform === 'tiktok'
                ? `https://www.tiktok.com/@${detail?.username}`
                : `https://www.instagram.com/${detail?.username}/`
            }
          >
            Profili aç <ArrowUpRight size={14} />
          </a>
        </DialogContent>
      </Dialog>
    </div>
  );
}

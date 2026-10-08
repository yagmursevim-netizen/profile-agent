'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { AppUser } from './auth-shell';

type JobSummary = {
  id: string;
  sources: string[];
  mode: string;
  status: string;
  count: number;
  createdAt: string;
  platform?: string;
  demo?: boolean;
  market?: string;
  chainId?: string;
};
type ExportRow = {
  username: string;
  platform?: string;
  fullName?: string;
  email: string | null;
  followers: number | null;
  language?: string;
  ai: { verdict: string; reason: string } | null;
  sourceLabel: string;
  jobId?: string;
};
const rowKey = (r: ExportRow) => `${r.platform || 'instagram'}:${r.username.toLowerCase()}`;
// Mirrors server/domain.mjs's csvCell — same spreadsheet-formula-injection
// neutralization, since this file also produces a CSV a spreadsheet app
// will open directly.
const csvCell = (value: string | number | null | undefined) => {
  let s = value === null || value === undefined ? 'null' : String(value);
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};
type Task = {
  id: string;
  jobId?: string;
  ownerId: string;
  ownerName: string;
  kind: string;
  platform: string;
  platforms?: string[];
  title: string;
  status: string;
  position: number | null;
  remaining?: number;
  sourcesLeft?: number;
  canResume?: boolean;
  error?: string;
  createdAt: string;
};
type Metrics = {
  userId: string;
  name: string;
  platform: string;
  jobs: number;
  submittedAccounts: number;
  searchTerms: number;
  processed: number;
  fresh: number;
  cached: number;
  imported: number;
  profiles: number;
  emails: number;
  dm: number;
  links: number;
  errors: number;
  accepted: number;
  failed: number;
  unknown: number;
  sending: number;
  queuedEmails: number;
  statuses: Record<string, number>;
};
const labels: Record<string, string> = {
  queued: 'Bekliyor',
  running: 'Çalışıyor',
  stopping: 'Durduruluyor',
  completed: 'Tamamlandı',
  partial: 'Kısmi / eksik sonuç',
  cancelled: 'İptal',
  blocked: 'Kısıt / doğrulama',
  failed: 'Başarısız',
  interrupted: 'Yarıda kaldı',
};
const platformLabel = (p: string) =>
  p === 'tiktok'
    ? 'TikTok'
    : p === 'manual'
      ? 'Elle / CSV'
      : p === 'mixed'
        ? 'Email'
        : 'Instagram';

// Excel's AutoFilter, simplified: a column header opens a checkbox list of
// every distinct value in that column. `selected: null` means no filter is
// active (everything shown, every box checked) — the same state Excel
// starts a column in before you touch its dropdown.
function ColumnFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const active = selected ?? new Set(values);
  return (
    <details className="column-filter">
      <summary>
        {label}
        {selected && <span className="column-filter-count"> ({selected.size})</span>}
      </summary>
      <div className="column-filter-menu">
        <div className="column-filter-actions">
          <button type="button" onClick={() => onChange(null)}>
            Tümünü seç
          </button>
          <button type="button" onClick={() => onChange(new Set())}>
            Temizle
          </button>
        </div>
        {values.map((v) => (
          <label key={v} className="column-filter-option">
            <input
              type="checkbox"
              checked={active.has(v)}
              onChange={(e) => {
                const next = new Set(active);
                if (e.target.checked) next.add(v);
                else next.delete(v);
                onChange(next.size === values.length ? null : next);
              }}
            />
            {v}
          </label>
        ))}
      </div>
    </details>
  );
}

export function TeamWorkspace({
  user,
  view = 'dashboard',
}: {
  user: AppUser;
  view?: 'log' | 'dashboard';
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rows, setRows] = useState<Metrics[]>([]);
  const [definitions, setDefinitions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [person, setPerson] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [busy, setBusy] = useState('');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [exportJobIds, setExportJobIds] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const results = await Promise.all(
          ['/api/queue', '/api/performance'].map(async (url) => {
            const res = await fetch(url);
            if (!res.ok)
              throw new Error('Rapor yüklenemedi; oturumunuzu kontrol edin.');
            return res.json() as Promise<{
              tasks: Task[];
              rows: Metrics[];
              definitions: string[];
            }>;
          }),
        );
        if (live) {
          setTasks(results[0].tasks);
          setRows(results[1].rows);
          setDefinitions(results[1].definitions);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let live = true;
    fetch('/api/jobs')
      .then((r) =>
        r.ok ? (r.json() as Promise<JobSummary[]>) : Promise.reject(),
      )
      .then((v) => {
        if (live) setJobs(v.filter((j) => !j.demo));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // One row per chain, not one per generation — a chain's job ids (root +
  // every auto-continued follow-up) are carried as memberIds so selecting
  // the row's checkbox exports every generation's rows together
  // (/api/export-all already dedupes rows across job ids by
  // platform+username, so this needs no backend change). The representative
  // row shows the latest generation's own fields, except count, which sums
  // across the whole chain.
  const chainedJobs = (() => {
    const groups = new Map<string, JobSummary[]>();
    for (const j of jobs) {
      const key = j.chainId || j.id;
      const list = groups.get(key);
      if (list) list.push(j);
      else groups.set(key, [j]);
    }
    return [...groups.values()].map((members) => {
      const latest = members.reduce((a, b) =>
        Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a,
      );
      return {
        ...latest,
        count: members.reduce((n, m) => n + m.count, 0),
        memberIds: members.map((m) => m.id),
      };
    });
  })();
  const toggleExportChain = (memberIds: string[]) =>
    setExportJobIds((prev) => {
      const allSelected = memberIds.every((id) => prev.includes(id));
      return allSelected
        ? prev.filter((id) => !memberIds.includes(id))
        : [...new Set([...prev, ...memberIds])];
    });
  const [dmList, setDmList] = useState<{
    status: string;
    done: number;
    total: number;
    error: string | null;
  } | null>(null);
  const triggerDmDownload = () => {
    const a = document.createElement('a');
    a.href = '/api/dm-list';
    a.download = 'hiwell-dm-listesi.xlsx';
    a.click();
  };
  const startDmList = async () => {
    setDmList({ status: 'starting', done: 0, total: 0, error: null });
    try {
      const res = await fetch('/api/dm-list/start', { method: 'POST' });
      const data = (await res.json()) as {
        status: string;
        done: number;
        total: number;
        error: string | null;
      };
      if (!res.ok) throw new Error(data.error || 'Başlatılamadı.');
      if (data.status === 'idle') {
        setDmList(null);
        triggerDmDownload();
        return;
      }
      setDmList(data);
    } catch (e) {
      setDmList({
        status: 'error',
        done: 0,
        total: 0,
        error: (e as Error).message,
      });
    }
  };
  // Classification runs in the background (POST /api/dm-list/start) rather
  // than inside the download request itself — a large first-time backlog
  // can take minutes, long enough that the LAN gateway's idle timeout kills
  // a single held-open connection. Polling here instead, then triggering
  // the actual (now-fast, nothing left to classify) download once status
  // goes back to 'idle'.
  useEffect(() => {
    if (dmList?.status !== 'running') return;
    let live = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch('/api/dm-list/status');
          const data = (await res.json()) as {
            status: string;
            done: number;
            total: number;
            error: string | null;
          };
          if (!live) return;
          if (data.error) {
            setDmList({ ...data, status: 'error' });
            return;
          }
          if (data.status === 'idle') {
            setDmList(null);
            triggerDmDownload();
            return;
          }
          setDmList(data);
        } catch {}
      })();
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [dmList?.status]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [sheetRows, setSheetRows] = useState<ExportRow[]>([]);
  const [includedKeys, setIncludedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  // null = no filter (every value shown); once opened, a column filter holds
  // exactly the values still checked — same as Excel's AutoFilter dropdowns.
  const [colFilters, setColFilters] = useState<{
    platform: Set<string> | null;
    emailStatus: Set<string> | null;
    verdict: Set<string> | null;
    language: Set<string> | null;
  }>({ platform: null, emailStatus: null, verdict: null, language: null });
  const openSheet = async () => {
    setSheetOpen(true);
    setSheetLoading(true);
    setSheetError('');
    setSearch('');
    setColFilters({
      platform: null,
      emailStatus: null,
      verdict: null,
      language: null,
    });
    try {
      const res = await fetch(
        `/api/export-rows?jobIds=${exportJobIds.join(',')}`,
      );
      if (!res.ok) throw new Error('Satırlar yüklenemedi.');
      const data = (await res.json()) as { rows: ExportRow[] };
      setSheetRows(data.rows);
      setIncludedKeys(new Set(data.rows.map(rowKey)));
    } catch (e) {
      setSheetError((e as Error).message);
    } finally {
      setSheetLoading(false);
    }
  };
  const emailStatusOf = (r: ExportRow) => (r.email ? 'Var' : 'Yok');
  const verdictOf = (r: ExportRow) => r.ai?.verdict || 'Değerlendirilmedi';
  const languageOf = (r: ExportRow) => r.language || 'Bilinmiyor';
  const matchesFilters = (r: ExportRow) => {
    const q = search.trim().toLowerCase();
    if (
      q &&
      !`${r.username} ${r.fullName || ''} ${r.email || ''} ${r.sourceLabel}`
        .toLowerCase()
        .includes(q)
    )
      return false;
    if (colFilters.platform && !colFilters.platform.has(r.platform || 'instagram'))
      return false;
    if (colFilters.emailStatus && !colFilters.emailStatus.has(emailStatusOf(r)))
      return false;
    if (colFilters.verdict && !colFilters.verdict.has(verdictOf(r)))
      return false;
    if (colFilters.language && !colFilters.language.has(languageOf(r)))
      return false;
    return true;
  };
  const filteredSheetRows = sheetRows.filter(matchesFilters);
  const finalRows = filteredSheetRows.filter((r) => includedKeys.has(rowKey(r)));
  const downloadImportCsv = async () => {
    // export-rows (which populated this sheet) only ever previews — this is
    // the actual export, so this is where "don't repeat someone already
    // handed out" gets logged, same per-job log every other export route
    // shares. Only rows with a jobId can be logged (always true for real
    // data; defensive for anything odd slipping through).
    const loggable = finalRows.filter((r) => r.jobId);
    if (loggable.length)
      await fetch('/api/export-rows/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: loggable.map((r) => ({
            jobId: r.jobId,
            platform: r.platform || 'instagram',
            username: r.username,
          })),
        }),
      }).catch(() => {});
    const lines = [
      ['email', 'name', 'username', 'platform'],
      ...finalRows.map((r) => [
        r.email || '',
        r.fullName || '',
        r.username,
        r.platform || 'instagram',
      ]),
    ];
    const csv =
      '﻿' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const visible = rows.filter(
    (r) =>
      (person === 'all' || r.userId === person) &&
      (platform === 'all' || r.platform === platform),
  );
  const people = [...new Map(rows.map((r) => [r.userId, r.name])).entries()];
  const waiting = tasks.filter((t) => t.status === 'queued');
  const running = tasks.filter((t) =>
    ['running', 'stopping'].includes(t.status),
  );
  const filteredTasks = tasks.filter(
    (t) =>
      (person === 'all' || t.ownerId === person) &&
      (platform === 'all' ||
        t.platform === platform ||
        !!t.platforms?.includes(platform)),
  );
  // One row per scan, not one per task: the hourly auto-resume feature
  // (quota/restriction recovery) and the auto-chaining feature both enqueue
  // a fresh task — for the former, a repeat of the same job; for the
  // latter, a new job in the same chain. Collapsing to the most recently
  // created task per chain shows whichever generation is current without
  // older "Otomatik devam"/earlier-generation rows cluttering the list.
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const chainKeyFor = (t: Task) => {
    const job = t.jobId ? jobById.get(t.jobId) : undefined;
    return job?.chainId || job?.id || t.jobId || t.id;
  };
  const latestPerChain = new Map<string, Task>();
  for (const t of filteredTasks) {
    const key = chainKeyFor(t);
    const prior = latestPerChain.get(key);
    if (!prior || Date.parse(t.createdAt) >= Date.parse(prior.createdAt))
      latestPerChain.set(key, t);
  }
  const collapsedTasks = [...latestPerChain.values()];
  const ordered = [
    ...collapsedTasks.filter((t) =>
      ['queued', 'running', 'stopping'].includes(t.status),
    ),
    ...collapsedTasks
      .filter((t) => !['queued', 'running', 'stopping'].includes(t.status))
      .reverse(),
  ].slice(0, 150);
  const total = (key: 'processed' | 'emails' | 'dm' | 'accepted') =>
    visible.reduce((n, r) => n + r[key], 0);
  return (
    <section className="team-workspace">
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="panel sender-panel">
        <h2>{view === 'log' ? 'İş günlüğü ve kuyruk' : 'Ekip performansı'}</h2>
        <p>
          <strong>{waiting.length} bekleyen iş</strong> · {running.length}{' '}
          çalışan iş · Tarama/AI ve email kuyrukları bağımsız çalışır. Her
          kuyrukta aynı anda bir iş yürür. Bekleyen işler yeniden başlatmada
          korunur.
        </p>
        <p>
          Tarama / AI: {waiting.filter((t) => t.kind !== 'email').length}{' '}
          bekleyen · Email: {waiting.filter((t) => t.kind === 'email').length}{' '}
          bekleyen
        </p>
        <div className="bulk-toolbar">
          <Select value={person} onValueChange={(v) => setPerson(v || 'all')}>
            <SelectTrigger aria-label="Kullanıcı">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm kullanıcılar</SelectItem>
              {people.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={platform}
            onValueChange={(v) => setPlatform(v || 'all')}
          >
            <SelectTrigger aria-label="Platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm platformlar</SelectItem>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="manual">Elle / CSV</SelectItem>
              <SelectItem value="tiktok">TikTok</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p>
          Tüm zamanlar · Seçilen kullanıcı/platform toplamı:{' '}
          {total('processed')} işlenen kayıt · {total('emails')} email bulunan
          profil · {total('dm')} DM profili · {total('accepted')} email kabulü
        </p>
        <p className="field-hint">
          Birden fazla kullanıcının aynı profili işlemesi, kullanıcı
          toplamlarında ayrı sayılır.
        </p>
      </div>
      {view === 'dashboard' && (
        <div className="stats-grid">
          {[
            ['İşlenen kayıt', total('processed')],
            ['Email bulunan profil', total('emails')],
            ['DM bulunan profil', total('dm')],
            ['SendGrid kabul', total('accepted')],
          ].map(([label, value]) => (
            <div className="stat" key={String(label)}>
              <div className="stat-label">{label}</div>
              <div className="stat-value">{value}</div>
            </div>
          ))}
        </div>
      )}
      {view === 'dashboard' && (
        <div className="panel sender-panel">
          <h3>DM listesi</h3>
          <p>
            Email’i olmayan, Bağlantılar’da ayarlı takipçi aralığındaki kadın
            hesapları (fotoğraftan AI ile belirlenir) tüm taramalardan
            toplayıp indirir. Daha önce indirilen hesaplar bir sonraki
            indirmede tekrar gelmez.
          </p>
          <Button
            variant="outline"
            disabled={dmList?.status === 'starting' || dmList?.status === 'running'}
            onClick={() => void startDmList()}
          >
            {dmList?.status === 'running'
              ? `Sınıflandırılıyor… (${dmList.done}/${dmList.total})`
              : dmList?.status === 'starting'
                ? 'Başlatılıyor…'
                : 'DM listesi indir'}
          </Button>
          {dmList?.status === 'error' && (
            <p className="notice error" role="alert">
              {dmList.error}
            </p>
          )}
        </div>
      )}
      {view === 'dashboard' && (
        <div className="panel sender-panel">
          <h3>Tarama dışa aktarımı</h3>
          <p>
            Aşağıdan dışa aktarmak istediğin taramaları seç — profil linki,
            email bulunup bulunmadığı, DM ile ulaşım notu, AI değerlendirmesi
            gibi tüm alanlar bir sayfada; elenen adaylar ayrı bir sayfada;
            toplam sayılar bir özet sayfasında olacak şekilde tek Excel
            dosyasında birleştirilir. Seçmeden indirilemez.
          </p>
          <div className="bulk-toolbar">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExportJobIds(jobs.map((j) => j.id))}
              disabled={!jobs.length}
            >
              Tümünü seç
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExportJobIds([])}
              disabled={!exportJobIds.length}
            >
              Seçimi temizle
            </Button>
            <span>{exportJobIds.length} tarama seçili</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead>Kaynaklar</TableHead>
                <TableHead>Mod</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="numeric">Profil</TableHead>
                <TableHead>Tarih</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chainedJobs.map((j) => (
                <TableRow key={j.chainId || j.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`${j.sources.join(', ')} taramasını seç`}
                      checked={j.memberIds.every((id) =>
                        exportJobIds.includes(id),
                      )}
                      onCheckedChange={() => toggleExportChain(j.memberIds)}
                    />
                  </TableCell>
                  <TableCell>
                    {(j.market ?? 'tr').toUpperCase()} {j.sources.join(', ')}
                  </TableCell>
                  <TableCell>
                    {j.mode === 'following'
                      ? 'Takip listesi'
                      : j.mode === 'search'
                        ? 'Arama'
                        : 'Profil listesi'}
                  </TableCell>
                  <TableCell>{labels[j.status] || j.status}</TableCell>
                  <TableCell className="numeric">{j.count}</TableCell>
                  <TableCell>
                    {new Date(j.createdAt).toLocaleString('tr-TR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!jobs.length && <p className="field-hint">Henüz tarama yok.</p>}
          <div className="bulk-toolbar">
            {exportJobIds.length ? (
              <a
                className="button-link"
                href={`/api/export-all?jobIds=${exportJobIds.join(',')}`}
                download="hiwell-secili-taramalar.xlsx"
              >
                Excel olarak indir ({exportJobIds.length} tarama)
              </a>
            ) : (
              <span className="button-link disabled">
                Excel olarak indir — önce tarama seç
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!exportJobIds.length}
              onClick={() => void openSheet()}
            >
              Filtrele ve içe aktarım formatında indir
            </Button>
          </div>
        </div>
      )}
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="export-sheet-dialog sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Seçilenleri filtrele</DialogTitle>
          </DialogHeader>
          {sheetError && (
            <p className="notice error" role="alert">
              {sheetError}
            </p>
          )}
          {sheetLoading ? (
            <p className="field-hint">Yükleniyor…</p>
          ) : (
            <>
              <div className="bulk-toolbar">
                <Input
                  placeholder="Kullanıcı adı, isim, email veya kaynakta ara…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setIncludedKeys(
                      (prev) =>
                        new Set([
                          ...prev,
                          ...filteredSheetRows.map(rowKey),
                        ]),
                    )
                  }
                >
                  Görünenleri seç
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setIncludedKeys((prev) => {
                      const next = new Set(prev);
                      for (const r of filteredSheetRows) next.delete(rowKey(r));
                      return next;
                    })
                  }
                >
                  Görünenleri kaldır
                </Button>
                <span>
                  {finalRows.length} / {sheetRows.length} satır seçili
                </span>
              </div>
              <div className="export-sheet-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead>Kullanıcı adı</TableHead>
                      <TableHead>İsim</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>
                        <ColumnFilter
                          label="Platform"
                          values={[
                            ...new Set(
                              sheetRows.map((r) => r.platform || 'instagram'),
                            ),
                          ]}
                          selected={colFilters.platform}
                          onChange={(v) =>
                            setColFilters((p) => ({ ...p, platform: v }))
                          }
                        />
                      </TableHead>
                      <TableHead>
                        <ColumnFilter
                          label="Email durumu"
                          values={[...new Set(sheetRows.map(emailStatusOf))]}
                          selected={colFilters.emailStatus}
                          onChange={(v) =>
                            setColFilters((p) => ({ ...p, emailStatus: v }))
                          }
                        />
                      </TableHead>
                      <TableHead>
                        <ColumnFilter
                          label="AI değerlendirmesi"
                          values={[...new Set(sheetRows.map(verdictOf))]}
                          selected={colFilters.verdict}
                          onChange={(v) =>
                            setColFilters((p) => ({ ...p, verdict: v }))
                          }
                        />
                      </TableHead>
                      <TableHead>
                        <ColumnFilter
                          label="Dil"
                          values={[...new Set(sheetRows.map(languageOf))]}
                          selected={colFilters.language}
                          onChange={(v) =>
                            setColFilters((p) => ({ ...p, language: v }))
                          }
                        />
                      </TableHead>
                      <TableHead>Kaynak</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSheetRows.map((r) => {
                      const key = rowKey(r);
                      return (
                        <TableRow key={key}>
                          <TableCell>
                            <Checkbox
                              aria-label={`${r.username} satırını dahil et`}
                              checked={includedKeys.has(key)}
                              onCheckedChange={() =>
                                setIncludedKeys((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                          <TableCell>{r.username}</TableCell>
                          <TableCell>{r.fullName || ''}</TableCell>
                          <TableCell>{r.email || ''}</TableCell>
                          <TableCell>{platformLabel(r.platform || 'instagram')}</TableCell>
                          <TableCell>{emailStatusOf(r)}</TableCell>
                          <TableCell>{verdictOf(r)}</TableCell>
                          <TableCell>{languageOf(r)}</TableCell>
                          <TableCell>{r.sourceLabel}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {!filteredSheetRows.length && (
                  <p className="field-hint">Bu filtrelerle eşleşen satır yok.</p>
                )}
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              disabled={!finalRows.length}
              onClick={() => void downloadImportCsv()}
            >
              İçe aktarım formatında indir ({finalRows.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {view === 'log' && (
        <div className="panel sender-panel">
          <h3>Kuyruk ve son işler</h3>
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  'Sıra',
                  'Kullanıcı',
                  'İş',
                  'Platform',
                  'Tarih',
                  'Durum',
                  'İşlem',
                ].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.kind === 'email' ? 'Email' : 'Tarama / AI'} ·{' '}
                    {t.position ?? '—'}
                  </TableCell>
                  <TableCell>{t.ownerName}</TableCell>
                  <TableCell>
                    {t.kind === 'scan'
                      ? 'Tarama'
                      : t.kind === 'ai'
                        ? 'AI'
                        : 'Email'}{' '}
                    ·{' '}
                    {t.jobId &&
                      `${(jobById.get(t.jobId)?.market ?? 'tr').toUpperCase()} `}
                    {t.title}
                  </TableCell>
                  <TableCell>
                    {t.platforms?.map(platformLabel).join(' + ') ||
                      platformLabel(t.platform)}
                  </TableCell>
                  <TableCell>
                    {new Date(t.createdAt).toLocaleString('tr-TR')}
                  </TableCell>
                  <TableCell>
                    {labels[t.status] || t.status}
                    {t.error && <small>{t.error}</small>}
                    {!!t.remaining && (
                      <small>Kalan kullanıcı: {t.remaining}</small>
                    )}
                    {!t.remaining && !!t.sourcesLeft && (
                      <small>Okunmamış kaynak: {t.sourcesLeft}</small>
                    )}
                  </TableCell>
                  <TableCell>
                    {(['queued', 'running'].includes(t.status) ||
                      t.canResume) &&
                      (user.role === 'admin' || t.ownerId === user.id) && (
                        <Button
                          variant="outline"
                          disabled={!!busy}
                          onClick={async () => {
                            setBusy(t.id);
                            setError('');
                            try {
                              const res = await fetch(
                                '/api/queue/' +
                                  t.id +
                                  (t.canResume ? '/resume' : '/cancel'),
                                {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: '{}',
                                },
                              );
                              if (!res.ok)
                                throw new Error(
                                  ((await res.json()) as { error: string })
                                    .error,
                                );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy('');
                            }
                          }}
                        >
                          {t.canResume
                            ? t.remaining
                              ? 'Devam et (' + t.remaining + ')'
                              : 'Devam et (' + t.sourcesLeft + ' kaynak)'
                            : t.status === 'queued'
                              ? 'İptal et'
                              : 'Durdur'}
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!ordered.length && <p>Henüz iş yok.</p>}
        </div>
      )}
      {view === 'dashboard' && (
        <>
          {' '}
          <div className="panel sender-panel">
            <h3>Kişi ve platform bazında tarama</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'Kişi',
                    'Platform',
                    'İş',
                    'Verilen hesap',
                    'Arama ifadesi',
                    'İşlenen',
                    'Yeni taranan',
                    'Önbellek',
                    'Aktarım',
                    'Hatalı',
                    'Tekil profil',
                    'Email var',
                    'DM var',
                    'Profil linki',
                  ].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.userId + r.platform}>
                    {[
                      r.name,
                      platformLabel(r.platform),
                      r.jobs,
                      r.submittedAccounts,
                      r.searchTerms,
                      r.processed,
                      r.fresh,
                      r.cached,
                      r.imported,
                      r.errors,
                      r.profiles,
                      r.emails,
                      r.dm,
                      r.links,
                    ].map((v, i) => (
                      <TableCell key={i}>{v}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="panel sender-panel">
            <h3>Email gönderimleri ve iş durumları</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'Kişi',
                    'Platform',
                    'Email bekleyen',
                    'Gönderiliyor',
                    'SendGrid kabul',
                    'Başarısız',
                    'Belirsiz',
                    'Tarama / AI durumları',
                  ].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.userId + r.platform}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{platformLabel(r.platform)}</TableCell>
                    <TableCell>{r.queuedEmails}</TableCell>
                    <TableCell>{r.sending}</TableCell>
                    <TableCell>{r.accepted}</TableCell>
                    <TableCell>{r.failed}</TableCell>
                    <TableCell>{r.unknown}</TableCell>
                    <TableCell>
                      {Object.entries(r.statuses)
                        .map(
                          ([status, count]) =>
                            (labels[status] || status) + ': ' + count,
                        )
                        .join(' · ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <details className="panel sender-panel">
            <summary>Sayılar nasıl hesaplanıyor?</summary>
            {definitions.map((d) => (
              <p key={d}>{d}</p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}

export function performanceReport(
  jobs,
  tasks,
  contacts,
  users,
  deliveries = [],
) {
  const groups = new Map();
  const group = (id, platform) => {
    const key = (id || 'unknown') + ':' + platform;
    if (!groups.has(key))
      groups.set(key, {
        userId: id || 'unknown',
        name: users.find((u) => u.id === id)?.name || 'Kullanıcısı bilinmiyor',
        platform,
        jobs: 0,
        submittedAccounts: 0,
        searchTerms: 0,
        processed: 0,
        fresh: 0,
        cached: 0,
        imported: 0,
        profiles: new Set(),
        emails: new Set(),
        dm: new Set(),
        links: new Set(),
        errors: 0,
        accepted: 0,
        failed: 0,
        unknown: 0,
        sending: 0,
        queuedEmails: 0,
        statuses: {},
      });
    return groups.get(key);
  };
  for (const user of users)
    for (const platform of ['instagram', 'tiktok']) group(user.id, platform);
  for (const job of jobs.filter((j) => !j.demo)) {
    const g = group(job.ownerId, job.platform || 'instagram');
    g.jobs++;
    if (!tasks.some((t) => t.jobId === job.id))
      g.statuses[job.status] = (g.statuses[job.status] || 0) + 1;
    if (job.mode === 'search') g.searchTerms += job.sources.length;
    else g.submittedAccounts += job.sources.length;
    for (const r of job.rows) {
      g.processed++;
      if (r.error) {
        g.errors++;
        continue;
      }
      const key = r.username.toLowerCase();
      g.profiles.add(key);
      if (r.email) g.emails.add(key);
      if (r.dmForCollaboration) g.dm.add(key);
      if (r.externalUrl) g.links.add(key);
      if (r.imported) g.imported++;
      else if (r.reused) g.cached++;
      else g.fresh++;
    }
  }
  for (const task of tasks) {
    if (task.kind === 'email') {
      if (task.status === 'queued')
        for (const m of task.payload.messages) {
          const c = contacts.find((c) => c.id === m.id);
          group(task.ownerId, c?.platform || 'instagram').queuedEmails++;
        }
    } else {
      const g = group(task.ownerId, task.platform || 'instagram');
      g.statuses[task.status] = (g.statuses[task.status] || 0) + 1;
    }
  }
  for (const d of deliveries) {
    const g = group(d.actorId, d.platform || 'instagram');
    if (['accepted', 'failed', 'unknown', 'sending'].includes(d.status))
      g[d.status]++;
  }
  for (const c of contacts) {
    if (c.demo || deliveries.some((d) => d.contactId === c.id)) continue;
    if (['accepted', 'failed', 'unknown', 'sending'].includes(c.status)) {
      const g = group(c.lastMessage?.actorId, c.platform || 'instagram');
      g[c.status]++;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    rows: [...groups.values()].map((g) => ({
      ...g,
      profiles: g.profiles.size,
      emails: g.emails.size,
      dm: g.dm.size,
      links: g.links.size,
    })),
    definitions: [
      'Verilen hesap: kaynak hesap girişlerinin toplamı; anahtar kelimeler ayrı sayılır.',
      'İşlenen: sonuç satırı sayısı. Başarısız, yeni taranan, önbellek ve aktarım ayrı gösterilir.',
      'Tekil profil/email/DM: kişi ve platform içinde kullanıcı adına göre tekilleştirilir. Bir profil hem email hem DM olabilir.',
      'Email durumları gönderim denemelerini sayar. Kabul, SendGrid kabulüdür; teslimat/açılma/tıklanma ölçülmez.',
      'DM sayısı, iş birliği için DM belirten profillerdir; uygulama DM göndermez.',
      'Profil linki: profilde harici bağlantı (web sitesi/bio bağlantısı) bulunan tekil profil sayısıdır.',
      'Eski kayıtlarda işlem sahibi bilinmiyorsa kimseye atanmaz. Geçmiş tüm email denemeleri kaydedilmediğinden eski email sayıları son kayıtla sınırlıdır.',
    ],
  };
}

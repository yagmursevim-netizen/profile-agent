import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';

export const validEmail = (value) =>
  typeof value === 'string' &&
  /^[^\s@;<>]+@[^\s@;<>]+\.[^\s@;<>]+$/.test(value);
export function renderTemplate(template, contact) {
  const name = (contact.name || contact.username).trim();
  const values = {
    isim: name,
    ad: name.split(/\s+/)[0],
    kullanici_adi: contact.username,
    email: contact.email,
  };
  const render = (text) =>
    String(text).replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => {
      if (!Object.hasOwn(values, key))
        throw new Error(`Bilinmeyen alan: {{${key}}}`);
      return values[key];
    });
  const subject = render(template.subject);
  const body = render(template.body);
  if (!subject.trim() || !body.trim() || /[\r\n]/.test(subject))
    throw new Error('Şablonun konusu ve metni geçerli olmalı.');
  return { subject, body };
}
export function sendgridPayload(message, sender) {
  return {
    personalizations: [
      {
        to: [{ email: message.email, name: message.name }],
        subject: message.subject,
      },
    ],
    from: { email: sender.fromEmail, name: sender.fromName },
    ...(sender.replyTo
      ? { reply_to: { email: sender.replyTo, name: sender.fromName } }
      : {}),
    content: [{ type: 'text/plain', value: message.body }],
  };
}
export class Outreach {
  constructor(dir = '.local', fetcher = fetch) {
    this.dir = dir;
    this.fetcher = fetcher;
    this.state = { contacts: [], templates: [] };
    this.writeQueue = Promise.resolve();
    this.previews = new Map();
    this.sending = false;
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.state = JSON.parse(
        await readFile(path.join(this.dir, 'outreach.json'), 'utf8'),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    this.state.deliveries ||= [];
    this.state.suppressions ||= [];
    for (const d of this.state.deliveries)
      if (d.status === 'sending') d.status = 'unknown';
    for (const c of this.state.contacts)
      if (c.status === 'sending') {
        c.status = 'unknown';
        c.error =
          'Sunucu gönderim sırasında kapandı. SendGrid kayıtlarından kontrol edin; otomatik tekrar gönderilmez.';
      }
    await this.save();
    return this;
  }
  save() {
    const data = JSON.stringify(this.state);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await writeFile(path.join(this.dir, 'outreach.tmp'), data, {
          mode: 0o600,
        });
        await rename(
          path.join(this.dir, 'outreach.tmp'),
          path.join(this.dir, 'outreach.json'),
        );
      });
    return this.writeQueue;
  }
  snapshot() {
    return {
      ...this.state,
      contacts: this.state.contacts.filter((c) => !c.archived),
      sending: this.sending,
    };
  }
  blockedEmail(email) {
    const key = String(email || '')
      .trim()
      .toLowerCase();
    return (
      !!key &&
      (this.state.suppressions.some((s) => s.email === key) ||
        this.state.deliveries.some(
          (d) =>
            (
              d.email ||
              this.state.contacts.find((c) => c.id === d.contactId)?.email ||
              ''
            ).toLowerCase() === key &&
            ['accepted', 'unknown', 'sending'].includes(d.status),
        ) ||
        this.state.contacts.some(
          (c) =>
            c.email.toLowerCase() === key &&
            !c.demo &&
            ['accepted', 'unknown', 'sending'].includes(c.status),
        ))
    );
  }
  async suppress(rows, actor) {
    let added = 0;
    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (this.state.suppressions.some((s) => s.email === email)) continue;
      this.state.suppressions.push({
        id: randomUUID(),
        email,
        name: row.fullName || '',
        recordedBy: actor.id,
        recordedAt: new Date().toISOString(),
        status: 'imported',
        actorId: null,
      });
      for (const c of this.state.contacts)
        if (
          c.email.toLowerCase() === email &&
          ['draft', 'failed', 'queued'].includes(c.status)
        ) {
          c.status = 'suppressed';
          c.error =
            'Daha önce gönderilmiş adresler listesinde; tekrar gönderilmez.';
        }
      added++;
    }
    await this.save();
    return { added, skipped: rows.length - added };
  }
  history(users = []) {
    const records = this.state.deliveries.map((d) => {
      const c = this.state.contacts.find((c) => c.id === d.contactId);
      return {
        ...d,
        email: d.email || c?.email || '',
        name: d.name || c?.name || '',
        date: d.finishedAt || d.attemptedAt,
        source: 'Uygulama',
      };
    });
    for (const c of this.state.contacts)
      if (
        !c.demo &&
        ['accepted', 'unknown', 'sending', 'failed'].includes(c.status) &&
        !this.state.deliveries.some((d) => d.contactId === c.id)
      )
        records.push({
          id: c.id,
          email: c.email,
          name: c.name,
          status: c.status,
          actorId: c.lastMessage?.actorId,
          fromEmail: c.lastMessage?.fromEmail,
          date: c.acceptedAt || null,
          source: 'Eski uygulama kaydı',
        });
    records.push(
      ...this.state.suppressions.map((s) => ({
        ...s,
        date: null,
        source: 'Daha önce gönderildi (içe aktarıldı)',
      })),
    );
    return records.map((d) => ({
      ...d,
      actorName: users.find((u) => u.id === d.actorId)?.name || 'Bilinmiyor',
      recordedByName: users.find((u) => u.id === d.recordedBy)?.name || '',
    }));
  }
  async template(input) {
    if (this.sending)
      throw new Error('Gönderim bitene kadar şablonları düzenleyemezsiniz.');
    const value = {
      name: input.name,
      subject: input.subject,
      body: input.body,
    };
    for (const [key, v] of Object.entries(value))
      if (
        typeof v !== 'string' ||
        !v.trim() ||
        v.length > (key === 'body' ? 20000 : 300)
      )
        throw new Error(
          'Şablon adı, konu ve metin gerekli; alan uzunluğunu kontrol edin.',
        );
    renderTemplate(value, {
      name: 'Örnek İsim',
      username: 'ornek',
      email: 'ornek@example.com',
    });
    let t = input.id
      ? this.state.templates.find((t) => t.id === input.id)
      : null;
    if (input.id && !t) throw new Error('Şablon bulunamadı.');
    if (!t) {
      t = { id: randomUUID() };
      this.state.templates.push(t);
    }
    Object.assign(t, value, { updatedAt: new Date().toISOString() });
    await this.save();
    return t;
  }
  async add(rows, jobId, demo = false) {
    if (this.sending)
      throw new Error('Gönderim bitene kadar listeyi düzenleyemezsiniz.');
    let added = 0;
    const skipped = [];
    for (const row of rows) {
      const addresses = (row.email || '')
        .split(';')
        .map((e) => e.trim())
        .filter(validEmail);
      if (!addresses.length && !row.dmForCollaboration) {
        skipped.push(
          `@${row.username}: email yok${row.dmForCollaboration ? ' (iş birliği için DM)' : ''}.`,
        );
        continue;
      }
      const email = addresses[0]?.toLowerCase() || '';
      if (
        this.blockedEmail(email) ||
        this.state.contacts.some(
          (c) =>
            ((email && c.email.toLowerCase() === email) ||
              (c.username === row.username &&
                (c.platform || 'instagram') ===
                  (row.platform || 'instagram'))) &&
            (!c.archived ||
              ['accepted', 'unknown', 'sending'].includes(c.status)),
        )
      ) {
        skipped.push(
          `@${row.username}: zaten listede veya daha önce işlenmiş.`,
        );
        continue;
      }
      this.state.contacts.push({
        id: randomUUID(),
        username: row.username,
        platform: row.platform || 'instagram',
        name: row.fullName || row.username,
        email,
        emailOptions: addresses,
        dmForCollaboration: !!row.dmForCollaboration,
        dmEvidence: row.dmEvidence || null,
        photoUrl: row.photoUrl || null,
        language: row.language || null,
        bio: row.bio || null,
        channel: email ? 'email' : 'dm',
        jobId,
        demo,
        templateId: null,
        status: 'draft',
        error: null,
        createdAt: new Date().toISOString(),
      });
      added++;
    }
    await this.save();
    return { added, skipped };
  }
  selected(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500)
      throw new Error('1–500 kişi seçin.');
    const unique = [...new Set(ids)];
    const contacts = unique.map((id) =>
      this.state.contacts.find((c) => c.id === id && !c.archived),
    );
    if (contacts.some((c) => !c))
      throw new Error('Listede bulunmayan kişi var.');
    return contacts;
  }
  async assign(ids, templateId) {
    if (this.sending) throw new Error('Gönderim devam ediyor.');
    if (!this.state.templates.some((t) => t.id === templateId))
      throw new Error('Şablon bulunamadı.');
    const contacts = this.selected(ids);
    if (contacts.some((c) => !c.email))
      throw new Error(
        'DM adaylarına email şablonu atanamaz. Email kanalını filtreleyin.',
      );
    if (contacts.some((c) => !['draft', 'failed'].includes(c.status)))
      throw new Error(
        'Yalnızca taslak veya başarısız kayıtlara şablon atanabilir.',
      );
    contacts.forEach((c) => {
      c.templateId = templateId;
    });
    await this.save();
    return { updated: contacts.length };
  }
  async edit(input) {
    if (this.sending) throw new Error('Gönderim devam ediyor.');
    const [c] = this.selected([input.id]);
    if (!['draft', 'failed'].includes(c.status))
      throw new Error('Bu gönderim kaydı düzenlenemez.');
    if (
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 150 ||
      /[\r\n]/.test(input.name)
    )
      throw new Error('Geçerli bir hitap adı girin.');
    if (
      !(c.dmForCollaboration && input.email === '') &&
      !validEmail(input.email)
    )
      throw new Error('Geçerli bir alıcı email adresi girin.');
    if (
      this.state.contacts.some(
        (x) =>
          x.id !== c.id &&
          (!x.archived || ['accepted', 'unknown'].includes(x.status)) &&
          input.email &&
          x.email.toLowerCase() === input.email.toLowerCase(),
      )
    )
      throw new Error('Bu email başka bir kayıtta mevcut.');
    if (this.blockedEmail(input.email))
      throw new Error(
        'Bu adrese daha önce gönderilmiş veya gönderim sonucu belirsiz; tekrar gönderilemez.',
      );
    c.name = input.name.trim();
    c.email = input.email.toLowerCase();
    c.channel = c.email ? 'email' : 'dm';
    c.error = null;
    await this.save();
    return c;
  }
  async archive(ids) {
    if (this.sending) throw new Error('Gönderim devam ediyor.');
    const contacts = this.selected(ids);
    if (contacts.some((c) => c.status === 'queued'))
      throw new Error('Önce kuyruktaki email işini iptal edin.');
    contacts.forEach((c) => (c.archived = true));
    await this.save();
    return { removed: contacts.length };
  }
  messages(ids, sender) {
    if (!validEmail(sender.fromEmail))
      throw new Error('Gönderen email adresini ayarlayın.');
    return this.selected(ids).map((c) => {
      if (!c.email)
        throw new Error(
          `@${c.username}: DM adayıdır; email gönderilemez. Email kanalını filtreleyin.`,
        );
      if (!['draft', 'failed'].includes(c.status))
        throw new Error(
          `@${c.username}: daha önce kabul edilmiş veya sonucu belirsiz. Yeniden gönderilemez.`,
        );
      if (this.blockedEmail(c.email))
        throw new Error(
          `${c.email}: daha önce gönderilenler listesinde; tekrar gönderilemez.`,
        );
      const t = this.state.templates.find((t) => t.id === c.templateId);
      if (!t) throw new Error(`@${c.username}: önce şablon seçin.`);
      if (!validEmail(c.email))
        throw new Error(`@${c.username}: email geçersiz.`);
      return {
        id: c.id,
        username: c.username,
        name: c.name,
        email: c.email,
        demo: c.demo,
        templateName: t.name,
        ...renderTemplate(t, c),
      };
    });
  }
  digest(messages, sender) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          messages,
          fromEmail: sender.fromEmail,
          fromName: sender.fromName,
          replyTo: sender.replyTo,
          actorId: sender.actorId,
        }),
      )
      .digest('hex');
  }
  preview(ids, sender) {
    const messages = this.messages(ids, sender);
    const id = randomUUID();
    for (const [key, value] of this.previews)
      if (value.expires < Date.now()) this.previews.delete(key);
    this.previews.set(id, {
      ids,
      hash: this.digest(messages, sender),
      expires: Date.now() + 600000,
    });
    return {
      id,
      messages,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      canSend: !!sender.sendgridKey && !messages.some((m) => m.demo),
    };
  }
  reserve(id, sender) {
    const p = this.previews.get(id);
    if (!p || p.expires < Date.now()) throw new Error('Yeniden önizleyin.');
    const messages = this.messages(p.ids, sender);
    if (
      !sender.sendgridKey ||
      messages.some((m) => m.demo) ||
      this.digest(messages, sender) !== p.hash
    )
      throw new Error('Gönderen veya liste değişti; yeniden önizleyin.');
    this.previews.delete(id);
    for (const m of messages)
      this.state.contacts.find((c) => c.id === m.id).status = 'queued';
    return structuredClone(messages);
  }
  async release(messages) {
    for (const m of messages) {
      const c = this.state.contacts.find((c) => c.id === m.id);
      if (c?.status === 'queued') c.status = 'draft';
    }
    await this.save();
  }
  async send(id, sender) {
    if (this.sending) throw new Error('Zaten bir gönderim devam ediyor.');
    const p = this.previews.get(id);
    if (!p || p.expires < Date.now())
      throw new Error('Önizleme süresi doldu; yeniden önizleyin.');
    if (!sender.sendgridKey) throw new Error('SendGrid token ayarlı değil.');
    const messages = this.messages(p.ids, sender);
    if (messages.some((m) => m.demo))
      throw new Error('Örnek profil kayıtlarına gerçek email gönderilemez.');
    if (this.digest(messages, sender) !== p.hash)
      throw new Error(
        'Liste, şablon veya gönderen bilgileri değişti; yeniden önizleyin.',
      );
    this.previews.delete(id);
    return this.sendMessages(messages, sender);
  }
  async sendMessages(messages, sender, signal) {
    if (this.sending) throw new Error('Zaten bir gönderim devam ediyor.');
    this.sending = true;
    const counts = { accepted: 0, failed: 0, unknown: 0 };
    try {
      for (const message of messages) {
        signal?.throwIfAborted();
        const c = this.state.contacts.find((c) => c.id === message.id);
        if (this.blockedEmail(message.email)) {
          if (c && !['accepted', 'unknown', 'sending'].includes(c.status)) {
            c.status = 'suppressed';
            c.error = 'Tekrar gönderim engellendi.';
          }
          counts.skipped = (counts.skipped || 0) + 1;
          await this.save();
          continue;
        }
        const delivery = {
          email: message.email,
          name: message.name,
          id: randomUUID(),
          contactId: c.id,
          actorId: sender.actorId || null,
          platform: c.platform || 'instagram',
          fromEmail: sender.fromEmail,
          status: 'sending',
          attemptedAt: new Date().toISOString(),
        };
        this.state.deliveries.push(delivery);
        c.status = 'sending';
        c.error = null;
        c.lastMessage = {
          subject: message.subject,
          body: message.body,
          fromEmail: sender.fromEmail,
          replyTo: sender.replyTo,
          actorId: sender.actorId,
        };
        await this.save();
        // A suppression may have arrived while the durable send marker was being written.
        if (
          this.state.suppressions.some(
            (s) => s.email === message.email.toLowerCase(),
          )
        ) {
          c.status = 'suppressed';
          c.error = 'Tekrar gönderim engellendi.';
          delivery.status = 'suppressed';
          delivery.finishedAt = new Date().toISOString();
          counts.skipped = (counts.skipped || 0) + 1;
          await this.save();
          continue;
        }
        try {
          const response = await this.fetcher(
            'https://api.sendgrid.com/v3/mail/send',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${sender.sendgridKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(sendgridPayload(message, sender)),
              signal: AbortSignal.timeout(30000),
            },
          );
          if (response.status === 202) {
            c.status = 'accepted';
            c.messageId = response.headers.get('x-message-id');
            c.acceptedAt = new Date().toISOString();
          } else {
            c.status =
              response.status >= 500 || response.status === 408
                ? 'unknown'
                : 'failed';
            c.error = `SendGrid HTTP ${response.status}. ${c.status === 'unknown' ? 'Gönderim sonucu belirsiz; SendGrid kayıtlarını kontrol edin.' : 'Gönderen doğrulaması, API izinleri ve alıcı adresini kontrol edin.'}`;
          }
        } catch {
          c.status = 'unknown';
          c.error =
            'Bağlantı kesildi veya süre doldu. SendGrid kayıtlarını kontrol edin; otomatik tekrar gönderilmez.';
        }
        delivery.status = c.status;
        delivery.finishedAt = new Date().toISOString();
        counts[c.status]++;
        await this.save();
      }
      return counts;
    } finally {
      this.sending = false;
    }
  }
}

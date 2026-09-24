import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { validEmail, sendgridPayload } from './outreach.mjs';
export const TEST_SUBJECT = 'Hiwell Partner Studio · Test emaili';
export const TEST_BODY =
  'Bu email, Hiwell Partner Studio SendGrid bağlantısını test etmek için gönderilmiştir.\n\nBu mesajı görüyorsanız test emaili posta kutunuza ulaşmıştır.';
export class TestEmail {
  constructor(dir = '.local', fetcher = fetch) {
    this.dir = dir;
    this.fetcher = fetcher;
    this.records = [];
    this.busy = false;
  }
  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      this.records = JSON.parse(
        await readFile(`${this.dir}/email-tests.json`, 'utf8'),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    for (const r of this.records)
      if (r.status === 'sending') {
        r.status = 'unknown';
        r.message =
          'Sunucu gönderim sırasında kapandı. Tekrar göndermeden önce posta kutusunu ve SendGrid kayıtlarını kontrol edin.';
      }
    await this.save();
    return this;
  }
  async save() {
    await writeFile(
      `${this.dir}/email-tests.tmp`,
      JSON.stringify(this.records),
      { mode: 0o600 },
    );
    await rename(`${this.dir}/email-tests.tmp`, `${this.dir}/email-tests.json`);
  }
  latest() {
    return this.records.at(-1) || null;
  }
  async send(input, config) {
    if (!/^[a-f0-9-]{36}$/i.test(input.requestId || ''))
      throw new Error('Geçersiz test isteği.');
    const previous = this.records.find((r) => r.id === input.requestId);
    if (previous) return previous;
    if (this.busy)
      throw new Error('Bir test emaili gönderiliyor. Sonucu bekleyin.');
    const recipient = typeof input.email === 'string' ? input.email.trim() : '';
    if (!validEmail(recipient) || recipient.length > 254)
      throw new Error('Geçerli bir test alıcısı email adresi girin.');
    if (!config.sendgridKey)
      throw new Error('Önce SendGrid token bilgisini kaydedin.');
    if (!validEmail(config.fromEmail))
      throw new Error('Önce geçerli bir gönderen email adresi kaydedin.');
    if (
      this.latest() &&
      Date.now() - Date.parse(this.latest().attemptedAt) < 30000
    )
      throw new Error(
        'Yeni test için önceki denemeden sonra 30 saniye bekleyin.',
      );
    this.busy = true;
    const record = {
      id: input.requestId,
      email: recipient,
      fromEmail: config.fromEmail,
      attemptedAt: new Date().toISOString(),
      status: 'sending',
      message: 'Test emaili gönderiliyor…',
    };
    this.records.push(record);
    try {
      await this.save();
      try {
        const response = await this.fetcher(
          'https://api.sendgrid.com/v3/mail/send',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.sendgridKey}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(30000),
            body: JSON.stringify(
              sendgridPayload(
                { email: recipient, subject: TEST_SUBJECT, body: TEST_BODY },
                config,
              ),
            ),
          },
        );
        record.httpStatus = response.status;
        record.status =
          response.status === 202
            ? 'accepted'
            : response.status >= 500 || response.status === 408
              ? 'unknown'
              : 'failed';
        record.message =
          response.status === 202
            ? 'SendGrid test emailini kabul etti. Gelen kutusu ve spam klasörünü kontrol edin; bu yanıt teslimat onayı değildir.'
            : response.status === 401
              ? 'SendGrid anahtarı kabul edilmedi (401). Token bilgisini kontrol edip yeniden kaydedin.'
              : response.status === 403
                ? 'SendGrid erişimi reddetti (403). Gönderen adresinin doğrulamasını ve anahtarın Mail Send iznini kontrol edin.'
                : record.status === 'unknown'
                  ? `SendGrid HTTP ${response.status}; gönderim sonucu belirsiz. Tekrar göndermeden önce posta kutusunu ve SendGrid kayıtlarını kontrol edin.`
                  : `SendGrid HTTP ${response.status}. Alıcı adresini, gönderici doğrulamasını ve hesabınızın gönderim ayarlarını kontrol edin.`;
        if (response.status === 202)
          record.messageId = response.headers.get('x-message-id');
      } catch {
        record.status = 'unknown';
        record.message =
          'Bağlantı kesildi veya süre doldu. Gönderim sonucu belirsiz; tekrar göndermeden önce posta kutusunu ve SendGrid kayıtlarını kontrol edin.';
      }
      await this.save();
      return record;
    } finally {
      this.busy = false;
    }
  }
}

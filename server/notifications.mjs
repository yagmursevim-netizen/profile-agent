import nodemailer from 'nodemailer';
// Operational alerts (restriction / crash) go out through Gmail's own SMTP
// relay, authenticated as this real Gmail account — separate from
// sendgridPayload() candidate-outreach sending, which is untouched. Sending
// AS a @gmail.com address only passes other providers' spam/DMARC checks
// reliably when it's actually relayed through Google's own servers (which
// is what this does); a third-party ESP claiming to be @gmail.com gets
// rejected by Gmail's own DMARC policy on receipt.
const GMAIL_SENDER = { email: 'ysevimyagmur@gmail.com', name: 'Yağmur' };
export const NOTIFICATION_RECIPIENTS = [
  { email: 'yagmur.sevim@hiwellapp.com', name: 'Yağmur' },
  { email: 'ysevimyagmur@gmail.com', name: 'Yağmur' },
];
async function realSendMail(mail, config) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_SENDER.email, pass: config.gmailAppPassword },
  });
  return transporter.sendMail(mail);
}
async function sendNotification({ subject, body }, config, sendMail) {
  return sendMail(
    {
      from: `"${GMAIL_SENDER.name}" <${GMAIL_SENDER.email}>`,
      to: NOTIFICATION_RECIPIENTS.map((r) => `"${r.name}" <${r.email}>`),
      subject,
      text: body,
    },
    config,
  );
}
// A connection/timeout-style failure is unclear whether the mail actually
// went out; an SMTP rejection (bad auth, invalid recipient, ...) is not.
function outcomeFor(err) {
  return /^E(TIMEDOUT|CONNRESET|CONNREFUSED|HOSTUNREACH|NETUNREACH)$/.test(
    err?.code || '',
  )
    ? 'unknown'
    : 'failed';
}
// Best-effort — a failed notification attempt must never throw back into
// the uncaughtException handler that calls this, or a notification bug
// could reintroduce the very crash-takes-down-everything problem this
// exists to report on.
export async function notifyCrash(err, job, config, sendMail = realSendMail) {
  if (!config.gmailAppPassword) return;
  try {
    await sendNotification(
      {
        subject: 'Hiwell · Sunucuda beklenmeyen bir hata oluştu',
        body: `Sunucu beklenmeyen bir hatadan kurtarıldı; çalışmaya devam ediyor.\n\nHata: ${err?.message || err}\n${
          job
            ? `Etkilenen tarama: ${job.id}\nKaynaklar: ${job.sources?.join(', ')}\nKorunan sonuç: ${job.rows?.length ?? 0}\n`
            : 'Belirli bir taramayla ilişkilendirilemedi.\n'
        }\nTarih: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} (İstanbul)\n\nSaatlik otomatik kontrol etkilenen taramayı tekrar deneyecek; elle bir şey yapmana gerek yok.`,
      },
      config,
      sendMail,
    );
  } catch {
    // Nothing more to do — see the comment above.
  }
}
// Lets an admin confirm, on demand, that crash/restriction alerts actually
// reach the two configured addresses — without waiting for a real crash or
// restriction to happen. Goes through the exact same payload/recipients as
// notifyCrash/notifyRestriction, just with a clearly test-labeled subject.
export async function notifyTest(config, sendMail = realSendMail) {
  if (!config.gmailAppPassword)
    return {
      status: 'failed',
      message: 'Önce Gmail uygulama şifresini kaydedin.',
    };
  try {
    await sendNotification(
      {
        subject: 'Hiwell · Bildirim testi',
        body: `Bu bir testtir; gerçek bir hata veya kısıt yok.\n\nSunucu çökme veya Instagram/TikTok kısıtı bildirimleri aynı şekilde şu adreslere gider: ${NOTIFICATION_RECIPIENTS.map((r) => r.email).join(', ')}\n\nTarih: ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} (İstanbul)`,
      },
      config,
      sendMail,
    );
    return {
      status: 'accepted',
      message: `Gmail (${GMAIL_SENDER.email}) test bildirimini kabul etti. İki adresin de gelen kutusunu (ve spam klasörünü) kontrol edin.`,
    };
  } catch (e) {
    return {
      status: outcomeFor(e),
      message: `Gmail gönderimi başarısız: ${e.message}`,
    };
  }
}
export async function notifyRestriction(
  job,
  config,
  save,
  sendMail = realSendMail,
) {
  if (!job.restrictedUntil || job.demo || job.restrictionNotification) return;
  if (!config.gmailAppPassword) {
    job.restrictionNotification = {
      status: 'unconfigured',
      message:
        'Kısıt emaili gönderilemedi: admin Gmail uygulama şifresini ayarlamalı.',
    };
    await save();
    return;
  }
  job.restrictionNotification = {
    status: 'sending',
    attemptedAt: new Date().toISOString(),
  };
  await save(); // Persist before sending to avoid duplicate messages after a restart.
  const platform = job.platform === 'tiktok' ? 'TikTok' : 'Instagram';
  try {
    await sendNotification(
      {
        subject: `Hiwell · ${platform} taraması kısıt nedeniyle durdu`,
        body: `${platform} işlem kısıtlaması algılandı.\n\nTarama: ${job.id}\nKaynak hesaplar: ${job.sources.join(', ')}\nKorunan sonuç: ${job.rows.length}\nUygulamanın bekleme bitişi: ${new Date(job.restrictedUntil).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} (İstanbul)\n\n${job.message}\n\nTarama otomatik yeniden başlamaz. ${platform} üzerindeki kısıtın kalktığını kontrol edin.`,
      },
      config,
      sendMail,
    );
    job.restrictionNotification = {
      ...job.restrictionNotification,
      status: 'accepted',
      message: 'Kısıt bildirimi Gmail üzerinden gönderildi.',
    };
  } catch (e) {
    job.restrictionNotification = {
      ...job.restrictionNotification,
      status: outcomeFor(e),
      message: `Kısıt bildirimi gönderilemedi: ${e.message}`,
    };
  }
  await save();
}

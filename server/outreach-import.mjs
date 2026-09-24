import { parse } from 'csv-parse/sync';
import { validEmail } from './outreach.mjs';

export function parseContacts(input) {
  let records;
  if (input.mode === 'manual') {
    records = [[input.name || '', input.email || '']];
  } else if (input.mode === 'csv') {
    if (
      typeof input.csv !== 'string' ||
      Buffer.byteLength(input.csv) > 1024 * 1024
    )
      throw new Error('CSV en fazla 1 MB olabilir.');
    let table;
    try {
      const first = input.csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
      table = parse(input.csv, {
        bom: true,
        delimiter: first.includes(';') ? ';' : ',',
        skip_empty_lines: true,
        trim: true,
        max_record_size: 10000,
      });
    } catch {
      throw new Error('CSV okunamadı. Sütunları ve tırnakları kontrol edin.');
    }
    if (!table.length) throw new Error('CSV boş.');
    const headers = table.shift().map((h) => h.trim().toLocaleLowerCase('tr'));
    const email = headers.findIndex((h) =>
      ['email', 'e-mail', 'e-posta', 'eposta'].includes(h),
    );
    const name = headers.findIndex((h) =>
      ['name', 'isim', 'ad', 'ad soyad', 'ad_soyad'].includes(h),
    );
    if (email < 0)
      throw new Error(
        'CSV içinde email başlıklı bir sütun olmalı. İsim sütunu isteğe bağlıdır.',
      );
    records = table.map((r) => [name < 0 ? '' : r[name], r[email]]);
  } else throw new Error('Geçersiz ekleme yöntemi.');
  if (!records.length || records.length > 500)
    throw new Error('Tek seferde 1–500 kişi ekleyebilirsiniz.');
  const rows = [],
    rejected = [];
  records.forEach(([name, email], index) => {
    email = String(email || '')
      .trim()
      .toLowerCase();
    name = String(name || '').trim();
    if (
      !validEmail(email) ||
      email.length > 254 ||
      /[,"\\]/.test(email) ||
      name.length > 200 ||
      /[\r\n]/.test(name)
    ) {
      rejected.push(
        `Satır ${index + (input.mode === 'csv' ? 2 : 1)}: email veya isim geçersiz.`,
      );
      return;
    }
    rows.push({
      username: email,
      fullName: name || email,
      email,
      platform: 'manual',
    });
  });
  return { rows, rejected };
}

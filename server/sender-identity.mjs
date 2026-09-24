const address = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';
const valid = (value) =>
  value.length <= 254 &&
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(
    value,
  );
export function validateMailIdentity(input = {}) {
  const personalEmail = address(input.personalEmail);
  if (!Array.isArray(input.senderEmails) || input.senderEmails.length > 20)
    throw new Error('En fazla 20 gönderen adresi tanımlayın.');
  const aliases = input.senderEmails.map(address);
  if (
    (!personalEmail && aliases.length) ||
    (personalEmail && !valid(personalEmail)) ||
    aliases.some((email) => !valid(email))
  )
    throw new Error('Geçerli bir kişisel email ve gönderen adresleri girin.');
  return {
    personalEmail,
    senderEmails: [...new Set([personalEmail, ...aliases].filter(Boolean))],
  };
}
export function defaultMailIdentity(username) {
  const addresses =
    {
      melisa: ['melisa.onen@hiwellapp.com', 'melisa@hiwellapp.com'],
      isil: ['isil.budak@hiwellapp.com', 'isil@hiwellapp.com'],
    }[username] || [];
  return { personalEmail: addresses[0] || '', senderEmails: addresses };
}
export function senderIdentity(user, config) {
  const identity = user?.mailIdentity || defaultMailIdentity('');
  if (user?.role === 'admin' && !identity.personalEmail && config.fromEmail)
    return {
      personalEmail: config.fromEmail,
      senderEmails: [config.fromEmail],
    };
  return identity;
}
export function resolveSender(user, fromEmail, config) {
  if (!user || user.disabled) throw new Error('Tekrar giriş yapın.');
  const identity = senderIdentity(user, config);
  const selected = address(fromEmail);
  if (!identity.personalEmail || !identity.senderEmails.includes(selected))
    throw new Error(
      'Kullanıcınıza tanımlı bir gönderen adresi seçin. Admin, Kullanıcılar ekranından adres tanımlayabilir.',
    );
  return {
    ...config,
    fromEmail: selected,
    fromName: user.name,
    replyTo: identity.personalEmail,
    actorId: user.id,
  };
}

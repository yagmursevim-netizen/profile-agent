'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function TikTokConnection({
  connected,
  paired,
}: {
  connected: boolean;
  paired: boolean;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function pair(revoke: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/tiktok/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revoke }),
      });
      const value = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(value.error);
      setKey(value.token || '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-section">
      <h3>TikTok · Normal Chrome agent</h3>
      <p>
        {connected
          ? 'Agent bağlı · Kuyruktaki TikTok işleri otomatik alınır.'
          : paired
            ? 'Eşleştirme var · Chrome’daki Agent ekranından bağlanın.'
            : 'Önce eklentiyi eşleştirin.'}
      </p>
      <p>
        Ana bilgisayarda TikTok’a giriş yaptığınız Chrome’a eklentiyi kurun.
        Eklentiden Agent ekranını açın ve aşağıdaki anahtarı yapıştırın. Agent
        ekranı açık kalmalı.
      </p>
      <Button disabled={busy} onClick={() => void pair(false)}>
        {paired
          ? 'Yeni eşleştirme anahtarı oluştur'
          : 'Eşleştirme anahtarı oluştur'}
      </Button>
      {paired && (
        <Button variant="ghost" disabled={busy} onClick={() => void pair(true)}>
          Eşleştirmeyi kaldır
        </Button>
      )}
      {key && (
        <>
          <label htmlFor="tiktok-pair-key">
            Anahtar · Yalnızca kendi Chrome eklentinize girin
          </label>
          <Input
            id="tiktok-pair-key"
            value={key}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <p>
            Bu anahtar yalnızca şimdi gösterilir. Yeni anahtar eskisini geçersiz
            kılar.
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

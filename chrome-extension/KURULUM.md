# TikTok 2.2 — Kullanıcı listesi + Playwright

1. Yeni uygulama dosyalarını mevcut IG Agent klasörüne kopyalayın. .local ve .env korunmalı.
2. Terminal'de npm install, ardından IG_BROWSER_CHANNEL=chrome npm run lan çalıştırın.
3. Normal Chrome'da chrome://extensions → Hiwell eklentisi → Reload. Sürüm 2.2.0 olmalı.
4. Eklentinin eski Agent sekmesini kapatın. Eklenti → Liste toplama ekranını aç.
5. Mevcut eşleştirme anahtarı kayıtlıysa Agent'ı bağla düğmesine basın. Yoksa Hiwell → Bağlantılar → TikTok bölümünden yeni anahtar oluşturup buraya yapıştırın.
6. Hiwell → TikTok → Takip ettikleri hesapları incele. Tek kaynak hesap girin; ilk denemede sınırı 5 yapın.
7. Taramayı kuyruğa ekle.

Eklenti normal Chrome'da kaynak hesabın following listesini açar ve yalnızca kullanıcı adlarını toplar. Liste uygulamada kaydedildikten sonra Playwright ayrı pencerede hedef profilleri açıp bio ve sayıları okur. Sonuçlar otomatik kaydedilir.

Sonuç ekranındaki Kullanıcı adları CSV bağlantısından listeyi indirebilirsiniz. Playwright erişim sorunu yaşarsa liste kaybolmaz; CSV'yi doğrudan profil taraması olarak tekrar verebilirsiniz.

Ana bilgisayar, normal Chrome'daki liste toplama ekranı ve uygulama açık kalmalı. Playwright, normal Chrome'daki TikTok girişini devralmaz; giriş veya doğrulama isterse bunu tarama hatasında göreceksiniz. Gerçek TikTok oturumunda bu karma akış henüz doğrulanmadı.

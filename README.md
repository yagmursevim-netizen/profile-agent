# Hiwell Partner Studio

Instagram profil keşfi ve ekip iletişimi için yerel web uygulaması. Aynı ağdan ortak kullanım için [LAN kurulum rehberini](LAN-KURULUM.md) izleyin. Türkçe arayüz, kullanıcı adı / CSV girişi, takip edilen hesapları tarama veya doğrudan profil inceleme, filtreler, Excel ve CSV indirme, isteğe bağlı yerel AI değerlendirmesi.

## Çalıştırma

Node.js 22.13 veya üstü gerekir. İlk kurulum:

```sh
npm install
npm run browser:install
npm run dev
```

Uygulama: **http://127.0.0.1:3000**. Yerel veri servisi `127.0.0.1:4318` üzerinde çalışır. İki süreç tek komutla başlar; Ctrl+C ile kapanır. Instagram ve ilk paket/model indirmeleri internet gerektirir. Uygulama deploy edilmemiştir.

1. **Bağlantılar → Instagram penceresini aç**. Açılan Chromium penceresinde hesabınıza giriş yapın; varsa iki aşamalı doğrulamayı tamamlayın. Şifre uygulama tarafından alınmaz. Önceden kaydedilen oturumu yeniden açmak için de bu düğmeyi kullanın.
2. Kullanıcı adlarını veya profil URL’lerini girin. Alternatif olarak `username`, `kullanıcı adı` veya `url` sütunlu CSV yükleyin. Virgül ve noktalı virgül desteklenir. Tamamen geçersiz girişlerde satır atlamak yerine hata verilir. Tek sütunlu, başlıksız kullanıcı adı listesi de kabul edilir.
3. **Takip ettikleri hesapları incele** veya **Girilen hesapları doğrudan incele** seçin. Kaynak başına varsayılan ve azami sınır 5.000, toplam tarama üst sınırı 5.000 farklı profildir. Kaynak hesabın takipçi sayısı 5.000 üzerindeyse uyarı gösterilir; takip ettiği hesap sayısı sınırı aşıyorsa listenin kısmi alınacağı ayrıca belirtilir. Birden fazla kaynakta toplam sınıra ulaşılırsa kalan kaynaklar açılmaz. Hesaplar tekilleştirilir.
4. Sonuçları filtreleyin. **Excel indir** gerçek `.xlsx` çalışma kitabı üretir (eski `.xls` değil). Kullanıcı adı hücreleri Instagram bağlantılarıdır; sayılar sayısal hücrelerdir. CSV de indirilebilir. Yalnızca filtrelerle eşleşen tüm sonuçlar dışa aktarılır; sayfalama indirmeyi sınırlamaz.

Arayüzdeki **Örnek sonuçları keşfet** seçeneği, sahte olduğu açıkça işaretli altı profil getirir. Instagram’a bağlanmaz, AI çağırmaz. Örnek yorumlar gerçek değerlendirme değildir.

## Yedi sütun

1. Tıklanabilir kullanıcı adı
2. Yalnızca bio içinde bulunan email adresleri; yoksa `null`
3. Takipçi sayısı
4. Takip ettiği kişi sayısı
5. Açık / kilitli / bilinmiyor
6. Bio tam metni (tabloda önizleme; tıklayınca tam metin)
7. Hiwell affiliate AI ön değerlendirmesi

Filtreler: kullanıcı / bio / email araması, email bulunanlar, yalnızca açık hesaplar, minimum takipçi ve AI uygunluk sınıfı. Eksik sayılar `0` olarak uydurulmaz. Arayüzde `—`, dışa aktarmada `null` görünür. Bilinmeyen hesap durumu, açık hesap filtresinden geçmez.

## Yerel AI

[Ollama](https://docs.ollama.com/quickstart) kurup bir sohbet modeli yükleyin ve çalıştırın. Uygulama `http://127.0.0.1:11434/api/tags` üzerinden yüklü modelleri listeler. **Bağlantılar** bölümünde modeli seçin. Önceden toplanmış gerçek sonuçları **AI ile değerlendir** düğmesiyle de değerlendirebilirsiniz.

Yerel modele bio, takipçi / takip edilen sayıları, hesap durumu ve email bulunup bulunmadığı gönderilir. Email adresinin kendisi gönderilmez. Modelden yapılandırılmış `Uygun aday`, `İncelenmeli` veya `Uygun değil` sonucu ve gerekçe alınır. Model yoksa yorum uydurulmaz; `Değerlendirilmedi` yazılır. AI bağlantı hataları satırda ve Excel’in tarama notlarında görünür. Her profil için 120 saniye zaman aşımı vardır.

Değerlendirme yalnızca beyan edilen profesyonel rol, içerik konusu, erişim ve iletişim gibi verilere dayanır. Kişinin ruh sağlığı, tanısı veya terapi ihtiyacı çıkarılmaz. Etkileşim oranı, gerçek takipçi, hedef kitle ve kampanya koşulları doğrulanmadığından sonuçlar insan incelemesi gerektirir. Kampanya kriterleri `server/ai.mjs` içinde düzenlenebilir.

## Instagram bağlantısının sınırları

Playwright, kullanıcıya görünen ayrı bir Chromium oturumunda profil ve takip listesi sayfalarını açar. Profil için yalnızca sayfaya teslim edilen JSON yanıtları ve JSON script verileri okunur; özel API endpoint’leri çağrılmaz. Takip listesi diyalogundaki görünür profil bağlantıları kaydırılarak toplanır. Ağ/UI değişikliklerinde adaptörün güncellenmesi gerekebilir.

- Giriş, challenge veya işlem kısıtlaması durumunda tarama durur. CAPTCHA veya erişim kontrolü aşılmaz.
- Kilitli hesapların gizli içerikleri alınmaz. Oturumun erişebildiği profil alanlarıyla yetinilir.
- Instagram listeyi sınırlandırabilir; kaynak başına sınır ve liste tamlığı uyarıları kaydedilir. Takip listesi taramaları bu yüzden notlarla/kısmi olarak tamamlanabilir.
- Profil hataları diğer profillerin işlenmesini engellemez. Okunamayan alanlar ve hata gerekçeleri korunur.
- Durdurma mevcut sayfayı kapatır; tamamlanmış satırlar kaybolmaz. Sunucu yeniden başlatılırsa yarım işler `Yarıda kaldı` olarak görünür; otomatik yeniden başlatılmaz.
- Canlı Instagram taraması kullanıcı oturumu gerektirir. Kurulum sırasında oturum olmadan canlı hesaplardan veri doğrulanamaz. Yerel AI çıktısı da kurulu bir model gerektirir.

Oturum `/.local/instagram-session`, sonuçlar `/.local/jobs.json` içinde, bu proje dizinine göre saklanır. `.local` Git dışında tutulur. Bu dosyaları paylaşmayın. Uygulama yalnızca loopback adresinde dinler; API Host/Origin doğrulaması yapar, uzak web sitelerinden gelen yazma isteklerini reddeder. CSV formül enjeksiyonu önlenir. Sonuçları silmek için uygulama kapalıyken `.local/jobs.json`, oturumu sıfırlamak için `.local/instagram-session` kaldırılabilir.

## Geliştirme ve doğrulama

```sh
npm test
npm run typecheck
npm run build
```

React/Vinext + Shadcn arayüz, Node.js yerel servis, Playwright, ExcelJS, csv-parse. `server/instagram.mjs` platform adaptörü; `server/domain.mjs` doğrulama / filtreleme; `server/ai.mjs` AI değerlendirmesi. Testler CSV sınırlarını, null alanları, filtreleri, formül güvenliğini ve gerçek API üzerinden Excel içeriğini / bağlantılarını doğrular. API testleri geçici bir veri dizini ve rastgele loopback portu kullanır; kullanıcı verilerine ve Instagram’a dokunmaz.

`npm run build` frontend derlemesini doğrular. Gündelik yerel kullanım için `npm run dev` kullanın; scaffold’ın `start` komutu tek başına Node veri servisini başlatmaz. Deploy mimarisi bu aşamada kapsam dışıdır; tarayıcı otomasyonu kalıcı bir Node çalışma ortamı gerektirir.

Kaynaklar: [Playwright oturum saklama](https://playwright.dev/docs/auth), [Ollama Chat API](https://docs.ollama.com/api/chat), [Hiwell](https://www.hiwellapp.com/en).

## Email çalışma alanı ve API ayarları

**Bağlantılar → OpenAI & SendGrid** bölümünde OpenAI API key, model, SendGrid bearer token ve doğrulanmış gönderen adresini kaydedin. Anahtarlar `.local/settings.json` dosyasında yalnızca mevcut kullanıcıya okuma/yazma izniyle saklanır; API yanıtlarına ve frontend kaynaklarına eklenmez. Dosya şifreli değildir ve Git dışında tutulur. Alternatif olarak `.env.example` dosyasını `.env` olarak kopyalayıp doldurun, sunucuyu yeniden başlatın. Arayüzde kaydedilen değerler ortam değişkenlerinden önceliklidir. Boş anahtar alanı mevcut anahtarı değiştirmez.

AI tarama sırasında otomatik çalışmaz. Bir profilin **AI değerlendir** düğmesini veya seçili profiller için toplu değerlendirmeyi kullanın. Varsayılan sağlayıcı OpenAI, model `gpt-5-mini`; model değiştirilebilir. OpenAI seçildiğinde bio ve profil sayıları OpenAI Responses API'ye gönderilir (`store:false`); bu işlem API kullanımınıza yansır. Ollama alternatifi korunur. Cinsiyet uygunluk değerlendirmesi için kullanılmaz.

**Email & DM listesi**:

1. Keşif tablosunda profilleri seçip **İletişim listesine ekle** düğmesine basın. Email olmayan ancak iş birliği için DM belirtenler DM adayı olarak eklenir; iki iletişim yolu da olmayanlar gerekçesiyle atlanır. Tekrarlanan kullanıcı/adresler yeniden eklenmez. Birden fazla email varsa ilk adres seçilir; alıcı düzenleyicisinde alternatifler görünür.
2. **Şablonlar** sekmesinde ad, konu ve düz metin içeriği ekleyin veya düzenleyin. `{{isim}}` profilin görünen adını, `{{ad}}` bu adın ilk kelimesini, `{{kullanici_adi}}` kullanıcı adını, `{{email}}` alıcı adresini doldurur. Ad yoksa kullanıcı adı kullanılır. Hitap adı alıcı düzenleyicisinden değiştirilebilir; marka hesaplarının görünen adını insan adı sanmayın.
3. Tek kişiye şablon seçebilir veya kutucuklarla bir grup seçip toplu atayabilirsiniz. **Sıradaki şablonsuzları seç** alanına 30 girip Şablon 1 atayın; sonra 20 girip Şablon 2 atayın. Önceki atamalar korunur. Arama uygulanmışsa seçim arama sonuçlarıyla sınırlıdır.
4. Seçilenleri **Önizle ve gönder** ile inceleyin. Her alıcının kişiselleştirilmiş konu ve gövdesi listelenir. Son gönderim düğmesi `POST https://api.sendgrid.com/v3/mail/send` çağrısını kişi başına ayrı yapar; alıcılar birbirini görmez. Örnek kayıtların gerçek gönderimi engellenir.
5. `202` yanıtı **SendGrid kabul etti** olarak görünür; teslimat onayı değildir. Ağ kesintisi/zaman aşımı/5xx halinde **Sonuç belirsiz** gösterilir ve otomatik yeniden gönderilmez. Bu durum SendGrid kayıtlarından kontrol edilmelidir. Aynı kayıt kabul edildikten sonra tekrar gönderilemez. Şablon veya alıcı değişirse eski önizlemeden gönderim engellenir. Kayıtlar `.local/outreach.json` içinde saklanır.

**Profil sinyalleri**: İş birliği ile DM ifadesi aynı bio bölümünde açıkça geçiyorsa işaretlenir. **DM ile iş birliği** filtresi emaili olmayan adayları da gösterir. Email & DM listesinde iletişim kanalını seçebilir, DM adayının profil bağlantısını açabilirsiniz. Uygulama DM göndermez. Emaili olmayanlara email şablonu atanamaz ve SendGrid gönderimi yapılamaz. Daha sonra alıcıyı düzenleyip email eklerseniz email akışı kullanılabilir.

Bio dili yerel olarak belirlenir: kısa metinlerde ayırt edici sözcükler; yeterince uzun metinlerde franc-min dil analizi kullanılır. Biçimlendirilmiş Unicode yazılar normalleştirilir; linkler, email adresleri ve @kullanıcı adları dil hesabından çıkarılır. Birden fazla dil için yeterli kanıt varsa **Çok dilli**, yetersiz/kararsız metinlerde **Bilinmiyor** gösterilir. Dil sonucu bir metin tahminidir, milliyet değildir; isimden dil belirlenmez. Cinsiyet yalnızca açık öz beyanlardan okunur, isim veya fotoğraftan tahmin edilmez. Dayanaklar detay penceresinde ve Excel/CSV'de bulunur. Eski sonuçlar sunucu başlangıcında yeni kurallarla zenginleştirilir; bunun için Instagram'a istek veya OpenAI çağrısı yapılmaz.

Entegrasyon kaynakları: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [SendGrid Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send).

## Uygulama girişi ve kullanıcı yönetimi

İlk çalıştırmada **admin**, **melisa** ve **isil** (görünen adı Işıl) oluşturulur. Her kurulumda farklı, rastgele geçici şifreler `.local/ilk-giris.txt` dosyasına yazılır. Bu dosyayı yalnızca bilgisayarın sahibi açmalı; ilgili kişiye giriş bilgisini güvenli şekilde ilettikten sonra silmelidir. İlk girişte en az 12 karakterlik yeni şifre zorunludur. Şifre değiştikten sonra yeniden giriş yapılır.

- Tek admin, **Kullanıcılar** ekranından ekip üyesi ekler, geçici şifre oluşturur veya kullanıcıyı devre dışı bırakır. Bu işlemler ilgili kullanıcının açık oturumlarını geçersiz kılar. İkinci admin oluşturulamaz.
- Melisa, Işıl ve eklenen ekip üyeleri aynı tarama/AI/email çalışma alanını paylaşır. API anahtarlarına, bağlantı ayarlarına, Instagram giriş penceresini açma işlemine ve kullanıcı yönetimine erişemezler. Yetki kontrolü tüm API isteklerinde sunucuda yapılır.
- **Şifrem** ile herkes kendi şifresini değiştirebilir; **Çıkış** oturumu kapatır. Oturumlar 30 dakika kullanılmadığında veya en fazla 8 saat sonra sona erer. Sunucu yeniden başlayınca tekrar giriş gerekir. Şifreler tuzlanmış scrypt özetleri olarak saklanır. Oturum çerezi HttpOnly ve SameSite=Strict kullanır; mevcut HTTP loopback kurulumunda Secure kullanılmaz. HTTPS ve dağıtım güvenliği deploy aşamasının kapsamındadır.
- Giriş denemeleri sınırlıdır. Varsayılan herkesçe bilinen bir şifre yoktur. Kurulum dosyası ve `.local` içeriği ZIP paketine dahil edilmez. Yeni bilgisayarda yeni şifreler üretilir.
- Bu bir **yerel uygulama erişim sınırıdır**. Aynı işletim sistemi hesabıyla proje dosyalarını okuyabilen kişi `.local/settings.json` veya `.env` içindeki anahtarları da okuyabilir. Bu dosyalar şifreli değildir. Uygulama girişi işletim sistemi dosya izinlerinin yerine geçmez. Ayrı yerel kurulumlar kendi kullanıcı/veri kopyalarını tutar. Ortak ağ modunda tüm ekip ana Mac’in kullanıcı ve verilerini kullanır; LAN-KURULUM.md dosyasına bakın.

Instagram şifrelerini toplama, kısıtı aşmak için otomatik hesap değiştirme veya proxy/IP döndürme uygulanmaz. Giriş adminin açtığı Instagram penceresinde yapılır; kaydedilen oturum tekrar kullanılabilir. Instagram işlem kısıtı veya HTTP 429 bildirirse tarama durur, toplanan sonuçlar kalır. En az 30 dakika (Instagram daha uzun Retry-After bildirirse o süre boyunca) yeni tarama engellenir; bu bekleme sunucu yeniden başlatılsa da tarama kayıtlarından korunur. Süre bitince otomatik yeniden deneme yapılmaz ve kısıtın kalktığı varsayılmaz. Giriş/doğrulama isteği ile işlem kısıtı ayrı gösterilir.


## Tekrar taramayı önleme ve kısıt bildirimi

Daha önce başarıyla okunmuş gerçek profiller tekrar ziyaret edilmez. Önceki sonuç yeni taramaya kopyalanır; orijinal toplanma tarihi korunur ve **Kayıttan** etiketi görünür. Eksik/hatalı veya örnek kayıtlar gerçek profil önbelleği sayılmaz. Kaydedilmiş takip listesi istenen sınırı karşılıyorsa kaynak hesap da yeniden açılmaz. Eski tek kaynaklı tamamlanmış taramalar da kullanılabilir; eski çok kaynaklı taramalarda kaynak-listesi eşleşmesi yoksa takip listesi yeniden okunur, bulunan profiller yine kayıttan kullanılır. Bu sürümde kayıtların otomatik son kullanma süresi yoktur; sayılar/bio önceki tarama tarihine aittir. Tamamı kayıtlı veriden karşılanabilen işler Instagram oturumu olmadan ve kısıt beklemesi sırasında da çalışır.

**Yeni bir Instagram işlem kısıtı oluştuğunda**, `gani.somuncu@hiwellapp.com` adresine mevcut SendGrid bağlantısıyla bir bildirim denenir. Email tarama kimliği, kaynak hesaplar, korunan sonuç sayısı, kısıt açıklaması ve bekleme bitişini içerir; profil bio metinlerini ve anahtarları içermez. Aynı kısıtlı tarama için tekrar email gönderilmez. `202` kabul anlamına gelir, teslimat onayı değildir. Anahtar eksikse veya gönderim başarısız/belirsizse tarama ekranında açıkça gösterilir. Sunucu kapalıyken email gönderilemez; eski kısıtlar başlangıçta yeniden bildirilmez. Ağ sonucu belirsizse otomatik tekrar denenmez. Bildirim testleri sahte gönderici kullanır, gerçek email göndermez.

## SendGrid test emaili

Admin olarak **Bağlantılar → OpenAI & SendGrid → Test emaili gönder** alanını kullanın. Önce SendGrid token ve doğrulanmış gönderen adresini kaydedin. Test alıcısı varsayılan olarak `gani.somuncu@hiwellapp.com` gelir; değiştirilebilir. **Test emaili gönder** düğmesi yalnızca yazdığınız adrese sabit bir bağlantı testi mesajı gönderir; kampanya listesine dokunmaz.

Sonucun kabul edildiği, reddedildiği veya belirsiz olduğu ekranda gösterilir. SendGrid 202 yanıtı teslimat onayı değildir; gelen kutusu ve spam klasörünü kontrol edin. Son test yeniden açılışta da görünür. Aynı istek tekrar gönderilmez; yeni testler arasında 30 saniye beklenir. Anahtar/gönderen formunda değişiklik varsa önce kaydetmeniz gerekir. Test kayıtları `.local/email-tests.json` içinde tutulur, API anahtarını içermez. Kullanıcı ve ağ yetki kontrolleri bu uç noktada da uygulanır.


## Kullanıcıya özel gönderen adresleri

Admin, **Kullanıcılar → Email adresleri** bölümünden her kullanıcının kişisel emailini ve ek gönderen adreslerini kaydeder. Kişisel adres de gönderen seçeneklerine eklenir. Yeni kullanıcı oluşturduktan sonra aynı bölümden adreslerini tanımlayın.

Melisa için kişisel adres `melisa.onen@hiwellapp.com`, ek adres `melisa@hiwellapp.com`; Işıl için kişisel adres `isil.budak@hiwellapp.com`, ek adres `isil@hiwellapp.com` ilk güncellemede otomatik tanımlanır. Sonraki düzenlemeler korunur; şifreler değişmez.

**Email & DM listesi → Gönderen email adresi** alanından adres seçin. Tekli ve toplu önizlemelerde bu adres kullanılır. **Reply-To her zaman kullanıcının kişisel adresidir**; gönderim ekranından değiştirilemez. Adresler SendGrid gönderim yetkisine sahip olmalıdır. Admin kendi adreslerini henüz tanımlamamışsa genel bağlantı adresi kullanılır. Bağlantı testi ve otomatik kısıt bildirimleri genel bağlantı adresini kullanmayı sürdürür.

Güncellemede mevcut `.local` klasörünü ve `.env` dosyasını koruyun; kullanıcılar, kayıtlar ve LAN sertifikaları burada saklanır. Yeni dosyalarla `npm install` ardından `npm run lan` çalıştırın.

## TikTok taraması

**Yeni keşif → Platform → TikTok** seçin. **Anahtar kelimeyle hesap ara** modunda her satıra bir ifade yazın (ör. yoga, wellness); **Girilen hesapları doğrudan incele** modunda kullanıcı adı, `tiktok.com/@kullaniciadi` bağlantısı veya CSV kullanın. Kaynak başına varsayılan sınır 5.000; tüm taramada en fazla 5.000 farklı profil işlenir. TikTok takip edilenler listesi, Chrome agent 2.1 ile desteklenir.

Admin **TikTok oturumunu aç** ile ana bilgisayardaki ayrı tarayıcı penceresinde giriş yapabilir. Oturum `.local/tiktok-session` altında saklanır. Google Chrome kullanan kurulumlarda mevcut `IG_BROWSER_CHANNEL=chrome` ayarı TikTok için de geçerlidir; istenirse `TIKTOK_BROWSER_CHANNEL=chrome` ayrıca tanımlanabilir.

Tarayıcıda yüklenen profil verileri okunur. Arama sonuçları oturuma göre değişebilir; yüklenmeyen sonuçlar ve eksik profil alanları tahmin edilmez. CAPTCHA/giriş doğrulaması veya istek kısıtı algılanırsa tarama durur; admin tarayıcıdan kontrol etmelidir. Kısıt bildirimleri mevcut email akışını kullanır. Instagram ve TikTok bekleme süreleri, profil önbellekleri ve tarayıcı oturumları ayrıdır.

Bio emaili, iş birliği için DM, dil, filtreler, butonla AI değerlendirmesi, email listesi ve Excel/CSV çıktıları TikTok profillerinde de kullanılabilir. Platform sütunu Excel/CSV'ye eklenmiştir; profil bağlantıları TikTok'a gider. Aynı email adresine mükerrer gönderimi önleyen mevcut liste kuralı korunur.

Otomatik testler örnek TikTok veri yapılarıyla çalışır; gerçek TikTok oturumundaki arama ve profil erişimi ayrıca doğrulanmalıdır. TikTok sayfa yapısındaki değişiklikler veri okumayı etkileyebilir.

## Normal Chrome ile TikTok profil aktarımı

Ayrı tarayıcıda giriş sorunu yaşayan kullanıcılar **chrome-extension** klasöründeki eklentiyi normal Chrome'a kurabilir. Ayrıntılı adımlar: **chrome-extension/KURULUM.md**.

Eklenti kullanıcı tıklamasıyla açık TikTok profilini okur; profil önizlemesinden JSON dosyası indirir. Uygulamada **Platform → TikTok → TikTok profili aktar** alanından bu dosya seçilir. Uygulama girişi gereklidir. Aynı platformdaki kayıtlı profil tekrar eklenmez. Email, DM ve dil sinyalleri sunucuda yeniden hesaplanır. Eklenti şifre, çerez ve bağlantı anahtarlarına erişmez; normal Chrome oturumu yerinde kalır. Bu ilk sürüm tek profil aktarımıdır; gerçek TikTok sayfasında kullanıcı doğrulaması gereklidir.

## İş kuyruğu ve ekip performansı

**Kuyruk & Performans** sekmesinde bekleyen iş sayısı, sıra, kullanıcı, platform ve durum görünür. Tarama/AI ve email işleri iki bağımsız sıraya girer. Her sırada aynı anda bir iş çalışır; email taramayı beklemez. Sıra numarası kendi kuyruğuna aittir. Eski bekleyen işler türlerine göre otomatik ayrılır; kayıtlar korunur. Kullanıcılar başkasının işinin bitmesini beklemeden yeni iş bırakabilir. Kuyruk en fazla 200 bekleyen iş kabul eder. İşi yalnızca sahibi veya admin iptal edebilir.

Kuyruk `.local/queue.json` dosyasında saklanır. Uygulama yeniden açıldığında bekleyen işler devam eder. Kapanış sırasında çalışan işler yarıda kalmış olarak işaretlenir; otomatik tekrar gönderim/tarama yapılmaz. Platform kısıtı başladığında sıradaki ilgili işler çalıştırılmadan engellenir; kısıt kalktıktan sonra yeni iş oluşturun. Devre dışı kullanıcıların işleri çalıştırılmaz.

Email önizlemesindeki metin, alıcı ve gönderen seçimi kuyruğa alınırken sabitlenir. Bekleyen alıcılar yeniden gönderime seçilemez. Gönderen yetkisi iş başlarken tekrar kontrol edilir. İptal, devam eden tek email isteğinin sonucunu bekler ve kalan emailleri durdurur; kabul edilmiş emailler geri alınamaz. SendGrid 202 kabulüdür; teslimat, açılma ve tıklanma bilgisi değildir. Yeni gönderim denemeleri kullanıcı ve platform bilgisiyle kaydedilir.

Performans raporu tüm zamanları kapsar. Kullanıcı/platform filtresiyle verilen kaynak hesaplar, arama ifadeleri, işlenen kayıtlar, yeni tarama, önbellek, dosya aktarımı, hatalı kayıt, tekil profil, email/DM bulunan profil ve email gönderim durumları görülebilir. Bir profil hem email hem DM sayısına dahil olabilir. DM sayısı gönderilen mesaj değildir. Aynı kişinin aynı platformdaki profilleri tekilleştirilir; kullanıcı toplamlarının toplamı ekip çapında tekil profil sayısı değildir. Eski kayıtlarda bulunmayan iş sahibi tahmin edilmez. Geçmiş email denemeleri tam kaydedilmediğinden eski veriler son gönderim kaydıyla sınırlıdır.

Güncellerken `.local` ve `.env` korunmalıdır. ZIP bu dosyaları ve kullanıcı şifrelerini içermez.

## TikTok Agent 2.0 — Otomatik Chrome bağlantısı

TikTok arama ve profil taramaları artık normal Chrome eklentisi üzerinden yürür. Ayrı Playwright TikTok girişi kullanılmaz. Eklentinin Agent ekranı ana bilgisayarda açık kalır; mevcut kuyruğun istediği arama/profil işlemlerini kendi TikTok sekmesinde gerçekleştirir ve sonuçları otomatik iletir. Eşleştirme ve toplu kullanım: **chrome-extension/KURULUM.md**.

Admin Bağlantılar bölümünden tek sefer gösterilen eşleştirme anahtarı oluşturur. Sunucu anahtarın yalnızca hash'ini .local/tiktok-bridge.json içinde saklar. Eklenti anahtarı kendi yerel alanında saklar; TikTok sayfalarına aktarmaz. Yetki yalnızca /api/tiktok/bridge uç noktalarında komut alma ve sonuç verme içindir; kullanıcı/SendGrid/OpenAI ayarlarına erişmez. Anahtar yenileme veya kaldırma eski bağlantıyı iptal eder. Eklenti sadece ana bilgisayardaki 127.0.0.1:4318 API'ye bağlanır; LAN kullanıcıları işleri Hiwell üzerinden bırakır.

Kuyruk, kullanıcı sahipliği, kayıtlı tam profillerin tekrar kullanılmaması, Excel/CSV, AI butonları ve performans raporu korunur. Hata/kısıtta işlem durur; kısıt bitince otomatik devam etmez. Gerçek TikTok oturumunda küçük bir canlı denemeyle doğrulama gereklidir.


## TikTok following — Agent 2.1

TikTok seçildiğinde varsayılan tarama türü **Takip ettikleri hesapları incele** olur. Kaynak TikTok hesaplarını girin. Agent kaynak profili açar, Following düğmesine basar, açılan listeden kullanıcıları toplar ve listeyi kaydırır. Ardından kayıtlı tam profilleri önbellekten kullanır, kalanları sırayla tarar. Kaynak başına sınır ve toplam 5.000 hesap sınırı geçerlidir.

Gizli, açılamayan veya kullanıcı okunamayan liste boş kabul edilmez; tarama notunda açıklanır. Yalnızca profilde açıkça 0 takip edilen görünüyorsa boş liste sonucu verilir. Yüklenmesi duran listenin tamamlandığı varsayılmaz. Eklentiyi **2.1.0** sürümüne güncelleyin. İlk gerçek denemede tek kaynak ve sınır 5–10 kullanın. Gerçek TikTok sayfasındaki liste açma ve kaydırma henüz kullanıcı oturumunda doğrulanmamıştır.


## TikTok 2.2 — Eklenti liste toplar, Playwright profil okur

Yeni akış: kaynak hesap → Chrome eklentisinde following listesini toplama → kullanıcı adlarını tarama kaydına kaydetme → Playwright ile profilleri sırayla okuma. Eklenti bio veya profil sayılarını okumaz. Arama modu da kullanıcı adlarını eklentiden alır. Doğrudan profil/CSV taraması eklenti gerektirmeden Playwright'a gider.

Toplanan kullanıcı adları .local/jobs.json içindeki discoveredUsers ve kaynak listelerinde saklanır. Sonuç ekranındaki **Kullanıcı adları CSV** bağlantısı, bio okumaları tamamlanmadan da kullanılabilir. Playwright aşaması başarısız olursa indirilen CSV'yi Girilen hesapları doğrudan incele modunda kullanabilirsiniz; tam kayıtlı profiller tekrar ziyaret edilmez.

Playwright'ın TikTok oturumu normal Chrome oturumundan ayrıdır. TikTok profil okumada giriş/doğrulama isterse tarama durabilir; bu değişiklik TikTok'un erişim kısıtlarını kaldırmaz. Eklenti sürümü 2.2.0'dır. Uygulama ve eklentiyi birlikte güncelleyin. Önceki 2.0/2.1 profil okuma açıklamalarının yerini bu akış alır.

## Bio okunabilirliği ve kalan listeyle devam

TikTok profil verisinde bio metni yüklenmişse kayıt alınır ve sonraki hesaba geçilir; yalnızca giriş/doğrulama metni göründüğü için eldeki bio atılmaz. Açıkça boş bio geçerli bir sonuçtur. Bio okunamıyorsa tarama durur. Okunamayan hesap dahil kalan kullanıcılar aynı taramanın remainingUsers alanında korunur.

**İş günlüğü** sekmesindeki **Devam et (sayı)** düğmesi, iş sahibi veya admin tarafından kullanılır. İş yeniden kuyruğa girer; following listesini yeniden toplamadan kalan profillerden devam eder. Otomatik sınırsız yeniden deneme yapılmaz. Devam etmek platformdaki kısıtın kalktığını garanti etmez.

**Dashboard** ve **İş günlüğü** ayrı sekmelerdir. Dashboard kişi/platform performansını; iş günlüğü kuyruk, işlem durumları, hata ve devam kontrollerini gösterir. Headless'ın avantajı doğrulanmadığından mevcut görünür tarayıcı modu korunmuştur.

## TikTok hibrit profil okuması

Eklenti takip listesinden kullanıcı adlarını toplar. Playwright önce ağ/rehydration JSON verisini, ardından `data-e2e` profil HTML alanlarını okur. HTML birkaç kez beklenir. JSON'daki kesin sayılar korunur; yuvarlanmış sayılar ve bilinmeyen hesap gizliliği tahmin edilmez. Bio kaynağı ve bio bağlantısı sonuçlarda ve CSV/Excel çıktısında yer alır. Giriş/CAPTCHA görünse de okunabilen bio kaydedilir. Bio okunamıyorsa iş duraklar; kalan kullanıcılar İş günlüğü üzerinden devam ettirilebilir.

İsteğe bağlı ücretli yedek kaynak için ana bilgisayardaki `.env` dosyasına aşağıdaki alanları ekleyip uygulamayı yeniden başlatın:

```dotenv
SCRAPINGBEE_API_KEY=kendi_api_anahtariniz
TIKTOK_SCRAPINGBEE_ENABLED=true
TIKTOK_GOOGLE_ENABLED=true
```

Anahtar olmadan hiçbir dış servis isteği yapılmaz. Bu seçenekler varsayılan olarak kapalıdır. Her okunamayan profil için en fazla bir ScrapingBee HTML isteği, o da sonuç vermezse bir Google arama isteği yapılır. Servis hesabınızdaki krediler kullanılır. Oturum çerezleri veya uygulama parolaları servise gönderilmez; yalnızca hedef profil URL'si/arama sorgusu gönderilir. Anahtarı kullanıcılarla veya ZIP ile paylaşmayın. Entegrasyon: https://www.scrapingbee.com/documentation/ ve https://www.scrapingbee.com/documentation/google-api/

Google özeti yalnızca tam eşleşen TikTok profil URL'sinden kabul edilir. Eski/kesilmiş olabilir; ayrı alanda, doğrulanmadı etiketiyle saklanır. Bio, email, DM, cinsiyet veya takipçi alanlarını bu özetten otomatik doldurmayız. Özet tek başına bulunduğunda bio hâlâ okunamadığı için kuyruk duraklar; özet sonuçlarda/Excel'de korunur. Başarılı devam işleminde aynı profil satırı güncellenir. ScrapingBee/Google başarısı garanti değildir; gerçek servis anahtarıyla canlı doğrulama yapılmamıştır. Headless varsayılanı değiştirilmemiştir.

## Elle veya CSV ile email listesine kişi ekleme

Email & DM listesi sayfasındaki “Email listesine kişi ekle” bölümünü kullanın. Elle email ve isteğe bağlı ad soyad girilebilir. CSV için `email` zorunlu, `isim` veya `name` isteğe bağlı sütundur. Ekrandan örnek CSV indirilebilir. UTF-8 CSV, virgül/noktalı virgül ayırıcıları desteklenir; tek yükleme en fazla 500 kişi ve 1 MB'dır. Geçersiz satırlar ve tekrarlar sonuç mesajında listelenir. Kişiler taslak olarak saklanır; şablon atama, gönderen seçme ve önizleme mevcut akıştan yapılır. İçe aktarma email göndermez. Daha önce kabul edilmiş/belirsiz gönderim kayıtları tekrar eklenmez.

## Instagram headless denemesi

`IG_HEADLESS=true IG_BROWSER_CHANNEL=chrome npm run public` ile Instagram taramaları görünmez tarayıcıda çalışır. Kalıcı açmak için `.env` dosyasına `IG_HEADLESS=true` eklenebilir. Giriş düğmesi her zaman görünür pencere açar; sonraki tarama kayıtlı aynı oturumu headless kullanır. Mevcut iş bittikten sonra uygulamayı yeniden başlatın. Geri dönüş: `IG_HEADLESS=false IG_BROWSER_CHANNEL=chrome npm run public`. TikTok modu değişmez. Headless performans artışı ölçülmemiştir; profil arası 4 saniye bekleme ve Instagram kısıt kontrolleri korunur.

## Hızlı Instagram profil okuması

Varsayılan olarak açık: `IG_FAST_SCAN=true`. Sayfanın gömülü verisi hemen kontrol edilir; bio, sayılar ve gizlilik bilgisi geldiyse sabit 2,5 saniye beklenmez. Eksik alanlar için en fazla 10,5 saniye beklenir. Yalnızca profil tarama sayfalarında resim/video istekleri engellenir; script, fetch/XHR, stil dosyaları ve URL'sinde captcha/challenge/verify geçen kaynaklar korunur. Giriş penceresi ve takip listesi bu engellemeden etkilenmez. Sorun halinde `.env` içine `IG_FAST_SCAN=false` yazarak uygulamayı yeniden başlatın.

Biosu okunmuş, diğer alanları eksik profil kayıtları da tekrar kullanılabilir; eksik alanlar null ve mevcut uyarı olarak kalır. Bio okunamamış veya genel hatalı kayıtlar tekrar kullanılamaz. Kayıtlı sonuçların yeniden kullanımı hız karşılaştırmasını etkiler. Hesaplar arasındaki 4 saniye ara korunur. Gerçek hız artışı henüz ölçülmemiştir.

## Önceki email gönderimleri ve tekrar engeli

Email & DM listesi ekranındaki “Daha önce gönderilenler / gönderim geçmişi” bölümüne tek adres veya `email,isim` başlıklı UTF-8 CSV yükleyin (yükleme başına 500 satır / 1 MB). Bu adresler tüm kullanıcılar için ortak ve kalıcı tekrar gönderim engeline alınır. Taslak ve kuyruktaki ilgili kişiler engellenir; gönderimden hemen önce tekrar kontrol yapılır. Halihazırda SendGrid'e iletilen bir istek geri alınamaz. İçe aktarım kendisi email göndermez.

Gönderim geçmişinde alıcı, durum, gönderen uygulama kullanıcısı, gönderen adres ve tarih gösterilir. CSV/Excel indirilebilir; kabul edilen, sonucu belirsiz ve önceki gönderim olarak içe aktarılan kayıtlar ayrı durumlarıyla dışa aktarılır. SendGrid kabulü teslim edildi anlamına gelmez. Önceki listenin göndereni/tarihi bilinmiyorsa Bilinmiyor kalır; listeyi yükleyen kullanıcı ayrı “Kaydı ekleyen” alanında tutulur. Arşivlenen kişiler geçmişten ve engelleme kontrolünden silinmez.

## Tanımlı Instagram hesapları

Admin → Bağlantılar → Instagram oturum hesapları bölümünde kullanıcı adı ve şifre ekleyin, hesabı seçin. Her hesap `.local/instagram-sessions/<id>` altında ayrı oturum kullanır. Şifreler `.local/ig-accounts.json` içinde AES-256-GCM ile şifrelenir; çözme anahtarı yalnızca ana Mac'teki `.local/ig-accounts.key` dosyasındadır. İkisini de paylaşmayın. Eski tek hesap oturumu, yeni hesap tanımlanana kadar korunur.

Tarama başladığında tanımlı hesabın kayıtlı oturumu kullanılır; oturum yoksa giriş formu otomatik doldurulur. 2FA/CAPTCHA gerektiğinde admin ana Mac'teki görünür pencerede tamamlar. İlk girişte veya Instagram sayfa yapısı değiştiğinde otomatik giriş başarısız olabilir. Hesap geçişi ve otomatik giriş canlı Instagram üzerinde doğrulanmamıştır.

“Oturum sahibi hesabın askıya alındığı açıkça bildirilirse…” seçeneğini açarsanız, Instagram'ın hesap/doğrulama sayfasında açık askıya alma bildirimi algılandığında sıradaki etkin, askıya alınmamış hesaba geçilir. Aynı profil yeniden denenir. Askıya alınan hesap durumu ve geçiş kayıtları admin ekranında saklanır. Hedef profilin biosundaki benzer metin geçiş tetiklemez. Genel işlem/IP kısıtları, CAPTCHA ve sıradan giriş hatalarında otomatik hesap değişimi yapılmaz. Kullanılabilir hesap kalmazsa iş durur, toplanan veriler korunur. Yeni hesapların kısıtlanmayacağı garanti edilmez. Hesap ayarlarını değiştirmeden önce aktif taramayı durdurun.

Her hesaba isteğe bağlı, sabit (dönen/rotasyonlu değil) bir proxy tanımlanabilir: `http://host:port` veya `socks5://host:port` adresi, gerekirse ayrı kullanıcı adı/şifre alanlarıyla. Proxy şifresi de aynı anahtarla şifrelenir. Kaydetmeden önce **Proxy'yi test et** ile bağlantı Instagram'a ulaşacak şekilde doğrulanabilir. Amaç, her hesabın kendi sabit IP'sinden bağlanmasıdır; bu hem hesapları birbirinden ayrıştırır hem de tek IP'nin istek yükünü taşımasını önler. Oturum içinde IP'nin sık değişmesi (rotasyonlu proxy) ayrı bir kısıtlanma riskidir ve önerilmez. Proxy alanı boş bırakılırsa hesap doğrudan bağlanır.

Bu sürümü yerel ağda başlatma:

```sh
cd "$HOME/Desktop/IG Agent"
IG_BROWSER_CHANNEL=chrome npm run lan
```

Terminal'in yazdığı HTTPS ağ adresini kullanın, `127.0.0.1:3000` adresini kullanmayın. Güncellerken `.local` ve `.env` dosyalarını koruyun.

# Hiwell Partner Studio — aynı ağdan kullanım

Ana Mac uygulamayı ve Instagram tarayıcısını çalıştırır. Melisa, Işıl ve diğer ekip üyeleri kendi bilgisayarlarından tarayıcıyla bağlanır. Mevcut kullanıcılar, şifreler, sonuçlar ve şablonlar `.local` klasöründe korunur. Ağdaki istemcilere Node.js veya proje kurulmaz.

## 1. Ana Mac'i hazırlayın

Güncel proje dosyalarını ana Mac'e aktarın. **Mevcut `.local` klasörünü ve `.env` dosyasını silmeyin veya başka kurulumunkilerle değiştirmeyin.** Terminal'de `package.json` dosyasının bulunduğu proje klasörüne girin:

```sh
npm ci
```

Instagram için normal Chrome kullanıyorsanız `.env` dosyasına şu satırı ekleyin (diğer ayarları koruyun):

```env
IG_BROWSER_CHANNEL=chrome
```

Güncel Playwright'ın desteklediği macOS sürümü 14 ve üzeridir. macOS 13'te kurulu Chrome seçeneği denenebilir, ancak destek garantisi yoktur.

## 2. HTTPS aracını kurun

Homebrew kuruluysa:

```sh
brew install mkcert
```

`brew: command not found` çıkarsa önce [Homebrew'ü resmî yönergesiyle kurun](https://brew.sh/), Terminal'i yeniden açıp bu komutu çalıştırın. Alternatif kurulumlar [mkcert belgesinde](https://github.com/FiloSottile/mkcert#installation) yer alır.

## 3. Ağ adresini ve sertifikayı hazırlayın

Ana Mac ofis ağına bağlıyken proje klasöründe:

```sh
npm run lan:setup
```

Tek bir uygun ağ adresi varsa otomatik seçilir. Birden fazla varsa komut adresleri listeler. Ofis Wi-Fi/Ethernet IP adresini seçip yeniden çalıştırın; aşağıdaki adres örnektir:

```sh
npm run lan:setup -- --host 192.168.1.50
```

Bu işlem uygulamaya özel yerel sertifika otoritesi oluşturur, ana Mac'te güvenilir olarak kurar ve HTTPS sertifikasını üretir. macOS yönetici şifreniz istenebilir. Komut sonunda gerçek erişim adresi görünür; örnek:

```text
https://192.168.1.50:3443
```

## 4. Diğer bilgisayarlara sertifika güvenini kurun

Finder'da `Cmd+Shift+.` ile gizli dosyaları gösterin. Projedeki **`.local/tls/rootCA.pem`** dosyasını ekip bilgisayarlarına güvenli şekilde iletin. Bu, genel sertifikadır. **`rootCA-key.pem` veya `server-key.pem` dosyalarını paylaşmayın.**

- **Mac:** Anahtar Zinciri Erişimi uygulamasında sertifikayı Sistem anahtar zincirine aktarın. Sertifikayı açıp Güven bölümünde SSL için “Her Zaman Güven” seçin; yönetici yetkisi gerekebilir. Tarayıcıyı yeniden açın.
- **Windows:** Sertifikayı Güvenilen Kök Sertifika Yetkilileri deposuna aktarın; kurumsal cihazlarda IT ekibinden destek alın.
- Firefox kullanıyorsanız sistem güven deposunu kullanacak şekilde ayarlanması veya sertifikanın Firefox sertifika yöneticisine eklenmesi gerekebilir.

Sertifika uyarısını geçerek şifre girmeyin; önce güven kurulumunu tamamlayın. IP adresini veya sertifikayı kimin verdiğinden emin değilseniz ana Mac'in yöneticisiyle doğrulayın.

## 5. Ortak uygulamayı başlatın

Önce eski `npm run dev` / `npm run lan` işlemini kendi Terminal penceresinde `Ctrl+C` ile kapatın. Aynı proje iki kez çalışmamalı.

```sh
npm run lan
```

Bu komut güncel arayüzü derler ve HTTPS üzerinden açar. Terminal açık kalmalı. macOS güvenlik duvarı gelen bağlantı izni sorarsa Node.js uygulamasına ofis ağınız için izin verin. Güvenlik duvarını tamamen kapatmayın.

Ekip bilgisayarlarında **komutun yazdırdığı HTTPS adresini** açın; ana Mac'te de aynı adresi kullanın. `127.0.0.1` veya `localhost` başka bilgisayardan ana Mac'e gitmez. Kullanıcılar mevcut `admin`, `melisa`, `isil` hesapları ve kendi şifreleriyle giriş yapar. Instagram giriş/doğrulama penceresini admin ana Mac'te açar.

## Günlük kullanım ve sorunlar

- Günlük başlatma: proje klasöründe `npm run lan`. Durdurma: `Ctrl+C`.
- Ana Mac açık ve uyanık olmalı; uyursa taramalar ve erişim durur. Mac'in kilit ekranında olması ile uykuya geçmesi farklıdır.
- Adres açılmıyorsa aynı ağa bağlı olduğunuzu, misafir Wi-Fi / istemci izolasyonu olmadığını, VPN ve güvenlik duvarı ayarlarını kontrol edin. Yalnızca **3443** ağdan erişilebilir olmalı; veri servisi **4318**, web uygulaması **3000** loopback üzerinde kalır.
- IP değişirse `npm run lan:setup -- --host YENI_IP` çalıştırıp yeniden başlatın ve yeni adresi paylaşın. `.local/tls` korunursa aynı kök sertifika kullanılır; istemci güvenini tekrar kurmak gerekmez. IT'den ana Mac için DHCP adres rezervasyonu istemek adresi sabit tutar.
- Sertifika süresi dolarsa kurulumu tekrar çalıştırın.
- Port kullanım hatasında eski uygulama penceresini kapatın; ana Mac'i yeniden başlatmak çalışan tüm uygulamaları etkiler, ilk çözüm olarak gerekmez.
- Bu sürüm ofis ağı içindir. Modemde port yönlendirme veya internet tüneli açmayın; internete yayınlama ayrı bir deploy çalışmasıdır.

## Teknik sınır

Ağa yalnızca seçilen özel IPv4 adresinde çalışan HTTPS sunucusu açılır. Derlenmiş web uygulaması ve Node veri servisi loopback adresinde kalır; Vite geliştirme sunucusu ağa açılmaz. Ağ oturumları Secure + HttpOnly + SameSite=Strict çerezleri kullanır. Host/Origin denetimi, kullanıcı girişi ve admin yetkileri uygulanır. `.local` klasörüne işletim sistemi üzerinden erişim ayrı bir dosya izin sınırıdır.

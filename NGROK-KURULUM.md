# Ngrok ile erişim

1. Çalışan uygulamanın Terminal penceresinde Ctrl+C ile durdurun. Tarama ve gönderim bitmiş olsun.
2. ZIP içindeki IG Agent klasörünün dosyalarını ana Mac'teki mevcut IG Agent klasörüne kopyalayın. `.local` ve `.env` dosyalarını silmeyin.
3. Ngrok panelinde Setup & Installation bölümünde macOS kurulumunu uygulayın. Panelin size verdiği `ngrok config add-authtoken ...` komutunu yalnızca ana Mac Terminal'inde çalıştırın. Token'ı paylaşmayın.
4. Terminal'de:

```sh
cd "$HOME/Desktop/IG Agent"
npm install
IG_BROWSER_CHANNEL=chrome npm run public
```

5. Terminal menüsünden Shell > New Window açın. Yeni pencerede:

```sh
ngrok http http://127.0.0.1:3444 --url https://trilogy-punch-ion.ngrok-free.dev
```

6. https://trilogy-punch-ion.ngrok-free.dev adresini açın. Ngrok ara ekranı çıkarsa Visit Site'a basın. Mevcut uygulama kullanıcı adı ve şifresiyle giriş yapın.

İki Terminal penceresi açık kalmalı. Ana Mac açık, uyanık ve internete bağlı olmalı. Diğer kullanıcılar yalnızca HTTPS adresini açar; sertifika veya ngrok kurmaz. Bu modda eski LAN adresi yerine ngrok adresini kullanın. TikTok eklentisi ana Mac'teki normal Chrome'da aynı yerel API'ye bağlanır. Public mod ile lan/dev modlarını aynı anda başlatmayın.

Ngrok kurulumu: https://ngrok.com/docs/start
Canlı ngrok bağlantısı ana Mac'te kurulacaktır; paket üzerinde yerel ağ geçidi testleri yapılmıştır.

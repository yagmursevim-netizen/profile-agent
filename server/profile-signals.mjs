import { francAll } from 'franc-min';
export function profileSignals(bio) {
  const text = typeof bio === 'string' ? bio : '';
  const normalized = text.normalize('NFKC').toLocaleLowerCase('tr');
  const dmEvidence =
    text
      .split(/[.!?](?:\s|$)/)
      .find((line) => {
        const lower = line.toLocaleLowerCase('tr');
        return (
          /\b(?:dm|direct message)|özel mesaj/.test(lower) &&
          /iş\s*birli|isbirli|collab|cooperation|partnership|bus[ıi]ness|reklam|sponsor/.test(
            lower,
          ) &&
          !/no\s+(?:dm|collab)|do not dm|don't dm|dm\s*(?:yok|kapalı|atma|kabul etm)|iş\s*birli.*istemiyorum/.test(
            lower,
          )
        );
      })
      ?.trim() || null;
  // Language belongs to the bio text, not to the person's nationality.
  const words =
    normalized.replace(/https?:\/\/\S+|\S*@\S+/g, ' ').match(/\p{L}+/gu) || [];
  const dictionaries = {
    Türkçe:
      've için bir ile yaşam hayat iş işbirliği işbirlikleri iletişim içerik psikolog eğitim benim merhaba sağlıklı işbirlikleriniz işbirliklerinizde işbirlikleri işbirliklerim işbirliklerimiz işbirliklerinize işbirlikleriyle işbirliklerinde danışmanlık danışmanlığı danışman psikoloji psikolojik klinik diyetisyen beslenme tarif tarifler tarifleri yemek gezi seyahat moda güzellik bakım güzelliğe hayatın hayatı hayata yaşıyorum yaşıyoruz paylaşıyorum paylaşıyoruz yapıyorum yapıyoruz sizin sizlere kendine birlikte buradayım buradayız randevu randevular görüşme görüşmeler iletişime iletişimin yeni gün her günler üniversitesi üniversite mezunu mühendisi öğretmen eğitmen öğretmeni eğitimci avukat mimar tasarımcı içerikleri içerikler üretiyorum sağlığı sağlığınız sağlıklı yaşamın bilgilendirme aile çocuk çocuklar çocukların yetişkin yetişkinler uzman uzmanı uzmanlık üzerinden üzerinden iletişimden değil çünkü daha nasıl dair dair tüm bizi bana benim seni senin bizim bizimle size ile dilerim hoş geldiniz sosyal yardımlaşma platformu medyası hesabımız girişliler gruplarına katıl öğretmenlerin öğretmenler fizikçi fizik paylaşımları paylaşımlar bilim evli iki tane şükrüm var ki bin değişmem biraz akademik çokça günlük konuş keşfet yansıt fotoğraf video stüdyosu grafik tasarım her şey olur diğer başka işler ateşi çalacağız tanrılardan yedim akşam pazar hariç kayyumu koşu koşmayı seyahatler paylaşımlarımı günlüğü günlükler notlar notları hikaye hikayeler hikayeleri hoşgeldiniz sağlık spor antrenör beden eğitimi müzik müzisyen sanat sanatçı oyuncu oyunculuk yönetmen dünyası yazıyorum okuyorum fotoğrafları çocukları çocuklarım yemekler lezzetli tariflerim sayfamda reklam işbirlikleriniz bize ulaşabilirsiniz bulunuyor öğreniyorum üretiyoruz içinizden herkes herşey iyilik iyiliğe doğa doğayı doğanın fotoğrafçı fotoğrafçısı güzelliğin güzellikleri hayattan hayalim mühendislik sayfası sahne sahnede öğrencisi',
    İngilizce:
      'the and for with your life lifestyle creator content business collaborations welcome i am you my health travel freelance make up artist model agency talent management direct bookings worldwide professional creative digital design designer photographer photography information systems acting fitness trainer coach coaching helping perform confidence engineer engineering nutrition online work personal contact inquiry inquiries booking based founder cofounder official psychology psychologist dietitian nutritionist therapist therapy wellbeing beauty fashion makeup skincare food recipes recipe author writer blogger entrepreneur collabs collaboration partnerships partnership creating sharing about love healthy living science educator teacher manager music critic coordinator astrophotographer member royal astronomical society winning team physics phd scientist science astronomer hippie math mathematics when do we play chess in space mostly portraits alive yours draws political cartoons makes illustrations paintings artist art director film filmmaker cinema actor actress researcher research postdoc student graduate university professor of to a is it on at as be not this that from by our me us are have has can all more than love welcome here world exploring sharing stories everyday beauty',
    Almanca: 'und für mit meine mein leben zusammenarbeit kontakt ich bin',
    Fransızca: 'et pour avec mon ma vie créateur collaboration bonjour je suis',
    İspanyolca: 'para con mi vida creador contenido colaboraciones hola soy',
  };
  const scores = Object.entries(dictionaries)
    .map(([language, lexicon]) => ({
      language,
      words: [...new Set(words.filter((w) => lexicon.split(' ').includes(w)))],
    }))
    .sort((a, b) => b.words.length - a.words.length);
  const strong = scores.filter((s) => s.words.length >= 2);
  let language = 'Bilinmiyor';
  let languageEvidence = 'Bio metni yetersiz veya dil net değil.';
  if (strong.length >= 2) {
    language = 'Çok dilli';
    languageEvidence = strong.map((s) => s.language).join(', ');
  } else if (
    strong.length === 1 &&
    scores[0].words.length - scores[1].words.length >= 2
  ) {
    language = strong[0].language;
    languageEvidence = `Bio: ${strong[0].words.join(', ')}`;
  }
  if (language === 'Bilinmiyor') {
    const distinctive = words.filter((w) =>
      /^(psikolog|diyetisyen|işbirlikleri|işbirliği|iletişim|danışmanlık|öğretmen|mühendisi|eğitmen|içerik|randevu|üniversitesi|psychologist|dietitian|nutritionist|photographer|collaborations|bookings|skincare|wellbeing)$/.test(
        w,
      ),
    );
    const turkish = distinctive.filter((w) =>
      /^(psikolog|diyetisyen|işbirlikleri|işbirliği|iletişim|danışmanlık|öğretmen|mühendisi|eğitmen|içerik|randevu|üniversitesi)$/.test(
        w,
      ),
    );
    if (
      distinctive.length &&
      (turkish.length === distinctive.length || !turkish.length)
    ) {
      language = turkish.length ? 'Türkçe' : 'İngilizce';
      languageEvidence = `Bio içindeki ayırt edici sözcükler: ${[...new Set(distinctive)].join(', ')}`;
    } else if (words.join('').length >= 30 && words.length >= 5) {
      const ranked = francAll(words.join(' '), { minLength: 30 });
      const [best, second] = ranked;
      if (
        best &&
        best[0] !== 'und' &&
        (!second || best[1] - second[1] >= 0.12)
      ) {
        const label = new Intl.DisplayNames(['tr'], { type: 'language' }).of(
          best[0],
        );
        if (label && label !== best[0]) {
          language = label.charAt(0).toLocaleUpperCase('tr') + label.slice(1);
          languageEvidence =
            'Bio metninin yerel dil modeliyle analizi (tahmin). İsim ve kullanıcı adı değerlendirmeye alınmadı.';
        }
      }
    }
  }
  const declaration =
    text.match(
      /(?:cinsiyet(?:im)?|gender)\s*[:：=]\s*(kadın|erkek|female|male|woman|man|non[- ]?binary|ikili olmayan)(?=$|[^\p{L}])/iu,
    ) || text.match(/\bben\s+(?:bir\s+)?(kadınım|erkeğim)(?=$|[^\p{L}])/iu);
  let gender = 'Bilinmiyor';
  if (declaration) {
    const value = declaration[1].toLocaleLowerCase('tr');
    gender = /^(kadın|kadınım|female|woman)$/.test(value)
      ? 'Kadın'
      : /^(erkek|erkeğim|male|man)$/.test(value)
        ? 'Erkek'
        : 'Non-binary';
  }
  return {
    dmForCollaboration: !!dmEvidence,
    dmEvidence,
    language,
    languageEvidence,
    gender,
    genderEvidence: declaration?.[0] ?? null,
  };
}

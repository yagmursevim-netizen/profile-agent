import test from 'node:test';
import assert from 'node:assert/strict';
import { profileSignals } from '../server/profile-signals.mjs';
import { assessOpenAI, screenPhoto, generatePost } from '../server/ai.mjs';
void test('DM outreach is explicit and generic DM mentions are not collaboration signals', () => {
  assert.equal(
    profileSignals('İşbirlikleri için DM 💌').dmForCollaboration,
    true,
  );
  assert.equal(
    profileSignals('For collaborations DM me').dmForCollaboration,
    true,
  );
  assert.equal(
    profileSignals('İşbirlikleri için\nDM 💌').dmForCollaboration,
    true,
  );
  assert.equal(profileSignals('DM açık').dmForCollaboration, false);
  assert.equal(profileSignals('No DM for collabs').dmForCollaboration, false);
});
void test('language stays unknown on ambiguous bios and gender requires an explicit declaration', () => {
  assert.equal(profileSignals('Paris ✨').language, 'Bilinmiyor');
  assert.equal(
    profileSignals('Freelance Make-up Artist İstanbul').language,
    'İngilizce',
  );
  assert.equal(
    profileSignals(
      'Model Agency, Talent Management and Direct bookings Worldwide 🌎',
    ).language,
    'İngilizce',
  );
  assert.equal(
    profileSignals('İçerik ve eğitim için iletişim').language,
    'Türkçe',
  );
  assert.equal(
    profileSignals('Content creator and travel for your life').language,
    'İngilizce',
  );
  for (const bio of [
    'Ayşe Yılmaz',
    'she/her',
    'Kadın hakları üzerine içerik',
    'Psikolog, anne',
  ])
    assert.equal(profileSignals(bio).gender, 'Bilinmiyor');
  assert.equal(profileSignals('Cinsiyet: kadın').gender, 'Kadın');
  assert.equal(profileSignals('Gender: non-binary').gender, 'Non-binary');
  assert.equal(
    profileSignals('Gender: female').genderEvidence,
    'Gender: female',
  );
});
void test('OpenAI assessment uses configured key and Responses schema without leaking sensitive inferred attributes', async () => {
  let call;
  const result = await assessOpenAI(
    { bio: 'Eğitim ve içerik', followers: 5000, gender: 'Kadın' },
    { openaiKey: 'fake-key', openaiModel: 'gpt-5-mini' },
    new AbortController().signal,
    async (url, options) => {
      call = { url, options };
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  verdict: 'İncelenmeli',
                  reason: 'İnsan incelemesi gerekir.',
                }),
              },
            ],
          },
        ],
      });
    },
  );
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(call.options.body);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.model, 'gpt-5-mini');
  assert.equal(JSON.parse(body.input).gender, undefined);
  assert.equal(result.provider, 'OpenAI');
  assert.equal(result.verdict, 'İncelenmeli');
});
void test('screenPhoto sends the profile photo as input_image and parses the verdict; a missing photo short-circuits without a request', async () => {
  let call;
  const result = await screenPhoto(
    'Dr. Ayşe',
    'https://cdninstagram.com/pic.jpg',
    { openaiKey: 'fake-key', openaiModel: 'gpt-5-mini' },
    new AbortController().signal,
    async (url, options) => {
      call = { url, options };
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  isPerson: true,
                  genderGuess: 'kadın',
                }),
              },
            ],
          },
        ],
      });
    },
  );
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, 'gpt-5-mini');
  assert.equal(body.text.format.strict, true);
  const content = body.input[0].content;
  assert.equal(content[0].type, 'input_text');
  assert.match(content[0].text, /Dr\. Ayşe/);
  assert.equal(content[1].type, 'input_image');
  assert.equal(content[1].image_url, 'https://cdninstagram.com/pic.jpg');
  assert.equal(result.isPerson, true);
  assert.equal(result.genderGuess, 'kadın');

  let secondCallMade = false;
  const skipped = await screenPhoto(
    'Kimsesiz',
    null,
    { openaiKey: 'fake-key', openaiModel: 'gpt-5-mini' },
    new AbortController().signal,
    async () => {
      secondCallMade = true;
    },
  );
  assert.equal(secondCallMade, false);
  assert.equal(skipped.isPerson, null);
});
void test('generatePost calls Gemini image generation with the persona in the prompt and returns base64 data', async () => {
  let call;
  const result = await generatePost(
    'kahve ve seyahat seven bir kadın',
    { geminiKey: 'fake-gemini-key' },
    new AbortController().signal,
    async (url, options) => {
      call = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { data: 'ZmFrZS1wbmc=' } }],
              },
            },
          ],
        }),
      };
    },
  );
  assert.match(
    call.url,
    /generativelanguage\.googleapis\.com.*generateContent/,
  );
  assert.equal(call.options.headers['x-goog-api-key'], 'fake-gemini-key');
  const body = JSON.parse(call.options.body);
  assert.match(
    body.contents[0].parts[0].text,
    /kahve ve seyahat seven bir kadın/,
  );
  assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
  assert.equal(result, 'ZmFrZS1wbmc=');
});
void test('generatePost fails over to the fallback model when the primary is overloaded', async () => {
  const calls = [];
  const result = await generatePost(
    'test',
    { geminiKey: 'fake-gemini-key' },
    new AbortController().signal,
    async (url) => {
      calls.push(url);
      if (calls.length === 1)
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'UNAVAILABLE' } }),
        };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            { content: { parts: [{ inlineData: { data: 'ZmFsbGJhY2s=' } }] } },
          ],
        }),
      };
    },
  );
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  assert.equal(result, 'ZmFsbGJhY2s=');
});
void test('short clear Turkish and English bios are identified without guessing from personal names', () => {
  for (const bio of [
    'İşbirlikleri için DM',
    'Klinik Psikolog',
    'Diyetisyen',
    'Güzellik ve bakım',
    'Sağlığınız için buradayım',
  ])
    assert.equal(profileSignals(bio).language, 'Türkçe', bio);
  for (const bio of ['For collaborations', 'Content creator', 'Photographer'])
    assert.equal(profileSignals(bio).language, 'İngilizce', bio);
  for (const bio of [
    'Ayşe Yılmaz',
    'Gani Somuncu',
    'İstanbul 📍',
    '✨ 💛',
    'Paris',
  ])
    assert.equal(profileSignals(bio).language, 'Bilinmiyor', bio);
  assert.equal(
    profileSignals('İşbirliği için DM. Content creator and photographer')
      .language,
    'Çok dilli',
  );
});

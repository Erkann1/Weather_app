import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCcw, Bell, CloudRain, Sun, Zap, Sunrise, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';

// Sabitler
const OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast";

// SADELEŞTİRİLDİ: Sadece Derince ve Gebze koordinatları sabit olarak kullanılıyor.
const CITIES = [
  { name: "Derince", lat: 40.7569, lon: 29.8147 },
  { name: "Gebze", lat: 40.8033, lon: 29.4328 }
];

// Varsayılan saat sabit olarak 06:15
const TARGET_TIME_HOUR = 6;
const TARGET_TIME_MINUTE = 15;

// API Entegrasyonları için sabitler
// GÜNCELLEME: Yeni Gemini API Anahtarı gizlendi.
const GEMINI_API_KEY = "AIzaSyAZi8FwqdDqAC_aE5vf20YEv-ibSJgDZJ0";
const GEMINI_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;


// WMO KODLARINI TÜRKÇE AÇIKLAMALARA ÇEVİREN FONKSİYON
const getWeatherDescription = (wmoCode) => {
  switch (wmoCode) {
    case 0:
      return "açık ve güneşli";
    case 1:
    case 2:
      return "parçalı bulutlu";
    case 3:
      return "bulutlu";
    case 45:
    case 48:
      return "yoğun sisli";
    case 51:
    case 53:
      return "hafif yağmurlu";
    case 55:
      return "hafif yağmurlu";
    case 56:
    case 57:
    case 66:
    case 67:
      return "yoğun yağışlı"; // Donan yağmur veya çisenti
    case 61:
    case 63:
    case 65:
    case 80:
    case 81:
    case 82:
      return "sağanak yağışlı";
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
      return "karlı";
    case 95:
    case 96:
    case 99:
      return "gök gürültülü fırtınalı";
    default:
      return "bilinmeyen hava koşulları";
  }
};

/**
 * Raw PCM verisini (base64) ArrayBuffer'a dönüştürür
 * @param {string} base64 - Base64 kodlu string
 * @returns {ArrayBuffer}
 */
const base64ToArrayBuffer = (base64) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * PCM verisini (signed 16-bit) WAV dosyası Blob'una dönüştürür.
 * API'den gelen ses verisi bu formattadır.
 * @param {Int16Array} pcmData - Signed 16-bit PCM verisi
 * @param {number} sampleRate - Örnekleme hızı (API'den alınır, varsayılan 16000)
 * @returns {Blob} WAV dosyası
 */
const pcmToWav = (pcmData, sampleRate = 16000) => {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  let offset = 0;

  // RIFF header
  view.setUint32(offset, 0x52494646, false); offset += 4; // "RIFF"
  view.setUint32(offset, 36 + dataSize, true); offset += 4; // File size - 8
  view.setUint32(offset, 0x57415645, false); offset += 4; // "WAVE"

  // FMT chunk
  view.setUint32(offset, 0x666d7420, false); offset += 4; // "fmt "
  view.setUint32(offset, 16, true); offset += 4; // Sub-chunk size
  view.setUint16(offset, 1, true); offset += 2; // Audio format (1 = PCM)
  view.setUint16(offset, numChannels, true); offset += 2; // Channels
  view.setUint32(offset, sampleRate, true); offset += 4; // Sample rate
  view.setUint32(offset, byteRate, true); offset += 4; // Byte rate
  view.setUint16(offset, blockAlign, true); offset += 2; // Block align
  view.setUint16(offset, 16, true); offset += 2; // Bits per sample (16)

  // Data chunk
  view.setUint32(offset, 0x64617461, false); offset += 4; // "data"
  view.setUint32(offset, dataSize, true); offset += 4; // Data size

  // Write PCM data
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(offset, pcmData[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};


// Hava durumu durumuna göre ikon seçimi (WMO koduna göre güncellenmedi, sadece metin kontrolü)
const getWeatherIcon = (condition) => {
  if (condition.includes("yağmur") || condition.includes("sağanak")) return CloudRain;
  if (condition.includes("güneşli") || condition.includes("açık")) return Sun;
  if (condition.includes("bulutlu")) return CloudRain;
  if (condition.includes("kar") || condition.includes("yoğun yağışlı")) return Zap;
  return Sunrise;
};


function App() {
  const [weatherData, setWeatherData] = useState([]);
  const [statusMessage, setStatusMessage] = useState("Uygulama başlatılıyor...");
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [lastAnnounceTime, setLastAnnounceTime] = useState(null);
  const [isSchedulerActive, setIsSchedulerActive] = useState(true);

  // SABİT SAAT KULLANILDI
  const targetHour = TARGET_TIME_HOUR;
  const targetMinute = TARGET_TIME_MINUTE;


  // Hava durumu API çağrısı
  const fetchWeather = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage("Hava durumu verileri çekiliyor (Derince ve Gebze)...");

    let allWeatherData = [];
    let announcementText = "";

    // SABİT CITIES listesi kullanılıyor
    for (let i = 0; i < CITIES.length; i++) {
      const city = CITIES[i];
      const url = `${OPENMETEO_URL}?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,weathercode&temperature_unit=celsius&timeformat=iso8601&timezone=Europe%2FIstanbul&forecast_days=1`;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Hata: ${response.status} (${city.name})`);

        const data = await response.json();

        const rawTemp = data.hourly?.temperature_2m?.[0];
        const wmoCode = data.hourly?.weathercode?.[0];

        console.log(`[OPEN-METEO HAM VERİSİ - ${city.name}] Ham Sıcaklık: ${rawTemp}, WMO Kodu: ${wmoCode}`);

        if (rawTemp === undefined || wmoCode === undefined) {
          throw new Error("API yanıtında beklenen saatlik veri bulunamadı.");
        }

        const temp = rawTemp.toFixed(1);
        const condition = getWeatherDescription(wmoCode);

        allWeatherData.push({
          name: city.name,
          temp: temp,
          condition: condition
        });

        // Anons metni oluşturma mantığı
        if (i === 0) {
          announcementText += `Günaydın. ${city.name}'de hava ${temp} derece ve ${condition}. `;
        } else {
          announcementText += `${city.name}'de ise hava ${temp} derece ve ${condition}. `;
        }


      } catch (error) {
        console.error("Hava durumu çekme hatası:", error);
        allWeatherData.push({ name: city.name, temp: '?', condition: 'Hata' });
        announcementText += `${city.name} hava bilgisi alınamadı. `;
      }
    }

    setWeatherData(allWeatherData);
    await triggerAnnouncement(announcementText);

  }, []);

  // TTS ile sesli anonsu tetikler
  const triggerAnnouncement = useCallback(async (text) => {
    // Anahtar kontrolü (Gemini API Anahtarı boş olamaz)
    if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 10) {
      setStatusMessage("Hata: Gemini API Anahtarı tanımlı değil. Lütfen anahtarınızı koda yapıştırın.");
      setIsLoading(false);
      return;
    }

    // Metin içeriği kontrolü
    if (!text || text.trim().length < 5) {
      setStatusMessage("Hata: Anons metni oluşturulamadı veya çok kısa. TTS isteği gönderilmiyor.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setStatusMessage("Sesli anons oluşturuluyor ve çalınıyor...");
    setAudioUrl(null); // Önceki sesi sıfırla

    // Payload yapısı
    const payload = {
      contents: [
        {
          parts: [
            { text: text }
          ]
        }
      ],
      // systemInstruction bloğu tamamen kaldırıldı
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: "tr-TR",
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Kore"
            }
          }
        }
      }
    };

    let attempt = 0;
    const maxRetries = 8;

    // Üstel Geri Çekilme (Exponential Backoff) ile tekrar deneme
    while (attempt < maxRetries) {
      try {
        const response = await fetch(GEMINI_TTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          // Hata 429 veya 500 hataları için tekrar deneme yapılacak
          if (response.status === 401) {
            console.error("Kimlik Doğrulama Hatası (401): Anahtarınız geçersiz veya kısıtlı olabilir.");
          }
          if (response.status === 429) {
            console.error("Hata 429: Kota aşıldı. Tekrar denenecek...");
            setStatusMessage("HATA: API Kota Sınırı Aşıldı (429). Otomatik tekrar deneme süresi bekleniyor.");

          } else if (response.status === 500) {
            console.error("Hata 500: Sunucu hatası. Tekrar denenecek...");
            setStatusMessage("HATA: Sunucu Hatası (500). Otomatik tekrar deneme süresi bekleniyor.");
          }

          throw new Error(`TTS API HTTP Hata: ${response.status}`);
        }

        const result = await response.json();
        const part = result?.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        const mimeType = part?.inlineData?.mimeType;

        if (audioData && mimeType && mimeType.startsWith("audio/L16")) {
          const rateMatch = mimeType.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 16000;

          const pcmDataBuffer = base64ToArrayBuffer(audioData);
          const pcm16 = new Int16Array(pcmDataBuffer);
          const wavBlob = pcmToWav(pcm16, sampleRate);
          const newAudioUrl = URL.createObjectURL(wavBlob);

          setAudioUrl(newAudioUrl);
          // YENİ: Otomatik oynatmayı dene
          const audio = new Audio(newAudioUrl);

          // Otomatik oynatmayı denemek için promise kullanılır.
          audio.play().then(() => {
            // Oynatma başarılı.
            setStatusMessage("Sesli anons hazır ve otomatik çalıyor.");
            audio.onended = () => console.log("Anons tamamlandı. Tekrar etmeyecektir.");
          }).catch(error => {
            // Oynatma engellendi. Kullanıcıya manuel başlatması gerektiğini söyle.
            console.error("Oynatma engellendi:", error);
            setStatusMessage("Sesli anons hazır! Oynat düğmesine basarak dinleyebilirsiniz.");
          });

          setLastAnnounceTime(new Date().toLocaleTimeString('tr-TR'));
          setIsLoading(false);
          return;
        } else {
          throw new Error("TTS yanıtında ses verisi bulunamadı veya format hatalı.");
        }
      } catch (error) {
        console.error(`TTS Hatası (Deneme ${attempt + 1}):`, error);
        attempt++;
        if (attempt < maxRetries) {
          const baseDelay = 120000;
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`Yeniden deneme için ${delay / 1000} saniye bekleniyor...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          setStatusMessage(`Hata: Sesli anons oluşturulamadı. Lütfen konsolu kontrol edin. (${error.message})`);
          setIsLoading(false);
        }
      }
    }
  }, []);

  // Zamanlama ve Alarm Mantığı (Android Service simülasyonu)
  useEffect(() => {
    if (!isSchedulerActive) {
      console.log("[SCHEDULER] Otomatik zamanlayıcı devredışı.");
      setStatusMessage("Otomatik anons durduruldu. Sadece manuel çalışabilir.");
      return;
    }

    const scheduledHour = TARGET_TIME_HOUR; // SABİT 06
    const scheduledMinute = TARGET_TIME_MINUTE; // SABİT 15

    const checkTimeAndAnnounce = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const dayOfWeek = now.getDay();

      // Hafta içi (Pazartesi=1'den Cuma=5'e kadar) ve tam belirlenen saati kontrol et
      if (dayOfWeek >= 1 && dayOfWeek <= 5 &&
        hour === scheduledHour &&
        minute === scheduledMinute) {

        const today = now.toDateString();
        const lastAnnounceDate = lastAnnounceTime ? new Date(lastAnnounceTime).toDateString() : null;

        if (lastAnnounceDate === today) {
          return;
        }

        console.log(`[ALARM] Hedef saat (${scheduledHour}:${scheduledMinute}) geldi. Anons başlatılıyor.`);
        fetchWeather();

      } else {
        setStatusMessage(isSchedulerActive
          ? `Otomatik anons aktif. Hedef: Hafta içi ${scheduledHour.toString().padStart(2, '0')}:${scheduledMinute.toString().padStart(2, '0')}`
          : "Otomatik anons durduruldu. Sadece manuel çalışabilir.");
      }
    };

    const intervalId = setInterval(checkTimeAndAnnounce, 60000);

    checkTimeAndAnnounce();

    return () => clearInterval(intervalId);
  }, [fetchWeather, lastAnnounceTime, isSchedulerActive]);

  // UI Bileşeni: Hava Durumu Kartı
  const WeatherCard = ({ data }) => {
    const Icon = useMemo(() => getWeatherIcon(data.condition), [data.condition]);

    return (
      <div className="flex items-center justify-between p-4 bg-white rounded-xl shadow-lg border border-gray-100 transition duration-300 hover:shadow-xl w-full">
        <div className="flex items-center space-x-4">
          <Icon className="w-8 h-8 text-indigo-500 flex-shrink-0" />
          <div>
            <p className="text-xl font-semibold text-gray-800">{data.name}</p>
            <p className="text-sm text-gray-500">{data.condition}</p>
          </div>
        </div>
        <div className="text-3xl font-bold text-indigo-600">
          {data.temp}°C
        </div>
      </div>
    );
  };

  // Zamanlayıcıyı açıp kapatan toggle
  const ToggleScheduler = () => {
    const ToggleIcon = isSchedulerActive ? ToggleRight : ToggleLeft;
    const colorClass = isSchedulerActive ? 'bg-indigo-600' : 'bg-gray-400';

    return (
      <div className="flex justify-between items-center p-4 bg-white rounded-xl shadow">
        <p className="text-lg font-semibold text-gray-800">Otomatik Anons ({TARGET_TIME_HOUR.toString().padStart(2, '0')}:{TARGET_TIME_MINUTE.toString().padStart(2, '0')})</p>
        <button
          onClick={() => setIsSchedulerActive(!isSchedulerActive)}
          className={`relative inline-flex items-center h-8 w-16 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${colorClass}`}
          aria-checked={isSchedulerActive}
        >
          <span className="sr-only">Toggle automatic announcement</span>
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${isSchedulerActive ? 'translate-x-8' : 'translate-x-1'
              }`}
          />
          <ToggleIcon className={`absolute inset-y-0 h-6 w-6 m-1 transition-transform duration-200 ease-in-out ${isSchedulerActive ? 'translate-x-1' : 'translate-x-8 text-white'}`} />
        </button>
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-sans">
      <div className="max-w-md mx-auto">
        <header className="text-center py-6">
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center justify-center">
            <Bell className="w-8 h-8 text-indigo-500 mr-2" />
            Sabah Anonsu
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Derince ve Gebze İçin Otomatik Hava Durumu (06:15)
          </p>
        </header>

        <main className="space-y-6">
          {/* ZAMANLAYICI AÇ/KAPAT */}
          <ToggleScheduler />

          {/* Durum Mesajı Kartı */}
          <div className="p-4 bg-indigo-50 rounded-xl shadow-inner border border-indigo-200">
            <p className="text-indigo-700 text-sm font-medium">{statusMessage}</p>
            {lastAnnounceTime && (
              <p className="text-indigo-600 text-xs mt-1">Son Anons: {lastAnnounceTime}</p>
            )}
          </div>

          {/* Hava Durumu Listesi */}
          <div className="space-y-4">
            {weatherData.length === 0 ? (
              <div className="p-6 text-center text-gray-500 bg-white rounded-xl shadow">
                <Sunrise className="w-6 h-6 mx-auto mb-2" />
                <p>Hava durumu bilgisi bekleniyor.</p>
                <p className="text-xs mt-1">Hava durumunu manuel tetiklemek için aşağıdaki butonu kullanın.</p>
              </div>
            ) : (
              weatherData.map(data => (
                <WeatherCard key={data.name} data={data} />
              ))
            )}
          </div>

          {/* Anons Tetikleme Butonu */}
          <button
            onClick={() => fetchWeather()}
            disabled={isLoading}
            className={`w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl text-white shadow-lg transform transition duration-150 ${isLoading
                ? 'bg-indigo-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.01] active:scale-95'
              }`}
          >
            {isLoading ? (
              <>
                <RefreshCcw className="w-5 h-5 mr-3 animate-spin" />
                İşleniyor...
              </>
            ) : (
              <>
                <Bell className="w-5 h-5 mr-3" />
                Hemen Anons Et (Test Et)
              </>
            )}
          </button>

          {/* Ses Çalma Kontrolü (Görünmez, sadece debug için) */}
          {audioUrl && (
            <div className="p-4 bg-green-50 rounded-xl text-sm text-green-700">
              <p className='font-semibold'>Ses Kaynağı Yüklendi:</p>
              <audio controls src={audioUrl} className="w-full mt-2" />
            </div>
          )}

          <div className="pt-4 border-t border-gray-200 text-xs text-gray-500 text-center">
            <p>Simülasyon Notu: Otomatik anons Hafta İçi saat 06:15'te gerçekleşir.</p>
            <p>Bu uygulama Gemini TTS API'si ile sesli çıkış sağlamaktadır.</p>
          </div>

        </main>
      </div>
    </div>
  );
}

export default App;

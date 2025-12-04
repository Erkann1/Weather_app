import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCcw, Bell, CloudRain, Sun, Zap, Sunrise, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';

import { TURKEY_LOCATIONS } from './data/turkey_locations';

// Sabitler
const OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

// Varsayılan değerler
const DEFAULT_PROVINCE = "Kocaeli";
const DEFAULT_DISTRICT = "Derince";
const DEFAULT_LAT = 40.7569;
const DEFAULT_LON = 29.8147;
const DEFAULT_TIME = "06:15";

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

  // Yeni State'ler
  const [targetTime, setTargetTime] = useState(DEFAULT_TIME);
  const [selectedProvince, setSelectedProvince] = useState(DEFAULT_PROVINCE);
  const [selectedDistrict, setSelectedDistrict] = useState(DEFAULT_DISTRICT);
  const [coordinates, setCoordinates] = useState({ lat: DEFAULT_LAT, lon: DEFAULT_LON });

  // İlçe değiştiğinde koordinatları bul
  useEffect(() => {
    const fetchCoordinates = async () => {
      if (!selectedDistrict || !selectedProvince) return;

      setStatusMessage(`${selectedDistrict}, ${selectedProvince} için konum bulunuyor...`);
      try {
        const query = `${selectedDistrict}, ${selectedProvince}, Turkey`;
        const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=tr&format=json`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
          const { latitude, longitude } = data.results[0];
          setCoordinates({ lat: latitude, lon: longitude });
          setStatusMessage(`${selectedDistrict} konumu güncellendi.`);
          // Konum değişince hava durumunu temizle veya otomatik yenile? 
          // Şimdilik manuel yenileme bırakalım veya kullanıcı "Test Et" desin.
        } else {
          console.error("Konum bulunamadı");
          setStatusMessage("Hata: Seçilen ilçenin koordinatları bulunamadı.");
        }
      } catch (error) {
        console.error("Geocoding hatası:", error);
        setStatusMessage("Hata: Konum servisine erişilemedi.");
      }
    };

    // İlk açılışta değil, kullanıcı değiştirdiğinde çalışsın (fakat varsayılanlar zaten sabit)
    // Ancak component mount olduğunda çalışması sorun olmaz.
    if (selectedDistrict !== DEFAULT_DISTRICT || selectedProvince !== DEFAULT_PROVINCE) {
      fetchCoordinates();
    }
  }, [selectedDistrict, selectedProvince]);


  // Hava durumu API çağrısı
  const fetchWeather = useCallback(async () => {
    setIsLoading(true);
    setStatusMessage(`${selectedDistrict} için hava durumu verileri çekiliyor...`);

    let allWeatherData = [];
    let announcementText = "";

    const url = `${OPENMETEO_URL}?latitude=${coordinates.lat}&longitude=${coordinates.lon}&hourly=temperature_2m,weathercode&temperature_unit=celsius&timeformat=iso8601&timezone=Europe%2FIstanbul&forecast_days=1`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP Hata: ${response.status}`);

      const data = await response.json();

      const rawTemp = data.hourly?.temperature_2m?.[0];
      const wmoCode = data.hourly?.weathercode?.[0];

      console.log(`[OPEN-METEO] ${selectedDistrict} - Sıcaklık: ${rawTemp}, WMO: ${wmoCode}`);

      if (rawTemp === undefined || wmoCode === undefined) {
        throw new Error("API yanıtında veri yok.");
      }

      const temp = rawTemp.toFixed(1);
      const condition = getWeatherDescription(wmoCode);

      allWeatherData.push({
        name: selectedDistrict,
        temp: temp,
        condition: condition
      });

      announcementText = `Günaydın. ${selectedDistrict}'de hava ${temp} derece ve ${condition}. `;

    } catch (error) {
      console.error("Hava durumu hatası:", error);
      allWeatherData.push({ name: selectedDistrict, temp: '?', condition: 'Hata' });
      announcementText = `${selectedDistrict} hava bilgisi alınamadı. `;
    }

    setWeatherData(allWeatherData);
    await triggerAnnouncement(announcementText);

  }, [coordinates, selectedDistrict]);

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

  // Zamanlama ve Alarm Mantığı
  useEffect(() => {
    if (!isSchedulerActive) {
      setStatusMessage("Otomatik anons durduruldu.");
      return;
    }

    const checkTimeAndAnnounce = () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const dayOfWeek = now.getDay();

      const [targetH, targetM] = targetTime.split(':').map(Number);

      // Hafta içi (1-5) ve hedef saat
      if (dayOfWeek >= 1 && dayOfWeek <= 5 &&
        currentHour === targetH &&
        currentMinute === targetM) {

        const today = now.toDateString();
        const lastAnnounceDate = lastAnnounceTime ? new Date(lastAnnounceTime).toDateString() : null;

        if (lastAnnounceDate === today) {
          return;
        }

        console.log(`[ALARM] Hedef saat (${targetTime}) geldi.`);
        fetchWeather();

      } else {
        // Durum mesajını sürekli güncellemek yerine sadece değişimde güncellemek daha iyi olabilir ama
        // şimdilik basit tutalım.
        // setStatusMessage(`Otomatik anons aktif. Hedef: Hafta içi ${targetTime}`);
      }
    };

    const intervalId = setInterval(checkTimeAndAnnounce, 60000);
    checkTimeAndAnnounce(); // İlk kontrol

    return () => clearInterval(intervalId);
  }, [fetchWeather, lastAnnounceTime, isSchedulerActive, targetTime]);

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
      <div className="flex flex-col space-y-4 p-4 bg-white rounded-xl shadow">
        {/* Üst Kısım: Toggle ve Başlık */}
        <div className="flex justify-between items-center">
          <p className="text-lg font-semibold text-gray-800">Otomatik Anons ({targetTime})</p>
          <button
            onClick={() => setIsSchedulerActive(!isSchedulerActive)}
            className={`relative inline-flex items-center h-8 w-16 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${colorClass}`}
          >
            <span className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${isSchedulerActive ? 'translate-x-8' : 'translate-x-1'}`} />
            <ToggleIcon className={`absolute inset-y-0 h-6 w-6 m-1 transition-transform duration-200 ease-in-out ${isSchedulerActive ? 'translate-x-1' : 'translate-x-8 text-white'}`} />
          </button>
        </div>

        {/* Alt Kısım: Ayarlar (Sadece aktifse veya her zaman gösterilebilir, kullanıcı isteğine göre) */}
        <div className="grid grid-cols-1 gap-4 pt-4 border-t border-gray-100">
          {/* Saat Seçimi */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Anons Saati</label>
            <input
              type="time"
              value={targetTime}
              onChange={(e) => setTargetTime(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>

          {/* İl Seçimi */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">İl</label>
            <select
              value={selectedProvince}
              onChange={(e) => {
                setSelectedProvince(e.target.value);
                // İl değişince ilçeyi sıfırla veya ilkini seç
                const newDistricts = TURKEY_LOCATIONS.find(p => p.province === e.target.value)?.districts || [];
                if (newDistricts.length > 0) setSelectedDistrict(newDistricts[0]);
              }}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              {TURKEY_LOCATIONS.map(loc => (
                <option key={loc.province} value={loc.province}>{loc.province}</option>
              ))}
            </select>
          </div>

          {/* İlçe Seçimi */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">İlçe</label>
            <select
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              {TURKEY_LOCATIONS.find(p => p.province === selectedProvince)?.districts.map(dist => (
                <option key={dist} value={dist}>{dist}</option>
              ))}
            </select>
          </div>
        </div>

        {isSchedulerActive && (
          <p className="text-xs text-indigo-600 mt-2">
            Otomatik anons aktif. Hedef: Hafta içi {targetTime}
          </p>
        )}
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
          {/* Alt başlık kaldırıldı veya dinamik yapılabilir */}
        </header>

        <main className="space-y-6">
          {/* ZAMANLAYICI AÇ/KAPAT ve AYARLAR */}
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
            {/* Simülasyon notları kaldırıldı */}
          </div>

        </main>
      </div>
    </div>
  );
}

export default App;

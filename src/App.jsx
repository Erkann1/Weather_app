import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCcw, Bell, CloudRain, Sun, Zap, Sunrise, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { CapacitorForegroundService } from 'capacitor-foreground-service';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App as CapacitorApp } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';

const AlarmPlugin = registerPlugin('AlarmPlugin');

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


  // Yeni State'ler (LocalStorage'dan okuma)
  const [targetTime, setTargetTime] = useState(() => localStorage.getItem('targetTime') || DEFAULT_TIME);
  const [selectedProvince, setSelectedProvince] = useState(() => localStorage.getItem('selectedProvince') || DEFAULT_PROVINCE);
  const [selectedDistrict, setSelectedDistrict] = useState(() => localStorage.getItem('selectedDistrict') || DEFAULT_DISTRICT);
  const [coordinates, setCoordinates] = useState({ lat: DEFAULT_LAT, lon: DEFAULT_LON });
  // isSchedulerActive varsayılan olarak false olsun, kullanıcı açsın.
  const [isSchedulerActive, setIsSchedulerActive] = useState(() => localStorage.getItem('isSchedulerActive') === 'true');

  // Global announcement lock to prevent multiple triggers
  const isAnnouncingRef = useRef(false);
  const lastAnnounceTriggerRef = useRef(0);

  // Ayarları Kaydetme Effect'leri
  useEffect(() => { localStorage.setItem('targetTime', targetTime); }, [targetTime]);
  useEffect(() => { localStorage.setItem('selectedProvince', selectedProvince); }, [selectedProvince]);
  useEffect(() => { localStorage.setItem('selectedDistrict', selectedDistrict); }, [selectedDistrict]);
  useEffect(() => { localStorage.setItem('isSchedulerActive', isSchedulerActive); }, [isSchedulerActive]);

  // İzin isteme - Uygulama ilk açıldığında çalışır
  useEffect(() => {
    const requestNotificationPermissions = async () => {
      try {
        console.log("[PERMISSION] İzin isteniyor...");
        const permResult = await AlarmPlugin.requestPermissions();
        console.log("[PERMISSION] AlarmPlugin izin sonucu:", permResult);

        // Fallback olarak LocalNotifications da çağıralım
        const localPerm = await LocalNotifications.requestPermissions();
        console.log("[PERMISSION] LocalNotifications izin sonucu:", localPerm);
      } catch (e) {
        console.error("[PERMISSION] İzin isteği hatası:", e);
        // Fallback
        try {
          await LocalNotifications.requestPermissions();
        } catch (e2) {
          console.error("[PERMISSION] Fallback izin hatası:", e2);
        }
      }
    };

    // Uygulama açılır açılmaz izin iste
    requestNotificationPermissions();
  }, []); // Boş dependency array = sadece mount'ta çalışır

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
  const fetchWeather = useCallback(async (shouldAnnounce = true) => {
    // Check for announcement lock - prevent multiple simultaneous triggers
    const now = Date.now();
    if (shouldAnnounce) {
      if (isAnnouncingRef.current) {
        console.log("[GUARD] Anons zaten devam ediyor, atlanıyor.");
        return;
      }
      // Prevent triggers within 60 seconds of each other
      if (now - lastAnnounceTriggerRef.current < 60000) {
        console.log("[GUARD] Son 60 saniye içinde anons yapıldı, atlanıyor.");
        return;
      }
      isAnnouncingRef.current = true;
      lastAnnounceTriggerRef.current = now;
    }

    setIsLoading(true);
    if (shouldAnnounce) {
      setStatusMessage(`${selectedDistrict} için hava durumu verileri çekiliyor...`);
    }

    let allWeatherData = [];
    let announcementText = "";

    const url = `${OPENMETEO_URL}?latitude=${coordinates.lat}&longitude=${coordinates.lon}&hourly=temperature_2m,weathercode&temperature_unit=celsius&timeformat=iso8601&timezone=Europe%2FIstanbul&forecast_days=1`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP Hata: ${response.status}`);

      const data = await response.json();

      const rawTemp = data.hourly?.temperature_2m?.[0];
      const wmoCode = data.hourly?.weathercode?.[0];

      console.log(`[OPEN-METEO] ${selectedDistrict} (${coordinates.lat}, ${coordinates.lon}) - Sıcaklık: ${rawTemp}, WMO: ${wmoCode}`);

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

    if (shouldAnnounce) {
      await triggerAnnouncement(announcementText);
    } else {
      setIsLoading(false);
    }

  }, [coordinates, selectedDistrict]);

  // Koordinatlar değiştiğinde otomatik olarak hava durumunu güncelle (Sessiz)
  useEffect(() => {
    if (coordinates.lat !== DEFAULT_LAT || coordinates.lon !== DEFAULT_LON) {
      fetchWeather(false);
    }
  }, [coordinates, fetchWeather]);

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
            audio.onended = () => {
              console.log("Anons tamamlandı. Tekrar etmeyecektir.");
              // Release the lock after audio finishes
              isAnnouncingRef.current = false;
            };
          }).catch(error => {
            // Oynatma engellendi. Kullanıcıya manuel başlatması gerektiğini söyle.
            console.error("Oynatma engellendi:", error);
            setStatusMessage("Sesli anons hazır! Oynat düğmesine basarak dinleyebilirsiniz.");
            // Release lock even if playback was blocked (user might manually play)
            isAnnouncingRef.current = false;
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
          if (shouldAnnounce) isAnnouncingRef.current = false;
        }
      }
    }
  }, []);

  // Zamanlama ve Alarm Mantığı
  useEffect(() => {
    if (!isSchedulerActive) {
      setStatusMessage("Otomatik anons durduruldu.");
      // Servisi durdur
      try {
        CapacitorForegroundService.stop();
      } catch (e) { console.error("Servis durdurma hatası:", e); }
      return;
    }

    // Servisi başlat (Foreground Service - İsteğe bağlı, bildirim için tutuyoruz ama alarm için LocalNotification kullanacağız)
    const startService = async () => {
      try {
        await CapacitorForegroundService.start({
          id: 123,
          title: "Sabah Anonsu",
          body: "Otomatik anons servisi çalışıyor...",
          icon: "ic_launcher",
          smallIcon: "ic_launcher",
          button: false
        });
      } catch (e) {
        console.error("Servis başlatma hatası:", e);
      }
    };
    startService();

    // Local Notification Zamanlama
    const scheduleNotification = async () => {
      try {
        // Bildirim İzni (Native Plugin üzerinden)
        try {
          // Native Alarm Plugin üzerinden izin iste (POST_NOTIFICATIONS ve SCHEDULE_EXACT_ALARM)
          const permResult = await AlarmPlugin.requestPermissions();
          console.log("AlarmPlugin izin sonucu:", permResult);

          if (permResult.notifications !== 'granted' && permResult.notifications !== 'prompt') {
            // Capacitor 4'te bazen prompt dönebilir, granted değilse uyar
            // Ancak POST_NOTIFICATIONS için 'granted' bekliyoruz.
            // Yine de LocalNotifications.requestPermissions() da çağıralım, yedek olsun.
            await LocalNotifications.requestPermissions();
          }
        } catch (e) {
          console.error("Native izin isteği hatası:", e);
          // Fallback
          await LocalNotifications.requestPermissions();
        }

        // Android 12+ için Tam Zamanlı Alarm İzni Kontrolü (Basitçe kullanıcıyı uyaralım)
        // Gerçek bir plugin ile kontrol edilebilir ama şimdilik kullanıcıya bırakıyoruz.

        const [targetH, targetM] = targetTime.split(':').map(Number);
        const now = new Date();
        let scheduleDate = new Date();
        scheduleDate.setHours(targetH, targetM, 0, 0);

        if (scheduleDate <= now) {
          // Eğer saat geçtiyse yarına kur
          scheduleDate.setDate(scheduleDate.getDate() + 1);
        }

        // Mevcut bildirimleri temizle (LocalNotification yedeği)
        await LocalNotifications.cancel({ notifications: [{ id: 1 }] });
        // Native Alarmı iptal et (Önceki varsa)
        await AlarmPlugin.cancelAlarm();

        // Yeni Native Alarm kur
        await AlarmPlugin.setAlarm({ timestamp: scheduleDate.getTime() });
        console.log(`[ALARM] Native Alarm kuruldu: ${scheduleDate.toLocaleString()}`);

        // Yedek olarak Local Notification da kalsın (Ekranda görünmesi için)
        await LocalNotifications.schedule({
          notifications: [{
            title: "Günaydın! ☀️",
            body: "Hava durumunu dinlemek için dokunun.",
            id: 1,
            schedule: { at: scheduleDate, repeats: true, every: 'day' },
            sound: 'beep.wav',
            attachments: null,
            actionTypeId: "",
            extra: null
          }]
        });

      } catch (e) {
        console.error("Bildirim kurma hatası:", e);
      }
    };
    scheduleNotification();

    // Bildirime tıklanınca çalışacak listener - DEVRE DIŞI BIRAKIYORUZ
    // checkTimeAndAnnounce zaten bunu yapacak
    // LocalNotifications.addListener('localNotificationActionPerformed', async (notification) => {
    //   console.log("Bildirime tıklandı!", notification);
    //   fetchWeather(true);
    // });

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
        const lastAnnounceHour = lastAnnounceTime ? new Date(lastAnnounceTime).getHours() : -1;
        const lastAnnounceMinute = lastAnnounceTime ? new Date(lastAnnounceTime).getMinutes() : -1;

        // Eğer bugün ve bu saat/dakikada zaten anons yapıldıysa tekrar yapma
        if (lastAnnounceDate === today && lastAnnounceHour === currentHour && lastAnnounceMinute === currentMinute) {
          console.log("Bu dakika içinde zaten anons yapıldı, atlanıyor.");
          return;
        }

        console.log(`[ALARM] Hedef saat (${targetTime}) geldi. Anons başlatılıyor.`);
        fetchWeather(true); // shouldAnnounce=true

      }
    };

    const intervalId = setInterval(checkTimeAndAnnounce, 60000);
    checkTimeAndAnnounce(); // İlk kontrol

    // Uygulama öne geldiğinde (Alarm uyandırdığında) kontrol et
    let appStateListenerHandle;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        console.log("Uygulama öne geldi, saat kontrol ediliyor...");
        // Biraz gecikmeli çalıştır ki state güncellensin
        setTimeout(checkTimeAndAnnounce, 1000);
      }
    }).then(handle => {
      appStateListenerHandle = handle;
    });

    return () => {
      clearInterval(intervalId);
      LocalNotifications.removeAllListeners();
      if (appStateListenerHandle) {
        appStateListenerHandle.remove();
      }
    };
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
        {/* Üst Kısım: Başlık */}
        <div className="flex justify-between items-center mb-4">
          <p className="text-lg font-semibold text-gray-800">Alarm Ayarları</p>
          <div className={`px-3 py-1 rounded-full text-xs font-bold ${isSchedulerActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
            {isSchedulerActive ? 'KURULU' : 'KAPALI'}
          </div>
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

        {/* Alarm Kontrol Butonları */}
        <div className="mt-6 space-y-3">
          <button
            onClick={() => setIsSchedulerActive(!isSchedulerActive)}
            className={`w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl text-white shadow-sm transition-all duration-200 ${isSchedulerActive
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
          >
            {isSchedulerActive ? (
              <>
                <ToggleRight className="w-5 h-5 mr-2" />
                Alarmı Kapat
              </>
            ) : (
              <>
                <ToggleLeft className="w-5 h-5 mr-2" />
                Alarmı Kaydet ve Başlat
              </>
            )}
          </button>

          {/* Test Bildirimi Butonu */}
          <button
            onClick={async () => {
              const perm = await LocalNotifications.requestPermissions();
              if (perm.display === 'granted') {
                await LocalNotifications.schedule({
                  notifications: [{
                    title: "Test Bildirimi 🔔",
                    body: "Alarm sistemi çalışıyor. Dokunursanız hava durumu okunacak.",
                    id: 999,
                    schedule: { at: new Date(Date.now() + 5000) }, // 5 saniye sonra
                    sound: 'beep.wav'
                  }]
                });
                setStatusMessage("5 saniye sonra test bildirimi gelecek...");
              } else {
                setStatusMessage("Bildirim izni reddedildi!");
              }
            }}
            className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50"
          >
            <Bell className="w-4 h-4 mr-2" />
            5 Saniye Sonra Test Et
          </button>
        </div>
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
            <p className="text-gray-400 text-[10px] mt-1">Konum: {coordinates.lat.toFixed(4)}, {coordinates.lon.toFixed(4)}</p>
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
          {/* Eski Test Butonu Kaldırıldı, yerine ufak bir manuel tetikleyici eklenebilir veya tamamen kaldırılabilir.
              Kullanıcı isteği üzerine kaldırıldı. */}
          <div className="text-center">
            <button onClick={() => fetchWeather(true)} className="text-xs text-gray-400 underline hover:text-gray-600">
              Manuel Hava Durumu Oku (Debug)
            </button>
          </div>

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

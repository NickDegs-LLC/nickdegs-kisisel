# Chatterbox TTS + telsiz işleme — rastgele kod/isim satırlarını üretir (önbellekli).
# Kadın: ref/female.wav (af_kore), exaggeration=0.2 cfg=0.9 temp=0.45, atempo=1.34
# Erkek: ref/male.wav (onyx), aynı üretim ayarları, tempo yok
import os, hashlib, subprocess

T = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(T, "voices", "cache"); os.makedirs(CACHE, exist_ok=True)
_MODEL = None

def _model():
    global _MODEL
    if _MODEL is None:
        from chatterbox.tts import ChatterboxTTS
        _MODEL = ChatterboxTTS.from_pretrained(device="cpu")
    return _MODEL

# Chatterbox uzun cümlede GİTTİKÇE HIZLANIR -> kademeli tempo telafisi (bas 1.42 / orta 1.33 / son 1.22)
FEM_POST = "asoftclip=type=tanh:threshold=0.62,equalizer=f=1900:t=q:w=1.2:g=1.8,equalizer=f=5000:t=q:w=1:g=-3,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,highpass=f=220,lowpass=f=5200,loudnorm=I=-16:TP=-1.5,silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"
FEM_CHAIN = "atempo=1.30," + FEM_POST
MALE_CHAIN = "asoftclip=type=tanh:threshold=0.62,equalizer=f=1900:t=q:w=1.2:g=1.8,equalizer=f=5000:t=q:w=1:g=-2,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,highpass=f=240,lowpass=f=5000,loudnorm=I=-16:TP=-1.5,silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"

def line(text, voice="female"):
    """Metni üret + telsiz zinciri uygula; önbellekten döner (aynı metin 1 kez üretilir).
    Dönüş: işlenmiş wav yolu."""
    key = hashlib.sha1(f"v9|{voice}|{text}".encode()).hexdigest()[:16]
    out = os.path.join(CACHE, f"{voice}_{key}_p.wav")
    if os.path.exists(out):
        return out
    raw = os.path.join(CACHE, f"{voice}_{key}_raw.wav")
    import torchaudio
    m = _model()
    ref = os.path.join(T, "voices", "ref", "female.wav" if voice == "female" else "male.wav")
    # ASKERİ OPERASYONEL RESMİ TON: düz/kontrollü/otoriter (düşük exag=duygusuz, yüksek cfg=kesik/net, düşük temp=kararlı)
    w = m.generate(text, audio_prompt_path=ref, exaggeration=0.30, cfg_weight=0.80, temperature=0.50)
    # WAV kaydı: soundfile (libsndfile) — torchaudio.save torchcodec/FFmpeg-lib eşleşmesi ister (Cloud Run'da kırılgan);
    # soundfile her yerde çalışır ve ses içeriği BİREBİR aynıdır (aynı örnekler). [C,T]->[T,C].
    import soundfile as _sf
    _wav = w.detach().cpu().numpy()
    if _wav.ndim == 2: _wav = _wav.T
    _sf.write(raw, _wav, int(m.sr))
    # süre ölç: uzun kadın satırı -> 3 dilim kademeli tempo (model sona doğru hızlanır, biz tersine yavaşlatırız)
    import json as _j
    _pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", raw], capture_output=True, text=True)
    _D = float(_pr.stdout.strip() or 0)
    if voice == "female" and _D > 4.0:
        # 8 İNCE DİLİM: 1.31 -> 1.15 doğrusal rampa (dilim farkı ~%2 = kulak duymaz, akıcı)
        NSEG = 8
        parts = []; concat_in = ""
        for k in range(NSEG):
            a0 = _D * k / NSEG; a1 = _D * (k + 1) / NSEG
            tp = 1.34 - (1.34 - 1.20) * (k / (NSEG - 1))
            seg = f"[0]atrim={a0:.3f}:{a1:.3f},asetpts=PTS-STARTPTS,atempo={tp:.3f}[s{k}]"
            parts.append(seg); concat_in += f"[s{k}]"
        fcs = ";".join(parts) + f";{concat_in}concat=n={NSEG}:v=0:a=1,{FEM_POST}[out]"
        subprocess.run(["ffmpeg", "-v", "error", "-i", raw, "-filter_complex", fcs,
                        "-map", "[out]", "-ar", "44100", "-ac", "1", out, "-y"], check=True)
    else:
        chain = FEM_CHAIN if voice == "female" else MALE_CHAIN
        subprocess.run(["ffmpeg", "-v", "error", "-i", raw, "-af", chain,
                        "-ar", "44100", "-ac", "1", out, "-y"], check=True)
    os.remove(raw)
    return out

def open_line(code_words):
    """Kadın açılış: rastgele kod her videoda farklı."""
    return line(f"{code_words}, this is Actual. How copy?", "female")

def brief_line(name, vehicle, short=False):
    """Kadın brifing: kullanıcı adı + araç tipi (kişi+araç başına 1 kez üretilir/önbellek).
    short=True (1dk optimizasyonu, Barış 2026-07-27): kısa brifing -> intro kısalır, rotaya daha çok süre kalır.
    'Callsign {name}' ibaresi KORUNUR (TL_CALLSIGN/TL_ORDER anchor'ları d_brief oranına bağlı, korunur)."""
    v = "motorcycle" if vehicle != "car" else "vehicle"
    if short:
        return line(f"Be advised. Callsign {name}, on a {v}, on the move. "
                    f"Maintain visual. Do you copy?", "female")
    return line(f"Be advised. Your target is on the move. Callsign {name}, "
                f"operating a {v}. Track the vehicle and maintain visual. Do you copy?", "female")

if __name__ == "__main__":
    import sys
    print(line(" ".join(sys.argv[2:]) or "Radio check.", sys.argv[1] if len(sys.argv) > 1 else "female"))

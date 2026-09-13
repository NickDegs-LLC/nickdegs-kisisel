# Taktik video RASTGELELİK HAVUZU — her render'da: 3 şehir çekilişi + her şehrin rastgele
# landmark'ı (Commons'tan canlı çekilir) + rastgele auth kodu. İki video asla aynı olmaz.
import random

# (şehir adı, lon, lat, [landmark arama terimleri — Commons'ta güvenilir sonuç verenler])
CITIES = [
    ("NEW YORK", -74.0, 40.71, ["Statue of Liberty", "Empire State Building", "Brooklyn Bridge"]),
    ("LONDON", -0.12, 51.5, ["Big Ben", "Tower Bridge", "London Eye"]),
    ("TOKYO", 139.69, 35.68, ["Tokyo Tower", "Tokyo Skytree", "Sensoji Temple"]),
    ("PARIS", 2.35, 48.85, ["Eiffel Tower", "Arc de Triomphe", "Louvre Pyramid"]),
    ("RIO DE JANEIRO", -43.2, -22.9, ["Christ the Redeemer", "Sugarloaf Mountain"]),
    ("MOSCOW", 37.62, 55.75, ["Saint Basil's Cathedral", "Moscow Kremlin"]),
    ("DUBAI", 55.27, 25.2, ["Burj Khalifa", "Burj Al Arab"]),
    ("SYDNEY", 151.21, -33.87, ["Sydney Opera House", "Sydney Harbour Bridge"]),
    ("ROME", 12.5, 41.9, ["Colosseum", "Trevi Fountain", "Pantheon Rome"]),
    ("BERLIN", 13.4, 52.52, ["Brandenburg Gate", "Berlin TV Tower"]),
    ("MADRID", -3.7, 40.42, ["Royal Palace of Madrid", "Puerta de Alcala"]),
    ("CAIRO", 31.24, 30.04, ["Great Pyramid of Giza", "Great Sphinx of Giza"]),
    ("BEIJING", 116.4, 39.9, ["Forbidden City", "Temple of Heaven"]),
    ("SEOUL", 126.98, 37.57, ["N Seoul Tower", "Gyeongbokgung"]),
    ("SINGAPORE", 103.85, 1.29, ["Marina Bay Sands", "Merlion"]),
    ("SAN FRANCISCO", -122.42, 37.77, ["Golden Gate Bridge", "Alcatraz Island"]),
    ("CHICAGO", -87.63, 41.88, ["Willis Tower", "Cloud Gate"]),
    ("TORONTO", -79.38, 43.65, ["CN Tower", "Casa Loma"]),
    ("MEXICO CITY", -99.13, 19.43, ["Angel of Independence", "Palacio de Bellas Artes"]),
    ("BUENOS AIRES", -58.38, -34.6, ["Obelisco de Buenos Aires", "Casa Rosada"]),
    ("AMSTERDAM", 4.9, 52.37, ["Rijksmuseum", "Westerkerk"]),
    ("VIENNA", 16.37, 48.21, ["Schonbrunn Palace", "St. Stephen's Cathedral Vienna"]),
    ("PRAGUE", 14.42, 50.09, ["Charles Bridge", "Prague Castle"]),
    ("ATHENS", 23.73, 37.98, ["Parthenon", "Acropolis of Athens"]),
    ("LISBON", -9.14, 38.72, ["Belem Tower", "Jeronimos Monastery"]),
    ("BANGKOK", 100.5, 13.75, ["Wat Arun", "Grand Palace Bangkok"]),
    ("MUMBAI", 72.88, 19.08, ["Gateway of India", "Chhatrapati Shivaji Terminus"]),
    ("SHANGHAI", 121.47, 31.23, ["Oriental Pearl Tower", "The Bund"]),
    ("HONG KONG", 114.17, 22.32, ["Victoria Harbour", "Tian Tan Buddha"]),
    ("KUALA LUMPUR", 101.69, 3.14, ["Petronas Towers", "Batu Caves"]),
    ("OSLO", 10.75, 59.91, ["Oslo Opera House", "Akershus Fortress"]),
    ("STOCKHOLM", 18.07, 59.33, ["Stockholm City Hall", "Vasa Museum"]),
    ("COPENHAGEN", 12.57, 55.68, ["The Little Mermaid statue", "Nyhavn"]),
    ("WARSAW", 21.01, 52.23, ["Palace of Culture and Science", "Warsaw Old Town"]),
    ("BUDAPEST", 19.04, 47.5, ["Hungarian Parliament Building", "Chain Bridge Budapest"]),
    ("DOHA", 51.53, 25.29, ["Museum of Islamic Art Doha", "Doha skyline"]),
    ("CAPE TOWN", 18.42, -33.93, ["Table Mountain", "Cape Town Stadium"]),
    ("LOS ANGELES", -118.24, 34.05, ["Hollywood Sign", "Griffith Observatory"]),
    ("MIAMI", -80.19, 25.76, ["Miami Beach", "Freedom Tower Miami"]),
    ("VANCOUVER", -123.12, 49.28, ["Canada Place", "Lions Gate Bridge"]),
]

# rota-içi telsiz çağrı havuzu (klip adı, uzun-rotada tekrar edebilir)
MIDCALLS = ["cont_clip", "m_still_p"]

DIGITS = ["Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine"]

def draw(seed=None, n=3):
    """Bir render için tüm rastgele seçimler. seed=None -> os kaynaklı gerçek rastgele."""
    rnd = random.Random(seed)
    cities = rnd.sample(CITIES, max(1, min(3, n)))
    picks = []
    for name, lon, lat, lms in cities:
        picks.append({"name": name, "lon": lon, "lat": lat, "landmark": rnd.choice(lms)})
    code_digits = [rnd.randrange(10) for _ in range(4)]
    code_words = " ".join(DIGITS[d] for d in code_digits)          # "Nine One Three Two"
    code_disp = " ".join(DIGITS[d].upper() for d in code_digits)   # ekrandaki hali
    return {"cities": picks, "code_words": code_words, "code_disp": code_disp,
            "seed": rnd.randrange(10**9)}

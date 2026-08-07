#!/usr/bin/env python3
"""
Обновляет карточки в index.html свежими выпусками из плейлистов YouTube.

Разделы описаны в SECTIONS: подкаст и фильмы. Для каждого:
  • тянет публичный RSS плейлиста (без API-ключа);
  • берёт N самых свежих по дате публикации;
  • скачивает обложки и кладёт локально (чтобы не нарушать img-src 'self');
  • переписывает разметку между маркерами <!-- <KEY>:START --> и <!-- <KEY>:END -->.

Запуск: python3 .github/scripts/update_playlists.py
Идемпотентен: без изменений файлы не трогает.
"""
import io
import os
import re
import sys
import html
import json
import urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX = os.path.join(ROOT, "index.html")
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9",   # фиксируем локаль → относительные даты по-русски
    "Cookie": "CONSENT=YES+1",             # пропускаем экран согласия
}

SECTIONS = [
    {"key": "PODCAST", "pid": "PLHkpyDUzliZdLCh0CH-5ZzJSdQfTv_obi",
     "dir": "assets/img/podcast", "prefix": "ep", "count": 3},
    {"key": "FILMS", "pid": "PLHkpyDUzliZf0yyXypIbe6gSuLzmLsEaw",
     "dir": "assets/img/films", "prefix": "film", "count": 3},
]


def fetch(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None  # блокируем редирект, чтобы поймать его как HTTPError


def is_short(video_id):
    """Shorts: страница youtube.com/shorts/<id> отдаётся напрямую (200).
    У обычного видео та же ссылка редиректит на /watch — значит, не Shorts."""
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        r = opener.open(urllib.request.Request(
            f"https://www.youtube.com/shorts/{video_id}", headers=UA), timeout=15)
        return getattr(r, "status", r.getcode()) == 200
    except Exception:
        return False  # редирект/ошибка → считаем обычным (длинным) видео


def playlist_videos(pid):
    """Видео в порядке плейлиста (как на странице YouTube: сверху — свежие).
    RSS-фид плейлистов ненадёжен, поэтому парсим саму страницу (ytInitialData)."""
    page = fetch(f"https://www.youtube.com/playlist?list={pid}&hl=ru").decode("utf-8", "replace")
    m = re.search(r"ytInitialData\s*=\s*(\{.*?\})\s*;\s*</script>", page, re.S)
    if not m:
        raise RuntimeError("не нашёл ytInitialData на странице плейлиста")
    data = json.loads(m.group(1))
    out, seen = [], set()

    def collect_texts(o, acc):
        if isinstance(o, dict):
            c = o.get("content")
            if isinstance(c, str):
                acc.append(c)
            for v in o.values():
                collect_texts(v, acc)
        elif isinstance(o, list):
            for v in o:
                collect_texts(v, acc)

    def age_days(lvm):
        """Возраст ролика в днях из относительного времени («3 года назад»).
        Сначала метаданные, затем — весь блок ролика (устойчивость к раскладкам)."""
        for src in (lvm.get("metadata", {}), lvm):
            acc = []
            collect_texts(src, acc)
            for s in acc:
                mm = re.search(r"(\d+)\s+([а-яё]+)\s+назад", s.lower())
                if not mm:
                    continue
                n, u = int(mm.group(1)), mm.group(2)
                if u.startswith(("год", "лет", "года")): return n * 365
                if u.startswith("месяц"): return n * 30
                if u.startswith("недел"): return n * 7
                if u.startswith(("дн", "день", "дня")): return n
                if u.startswith("час"): return n / 24
                if u.startswith(("минут", "секунд")): return 0.0
        return float("inf")

    def title_of(lvm):
        try:
            return lvm["metadata"]["lockupMetadataViewModel"]["title"]["content"]
        except Exception:
            return ""

    def views_of(lvm):
        for src in (lvm.get("metadata", {}), lvm):
            acc = []
            collect_texts(src, acc)
            for s in acc:
                if "просмотр" in s.lower():
                    return s.strip()
        return ""

    def walk(o):
        if isinstance(o, dict):
            lvm = o.get("lockupViewModel")
            if isinstance(lvm, dict):
                vid = lvm.get("contentId")
                # берём только видео (11-символьный id); плейлист-обложку в шапке пропускаем
                if vid and len(vid) == 11 and vid not in seen:
                    seen.add(vid)
                    out.append({"id": vid, "title": (title_of(lvm) or "").strip(),
                                "age": age_days(lvm), "views": views_of(lvm)})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    return out


def pick_long(pid, count):
    """Самые свежие по дате длинные видео (Shorts отбрасываем)."""
    out = []
    for ep in sorted(playlist_videos(pid), key=lambda x: x["age"]):
        if is_short(ep["id"]):
            print(f"    пропускаю Shorts: {ep['id']} — {ep['title'][:45]}")
            continue
        out.append(ep)
        if len(out) >= count:
            break
    return out


def save_cover(video_id, dst):
    """Обложка 16:9 → 480x270 WebP. maxres → sd → hq с центральным кропом."""
    data = None
    for name in ("maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg"):
        try:
            d = fetch(f"https://i.ytimg.com/vi/{video_id}/{name}")
            if d and len(d) > 1500:
                data = d
                break
        except Exception:
            pass
    if not data:
        raise RuntimeError(f"нет обложки для {video_id}")
    im = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = im.size
    if w * 9 > h * 16:                      # шире 16:9 — режем по бокам
        nw = int(h * 16 / 9); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:                                   # выше 16:9 — режем сверху/снизу
        nh = int(w * 9 / 16); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im.resize((480, 270), Image.LANCZOS).save(dst, "WEBP", quality=82, method=6)


def clean_title(t):
    t = re.sub(r"#\S+", "", t)                 # убрать хэштеги
    t = re.sub(r"\s{2,}", " ", t).strip(" |·—-")
    return t


def card_html(ep, rel, n):
    title = html.escape(clean_title(ep["title"]))
    url = f"https://www.youtube.com/watch?v={ep['id']}"
    views = html.escape((ep.get("views") or "").strip())
    views_html = f'<span class="vcard-views">{views}</span>' if views else ""
    return (
        f'<a class="vcard" href="{url}" target="_blank" rel="noopener">'
        f'<span class="imgph imgph--169 imgph--filled">'
        f'<img src="{rel}/{n}" width="480" height="270" alt="{title}" loading="lazy" decoding="async"></span>'
        f'<span class="vcard-cap">{title}</span>{views_html}</a>'
    )


def update_section(src, sec):
    eps = pick_long(sec["pid"], sec["count"])
    if not eps:
        print(f"[{sec['key']}] фид пуст — пропускаю", file=sys.stderr)
        return src
    os.makedirs(os.path.join(ROOT, sec["dir"]), exist_ok=True)
    cards = []
    for i, ep in enumerate(eps, 1):
        fname = f"{sec['prefix']}{i}.webp"
        save_cover(ep["id"], os.path.join(ROOT, sec["dir"], fname))
        cards.append(card_html(ep, sec["dir"], fname))
        print(f"[{sec['key']}] {ep['id']} — {ep['title'][:60]}")
    key = sec["key"]
    block = (f"<!-- {key}:START — генерируется автоматически из плейлиста "
             f"(.github/scripts/update_playlists.py), вручную не редактировать -->\n"
             + "\n".join(cards) + f"\n<!-- {key}:END -->")
    return re.sub(rf"<!-- {key}:START.*?{key}:END -->", block, src, flags=re.S)


def main():
    src = open(INDEX, encoding="utf-8").read()
    new = src
    for sec in SECTIONS:
        new = update_section(new, sec)
    if new == src:
        print("index.html без изменений")
    else:
        open(INDEX, "w", encoding="utf-8").write(new)
        print("index.html обновлён")
    return 0


if __name__ == "__main__":
    sys.exit(main())

/* ============================================================
   Радислав Гандапас — интерактив

   Поведение перенесено из прежнего инлайнового скрипта без
   изменений. Отличия только там, где было чем-то неудобно:
   • обработчики форм переехали сюда из атрибутов onsubmit —
     иначе политика безопасности блокирует их выполнение;
   • кнопка «закрыть» у видео вынесена из блока, который
     перезаписывается при открытии, и больше не пересоздаётся;
   • всё, что дублируется для бесшовной ленты, помечается
     aria-hidden, чтобы скринридер не читал список дважды.
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hdr = document.getElementById('hdr');

  /* ---------- Мобильное меню ---------- */
  (function () {
    var mnav = document.getElementById('mnav');
    var burger = document.getElementById('burger');
    if (!mnav || !burger) return;

    function set(open) {
      mnav.classList.toggle('open', open);
      hdr.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
    }

    burger.addEventListener('click', function () {
      set(!mnav.classList.contains('open'));
    });
    mnav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { set(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !mnav.classList.contains('open')) return;
      set(false);
      burger.focus();
    });
  })();

  /* ---------- Бегущие строки ----------
     Лента прокручивается на -50%, поэтому содержимое должно идти
     ровно дважды. Копия — визуальная, для скринридера скрыта. */
  document.querySelectorAll('#mq,.lgmq-track').forEach(function (track) {
    var copy = track.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    while (copy.firstChild) track.appendChild(copy.firstChild);
  });

  /* ---------- Стрелки расписания ---------- */
  (function () {
    var track = document.getElementById('sched-track');
    if (!track) return;
    document.querySelectorAll('.snav').forEach(function (b) {
      b.addEventListener('click', function () {
        var card = track.querySelector('.scard');
        var step = card ? card.getBoundingClientRect().width + 16 : 392;
        track.scrollBy({ left: (+b.dataset.dir) * step, behavior: reduce ? 'auto' : 'smooth' });
      });
    });
  })();

  /* ---------- Появление блоков ---------- */
  (function () {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.rv').forEach(function (el) {
      if (el.tagName !== 'H1' && el.tagName !== 'H2') { io.observe(el); return; }
      // Заголовки обрезаны через clip-path и сообщают наблюдателю нулевой
      // прямоугольник. Поэтому следим не за самим заголовком, а за
      // невидимой меткой рядом с ним.
      var mark = document.createElement('span');
      mark.style.cssText = 'position:absolute;width:1px;height:1px;pointer-events:none;visibility:hidden';
      el.parentNode.insertBefore(mark, el);
      var hio = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          el.classList.add('in');
          hio.disconnect();
          mark.remove();
        });
      }, { threshold: 0, rootMargin: '0px 0px -60px 0px' });
      hio.observe(mark);
    });
  })();

  /* ---------- Счётчики ---------- */
  (function () {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;

    function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

    if (reduce) {
      els.forEach(function (el) { el.textContent = fmt(+el.dataset.count); });
      return;
    }

    var cio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        var el = e.target, end = +el.dataset.count, t0 = null, dur = 1800;
        requestAnimationFrame(function step(t) {
          if (!t0) t0 = t;
          var p = 1 - Math.pow(1 - Math.min((t - t0) / dur, 1), 3);
          el.textContent = fmt(Math.round(end * p));
          if (p < 1) requestAnimationFrame(step);
        });
      });
    }, { threshold: .4 });

    els.forEach(function (el) { cio.observe(el); });
  })();

  /* ---------- Прокрутка: фон шапки и параллакс ----------
     Один слушатель на страницу, вся работа внутри кадра. */
  (function () {
    var layers = [].slice.call(document.querySelectorAll('[data-px]'));
    var ticking = false;

    function frame() {
      ticking = false;
      hdr.classList.toggle('scrolled', window.scrollY > 40);
      if (reduce) return;

      var vh = window.innerHeight;
      var shifts = layers.map(function (el) {
        var r = el.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return null;
        var prog = (r.top + r.height / 2 - vh / 2) / vh;
        return (prog * r.height * +el.dataset.px * -1).toFixed(1);
      });
      shifts.forEach(function (v, i) {
        if (v !== null) layers[i].style.transform = 'translateY(' + v + 'px)';
      });
    }

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(frame);
    }, { passive: true });
    frame();
  })();

  /* ---------- Плавающее видео ----------
     Ролик подгружается только по клику, поэтому при обычном
     заходе YouTube ничего не получает. */
  (function () {
    var box = document.getElementById('vidw');
    var open = document.getElementById('vidw-open');
    var close = document.getElementById('vidw-close');
    if (!box || !open || !close) return;

    open.addEventListener('click', function () {
      if (box.classList.contains('open')) return;
      box.classList.add('open');
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/2DsdLHTyXRA?autoplay=1&rel=0';
      f.title = 'Видео: Радислав Гандапас';
      f.allow = 'autoplay; encrypted-media; picture-in-picture';
      f.allowFullscreen = true;
      open.replaceWith(f);
    });

    close.addEventListener('click', function (e) {
      e.stopPropagation();
      box.classList.add('hide');
    });
  })();

  /* ---------- Формы ----------
     Черновик: отправлять некуда, поэтому форма просто
     подтверждает отправку. Подключить приём заявок — здесь. */
  document.querySelectorAll('form[data-fake]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var p = document.createElement('p');
      p.setAttribute('role', 'status');
      p.className = 'form-done';   // вид задаёт родитель: .formcard или .fsub
      p.textContent = form.dataset.done || 'Готово.';
      form.replaceWith(p);
    });
  });

  /* ---------- Cookie-уведомление ----------
     Показывается один раз; согласие запоминается в localStorage.
     Если хранилище недоступно — плашка просто показывается и
     закрывается на время сессии, без ошибок. */
  (function () {
    var bar = document.getElementById('cookie');
    var ok = document.getElementById('cookie-ok');
    if (!bar || !ok) return;
    var vidw = document.getElementById('vidw');   // плавающее видео (только на главной)
    var KEY = 'rg-cookie-ok';
    var agreed = false;
    try { agreed = !!localStorage.getItem(KEY); } catch (e) {}
    if (agreed) return;
    bar.hidden = false;
    // Пока строка висит — приподнимаем видео-виджет ровно на её высоту,
    // чтобы они не пересекались ни на одном экране. Видео остаётся видимым.
    function lift() {
      if (vidw) vidw.style.setProperty('--cookie-lift', (bar.offsetHeight + 16) + 'px');
    }
    if (vidw) {
      lift();
      vidw.classList.add('cookie-wait');
      window.addEventListener('resize', lift);
    }
    // pointerup ловит тап у нижней кромки экрана надёжнее, чем click
    // (iOS Safari может потратить первый тап на показ своей панели);
    // done-флаг защищает от двойного срабатывания pointerup+click.
    var done = false;
    function accept() {
      if (done) return;
      done = true;
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      bar.hidden = true;
      if (vidw) {
        vidw.classList.remove('cookie-wait');
        window.removeEventListener('resize', lift);
      }
    }
    ok.addEventListener('pointerup', accept);
    ok.addEventListener('click', accept);
  })();

  /* ---------- Ленивое фоновое видео ----------
     [data-lazy-video] с preload="none" не тянет ни байта, пока блок
     не приблизится к экрану. Вне экрана — пауза (трафик и батарея). */
  (function () {
    var vids = document.querySelectorAll('video[data-lazy-video]');
    if (!vids.length) return;
    if (!('IntersectionObserver' in window)) {
      vids.forEach(function (v) { v.play().catch(function () {}); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) e.target.play().catch(function () {});
        else e.target.pause();
      });
    }, { rootMargin: '200px 0px' });
    vids.forEach(function (v) { io.observe(v); });
  })();

  /* ---------- Разворачивание списка программ ----------
     Кнопка [data-expand] раскрывает скрытые строки .prow--more
     в списке с соответствующим id и меняет свой текст. */
  document.querySelectorAll('[data-expand]').forEach(function (btn) {
    var list = document.getElementById(btn.dataset.expand);
    if (!list) return;
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      var open = list.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? btn.dataset.less : btn.dataset.more;
    });
  });

  /* ---------- Видео в секциях (Rutube/YouTube по клику) ----------
     Активна только у .videobox с data-embed. Заглушки без адреса
     остаются статичными. Ролик подгружается лишь после клика. */
  document.querySelectorAll('.videobox[data-embed]').forEach(function (box) {
    box.addEventListener('click', function () {
      if (box.dataset.loaded) return;
      box.dataset.loaded = '1';
      var f = document.createElement('iframe');
      f.src = box.dataset.embed;
      f.title = 'Видео: Радислав Гандапас';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      box.innerHTML = '';
      box.appendChild(f);
    });
  });
})();

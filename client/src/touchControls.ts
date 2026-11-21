const isRealTouchDevice =
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0 ||
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  new URLSearchParams(window.location.search).has('touch');

let virtualPointerLocked = false;

if (isRealTouchDevice) {
  // ۱. جعل مشخصات مرورگر به عنوان دسکتاپ ویندوز قبل از اجرای کدهای بازی
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: () =>
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
      configurable: true,
    });
  } catch {
    // ignore if non-configurable
  }

  try {
    delete (window as unknown as Record<string, unknown>).ontouchstart;
  } catch {
    // ignore
  }

  // ۲. دور زدن بررسی‌های CSS/JS مربوط به نمایشگر لمسی و عرض کم صفحه
  if (typeof window.matchMedia === 'function') {
    const origMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string): MediaQueryList => {
      const mql = origMatchMedia(query);
      const q = query.toLowerCase();
      const isMobileQuery =
        q.includes('pointer: coarse') ||
        q.includes('any-pointer: coarse') ||
        q.includes('hover: none') ||
        q.includes('any-hover: none') ||
        q.includes('max-width');
      const isDesktopQuery =
        q.includes('pointer: fine') ||
        q.includes('hover: hover');

      if (isMobileQuery || isDesktopQuery) {
        const forcedMatches = isMobileQuery ? false : true;
        return new Proxy(mql, {
          get(target, prop) {
            if (prop === 'matches') return forcedMatches;
            const val = Reflect.get(target, prop, target);
            return typeof val === 'function' ? val.bind(target) : val;
          },
        });
      }
      return mql;
    };
  }

  // ۳. شبیه‌سازی Pointer Lock در سافاری آیفون برای کار کردن چرخش دوربین
  const origLockDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get() {
      if (virtualPointerLocked) {
        return document.querySelector('canvas');
      }
      return origLockDesc?.get ? origLockDesc.get.call(document) : null;
    },
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initTouchControls);
  } else {
    initTouchControls();
  }
}

function initTouchControls(): void {
  // تنظیم عرض صفحه روی ۱۰۲۴ پیکسل تا منوهای دسکتاپ بازی بدون به هم ریختگی نمایش داده شوند
  let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.content = 'width=1024, initial-scale=1, maximum-scale=1, user-scalable=no';

  // حذف خودکار هرگونه بنر یا صفحه مزاحم که پیام Desktop Only نمایش می‌دهد
  const hideDesktopOnlyBanners = () => {
    const elements = document.querySelectorAll('div, section, aside, p, h1, h2, h3');
    elements.forEach((node) => {
      const el = node as HTMLElement;
      if (
        el === document.body ||
        el === document.documentElement ||
        el.id === 'kr-touch-hud' ||
        el.closest('#kr-touch-hud') ||
        el.querySelector('canvas')
      ) {
        return;
      }
      const text = (el.textContent || '').trim();
      if (
        text.length > 0 &&
        text.length < 300 &&
        /desktop\s*only|on\s+a\s+desktop|desktop\s+browser/i.test(text)
      ) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  };

  hideDesktopOnlyBanners();
  const observer = new MutationObserver(() => hideDesktopOnlyBanners());
  observer.observe(document.body, { childList: true, subtree: true });

  const activeKeys = new Set<string>();
  let weaponSlot = 1;

  function setKey(code: string, key: string, pressed: boolean): void {
    if (pressed && !activeKeys.has(code)) {
      activeKeys.add(code);
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    } else if (!pressed && activeKeys.has(code)) {
      activeKeys.delete(code);
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
    }
  }

  function sendMouseButton(button: number, pressed: boolean): void {
    const target = document.querySelector('canvas') || document;
    const type = pressed ? 'mousedown' : 'mouseup';
    target.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
  }

  // ساخت لایه اصلی دکمه‌های لمسی (HUD)
  const hud = document.createElement('div');
  hud.id = 'kr-touch-hud';
  hud.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;user-select:none;-webkit-user-select:none;touch-action:none;';
  document.body.appendChild(hud);

  // ناحیه چرخش دوربین (نیمه راست صفحه)
  const lookZone = document.createElement('div');
  lookZone.style.cssText = 'position:absolute;top:0;right:0;width:55%;height:100%;pointer-events:auto;';
  hud.appendChild(lookZone);

  let lookTouchId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  const SENSITIVITY = 1.6;

  lookZone.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      e.preventDefault();
      if (lookTouchId === null && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        lookTouchId = t.identifier;
        lastX = t.clientX;
        lastY = t.clientY;
        virtualPointerLocked = true;
      }
    },
    { passive: false }
  );

  lookZone.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          const movementX = (t.clientX - lastX) * SENSITIVITY;
          const movementY = (t.clientY - lastY) * SENSITIVITY;
          lastX = t.clientX;
          lastY = t.clientY;
          const canvas = document.querySelector('canvas') || document;
          const ev = new MouseEvent('mousemove', { movementX, movementY, bubbles: true });
          canvas.dispatchEvent(ev);
          document.dispatchEvent(ev);
        }
      }
    },
    { passive: false }
  );

  const stopLook = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  };
  lookZone.addEventListener('touchend', stopLook);
  lookZone.addEventListener('touchcancel', stopLook);

  // جوی‌استیک حرکت (پایین سمت چپ)
  const joyBase = document.createElement('div');
  joyBase.style.cssText =
    'position:absolute;left:36px;bottom:36px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,0.16);border:2px solid rgba(255,255,255,0.38);pointer-events:auto;';
  const joyKnob = document.createElement('div');
  joyKnob.style.cssText =
    'position:absolute;left:41px;top:41px;width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,0.68);pointer-events:none;';
  joyBase.appendChild(joyKnob);
  hud.appendChild(joyBase);

  let joyTouchId: number | null = null;
  const maxRadius = 52;

  function updateJoystick(clientX: number, clientY: number): void {
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);

    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    const deadzone = 14;
    setKey('KeyW', 'w', dy < -deadzone);
    setKey('KeyS', 's', dy > deadzone);
    setKey('KeyA', 'a', dx < -deadzone);
    setKey('KeyD', 'd', dx > deadzone);
    setKey('ShiftLeft', 'Shift', dist > maxRadius * 0.85 && dy < -deadzone);
  }

  function resetJoystick(): void {
    joyTouchId = null;
    joyKnob.style.transform = 'translate(0px, 0px)';
    setKey('KeyW', 'w', false);
    setKey('KeyS', 's', false);
    setKey('KeyA', 'a', false);
    setKey('KeyD', 'd', false);
    setKey('ShiftLeft', 'Shift', false);
  }

  joyBase.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      e.preventDefault();
      if (joyTouchId === null && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        joyTouchId = t.identifier;
        updateJoystick(t.clientX, t.clientY);
      }
    },
    { passive: false }
  );

  joyBase.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joyTouchId) {
          updateJoystick(t.clientX, t.clientY);
        }
      }
    },
    { passive: false }
  );

  joyBase.addEventListener('touchend', (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchId) resetJoystick();
    }
  });
  joyBase.addEventListener('touchcancel', resetJoystick);

  function createBtn(
    label: string,
    cssPos: string,
    size: number,
    onPress: () => void,
    onRelease?: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `position:absolute;${cssPos};width:${size}px;height:${size}px;border-radius:50%;background:rgba(20,20,20,0.58);color:#fff;font-weight:bold;font-size:15px;border:2px solid rgba(255,255,255,0.45);pointer-events:auto;touch-action:none;`;
    btn.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        btn.style.background = 'rgba(255,200,0,0.75)';
        onPress();
      },
      { passive: false }
    );
    const release = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      btn.style.background = 'rgba(20,20,20,0.58)';
      if (onRelease) onRelease();
    };
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    hud.appendChild(btn);
    return btn;
  }

  createBtn('FIRE', 'right:36px;bottom:48px', 86, () => sendMouseButton(0, true), () => sendMouseButton(0, false));

  let aiming = false;
  const aimBtn = createBtn('AIM', 'right:138px;bottom:125px', 64, () => {
    aiming = !aiming;
    sendMouseButton(2, aiming);
    aimBtn.style.borderColor = aiming ? '#ffcc00' : 'rgba(255,255,255,0.45)';
  });

  createBtn('JUMP', 'right:42px;bottom:152px', 66, () => setKey('Space', ' ', true), () => setKey('Space', ' ', false));
  createBtn('USE', 'right:138px;bottom:42px', 62, () => setKey('KeyE', 'e', true), () => setKey('KeyE', 'e', false));
  createBtn('RLD', 'right:215px;bottom:42px', 58, () => setKey('KeyR', 'r', true), () => setKey('KeyR', 'r', false));
  createBtn('CROUCH', 'right:215px;bottom:112px', 58, () => setKey('KeyC', 'c', true), () => setKey('KeyC', 'c', false));
  createBtn('BOMB', 'left:195px;bottom:42px', 58, () => setKey('KeyG', 'g', true), () => setKey('KeyG', 'g', false));

  createBtn('GUN', 'right:36px;top:85px', 60, () => {
    weaponSlot = (weaponSlot % 5) + 1;
    const code = `Digit${weaponSlot}`;
    const key = String(weaponSlot);
    setKey(code, key, true);
    setTimeout(() => setKey(code, key, false), 60);
  });
}

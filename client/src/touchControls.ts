const isTouchEnabled =
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0 ||
  new URLSearchParams(window.location.search).has('touch');

if (isTouchEnabled) {
  window.addEventListener('DOMContentLoaded', initTouchControls);
}

function initTouchControls(): void {
  const activeKeys = new Set<string>();
  let virtualPointerLocked = false;
  let weaponSlot = 1;

  // شبیه‌سازی Pointer Lock در مرورگر سافاری آیفون برای کار کردن چرخش دوربین
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

  // ساخت لایه اصلی HUD
  const hud = document.createElement('div');
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
    'position:absolute;left:28px;bottom:28px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.35);pointer-events:auto;';
  const joyKnob = document.createElement('div');
  joyKnob.style.cssText =
    'position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.65);pointer-events:none;';
  joyBase.appendChild(joyKnob);
  hud.appendChild(joyBase);

  let joyTouchId: number | null = null;
  const maxRadius = 45;

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

    const deadzone = 12;
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

  // تابع کمکی ساخت دکمه‌های لمسی
  function createBtn(
    label: string,
    cssPos: string,
    size: number,
    onPress: () => void,
    onRelease?: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `position:absolute;${cssPos};width:${size}px;height:${size}px;border-radius:50%;background:rgba(20,20,20,0.55);color:#fff;font-weight:bold;font-size:13px;border:2px solid rgba(255,255,255,0.4);pointer-events:auto;touch-action:none;`;
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
      btn.style.background = 'rgba(20,20,20,0.55)';
      if (onRelease) onRelease();
    };
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    hud.appendChild(btn);
    return btn;
  }

  // دکمه شلیک (FIRE)
  createBtn(
    'FIRE',
    'right:28px;bottom:45px',
    74,
    () => sendMouseButton(0, true),
    () => sendMouseButton(0, false)
  );

  // دکمه نشانه (AIM - تاگل)
  let aiming = false;
  const aimBtn = createBtn('AIM', 'right:115px;bottom:110px', 54, () => {
    aiming = !aiming;
    sendMouseButton(2, aiming);
    aimBtn.style.borderColor = aiming ? '#ffcc00' : 'rgba(255,255,255,0.4)';
  });

  // دکمه پرش و چتر نجات (JUMP)
  createBtn(
    'JUMP',
    'right:32px;bottom:135px',
    56,
    () => setKey('Space', ' ', true),
    () => setKey('Space', ' ', false)
  );

  // دکمه برداشتن آیتم و باز کردن صندوق (E)
  createBtn(
    'USE',
    'right:115px;bottom:35px',
    52,
    () => setKey('KeyE', 'e', true),
    () => setKey('KeyE', 'e', false)
  );

  // دکمه خشاب‌گذاری (R)
  createBtn(
    'RLD',
    'right:180px;bottom:35px',
    48,
    () => setKey('KeyR', 'r', true),
    () => setKey('KeyR', 'r', false)
  );

  // دکمه نشستن (C)
  createBtn(
    'CROUCH',
    'right:180px;bottom:95px',
    48,
    () => setKey('KeyC', 'c', true),
    () => setKey('KeyC', 'c', false)
  );

  // دکمه نارنجک (G)
  createBtn(
    'BOMB',
    'left:165px;bottom:35px',
    48,
    () => setKey('KeyG', 'g', true),
    () => setKey('KeyG', 'g', false)
  );

  // دکمه تعویض اسلحه (1 تا 5)
  createBtn('GUN', 'right:28px;top:70px', 50, () => {
    weaponSlot = (weaponSlot % 5) + 1;
    const code = `Digit${weaponSlot}`;
    const key = String(weaponSlot);
    setKey(code, key, true);
    setTimeout(() => setKey(code, key, false), 60);
  });
}
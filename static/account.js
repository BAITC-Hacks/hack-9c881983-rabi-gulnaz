/* Local account UI. Passwords and session tokens are never stored in browser storage. */
(() => {
  'use strict';
  const dialog = document.getElementById('account-dialog');
  const content = document.getElementById('account-content');
  const trigger = document.getElementById('account-button');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  let user = null, busy = false, mode = 'login', returnFocus = null, lastOverflow = '', sessionAvailable = true;
  let sessionVersion = 0;

  async function request(path, body) {
    const response = await fetch(path, {credentials:'same-origin', ...(body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)})});
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Не удалось выполнить запрос. Попробуйте ещё раз.');
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }
  function setUser(next) {
    const previousId = user?.id ?? null;
    user = next;
    document.getElementById('account-label').textContent = user ? user.name : 'Войти';
    trigger.querySelector('.account-avatar').textContent = user ? user.name.slice(0,1).toUpperCase() : '↗';
    trigger.classList.toggle('is-signed-in', Boolean(user));
    trigger.setAttribute('aria-label', user ? `Личный кабинет: ${user.name}` : 'Войти или зарегистрироваться');
    if ((user?.id ?? null) !== previousId) {
      window.dispatchEvent(new CustomEvent('toyga:account-change', {detail:{user}}));
      if (dialog.open && !busy) render();
    }
  }
  async function refreshSession() {
    const version = ++sessionVersion;
    try {
      const data = await request('/api/auth/session');
      if (version !== sessionVersion) return user;
      sessionAvailable = true;
      setUser(data.user);
      return user;
    } catch (error) {
      if (version !== sessionVersion) return user;
      sessionAvailable = false;
      if (error.status === 401) setUser(null);
      return user;
    }
  }
  function errorMessage(message) {
    const element = content.querySelector('#auth-error');
    if (element) { element.textContent = message; element.hidden = !message; }
  }
  function setBusy(value) {
    busy = value;
    content.querySelectorAll('button, input').forEach(element => { element.disabled = value; });
    const submit = content.querySelector('[type="submit"]');
    if (submit) submit.textContent = value ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : 'Войти';
    dialog.setAttribute('aria-busy', String(value));
  }
  function render() {
    if (user) {
      content.innerHTML = `<div class="account-welcome"><span class="account-big-avatar" aria-hidden="true">${escape(user.name.slice(0,1).toUpperCase())}</span><span class="step-label">ВАШ АККАУНТ</span><h2 id="account-title">Привет, ${escape(user.name)}!</h2><p>Все понравившиеся люди — в одном месте.</p></div><div class="account-details"><span>Имя<strong>${escape(user.name)}</strong></span><span>Email<strong>${escape(user.email)}</strong></span></div><p class="account-note">Избранное сохраняется в вашем аккаунте. История поиска хранится отдельно для него в этом браузере.</p><div id="auth-error" class="auth-error" role="alert" hidden></div><div class="account-actions"><button type="button" class="primary-button" id="account-saved">Открыть избранное <span>↗</span></button><button type="button" class="text-button" id="account-logout">Выйти из аккаунта</button></div>`;
      content.querySelector('#account-saved').addEventListener('click', () => {
        dialog.close();
        document.querySelector('[data-view="saved"]').click();
        document.getElementById('saved-view').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
      });
      content.querySelector('#account-logout').addEventListener('click', async () => {
        if (busy) return;
        setBusy(true); errorMessage('');
        try {
          await request('/api/auth/logout', {});
          sessionVersion++;
          setUser(null);
          dialog.close();
        } catch (error) { errorMessage(error.message); }
        finally { setBusy(false); }
      });
      return;
    }
    const registration = mode === 'register';
    content.innerHTML = `<div class="account-welcome"><span class="account-sticker" aria-hidden="true">✳</span><span class="step-label">ВАШИ ЛЮДИ. ВАШ АККАУНТ.</span><h2 id="account-title">${registration ? 'Давайте знакомиться.' : 'С возвращением!'}</h2><p>Сохраняйте подрядчиков в свой список<br>и возвращайтесь к выбору, когда удобно.</p></div><div class="auth-tabs" role="group" aria-label="Вход или регистрация"><button type="button" data-auth-mode="login" class="${!registration ? 'is-active' : ''}" aria-pressed="${!registration}">Вход</button><button type="button" data-auth-mode="register" class="${registration ? 'is-active' : ''}" aria-pressed="${registration}">Регистрация</button></div><form id="account-form">${registration ? '<label for="auth-name">Как вас зовут<input id="auth-name" name="name" type="text" autocomplete="name" placeholder="Ваше имя" minlength="2" maxlength="80" required></label>' : ''}<label for="auth-email">Email<input id="auth-email" name="email" type="email" inputmode="email" autocomplete="username" placeholder="you@example.com" maxlength="254" required></label><label for="auth-password">Пароль<span class="auth-password-wrap"><input id="auth-password" name="password" type="password" autocomplete="${registration ? 'new-password' : 'current-password'}" minlength="8" maxlength="128" placeholder="${registration ? 'Не меньше 8 символов' : 'Ваш пароль'}" required><button id="toggle-password" type="button" aria-label="Показать пароль" aria-pressed="false">Показать</button></span></label>${registration ? '<label for="auth-confirm">Повторите пароль<input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="Ещё раз, чтобы не ошибиться" required></label>' : ''}<div id="auth-error" class="auth-error" role="alert" ${sessionAvailable ? 'hidden' : ''}>${sessionAvailable ? '' : 'Сервис входа временно недоступен. Попробуйте ещё раз.'}</div><button type="submit" class="primary-button auth-submit">${registration ? 'Создать аккаунт' : 'Войти'}</button></form><button type="button" class="auth-guest" id="continue-guest">Продолжить подбор без входа →</button>`;
    content.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => {
      if (busy) return;
      mode = button.dataset.authMode;
      render();
      (content.querySelector('#auth-name') || content.querySelector('#auth-email')).focus();
    }));
    content.querySelector('#continue-guest').addEventListener('click', () => dialog.close());
    content.querySelector('#toggle-password').addEventListener('click', event => {
      const input = content.querySelector('#auth-password');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      event.currentTarget.textContent = visible ? 'Скрыть' : 'Показать';
      event.currentTarget.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
      event.currentTarget.setAttribute('aria-pressed', String(visible));
    });
    content.querySelector('#auth-confirm')?.addEventListener('input', event => event.target.setCustomValidity(''));
    content.querySelector('#auth-password').addEventListener('input', () => content.querySelector('#auth-confirm')?.setCustomValidity(''));
    content.querySelector('#account-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const form = event.currentTarget;
      const confirmation = content.querySelector('#auth-confirm');
      if (confirmation) confirmation.setCustomValidity(confirmation.value === content.querySelector('#auth-password').value ? '' : 'Пароли не совпадают');
      if (!form.reportValidity()) return;
      const fields = new FormData(form);
      const payload = {email:String(fields.get('email')).trim(), password:String(fields.get('password'))};
      if (registration) payload.name = String(fields.get('name')).trim();
      errorMessage(''); setBusy(true);
      try {
        const result = await request(`/api/auth/${registration ? 'register' : 'login'}`, payload);
        sessionVersion++;
        sessionAvailable = true;
        form.reset();
        setUser(result.user);
        dialog.close();
      } catch (error) { errorMessage(error.message); }
      finally { setBusy(false); }
    });
  }
  function open() {
    if (busy || dialog.open || document.querySelector('#info-dialog[open]')) return;
    mode = 'login'; render();
    returnFocus = document.activeElement;
    lastOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
  }
  trigger.addEventListener('click', open);
  document.getElementById('account-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = lastOverflow;
    content.querySelectorAll('input[type="password"], #auth-password').forEach(input => { input.value = ''; });
    (returnFocus?.isConnected ? returnFocus : trigger).focus({preventScroll:true});
  });
  const syncSession = () => {
    if (!busy && document.visibilityState === 'visible') refreshSession();
  };
  window.addEventListener('focus', syncSession);
  document.addEventListener('visibilitychange', syncSession);
  const ready = refreshSession();
  window.ToygaAccount = {get user() { return user; }, ready, open, refreshSession, request};
})();

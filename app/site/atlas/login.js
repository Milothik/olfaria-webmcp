(function () {
  'use strict';
  const form = document.querySelector('#login-form');
  const status = document.querySelector('#login-status');
  const button = form.querySelector('button');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    button.disabled = true;
    button.textContent = 'Comprobando…';
    try {
      const response = await fetch('./api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.elements.username.value,
          password: form.elements.password.value,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail?.message || 'Usuario o contraseña incorrectos.');
      window.location.replace(payload.redirect || './');
    } catch (error) {
      status.textContent = error.message || 'No se pudo iniciar sesión.';
      form.elements.password.select();
    } finally {
      button.disabled = false;
      button.textContent = 'Iniciar sesión';
    }
  });
})();

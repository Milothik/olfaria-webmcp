(function () {
  'use strict';

  async function bootSessionUi() {
    const response = await fetch('./api/auth/me', { cache: 'no-store' });
    if (response.status === 401) {
      window.location.replace('./login');
      return;
    }
    const { user } = await response.json();
    const account = document.createElement('div');
    account.className = 'account-control';
    account.innerHTML = `<span></span><button type="button">Salir</button>`;
    account.querySelector('span').textContent = `${user.username} · ${user.role}`;
    account.querySelector('button').addEventListener('click', async () => {
      await fetch('./api/auth/logout', { method: 'POST' });
      window.location.replace('./login');
    });
    const identity = document.querySelector('.atlas-identity');
    (identity || document.body).append(account);
  }

  bootSessionUi().catch(() => {});
})();

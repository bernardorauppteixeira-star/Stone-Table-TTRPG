(() => {
  const form = document.querySelector('#authForm');
  const usernameInput = document.querySelector('#authUsernameInput');
  const passwordInput = document.querySelector('#authPasswordInput');
  const title = document.querySelector('#authTitle');
  const submitButton = document.querySelector('#authSubmit');
  const modeButton = document.querySelector('#authModeButton');
  const switchText = document.querySelector('#authSwitchText');
  const message = document.querySelector('#authMessage');
  let registering = false;
  let applicationPromise = null;

  function setMode(isRegistering) {
    registering = isRegistering;
    title.textContent = registering ? 'Crie sua conta' : 'Entre na sua conta';
    submitButton.textContent = registering ? 'Criar conta' : 'Entrar';
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordInput.minLength = registering ? 8 : 1;
    switchText.textContent = registering ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
    modeButton.textContent = registering ? 'Entrar' : 'Criar conta';
    message.textContent = registering ? 'Use de 3 a 24 letras, números ou sublinhados no nome.' : '';
  }

  async function request(path, body) {
    let response;
    try {
      response = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Não foi possível conectar ao servidor. Verifique se node server.js está em execução e tente novamente.');
      }
      throw error;
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a solicitação.');
    return result;
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = () => reject(new Error(`Não foi possível carregar ${href}.`));
      document.head.append(link);
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Não foi possível carregar ${src}.`));
      document.head.append(script);
    });
  }

  async function loadApplication() {
    if (applicationPromise) return applicationPromise;
    applicationPromise = (async () => {
      for (const stylesheet of ['characters.css', 'audio.css', 'dice.css', 'neon-theme.css']) {
        await loadStylesheet(stylesheet);
      }
      try {
        await loadScript('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js');
      } catch (error) {
        console.error('Não foi possível carregar a conexão multiplayer:', error);
      }
      for (const script of ['characters.js', 'audio.js', 'app.js', 'polyhedral-dice.js', 'dice.js']) {
        await loadScript(script);
      }
    })();
    try {
      await applicationPromise;
    } catch (error) {
      applicationPromise = null;
      throw error;
    }
  }

  async function authenticate(user) {
    window.StoneTableAuth = { username: user.username };
    document.querySelector('#authUsername').textContent = user.username;
    try {
      await loadApplication();
      document.body.classList.add('authenticated');
    } catch (error) {
      console.error('Não foi possível iniciar a mesa:', error);
      message.textContent = 'Não foi possível carregar a mesa. Verifique a conexão e tente entrar novamente.';
    }
  }

  modeButton.addEventListener('click', () => setMode(!registering));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    message.textContent = '';
    try {
      const user = await request(registering ? '/api/register' : '/api/login', {
        username: usernameInput.value,
        password: passwordInput.value
      });
      passwordInput.value = '';
      await authenticate(user);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelector('#logoutButton').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      window.StonePlate?.saveActiveProjectiles?.();
      await request('/api/logout', {});
      window.location.reload();
    } catch (error) {
      message.textContent = error.message;
      event.currentTarget.disabled = false;
    }
  });

  request('/api/me')
    .then(user => {
      if (user.authenticated) authenticate(user);
    })
    .catch(error => { message.textContent = error.message; });
})();

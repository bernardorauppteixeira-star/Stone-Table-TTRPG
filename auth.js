(() => {
  const form = document.querySelector('#authForm');
  const usernameInput = document.querySelector('#authUsernameInput');
  const usernameField = document.querySelector('#authUsernameField');
  const emailInput = document.querySelector('#authEmailInput');
  const passwordInput = document.querySelector('#authPasswordInput');
  const credentials = document.querySelector('#authCredentials');
  const verification = document.querySelector('#authVerification');
  const verificationCode = document.querySelector('#authVerificationCode');
  const verificationCancel = document.querySelector('#authVerificationCancel');
  const extras = document.querySelector('#authExtras');
  const rememberInput = document.querySelector('#rememberUser');
  const googleButton = document.querySelector('#googleAuthButton');
  const discordButton = document.querySelector('#discordAuthButton');
  const title = document.querySelector('#authTitle');
  const description = document.querySelector('.auth-description');
  const submitButton = document.querySelector('#authSubmit');
  const modeButton = document.querySelector('#authModeButton');
  const switchText = document.querySelector('#authSwitchText');
  const message = document.querySelector('#authMessage');
  let registering = false;
  let applicationPromise = null;
  let verificationChallenge = null;

  function isLocalPreview() {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
  }

  const apiBase = isLocalPreview() && window.location.port !== '3000'
    ? `http://${window.location.hostname}:3000`
    : '';

  function setMode(isRegistering) {
    registering = isRegistering;
    usernameField.hidden = !registering;
    usernameInput.required = registering;
    title.textContent = registering ? 'Crie sua conta' : 'Entre na sua conta';
    description.textContent = registering ? 'Crie sua conta para entrar na mesa.' : 'Acesse sua mesa de jogo.';
    submitButton.textContent = registering ? 'Criar conta' : 'Entrar';
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordInput.minLength = registering ? 8 : 1;
    switchText.textContent = registering ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
    modeButton.textContent = registering ? 'Entrar' : 'Criar conta';
    message.textContent = registering ? 'Use de 3 a 24 letras, números ou sublinhados no nome e informe um e-mail válido.' : '';
  }

  function showVerification(result) {
    verificationChallenge = result.challengeId;
    credentials.hidden = true;
    verification.hidden = false;
    extras.hidden = true;
    verificationCode.required = true;
    modeButton.disabled = true;
    title.textContent = 'Confirme seu e-mail';
    description.textContent = `Enviamos um código para ${result.email}. Ele expira em 10 minutos.`;
    submitButton.textContent = 'Confirmar e-mail';
    message.textContent = '';
    verificationCode.focus();
  }

  function cancelVerification() {
    verificationChallenge = null;
    verification.hidden = true;
    extras.hidden = false;
    verificationCode.required = false;
    verificationCode.value = '';
    credentials.hidden = false;
    modeButton.disabled = false;
    setMode(registering);
  }

  async function request(path, body) {
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Não foi possível conectar ao servidor. Verifique se node server.js está em execução e tente novamente.');
      }
      throw error;
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      const error = new Error('A API de autenticação não está disponível.');
      error.code = 'API_UNAVAILABLE';
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
  verificationCancel.addEventListener('click', cancelVerification);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    message.textContent = '';
    try {
      if (verificationChallenge) {
        const user = await request('/api/verify-email', {
          challengeId: verificationChallenge,
          code: verificationCode.value,
          remember: rememberInput.checked
        });
        verificationChallenge = null;
        verificationCode.required = false;
        await authenticate(user);
        return;
      }

      const user = await request(registering ? '/api/register' : '/api/login', {
        username: registering ? usernameInput.value : undefined,
        email: emailInput.value,
        password: passwordInput.value,
        remember: rememberInput.checked
      });
      passwordInput.value = '';
      if (user.verificationRequired) {
        showVerification(user);
        return;
      }
      await authenticate(user);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  function startOAuth(provider) {
    const returnTo = new URL(window.location.href);
    returnTo.search = '';
    returnTo.hash = '';
    window.location.assign(`${apiBase}/auth/${provider}?remember=${rememberInput.checked ? '1' : '0'}&returnTo=${encodeURIComponent(returnTo.href)}`);
  }

  googleButton.addEventListener('click', () => startOAuth('google'));
  discordButton.addEventListener('click', () => startOAuth('discord'));

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

  request('/api/auth/providers')
    .then(providers => {
      googleButton.disabled = !providers.google;
      discordButton.disabled = !providers.discord;
      if (!providers.google) googleButton.title = 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.';
      if (!providers.discord) discordButton.title = 'Configure DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no servidor.';
    })
    .catch(() => {
      googleButton.title = 'Não foi possível consultar a configuração de login social.';
      discordButton.title = 'Não foi possível consultar a configuração de login social.';
    });

  const oauthError = new URLSearchParams(window.location.search).get('oauthError');
  const oauthSuccess = new URLSearchParams(window.location.search).get('oauth') === 'success';
  if (oauthError) {
    const errors = {
      configuration: 'O login social ainda não está configurado neste servidor.',
      denied: 'A autorização no provedor foi cancelada.',
      invalid: 'Não foi possível confirmar a conta social. Tente novamente.',
      email: 'O provedor não confirmou um e-mail verificado para esta conta.',
      account: 'Não foi possível vincular essa conta social a um usuário.'
    };
    message.textContent = errors[oauthError] || errors.invalid;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('oauthError');
    window.history.replaceState({}, '', cleanUrl);
  } else if (oauthSuccess) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('oauth');
    window.history.replaceState({}, '', cleanUrl);
  }
})();

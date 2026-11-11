(() => {
  const form = document.querySelector('#authForm');
  const usernameInput = document.querySelector('#authUsernameInput');
  const usernameField = document.querySelector('#authUsernameField');
  const identifierInput = document.querySelector('#authIdentifierInput');
  const identifierField = document.querySelector('#authIdentifierField');
  const emailInput = document.querySelector('#authEmailInput');
  const emailField = document.querySelector('#authEmailField');
  const passwordInput = document.querySelector('#authPasswordInput');
  const passwordConfirmationInput = document.querySelector('#authPasswordConfirmationInput');
  const credentials = document.querySelector('#authCredentials');
  const verification = document.querySelector('#authVerification');
  const verificationCode = document.querySelector('#authVerificationCode');
  const verificationCancel = document.querySelector('#authVerificationCancel');
  const title = document.querySelector('#authTitle');
  const description = document.querySelector('.auth-description');
  const submitButton = document.querySelector('#authSubmit');
  const googleButton = document.querySelector('#googleAuthButton');
  const modeButton = document.querySelector('#authModeButton');
  const switchText = document.querySelector('#authSwitchText');
  const message = document.querySelector('#authMessage');
  let registering = false;
  let applicationPromise = null;
  let verificationChallenge = null;
  const tutorialStorageKey = 'stone-table-tutorial-disabled-v1';
  const tutorialSteps = [
    { selector: '#mapViewButton', title: 'Mapa', description: 'Aqui fica o tabuleiro da mesa, onde você organiza o cenário e acompanha a partida.' },
    { selector: '#charactersViewButton', title: 'Configurações', description: 'Acesse as fichas de personagens e as configurações de áudio da mesa.' },
    { selector: '#adminViewButton', title: 'Admin', description: 'Acesse a biblioteca administrativa para salvar e reutilizar mapas, tokens, projéteis e decorações.' },
    { selector: '#playerDisplayButton', title: 'Tela dos jogadores', description: 'Abra a visualização compartilhada para exibir o mapa aos jogadores em outra tela.' },
    { selector: '#createRoomButton', title: 'Criar sala', description: 'Crie uma sala para convidar outras pessoas e jogar em conjunto.' },
    { selector: '[data-tool="select"]', title: 'Selecionar e mover', description: 'Use esta ferramenta para selecionar objetos no mapa e movê-los. Atalho: V.' },
    { selector: '[data-tool="token"]', title: 'Adicionar token', description: 'Escolha esta ferramenta e clique no mapa para posicionar um personagem. Atalho: T.' },
    { selector: '[data-tool="pin"]', title: 'Pin', description: 'Marque um ponto de interesse no mapa com um pin.' },
    { selector: '[data-tool="tile"]', title: 'Pintar terreno', description: 'Pinte o mapa com terrenos como pedra, grama, água ou lava. Atalho: B.' },
    { selector: '[data-tool="locate"]', title: 'Localizar', description: 'Clique em um token para centralizar o mapa e destacar sua posição. Atalho: P.' },
    { selector: '[data-tool="projectile"]', title: 'Projéteis', description: 'Configure e dispare projéteis durante a partida. Atalho: J.' },
    { selector: '[data-tool="line"]', title: 'Traço', description: 'Desenhe livremente no mapa para marcar caminhos ou áreas. Atalho: L.' },
    { selector: '[data-tool="straight-line"]', title: 'Linha reta', description: 'Clique em dois pontos do mapa para desenhar uma linha reta. Atalho: R.' },
    { selector: '[data-tool="circle"]', title: 'Círculo', description: 'Desenhe uma marcação circular no mapa. Atalho: C; use H para alternar entre preenchimento e contorno.' },
    { selector: '[data-tool="square"]', title: 'Quadrado', description: 'Desenhe uma marcação quadrada no mapa. Atalho: Q; use H para alternar entre preenchimento e contorno.' },
    { selector: '#clearButton', title: 'Limpar', description: 'Remova as marcações e os objetos do mapa atual.' },
    { selector: '#importButton', title: 'Importar', description: 'Carregue um mapa salvo anteriormente a partir de um arquivo JSON.' },
    { selector: '#exportButton', title: 'Exportar', description: 'Baixe o mapa atual em um arquivo para guardar ou compartilhar.' },
    { selector: '#addLayerButton', title: 'Criar camada', description: 'Adicione uma camada ao mapa para organizar elementos em diferentes níveis.' },
    { selector: '#diceToggle', title: 'Rolagem de dados', description: 'Abra a rolagem para escolher dados, montar expressões e rolar durante a partida.' },
    { selector: '#diceCalcToggle', title: 'Calculadora de estatísticas', description: 'Abra a calculadora para comparar atributos e simular testes ou golpes.' },
    { selector: '#shareButton', title: 'Compartilhar sala', description: 'Copie o código da sala para compartilhar com quem vai jogar.' }
  ];
  let tutorialStarted = false;
  let tutorialStepIndex = 0;
  let tutorialReturnView = null;
  const tutorialOverlay = document.querySelector('#tutorialOverlay');
  const tutorialSpotlight = document.querySelector('#tutorialSpotlight');
  const tutorialCard = document.querySelector('#tutorialCard');
  const tutorialStepLabel = document.querySelector('#tutorialStep');
  const tutorialTitle = document.querySelector('#tutorialTitle');
  const tutorialDescription = document.querySelector('#tutorialDescription');
  const tutorialError = document.querySelector('#tutorialError');
  const tutorialPrevious = document.querySelector('#tutorialPrevious');
  const tutorialNext = document.querySelector('#tutorialNext');
  const tutorialSkip = document.querySelector('#tutorialSkip');
  const tutorialDisable = document.querySelector('#tutorialDisable');
  const tutorialOpenButton = document.querySelector('#tutorialOpenButton');

  function isLocalPreview() {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
  }

  const apiBase = isLocalPreview() && window.location.port !== '3000'
    ? `http://${window.location.hostname}:3000`
    : '';

  function setMode(isRegistering) {
    registering = isRegistering;
    googleButton.hidden = registering;
    usernameField.hidden = !registering;
    usernameInput.required = registering;
    identifierField.hidden = registering;
    identifierInput.required = !registering;
    emailField.hidden = !registering;
    emailInput.required = registering;
    title.textContent = registering ? 'Crie sua conta' : 'Entre na sua conta';
    description.textContent = registering
      ? 'Informe seu nome de exibição, e-mail e senha.'
      : 'Acesse com seu e-mail ou nome de exibição.';
    submitButton.textContent = registering ? 'Criar conta' : 'Entrar';
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordConfirmationInput.autocomplete = passwordInput.autocomplete;
    passwordInput.minLength = registering ? 8 : 1;
    passwordConfirmationInput.minLength = registering ? 8 : 1;
    switchText.textContent = registering ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
    modeButton.textContent = registering ? 'Entrar' : 'Criar conta';
    message.textContent = registering ? 'Seu nome de exibição deve ter de 3 a 24 caracteres.' : '';
  }

  function showVerification(result) {
    verificationChallenge = result.challengeId;
    credentials.hidden = true;
    usernameInput.required = false;
    identifierInput.required = false;
    emailInput.required = false;
    passwordInput.required = false;
    passwordConfirmationInput.required = false;
    verification.hidden = false;
    googleButton.hidden = true;
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
    verificationCode.required = false;
    verificationCode.value = '';
    credentials.hidden = false;
    modeButton.disabled = false;
    setMode(registering);
  }

  setMode(false);

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

  function positionTutorial() {
    if (tutorialOverlay.hidden) return;
    const target = document.querySelector(tutorialSteps[tutorialStepIndex].selector);
    if (!target || !target.getClientRects().length) {
      finishTutorial();
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 7;
    const left = Math.max(0, rect.left - padding);
    const top = Math.max(0, rect.top - padding);
    const right = Math.min(window.innerWidth, rect.right + padding);
    const bottom = Math.min(window.innerHeight, rect.bottom + padding);
    const shadeTop = tutorialOverlay.querySelector('.tutorial-shade-top');
    const shadeRight = tutorialOverlay.querySelector('.tutorial-shade-right');
    const shadeBottom = tutorialOverlay.querySelector('.tutorial-shade-bottom');
    const shadeLeft = tutorialOverlay.querySelector('.tutorial-shade-left');

    Object.assign(shadeTop.style, { top: '0', left: '0', right: '0', height: `${top}px` });
    Object.assign(shadeRight.style, { top: `${top}px`, left: `${right}px`, right: '0', height: `${bottom - top}px` });
    Object.assign(shadeBottom.style, { top: `${bottom}px`, left: '0', right: '0', bottom: '0' });
    Object.assign(shadeLeft.style, { top: `${top}px`, left: '0', width: `${left}px`, height: `${bottom - top}px` });
    Object.assign(tutorialSpotlight.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`
    });

    const cardRect = tutorialCard.getBoundingClientRect();
    const gap = 14;
    let cardLeft = right + gap;
    if (cardLeft + cardRect.width > window.innerWidth - 12) {
      cardLeft = left - cardRect.width - gap;
    }
    cardLeft = Math.max(12, Math.min(cardLeft, window.innerWidth - cardRect.width - 12));
    const cardTop = Math.max(12, Math.min(top, window.innerHeight - cardRect.height - 96));
    tutorialCard.style.left = `${cardLeft}px`;
    tutorialCard.style.top = `${cardTop}px`;
  }

  function showTutorialStep() {
    while (tutorialStepIndex < tutorialSteps.length) {
      const target = document.querySelector(tutorialSteps[tutorialStepIndex].selector);
      if (target && target.getClientRects().length) break;
      tutorialStepIndex += 1;
    }
    if (tutorialStepIndex === tutorialSteps.length) {
      finishTutorial();
      return;
    }

    const step = tutorialSteps[tutorialStepIndex];
    tutorialStepLabel.textContent = `DICA ${tutorialStepIndex + 1} DE ${tutorialSteps.length}`;
    tutorialTitle.textContent = step.title;
    tutorialDescription.textContent = step.description;
    tutorialError.textContent = '';
    tutorialPrevious.hidden = tutorialStepIndex === 0;
    tutorialNext.textContent = tutorialStepIndex === tutorialSteps.length - 1 ? 'Concluir' : 'Próximo';
    positionTutorial();
  }

  function finishTutorial() {
    tutorialOverlay.hidden = true;
    window.removeEventListener('resize', positionTutorial);
    window.removeEventListener('scroll', positionTutorial, true);
    if (tutorialReturnView) {
      const returnButton = document.querySelector(tutorialReturnView === 'characters' ? '#charactersViewButton' : '#adminViewButton');
      tutorialReturnView = null;
      returnButton.click();
    }
  }

  function startTutorial(force = false) {
    if (tutorialStarted && !force) return;
    tutorialStarted = true;
    try {
      tutorialDisable.checked = window.localStorage.getItem(tutorialStorageKey) === 'true';
      if (!force && tutorialDisable.checked) return;
    } catch (error) {
      console.error('Não foi possível consultar a preferência do tutorial:', error);
    }
    if (force) {
      if (!document.querySelector('#healthWorkspace').hidden) tutorialReturnView = 'characters';
      else if (!document.querySelector('#adminWorkspace').hidden) tutorialReturnView = 'admin';
      else tutorialReturnView = null;
    }
    if (force && document.querySelector('#mapViewButton').getAttribute('aria-pressed') !== 'true') {
      document.querySelector('#mapViewButton').click();
    }
    tutorialOverlay.hidden = false;
    tutorialStepIndex = 0;
    showTutorialStep();
    window.addEventListener('resize', positionTutorial);
    window.addEventListener('scroll', positionTutorial, true);
    tutorialNext.focus();
  }

  tutorialPrevious.addEventListener('click', () => {
    if (tutorialStepIndex === 0) return;
    tutorialStepIndex -= 1;
    showTutorialStep();
  });

  tutorialNext.addEventListener('click', () => {
    if (tutorialStepIndex === tutorialSteps.length - 1) {
      finishTutorial();
      return;
    }
    tutorialStepIndex += 1;
    showTutorialStep();
  });

  tutorialSkip.addEventListener('click', finishTutorial);

  tutorialDisable.addEventListener('change', () => {
    try {
      window.localStorage.setItem(tutorialStorageKey, String(tutorialDisable.checked));
    } catch (error) {
      console.error('Não foi possível salvar a preferência do tutorial:', error);
      tutorialDisable.checked = !tutorialDisable.checked;
      tutorialError.textContent = 'Não foi possível salvar sua preferência neste navegador. Você ainda pode pular o tutorial.';
    }
  });

  tutorialOpenButton.addEventListener('click', () => startTutorial(true));
  document.querySelector('#tutorialSettingsButton').addEventListener('click', () => startTutorial(true));

  tutorialOverlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') finishTutorial();
  });

  async function authenticate(user) {
    window.StoneTableAuth = { username: user.username };
    document.querySelector('#authUsername').textContent = user.username;
    try {
      await loadApplication();
      document.body.classList.add('authenticated');
      window.dispatchEvent(new Event('resize'));
      window.requestAnimationFrame(() => startTutorial());
    } catch (error) {
      console.error('Não foi possível iniciar a mesa:', error);
      message.textContent = 'Não foi possível carregar a mesa. Verifique a conexão e tente entrar novamente.';
    }
  }

  modeButton.addEventListener('click', () => setMode(!registering));
  verificationCancel.addEventListener('click', cancelVerification);

  googleButton.addEventListener('click', () => {
    const returnTo = new URL(window.location.href);
    returnTo.search = '';
    returnTo.hash = '';
    window.location.assign(`${apiBase}/auth/google?returnTo=${encodeURIComponent(returnTo.href)}`);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    message.textContent = '';
    try {
      if (verificationChallenge) {
        const user = await request('/api/verify-email', {
          challengeId: verificationChallenge,
          code: verificationCode.value
        });
        verificationChallenge = null;
        verificationCode.required = false;
        await authenticate(user);
        return;
      }

      if (passwordInput.value !== passwordConfirmationInput.value) {
        throw new Error('As senhas informadas não coincidem.');
      }

      const user = await request(registering ? '/api/register' : '/api/login', {
        username: registering ? usernameInput.value : undefined,
        identifier: registering ? undefined : identifierInput.value,
        email: registering ? emailInput.value : undefined,
        password: passwordInput.value,
        passwordConfirmation: passwordConfirmationInput.value
      });
      passwordInput.value = '';
      passwordConfirmationInput.value = '';
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
      if (!providers.google) googleButton.title = 'Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor.';
    })
    .catch(error => {
      googleButton.disabled = true;
      googleButton.title = 'Não foi possível consultar a configuração de login Google.';
      message.textContent = error.message;
    });

  const oauthError = new URLSearchParams(window.location.search).get('oauthError');
  const oauthSuccess = new URLSearchParams(window.location.search).get('oauth') === 'success';
  if (oauthError) {
    const errors = {
      configuration: 'O login Google ainda não está configurado neste servidor.',
      denied: 'A autorização no Google foi cancelada.',
      invalid: 'Não foi possível confirmar a conta Google. Tente novamente.',
      email: 'O Google não confirmou um e-mail verificado para esta conta.',
      account: 'Não foi possível vincular essa conta Google a um usuário.'
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

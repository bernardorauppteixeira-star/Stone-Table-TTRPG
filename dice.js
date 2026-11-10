(() => {
  const CHANNEL_NAME = 'stone-plate-state-v1';
  const DICE_STYLE_STORAGE_KEY = 'stone-plate-dice-style-v1';
  const DICE_STYLE_DEFAULTS = { background: '#222a24', die: '#a34a91', shadow: '#120d18' };
  const DICE_STYLE = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DICE_STYLE_STORAGE_KEY) || 'null');
      return Object.fromEntries(Object.entries(DICE_STYLE_DEFAULTS).map(([key, fallback]) => [
        key,
        typeof saved?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[key]) ? saved[key] : fallback
      ]));
    } catch {
      return { ...DICE_STYLE_DEFAULTS };
    }
  })();
  const SIDES = [2, 4, 6, 8, 10, 12, 20, 30, 60, 100];
  const CRITICAL_THRESHOLDS = {
    2: [2, 2, 2, 2, 2],
    4: [4, 4, 3, 3, 2],
    6: [6, 6, 5, 5, 4],
    8: [8, 8, 7, 7, 6],
    10: [10, 9, 8, 7, 6],
    12: [12, 11, 10, 9, 8],
    20: [20, 19, 18, 17, 16],
    30: [30, 29, 28, 27, 26],
    60: [60, 59, 58, 57, 56],
    100: [100, 99, 98, 97, 96]
  };
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  const seenRolls = new Set();
  let selectedSides = 20;
  let selectedCriticalRate = 1;
  let rollTimer = 0;
  let diceBoxPromise = null;
  let diceRollOverlay = null;
  let diceRollOverlayTimer = 0;
  let standardRollStage = null;
  let polyhedralRollStage = null;
  let coinRollStage = null;
  let rolling = false;
  const diceBoxSides = new Set([4, 6, 8, 10, 12, 20]);
  const customPolyhedralSides = new Set([30, 60, 100]);
  const calculatorStats = [
    { key: 'vitalidade', label: 'Vitalidade' },
    { key: 'agilidade', label: 'Agilidade' },
    { key: 'forcaFisica', label: 'Força Física' },
    { key: 'forcaEspecial', label: 'Força Especial' },
    { key: 'resistenciaFisica', label: 'Resistência Física' },
    { key: 'resistenciaEspecial', label: 'Resistência Especial' },
    { key: 'resistenciaPerfeita', label: 'Resistência Perfeita' },
    { key: 'lucidez', label: 'Lucidez' },
    { key: 'intuicao', label: 'Intuição' },
    { key: 'persuasao', label: 'Persuasão' }
  ];
  const calculatorStatMax = key => ['vitalidade', 'lucidez', 'agilidade'].includes(key) ? 9999999 : 9999;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="dice-widget">
      <div class="dice-action-row">
        <button class="dice-toggle" id="diceToggle" type="button" aria-label="Abrir rolagem de dados" aria-expanded="false" aria-controls="dicePanel" title="Rolar dados">
          <img src="dice.png" alt="" aria-hidden="true">
        </button>
        <button class="dice-calc-toggle" id="diceCalcToggle" type="button" aria-label="Abrir calculadora" aria-expanded="false" aria-controls="diceCalculatorPanel" title="Abrir calculadora"><img src="calc.png" alt="" aria-hidden="true"></button>
      </div>
      <section class="dice-panel" id="dicePanel" aria-labelledby="diceHeading" hidden>
        <header class="dice-panel-header">
          <div><h2 id="diceHeading">Rolagem de dados</h2><span>TESTES DA MESA</span></div>
          <button class="dice-close" id="diceClose" type="button" aria-label="Fechar rolagem de dados" title="Fechar">×</button>
        </header>
        <label class="dice-label">TIPO DE DADO</label>
        <div class="dice-type-grid" role="group" aria-label="Selecionar tipo de dado; Shift para combinar tipos">
          ${SIDES.map(sides => `<button class="dice-type-button" type="button" data-die-sides="${sides}" aria-pressed="${sides === selectedSides}" aria-label="Selecionar ${sides === 2 ? 'moeda' : `d${sides}`}; Shift+clique para combinar" title="Selecionar; Shift+clique para combinar">${sides === 2 ? 'Moeda' : `d${sides}`}</button>`).join('')}
        </div>
        <label class="dice-label dice-critical-label">TAXA DE CRÍTICO</label>
        <div class="dice-critical-grid" role="group" aria-label="Selecionar taxa de crítico">
          ${[1, 2, 3, 4, 5].map(rate => `<button class="dice-critical-button" type="button" data-critical-rate="${rate}" aria-pressed="${rate === selectedCriticalRate}" aria-label="Taxa de crítico ${rate}">${rate}</button>`).join('')}
        </div>
        <p class="dice-critical-range" id="diceCriticalRange" aria-live="polite"></p>
        <label class="dice-label" for="diceExpression">EXPRESSÃO DE ROLAGEM</label>
        <div class="dice-expression-row">
          <input class="dice-expression" id="diceExpression" type="text" inputmode="text" value="1d20" placeholder="2d6+1d20+4" autocomplete="off" aria-describedby="diceExpressionError">
          <span class="dice-expression-note">ex.: 1d20+4</span>
        </div>
        <p class="dice-expression-error" id="diceExpressionError" aria-live="polite"></p>
        <button class="dice-roll-button" id="diceRollButton" type="button">Rolar dados</button>
        <label class="dice-label" for="dicePresetExpression">RESULTADO EXTERNO PRÉ-DETERMINADO</label>
        <div class="dice-expression-row">
          <input class="dice-expression" id="dicePresetExpression" type="text" inputmode="text" placeholder="1d4(3)+2d8(12)" autocomplete="off" aria-describedby="dicePresetError">
          <button class="dice-roll-button" id="dicePresetRollButton" type="button">Rolar resultado</button>
        </div>
        <p class="dice-expression-error" id="dicePresetError" aria-live="polite">Use grupos como 1d4(3)+2d8(12); o número entre parênteses é a soma daquele grupo.</p>
        <details class="dice-appearance">
          <summary>Aparência 3D</summary>
          <div class="dice-appearance-fields">
            <label><span>Fundo</span><input type="color" value="${DICE_STYLE.background}" data-dice-style="background"></label>
            <label><span>Dados</span><input type="color" value="${DICE_STYLE.die}" data-dice-style="die"></label>
            <label><span>Sombras</span><input type="color" value="${DICE_STYLE.shadow}" data-dice-style="shadow"></label>
          </div>
        </details>
        <div class="dice-results" id="diceResults" aria-live="polite" aria-atomic="true"></div>
      </section>
      <section class="dice-calculator" id="diceCalculatorPanel" aria-labelledby="diceCalculatorHeading" hidden>
        <header class="dice-panel-header">
          <div><h2 id="diceCalculatorHeading">Calculadora de estatísticas</h2><span>TESTES DA MESA</span></div>
          <button class="dice-close" id="diceCalculatorClose" type="button" aria-label="Fechar calculadora" title="Fechar">×</button>
        </header>
        <div class="dice-calc-grid">
          ${calculatorStats.map(stat => `
            <label class="dice-calc-field">
              <span>${stat.label}</span>
              <input type="number" min="0" max="${calculatorStatMax(stat.key)}" step="1" value="0" data-calc-stat="${stat.key}">
            </label>
          `).join('')}
        </div>
        <div class="dice-calc-actions">
          <button class="dice-secondary-button" id="diceUseTokenStats" type="button">Usar estatísticas do token</button>
          <button class="dice-roll-button" id="diceCalcButton" type="button">Calcular testes</button>
        </div>
        <div class="dice-calc-result" id="diceCalcResult" aria-live="polite"></div>
        <section class="dice-comparison" aria-labelledby="diceComparisonHeading">
          <header><h3 id="diceComparisonHeading">Comparar fichas e calcular golpe</h3><span>SIMULAÇÃO DE COMBATE</span></header>
          <div class="dice-comparison-fields">
            <label>Atacante<select id="diceCombatAttacker"></select></label>
            <label>Defensor<select id="diceCombatTarget"></select></label>
            <label>Golpe salvo<select id="diceCombatAttack"></select></label>
          </div>
          <button class="dice-roll-button" id="diceCombatButton" type="button">Rolar e calcular dano</button>
          <div class="dice-comparison-result" id="diceCombatResult" aria-live="polite"></div>
        </section>
      </section>
    </div>`);
  document.body.insertAdjacentHTML('beforeend', `
    <div class="instinct-roll-overlay" id="instinctRollOverlay" role="status" aria-live="assertive" hidden>
      <svg class="instinct-lightning" id="instinctLightning" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
        <path d="M-50 170 150 122 210 151 350 96 400 126 540 72 600 111 730 52 785 91 930 38 1050 68"/>
        <path d="M-50 170 150 122 210 151 350 96 400 126 540 72 600 111 730 52 785 91 930 38 1050 68"/>
      </svg>
      <div class="instinct-roll-content">
        <span class="instinct-roll-caption">TESTE DE INSTINTO · 1D100</span>
        <div class="instinct-roll-die" id="instinctRollDie"><div class="instinct-3d-stage" id="instinctDice3dStage" aria-hidden="true"></div><span class="instinct-roll-face" id="instinctRollFace">100</span></div>
        <strong class="instinct-roll-result" id="instinctRollResult"></strong>
        <div class="instinct-sparks" id="instinctSparks" aria-hidden="true"></div>
      </div>
    </div>`);

  const toggle = document.querySelector('#diceToggle');
  const calcToggle = document.querySelector('#diceCalcToggle');
  const panel = document.querySelector('#dicePanel');
  const calculatorPanel = document.querySelector('#diceCalculatorPanel');
  const expression = document.querySelector('#diceExpression');
  const error = document.querySelector('#diceExpressionError');
  const rollButton = document.querySelector('#diceRollButton');
  const presetExpression = document.querySelector('#dicePresetExpression');
  const presetError = document.querySelector('#dicePresetError');
  const presetRollButton = document.querySelector('#dicePresetRollButton');
  const results = document.querySelector('#diceResults');
  const criticalRange = document.querySelector('#diceCriticalRange');
  const calcResult = document.querySelector('#diceCalcResult');
  const combatAttackerSelect = document.querySelector('#diceCombatAttacker');
  const combatTargetSelect = document.querySelector('#diceCombatTarget');
  const combatAttackSelect = document.querySelector('#diceCombatAttack');
  const combatButton = document.querySelector('#diceCombatButton');
  const combatResultElement = document.querySelector('#diceCombatResult');
  const diceWidget = document.querySelector('.dice-widget');
  let combatAttackerId = '';
  let combatTargetId = '';
  let combatAttackId = '';
  let combatResult = null;
  let combatRolling = false;
  const instinctOverlay = document.querySelector('#instinctRollOverlay');
  const instinctDie = document.querySelector('#instinctRollDie');
  const instinctFace = document.querySelector('#instinctRollFace');
  const instinctResult = document.querySelector('#instinctRollResult');
  const instinctSparks = document.querySelector('#instinctSparks');
  const instinctLightning = document.querySelector('#instinctLightning');
  let instinctRollTimer = 0;
  let instinctAnimationTimer = 0;
  let instinctPolyhedralRendered = false;
  let instinctRollSequence = 0;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function renderCharacterComparison() {
    const characters = window.StonePlate?.getState?.()?.health?.characters;
    if (!Array.isArray(characters)) return;
    if (!characters.some(character => String(character.id) === combatAttackerId)) combatAttackerId = String(characters[0]?.id || '');
    const attacker = characters.find(character => String(character.id) === combatAttackerId);
    if (!characters.some(character => String(character.id) === combatTargetId) || combatTargetId === combatAttackerId) {
      combatTargetId = String(characters.find(character => String(character.id) !== combatAttackerId)?.id || '');
    }
    const attacks = Array.isArray(attacker?.attacks) ? attacker.attacks : [];
    if (!attacks.some(attack => String(attack.id) === combatAttackId)) combatAttackId = String(attacks[0]?.id || '');
    combatAttackerSelect.innerHTML = characters.map(character =>
      `<option value="${escapeHtml(character.id)}" ${String(character.id) === combatAttackerId ? 'selected' : ''}>${escapeHtml(character.name || 'Personagem')}</option>`
    ).join('');
    combatTargetSelect.innerHTML = characters.filter(character => String(character.id) !== combatAttackerId).map(character =>
      `<option value="${escapeHtml(character.id)}" ${String(character.id) === combatTargetId ? 'selected' : ''}>${escapeHtml(character.name || 'Personagem')}</option>`
    ).join('');
    combatAttackSelect.innerHTML = attacks.map(attack =>
      `<option value="${escapeHtml(attack.id)}" ${String(attack.id) === combatAttackId ? 'selected' : ''}>${escapeHtml(attack.name || 'Golpe')} · ${escapeHtml(attack.damageExpression || '1d6')}</option>`
    ).join('');
    const canCompare = characters.length > 1 && Boolean(attacker && attacks.length);
    combatAttackerSelect.disabled = characters.length === 0;
    combatTargetSelect.disabled = characters.length < 2;
    combatAttackSelect.disabled = attacks.length === 0;
    combatButton.disabled = !canCompare || combatRolling;
    if (combatResult) {
      combatResultElement.innerHTML = `<strong>${escapeHtml(combatResult.summary)}</strong><span>${escapeHtml(combatResult.details)}</span>${combatResult.damage > 0 && !combatResult.applied
        ? `<button class="dice-secondary-button" type="button" data-apply-combat-damage>Aplicar ${combatResult.damage.toFixed(1)} de dano</button>`
        : combatResult.dodged ? '<span>Esquiva automática: o dano foi evitado.</span>'
          : combatResult.applied ? '<span>Dano aplicado à ficha defensora.</span>' : ''}`;
    } else {
      combatResultElement.textContent = canCompare ? '' : characters.length < 2
        ? 'Cadastre pelo menos duas fichas para comparar personagens.'
        : 'Salve um golpe na ficha do atacante para calcular o combate.';
    }
  }

  async function calculateCharacterCombat() {
    if (combatRolling) return;
    const state = window.StonePlate?.getState?.();
    const characters = state?.health?.characters || [];
    const attacker = characters.find(character => String(character.id) === combatAttackerId);
    const target = characters.find(character => String(character.id) === combatTargetId);
    const attack = attacker?.attacks?.find(item => String(item.id) === combatAttackId);
    if (!attacker || !target || attacker.id === target.id || !attack) {
      combatResult = { summary: 'Selecione dois personagens diferentes e um golpe salvo.', details: '', damage: 0, applied: false };
      renderCharacterComparison();
      return;
    }
    if (attacker.lostActionType === 'attack' && Number(attacker.lostActions) > 0) {
      window.StonePlate?.updateHealth?.(health => {
        const character = health.characters.find(item => String(item.id) === String(attacker.id));
        if (!character) return;
        character.lostActions = Math.max(0, Number(character.lostActions) - 1);
        character.lostActionType = null;
        character.combatMessage = 'A ação de ataque foi perdida pela Reflexão.';
      });
      combatResult = { summary: 'Ação de ataque perdida pela Reflexão.', details: '', damage: 0, applied: false };
      renderCharacterComparison();
      return;
    }
    combatRolling = true;
    renderCharacterComparison();
    try {
      const rhythm = window.StonePlate?.prepareRhythmAttack?.(attacker, target, attack.id);
      const criticalPrevented = window.StonePlate?.cannotCriticalForToken?.(attacker.linkedTokenId, target.linkedTokenId) || false;
      const roll = await window.StonePlateDice?.rollExpression(attack.damageExpression || '1d6', {
        attackType: ['fisico', 'especial'].includes(attack.damageType) ? attack.damageType : attack.damageForceType,
        attackerTokenId: attacker.linkedTokenId || null,
        criticalRateBonus: (window.StonePlate?.criticalRateBonusForToken?.(attacker.linkedTokenId, target.linkedTokenId) ?? 0) -
          (Number(attacker.nextAttackDisadvantage) || 0) -
          ((attack.damageType === 'fisico' || (!['especial'].includes(attack.damageType) && attack.damageForceType !== 'especial')) ? Number(target.incomingPhysicalDisadvantage) || 0 : 0),
        preventCritical: criticalPrevented,
        guaranteedCritical: Boolean(rhythm?.guaranteedCritical),
        criticalBonusPercent: Number(attacker.criticalBonusPercent) || 10
      });
      if (!roll) {
        combatResult = { summary: 'O golpe não pôde ser rolado.', details: `Verifique a expressão "${attack.damageExpression}".`, damage: 0, applied: false };
        return;
      }
      const rolledDamage = roll.groups.reduce((sum, group) => sum + group.values.reduce((groupSum, value) => groupSum + value, 0), roll.modifier);
      const lucidityRoll = attack.damageType === 'mental' ? await window.StonePlateDice?.rollExpression('1d20') : null;
      const lucidityTestResult = lucidityRoll?.groups?.[0]?.values?.[0] ?? null;
      const damage = window.StonePlate.calculateCharacterDamage(target, {
        attacker,
        rolledDamage,
        damageType: attack.damageType,
        damageForceType: attack.damageForceType,
        criticalDamageBonusPercent: roll.isSurge
          ? (Number(attacker.criticalBonusPercent) || 10) * 3
          : roll.isCritical
            ? (Number(attacker.criticalBonusPercent) || 10) + (window.StonePlate?.criticalDamageBonusForToken?.(attacker.linkedTokenId, target.linkedTokenId) || 0)
          : 0,
        rhythmDamageBonusPercent: rhythm?.damageBonusPercent || 0,
        miniCriticalBonusPercent: rhythm?.miniCriticalBonusPercent || 0,
        isCritical: roll.isCritical,
        lucidityTestResult
      });
      const special = attack.damageType === 'especial' || (['bruto', 'verdadeiro', 'alma', 'mental'].includes(attack.damageType) && attack.damageForceType === 'especial');
      const offense = Number(attacker.forca ?? 0) + Number(special ? attacker.forcaEspecial ?? 0 : attacker.forcaFisica ?? 0);
      const defense = Number(target.defesa ?? 0);
      combatResult = {
        summary: `${attacker.name} usa ${attack.name} contra ${target.name}: ${damage.toFixed(1)} de dano.`,
        details: `Força ${offense} contra defesa ${defense} · ${({ fisico: 'físico', especial: 'especial', bruto: 'bruto', verdadeiro: 'verdadeiro', alma: 'de alma', mental: 'mental' })[attack.damageType] || 'físico'}${['bruto', 'verdadeiro', 'alma', 'mental'].includes(attack.damageType) ? ` · Força ${special ? 'Especial' : 'Física'}` : ''} · dados ${attack.damageExpression || '1d6'} = ${rolledDamage}${rhythm?.isRhythmHit ? ` · Ritmo +${rhythm.damageBonusPercent}%` : ''}${rhythm?.miniCritical ? ' · mini-crítico' : ''}${attack.damageType === 'mental' && lucidityTestResult !== null ? ` · teste de Lucidez ${lucidityTestResult}/20` : ''}${criticalPrevented ? ' · crítico bloqueado' : roll.isSurge ? ' · surto' : roll.isCritical ? ' · crítico' : rhythm?.guaranteedCritical ? ' · crítico garantido' : ''}.`,
        damage: Math.round(damage * 10) / 10,
        damageType: attack.damageType,
        damageForceType: attack.damageForceType,
        targetId: String(target.id),
        attackerId: String(attacker.id),
        rhythm,
        roll,
        applied: false
      };
    } catch (error) {
      console.error('Não foi possível calcular o golpe entre as fichas.', error);
      combatResult = { summary: 'Falha ao rolar ou calcular o golpe.', details: '', damage: 0, applied: false };
    } finally {
      combatRolling = false;
      renderCharacterComparison();
    }
  }

  function setCalculatorOpen(isOpen) {
    calculatorPanel.hidden = !isOpen;
    calcToggle.setAttribute('aria-expanded', String(isOpen));
    calcToggle.setAttribute('aria-label', isOpen ? 'Fechar calculadora' : 'Abrir calculadora');
    calcToggle.title = isOpen ? 'Fechar calculadora' : 'Abrir calculadora';
  }

  function setPanelOpen(isOpen) {
    panel.hidden = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Fechar rolagem de dados' : 'Abrir rolagem de dados');
    if (isOpen) expression.focus();
  }

  function applyDiceStyle() {
    diceWidget.style.setProperty('--dice-stage-background', DICE_STYLE.background);
    document.querySelectorAll('[data-dice-style]').forEach(input => {
      input.value = DICE_STYLE[input.dataset.diceStyle];
    });
    window.StonePlatePolyhedralDice?.setStyle(DICE_STYLE);
    diceBoxPromise?.then(box => box.updateConfig({ themeColor: DICE_STYLE.die })).catch(() => {});
  }

  function parseTerms(source, predetermined = false) {
    const terms = [...source.matchAll(predetermined
      ? /([+-]?)(?:(\d*)d(\d+)\((\d+)\)|(\d+))/g
      : /([+-]?)(?:(\d*)d(\d+)|(\d+))/g)];
    const validSyntax = source.length > 0 && terms.length > 0 && terms.map(term => term[0]).join('') === source;
    const groups = [];
    let modifier = 0;
    let quantity = 0;
    let valid = validSyntax;
    if (validSyntax) {
      for (const [index, term] of terms.entries()) {
        if (index > 0 && !term[1]) { valid = false; break; }
        const sign = term[1] === '-' ? -1 : 1;
        if (term[3] !== undefined) {
          const count = Number(term[2] || 1);
          const sides = Number(term[3]);
          const targetTotal = predetermined ? Number(term[4]) : null;
          quantity += count;
          if (sign < 0 || !SIDES.includes(sides) || !Number.isInteger(count) || count < 1 || count > (predetermined ? 100 : 999) ||
            predetermined && (!Number.isInteger(targetTotal) || targetTotal < count || targetTotal > count * sides)) {
            valid = false;
            break;
          }
          if (predetermined) {
            const values = [];
            let remaining = targetTotal;
            for (let dieIndex = 0; dieIndex < count; dieIndex++) {
              const remainingDice = count - dieIndex - 1;
              const minimum = Math.max(1, remaining - remainingDice * sides);
              const maximum = Math.min(sides, remaining - remainingDice);
              const value = minimum + randomFace(maximum - minimum + 1) - 1;
              values.push(value);
              remaining -= value;
            }
            const group = groups.find(item => item.sides === sides);
            if (group) group.values.push(...values);
            else groups.push({ sides, values });
          } else {
            const group = groups.find(item => item.sides === sides);
            if (group) group.quantity += count;
            else groups.push({ sides, quantity: count });
          }
        } else if (predetermined && term[5] !== undefined) modifier += sign * Number(term[5]);
        else if (!predetermined) modifier += sign * Number(term[4]);
        else { valid = false; break; }
      }
    }
    valid = valid && groups.length > 0 && groups.length <= 20 && quantity <= (predetermined ? 100 : 999) &&
      Number.isSafeInteger(modifier) && Math.abs(modifier) <= 100000;
    return valid ? { groups, modifier, quantity } : null;
  }

  function parsePresetExpression(source) {
    const compact = String(source || '').replace(/\s+/g, '').toLowerCase();
    const parsed = parseTerms(compact, true);
    if (!parsed) return null;
    const notation = compact.replace(/\(\d+\)/g, '');
    return { ...parsed, expression: notation, presetExpression: compact, isPredetermined: true };
  }

  function parseExpression() {
    const source = expression.value.replace(/\s+/g, '').toLowerCase();
    const parsed = parseTerms(source);
    const valid = Boolean(parsed);
    if (valid) selectedSides = parsed.groups[parsed.groups.length - 1].sides;
    document.querySelectorAll('[data-die-sides]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.dieSides) === selectedSides));
    });
    expression.setAttribute('aria-invalid', String(!valid));
    error.textContent = valid ? '' : 'Use dados válidos, como 2d6+1d20+4 (até 999 dados).';
    updateCriticalRange(valid ? parsed.groups : []);
    rollButton.disabled = !valid;
    return valid ? { ...parsed, expression: source } : null;
  }

  function criticalThreshold(sides, rate = selectedCriticalRate) {
    return CRITICAL_THRESHOLDS[sides][Math.max(1, Math.min(5, rate)) - 1];
  }

  function updateCriticalRange(groups, rate = selectedCriticalRate) {
    const ranges = [...new Set(groups.map(group => group.sides))].map(sides => {
      const threshold = criticalThreshold(sides, rate);
      return `d${sides} ${threshold}${threshold < sides ? `–${sides}` : ''}`;
    });
    criticalRange.textContent = ranges.length ? `Crítico ${rate}: ${ranges.join(' · ')}` : '';
  }

  function randomFace(sides) {
    const limit = Math.floor(0x100000000 / sides) * sides;
    const value = new Uint32Array(1);
    do { crypto.getRandomValues(value); } while (value[0] >= limit);
    return value[0] % sides + 1;
  }

  function renderInstinctRoll(roll) {
    if (!isValidRoll(roll) || !rememberRoll(roll.id) || roll.displayMode !== 'instinct') return;
    const value = roll.groups[0].values[0];
    const surge = value === 100;
    const sequence = ++instinctRollSequence;
    window.clearTimeout(instinctRollTimer);
    window.clearInterval(instinctAnimationTimer);
    instinctOverlay.hidden = false;
    instinctOverlay.classList.toggle('is-surge', surge);
    instinctOverlay.classList.toggle('is-polyhedral', instinctPolyhedralRendered);
    instinctOverlay.classList.remove('is-spark-burst', 'is-rolling');
    instinctDie.classList.remove('is-rolling', 'is-surge');
    instinctLightning.classList.remove('is-active');
    instinctSparks.replaceChildren();
    instinctFace.textContent = instinctPolyhedralRendered ? '' : '00';
    const surgeBonus = Math.max(0, Number(roll.criticalBonusPercent ?? 10)) * 3;
    instinctResult.textContent = 'O instinto se manifesta...';
    instinctOverlay.classList.add('is-rolling');
    instinctDie.classList.add('is-rolling');
    if (!instinctPolyhedralRendered) instinctAnimationTimer = window.setInterval(() => { instinctFace.textContent = String(randomFace(100)); }, 70);
    createInstinctSparks(8);
    instinctRollTimer = window.setTimeout(() => {
      if (sequence !== instinctRollSequence) return;
      window.clearInterval(instinctAnimationTimer);
      instinctAnimationTimer = 0;
      instinctOverlay.classList.remove('is-rolling');
      instinctDie.classList.remove('is-rolling');
      instinctFace.textContent = instinctPolyhedralRendered ? '' : String(value);
      if (surge) {
        instinctDie.classList.add('is-surge');
        instinctLightning.classList.add('is-active');
        instinctResult.textContent = '';
        instinctRollTimer = window.setTimeout(() => {
          if (sequence !== instinctRollSequence) return;
          instinctLightning.classList.remove('is-active');
          instinctResult.textContent = `SURTO DE INSTINTO · BÔNUS DE DANO +${surgeBonus}%`;
          instinctRollTimer = window.setTimeout(() => { instinctOverlay.hidden = true; }, 2100);
        }, 650);
        return;
      }
      instinctOverlay.classList.add('is-spark-burst');
      createInstinctSparks(18);
      instinctResult.textContent = 'Golpe padrão';
      instinctRollTimer = window.setTimeout(() => { instinctOverlay.hidden = true; }, 1900);
    }, 1900);
    return sequence;
  }

  function createInstinctSparks(count) {
    const sparks = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const spark = document.createElement('span');
      spark.className = 'instinct-spark';
      spark.style.setProperty('--spark-angle', `${Math.round(index * 360 / count + (Math.random() * 18 - 9))}deg`);
      spark.style.setProperty('--spark-distance', `${48 + Math.random() * 90}px`);
      spark.style.setProperty('--spark-delay', `${Math.random() * 180}ms`);
      sparks.append(spark);
    }
    instinctSparks.replaceChildren(sparks);
  }

  async function renderInstinctPolyhedral(roll, sequence) {
    try {
      await window.StonePlatePolyhedralDice.roll(instinctDice3dStage, [{
        sides: 100,
        value: roll.groups[0].values[0],
        critical: roll.groups[0].values[0] >= criticalThreshold(100, roll.criticalRate || 1)
      }]);
      if (sequence !== instinctRollSequence) return;
      instinctPolyhedralRendered = true;
      instinctOverlay.classList.add('is-polyhedral');
      instinctFace.textContent = '';
    } catch (error) {
      instinctPolyhedralRendered = false;
      console.warn('Exibição 3D do d100 indisponível; usando o d100 local.', error);
    }
  }

  function replayReceivedInstinctRoll(roll) {
    if (!isValidRoll(roll) || seenRolls.has(roll.id) || roll.displayMode !== 'instinct') return;
    instinctPolyhedralRendered = false;
    const sequence = renderInstinctRoll(roll);
    if (sequence) renderInstinctPolyhedral(roll, sequence);
  }

  function rollInstinctAttack(criticalBonusPercent = 10) {
    instinctPolyhedralRendered = false;
    const value = randomFace(100);
    const roll = {
      id: crypto.randomUUID(),
      expression: '1d100',
      modifier: 0,
      criticalRate: 1,
      groups: [{ sides: 100, values: [value] }],
      displayMode: 'instinct',
      criticalBonusPercent: Math.max(0, Number(criticalBonusPercent) || 0),
      timestamp: Date.now()
    };
    if (window.StonePlate?.broadcastDiceRoll) window.StonePlate.broadcastDiceRoll(roll);
    else channel?.postMessage({ type: 'dice-roll', roll });
    const sequence = renderInstinctRoll(roll);
    if (sequence) renderInstinctPolyhedral(roll, sequence);
    return roll;
  }

  async function getDiceBox() {
    if (!diceBoxPromise) {
      diceBoxPromise = (async () => {
        const { default: DiceBox } = await import('https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/dice-box.es.min.js');
        const box = new DiceBox({
          container: '#diceBoxStage',
          assetPath: 'assets/',
          origin: 'https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/',
          theme: 'default',
          themeColor: DICE_STYLE.die,
          offscreen: true,
          scale: 9,
          delay: 8
        });
        await box.init();
        return box;
      })().catch(error => {
        diceBoxPromise = null;
        throw error;
      });
    }
    return diceBoxPromise;
  }

  function createDiceRollOverlay(showStandard, showCustom, showCoins) {
    window.clearTimeout(diceRollOverlayTimer);
    diceRollOverlay?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'dice-roll-overlay';
    standardRollStage = null;
    polyhedralRollStage = null;
    coinRollStage = null;
    if (showStandard) {
      standardRollStage = document.createElement('div');
      standardRollStage.className = 'dice-box-stage';
      standardRollStage.id = 'diceBoxStage';
      standardRollStage.setAttribute('aria-label', 'Dados rolando na mesa');
      overlay.append(standardRollStage);
    }
    if (showCustom) {
      polyhedralRollStage = document.createElement('div');
      polyhedralRollStage.className = 'polyhedral-dice-canvas-stage';
      polyhedralRollStage.id = 'polyhedralDice3dStage';
      polyhedralRollStage.setAttribute('aria-label', 'Dados personalizados rolando na mesa');
      overlay.append(polyhedralRollStage);
    }
    if (showCoins) {
      coinRollStage = document.createElement('div');
      coinRollStage.className = 'coin-3d-canvas-stage';
      coinRollStage.setAttribute('aria-label', 'Moedas 3D rolando na mesa');
      overlay.append(coinRollStage);
    }
    document.body.append(overlay);
    diceRollOverlay = overlay;
  }

  function dismissDiceRollOverlay(delay = 650) {
    const overlay = diceRollOverlay;
    if (!overlay) return;
    window.clearTimeout(diceRollOverlayTimer);
    diceRollOverlayTimer = window.setTimeout(() => {
      overlay.classList.add('is-hiding');
      window.setTimeout(() => {
        if (diceRollOverlay !== overlay) return;
        overlay.remove();
        diceRollOverlay = null;
        standardRollStage = null;
        polyhedralRollStage = null;
        coinRollStage = null;
      }, 300);
    }, delay);
  }

  function showThreeDimensionalRoll(expressionText, showDiceBox, customGroups, coinGroups) {
    results.innerHTML = `<div class="dice-result-heading"><span class="dice-result-expression">${expressionText}</span><strong class="dice-result-total">Rolando…</strong></div>`;
    createDiceRollOverlay(showDiceBox, customGroups.length > 0, coinGroups.length > 0);
    panel.scrollTop = panel.scrollHeight;
  }

  function isValidRoll(roll) {
    const baseValid = Boolean(roll && typeof roll.id === 'string' && roll.id.length <= 80 &&
      Number.isInteger(roll.criticalRate) && roll.criticalRate >= 1 && roll.criticalRate <= 5 &&
      typeof roll.expression === 'string' && roll.expression.length <= 100 &&
      /^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/i.test(roll.expression) &&
      Number.isSafeInteger(roll.modifier) && Math.abs(roll.modifier) <= 100000 &&
      Array.isArray(roll.groups) && roll.groups.length > 0 && roll.groups.length <= 20 &&
      roll.groups.every(group => group && typeof group === 'object' && SIDES.includes(group.sides) && Array.isArray(group.values) &&
        group.values.length > 0 && group.values.length <= 999 &&
        group.values.every(value => Number.isInteger(value) && value >= 1 && value <= group.sides)) &&
      roll.groups.reduce((sum, group) => sum + group.values.length, 0) <= 999);
    if (!baseValid) return false;
    if (!roll.isPredetermined) return !roll.presetExpression;
    if (typeof roll.presetExpression !== 'string') return false;
    const preset = parsePresetExpression(roll.presetExpression);
    if (!preset || preset.expression !== roll.expression || preset.modifier !== roll.modifier) return false;
    const rolledTotals = new Map(roll.groups.map(group => [group.sides, { quantity: group.values.length, total: group.values.reduce((sum, value) => sum + value, 0) }]));
    const expectedTotals = new Map(preset.groups.map(group => [group.sides, { quantity: group.values.length, total: group.values.reduce((sum, value) => sum + value, 0) }]));
    return rolledTotals.size === expectedTotals.size && [...expectedTotals].every(([sides, expected]) => {
      const actual = rolledTotals.get(sides);
      return actual && actual.quantity === expected.quantity && actual.total === expected.total;
    });
  }

  function rememberRoll(id) {
    if (seenRolls.has(id)) return false;
    seenRolls.add(id);
    if (seenRolls.size > 200) seenRolls.delete(seenRolls.values().next().value);
    return true;
  }

  let coinFaceCounter = 0;

  function renderCoinFace(value) {
    const isHeads = value === 1;
    const isCritical = value === 2;
    const label = isHeads ? 'cara' : 'coroa';
    const coinFaceId = `coin-face-${++coinFaceCounter}`;
    const svg = isHeads ? `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="${coinFaceId}-gold" x1="0" x2="1">
            <stop offset="0%" stop-color="#fdf0b5" />
            <stop offset="45%" stop-color="#e8bf55" />
            <stop offset="100%" stop-color="#b9781a" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="20" fill="url(#${coinFaceId}-gold)" stroke="#86560f" stroke-width="2" />
        <circle cx="24" cy="24" r="10" fill="#fff6d6" opacity="0.9" />
        <path d="M17 28c3-3.2 11-3.2 14 0" stroke="#8b5813" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <circle cx="20" cy="20" r="2.1" fill="#8b5813" />
        <circle cx="28" cy="20" r="2.1" fill="#8b5813" />
      </svg>
    ` : `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="${coinFaceId}-silver" x1="0" x2="1">
            <stop offset="0%" stop-color="#f2f8ff" />
            <stop offset="45%" stop-color="#b9d4ea" />
            <stop offset="100%" stop-color="#6a8aa5" />
          </linearGradient>
          <linearGradient id="${coinFaceId}-gold" x1="0" x2="1">
            <stop offset="0%" stop-color="#fff0a8" />
            <stop offset="50%" stop-color="#efc761" />
            <stop offset="100%" stop-color="#b57a1d" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="20" fill="url(#${coinFaceId}-silver)" stroke="#4b5e74" stroke-width="2" />
        <path d="M14 30.5L18 17.5L23 25.5L24 14.5L25 25.5L30 17.5L34 30.5H14Z" fill="url(#${coinFaceId}-gold)" stroke="#925d1e" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M18 30.5H30V32.8H18Z" fill="#fff4c7" opacity="0.9"/>
        <circle cx="18" cy="17.5" r="2.1" fill="#fff9e6" stroke="#9d6d22" stroke-width="1.2" />
        <circle cx="24" cy="14.5" r="2.3" fill="#fff9e6" stroke="#9d6d22" stroke-width="1.2" />
        <circle cx="30" cy="17.5" r="2.1" fill="#fff9e6" stroke="#9d6d22" stroke-width="1.2" />
        <path d="M20.5 27.5H27.5V29.2H20.5Z" fill="#b57a1d" opacity="0.7"/>
        <circle cx="24" cy="23.6" r="3.2" fill="#fff8de" stroke="#8c611d" stroke-width="1.2"/>
      </svg>
    `;
    const sparks = isCritical ? '<i class="gold-spark spark-one"></i><i class="gold-spark spark-two"></i><i class="gold-spark spark-three"></i><i class="gold-spark spark-four"></i>' : '';
    return `<div class="rolling-die is-settled is-landed coin-face coin-face-${isHeads ? 'heads' : 'tails'}${isCritical ? ' is-critical' : ''}" aria-label="${label}" title="${label}"><span>${svg}</span>${sparks}</div>`;
  }

  function renderDie(value, sides, animate = false, index = 0, rate = selectedCriticalRate) {
    if (sides === 2) {
      if (!animate) return renderCoinFace(value);
      return `<div class="rolling-die coin-face coin-rolling" style="--roll-delay:${Math.min(index * 14, 280)}ms"><span>·</span></div>`;
    }
    const critical = value >= criticalThreshold(sides, rate);
    return `<div class="rolling-die${animate ? '' : ' is-settled is-landed'}${critical ? ' is-critical' : ''}"${animate ? ` style="--roll-delay:${Math.min(index * 14, 280)}ms"` : ''}><span>${animate ? '·' : value}</span>${critical ? '<i class="gold-spark spark-one"></i><i class="gold-spark spark-two"></i><i class="gold-spark spark-three"></i><i class="gold-spark spark-four"></i>' : ''}</div>`;
  }

  function getCalculatorValues() {
    const values = {};
    for (const stat of calculatorStats) {
      const input = document.querySelector(`[data-calc-stat="${stat.key}"]`);
      const entered = Number(input?.value || 0);
      values[stat.key] = Math.max(0, Math.min(calculatorStatMax(stat.key), Number.isFinite(entered) ? entered : 0));
      if (input && String(values[stat.key]) !== input.value) input.value = String(values[stat.key]);
    }
    return values;
  }

  function setCalculatorValues(values = {}) {
    for (const stat of calculatorStats) {
      const input = document.querySelector(`[data-calc-stat="${stat.key}"]`);
      if (!input) continue;
      const cleaned = Number(values[stat.key] ?? 0) || 0;
      input.value = String(Math.max(0, Math.min(calculatorStatMax(stat.key), cleaned)));
    }
  }

  function calculateStatSnapshot(values) {
    const vitality = Number(values.vitalidade || 0);
    const agilidade = Number(values.agilidade || 0);
    const forcaFisica = Number(values.forcaFisica || 0);
    const forcaEspecial = Number(values.forcaEspecial || 0);
    const resistenciaFisica = Number(values.resistenciaFisica || 0);
    const resistenciaEspecial = Number(values.resistenciaEspecial || 0);
    const resistenciaPerfeita = Number(values.resistenciaPerfeita || 0);
    const lucidez = Number(values.lucidez || 0);
    const intuicao = Number(values.intuicao || 0);
    const persuasao = Number(values.persuasao || 0);
    const social = Math.max(0, persuasao + intuicao);
    const total = Math.max(0, vitality + agilidade + forcaFisica + forcaEspecial + resistenciaFisica + resistenciaEspecial + resistenciaPerfeita + lucidez + intuicao + persuasao);
    return {
      vitality,
      agilidade,
      forcaFisica,
      forcaEspecial,
      resistenciaFisica,
      resistenciaEspecial,
      resistenciaPerfeita,
      lucidez,
      intuicao,
      persuasao,
      social,
      total
    };
  }

  function renderCalculatorResult() {
    const values = getCalculatorValues();
    const snapshot = calculateStatSnapshot(values);
    calcResult.innerHTML = `
      <div class="dice-calc-summary">
        <div><strong>Força física:</strong> ${snapshot.forcaFisica}</div>
        <div><strong>Força especial:</strong> ${snapshot.forcaEspecial}</div>
        <div><strong>Resistência física:</strong> ${snapshot.resistenciaFisica}</div>
        <div><strong>Resistência especial:</strong> ${snapshot.resistenciaEspecial}</div>
        <div><strong>Resistência perfeita:</strong> ${snapshot.resistenciaPerfeita}</div>
        <div><strong>Social:</strong> ${snapshot.social}</div>
        <div><strong>Total:</strong> ${snapshot.total}</div>
      </div>
    `;
  }

  function renderRoll(roll, animate = true, threeDimensional = false) {
    if (!isValidRoll(roll) || !rememberRoll(roll.id)) return;
    setPanelOpen(true);
    selectedCriticalRate = roll.baseCriticalRate ?? roll.criticalRate;
    document.querySelectorAll('[data-critical-rate]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.criticalRate) === selectedCriticalRate));
    });
    expression.value = roll.expression;
    if (roll.isPredetermined) {
      presetExpression.value = roll.presetExpression;
      presetError.textContent = 'Resultado predeterminado validado; valores e soma exibidos abaixo.';
    } else parseExpression();
    updateCriticalRange(roll.groups, roll.criticalRate);
    rollButton.disabled = animate;
    rollButton.textContent = animate ? 'Rolando…' : 'Rolar novamente';
    const total = roll.groups.reduce((sum, group) => sum + group.values.reduce((groupSum, value) => groupSum + value, 0), roll.modifier);
    const coinGroup = roll.groups.find(group => group.sides === 2);
    const coinHeads = coinGroup ? coinGroup.values.filter(value => value === 1).length : 0;
    const coinCount = coinGroup?.values.length || 0;
    const detail = coinCount ? `<span class="dice-coin-detail">${coinHeads} caras · ${coinCount - coinHeads} coroas</span>` : '';
    const modifier = roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : '';
    const resultExpression = roll.presetExpression || roll.expression;
    const header = `<div class="dice-result-heading"><span class="dice-result-expression">${resultExpression}${roll.isCritical ? ' · CRÍTICO' : ''}</span><strong class="dice-result-total">Total ${total}</strong></div>${detail}`;
    const customGroups = roll.groups.filter(group => roll.isPredetermined ? group.sides !== 2 : customPolyhedralSides.has(group.sides));
    const standardGroups = roll.groups.filter(group => diceBoxSides.has(group.sides));
    const stage = roll.isPredetermined
      ? `<div class="dice-roll-stage dice-roll-stage-summary dice-preset-result-stage" aria-label="Resultados dos dados">${roll.groups.flatMap(group => group.values.map(value => `<span class="dice-preset-result" aria-label="d${group.sides}: ${value}">${value}</span>`)).join('')}</div>`
      : threeDimensional
      ? `<div class="dice-roll-stage dice-roll-stage-summary" aria-label="Resultados dos dados">${roll.groups.flatMap(group => group.values.map(value => renderDie(value, group.sides, false, 0, roll.criticalRate))).join('')}</div>`
      : animate
      ? `<div class="dice-roll-stage" aria-label="Dados rolando">${roll.groups.flatMap(group => group.values.map((_, index) => renderDie(0, group.sides, true, index, roll.criticalRate))).join('')}</div>`
      : '';
    results.innerHTML = `${header}${modifier ? `<div class="dice-result-modifier">Modificador${modifier}</div>` : ''}${stage}`;
    if (animate || threeDimensional) panel.scrollTop = panel.scrollHeight;
    window.clearTimeout(rollTimer);
    if (animate) {
      rollTimer = window.setTimeout(() => {
        const stageElement = results.querySelector('.dice-roll-stage');
        if (stageElement) stageElement.innerHTML = roll.groups.flatMap(group => group.values.map(value => renderDie(value, group.sides, false, 0, roll.criticalRate))).join('');
        rollButton.disabled = false;
        rollButton.textContent = 'Rolar novamente';
      }, 1350);
    }
  }

  async function rollDice(context = {}) {
    if (rolling) return null;
    const parsed = context.presetExpression ? parsePresetExpression(context.presetExpression) : parseExpression();
    if (!parsed) {
      if (context.presetExpression) {
        presetExpression.setAttribute('aria-invalid', 'true');
        presetError.textContent = 'Resultado inválido. Confira dados e somas; limite de 100 dados por rolagem 3D.';
        presetExpression.focus();
      } else expression.focus();
      return;
    }
    rolling = true;
    if (!context.presetExpression) {
      rollButton.disabled = true;
      rollButton.textContent = 'Rolando…';
    }
    const baseCriticalRate = selectedCriticalRate;
    const rateBonus = Math.max(-4, Math.min(4, Math.floor(Number(context.criticalRateBonus) || 0)));
    const criticalRate = Math.max(1, Math.min(5, baseCriticalRate + rateBonus));
    const criticalBonusPercent = Math.max(0, Number(context.criticalBonusPercent ?? 10) || 0);
    const physicalGroups = parsed.groups.filter(group => diceBoxSides.has(group.sides));
    const customGroups = parsed.groups.filter(group => parsed.isPredetermined ? group.sides !== 2 : customPolyhedralSides.has(group.sides));
    const coinGroups = parsed.groups.filter(group => group.sides === 2);
    const physicalRequests = physicalGroups.map((group, groupIndex) => ({ ...group, groupIndex }));
    const physicalCount = physicalRequests.reduce((sum, group) => sum + group.quantity, 0);
    let groups = parsed.isPredetermined ? parsed.groups : parsed.groups.map(group => ({
      sides: group.sides,
      values: customPolyhedralSides.has(group.sides) || !diceBoxSides.has(group.sides)
        ? Array.from({ length: group.quantity }, () => randomFace(group.sides))
        : []
    }));
    let usedThreeDimensions = false;

    if (!parsed.isPredetermined && parsed.quantity <= 100 && (physicalCount > 0 || customGroups.length > 0 || coinGroups.length > 0)) {
      setPanelOpen(true);
      const coinValues = coinGroups.flatMap(group => groups.find(item => item.sides === group.sides).values);
      showThreeDimensionalRoll(parsed.isPredetermined ? parsed.presetExpression : parsed.expression, !parsed.isPredetermined && physicalCount > 0, customGroups, coinGroups);
      try {
        const tasks = [];
        if (coinGroups.length) {
          tasks.push((async () => {
            if (!window.StonePlatePolyhedralDice || !coinRollStage) throw new Error('Renderizador de moedas indisponível.');
            await window.StonePlatePolyhedralDice.rollCoins(coinRollStage, coinValues.map(value => ({ value })));
          })());
        }
        if (physicalCount > 0 && !parsed.isPredetermined) {
          tasks.push((async () => {
            const box = await getDiceBox();
            const boxStage = standardRollStage;
            if (boxStage && box.canvas) boxStage.append(box.canvas);
            const boxResults = await box.roll(physicalRequests.map(group => ({ sides: group.sides, qty: group.quantity })));
            const diceResults = boxResults.flatMap(result => Array.isArray(result.rolls) ? result.rolls : [result]);
            for (const group of physicalGroups) {
              const groupId = physicalRequests.findIndex(request => request.sides === group.sides);
              const values = diceResults.filter(die => Number(die.groupId) === groupId).map(die => Number(die.value ?? die.result));
              if (values.length !== group.quantity || values.some(value => !Number.isInteger(value) || value < 1 || value > group.sides)) {
                throw new Error('O motor 3D retornou resultados incompletos.');
              }
              groups.find(item => item.sides === group.sides).values = values;
            }
          })());
        }
        if (customGroups.length) {
          tasks.push((async () => {
            const customDice = customGroups.flatMap(group => groups.find(item => item.sides === group.sides).values
              .map(value => ({ sides: group.sides, value, critical: value >= criticalThreshold(group.sides, criticalRate) })));
            const stageElement = polyhedralRollStage;
            if (!window.StonePlatePolyhedralDice || !stageElement) throw new Error('Renderizador poliédrico indisponível.');
            await window.StonePlatePolyhedralDice.roll(stageElement, customDice);
          })());
        }
        await Promise.all(tasks);
        usedThreeDimensions = true;
      } catch (error) {
        console.warn('Rolagem 3D indisponível; usando a rolagem local.', error);
        if (!parsed.isPredetermined) {
          groups = parsed.groups.map(group => ({
            sides: group.sides,
            values: Array.from({ length: group.quantity }, () => randomFace(group.sides))
          }));
        }
        dismissDiceRollOverlay(0);
      }
    } else if (!parsed.isPredetermined) {
      groups = parsed.groups.map(group => ({
        sides: group.sides,
        values: Array.from({ length: group.quantity }, () => randomFace(group.sides))
      }));
    }

    const naturalCritical = !context.preventCritical && groups.some(group => group.values.some(value => value >= criticalThreshold(group.sides, criticalRate)));
    const isCritical = !context.preventCritical && (naturalCritical || Boolean(context.guaranteedCritical));
    const roll = {
      id: crypto.randomUUID(),
      expression: parsed.expression,
      modifier: parsed.modifier,
      ...(parsed.isPredetermined ? { isPredetermined: true, presetExpression: parsed.presetExpression } : {}),
      criticalRate,
      baseCriticalRate,
      criticalBonusPercent,
      isCritical,
      naturalCritical,
      isSurge: naturalCritical && Boolean(context.guaranteedCritical),
      attackType: context.attackType === 'especial' ? 'especial' : context.attackType === 'fisico' ? 'fisico' : null,
      attackerTokenId: typeof context.attackerTokenId === 'string' ? context.attackerTokenId : null,
      groups,
      timestamp: Date.now()
    };
    if (window.StonePlate?.broadcastDiceRoll) window.StonePlate.broadcastDiceRoll(roll);
    else channel?.postMessage({ type: 'dice-roll', roll });
    renderRoll(roll, !usedThreeDimensions && !parsed.isPredetermined, usedThreeDimensions);
    if (usedThreeDimensions) dismissDiceRollOverlay();
    rolling = false;
    rollButton.disabled = false;
    return roll;
  }

  window.StonePlateDice = {
    rollInstinctAttack,
    async rollExpression(source, context = {}) {
      setPanelOpen(true);
      expression.value = String(source || '').trim();
      if (!parseExpression()) return false;
      return await rollDice(context);
    },
    setCalculatorFromCharacter(character = {}) {
      setCalculatorValues({
        vitalidade: Number(character.vitalidade ?? character.hp ?? 0),
        agilidade: Number(character.agilidade ?? 0),
        forcaFisica: Number(character.forcaFisica ?? character.forca ?? 0),
        forcaEspecial: Number(character.forcaEspecial ?? 0),
        resistenciaFisica: Number(character.resistenciaFisica ?? character.defesa ?? 0),
        resistenciaEspecial: Number(character.resistenciaEspecial ?? character.defesaP ?? 0),
        lucidez: Number(character.lucidez ?? character.sanity ?? 0),
        intuicao: Number(character.intuicao ?? 0),
        persuasao: Number(character.persuasao ?? 0)
      });
      renderCalculatorResult();
      setCalculatorOpen(true);
    }
  };

  toggle.addEventListener('click', () => setPanelOpen(panel.hidden));
  document.querySelectorAll('[data-dice-style]').forEach(input => input.addEventListener('input', () => {
    DICE_STYLE[input.dataset.diceStyle] = input.value;
    localStorage.setItem(DICE_STYLE_STORAGE_KEY, JSON.stringify(DICE_STYLE));
    applyDiceStyle();
  }));
  document.querySelector('#diceClose').addEventListener('click', () => setPanelOpen(false));
  document.querySelectorAll('[data-critical-rate]').forEach(button => button.addEventListener('click', () => {
    selectedCriticalRate = Number(button.dataset.criticalRate);
    document.querySelectorAll('[data-critical-rate]').forEach(option => {
      option.setAttribute('aria-pressed', String(Number(option.dataset.criticalRate) === selectedCriticalRate));
    });
    parseExpression();
  }));
  expression.addEventListener('input', parseExpression);
  expression.addEventListener('keydown', event => { if (event.key === 'Enter') rollDice(); });
  presetExpression.addEventListener('input', () => {
    const parsed = presetExpression.value.trim() ? parsePresetExpression(presetExpression.value) : null;
    presetExpression.setAttribute('aria-invalid', String(Boolean(presetExpression.value.trim()) && !parsed));
    presetError.textContent = parsed
      ? 'Somas válidas. Os valores informados serão exibidos no resultado.'
      : presetExpression.value.trim()
        ? 'Formato inválido. Exemplo: 1d4(3)+2d8(12); a soma precisa caber nos dados.'
        : 'Use grupos como 1d4(3)+2d8(12); o número entre parênteses é a soma daquele grupo.';
    presetRollButton.disabled = !parsed || rolling;
  });
  presetExpression.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !presetRollButton.disabled) presetRollButton.click();
  });
  presetRollButton.addEventListener('click', async () => {
    if (rolling) return;
    presetRollButton.disabled = true;
    try {
      await rollDice({ presetExpression: presetExpression.value });
    } catch (error) {
      console.error('Não foi possível exibir o resultado pré-determinado.', error);
      presetError.textContent = 'Não foi possível concluir a rolagem pré-determinada.';
    } finally {
      presetRollButton.textContent = 'Rolar resultado';
      presetRollButton.disabled = !parsePresetExpression(presetExpression.value);
    }
  });
  document.querySelectorAll('[data-die-sides]').forEach(button => button.addEventListener('click', event => {
    const sides = Number(button.dataset.dieSides);
    const parsed = parseExpression();
    if (parsed && (event.shiftKey || sides === selectedSides)) {
      const terms = [...expression.value.replace(/\s+/g, '').toLowerCase().matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/g)];
      let merged = false;
      expression.value = terms.map(term => {
        if (term[3] !== undefined && Number(term[3]) === sides) {
          if (merged) return '';
          merged = true;
          return `${term[1]}${Number(term[2] || 1) + 1}d${sides}`;
        }
        return term[0];
      }).filter(Boolean).join('');
      if (!merged) expression.value = `${expression.value}+1d${sides}`;
    } else {
      const modifier = parsed?.modifier || 0;
      expression.value = `1d${sides}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}`;
    }
    parseExpression();
    expression.focus();
  }));
  calcToggle.addEventListener('click', () => {
    const nextState = calculatorPanel.hidden;
    setCalculatorOpen(nextState);
    if (nextState) {
      renderCalculatorResult();
      renderCharacterComparison();
    }
  });
  document.querySelector('#diceCalculatorClose').addEventListener('click', () => setCalculatorOpen(false));
  combatAttackerSelect.addEventListener('change', () => {
    combatAttackerId = combatAttackerSelect.value;
    const attacker = window.StonePlate?.getState?.()?.health?.characters?.find(character => String(character.id) === combatAttackerId);
    combatAttackId = String(attacker?.attacks?.[0]?.id || '');
    combatResult = null;
    renderCharacterComparison();
  });
  combatTargetSelect.addEventListener('change', () => {
    combatTargetId = combatTargetSelect.value;
    combatResult = null;
    renderCharacterComparison();
  });
  combatAttackSelect.addEventListener('change', () => {
    combatAttackId = combatAttackSelect.value;
    combatResult = null;
    renderCharacterComparison();
  });
  combatButton.addEventListener('click', calculateCharacterCombat);
  combatResultElement.addEventListener('click', event => {
    if (!event.target.closest('[data-apply-combat-damage]') || !combatResult || combatResult.applied) return;
    const targetId = combatResult.targetId;
    const damage = combatResult.damage;
    combatResult.applied = true;
    window.StonePlate?.updateHealth(health => {
      const target = health.characters.find(character => String(character.id) === targetId);
      if (!target) return;
      const attacker = health.characters.find(character => String(character.id) === combatResult.attackerId);
      const hitApplied = window.StonePlate?.applyCharacterDamage?.(target, damage, combatResult.damageType, attacker, combatResult.damageType === 'fisico' || combatResult.damageType === 'especial' ? combatResult.damageType : combatResult.damageForceType);
      combatResult.dodged = hitApplied === false;
      if (hitApplied !== false) {
        window.StonePlate?.recordRhythmHit?.(attacker, target, combatResult.rhythm);
        window.StonePlate?.applyCriticalEffect?.(combatResult.roll, attacker, target, combatResult.damageType, damage);
      } else window.StonePlate?.recordRhythmHit?.(attacker, target, combatResult.rhythm, false);
    });
    renderCharacterComparison();
  });
  document.querySelector('#diceCalcButton').addEventListener('click', () => {
    renderCalculatorResult();
    setCalculatorOpen(true);
  });
  document.querySelector('#diceUseTokenStats').addEventListener('click', () => {
    const state = window.StonePlate?.getState?.();
    const selectedTokenId = state?.initiative?.activeTokenId || window.StonePlate?.getSelectedTokenId?.() || null;
    const token = state?.tokens?.find(item => String(item.id) === String(selectedTokenId || '')) || null;
    const character = token ? window.StonePlate?.getLinkedCharacterForToken?.(token) || null : null;
    if (character) {
      setCalculatorValues({
        vitalidade: Number(character.vitalidade ?? character.hp ?? 0),
        agilidade: Number(character.agilidade ?? 0),
        forcaFisica: Number(character.forcaFisica ?? character.forca ?? 0),
        forcaEspecial: Number(character.forcaEspecial ?? 0),
        resistenciaFisica: Number(character.resistenciaFisica ?? character.defesa ?? 0),
        resistenciaEspecial: Number(character.resistenciaEspecial ?? character.defesaP ?? 0),
        lucidez: Number(character.lucidez ?? character.sanity ?? 0),
        intuicao: Number(character.intuicao ?? 0),
        persuasao: Number(character.persuasao ?? 0)
      });
      renderCalculatorResult();
      renderCharacterComparison();
      setCalculatorOpen(true);
      return;
    }
    calcResult.textContent = token
      ? 'Este token ainda não tem uma ficha de personagem vinculada.'
      : 'Selecione um token conectado a um personagem para usar suas estatísticas.';
    setCalculatorOpen(true);
  });
  document.querySelectorAll('[data-calc-stat]').forEach(input => input.addEventListener('input', renderCalculatorResult));
  window.StonePlate?.subscribe(renderCharacterComparison);
  renderCharacterComparison();
  rollButton.addEventListener('click', rollDice);
  applyDiceStyle();
  parseExpression();
  channel?.addEventListener('message', event => {
    if (event.data?.type === 'dice-roll') {
      if (event.data.roll?.displayMode === 'instinct') replayReceivedInstinctRoll(event.data.roll);
      else {
        const incomingRoll = event.data.roll;
        if (incomingRoll?.isPredetermined && isValidRoll(incomingRoll)) {
          renderRoll(incomingRoll, false, true);
          return;
        }
        const incomingStandardGroups = incomingRoll?.groups?.filter(group => !incomingRoll.isPredetermined && diceBoxSides.has(group.sides)) || [];
        const incomingCustomGroups = incomingRoll?.groups?.filter(group => customPolyhedralSides.has(group.sides)) || [];
        const incomingCoinGroups = incomingRoll?.groups?.filter(group => group.sides === 2) || [];
        if ((incomingStandardGroups.length || incomingCustomGroups.length || incomingCoinGroups.length) && isValidRoll(incomingRoll)) {
          renderRoll(incomingRoll, false, true);
          createDiceRollOverlay(incomingStandardGroups.length > 0, incomingCustomGroups.length > 0, incomingCoinGroups.length > 0);
          const tasks = [];
          if (incomingCoinGroups.length && window.StonePlatePolyhedralDice) {
            const coins = incomingCoinGroups.flatMap(group => group.values.map(value => ({ value })));
            tasks.push(window.StonePlatePolyhedralDice.rollCoins(coinRollStage, coins));
          }
          if (incomingStandardGroups.length) {
            tasks.push((async () => {
              const box = await getDiceBox();
              await box.roll(incomingStandardGroups.map(group => ({ sides: group.sides, qty: group.values.length })));
            })());
          }
          if (incomingCustomGroups.length && window.StonePlatePolyhedralDice) {
            const customDice = incomingCustomGroups.flatMap(group => group.values.map(value => ({ sides: group.sides, value, critical: value >= criticalThreshold(group.sides, incomingRoll.criticalRate || 1) })));
            tasks.push(window.StonePlatePolyhedralDice.roll(polyhedralRollStage, customDice));
          }
          Promise.allSettled(tasks).then(results => {
            if (results.some(result => result.status === 'rejected')) console.warn('Uma animação de dados recebida não pôde ser exibida.');
            dismissDiceRollOverlay();
          });
        } else renderRoll(incomingRoll);
      }
    }
  });
})();
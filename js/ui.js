// ui.js — Capa de interfaz: conecta el editor, el ensamblador y el
// cycle-engine con el diagrama animado de la CPU. Es la única pieza que
// toca el DOM; toda la lógica de simulación vive en los demás módulos.
(function () {
  'use strict';

  const cpu = new CPU_NS.CPU();
  const engine = new CYCLE_ENGINE_NS.CycleEngine(cpu);
  let currentAsm = null;
  let running = false;
  let animating = false;
  let stageTimer = null;
  let pendingStageResolve = null; // ver stopRun(): garantiza que playStages() siempre resuelva

  const el = id => document.getElementById(id);
  const editor = el('asmEditor');
  const exampleSelect = el('exampleSelect');
  const btnAssemble = el('btnAssemble');
  const btnStep = el('btnStep');
  const btnRun = el('btnRun');
  const btnPause = el('btnPause');
  const btnReset = el('btnReset');
  const speedRange = el('speedRange');
  const speedValue = el('speedValue');
  const errorsBox = el('errorsBox');
  const statusBar = el('statusBar');

  // ---------------------------------------------------------------
  // Selector de ejemplos
  // ---------------------------------------------------------------
  EXAMPLES.forEach((ex, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = ex.title;
    exampleSelect.appendChild(opt);
  });
  exampleSelect.addEventListener('change', () => {
    editor.value = EXAMPLES[Number(exampleSelect.value)].code;
  });
  editor.value = EXAMPLES[0].code;

  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doAssemble(); }
  });

  function updateSpeedLabel() { speedValue.textContent = speedRange.value + ' ms/etapa'; }
  speedRange.addEventListener('input', updateSpeedLabel);
  updateSpeedLabel();

  // ---------------------------------------------------------------
  // Ensamblado
  // ---------------------------------------------------------------
  function doAssemble() {
    stopRun();
    const asm = ASSEMBLER.assemble(editor.value);
    if (!asm.ok) {
      showErrors(asm.errors);
      setStatus('Error de ensamblado. Revisá el panel de errores.', true);
      setEnabled(false);
      return;
    }
    currentAsm = asm;
    hideErrors();
    engine.reset(asm.image, asm.orgAddress);
    renderAll();
    renderTrace();
    renderStack();
    renderConsole();
    setEnabled(true);
    setStatus(`Ensamblado OK (${asm.length} bytes cargados en CS:0000). Listo para ejecutar.`);
  }

  function showErrors(errors) {
    errorsBox.innerHTML = '';
    errors.forEach(e => {
      const div = document.createElement('div');
      div.className = 'err-line';
      div.textContent = `Línea ${e.line}: ${e.message}`;
      div.addEventListener('click', () => jumpToLine(e.line));
      errorsBox.appendChild(div);
    });
    errorsBox.hidden = false;
  }
  function hideErrors() { errorsBox.hidden = true; errorsBox.innerHTML = ''; }

  function jumpToLine(lineNum) {
    const lines = editor.value.split('\n');
    let idx = 0;
    for (let i = 0; i < lineNum - 1 && i < lines.length; i++) idx += lines[i].length + 1;
    editor.focus();
    const lineLen = lines[lineNum - 1] ? lines[lineNum - 1].length : 0;
    editor.setSelectionRange(idx, idx + lineLen);
  }

  function setEnabled(on) {
    btnStep.disabled = !on;
    btnRun.disabled = !on;
    btnReset.disabled = !on;
  }
  setEnabled(false);

  function setStatus(msg, isError) {
    statusBar.textContent = msg;
    statusBar.classList.toggle('error', !!isError);
  }

  // ---------------------------------------------------------------
  // Ejecución paso a paso con animación de las 4 etapas
  // ---------------------------------------------------------------
  const STAGES = ['fetch', 'decode', 'execute', 'writeback'];

  function doStep(animated) {
    if (!currentAsm || cpu.halted || animating) return Promise.resolve();
    animating = true;
    btnStep.disabled = true;
    const before = cpu.snapshot();
    const events = [];
    const unsub = engine.on(e => events.push(e));
    const advanced = engine.stepInstruction();
    unsub();
    if (!advanced) { animating = false; btnStep.disabled = false; return Promise.resolve(); }
    const after = cpu.snapshot();

    const finish = () => {
      animating = false;
      btnStep.disabled = !currentAsm || cpu.halted;
      renderTrace();
      renderStack();
      renderConsole();
      if (cpu.halted) {
        setStatus(cpu.error ? ('Detenida por excepción: ' + cpu.error) : 'Programa finalizado (HLT).', !!cpu.error);
        stopRun();
      }
    };

    if (animated === false) {
      renderRegisters(after, diffRegs(before, after));
      renderSegments(after);
      renderFlags(after, before.flags);
      finish();
      return Promise.resolve();
    }
    return playStages(before, after, events).then(finish);
  }

  function playStages(before, after, events) {
    return new Promise(resolve => {
      // stopRun() necesita poder resolver esta promesa de inmediato si el
      // usuario presiona Pausa a mitad de la animación (ver stopRun): si
      // sólo canceláramos el setTimeout, esta promesa quedaría pendiente
      // para siempre y colgaría el `await` de runLoop().
      pendingStageResolve = resolve;
      let i = 0;
      function next() {
        if (i >= STAGES.length) { pendingStageResolve = null; resolve(); return; }
        const stage = STAGES[i];
        const ev = events.find(e => e.stage === stage);
        setActiveStage(stage);
        renderStageFrame(stage, ev, before, after);
        i++;
        stageTimer = setTimeout(next, parseInt(speedRange.value, 10));
      }
      next();
    });
  }

  function setActiveStage(stage) {
    document.querySelectorAll('.stage-pill').forEach(p => p.classList.toggle('active', p.dataset.stage === stage));
    document.querySelectorAll('.bus-arrow').forEach(b => b.classList.toggle('active', b.dataset.stage === stage));
    el('blockMemory').classList.toggle('active-fetch', stage === 'fetch');
    el('blockIR').classList.toggle('active-fetch', stage === 'fetch');
    el('blockDecoder').classList.toggle('active-decode', stage === 'decode');
    el('blockALU').classList.toggle('active-execute', stage === 'execute');
    el('blockRegisters').classList.toggle('active-writeback', stage === 'writeback');
    el('blockFlags').classList.toggle('active-writeback', stage === 'writeback');
    el('blockSegments').classList.toggle('active-writeback', stage === 'writeback');
  }

  function renderStageFrame(stage, ev, before, after) {
    const instr = ev ? ev.instr : null;
    if (stage === 'fetch' && instr) {
      renderMemHexdump(before, instr);
      renderIR(instr);
      renderDecoder(null);
      renderALU(null);
      renderRegisters(before, null);
      renderSegments(before);
      renderFlags(before);
    } else if (stage === 'decode' && instr) {
      renderDecoder(instr);
    } else if (stage === 'execute' && ev) {
      renderALU(instr, ev.result);
    } else if (stage === 'writeback') {
      renderMemHexdump(after, instr);
      renderRegisters(after, diffRegs(before, after));
      renderSegments(after);
      renderFlags(after, before.flags);
    }
  }

  function diffRegs(before, after) {
    const changed = new Set();
    Object.keys(after.reg).forEach(k => { if (before.reg[k] !== after.reg[k]) changed.add(k); });
    Object.keys(after.sreg).forEach(k => { if (before.sreg[k] !== after.sreg[k]) changed.add(k); });
    return changed;
  }

  // ---------------------------------------------------------------
  // Render de cada bloque del diagrama
  // ---------------------------------------------------------------
  function hex16(v) { return '0x' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
  function hex8(v) { return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }

  function renderMemHexdump(snap, instr) {
    const box = el('memHexdump');
    box.innerHTML = '';
    const cs = snap.sreg.CS;
    const centerOff = instr ? instr.startOffset : snap.reg.IP;
    const startOff = (centerOff - 4) & 0xFFFF;
    for (let i = 0; i < 16; i++) {
      const off = (startOff + i) & 0xFFFF;
      const b = cpu.readByte(cs, off);
      const span = document.createElement('span');
      span.className = 'byte';
      if (instr && off >= instr.startOffset && off < (instr.startOffset + instr.length)) span.classList.add('current');
      if (off === snap.reg.IP) span.classList.add('ip');
      span.textContent = hex8(b);
      span.title = `CS:${off.toString(16).toUpperCase().padStart(4, '0')}h`;
      box.appendChild(span);
      box.appendChild(document.createTextNode(' '));
    }
  }
  function renderIR(instr) {
    el('irBytes').textContent = instr.bytes.map(hex8).join(' ') + (instr.repPrefix ? `  (prefijo ${instr.repPrefix})` : '');
  }
  function renderDecoder(instr) {
    el('decoderInfo').textContent = instr ? instr.text : '—';
  }
  function renderALU(instr, result) {
    const box = el('aluInfo');
    if (!instr) { box.textContent = '—'; return; }
    if (result && result.microOps && result.microOps.length) {
      box.textContent = result.microOps.map(describeMicroOp).join('\n');
    } else {
      box.textContent = '(sin cambios de estado)';
    }
  }
  function describeMicroOp(op) {
    switch (op.type) {
      case 'reg': return `${op.name} ← ${hex16(op.value)}`;
      case 'reg8': return `${op.name} ← 0x${hex8(op.value)}`;
      case 'sreg': return `${op.name} ← ${hex16(op.value)}`;
      case 'mem': return `[${op.seg.toString(16).toUpperCase()}:${op.off.toString(16).toUpperCase()}] ← ${op.size === 16 ? hex16(op.value) : '0x' + hex8(op.value)}`;
      case 'flags': return 'FLAGS actualizados';
      case 'halt': return 'HLT — la CPU se detiene';
      case 'output': return `salida de consola: "${op.text}"`;
      case 'exception': return `⚠ ${op.message}`;
      default: return JSON.stringify(op);
    }
  }

  const REG_ORDER = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP', 'IP'];
  function renderRegisters(snap, changed) {
    const grid = el('regGrid');
    grid.innerHTML = '';
    REG_ORDER.forEach(name => {
      const cell = document.createElement('div');
      cell.className = 'reg-cell' + (changed && changed.has(name) ? ' changed' : '');
      cell.innerHTML = `<span class="name">${name}</span><span class="value">${hex16(snap.reg[name])}</span>`;
      grid.appendChild(cell);
    });
  }
  function renderSegments(snap) {
    const grid = el('segGrid');
    grid.innerHTML = '';
    ['CS', 'DS', 'ES', 'SS'].forEach(name => {
      const cell = document.createElement('div');
      cell.className = 'seg-cell';
      cell.innerHTML = `<span class="name">${name}</span><span class="value">${hex16(snap.sreg[name])}</span>`;
      grid.appendChild(cell);
    });
    const phys = ((snap.sreg.CS << 4) + snap.reg.IP) & 0xFFFFF;
    el('physAddrInfo').textContent = `CS:IP = ${hex16(snap.sreg.CS)}:${hex16(snap.reg.IP)} → física = 0x${phys.toString(16).toUpperCase().padStart(5, '0')}  (CS×16 + IP)`;
  }
  function renderFlags(snap, prevFlags) {
    const row = el('flagsRow');
    row.innerHTML = '';
    ISA.FLAG_ORDER.forEach(name => {
      const bit = ISA.FLAGS[name];
      const isSet = (snap.flags & bit) !== 0;
      const changed = prevFlags !== undefined && (((prevFlags & bit) !== 0) !== isSet);
      const badge = document.createElement('span');
      badge.className = 'flag-badge' + (isSet ? ' set' : '') + (changed ? ' changed' : '');
      badge.textContent = name;
      badge.title = `${name} = ${isSet ? 1 : 0}`;
      row.appendChild(badge);
    });
  }

  function renderAll() {
    const snap = cpu.snapshot();
    renderRegisters(snap, null);
    renderSegments(snap);
    renderFlags(snap);
    renderMemHexdump(snap, null);
    el('irBytes').textContent = '—';
    el('decoderInfo').textContent = '—';
    el('aluInfo').textContent = '—';
    setActiveStage(null);
  }

  // ---------------------------------------------------------------
  // Panel lateral: listado del programa, pila, consola
  // ---------------------------------------------------------------
  function escapeHtml(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function renderTrace() {
    const body = el('traceBody');
    body.innerHTML = '';
    if (!currentAsm) return;
    let currentRow = null;
    currentAsm.listing.forEach(item => {
      const tr = document.createElement('tr');
      const isCurrent = item.address === cpu.reg.IP && !cpu.halted;
      if (isCurrent) { tr.classList.add('current-line'); currentRow = tr; }
      tr.innerHTML = `<td>${item.address.toString(16).toUpperCase().padStart(4, '0')}</td>` +
        `<td>${item.bytes.map(hex8).join(' ')}</td>` +
        `<td>${escapeHtml(item.text)}</td>`;
      body.appendChild(tr);
    });
    if (currentRow) currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function renderStack() {
    const body = el('stackBody');
    body.innerHTML = '';
    const sp = cpu.reg.SP;
    for (let i = -4; i < 8; i++) {
      const off = (sp + i * 2) & 0xFFFF;
      const val = cpu.readWord(cpu.sreg.SS, off);
      const tr = document.createElement('tr');
      if (off === sp) tr.classList.add('sp-row');
      tr.innerHTML = `<td>SS:${off.toString(16).toUpperCase().padStart(4, '0')}</td><td>${hex16(val)}</td>`;
      body.appendChild(tr);
    }
  }
  function renderConsole() {
    const pre = el('consoleOutput');
    pre.textContent = cpu.output.join('');
    pre.scrollTop = pre.scrollHeight;
  }

  // ---------------------------------------------------------------
  // Controles: paso, run, pausa, reset
  // ---------------------------------------------------------------
  function stopRun() {
    running = false;
    clearTimeout(stageTimer);
    // Si había una animación de 4 etapas en curso, resolverla ya mismo en
    // vez de dejarla pendiente para siempre (ver playStages).
    if (pendingStageResolve) { const resolve = pendingStageResolve; pendingStageResolve = null; resolve(); }
    if (currentAsm) btnRun.disabled = false;
    btnPause.disabled = true;
  }

  async function runLoop() {
    if (!currentAsm || cpu.halted) return;
    running = true;
    btnRun.disabled = true;
    btnPause.disabled = false;
    while (running && !cpu.halted) {
      await doStep(true);
    }
    stopRun();
  }

  btnAssemble.addEventListener('click', doAssemble);
  btnStep.addEventListener('click', () => doStep(true));
  btnRun.addEventListener('click', runLoop);
  btnPause.addEventListener('click', stopRun);
  btnReset.addEventListener('click', () => {
    stopRun();
    if (!currentAsm) return;
    engine.reset(currentAsm.image, currentAsm.orgAddress);
    renderAll();
    renderTrace();
    renderStack();
    renderConsole();
    btnStep.disabled = false;
    setStatus('CPU reiniciada.');
  });

  // Pestañas del panel lateral
  const TAB_IDS = { trace: 'tabTrace', stack: 'tabStack', console: 'tabConsole' };
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.keys(TAB_IDS).forEach(name => { el(TAB_IDS[name]).hidden = (name !== btn.dataset.tab); });
    });
  });

  // ---------------------------------------------------------------
  // Estado inicial
  // ---------------------------------------------------------------
  renderAll();
})();

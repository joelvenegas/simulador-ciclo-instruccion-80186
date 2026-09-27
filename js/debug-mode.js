// debug-mode.js — Pantalla alternativa tipo "DEBUG.COM" de MS-DOS: una
// consola de línea de comandos para ensamblar (a), desensamblar (u),
// inspeccionar memoria (d) y registros (r), y ejecutar paso a paso (t) o
// corrido (g). Usa su propia CPU independiente de la del modo visual
// (ui.js): no comparte estado, igual que abrir DEBUG.COM desde cero.
(function () {
  'use strict';

  const cpu = new CPU_NS.CPU();
  const engine = new CYCLE_ENGINE_NS.CycleEngine(cpu);
  const MAX_GO_STEPS = 200000;

  const REP_PREFIXES = { REP: 0xF3, REPE: 0xF3, REPZ: 0xF3, REPNE: 0xF2, REPNZ: 0xF2 };
  const FLAG_DISPLAY_ORDER = ['OF', 'DF', 'IF', 'SF', 'ZF', 'AF', 'PF', 'CF'];
  const FLAG_LABELS = {
    OF: ['NV', 'OV'], DF: ['UP', 'DN'], IF: ['DI', 'EI'], SF: ['PL', 'NG'],
    ZF: ['NZ', 'ZR'], AF: ['NA', 'AC'], PF: ['PO', 'PE'], CF: ['NC', 'CY']
  };
  const REG16_NAMES = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'IP'];
  const SREG_NAMES = ['CS', 'DS', 'ES', 'SS'];

  const state = {
    mode: 'normal', // 'normal' | 'asm'
    cursorSeg: cpu.sreg.DS,
    cursorOff: 0,
    asmSeg: cpu.sreg.CS,
    asmOff: 0,
    started: false,
    active: false
  };

  const el = id => document.getElementById(id);
  const mainLayout = document.querySelector('main.layout');
  const bottomPanel = document.querySelector('.bottom-panel');
  const debugScreen = el('debugScreen');
  const debugOutput = el('debugOutput');
  const debugInput = el('debugInput');
  const debugPrompt = el('debugPrompt');
  const btnDebugMode = el('btnDebugMode');

  // ---------------------------------------------------------------
  // Utilidades de formato
  // ---------------------------------------------------------------
  function fmtHex16(v) { return (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
  function fmtHex8(v) { return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
  function fmtSegOff(seg, off) { return fmtHex16(seg) + ':' + fmtHex16(off); }

  function fmtRegLine1() {
    return ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI']
      .map(r => r + '=' + fmtHex16(cpu.getReg16(r))).join(' ');
  }
  function fmtFlags() {
    return FLAG_DISPLAY_ORDER.map(f => FLAG_LABELS[f][cpu.getFlag(f) ? 1 : 0]).join(' ');
  }
  function fmtRegLine2() {
    const segs = ['DS', 'ES', 'SS', 'CS'].map(r => r + '=' + fmtHex16(cpu.getSReg(r))).join(' ');
    return segs + ' IP=' + fmtHex16(cpu.getReg16('IP')) + '   ' + fmtFlags();
  }
  function fmtCurrentInstr() {
    const info = DECODER.decode(cpu);
    const bytesHex = info.bytes.map(fmtHex8).join('');
    return fmtSegOff(cpu.sreg.CS, cpu.reg.IP) + '  ' + bytesHex.padEnd(16, ' ') + '  ' + info.text;
  }
  function printState() { appendOutput(fmtRegLine1()); appendOutput(fmtRegLine2()); appendOutput(fmtCurrentInstr()); }

  // La consola simulada de DOS (INT 21h AH=02h/09h) va empujando texto a
  // cpu.output; acá lo volcamos a la pantalla de debug a medida que
  // aparece, sin el salto de línea automático de appendOutput (el propio
  // texto ya trae sus \r\n si el programa los imprimió).
  let outputCursor = 0;
  function flushCpuOutput() {
    while (outputCursor < cpu.output.length) {
      debugOutput.textContent += cpu.output[outputCursor];
      outputCursor++;
    }
    debugOutput.scrollTop = debugOutput.scrollHeight;
  }

  // ---------------------------------------------------------------
  // Parsing léxico (subset simplificado, números siempre en hex, sin
  // sufijo "h", como en el DEBUG.COM real)
  // ---------------------------------------------------------------
  function splitFirstToken(str) {
    const s = str.trim();
    const m = /^(\S+)\s*([\s\S]*)$/.exec(s);
    if (!m) return { head: '', rest: '' };
    return { head: m[1], rest: m[2] };
  }
  function splitOperands(str) {
    const parts = []; let cur = ''; let quote = null;
    for (const c of str) {
      if (quote) { cur += c; if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; cur += c; continue; }
      if (c === ',') { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts.map(s => s.trim()).filter(s => s.length);
  }
  function parseHex(tok) {
    const v = parseInt(tok, 16);
    if (Number.isNaN(v)) throw new Error('Valor hexadecimal inválido: ' + tok);
    return v;
  }
  function parseAddr(tok, defaultSeg) {
    const m = /^([0-9A-Fa-f]{1,4}):([0-9A-Fa-f]{1,4})$/.exec(tok);
    if (m) return { seg: parseInt(m[1], 16) & 0xFFFF, off: parseInt(m[2], 16) & 0xFFFF };
    if (/^[0-9A-Fa-f]{1,4}$/.test(tok)) return { seg: defaultSeg, off: parseInt(tok, 16) & 0xFFFF };
    throw new Error('Dirección inválida: ' + tok);
  }

  // ---------------------------------------------------------------
  // Comandos
  // ---------------------------------------------------------------
  function cmdRegisters(rest) {
    const parts = rest.trim() ? rest.trim().split(/\s+/) : [];
    if (parts.length === 0) { printState(); return; }
    const name = parts[0].toUpperCase();
    const isSeg = SREG_NAMES.includes(name);
    const isReg = REG16_NAMES.includes(name);
    if (!isSeg && !isReg) throw new Error('Registro desconocido: ' + parts[0]);
    if (parts.length === 1) {
      appendOutput(name + ' ' + fmtHex16(isSeg ? cpu.getSReg(name) : cpu.getReg16(name)));
      return;
    }
    const val = parseHex(parts[1]);
    if (isSeg) cpu.setSReg(name, val); else cpu.setReg16(name, val);
    appendOutput(name + ' ' + fmtHex16(val));
  }

  function cmdDump(rest) {
    const tokens = rest.trim() ? rest.trim().split(/\s+/) : [];
    let seg = state.cursorSeg, off = state.cursorOff, len = 128;
    if (tokens[0]) { const a = parseAddr(tokens[0], cpu.sreg.DS); seg = a.seg; off = a.off; }
    if (tokens[1] !== undefined) {
      const endOff = parseAddr(tokens[1], seg).off;
      len = ((endOff - off) & 0xFFFF) + 1;
    }
    let cur = off;
    for (let r = 0; r < Math.ceil(len / 16); r++) {
      const bytes = [];
      for (let i = 0; i < 16; i++) bytes.push(cpu.readByte(seg, (cur + i) & 0xFFFF));
      const hex = bytes.map(fmtHex8);
      const ascii = bytes.map(b => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join('');
      appendOutput(fmtSegOff(seg, cur) + '  ' + hex.slice(0, 8).join(' ') + '-' + hex.slice(8).join(' ') + '  ' + ascii);
      cur = (cur + 16) & 0xFFFF;
    }
    state.cursorSeg = seg; state.cursorOff = cur;
  }

  const MAX_UNASSEMBLE_INSTRUCTIONS = 2000;

  function cmdUnassemble(rest) {
    const tokens = rest.trim() ? rest.trim().split(/\s+/) : [];
    let seg = state.cursorSeg, off = state.cursorOff, endOff = null;
    if (tokens[0]) { const a = parseAddr(tokens[0], cpu.sreg.CS); seg = a.seg; off = a.off; }
    if (tokens[1] !== undefined) { endOff = parseAddr(tokens[1], seg).off; }
    const savedCS = cpu.sreg.CS, savedIP = cpu.reg.IP;
    cpu.sreg.CS = seg; cpu.reg.IP = off;
    try {
      for (let i = 0; endOff !== null ? cpu.reg.IP <= endOff : i < 10; i++) {
        if (i >= MAX_UNASSEMBLE_INSTRUCTIONS) { appendOutput('(detenido: rango demasiado largo)'); break; }
        const info = DECODER.decode(cpu);
        const bytesHex = info.bytes.map(fmtHex8).join('');
        appendOutput(fmtSegOff(seg, cpu.reg.IP) + '  ' + bytesHex.padEnd(16, ' ') + '  ' + info.text);
        cpu.reg.IP = (cpu.reg.IP + info.length) & 0xFFFF;
      }
      state.cursorSeg = seg; state.cursorOff = cpu.reg.IP;
    } finally {
      cpu.sreg.CS = savedCS; cpu.reg.IP = savedIP;
    }
  }

  // El comando "a" reusa el ensamblador general (js/assembler.js), que
  // sigue sintaxis MASM: un número es decimal salvo que lleve 0x/h/b. En
  // el DEBUG.COM real, en cambio, TODOS los números que se tipean en el
  // modo de ensamblado en línea son hexadecimales, sin sufijo. Por eso acá
  // reescribimos cada token numérico "pelado" (solo dígitos hex, sin 0x/h/b
  // ya puestos) a forma "0x..." antes de pasarlo al ensamblador, para que
  // "c" o "10" se interpreten como 0xC/0x10, tal como en DEBUG.COM.
  const ASM_KEYWORDS = new Set([
    ...REG16_NAMES, ...SREG_NAMES,
    'AL', 'AH', 'BL', 'BH', 'CL', 'CH', 'DL', 'DH',
    'BYTE', 'WORD', 'PTR'
  ]);
  function forceHexNumbers(operand) {
    let out = '';
    let i = 0;
    while (i < operand.length) {
      const c = operand[i];
      if (c === '"' || c === "'") {
        const q = c; let j = i + 1;
        while (j < operand.length && operand[j] !== q) j++;
        out += operand.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      const m = /^[0-9A-Za-z_]+/.exec(operand.slice(i));
      if (m) {
        const tok = m[0];
        if (!ASM_KEYWORDS.has(tok.toUpperCase()) && /^[0-9A-Fa-f]+$/.test(tok) && !/^0x/i.test(tok) && !/h$/i.test(tok)) {
          out += '0x' + tok;
        } else {
          out += tok;
        }
        i += tok.length;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  function cmdAssembleStart(rest) {
    let seg = state.cursorSeg, off = state.cursorOff;
    const tok = rest.trim();
    if (tok) { const a = parseAddr(tok, cpu.sreg.CS); seg = a.seg; off = a.off; }
    state.mode = 'asm';
    state.asmSeg = seg; state.asmOff = off;
  }

  function handleAsmLine(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
      state.mode = 'normal';
      state.cursorSeg = state.asmSeg; state.cursorOff = state.asmOff;
      return;
    }
    try {
      const { head, rest } = splitFirstToken(trimmed);
      let mnemonic = head.toUpperCase();
      let repPrefix = null;
      let operandsRaw;
      if (REP_PREFIXES[mnemonic] !== undefined) {
        repPrefix = REP_PREFIXES[mnemonic];
        const sub = splitFirstToken(rest);
        mnemonic = sub.head.toUpperCase();
        operandsRaw = splitOperands(sub.rest);
      } else {
        operandsRaw = splitOperands(rest);
      }
      operandsRaw = operandsRaw.map(forceHexNumbers);
      const here = (state.asmOff + (repPrefix !== null ? 1 : 0)) & 0xFFFF;
      let bytes = ASSEMBLER.encodeInstruction(mnemonic, operandsRaw, { symbols: {}, here, lenient: false });
      if (repPrefix !== null) bytes = [repPrefix, ...bytes];
      for (let i = 0; i < bytes.length; i++) cpu.writeByte(state.asmSeg, (state.asmOff + i) & 0xFFFF, bytes[i]);
      state.asmOff = (state.asmOff + bytes.length) & 0xFFFF;
    } catch (e) {
      appendOutput('Error: ' + e.message);
    }
  }

  function cmdTrace(rest) {
    const tok = rest.trim();
    const count = tok ? parseHex(tok) : 1;
    if (count <= 0) throw new Error('Cantidad inválida: ' + tok);
    for (let i = 0; i < count; i++) {
      if (cpu.halted) { appendOutput('CPU detenida (HLT).'); break; }
      engine.stepInstruction();
      flushCpuOutput();
      printState();
    }
  }

  function cmdGo(rest) {
    const tok = rest.trim();
    let bpPhys = null;
    if (tok) { const a = parseAddr(tok, cpu.sreg.CS); bpPhys = cpu.physicalAddress(a.seg, a.off); }
    let steps = 0, hitBreakpoint = false;
    while (steps < MAX_GO_STEPS) {
      if (cpu.halted) break;
      if (bpPhys !== null && cpu.physicalAddress(cpu.sreg.CS, cpu.reg.IP) === bpPhys) { hitBreakpoint = true; break; }
      engine.stepInstruction();
      flushCpuOutput();
      steps++;
    }
    if (steps >= MAX_GO_STEPS) appendOutput('(detenido: posible loop infinito tras ' + MAX_GO_STEPS + ' pasos)');
    else if (hitBreakpoint) appendOutput('Breakpoint alcanzado.');
    printState();
  }

  // Convierte la lista de bytes/strings de "e" en un array de valores 0-255.
  // Acepta bytes hex sueltos ("0D", "0A") y texto entre comillas simples o
  // dobres ("Hola", 'Hola'), cada carácter aporta un byte (su código ASCII).
  // No hace falta espacio entre una comilla de cierre y el siguiente token
  // (p. ej. "Hola"0D0A"$"), igual que en el E de DEBUG.COM real.
  function tokenizeEnterList(str) {
    const bytes = [];
    let i = 0;
    while (i < str.length) {
      const c = str[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'") {
        const q = c;
        let j = i + 1;
        while (j < str.length && str[j] !== q) j++;
        if (j >= str.length) throw new Error('Falta la comilla de cierre: ' + str.slice(i));
        for (const ch of str.slice(i + 1, j)) bytes.push(ch.charCodeAt(0) & 0xFF);
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < str.length && !/\s/.test(str[j]) && str[j] !== '"' && str[j] !== "'") j++;
      const run = str.slice(i, j);
      if (!/^[0-9A-Fa-f]+$/.test(run)) throw new Error('Valor hexadecimal inválido: ' + run);
      for (let k = 0; k < run.length; k += 2) bytes.push(parseInt(run.slice(k, k + 2), 16));
      i = j;
    }
    return bytes;
  }

  function cmdEnter(rest) {
    const trimmed = rest.trim();
    const { head, rest: listStr } = splitFirstToken(trimmed);
    if (!head || !listStr.trim()) throw new Error('Uso: e seg:off byte|"texto" [byte|"texto" ...]');
    const a = parseAddr(head, cpu.sreg.DS);
    const bytes = tokenizeEnterList(listStr);
    let off = a.off;
    for (const val of bytes) {
      cpu.writeByte(a.seg, off, val);
      off = (off + 1) & 0xFFFF;
    }
    state.cursorSeg = a.seg; state.cursorOff = off;
  }

  function cmdClear() {
    debugOutput.textContent = '';
  }

  function cmdReset() {
    cpu.reset();
    outputCursor = 0;
    state.mode = 'normal';
    state.cursorSeg = cpu.sreg.DS;
    state.cursorOff = 0;
    state.asmSeg = cpu.sreg.CS;
    state.asmOff = 0;
    appendOutput('CPU de debug reiniciada.');
  }

  function cmdHelp() {
    [
      'Comandos disponibles (direcciones y valores en hexadecimal):',
      '  r              muestra registros, flags e instrucción actual',
      '  r <reg>        muestra un registro (ax, bx, ..., ip, cs, ds, es, ss)',
      '  r <reg> <val>  fija el valor de un registro',
      '  d [dir] [fin]  vuelca memoria desde dir hasta fin (128 bytes si se omite fin); continúa donde quedó si no hay dir',
      '  u [dir] [fin]  desensambla desde dir hasta fin (10 instrucciones si se omite fin)',
      '  a [dir]        entra en modo ensamblado línea por línea; línea vacía sale',
      '  t [n]          ejecuta n instrucciones (1 por defecto) y muestra registros',
      '  g [dir]        corre hasta HLT o hasta llegar a la dirección (breakpoint)',
      '  e dir b|"txt" ...  escribe bytes hex y/o texto entre comillas en memoria (ej: e 102 "Hola"0D0A"$")',
      '  reset          reinicia la CPU de debug (registros, memoria y flags)',
      '  cls            limpia la pantalla (no toca CPU ni memoria)',
      '  q              vuelve al modo visual',
      '  ?              esta ayuda',
      'Direcciones: "seg:off" o solo "off" (usa el segmento por defecto del comando).',
      'Para ejecutar código recién ensamblado con "a", primero apuntá ahí con',
      '"r cs <seg>" y "r ip <off>", y después usá "t" o "g".'
    ].forEach(appendOutput);
  }

  function dispatchCommand(trimmed) {
    const { head, rest } = splitFirstToken(trimmed);
    const cmd = head.toLowerCase();
    switch (cmd) {
      case 'r': cmdRegisters(rest); break;
      case 'd': cmdDump(rest); break;
      case 'u': cmdUnassemble(rest); break;
      case 'a': cmdAssembleStart(rest); break;
      case 't': cmdTrace(rest); break;
      case 'g': cmdGo(rest); break;
      case 'e': cmdEnter(rest); break;
      case 'reset': cmdReset(); break;
      case 'cls': cmdClear(); break;
      case 'q': exitDebugMode(); break;
      case '?': case 'h': case 'help': cmdHelp(); break;
      default: appendOutput('Comando no reconocido: "' + cmd + '" (escribí ? para ayuda)');
    }
  }

  // ---------------------------------------------------------------
  // Terminal: salida, prompt y entrada
  // ---------------------------------------------------------------
  function appendOutput(line) {
    debugOutput.textContent += line + '\n';
    debugOutput.scrollTop = debugOutput.scrollHeight;
  }
  function promptText() {
    return state.mode === 'asm' ? fmtSegOff(state.asmSeg, state.asmOff) + ' ' : '-';
  }
  function updatePrompt() { debugPrompt.textContent = promptText(); }

  function processLine(raw) {
    appendOutput(promptText() + raw);
    if (state.mode === 'asm') {
      handleAsmLine(raw);
    } else {
      const trimmed = raw.trim();
      if (trimmed) {
        try { dispatchCommand(trimmed); }
        catch (e) { appendOutput('Error: ' + e.message); }
      }
    }
    updatePrompt();
  }

  debugInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const raw = debugInput.value;
    debugInput.value = '';
    processLine(raw);
  });

  // ---------------------------------------------------------------
  // Toggle de pantalla completa
  // ---------------------------------------------------------------
  function printBanner() {
    appendOutput('Simulador 80186 — modo DEBUG (estilo DOS DEBUG.COM)');
    appendOutput('Escribí ? para ver la lista de comandos.');
    appendOutput('');
  }
  function enterDebugMode() {
    if (state.active) return;
    state.active = true;
    mainLayout.hidden = true;
    bottomPanel.hidden = true;
    debugScreen.hidden = false;
    btnDebugMode.textContent = '↩ Volver al modo visual';
    if (!state.started) { printBanner(); state.started = true; }
    updatePrompt();
    debugInput.focus();
  }
  function exitDebugMode() {
    if (!state.active) return;
    state.active = false;
    mainLayout.hidden = false;
    bottomPanel.hidden = false;
    debugScreen.hidden = true;
    btnDebugMode.textContent = '🖥️ Modo Debug (DOS)';
  }
  function toggleDebugMode() { state.active ? exitDebugMode() : enterDebugMode(); }

  btnDebugMode.addEventListener('click', toggleDebugMode);
})();

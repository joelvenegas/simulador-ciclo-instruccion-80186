// assembler.js — Ensamblador de dos pasadas para el subset 8086/80186
// soportado por el simulador. Genera bytes reales (opcodes documentados
// del 8086, más extensiones propias del 80186 como PUSH imm16, IMUL de 3
// operandos, ENTER/LEAVE, PUSHA/POPA y shift/rotate con inmediato de 8 bits).
(function (global) {
  'use strict';
  const ISA = (typeof module !== 'undefined' && module.exports) ? require('./isa.js') : global.ISA;

  const SEG_PREFIX = { ES: 0x26, CS: 0x2E, SS: 0x36, DS: 0x3E };
  const STRING_OPS = {
    MOVSB: 0xA4, MOVSW: 0xA5, LODSB: 0xAC, LODSW: 0xAD, STOSB: 0xAA, STOSW: 0xAB,
    CMPSB: 0xA6, CMPSW: 0xA7, SCASB: 0xAE, SCASW: 0xAF
  };
  const MULDIV_REG = { MUL: 4, IMUL: 5, DIV: 6, IDIV: 7 };
  const REP_PREFIXES = { REP: 0xF3, REPE: 0xF3, REPZ: 0xF3, REPNE: 0xF2, REPNZ: 0xF2 };

  // ---------------------------------------------------------------------
  // Utilidades léxicas
  // ---------------------------------------------------------------------
  function stripComment(line) {
    let inQuote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) { if (c === inQuote) inQuote = null; continue; }
      if (c === '"' || c === "'") { inQuote = c; continue; }
      if (c === ';') return line.slice(0, i);
    }
    return line;
  }

  function splitTopLevel(str, sep) {
    const parts = [];
    let cur = '';
    let inQuote = null;
    for (const c of str) {
      if (inQuote) { cur += c; if (c === inQuote) inQuote = null; continue; }
      if (c === '"' || c === "'") { inQuote = c; cur += c; continue; }
      if (c === sep) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }

  function splitFirstToken(str) {
    const s = str.trim();
    const m = /^(\S+)\s*([\s\S]*)$/.exec(s);
    if (!m) return { head: '', restStr: '' };
    return { head: m[1], restStr: m[2] };
  }

  function isQuotedString(s) {
    return s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0];
  }
  function unquote(s) { return s.slice(1, -1); }

  function parseNumber(tokRaw) {
    if (tokRaw === undefined || tokRaw === null) return null;
    let s = String(tokRaw).trim();
    if (s === '') return null;
    let neg = false;
    if (s[0] === '+' || s[0] === '-') { neg = s[0] === '-'; s = s.slice(1).trim(); }
    let val = null;
    if (/^0x[0-9a-fA-F]+$/.test(s)) val = parseInt(s.slice(2), 16);
    else if (/^[0-9][0-9a-fA-F]*h$/i.test(s)) val = parseInt(s.slice(0, -1), 16);
    else if (/^[01]+b$/i.test(s)) val = parseInt(s.slice(0, -1), 2);
    else if (/^[0-9]+$/.test(s)) val = parseInt(s, 10);
    if (val === null || Number.isNaN(val)) return null;
    return neg ? -val : val;
  }

  function substituteEqu(text, equs) {
    const names = Object.keys(equs);
    if (names.length === 0) return text;
    const parts = [];
    let cur = ''; let inQuote = null;
    for (const c of text) {
      if (inQuote) {
        cur += c;
        if (c === inQuote) { parts.push({ q: true, text: cur }); cur = ''; inQuote = null; }
        continue;
      }
      if (c === '"' || c === "'") { if (cur) parts.push({ q: false, text: cur }); cur = c; inQuote = c; continue; }
      cur += c;
    }
    parts.push({ q: !!inQuote, text: cur });
    return parts.map(p => {
      if (p.q) return p.text;
      let t = p.text;
      for (const name of names) {
        const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        t = t.replace(re, String(equs[name]));
      }
      return t;
    }).join('');
  }

  function splitTerms(s) {
    s = s.trim();
    if (!s) return [];
    if (s[0] !== '+' && s[0] !== '-') s = '+' + s;
    const terms = [];
    const re = /[+-][^+-]+/g;
    let m;
    while ((m = re.exec(s))) terms.push(m[0].trim());
    return terms;
  }

  function findRM(baseRegs) {
    const key = baseRegs.slice().sort().join('+');
    const table = { 'BX+SI': 0, 'BX+DI': 1, 'BP+SI': 2, 'BP+DI': 3, SI: 4, DI: 5, BP: 6, BX: 7 };
    if (table[key] === undefined) throw new Error(`Combinación de registros no válida en operando de memoria: ${baseRegs.join('+')}`);
    return table[key];
  }

  // ---------------------------------------------------------------------
  // Parseo de operandos (independiente del valor de las etiquetas: sólo
  // determina la "forma" del operando, por eso el tamaño de instrucción
  // calculado en la pasada 1 coincide siempre con el de la pasada 2)
  // ---------------------------------------------------------------------
  function parseMemOperand(raw, sizeHint) {
    let s = raw.trim();
    let segOverride = null;
    let m = /^([A-Za-z]{2})\s*:\s*(\[[\s\S]*\])$/.exec(s);
    if (m && ISA.SREG_INDEX[m[1].toUpperCase()] !== undefined) { segOverride = m[1].toUpperCase(); s = m[2]; }
    m = /^\[([\s\S]*)\]$/.exec(s);
    if (!m) throw new Error(`Operando de memoria inválido: ${raw}`);
    let inner = m[1].trim();
    const m2 = /^([A-Za-z]{2})\s*:\s*([\s\S]+)$/.exec(inner);
    if (m2 && ISA.SREG_INDEX[m2[1].toUpperCase()] !== undefined) { segOverride = m2[1].toUpperCase(); inner = m2[2].trim(); }

    const terms = splitTerms(inner);
    if (terms.length === 0) throw new Error(`Operando de memoria vacío: ${raw}`);
    const baseRegs = [];
    let dispNumeric = 0;
    let dispSymbol = null;
    for (const term of terms) {
      const sign = term[0] === '-' ? -1 : 1;
      const body = term.slice(1).trim();
      const upper = body.toUpperCase();
      if (['BX', 'BP', 'SI', 'DI'].includes(upper)) {
        if (sign < 0) throw new Error(`No se puede restar un registro en un operando de memoria: ${raw}`);
        baseRegs.push(upper);
        continue;
      }
      const num = parseNumber(body);
      if (num !== null) { dispNumeric += sign * num; continue; }
      if (dispSymbol) throw new Error(`Sólo se admite un símbolo en el desplazamiento: ${raw}`);
      if (sign < 0) throw new Error(`No se puede restar una etiqueta en un operando de memoria: ${raw}`);
      dispSymbol = body;
    }
    if (baseRegs.length > 2) throw new Error(`Demasiados registros en el operando de memoria: ${raw}`);

    let mod, rmField;
    if (baseRegs.length === 0) {
      mod = 0; rmField = 6; // dirección directa: mod=00, rm=110 -> disp16 sin base
    } else {
      rmField = findRM(baseRegs);
      if (dispSymbol) mod = 2;
      else if (rmField === 6 && dispNumeric === 0) mod = 1; // [BP] sin disp -> forzar disp8=0 (evita choque con dirección directa)
      else if (dispNumeric === 0) mod = 0;
      else if (dispNumeric >= -128 && dispNumeric <= 127) mod = 1;
      else mod = 2;
    }
    const dispByteCount = (baseRegs.length === 0) ? 2 : (mod === 0 ? 0 : (mod === 1 ? 1 : 2));

    return {
      kind: 'mem', raw, segOverride, mod, rmField, dispByteCount,
      dispNumeric, dispSymbol, sizeHint: sizeHint || null, baseRegs
    };
  }

  function parseOperand(rawIn) {
    const raw = rawIn;
    let s = raw.trim();
    let sizeHint = null;
    let m = /^(BYTE|WORD)\s+(?:PTR\s+)?([\s\S]+)$/i.exec(s);
    if (m) { sizeHint = m[1].toUpperCase(); s = m[2].trim(); }
    const upper = s.toUpperCase();
    if (ISA.REG16_INDEX[upper] !== undefined) return { kind: 'reg16', name: upper, index: ISA.REG16_INDEX[upper] };
    if (ISA.REG8_INDEX[upper] !== undefined) return { kind: 'reg8', name: upper, index: ISA.REG8_INDEX[upper] };
    if (ISA.SREG_INDEX[upper] !== undefined) return { kind: 'sreg', name: upper, index: ISA.SREG_INDEX[upper] };
    if (/^\[[\s\S]*\]$/.test(s) || /^[A-Za-z]{2}\s*:\s*\[[\s\S]*\]$/i.test(s)) return parseMemOperand(s, sizeHint);
    if (isQuotedString(s)) {
      const str = unquote(s);
      if (str.length !== 1) throw new Error(`Se esperaba un único carácter entre comillas: ${raw}`);
      return { kind: 'imm', value: str.charCodeAt(0), symbol: null };
    }
    const num = parseNumber(s);
    if (num !== null) return { kind: 'imm', value: num, symbol: null };
    if (/^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(s)) return { kind: 'imm', value: null, symbol: s };
    throw new Error(`Operando no reconocido: ${raw}`);
  }

  function resolveSymbol(name, ctx) {
    const key = name.toUpperCase();
    if (ctx.symbols && Object.prototype.hasOwnProperty.call(ctx.symbols, key)) return ctx.symbols[key];
    if (ctx.lenient) return 0;
    throw new Error(`Etiqueta o símbolo no definido: ${name}`);
  }
  function resolveOperandValue(op, ctx) {
    if (op.value !== null && op.value !== undefined) return op.value;
    return resolveSymbol(op.symbol, ctx);
  }

  function modrmByte(mod, reg, rm) { return ((mod & 3) << 6) | ((reg & 7) << 3) | (rm & 7); }

  function encodeRM(rm, regField, ctx) {
    if (rm.kind === 'reg16' || rm.kind === 'reg8') {
      return { prefix: null, bytes: [modrmByte(3, regField, rm.index)] };
    }
    if (rm.kind !== 'mem') throw new Error('Se esperaba un registro o un operando de memoria');
    const prefix = rm.segOverride ? SEG_PREFIX[rm.segOverride] : null;
    const bytes = [modrmByte(rm.mod, regField, rm.rmField)];
    if (rm.dispByteCount > 0) {
      let disp = rm.dispNumeric;
      if (rm.dispSymbol) disp += resolveSymbol(rm.dispSymbol, ctx);
      if (rm.dispByteCount === 1) bytes.push(disp & 0xFF);
      else bytes.push(disp & 0xFF, (disp >> 8) & 0xFF);
    }
    return { prefix, bytes };
  }
  function withPrefix(prefix, bytes) { return prefix !== null && prefix !== undefined ? [prefix, ...bytes] : bytes; }

  function sizeOfMemOrReg(op, mnemonicForError) {
    if (op.kind === 'reg8') return 8;
    if (op.kind === 'reg16') return 16;
    if (op.kind === 'mem') {
      if (op.sizeHint === 'BYTE') return 8;
      if (op.sizeHint === 'WORD') return 16;
      throw new Error(`Especificá BYTE o WORD para "${mnemonicForError}" con destino de memoria`);
    }
    throw new Error(`Operando inválido para ${mnemonicForError}`);
  }

  // ---------------------------------------------------------------------
  // Codificadores por grupo de instrucciones
  // ---------------------------------------------------------------------
  function encodeAlu(mnemonic, ops, ctx) {
    if (ops.length !== 2) throw new Error(`${mnemonic} requiere 2 operandos`);
    const info = ISA.ALU_OPS[mnemonic];
    const [dst, src] = ops;
    if ((dst.kind === 'reg16' || dst.kind === 'reg8') && (src.kind === 'reg16' || src.kind === 'reg8' || src.kind === 'mem')) {
      const size = dst.kind === 'reg16' ? 16 : 8;
      const opcode = info.base + (size === 16 ? 3 : 2);
      const { prefix, bytes } = encodeRM(src, dst.index, ctx);
      return withPrefix(prefix, [opcode, ...bytes]);
    }
    if (dst.kind === 'mem' && (src.kind === 'reg16' || src.kind === 'reg8')) {
      const size = src.kind === 'reg16' ? 16 : 8;
      const opcode = info.base + (size === 16 ? 1 : 0);
      const { prefix, bytes } = encodeRM(dst, src.index, ctx);
      return withPrefix(prefix, [opcode, ...bytes]);
    }
    throw new Error(`Combinación de operandos no soportada para ${mnemonic}`);
  }

  function encodeAluImm(mnemonic, dst, srcImmOp, ctx) {
    const info = ISA.ALU_OPS[mnemonic];
    const size = sizeOfMemOrReg(dst, mnemonic);
    const opcode = size === 16 ? 0x81 : 0x80;
    const val = resolveOperandValue(srcImmOp, ctx);
    const { prefix, bytes } = encodeRM(dst, info.immReg, ctx);
    const imm = size === 16 ? [val & 0xFF, (val >> 8) & 0xFF] : [val & 0xFF];
    return withPrefix(prefix, [opcode, ...bytes, ...imm]);
  }

  function encodeMov(ops, ctx) {
    if (ops.length !== 2) throw new Error('MOV requiere 2 operandos');
    const [dst, src] = ops;
    if (dst.kind === 'sreg' && src.kind === 'reg16') { const { prefix, bytes } = encodeRM(src, dst.index, ctx); return withPrefix(prefix, [0x8E, ...bytes]); }
    if (dst.kind === 'reg16' && src.kind === 'sreg') { const { prefix, bytes } = encodeRM(dst, src.index, ctx); return withPrefix(prefix, [0x8C, ...bytes]); }
    if (dst.kind === 'sreg' || src.kind === 'sreg') throw new Error('Combinación inválida de MOV con registro de segmento (sólo MOV sreg,r16 y MOV r16,sreg)');
    if ((dst.kind === 'reg16' || dst.kind === 'reg8') && src.kind === 'imm') {
      const val = resolveOperandValue(src, ctx);
      if (dst.kind === 'reg16') return [0xB8 + dst.index, val & 0xFF, (val >> 8) & 0xFF];
      return [0xB0 + dst.index, val & 0xFF];
    }
    if (dst.kind === 'mem' && src.kind === 'imm') {
      const size = sizeOfMemOrReg(dst, 'MOV');
      const opcode = size === 16 ? 0xC7 : 0xC6;
      const val = resolveOperandValue(src, ctx);
      const { prefix, bytes } = encodeRM(dst, 0, ctx);
      const imm = size === 16 ? [val & 0xFF, (val >> 8) & 0xFF] : [val & 0xFF];
      return withPrefix(prefix, [opcode, ...bytes, ...imm]);
    }
    if ((dst.kind === 'reg16' || dst.kind === 'reg8') && (src.kind === 'reg16' || src.kind === 'reg8' || src.kind === 'mem')) {
      const size = dst.kind === 'reg16' ? 16 : 8;
      const opcode = size === 16 ? 0x8B : 0x8A;
      const { prefix, bytes } = encodeRM(src, dst.index, ctx);
      return withPrefix(prefix, [opcode, ...bytes]);
    }
    if (dst.kind === 'mem' && (src.kind === 'reg16' || src.kind === 'reg8')) {
      const size = src.kind === 'reg16' ? 16 : 8;
      const opcode = size === 16 ? 0x89 : 0x88;
      const { prefix, bytes } = encodeRM(dst, src.index, ctx);
      return withPrefix(prefix, [opcode, ...bytes]);
    }
    throw new Error('Combinación de operandos no soportada para MOV');
  }

  function encodeIncDec(mnemonic, ops, ctx) {
    if (ops.length !== 1) throw new Error(`${mnemonic} requiere 1 operando`);
    const op = ops[0];
    if (op.kind === 'reg16') return [(mnemonic === 'INC' ? 0x40 : 0x48) + op.index];
    if (op.kind === 'reg8' || op.kind === 'mem') {
      const size = sizeOfMemOrReg(op, mnemonic);
      const opcode = size === 16 ? 0xFF : 0xFE;
      const regField = mnemonic === 'INC' ? 0 : 1;
      const { prefix, bytes } = encodeRM(op, regField, ctx);
      return withPrefix(prefix, [opcode, ...bytes]);
    }
    throw new Error(`Operando inválido para ${mnemonic}`);
  }

  function encodeJmp(ops, ctx) {
    if (ops.length !== 1) throw new Error('JMP requiere 1 operando (etiqueta)');
    const target = resolveOperandValue(ops[0], ctx);
    const rel = (target - (ctx.here + 3)) & 0xFFFF;
    return [0xE9, rel & 0xFF, (rel >> 8) & 0xFF];
  }
  function encodeCall(ops, ctx) {
    if (ops.length !== 1) throw new Error('CALL requiere 1 operando (etiqueta)');
    const target = resolveOperandValue(ops[0], ctx);
    const rel = (target - (ctx.here + 3)) & 0xFFFF;
    return [0xE8, rel & 0xFF, (rel >> 8) & 0xFF];
  }
  function encodeRet(ops, ctx) {
    if (ops.length === 0) return [0xC3];
    if (ops.length === 1) { const val = resolveOperandValue(ops[0], ctx); return [0xC2, val & 0xFF, (val >> 8) & 0xFF]; }
    throw new Error('RET admite 0 o 1 operandos');
  }
  function encodeJcc(mnemonic, ops, ctx) { return encodeShortJump(ISA.JCC[mnemonic], ops, ctx, mnemonic); }
  function encodeShortJump(opcode, ops, ctx, mnemonic) {
    if (ops.length !== 1) throw new Error(`${mnemonic} requiere 1 operando (etiqueta)`);
    const target = resolveOperandValue(ops[0], ctx);
    const rel = target - (ctx.here + 2);
    if (!ctx.lenient && (rel < -128 || rel > 127)) {
      throw new Error(`${mnemonic}: el destino está demasiado lejos para un salto corto (${rel} bytes). Invertí la condición y usá JMP para saltos largos.`);
    }
    return [opcode, rel & 0xFF];
  }

  function encodePush(ops, ctx) {
    if (ops.length !== 1) throw new Error('PUSH requiere 1 operando');
    const op = ops[0];
    if (op.kind === 'reg16') return [0x50 + op.index];
    if (op.kind === 'sreg') {
      const table = { ES: 0x06, CS: 0x0E, SS: 0x16, DS: 0x1E };
      return [table[op.name]];
    }
    if (op.kind === 'imm') { const val = resolveOperandValue(op, ctx); return [0x68, val & 0xFF, (val >> 8) & 0xFF]; }
    throw new Error('PUSH sólo admite un registro de 16 bits, un registro de segmento o un inmediato');
  }
  function encodePop(ops, ctx) {
    if (ops.length !== 1) throw new Error('POP requiere 1 operando');
    const op = ops[0];
    if (op.kind === 'reg16') return [0x58 + op.index];
    if (op.kind === 'sreg') {
      const table = { ES: 0x07, SS: 0x17, DS: 0x1F };
      if (!(op.name in table)) throw new Error('No se puede hacer POP sobre CS');
      return [table[op.name]];
    }
    throw new Error('POP sólo admite un registro de 16 bits o un registro de segmento (excepto CS)');
  }

  function encodeMulDiv(mnemonic, ops, ctx) {
    if (mnemonic === 'IMUL' && ops.length === 3) return encodeImul3(ops, ctx);
    if (ops.length !== 1) throw new Error(`${mnemonic} requiere 1 operando`);
    const op = ops[0];
    const size = sizeOfMemOrReg(op, mnemonic);
    const opcode = size === 16 ? 0xF7 : 0xF6;
    const { prefix, bytes } = encodeRM(op, MULDIV_REG[mnemonic], ctx);
    return withPrefix(prefix, [opcode, ...bytes]);
  }
  function encodeImul3(ops, ctx) {
    const [dst, src, imm] = ops;
    if (dst.kind !== 'reg16') throw new Error('IMUL de 3 operandos requiere un registro de 16 bits como destino');
    if (imm.kind !== 'imm') throw new Error('IMUL de 3 operandos requiere un inmediato como tercer operando');
    const val = resolveOperandValue(imm, ctx);
    const { prefix, bytes } = encodeRM(src, dst.index, ctx);
    return withPrefix(prefix, [0x69, ...bytes, val & 0xFF, (val >> 8) & 0xFF]);
  }

  function encodeShift(mnemonic, ops, ctx) {
    const regField = ISA.SHIFT_OPS[mnemonic];
    if (ops.length < 1 || ops.length > 2) throw new Error(`${mnemonic} requiere 1 o 2 operandos`);
    const dst = ops[0];
    const size = sizeOfMemOrReg(dst, mnemonic);
    const count = ops.length === 2 ? ops[1] : { kind: 'imm', value: 1, symbol: null };
    if (count.kind === 'reg8' && count.name === 'CL') {
      const opcode = size === 16 ? 0xD3 : 0xD2;
      const { prefix, bytes } = encodeRM(dst, regField, ctx);
      return withPrefix(prefix, [opcode, ...bytes]);
    }
    if (count.kind === 'imm') {
      const val = resolveOperandValue(count, ctx);
      if (val === 1) {
        const opcode = size === 16 ? 0xD1 : 0xD0;
        const { prefix, bytes } = encodeRM(dst, regField, ctx);
        return withPrefix(prefix, [opcode, ...bytes]);
      }
      // Forma con inmediato de 8 bits: extensión propia del 80186 (en el
      // 8086 original había que repetir shifts de a 1).
      const opcode = size === 16 ? 0xC1 : 0xC0;
      const { prefix, bytes } = encodeRM(dst, regField, ctx);
      return withPrefix(prefix, [opcode, ...bytes, val & 0xFF]);
    }
    throw new Error(`Segundo operando inválido para ${mnemonic}: se espera 1, CL o un inmediato`);
  }

  function encodeStringOp(mnemonic, ops) {
    if (ops.length !== 0) throw new Error(`${mnemonic} no admite operandos (usa SI/DI/CX implícitos)`);
    return [STRING_OPS[mnemonic]];
  }

  function encodeEnter(ops, ctx) {
    if (ops.length !== 2) throw new Error('ENTER requiere 2 operandos: tamaño_local, nivel');
    const size = resolveOperandValue(ops[0], ctx);
    const level = resolveOperandValue(ops[1], ctx);
    return [0xC8, size & 0xFF, (size >> 8) & 0xFF, level & 0xFF];
  }

  function writeDataUnit(image, offset, val, size) {
    image[offset & 0xFFFF] = val & 0xFF;
    if (size === 2) image[(offset + 1) & 0xFFFF] = (val >> 8) & 0xFF;
  }

  // ---------------------------------------------------------------------
  // Despachador principal de instrucciones
  // ---------------------------------------------------------------------
  function encodeInstruction(mnemonicIn, operandsRaw, ctx) {
    const mnemonic = mnemonicIn.toUpperCase();
    const ops = operandsRaw.map(parseOperand);
    if (ISA.ALU_OPS[mnemonic]) {
      if (ops.length !== 2) throw new Error(`${mnemonic} requiere 2 operandos`);
      if (ops[1].kind === 'imm') return encodeAluImm(mnemonic, ops[0], ops[1], ctx);
      return encodeAlu(mnemonic, ops, ctx);
    }
    switch (mnemonic) {
      case 'MOV': return encodeMov(ops, ctx);
      case 'INC': case 'DEC': return encodeIncDec(mnemonic, ops, ctx);
      case 'JMP': return encodeJmp(ops, ctx);
      case 'LOOP': return encodeShortJump(0xE2, ops, ctx, mnemonic);
      case 'LOOPE': case 'LOOPZ': return encodeShortJump(0xE1, ops, ctx, mnemonic);
      case 'LOOPNE': case 'LOOPNZ': return encodeShortJump(0xE0, ops, ctx, mnemonic);
      case 'JCXZ': return encodeShortJump(0xE3, ops, ctx, mnemonic);
      case 'PUSH': return encodePush(ops, ctx);
      case 'POP': return encodePop(ops, ctx);
      case 'CALL': return encodeCall(ops, ctx);
      case 'RET': return encodeRet(ops, ctx);
      case 'INT': {
        if (ops.length !== 1) throw new Error('INT requiere 1 operando');
        const v = resolveOperandValue(ops[0], ctx);
        return [0xCD, v & 0xFF];
      }
      case 'HLT': return [0xF4];
      case 'NOP': return [0x90];
      case 'CBW': return [0x98];
      case 'CWD': return [0x99];
      case 'PUSHA': return [0x60];
      case 'POPA': return [0x61];
      case 'CLD': return [0xFC];
      case 'STD': return [0xFD];
      case 'CLI': return [0xFA];
      case 'STI': return [0xFB];
      case 'MUL': case 'IMUL': case 'DIV': case 'IDIV': return encodeMulDiv(mnemonic, ops, ctx);
      case 'ENTER': return encodeEnter(ops, ctx);
      case 'LEAVE': return [0xC9];
      default:
        if (ISA.JCC[mnemonic] !== undefined) return encodeJcc(mnemonic, ops, ctx);
        if (ISA.SHIFT_OPS[mnemonic] !== undefined) return encodeShift(mnemonic, ops, ctx);
        if (STRING_OPS[mnemonic] !== undefined) return encodeStringOp(mnemonic, ops);
        throw new Error(`Instrucción no reconocida: ${mnemonicIn}`);
    }
  }

  // ---------------------------------------------------------------------
  // Ensamblador de dos pasadas
  // ---------------------------------------------------------------------
  function assemble(source) {
    const errors = [];
    const rawLines = source.split(/\r\n|\r|\n/);
    const lines = [];
    const equs = {};

    rawLines.forEach((rawLine, idx) => {
      const lineNum = idx + 1;
      let line = stripComment(rawLine);
      if (!line.trim()) return;
      let label = null;
      const m = /^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:([\s\S]*)$/.exec(line);
      if (m) { label = m[1]; line = m[2]; }
      else {
        // Convención habitual en 8086: una etiqueta de datos puede omitir
        // los dos puntos cuando va seguida de DB/DW (p. ej. "msg db 'hola'").
        const m3 = /^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s+(DB|DW)\b([\s\S]*)$/i.exec(line);
        if (m3) { label = m3[1]; line = m3[2] + m3[3]; }
      }
      const trimmed = line.trim();
      if (!trimmed) { if (label) lines.push({ lineNum, label, text: null }); return; }
      const eqm = /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s+EQU\s+([\s\S]+)$/i.exec(trimmed);
      if (eqm && !label) {
        const val = parseNumber(eqm[2].trim());
        if (val === null) { errors.push({ line: lineNum, message: `EQU con valor no numérico: ${eqm[2]}` }); return; }
        equs[eqm[1].toUpperCase()] = val;
        return;
      }
      lines.push({ lineNum, label, text: trimmed });
    });
    if (errors.length) return { ok: false, errors };

    lines.forEach(l => { if (l.text) l.text = substituteEqu(l.text, equs); });

    lines.forEach(l => {
      if (!l.text) { l.kind = 'label-only'; return; }
      const parts = splitFirstToken(l.text);
      const head = parts.head.toUpperCase();
      if (head === 'ORG') { l.kind = 'org'; l.value = parseNumber(parts.restStr.trim()); return; }
      if (head === 'DB' || head === 'DW') {
        l.kind = 'data'; l.dataSize = head === 'DB' ? 1 : 2;
        l.items = parts.restStr.trim() ? splitTopLevel(parts.restStr, ',').map(s => s.trim()).filter(s => s.length) : [];
        return;
      }
      if (REP_PREFIXES[head] !== undefined) {
        const sub = splitFirstToken(parts.restStr);
        l.kind = 'instr';
        l.repPrefix = REP_PREFIXES[head];
        l.mnemonic = sub.head.toUpperCase();
        l.operandsRaw = sub.restStr.trim() ? splitTopLevel(sub.restStr, ',').map(s => s.trim()) : [];
        return;
      }
      l.kind = 'instr';
      l.mnemonic = head;
      l.operandsRaw = parts.restStr.trim() ? splitTopLevel(parts.restStr, ',').map(s => s.trim()) : [];
    });

    // Pasada 1: direcciones de etiquetas + tamaño de cada línea
    const symbols = {};
    let address = 0;
    let startAddress = null;
    lines.forEach(l => {
      if (l.kind === 'org') { address = l.value; if (startAddress === null) startAddress = l.value; return; }
      if (l.label) {
        const key = l.label.toUpperCase();
        if (symbols[key] !== undefined) errors.push({ line: l.lineNum, message: `Etiqueta duplicada: ${l.label}` });
        symbols[key] = address;
      }
      if (l.kind === 'label-only') return;
      if (l.kind === 'data') {
        let size = 0;
        l.items.forEach(item => { size += isQuotedString(item) ? unquote(item).length * l.dataSize : l.dataSize; });
        l.size = size; l.address = address; address += size; return;
      }
      if (l.kind === 'instr') {
        let size = 0;
        try {
          let bytes = encodeInstruction(l.mnemonic, l.operandsRaw, { symbols: {}, here: address, lenient: true });
          if (l.repPrefix) bytes = [l.repPrefix, ...bytes];
          size = bytes.length;
        } catch (e) { errors.push({ line: l.lineNum, message: e.message }); size = 0; }
        l.size = size; l.address = address; address += size;
      }
    });
    if (startAddress === null) startAddress = 0;
    if (errors.length) return { ok: false, errors };

    // Pasada 2: codificación final con símbolos resueltos
    const image = new Uint8Array(0x10000);
    const listing = [];
    lines.forEach(l => {
      if (l.kind === 'org' || l.kind === 'label-only') return;
      if (l.kind === 'data') {
        let off = l.address;
        l.items.forEach(item => {
          if (isQuotedString(item)) {
            const str = unquote(item);
            for (const ch of str) { writeDataUnit(image, off, ch.charCodeAt(0), l.dataSize); off += l.dataSize; }
          } else {
            let val;
            const num = parseNumber(item);
            if (num !== null) val = num;
            else {
              const key = item.toUpperCase();
              if (symbols[key] === undefined) { errors.push({ line: l.lineNum, message: `Símbolo no definido: ${item}` }); val = 0; }
              else val = symbols[key];
            }
            writeDataUnit(image, off, val, l.dataSize); off += l.dataSize;
          }
        });
        listing.push({ line: l.lineNum, address: l.address, bytes: Array.from(image.slice(l.address, off)), text: (l.label ? l.label + ': ' : '') + (l.dataSize === 1 ? 'DB' : 'DW') + ' ' + l.items.join(', ') });
        return;
      }
      if (l.kind === 'instr') {
        let bytes;
        try {
          bytes = encodeInstruction(l.mnemonic, l.operandsRaw, { symbols, here: l.address + (l.repPrefix ? 1 : 0), lenient: false });
          if (l.repPrefix) bytes = [l.repPrefix, ...bytes];
        } catch (e) {
          errors.push({ line: l.lineNum, message: e.message });
          bytes = new Array(l.size).fill(0x90);
        }
        if (bytes.length !== l.size) {
          errors.push({ line: l.lineNum, message: `Error interno de ensamblado: tamaño esperado ${l.size}, obtenido ${bytes.length} en "${l.mnemonic}"` });
        }
        for (let i = 0; i < bytes.length; i++) image[(l.address + i) & 0xFFFF] = bytes[i] & 0xFF;
        const mnemText = (l.repPrefix ? (l.repPrefix === 0xF3 ? 'REP ' : 'REPNE ') : '') + l.mnemonic + (l.operandsRaw.length ? ' ' + l.operandsRaw.join(', ') : '');
        listing.push({ line: l.lineNum, address: l.address, bytes, text: (l.label ? l.label + ': ' : '') + mnemText });
      }
    });

    if (errors.length) return { ok: false, errors };
    return { ok: true, image, orgAddress: startAddress & 0xFFFF, symbols, listing, length: address };
  }

  const ASSEMBLER = { assemble, parseOperand, encodeInstruction, parseNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = ASSEMBLER;
  else global.ASSEMBLER = ASSEMBLER;
})(typeof window !== 'undefined' ? window : globalThis);

// decoder.js — Decodificador: lee bytes desde CS:IP (fetch) e interpreta su
// significado (decode). Es la contraparte "inversa" de assembler.js: usa
// las mismas tablas de isa.js para reconocer los opcodes que el ensamblador
// genera. No muta el estado de la CPU (sólo lee memoria).
(function (global) {
  'use strict';
  const ISA = (typeof module !== 'undefined' && module.exports) ? require('./isa.js') : global.ISA;

  const SEG_PREFIX_BYTES = { 0x26: 'ES', 0x2E: 'CS', 0x36: 'SS', 0x3E: 'DS' };
  const STRING_MAP = {
    0xA4: 'MOVSB', 0xA5: 'MOVSW', 0xAC: 'LODSB', 0xAD: 'LODSW',
    0xAA: 'STOSB', 0xAB: 'STOSW', 0xA6: 'CMPSB', 0xA7: 'CMPSW', 0xAE: 'SCASB', 0xAF: 'SCASW'
  };

  function signed8(v) { return (v & 0x80) ? v - 256 : v; }
  function signed16(v) { return (v & 0x8000) ? v - 0x10000 : v; }

  function matchAluOp(opcode) {
    for (const mnemonic in ISA.ALU_OPS) {
      const base = ISA.ALU_OPS[mnemonic].base;
      const diff = opcode - base;
      if (diff >= 0 && diff <= 3) return { mnemonic, variant: diff };
    }
    return null;
  }

  function regName(size, idx) { return size === 16 ? ISA.REG16[idx] : ISA.REG8[idx]; }

  function operandText(op) {
    if (!op) return '';
    if (op.type === 'reg' || op.type === 'sreg') return op.name;
    if (op.type === 'imm') {
      const v = op.value & 0xFFFF;
      return '0x' + v.toString(16).toUpperCase().padStart(v > 0xFF ? 4 : 2, '0');
    }
    if (op.type === 'mem') {
      let inner;
      if (op.direct) inner = '0x' + (op.disp & 0xFFFF).toString(16).toUpperCase();
      else {
        inner = op.baseRegs.join('+');
        if (op.disp) inner += (op.disp >= 0 ? '+' : '') + op.disp;
      }
      return op.segReg + ':[' + inner + ']';
    }
    return '?';
  }

  function formatInstruction(info) {
    let out = info.mnemonic;
    if (info.rel !== undefined) { out += ` ${info.rel >= 0 ? '+' : ''}${info.rel}`; return out; }
    if (info.mnemonic === 'INT') return out + ' ' + info.imm.toString(16).toUpperCase() + 'h';
    if (info.mnemonic === 'RET') return out + (info.imm ? ' ' + info.imm : '');
    if (info.mnemonic === 'ENTER') return out + ` ${info.enterSize}, ${info.enterLevel}`;
    const parts = [];
    if (info.dst) parts.push(operandText(info.dst));
    if (info.src) parts.push(operandText(info.src));
    if (info.mnemonic === 'IMUL3') parts.push('0x' + (info.imm & 0xFFFF).toString(16).toUpperCase());
    if (parts.length) out += ' ' + parts.join(', ');
    return out;
  }

  // Decodifica UNA instrucción a partir de CS:IP. No modifica la CPU.
  function decode(cpu) {
    const seg = cpu.sreg.CS;
    const startOffset = cpu.reg.IP;
    let ptr = startOffset;
    const bytesRead = [];
    function fetch8() { const b = cpu.readByte(seg, ptr); bytesRead.push(b); ptr = (ptr + 1) & 0xFFFF; return b; }
    function fetch16() { const lo = fetch8(); const hi = fetch8(); return (hi << 8) | lo; }

    let segOverride = null;
    let repPrefix = null;
    let opcode = fetch8();
    while (SEG_PREFIX_BYTES[opcode] || opcode === 0xF2 || opcode === 0xF3) {
      if (opcode === 0xF3) repPrefix = 'REP';
      else if (opcode === 0xF2) repPrefix = 'REPNE';
      else segOverride = SEG_PREFIX_BYTES[opcode];
      opcode = fetch8();
    }

    function readModRM() {
      const b = fetch8();
      const mod = (b >> 6) & 3, reg = (b >> 3) & 7, rm = b & 7;
      let mem = null;
      if (mod !== 3) {
        let direct = false, baseRegs;
        if (mod === 0 && rm === 6) { direct = true; baseRegs = []; }
        else baseRegs = ISA.RM_TABLE[rm].filter(Boolean);
        let disp = 0;
        if (direct) disp = fetch16();
        else if (mod === 1) disp = signed8(fetch8());
        else if (mod === 2) disp = fetch16();
        mem = { direct, baseRegs, disp, segOverride };
      }
      return { mod, reg, rm, mem };
    }
    function rmOperand(m, size) {
      if (m.mod === 3) return { type: 'reg', name: regName(size, m.rm) };
      const segReg = m.mem.segOverride || (m.mem.baseRegs.includes('BP') ? 'SS' : 'DS');
      return { type: 'mem', baseRegs: m.mem.baseRegs, disp: m.mem.disp, direct: m.mem.direct, segReg, size };
    }
    function regOperand(m, size) { return { type: 'reg', name: regName(size, m.reg) }; }

    function finalize(info) {
      const length = (ptr - startOffset + 0x10000) % 0x10000;
      const full = Object.assign(
        { length, bytes: bytesRead.slice(), repPrefix, segOverride, physStart: cpu.physicalAddress(seg, startOffset), startOffset },
        info
      );
      full.text = formatInstruction(full);
      return full;
    }

    const aluMatch = matchAluOp(opcode);
    if (aluMatch) {
      const size = (aluMatch.variant === 0 || aluMatch.variant === 2) ? 8 : 16;
      const m = readModRM();
      let dst, src;
      if (aluMatch.variant === 0 || aluMatch.variant === 1) { dst = rmOperand(m, size); src = regOperand(m, size); }
      else { dst = regOperand(m, size); src = rmOperand(m, size); }
      return finalize({ mnemonic: aluMatch.mnemonic, size, dst, src });
    }

    if (opcode === 0x80 || opcode === 0x81) {
      const size = opcode === 0x81 ? 16 : 8;
      const m = readModRM();
      const map = { 0: 'ADD', 1: 'OR', 4: 'AND', 5: 'SUB', 6: 'XOR', 7: 'CMP' };
      const mnemonic = map[m.reg] || ('GRP1_' + m.reg);
      const dst = rmOperand(m, size);
      const val = size === 16 ? fetch16() : fetch8();
      return finalize({ mnemonic, size, dst, src: { type: 'imm', value: val } });
    }

    if (opcode === 0x88 || opcode === 0x89 || opcode === 0x8A || opcode === 0x8B) {
      const size = (opcode === 0x89 || opcode === 0x8B) ? 16 : 8;
      const m = readModRM();
      let dst, src;
      if (opcode === 0x88 || opcode === 0x89) { dst = rmOperand(m, size); src = regOperand(m, size); }
      else { dst = regOperand(m, size); src = rmOperand(m, size); }
      return finalize({ mnemonic: 'MOV', size, dst, src });
    }
    if (opcode === 0x8C) { const m = readModRM(); return finalize({ mnemonic: 'MOV', size: 16, dst: rmOperand(m, 16), src: { type: 'sreg', name: ISA.SREG[m.reg] } }); }
    if (opcode === 0x8E) { const m = readModRM(); return finalize({ mnemonic: 'MOV', size: 16, dst: { type: 'sreg', name: ISA.SREG[m.reg] }, src: rmOperand(m, 16) }); }
    if (opcode >= 0xB0 && opcode <= 0xB7) { const val = fetch8(); return finalize({ mnemonic: 'MOV', size: 8, dst: { type: 'reg', name: ISA.REG8[opcode - 0xB0] }, src: { type: 'imm', value: val } }); }
    if (opcode >= 0xB8 && opcode <= 0xBF) { const val = fetch16(); return finalize({ mnemonic: 'MOV', size: 16, dst: { type: 'reg', name: ISA.REG16[opcode - 0xB8] }, src: { type: 'imm', value: val } }); }
    if (opcode === 0xC6 || opcode === 0xC7) {
      const size = opcode === 0xC7 ? 16 : 8;
      const m = readModRM();
      const dst = rmOperand(m, size);
      const val = size === 16 ? fetch16() : fetch8();
      return finalize({ mnemonic: 'MOV', size, dst, src: { type: 'imm', value: val } });
    }

    if (opcode >= 0x40 && opcode <= 0x47) return finalize({ mnemonic: 'INC', size: 16, dst: { type: 'reg', name: ISA.REG16[opcode - 0x40] }, src: null });
    if (opcode >= 0x48 && opcode <= 0x4F) return finalize({ mnemonic: 'DEC', size: 16, dst: { type: 'reg', name: ISA.REG16[opcode - 0x48] }, src: null });
    if (opcode === 0xFE || opcode === 0xFF) {
      const size = opcode === 0xFF ? 16 : 8;
      const m = readModRM();
      const mnemonic = m.reg === 0 ? 'INC' : (m.reg === 1 ? 'DEC' : ('GRP5_' + m.reg));
      return finalize({ mnemonic, size, dst: rmOperand(m, size), src: null });
    }

    if (opcode === 0xE9) { const rel = signed16(fetch16()); return finalize({ mnemonic: 'JMP', rel }); }
    if (opcode === 0xE8) { const rel = signed16(fetch16()); return finalize({ mnemonic: 'CALL', rel }); }
    if (opcode >= 0x70 && opcode <= 0x7F) {
      const rel = signed8(fetch8());
      const mnemonic = (ISA.JCC_CANON[opcode] || 'J??').split('/')[0];
      return finalize({ mnemonic, rel, jccOpcode: opcode });
    }
    if (opcode === 0xE0) { const rel = signed8(fetch8()); return finalize({ mnemonic: 'LOOPNE', rel }); }
    if (opcode === 0xE1) { const rel = signed8(fetch8()); return finalize({ mnemonic: 'LOOPE', rel }); }
    if (opcode === 0xE2) { const rel = signed8(fetch8()); return finalize({ mnemonic: 'LOOP', rel }); }
    if (opcode === 0xE3) { const rel = signed8(fetch8()); return finalize({ mnemonic: 'JCXZ', rel }); }

    if (opcode >= 0x50 && opcode <= 0x57) return finalize({ mnemonic: 'PUSH', size: 16, src: { type: 'reg', name: ISA.REG16[opcode - 0x50] } });
    if (opcode >= 0x58 && opcode <= 0x5F) return finalize({ mnemonic: 'POP', size: 16, dst: { type: 'reg', name: ISA.REG16[opcode - 0x58] } });
    if ([0x06, 0x0E, 0x16, 0x1E].includes(opcode)) { const map = { 0x06: 'ES', 0x0E: 'CS', 0x16: 'SS', 0x1E: 'DS' }; return finalize({ mnemonic: 'PUSH', size: 16, src: { type: 'sreg', name: map[opcode] } }); }
    if ([0x07, 0x17, 0x1F].includes(opcode)) { const map = { 0x07: 'ES', 0x17: 'SS', 0x1F: 'DS' }; return finalize({ mnemonic: 'POP', size: 16, dst: { type: 'sreg', name: map[opcode] } }); }
    if (opcode === 0x68) { const val = fetch16(); return finalize({ mnemonic: 'PUSH', size: 16, src: { type: 'imm', value: val } }); }

    if (opcode === 0xC3) return finalize({ mnemonic: 'RET', imm: 0 });
    if (opcode === 0xC2) { const val = fetch16(); return finalize({ mnemonic: 'RET', imm: val }); }
    if (opcode === 0xCD) { const val = fetch8(); return finalize({ mnemonic: 'INT', imm: val }); }
    if (opcode === 0xF4) return finalize({ mnemonic: 'HLT' });
    if (opcode === 0x90) return finalize({ mnemonic: 'NOP' });
    if (opcode === 0x98) return finalize({ mnemonic: 'CBW' });
    if (opcode === 0x99) return finalize({ mnemonic: 'CWD' });
    if (opcode === 0x60) return finalize({ mnemonic: 'PUSHA' });
    if (opcode === 0x61) return finalize({ mnemonic: 'POPA' });
    if (opcode === 0xFC) return finalize({ mnemonic: 'CLD' });
    if (opcode === 0xFD) return finalize({ mnemonic: 'STD' });
    if (opcode === 0xFA) return finalize({ mnemonic: 'CLI' });
    if (opcode === 0xFB) return finalize({ mnemonic: 'STI' });
    if (opcode === 0xC9) return finalize({ mnemonic: 'LEAVE' });
    if (opcode === 0xC8) { const enterSize = fetch16(); const enterLevel = fetch8(); return finalize({ mnemonic: 'ENTER', enterSize, enterLevel }); }

    if (opcode === 0xF6 || opcode === 0xF7) {
      const size = opcode === 0xF7 ? 16 : 8;
      const m = readModRM();
      const map = { 4: 'MUL', 5: 'IMUL', 6: 'DIV', 7: 'IDIV' };
      const mnemonic = map[m.reg] || ('GRP3_' + m.reg);
      return finalize({ mnemonic, size, src: rmOperand(m, size) });
    }
    if (opcode === 0x69) {
      const m = readModRM();
      const dst = regOperand(m, 16);
      const src = rmOperand(m, 16);
      const imm = fetch16();
      return finalize({ mnemonic: 'IMUL3', size: 16, dst, src, imm });
    }

    if ([0xD0, 0xD1, 0xD2, 0xD3, 0xC0, 0xC1].includes(opcode)) {
      const size = (opcode === 0xD1 || opcode === 0xD3 || opcode === 0xC1) ? 16 : 8;
      const m = readModRM();
      const map = { 0: 'ROL', 1: 'ROR', 2: 'RCL', 3: 'RCR', 4: 'SHL', 5: 'SHR', 7: 'SAR' };
      const mnemonic = map[m.reg] || ('GRP2_' + m.reg);
      const dst = rmOperand(m, size);
      let src;
      if (opcode === 0xD0 || opcode === 0xD1) src = { type: 'imm', value: 1 };
      else if (opcode === 0xD2 || opcode === 0xD3) src = { type: 'reg', name: 'CL' };
      else src = { type: 'imm', value: fetch8() };
      return finalize({ mnemonic, size, dst, src });
    }

    if (STRING_MAP[opcode]) return finalize({ mnemonic: STRING_MAP[opcode] });

    return finalize({ mnemonic: '??', unknown: true, opcodeByte: opcode });
  }

  const DECODER = { decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = DECODER;
  else global.DECODER = DECODER;
})(typeof window !== 'undefined' ? window : globalThis);

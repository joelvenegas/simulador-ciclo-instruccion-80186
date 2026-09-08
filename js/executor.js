// executor.js — Etapa EXECUTE del ciclo: a partir de una instrucción ya
// decodificada, LEE el estado actual de la CPU y calcula el resultado, pero
// no escribe nada directamente. Devuelve una lista de "micro-ops" que la
// etapa WRITEBACK (ver cycle-engine.js) aplica sobre la CPU. Esta separación
// es la que permite animar Execute y Writeback como pasos distintos.
(function (global) {
  'use strict';
  const ISA = (typeof module !== 'undefined' && module.exports) ? require('./isa.js') : global.ISA;

  function setBit(flags, bit, on) { return on ? (flags | bit) : (flags & ~bit); }
  function signed8(v) { return (v & 0x80) ? v - 256 : v; }
  function signed16(v) { return (v & 0x8000) ? v - 0x10000 : v; }
  function parityEven(v) { let x = v & 0xFF, c = 0; while (x) { c += x & 1; x >>= 1; } return c % 2 === 0; }

  function computeArithFlags(currentFlags, a, b, size, isSub) {
    const mask = size === 16 ? 0xFFFF : 0xFF;
    const signBit = size === 16 ? 0x8000 : 0x80;
    let full, CF, AF, OF;
    if (isSub) {
      full = a - b;
      CF = full < 0;
      AF = (a & 0xF) < (b & 0xF);
    } else {
      full = a + b;
      CF = full > mask;
      AF = ((a & 0xF) + (b & 0xF)) > 0xF;
    }
    const result = full & mask;
    OF = isSub
      ? (((a ^ b) & (a ^ result)) & signBit) !== 0
      : ((~(a ^ b) & (a ^ result)) & signBit) !== 0;
    let flags = currentFlags;
    flags = setBit(flags, ISA.FLAGS.CF, CF);
    flags = setBit(flags, ISA.FLAGS.AF, AF);
    flags = setBit(flags, ISA.FLAGS.OF, OF);
    flags = setBit(flags, ISA.FLAGS.ZF, result === 0);
    flags = setBit(flags, ISA.FLAGS.SF, (result & signBit) !== 0);
    flags = setBit(flags, ISA.FLAGS.PF, parityEven(result));
    return { result, flags };
  }
  function computeLogicFlags(currentFlags, resultRaw, size) {
    const mask = size === 16 ? 0xFFFF : 0xFF;
    const signBit = size === 16 ? 0x8000 : 0x80;
    const result = resultRaw & mask;
    let flags = currentFlags;
    flags = setBit(flags, ISA.FLAGS.CF, false);
    flags = setBit(flags, ISA.FLAGS.OF, false);
    flags = setBit(flags, ISA.FLAGS.ZF, result === 0);
    flags = setBit(flags, ISA.FLAGS.SF, (result & signBit) !== 0);
    flags = setBit(flags, ISA.FLAGS.PF, parityEven(result));
    return { result, flags };
  }

  function testCondition(cpu, opcode) {
    const F = name => cpu.getFlag(name);
    switch (opcode) {
      case 0x70: return F('OF'); case 0x71: return !F('OF');
      case 0x72: return F('CF'); case 0x73: return !F('CF');
      case 0x74: return F('ZF'); case 0x75: return !F('ZF');
      case 0x76: return F('CF') || F('ZF'); case 0x77: return !F('CF') && !F('ZF');
      case 0x78: return F('SF'); case 0x79: return !F('SF');
      case 0x7A: return F('PF'); case 0x7B: return !F('PF');
      case 0x7C: return F('SF') !== F('OF'); case 0x7D: return F('SF') === F('OF');
      case 0x7E: return F('ZF') || (F('SF') !== F('OF')); case 0x7F: return !F('ZF') && (F('SF') === F('OF'));
      default: return false;
    }
  }

  function effectiveAddress(cpu, memOp) {
    let off = memOp.direct ? memOp.disp : memOp.baseRegs.reduce((acc, r) => acc + cpu.getReg16(r), memOp.disp);
    off &= 0xFFFF;
    return { seg: cpu.getSReg(memOp.segReg), off };
  }
  function readOperandValue(cpu, op) {
    if (!op) return 0;
    switch (op.type) {
      case 'reg': return ISA.REG8_INDEX[op.name] !== undefined ? cpu.getReg8(op.name) : cpu.getReg16(op.name);
      case 'sreg': return cpu.getSReg(op.name);
      case 'imm': return op.value & 0xFFFF;
      case 'mem': { const ea = effectiveAddress(cpu, op); return op.size === 16 ? cpu.readWord(ea.seg, ea.off) : cpu.readByte(ea.seg, ea.off); }
      default: return 0;
    }
  }
  function writeOperand(cpu, op, value) {
    if (op.type === 'reg') {
      return [ISA.REG8_INDEX[op.name] !== undefined ? { type: 'reg8', name: op.name, value: value & 0xFF } : { type: 'reg', name: op.name, value: value & 0xFFFF }];
    }
    if (op.type === 'sreg') return [{ type: 'sreg', name: op.name, value: value & 0xFFFF }];
    if (op.type === 'mem') { const ea = effectiveAddress(cpu, op); return [{ type: 'mem', seg: ea.seg, off: ea.off, value, size: op.size }]; }
    throw new Error('No se puede escribir en este tipo de operando');
  }

  const STRING_MNEMONICS = ['MOVSB', 'MOVSW', 'LODSB', 'LODSW', 'STOSB', 'STOSW', 'CMPSB', 'CMPSW', 'SCASB', 'SCASW'];

  function execute(cpu, instr) {
    const size = instr.size;
    const microOps = [];
    const flagsIn = cpu.flags;
    const mn = instr.mnemonic;

    if (ISA.ALU_OPS[mn] !== undefined) {
      const a = readOperandValue(cpu, instr.dst);
      const b = readOperandValue(cpu, instr.src);
      let result, flags;
      if (mn === 'AND' || mn === 'OR' || mn === 'XOR') {
        const r = mn === 'AND' ? (a & b) : (mn === 'OR' ? (a | b) : (a ^ b));
        ({ result, flags } = computeLogicFlags(flagsIn, r, size));
      } else {
        const isSub = mn === 'SUB' || mn === 'CMP';
        ({ result, flags } = computeArithFlags(flagsIn, a, b, size, isSub));
      }
      microOps.push({ type: 'flags', value: flags });
      if (mn !== 'CMP') microOps.push(...writeOperand(cpu, instr.dst, result));
      return { microOps };
    }

    if (mn === 'MOV') {
      const v = readOperandValue(cpu, instr.src);
      microOps.push(...writeOperand(cpu, instr.dst, v));
      return { microOps };
    }

    if (mn === 'INC' || mn === 'DEC') {
      const a = readOperandValue(cpu, instr.dst);
      const isSub = mn === 'DEC';
      const { result, flags } = computeArithFlags(flagsIn, a, 1, size, isSub);
      // INC/DEC no modifican CF en el 8086 real: se preserva el valor previo.
      const finalFlags = setBit(flags, ISA.FLAGS.CF, cpu.getFlag('CF'));
      microOps.push({ type: 'flags', value: finalFlags });
      microOps.push(...writeOperand(cpu, instr.dst, result));
      return { microOps };
    }

    if (mn === 'JMP') { microOps.push({ type: 'reg', name: 'IP', value: (cpu.reg.IP + instr.rel) & 0xFFFF }); return { microOps }; }
    if (mn === 'CALL') {
      const returnAddr = cpu.reg.IP;
      const newSP = (cpu.reg.SP - 2) & 0xFFFF;
      microOps.push({ type: 'reg', name: 'SP', value: newSP });
      microOps.push({ type: 'mem', seg: cpu.sreg.SS, off: newSP, value: returnAddr, size: 16 });
      microOps.push({ type: 'reg', name: 'IP', value: (cpu.reg.IP + instr.rel) & 0xFFFF });
      return { microOps };
    }
    if (mn === 'RET') {
      const retAddr = cpu.readWord(cpu.sreg.SS, cpu.reg.SP);
      const newSP = (cpu.reg.SP + 2 + (instr.imm || 0)) & 0xFFFF;
      microOps.push({ type: 'reg', name: 'SP', value: newSP });
      microOps.push({ type: 'reg', name: 'IP', value: retAddr });
      return { microOps };
    }
    if (instr.jccOpcode !== undefined) {
      if (testCondition(cpu, instr.jccOpcode)) microOps.push({ type: 'reg', name: 'IP', value: (cpu.reg.IP + instr.rel) & 0xFFFF });
      return { microOps };
    }
    if (mn === 'LOOP' || mn === 'LOOPE' || mn === 'LOOPZ' || mn === 'LOOPNE' || mn === 'LOOPNZ') {
      const newCX = (cpu.reg.CX - 1) & 0xFFFF;
      microOps.push({ type: 'reg', name: 'CX', value: newCX });
      let take = newCX !== 0;
      if (mn === 'LOOPE' || mn === 'LOOPZ') take = take && cpu.getFlag('ZF');
      if (mn === 'LOOPNE' || mn === 'LOOPNZ') take = take && !cpu.getFlag('ZF');
      if (take) microOps.push({ type: 'reg', name: 'IP', value: (cpu.reg.IP + instr.rel) & 0xFFFF });
      return { microOps };
    }
    if (mn === 'JCXZ') {
      if (cpu.reg.CX === 0) microOps.push({ type: 'reg', name: 'IP', value: (cpu.reg.IP + instr.rel) & 0xFFFF });
      return { microOps };
    }

    if (mn === 'PUSH') {
      const val = readOperandValue(cpu, instr.src);
      const newSP = (cpu.reg.SP - 2) & 0xFFFF;
      microOps.push({ type: 'reg', name: 'SP', value: newSP });
      microOps.push({ type: 'mem', seg: cpu.sreg.SS, off: newSP, value: val, size: 16 });
      return { microOps };
    }
    if (mn === 'POP') {
      const val = cpu.readWord(cpu.sreg.SS, cpu.reg.SP);
      microOps.push({ type: 'reg', name: 'SP', value: (cpu.reg.SP + 2) & 0xFFFF });
      microOps.push(...writeOperand(cpu, instr.dst, val));
      return { microOps };
    }
    if (mn === 'PUSHA') {
      const order = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
      let sp = cpu.reg.SP;
      const originalSP = sp;
      for (const r of order) {
        sp = (sp - 2) & 0xFFFF;
        const val = r === 'SP' ? originalSP : cpu.getReg16(r);
        microOps.push({ type: 'mem', seg: cpu.sreg.SS, off: sp, value: val, size: 16 });
      }
      microOps.push({ type: 'reg', name: 'SP', value: sp });
      return { microOps };
    }
    if (mn === 'POPA') {
      const order = ['DI', 'SI', 'BP', null, 'BX', 'DX', 'CX', 'AX'];
      let sp = cpu.reg.SP;
      for (const r of order) {
        const val = cpu.readWord(cpu.sreg.SS, sp);
        sp = (sp + 2) & 0xFFFF;
        if (r) microOps.push({ type: 'reg', name: r, value: val });
      }
      microOps.push({ type: 'reg', name: 'SP', value: sp });
      return { microOps };
    }

    if (mn === 'CBW') {
      const al = cpu.getReg8('AL');
      microOps.push({ type: 'reg', name: 'AX', value: (al & 0x80) ? (al | 0xFF00) : al });
      return { microOps };
    }
    if (mn === 'CWD') {
      const ax = cpu.getReg16('AX');
      microOps.push({ type: 'reg', name: 'DX', value: (ax & 0x8000) ? 0xFFFF : 0 });
      return { microOps };
    }

    if (mn === 'MUL') {
      const src = readOperandValue(cpu, instr.src);
      let overflow;
      if (size === 16) {
        const full = cpu.getReg16('AX') * src;
        const dx = Math.floor(full / 0x10000) & 0xFFFF;
        microOps.push({ type: 'reg', name: 'DX', value: dx });
        microOps.push({ type: 'reg', name: 'AX', value: full & 0xFFFF });
        overflow = dx !== 0;
      } else {
        const full = cpu.getReg8('AL') * src;
        microOps.push({ type: 'reg', name: 'AX', value: full & 0xFFFF });
        overflow = (full & 0xFF00) !== 0;
      }
      let flags = setBit(flagsIn, ISA.FLAGS.CF, overflow);
      flags = setBit(flags, ISA.FLAGS.OF, overflow);
      microOps.push({ type: 'flags', value: flags });
      return { microOps };
    }
    if (mn === 'IMUL') {
      const srcU = readOperandValue(cpu, instr.src);
      let overflow;
      if (size === 16) {
        const src = signed16(srcU), ax = signed16(cpu.getReg16('AX'));
        const full = ax * src;
        const ax2 = full & 0xFFFF;
        const dx = Math.floor(full / 0x10000) & 0xFFFF;
        microOps.push({ type: 'reg', name: 'DX', value: dx });
        microOps.push({ type: 'reg', name: 'AX', value: ax2 });
        overflow = full !== signed16(ax2);
      } else {
        const src = signed8(srcU), al = signed8(cpu.getReg8('AL'));
        const full = al * src;
        microOps.push({ type: 'reg', name: 'AX', value: full & 0xFFFF });
        overflow = full !== signed8(full & 0xFF);
      }
      let flags = setBit(flagsIn, ISA.FLAGS.CF, overflow);
      flags = setBit(flags, ISA.FLAGS.OF, overflow);
      microOps.push({ type: 'flags', value: flags });
      return { microOps };
    }
    if (mn === 'IMUL3') {
      const src = signed16(readOperandValue(cpu, instr.src));
      const imm = signed16(instr.imm);
      const full = src * imm;
      const result16 = full & 0xFFFF;
      microOps.push(...writeOperand(cpu, instr.dst, result16));
      const overflow = full !== signed16(result16);
      let flags = setBit(flagsIn, ISA.FLAGS.CF, overflow);
      flags = setBit(flags, ISA.FLAGS.OF, overflow);
      microOps.push({ type: 'flags', value: flags });
      return { microOps };
    }
    if (mn === 'DIV' || mn === 'IDIV') {
      const srcU = readOperandValue(cpu, instr.src);
      if (srcU === 0) return { microOps: [{ type: 'exception', message: 'División por cero' }] };
      const signedMode = mn === 'IDIV';
      if (size === 16) {
        const dividendU = (cpu.getReg16('DX') * 0x10000) + cpu.getReg16('AX');
        const dividend = signedMode ? (dividendU >= 0x80000000 ? dividendU - 0x100000000 : dividendU) : dividendU;
        const divisor = signedMode ? signed16(srcU) : srcU;
        const q = Math.trunc(dividend / divisor);
        const r = dividend - q * divisor;
        const qMin = signedMode ? -32768 : 0, qMax = signedMode ? 32767 : 0xFFFF;
        if (q < qMin || q > qMax) return { microOps: [{ type: 'exception', message: 'Overflow de división: el cociente no entra en 16 bits' }] };
        microOps.push({ type: 'reg', name: 'AX', value: q & 0xFFFF });
        microOps.push({ type: 'reg', name: 'DX', value: r & 0xFFFF });
      } else {
        const dividendU = cpu.getReg16('AX');
        const dividend = signedMode ? signed16(dividendU) : dividendU;
        const divisor = signedMode ? signed8(srcU) : srcU;
        const q = Math.trunc(dividend / divisor);
        const r = dividend - q * divisor;
        const qMin = signedMode ? -128 : 0, qMax = signedMode ? 127 : 0xFF;
        if (q < qMin || q > qMax) return { microOps: [{ type: 'exception', message: 'Overflow de división: el cociente no entra en 8 bits' }] };
        microOps.push({ type: 'reg8', name: 'AL', value: q & 0xFF });
        microOps.push({ type: 'reg8', name: 'AH', value: r & 0xFF });
      }
      return { microOps };
    }

    if (ISA.SHIFT_OPS[mn] !== undefined) return executeShift(cpu, instr, mn, size, flagsIn);

    if (STRING_MNEMONICS.includes(mn)) return executeStringOp(cpu, instr, flagsIn);

    if (mn === 'INT') return executeInt(cpu, instr);
    if (mn === 'HLT') return { microOps: [{ type: 'halt' }] };
    if (mn === 'NOP') return { microOps: [] };
    if (mn === 'CLD') return { microOps: [{ type: 'flags', value: setBit(flagsIn, ISA.FLAGS.DF, false) }] };
    if (mn === 'STD') return { microOps: [{ type: 'flags', value: setBit(flagsIn, ISA.FLAGS.DF, true) }] };
    if (mn === 'CLI') return { microOps: [{ type: 'flags', value: setBit(flagsIn, ISA.FLAGS.IF, false) }] };
    if (mn === 'STI') return { microOps: [{ type: 'flags', value: setBit(flagsIn, ISA.FLAGS.IF, true) }] };
    if (mn === 'ENTER') {
      const newSP1 = (cpu.reg.SP - 2) & 0xFFFF;
      microOps.push({ type: 'mem', seg: cpu.sreg.SS, off: newSP1, value: cpu.reg.BP, size: 16 });
      microOps.push({ type: 'reg', name: 'BP', value: newSP1 });
      microOps.push({ type: 'reg', name: 'SP', value: (newSP1 - instr.enterSize) & 0xFFFF });
      return { microOps };
    }
    if (mn === 'LEAVE') {
      const newSP = cpu.reg.BP;
      const newBP = cpu.readWord(cpu.sreg.SS, newSP);
      microOps.push({ type: 'reg', name: 'SP', value: (newSP + 2) & 0xFFFF });
      microOps.push({ type: 'reg', name: 'BP', value: newBP });
      return { microOps };
    }

    return { microOps: [{ type: 'exception', message: `Instrucción no soportada en tiempo de ejecución: ${mn}` }] };
  }

  function executeShift(cpu, instr, mn, size, flagsIn) {
    const microOps = [];
    const countRaw = readOperandValue(cpu, instr.src);
    const count = countRaw & 0x1F;
    const mask = size === 16 ? 0xFFFF : 0xFF;
    const signBit = size === 16 ? 0x8000 : 0x80;
    let val = readOperandValue(cpu, instr.dst);
    const originalVal = val;
    let cf = cpu.getFlag('CF');
    for (let i = 0; i < count; i++) {
      switch (mn) {
        case 'ROL': cf = (val & signBit) !== 0; val = ((val << 1) | (cf ? 1 : 0)) & mask; break;
        case 'ROR': { const lsb = (val & 1) !== 0; cf = lsb; val = ((val >> 1) | (lsb ? signBit : 0)) & mask; break; }
        case 'RCL': { const newCF = (val & signBit) !== 0; val = ((val << 1) | (cf ? 1 : 0)) & mask; cf = newCF; break; }
        case 'RCR': { const newCF = (val & 1) !== 0; val = ((val >> 1) | (cf ? signBit : 0)) & mask; cf = newCF; break; }
        case 'SHL': case 'SAL': cf = (val & signBit) !== 0; val = (val << 1) & mask; break;
        case 'SHR': cf = (val & 1) !== 0; val = (val >> 1) & mask; break;
        case 'SAR': { const sb = val & signBit; cf = (val & 1) !== 0; val = ((val >> 1) | sb) & mask; break; }
        default: break;
      }
    }
    if (count > 0) {
      let flags = setBit(flagsIn, ISA.FLAGS.CF, cf);
      if (mn === 'SHL' || mn === 'SAL' || mn === 'SHR' || mn === 'SAR') {
        flags = setBit(flags, ISA.FLAGS.ZF, val === 0);
        flags = setBit(flags, ISA.FLAGS.SF, (val & signBit) !== 0);
        flags = setBit(flags, ISA.FLAGS.PF, parityEven(val));
      }
      // El flag OF sólo está bien definido para desplazamientos de a 1 bit.
      if (count === 1) {
        if (mn === 'SHL' || mn === 'SAL') flags = setBit(flags, ISA.FLAGS.OF, ((val & signBit) !== 0) !== cf);
        else if (mn === 'SAR') flags = setBit(flags, ISA.FLAGS.OF, false);
        else if (mn === 'SHR') flags = setBit(flags, ISA.FLAGS.OF, (originalVal & signBit) !== 0);
      }
      microOps.push({ type: 'flags', value: flags });
      microOps.push(...writeOperand(cpu, instr.dst, val));
    }
    return { microOps };
  }

  function executeStringOp(cpu, instr, flagsIn) {
    const mn = instr.mnemonic;
    const wordSize = mn.endsWith('W') ? 16 : 8;
    const step = wordSize === 16 ? 2 : 1;
    const df = cpu.getFlag('DF') ? -1 : 1;
    const srcSeg = instr.segOverride || 'DS';
    let si = cpu.reg.SI, di = cpu.reg.DI, cx = cpu.reg.CX, ax = cpu.getReg16('AX');
    let flags = flagsIn;
    const memWrites = [];
    let count = 0, stop = false;
    while (!stop) {
      if (instr.repPrefix && cx === 0) break;
      if (mn.startsWith('MOVS')) {
        const val = wordSize === 16 ? cpu.readWord(cpu.getSReg(srcSeg), si) : cpu.readByte(cpu.getSReg(srcSeg), si);
        memWrites.push({ type: 'mem', seg: cpu.getSReg('ES'), off: di, value: val, size: wordSize });
        si = (si + df * step) & 0xFFFF; di = (di + df * step) & 0xFFFF;
      } else if (mn.startsWith('LODS')) {
        const val = wordSize === 16 ? cpu.readWord(cpu.getSReg(srcSeg), si) : cpu.readByte(cpu.getSReg(srcSeg), si);
        ax = wordSize === 16 ? val : ((ax & 0xFF00) | val);
        si = (si + df * step) & 0xFFFF;
      } else if (mn.startsWith('STOS')) {
        const val = wordSize === 16 ? ax : (ax & 0xFF);
        memWrites.push({ type: 'mem', seg: cpu.getSReg('ES'), off: di, value: val, size: wordSize });
        di = (di + df * step) & 0xFFFF;
      } else if (mn.startsWith('CMPS')) {
        const a = wordSize === 16 ? cpu.readWord(cpu.getSReg(srcSeg), si) : cpu.readByte(cpu.getSReg(srcSeg), si);
        const b = wordSize === 16 ? cpu.readWord(cpu.getSReg('ES'), di) : cpu.readByte(cpu.getSReg('ES'), di);
        flags = computeArithFlags(flags, a, b, wordSize, true).flags;
        si = (si + df * step) & 0xFFFF; di = (di + df * step) & 0xFFFF;
      } else if (mn.startsWith('SCAS')) {
        const a = wordSize === 16 ? ax : (ax & 0xFF);
        const b = wordSize === 16 ? cpu.readWord(cpu.getSReg('ES'), di) : cpu.readByte(cpu.getSReg('ES'), di);
        flags = computeArithFlags(flags, a, b, wordSize, true).flags;
        di = (di + df * step) & 0xFFFF;
      }
      count++;
      if (instr.repPrefix) {
        cx = (cx - 1) & 0xFFFF;
        const isCmpOrScan = mn.startsWith('CMPS') || mn.startsWith('SCAS');
        if (cx === 0) stop = true;
        else if (isCmpOrScan && instr.repPrefix === 'REP' && !((flags & ISA.FLAGS.ZF) !== 0)) stop = true; // REPE: mientras ZF=1
        else if (isCmpOrScan && instr.repPrefix === 'REPNE' && ((flags & ISA.FLAGS.ZF) !== 0)) stop = true; // REPNE: mientras ZF=0
      } else stop = true;
      if (count > 0x10000) stop = true; // salvaguarda anti bucle infinito
    }
    const microOps = [
      { type: 'reg', name: 'SI', value: si },
      { type: 'reg', name: 'DI', value: di }
    ];
    if (instr.repPrefix) microOps.push({ type: 'reg', name: 'CX', value: cx });
    if (mn.startsWith('LODS')) microOps.push(wordSize === 16 ? { type: 'reg', name: 'AX', value: ax } : { type: 'reg8', name: 'AL', value: ax & 0xFF });
    if (mn.startsWith('CMPS') || mn.startsWith('SCAS')) microOps.push({ type: 'flags', value: flags });
    microOps.push(...memWrites);
    return { microOps };
  }

  function executeInt(cpu, instr) {
    const vector = instr.imm;
    const microOps = [];
    if (vector === 0x21) {
      const ah = cpu.getReg8('AH');
      if (ah === 0x4C) microOps.push({ type: 'halt' });
      else if (ah === 0x02) microOps.push({ type: 'output', text: String.fromCharCode(cpu.getReg8('DL')) });
      else if (ah === 0x09) {
        let off = cpu.reg.DX, str = '';
        while (str.length < 2000) {
          const ch = cpu.readByte(cpu.sreg.DS, off);
          if (ch === 0x24) break; // '$'
          str += String.fromCharCode(ch);
          off = (off + 1) & 0xFFFF;
        }
        microOps.push({ type: 'output', text: str });
      } else {
        microOps.push({ type: 'output', text: `\n[INT 21h AH=${ah.toString(16).toUpperCase()}h no simulado]\n` });
      }
    } else {
      microOps.push({ type: 'output', text: `\n[INT ${vector.toString(16).toUpperCase()}h no simulado]\n` });
    }
    return { microOps };
  }

  const EXECUTOR = { execute, testCondition, computeArithFlags, computeLogicFlags };
  if (typeof module !== 'undefined' && module.exports) module.exports = EXECUTOR;
  else global.EXECUTOR = EXECUTOR;
})(typeof window !== 'undefined' ? window : globalThis);

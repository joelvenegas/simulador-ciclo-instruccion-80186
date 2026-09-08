// cpu.js — Estado de la CPU: registros, memoria (1 MB, modo real) y flags.
// No conoce nada de ensamblador ni de decodificación: solo expone el
// estado y operaciones básicas de lectura/escritura/pila.
(function (global) {
  'use strict';
  const ISA = (typeof module !== 'undefined' && module.exports) ? require('./isa.js') : global.ISA;

  // Segmento por defecto para CS/DS/ES/SS. Se elige distinto de 0 a
  // propósito: así "dirección física = segmento*16 + offset" se ve como
  // un cálculo real y no como un caso trivial (segmento 0 -> física=offset).
  const DEFAULT_SEGMENT = 0x1000;
  const DEFAULT_SP = 0xFFFE;
  const MEM_SIZE = 0x100000; // 1 MB, espacio de direcciones de modo real (20 bits)

  class CPU {
    constructor() {
      this.memory = new Uint8Array(MEM_SIZE);
      this.reset();
    }

    reset() {
      this.reg = { AX: 0, BX: 0, CX: 0, DX: 0, SP: DEFAULT_SP, BP: 0, SI: 0, DI: 0, IP: 0 };
      this.sreg = { CS: DEFAULT_SEGMENT, DS: DEFAULT_SEGMENT, ES: DEFAULT_SEGMENT, SS: DEFAULT_SEGMENT };
      this.flags = 0;
      this.halted = false;
      this.memory.fill(0);
      this.output = []; // consola simulada (INT 21h)
      this.cycles = 0;
    }

    // --- Direccionamiento físico (modo real: seg*16 + offset, 20 bits) ---
    physicalAddress(seg, off) {
      return ((seg << 4) + (off & 0xFFFF)) & 0xFFFFF;
    }

    // --- Memoria ---
    readByte(seg, off) {
      return this.memory[this.physicalAddress(seg, off)];
    }
    writeByte(seg, off, val) {
      this.memory[this.physicalAddress(seg, off)] = val & 0xFF;
    }
    readWord(seg, off) {
      const lo = this.readByte(seg, off);
      const hi = this.readByte(seg, (off + 1) & 0xFFFF);
      return (hi << 8) | lo;
    }
    writeWord(seg, off, val) {
      this.writeByte(seg, off, val & 0xFF);
      this.writeByte(seg, (off + 1) & 0xFFFF, (val >> 8) & 0xFF);
    }

    // Carga un programa ya ensamblado (array de bytes) en CS:orgOffset.
    loadProgram(bytes, orgOffset) {
      for (let i = 0; i < bytes.length; i++) {
        this.writeByte(this.sreg.CS, (orgOffset + i) & 0xFFFF, bytes[i]);
      }
      this.reg.IP = orgOffset & 0xFFFF;
    }

    // --- Registros de 16 bits ---
    getReg16(name) { return this.reg[name] & 0xFFFF; }
    setReg16(name, val) { this.reg[name] = val & 0xFFFF; }

    // --- Registros de 8 bits (mitades de AX/BX/CX/DX) ---
    getReg8(name) {
      const p = ISA.REG8_PARENT[name];
      const v = this.reg[p.parent] & 0xFFFF;
      return p.half === 'low' ? (v & 0xFF) : ((v >> 8) & 0xFF);
    }
    setReg8(name, val) {
      const p = ISA.REG8_PARENT[name];
      const cur = this.reg[p.parent] & 0xFFFF;
      if (p.half === 'low') this.reg[p.parent] = (cur & 0xFF00) | (val & 0xFF);
      else this.reg[p.parent] = (cur & 0x00FF) | ((val & 0xFF) << 8);
    }

    // --- Segmentos ---
    getSReg(name) { return this.sreg[name] & 0xFFFF; }
    setSReg(name, val) { this.sreg[name] = val & 0xFFFF; }

    // --- Flags ---
    getFlag(name) { return (this.flags & ISA.FLAGS[name]) !== 0; }
    setFlag(name, on) {
      if (on) this.flags |= ISA.FLAGS[name];
      else this.flags &= ~ISA.FLAGS[name];
    }

    // --- Pila (usa SS:SP) ---
    push16(val) {
      this.reg.SP = (this.reg.SP - 2) & 0xFFFF;
      this.writeWord(this.sreg.SS, this.reg.SP, val);
    }
    pop16() {
      const val = this.readWord(this.sreg.SS, this.reg.SP);
      this.reg.SP = (this.reg.SP + 2) & 0xFFFF;
      return val;
    }

    // Aplica un micro-op (ver executor.js) durante la etapa WRITEBACK.
    applyMicroOp(op) {
      switch (op.type) {
        case 'reg': this.reg[op.name] = op.value & 0xFFFF; break;
        case 'reg8': this.setReg8(op.name, op.value); break;
        case 'sreg': this.sreg[op.name] = op.value & 0xFFFF; break;
        case 'mem': if (op.size === 16) this.writeWord(op.seg, op.off, op.value); else this.writeByte(op.seg, op.off, op.value); break;
        case 'flags': this.flags = op.value & 0xFFFF; break;
        case 'halt': this.halted = true; break;
        case 'output': this.output.push(op.text); break;
        case 'exception': this.halted = true; this.error = op.message; break;
        default: break;
      }
    }

    // Snapshot plano, útil para la UI y para tests.
    snapshot() {
      return {
        reg: Object.assign({}, this.reg),
        sreg: Object.assign({}, this.sreg),
        flags: this.flags,
        halted: this.halted,
        output: this.output.slice(),
        cycles: this.cycles
      };
    }
  }

  const CPU_NS = { CPU, DEFAULT_SEGMENT, DEFAULT_SP, MEM_SIZE };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CPU_NS;
  } else {
    global.CPU_NS = CPU_NS;
  }
})(typeof window !== 'undefined' ? window : globalThis);

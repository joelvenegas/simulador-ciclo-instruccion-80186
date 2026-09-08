// isa.js — Tablas de la arquitectura 8086/80186 compartidas entre el
// ensamblador (assembler.js) y el decodificador (decoder.js).
// Patrón UMD-lite: funciona como <script> en el navegador (cuelga ISA de
// `window`) y como módulo CommonJS en Node (para poder testear con `node`).
(function (global) {
  'use strict';

  // Orden real de codificación de registros de 16 bits en x86 (campo reg/rm).
  const REG16 = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI'];
  const REG16_INDEX = {};
  REG16.forEach((r, i) => { REG16_INDEX[r] = i; });

  // Orden real de codificación de registros de 8 bits.
  const REG8 = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH'];
  const REG8_INDEX = {};
  REG8.forEach((r, i) => { REG8_INDEX[r] = i; });

  // Registro de 16 bits "padre" de cada registro de 8 bits, y si es la
  // mitad alta o baja.
  const REG8_PARENT = {
    AL: { parent: 'AX', half: 'low' }, AH: { parent: 'AX', half: 'high' },
    CL: { parent: 'CX', half: 'low' }, CH: { parent: 'CX', half: 'high' },
    DL: { parent: 'DX', half: 'low' }, DH: { parent: 'DX', half: 'high' },
    BL: { parent: 'BX', half: 'low' }, BH: { parent: 'BX', half: 'high' }
  };

  // Registros de segmento (campo usado en 8C/8E, y prefijos de override).
  const SREG = ['ES', 'CS', 'SS', 'DS'];
  const SREG_INDEX = {};
  SREG.forEach((r, i) => { SREG_INDEX[r] = i; });

  // Tabla estándar de direccionamiento de memoria de 16 bits (mod=00/01/10).
  // rm -> [registroBase, registroIndice] ; rm=6 con mod=00 es dirección
  // directa (disp16), no [BP].
  const RM_TABLE = [
    ['BX', 'SI'], ['BX', 'DI'], ['BP', 'SI'], ['BP', 'DI'],
    ['SI', null], ['DI', null], ['BP', null], ['BX', null]
  ];

  // Grupo aritmético/lógico: opcode base para (rm8,r8)/(rm16,r16)/
  // (r8,rm8)/(r16,rm16)/(AL,imm8)/(AX,imm16), y el campo /reg usado en el
  // grupo de inmediatos 80/81.
  const ALU_OPS = {
    ADD: { base: 0x00, immReg: 0 },
    OR: { base: 0x08, immReg: 1 },
    AND: { base: 0x20, immReg: 4 },
    SUB: { base: 0x28, immReg: 5 },
    XOR: { base: 0x30, immReg: 6 },
    CMP: { base: 0x38, immReg: 7 }
  };

  // Grupo de shift/rotate (D0/D1/D2/D3/C0/C1), campo /reg.
  const SHIFT_OPS = { ROL: 0, ROR: 1, RCL: 2, RCR: 3, SHL: 4, SAL: 4, SHR: 5, SAR: 7 };

  // Saltos condicionales de 8 bits (70-7F) con sus alias.
  const JCC = {
    JO: 0x70, JNO: 0x71,
    JB: 0x72, JC: 0x72, JNAE: 0x72,
    JAE: 0x73, JNB: 0x73, JNC: 0x73,
    JE: 0x74, JZ: 0x74,
    JNE: 0x75, JNZ: 0x75,
    JBE: 0x76, JNA: 0x76,
    JA: 0x77, JNBE: 0x77,
    JS: 0x78, JNS: 0x79,
    JP: 0x7A, JPE: 0x7A,
    JNP: 0x7B, JPO: 0x7B,
    JL: 0x7C, JNGE: 0x7C,
    JGE: 0x7D, JNL: 0x7D,
    JLE: 0x7E, JNG: 0x7E,
    JG: 0x7F, JNLE: 0x7F
  };
  // Nombre "canónico" para mostrar en el diagrama (útil para alias).
  const JCC_CANON = {
    0x70: 'JO', 0x71: 'JNO', 0x72: 'JB/JC', 0x73: 'JAE/JNC', 0x74: 'JE/JZ',
    0x75: 'JNE/JNZ', 0x76: 'JBE/JNA', 0x77: 'JA/JNBE', 0x78: 'JS', 0x79: 'JNS',
    0x7A: 'JP/JPE', 0x7B: 'JNP/JPO', 0x7C: 'JL/JNGE', 0x7D: 'JGE/JNL',
    0x7E: 'JLE/JNG', 0x7F: 'JG/JNLE'
  };

  // Bits del registro FLAGS.
  const FLAGS = {
    CF: 0x0001, PF: 0x0004, AF: 0x0010, ZF: 0x0040,
    SF: 0x0080, TF: 0x0100, IF: 0x0200, DF: 0x0400, OF: 0x0800
  };
  const FLAG_ORDER = ['OF', 'DF', 'IF', 'TF', 'SF', 'ZF', 'AF', 'PF', 'CF'];

  const ISA = {
    REG16, REG16_INDEX, REG8, REG8_INDEX, REG8_PARENT,
    SREG, SREG_INDEX, RM_TABLE, ALU_OPS, SHIFT_OPS, JCC, JCC_CANON,
    FLAGS, FLAG_ORDER
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ISA;
  } else {
    global.ISA = ISA;
  }
})(typeof window !== 'undefined' ? window : globalThis);
